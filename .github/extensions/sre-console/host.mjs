import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { gradeReport, HANDLE, mergeState, renderReport } from "../../../lab/report.mjs";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };
const FILES = ["console/index.html", "console/app.js", "console/styles.css", "lab/scenarios.json", "lab/report.mjs"];
const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

export const inputSchema = {
    type: "object",
    properties: { scenario: { type: "string", description: "Incident to open: oom-killed, mongodb-down or service-mismatch." } },
    additionalProperties: false,
};

export const resolved = (scenario, run) => Boolean(scenario.mitigations.find(item => item.id === run.approved?.mitigationId)?.correct);

export async function createConsoleHost(root) {
    const { scenarios } = JSON.parse(await readFile(join(root, "lab/scenarios.json"), "utf8"));
    const byId = new Map(scenarios.map(item => [item.id, item]));
    const token = randomUUID();
    const instances = new Set();
    const clients = new Set();
    let server;
    let state = sanitize({});

    function sanitize(input) {
        const scenarioId = byId.has(input?.scenarioId) ? input.scenarioId : scenarios[0].id;
        const runs = {};
        for (const scenario of scenarios) {
            const run = input?.runs?.[scenario.id] ?? {};
            const evidence = scenario.evidence.map(item => item.id).filter(id => run.evidence?.includes?.(id));
            const mitigation = id => scenario.mitigations.find(item => item.id === id)?.id;
            const proposal = mitigation(run.proposal?.mitigationId) && {
                mitigationId: run.proposal.mitigationId,
                rationale: text(run.proposal.rationale, 600),
                by: run.proposal.by === "copilot" ? "copilot" : "learner",
            };
            const approved = mitigation(run.approved?.mitigationId) && HANDLE.test(run.approved.by) && {
                mitigationId: run.approved.mitigationId,
                by: run.approved.by,
            };
            runs[scenario.id] = {
                evidence,
                rootCause: scenario.rootCauses.find(item => item.id === run.rootCause)?.id ?? null,
                proposal: proposal || null,
                approved: approved || null,
                notes: text(run.notes, 2000),
            };
        }
        return { scenarioId, approver: text(input?.approver, 40), runs };
    }

    function broadcast(type, data) {
        for (const res of clients) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    function update(next) {
        state = sanitize(next);
        broadcast("state", state);
        return state;
    }

    async function progress() {
        const result = {};
        for (const scenario of scenarios) {
            const markdown = await readFile(join(root, "incidents", `${scenario.id}.md`), "utf8").catch(() => "");
            result[scenario.id] = { saved: markdown !== "", passed: markdown !== "" && gradeReport(markdown, scenario).passed };
        }
        return result;
    }

    async function saveReport(scenarioId) {
        const scenario = byId.get(scenarioId);
        if (!scenario) throw new TypeError(`Unknown scenario "${scenarioId}".`);
        const run = state.runs[scenarioId];
        if (!run.approved) throw new TypeError("Approve a mitigation before saving the report.");
        const markdown = renderReport(scenario, {
            evidence: run.evidence,
            rootCause: run.rootCause,
            mitigation: run.approved.mitigationId,
            approvedBy: run.approved.by,
            notes: run.notes,
        });
        const path = `incidents/${scenario.id}.md`;
        await mkdir(join(root, "incidents"), { recursive: true });
        await writeFile(join(root, path), markdown);
        broadcast("progress", await progress());
        return { path, markdown };
    }

    async function body(req) {
        let raw = "";
        for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 65536) throw new TypeError("Request body is too large.");
        }
        return JSON.parse(raw || "{}");
    }

    function send(res, status, data, type) {
        res.writeHead(status, { "Content-Type": type ?? "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(type ? data : JSON.stringify(data));
    }

    async function route(req, res) {
        const url = new URL(req.url, "http://127.0.0.1");
        const prefix = `/${token}/`;
        if (!url.pathname.startsWith(prefix)) return send(res, 404, { error: "Not found" });
        const path = url.pathname.slice(prefix.length);
        const key = `${req.method} ${path}`;
        if (key === "GET " || key === "GET console/") {
            res.writeHead(302, { Location: `${prefix}console/index.html${url.search}` });
            return res.end();
        }
        if (req.method === "GET" && FILES.includes(path)) {
            const type = TYPES[path.slice(path.lastIndexOf("."))];
            return send(res, 200, await readFile(join(root, path)), type);
        }
        if (key === "GET api/state") return send(res, 200, state);
        if (key === "POST api/state") {
            const patch = await body(req);
            return send(res, 200, update(patch && typeof patch === "object" && !Array.isArray(patch) ? mergeState(state, patch) : state));
        }
        if (key === "GET api/progress") return send(res, 200, await progress());
        if (key === "POST api/report") return send(res, 200, await saveReport((await body(req)).scenarioId));
        if (key === "GET events") {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
            res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
            clients.add(res);
            req.on("close", () => clients.delete(res));
            return;
        }
        send(res, 404, { error: "Not found" });
    }

    async function start() {
        server = createServer((req, res) => route(req, res).catch(error => {
            const status = error instanceof TypeError || error instanceof SyntaxError ? 400 : 500;
            if (status === 500) host.onError?.(error);
            send(res, status, { error: status === 400 ? error.message : "Internal error" });
        }));
        await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
    }

    async function stop() {
        for (const res of clients) res.end();
        clients.clear();
        const closing = server;
        server = undefined;
        if (closing) await new Promise(resolve => closing.close(() => resolve()));
    }

    function view() {
        const scenario = byId.get(state.scenarioId);
        const run = state.runs[scenario.id];
        const fixed = resolved(scenario, run);
        return {
            scenario: { id: scenario.id, step: scenario.step, title: scenario.title, alert: scenario.alert },
            health: fixed ? "All services healthy" : scenario.health,
            signals: scenario.evidence.map(({ id, title, tool }) => ({ id, title, tool, collected: run.evidence.includes(id) })),
            evidence: scenario.evidence.filter(item => run.evidence.includes(item.id)).map(({ id, title, output, finding }) => ({ id, title, output, finding })),
            rootCauses: scenario.rootCauses.map(({ id, label }) => ({ id, label })),
            selectedRootCause: run.rootCause,
            mitigations: scenario.mitigations.map(({ id, label, command, risk }) => ({ id, label, command, risk })),
            proposal: run.proposal,
            approved: run.approved,
            resolved: fixed,
        };
    }

    function select(scenarioId) {
        if (!byId.has(scenarioId)) throw new TypeError(`Unknown scenario "${scenarioId}". Use one of: ${[...byId.keys()].join(", ")}.`);
        update({ ...state, scenarioId });
        return view();
    }

    const host = {
        token,
        scenarios,
        get state() { return state; },
        update,
        progress,
        saveReport,
        view,
        select,
        url() {
            return `http://127.0.0.1:${server.address().port}/${token}/console/index.html`;
        },
        async open(instanceId, input = {}) {
            if (input.scenario !== undefined) select(input.scenario);
            if (!server) await start();
            instances.add(instanceId);
            return host.url();
        },
        async close(instanceId) {
            instances.delete(instanceId);
            if (instances.size === 0) await stop();
        },
        async shutdown() {
            instances.clear();
            await stop();
        },
        investigate(evidenceId) {
            const scenario = byId.get(state.scenarioId);
            const item = scenario.evidence.find(entry => entry.id === evidenceId);
            if (!item) throw new TypeError(`Unknown signal "${evidenceId}". Use one of: ${scenario.evidence.map(entry => entry.id).join(", ")}.`);
            const run = state.runs[scenario.id];
            update({ ...state, runs: { ...state.runs, [scenario.id]: { ...run, evidence: [...run.evidence, item.id] } } });
            const { id, title, tool, query, output, finding } = item;
            return { id, title, tool, query, output, finding };
        },
        propose(mitigationId, rationale) {
            const scenario = byId.get(state.scenarioId);
            const run = state.runs[scenario.id];
            if (!scenario.mitigations.some(item => item.id === mitigationId)) {
                throw new TypeError(`Unknown mitigation "${mitigationId}". Use one of: ${scenario.mitigations.map(item => item.id).join(", ")}.`);
            }
            if (resolved(scenario, run)) throw new TypeError("This incident is already mitigated.");
            update({ ...state, runs: { ...state.runs, [scenario.id]: { ...run, proposal: { mitigationId, rationale, by: "copilot" } } } });
            return { status: "pending_approval", message: "Proposal shown in the SRE console. A human must Approve or Deny it there (Review mode)." };
        },
    };
    return host;
}
