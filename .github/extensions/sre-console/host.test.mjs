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

test("sanitizes state and routes incident progress through explicit phase actions", async t => {
    const { host, post } = await setup(t);
    const invalid = await post("api/state", {
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
    });
    assert.equal(invalid.status, 400, "approval and mitigation state cannot be patched directly");
    const saved = host.update({
        scenarioId: "nope",
        approver: "@mona",
        runs: {
            "oom-killed": {
                evidence: ["pod-inventory", "made-up"],
                rootCause: "guess",
                proposal: { mitigationId: "rm-rf", by: "copilot" },
                approved: { mitigationId: "raise-memory-limit", by: "not a handle" },
                applied: "raise-memory-limit",
                verification: "passed",
                notes: "x".repeat(5000),
            },
        },
    });
    const run = saved.runs["oom-killed"];
    assert.equal(saved.scenarioId, "oom-killed");
    assert.deepEqual(run.evidence, ["pod-inventory"]);
    assert.equal(run.rootCause, null);
    assert.equal(run.proposal, null);
    assert.equal(run.approved, null);
    assert.equal(run.applied, null);
    assert.equal(run.verification, null);
    assert.equal(run.notes.length, 2000);
    assert.equal((await post("api/state", "{")).status, 400, "non-object JSON is rejected");
    assert.equal((await fetch(host.url().replace("console/index.html", "api/state"), { method: "POST", body: "{" })).status, 400);

    const scenario = host.scenarios.find(item => item.id === "oom-killed");
    for (const signal of scenario.evidence.filter(item => item.required)) host.investigate(signal.id);
    host.act({ action: "diagnose", rootCause: "memory-limit-too-low" });
    const proposal = host.propose("raise-memory-limit", "Working set hits the 16Mi limit.");
    assert.equal(proposal.status, "pending_approval");
    assert.equal(host.state.runs["oom-killed"].proposal.mitigationId, "raise-memory-limit");
    assert.deepEqual(host.state.runs["oom-killed"].evidence, scenario.evidence.filter(item => item.required).map(item => item.id));
    assert.equal(host.state.runs["oom-killed"].proposal.by, "copilot");
    assert.equal(host.state.runs["oom-killed"].approved, null, "proposing never approves");
    assert.throws(() => host.propose("rm-rf", ""), /Unknown mitigation/);
    assert.throws(() => host.act({ action: "apply" }), /approve/);
    assert.throws(() => host.select("nope"), TypeError);
    assert.throws(() => host.investigate("nope"), TypeError);
    const activeScenario = host.state.scenarioId;
    assert.throws(() => host.act({ scenarioId: "nope", action: "investigate", evidenceId: "pod-inventory" }), /Unknown scenario/);
    assert.equal(host.state.scenarioId, activeScenario, "an unknown explicit scenario never falls back to the active incident");
    assert.equal(host.view().stage, "review");
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
    assert.equal((await post("api/report", { scenarioId: "oom-killed" })).status, 400, "needs simulated verification");
    assert.equal((await post("api/report", { scenarioId: "../../escape" })).status, 400);
    const scenario = host.scenarios.find(item => item.id === "oom-killed");
    for (const signal of scenario.evidence.filter(item => item.required)) host.investigate(signal.id);
    host.act({ action: "diagnose", rootCause: "memory-limit-too-low" });
    assert.equal(host.view().stage, "propose");
    host.propose("raise-memory-limit", "Working set reaches its configured limit.");
    assert.equal(host.view().stage, "review");
    host.act({ action: "review-plan", confirm: true });
    assert.equal(host.view().stage, "approval");
    host.act({ action: "approve", approvedBy: "@mona" });
    assert.equal(host.view().stage, "apply");
    await assert.rejects(host.saveReport("oom-killed"), /Verify a successful/);
    host.act({ action: "apply" });
    assert.equal(host.view().stage, "verify");
    host.act({ action: "verify" });
    assert.equal(host.view().resolved, true);
    assert.equal(host.view().stage, "debrief");
    assert.throws(() => host.propose("restart-pods", ""), /already verified/);
    const res = await post("api/report", { scenarioId: "oom-killed" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).path, "incidents/oom-killed.md");
    assert.match(await readFile(join(root, "incidents/oom-killed.md"), "utf8"), /Approved by:\*\* @mona/);
    assert.match(await readFile(join(root, "incidents/oom-killed.md"), "utf8"), /Verification \(simulation only\)/);
    const progress = await host.progress();
    assert.deepEqual(progress["oom-killed"], { saved: true, passed: true });
    assert.deepEqual(progress["mongodb-down"], { saved: false, passed: false });
});

test("failed verifications are counted on the host, and only a replay reset clears them", async t => {
    const { host, post } = await setup(t);
    const scenario = host.scenarios.find(item => item.id === "oom-killed");
    for (const signal of scenario.evidence.filter(item => item.required)) host.investigate(signal.id);
    host.act({ action: "diagnose", rootCause: "memory-limit-too-low" });
    host.propose("restart-pods", "A restart clears the crash loop.");
    for (const action of [{ action: "review-plan", confirm: true }, { action: "approve", approvedBy: "@mona" }, { action: "apply" }, { action: "verify" }]) host.act(action);
    assert.equal(host.state.runs["oom-killed"].verification, "failed");
    assert.equal(host.state.runs["oom-killed"].failedChecks, 1);
    assert.equal((await post("api/state", { runs: { "oom-killed": { failedChecks: 0 } } })).status, 400, "the score can't be patched directly");
    host.act({ action: "retry" });
    assert.equal(host.state.runs["oom-killed"].failedChecks, 1, "a retry keeps the failure on the scorecard");
    host.act({ action: "reset" });
    assert.deepEqual(host.state.runs["oom-killed"].evidence, []);
    assert.equal(host.state.runs["oom-killed"].failedChecks, 0);
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
