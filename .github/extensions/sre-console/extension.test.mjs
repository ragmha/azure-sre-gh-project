import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createConsoleHost, inputSchema } from "./host.mjs";

class CanvasError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

test("extension wires the canvas, actions and cleanup without an approve action", async t => {
    const sourceUrl = new URL("./extension.mjs", import.meta.url);
    const source = (await readFile(sourceUrl, "utf8"))
        .replace(/^import .+;$/gm, "")
        .replaceAll("import.meta.url", JSON.stringify(sourceUrl.href));
    const signals = new Map();
    const hosts = [];
    let configuration;
    let exited = false;
    const bindings = {
        fileURLToPath,
        inputSchema,
        CanvasError,
        createCanvas: value => value,
        createConsoleHost: async (...args) => {
            const host = await createConsoleHost(...args);
            hosts.push(host);
            return host;
        },
        joinSession: async config => {
            configuration = config;
            return { log: async () => {} };
        },
        process: { once: (name, handler) => signals.set(name, handler), exit: code => (exited = code === 0) },
    };
    t.after(async () => { for (const host of hosts) await host.shutdown(); });
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction(...Object.keys(bindings), source)(...Object.values(bindings));

    const canvas = configuration.canvases[0];
    assert.equal(canvas.id, "sre-console");
    const actions = Object.fromEntries(canvas.actions.map(action => [action.name, action]));
    assert.deepEqual(Object.keys(actions).sort(), ["get_progress", "get_state", "investigate", "propose_mitigation", "select_scenario"]);
    assert.ok(!Object.keys(actions).some(name => /approve/.test(name)));

    const opened = await canvas.open({ instanceId: "sre-1", input: { scenario: "oom-killed" } });
    assert.equal((await fetch(opened.url)).status, 200);
    await assert.rejects(canvas.open({ instanceId: "sre-2", input: { scenario: "nope" } }), error => error.code === "canvas_input_invalid");
    await assert.rejects(actions.investigate.handler({ input: { evidenceId: "nope" } }), error => error.code === "sre_console_invalid");
    const scenario = hosts[0].scenarios.find(item => item.id === "oom-killed");
    for (const signal of scenario.evidence.filter(item => item.required)) hosts[0].investigate(signal.id);
    hosts[0].act({ action: "diagnose", rootCause: "memory-limit-too-low" });
    assert.equal((await actions.investigate.handler({ input: { evidenceId: "pod-inventory" } })).id, "pod-inventory");
    assert.equal((await actions.propose_mitigation.handler({ input: { mitigationId: "scale-out", rationale: "More pods." } })).status, "pending_approval");
    const state = await actions.get_state.handler({});
    assert.equal(state.proposal.by, "copilot");
    assert.equal(state.approved, null);

    await canvas.onClose({ instanceId: "sre-1" });
    await assert.rejects(fetch(opened.url));
    await signals.get("disconnect")();
    assert.equal(exited, true);
});
