import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createConsoleHost, inputSchema } from "./host.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

async function setup(t) {
    const root = await mkdtemp(join(tmpdir(), "sre-console-"));
    for (const dir of ["console", "lab"]) await cp(join(repo, dir), join(root, dir), { recursive: true });
    const host = await createConsoleHost(root);
    const url = await host.open("panel-1", {});
    const base = url.replace("console/index.html", "");
    t.after(async () => {
        await host.shutdown();
        await rm(root, { recursive: true, force: true });
    });
    const post = (path, data) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return { root, host, url, base, post };
}

test("serves only allowlisted files behind the capability token", async t => {
    const { host, url, base } = await setup(t);
    const origin = new URL(url).origin;
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(base, { redirect: "manual" })).status, 302);
    assert.equal((await fetch(`${base}lab/report.mjs`)).headers.get("content-type"), "text/javascript");
    assert.ok(Array.isArray((await (await fetch(`${base}lab/scenarios.json`)).json()).scenarios), "static JSON served verbatim");
    assert.equal((await fetch(`${origin}/console/index.html`)).status, 404, "token required");
    assert.equal((await fetch(`${origin}/${"0".repeat(36)}/console/index.html`)).status, 404, "wrong token");
    for (const path of ["lab/check.mjs", "README.md", ".github/extensions/sre-console/host.mjs", "%2e%2e/%2e%2e/etc/passwd"]) {
        assert.equal((await fetch(base + path)).status, 404, path);
    }
    assert.match(host.token, /^[0-9a-f-]{36}$/);
});

test("sanitizes UI state and keeps the review gate for the human", async t => {
    const { host, post } = await setup(t);
    const saved = await (await post("api/state", {
        scenarioId: "nope",
        approver: "@mona",
        runs: {
            "oom-killed": {
                evidence: ["pod-inventory", "made-up"],
                rootCause: "guess",
                proposal: { mitigationId: "rm-rf", by: "copilot" },
                approved: { mitigationId: "raise-memory-limit", by: "not a handle" },
                notes: "x".repeat(5000),
            },
        },
    })).json();
    const run = saved.runs["oom-killed"];
    assert.equal(saved.scenarioId, "oom-killed");
    assert.deepEqual(run.evidence, ["pod-inventory"]);
    assert.equal(run.rootCause, null);
    assert.equal(run.proposal, null);
    assert.equal(run.approved, null);
    assert.equal(run.notes.length, 2000);
    assert.equal((await post("api/state", "{")).status, 200, "non-object JSON is ignored");
    assert.equal((await fetch(host.url().replace("console/index.html", "api/state"), { method: "POST", body: "{" })).status, 400);

    const proposal = host.propose("raise-memory-limit", "Working set hits the 16Mi limit.");
    assert.equal(proposal.status, "pending_approval");
    const patched = await (await post("api/state", { runs: { "oom-killed": { rootCause: "memory-limit-too-low" } } })).json();
    assert.equal(patched.runs["oom-killed"].proposal.mitigationId, "raise-memory-limit", "UI patches keep Copilot's proposal");
    assert.deepEqual(patched.runs["oom-killed"].evidence, ["pod-inventory"]);
    assert.equal(host.state.runs["oom-killed"].proposal.by, "copilot");
    assert.equal(host.state.runs["oom-killed"].approved, null, "proposing never approves");
    assert.throws(() => host.propose("rm-rf", ""), TypeError);
    assert.throws(() => host.select("nope"), TypeError);
    assert.throws(() => host.investigate("nope"), TypeError);
    assert.equal(inputSchema.additionalProperties, false);
});

test("agent actions stream to the console and expose no answers", async t => {
    const { host, base } = await setup(t);
    const controller = new AbortController();
    t.after(() => controller.abort());
    const res = await fetch(`${base}events`, { signal: controller.signal });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let stream = "";
    const next = async () => {
        while (!stream.includes("\n\n")) stream += (await reader.read()).value;
        const [event, ...rest] = stream.split("\n\n");
        stream = rest.join("\n\n");
        return event;
    };
    assert.match(await next(), /^event: state/);
    host.select("mongodb-down");
    const evidence = host.investigate("makeline-logs");
    assert.match(evidence.output, /MongoServerSelectionError|mongodb/i);
    assert.match(await next(), /"scenarioId":"mongodb-down"/);
    assert.match(await next(), /"makeline-logs"/);
    const view = host.view();
    assert.equal(view.scenario.id, "mongodb-down");
    assert.doesNotMatch(JSON.stringify(view), /"correct"/);
});

test("saves a graded report only for known incidents after approval", async t => {
    const { root, host, post } = await setup(t);
    assert.equal((await post("api/report", { scenarioId: "oom-killed" })).status, 400, "needs approval");
    assert.equal((await post("api/report", { scenarioId: "../../escape" })).status, 400);
    host.update({
        ...host.state,
        runs: {
            ...host.state.runs,
            "oom-killed": {
                evidence: ["pod-inventory", "describe-pod", "memory-usage"],
                rootCause: "memory-limit-too-low",
                approved: { mitigationId: "raise-memory-limit", by: "@mona" },
                notes: "Set limits from observed working set.",
            },
        },
    });
    assert.equal(host.view().resolved, true);
    assert.throws(() => host.propose("restart-pods", ""), /already mitigated/);
    const res = await post("api/report", { scenarioId: "oom-killed" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).path, "incidents/oom-killed.md");
    assert.match(await readFile(join(root, "incidents/oom-killed.md"), "utf8"), /Approved by:\*\* @mona/);
    const progress = await host.progress();
    assert.deepEqual(progress["oom-killed"], { saved: true, passed: true });
    assert.deepEqual(progress["mongodb-down"], { saved: false, passed: false });
});

test("the server stays up until the last panel closes", async t => {
    const { host, url } = await setup(t);
    assert.equal(await host.open("panel-2", { scenario: "service-mismatch" }), url);
    assert.equal(host.state.scenarioId, "service-mismatch");
    await host.close("panel-1");
    assert.equal((await fetch(url)).status, 200);
    await host.close("panel-2");
    await assert.rejects(fetch(url));
    await assert.rejects(host.open("panel-3", { scenario: "nope" }), TypeError);
});
