import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { createConsoleHost, inputSchema } from "./host.mjs";

const host = await createConsoleHost(fileURLToPath(new URL("../../../", import.meta.url)));
const scenarioIds = host.scenarios.map(item => item.id);
const guard = fn => async ctx => {
    try {
        return await fn(ctx.input ?? {});
    } catch (error) {
        if (error instanceof TypeError) throw new CanvasError("sre_console_invalid", error.message);
        throw error;
    }
};

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "sre-console",
            displayName: "Azure SRE console",
            description: "A simulation-only incident-response game for an AKS pets store. GitHub Copilot coaches the learner; it is not the Azure SRE Agent service or live telemetry.",
            inputSchema,
            actions: [
                {
                    name: "get_state",
                    description: "Read the open incident: alert, service health, signals collected so far, the selected root cause, and any pending or approved mitigation.",
                    handler: guard(() => host.view()),
                },
                {
                    name: "select_scenario",
                    description: "Switch the console to another incident.",
                    inputSchema: { type: "object", properties: { scenarioId: { type: "string", enum: scenarioIds } }, required: ["scenarioId"], additionalProperties: false },
                    handler: guard(input => host.select(input.scenarioId)),
                },
                {
                    name: "investigate",
                    description: "Reveal one seeded KQL or kubectl evidence sample for the simulated AKS incident. It is not a live query and does not invoke Azure SRE Agent.",
                    inputSchema: { type: "object", properties: { evidenceId: { type: "string" } }, required: ["evidenceId"], additionalProperties: false },
                    handler: guard(input => host.investigate(input.evidenceId)),
                },
                {
                    name: "propose_mitigation",
                    description: "Propose a mitigation in Review mode. It shows as pending in the console; only the human can Approve or Deny it. There is no approve action.",
                    inputSchema: {
                        type: "object",
                        properties: { mitigationId: { type: "string" }, rationale: { type: "string", maxLength: 600 } },
                        required: ["mitigationId", "rationale"],
                        additionalProperties: false,
                    },
                    handler: guard(input => host.propose(input.mitigationId, input.rationale)),
                },
                {
                    name: "get_progress",
                    description: "Check which incident reports are saved in incidents/ and whether they pass the shared local report checks.",
                    handler: guard(() => host.progress()),
                },
            ],
            open: async ctx => {
                try {
                    return { title: "Azure SRE console", url: await host.open(ctx.instanceId, ctx.input ?? {}) };
                } catch (error) {
                    if (error instanceof TypeError) throw new CanvasError("canvas_input_invalid", error.message);
                    await session.log(`SRE console could not open: ${error.message}`, { level: "error" });
                    throw new CanvasError("sre_console_failed", "Could not start the SRE console loopback server.");
                }
            },
            onClose: ctx => host.close(ctx.instanceId),
        }),
    ],
});

host.onError = error => session.log(`SRE console: ${error.message}`, { level: "error" });
async function shutdown() {
    await host.shutdown().catch(() => {});
    process.exit(0);
}
// Chat completion is not provider exit: open canvases must stay usable between turns.
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
process.once("disconnect", shutdown);
