// Shared by the SRE console (browser), the canvas host, and the GitHub Actions grader.
export const HANDLE = /^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const FIELD = /^- \*\*(.+?):\*\* (.*)$/gm;
const ids = value => [...(value ?? "").matchAll(/`([a-z0-9-]+)`/g)].map(match => match[1]);

// Console state patches: top-level fields replace, per-incident run fields merge.
export const mergeState = (state, patch) => ({
    ...state,
    ...patch,
    runs: { ...state.runs, ...Object.fromEntries(Object.entries(patch.runs ?? {}).map(([id, run]) => [id, { ...state.runs?.[id], ...run }])) },
});

const clearPlan = run => ({ ...run, rootCause: null, proposal: null, reviewedPlan: false, approved: null, applied: null, verification: null });
export const requiredEvidenceCollected = (scenario, evidence) =>
    scenario.evidence.filter(item => item.required).every(item => evidence.includes(item.id));

export function transitionRun(scenario, run, action) {
    if (!action || typeof action !== "object") throw new TypeError("Choose a valid incident action.");
    if (action.action === "investigate") {
        const signal = scenario.evidence.find(item => item.id === action.evidenceId);
        if (!signal) throw new TypeError(`Unknown signal "${action.evidenceId}".`);
        if (run.evidence.includes(signal.id)) return run;
        return { ...clearPlan(run), evidence: [...run.evidence, signal.id] };
    }
    if (action.action === "diagnose") {
        if (!requiredEvidenceCollected(scenario, run.evidence)) throw new TypeError("Run every required signal before diagnosing.");
        if (!scenario.rootCauses.some(item => item.id === action.rootCause)) throw new TypeError("Choose a root-cause hypothesis.");
        return action.rootCause === run.rootCause ? run : { ...clearPlan(run), rootCause: action.rootCause };
    }
    if (action.action === "propose") {
        if (!run.rootCause || !requiredEvidenceCollected(scenario, run.evidence)) throw new TypeError("Investigate and choose a root cause before proposing a mitigation.");
        const mitigation = scenario.mitigations.find(item => item.id === action.mitigationId);
        if (!mitigation) throw new TypeError(`Unknown mitigation "${action.mitigationId}".`);
        if (typeof action.rationale !== "string" || action.rationale.length > 600) throw new TypeError("Mitigation rationale must be 600 characters or fewer.");
        return {
            ...run,
            proposal: { mitigationId: mitigation.id, rationale: action.rationale, by: action.by === "copilot" ? "copilot" : "learner" },
            reviewedPlan: false,
            approved: null,
            applied: null,
            verification: null,
        };
    }
    if (action.action === "review-plan") {
        if (!run.proposal) throw new TypeError("Propose a mitigation before reviewing its plan.");
        if (action.confirm !== true) throw new TypeError("Confirm that you reviewed the command, risk and rollback.");
        return { ...run, reviewedPlan: true };
    }
    if (action.action === "approve") {
        if (!run.proposal || !run.reviewedPlan) throw new TypeError("Review the proposed plan before approving it.");
        if (typeof action.approvedBy !== "string") throw new TypeError("The approver must be a GitHub handle, like @mona.");
        const handle = action.approvedBy.startsWith("@") ? action.approvedBy : `@${action.approvedBy}`;
        if (!HANDLE.test(handle)) throw new TypeError("The approver must be a GitHub handle, like @mona.");
        return { ...run, approved: { ...run.proposal, by: handle }, proposal: null, applied: null, verification: null };
    }
    if (action.action === "deny") {
        if (!run.proposal) throw new TypeError("There is no proposed mitigation to deny.");
        return { ...run, proposal: null, reviewedPlan: false, approved: null, applied: null, verification: null };
    }
    if (action.action === "apply") {
        if (!run.approved) throw new TypeError("A human must approve this mitigation first.");
        return { ...run, applied: run.approved.mitigationId, verification: null };
    }
    if (action.action === "verify") {
        if (!run.approved || run.applied !== run.approved.mitigationId) throw new TypeError("Apply the approved mitigation in the simulation first.");
        if (run.verification) return run;
        const mitigation = scenario.mitigations.find(item => item.id === run.applied);
        return mitigation.correct ? { ...run, verification: "passed" } : { ...run, verification: "failed", failedChecks: (run.failedChecks ?? 0) + 1 };
    }
    if (action.action === "retry") {
        if (run.verification !== "failed") throw new TypeError("Retry is available after a failed simulated verification.");
        return { ...run, proposal: null, reviewedPlan: false, approved: null, applied: null, verification: null };
    }
    if (action.action === "reset") {
        return { evidence: [], rootCause: null, proposal: null, reviewedPlan: false, approved: null, applied: null, verification: null, failedChecks: 0, notes: run.notes ?? "" };
    }
    throw new TypeError("Unknown incident action.");
}

export const resolved = (scenario, run) => Boolean(run?.verification === "passed" &&
    run.applied === run.approved?.mitigationId &&
    scenario.mitigations.find(item => item.id === run.approved?.mitigationId)?.correct);

// Game score: 60 for a verified recovery, 40 more for the right root cause, 15 off for each failed verification.
export function roundScore(scenario, run = {}) {
    const failed = run.failedChecks ?? 0;
    if (!resolved(scenario, run)) return { total: 0, stars: 0, diagnosis: 0, failed };
    const diagnosis = scenario.rootCauses.find(item => item.id === run.rootCause)?.correct ? 40 : 0;
    const total = Math.max(10, 60 + diagnosis - 15 * failed);
    return { total, stars: total === 100 ? 3 : total >= 70 ? 2 : 1, diagnosis, failed };
}

export function shiftScore(scenarios, runs = {}) {
    const rounds = scenarios.map(scenario => ({ served: resolved(scenario, runs[scenario.id]), ...roundScore(scenario, runs[scenario.id]) }));
    return {
        rounds,
        total: rounds.reduce((sum, round) => sum + round.total, 0),
        served: scenarios.reduce((sum, scenario, index) => sum + (rounds[index].served ? scenario.shift.customers.length : 0), 0),
        customers: scenarios.reduce((sum, scenario) => sum + scenario.shift.customers.length, 0),
        won: rounds.every(round => round.served),
    };
}

export function renderReport(scenario, { evidence = [], rootCause, mitigation, approvedBy = "", notes = "", verified = false }) {
    const cause = scenario.rootCauses.find(item => item.id === rootCause);
    const fix = scenario.mitigations.find(item => item.id === mitigation);
    if (!cause || !fix) throw new TypeError("Pick a root cause and an approved mitigation first.");
    if (verified !== true) throw new TypeError("Verify the simulated recovery before writing the report.");
    const handle = approvedBy.startsWith("@") ? approvedBy : `@${approvedBy}`;
    if (!HANDLE.test(handle)) throw new TypeError("The approver must be a GitHub handle, like @mona.");
    const found = scenario.evidence.filter(item => evidence.includes(item.id));
    return [
        `# Incident report: ${scenario.title}`,
        "",
        `- **Scenario:** \`${scenario.id}\``,
        `- **Alert:** ${scenario.alert.name} (${scenario.alert.severity})`,
        `- **Evidence:** ${found.map(item => `\`${item.id}\``).join(", ")}`,
        `- **Root cause:** \`${cause.id}\`: ${cause.label}`,
        `- **Mitigation:** \`${fix.id}\`: ${fix.label}`,
        "- **Run mode:** Review",
        `- **Approved by:** ${handle}`,
        `- **Verification (simulation only):** ${fix.outcome}`,
        "",
        "## Mitigation",
        "",
        "```bash",
        fix.command,
        "```",
        "",
        fix.outcome,
        "",
        "## Evidence",
        "",
        ...found.flatMap(item => [`### ${item.title} (${item.tool})`, "", "```", item.query, "```", "", item.finding, ""]),
        "## Lesson",
        "",
        scenario.lesson,
        "",
        ...(notes.trim() ? ["## Notes", "", notes.trim(), ""] : []),
    ].join("\n");
}

export function parseReport(markdown) {
    const fields = {};
    for (const [, key, value] of markdown.matchAll(FIELD)) fields[key.toLowerCase()] ??= value.trim();
    return {
        scenario: ids(fields.scenario)[0],
        evidence: ids(fields.evidence),
        rootCause: ids(fields["root cause"])[0],
        mitigation: ids(fields.mitigation)[0],
        approvedBy: fields["approved by"] ?? "",
        verification: fields["verification (simulation only)"] ?? "",
    };
}

export function gradeReport(markdown, scenario) {
    const report = parseReport(markdown);
    const required = scenario.evidence.filter(item => item.required);
    const missing = required.filter(item => !report.evidence.includes(item.id));
    const cause = scenario.rootCauses.find(item => item.id === report.rootCause);
    const fix = scenario.mitigations.find(item => item.id === report.mitigation);
    const results = [
        { description: `Report is for the \`${scenario.id}\` incident`, passed: report.scenario === scenario.id },
        { description: `Collected the key evidence: ${required.map(item => item.title).join(", ")}`, passed: missing.length === 0 },
        { description: "Identified the root cause", passed: Boolean(cause?.correct) },
        { description: "Chose a mitigation that fixes the root cause", passed: Boolean(fix?.correct) },
        { description: "Verified the simulated recovery outcome", passed: Boolean(fix?.correct && report.verification === fix.outcome) },
        { description: "A human approved the mitigation (Review mode)", passed: HANDLE.test(report.approvedBy) },
    ];
    const tips = [];
    if (missing.length) tips.push(`Run these signals in the SRE console: ${missing.map(item => item.title).join(", ")}.`);
    if (!cause?.correct) tips.push("Pick the root cause that explains every symptom in the evidence, not just the loudest one.");
    if (fix && !fix.correct) tips.push(`\`${fix.id}\` doesn't fix it: ${fix.outcome}`);
    if (!fix) tips.push("Propose a mitigation and approve it before saving the report.");
    if (fix?.correct && report.verification !== fix.outcome) tips.push("Run simulated verification after applying the approved mitigation, then save the report again.");
    if (!HANDLE.test(report.approvedBy)) tips.push("Approve the mitigation yourself in the console. `Approved by` must be your GitHub handle, like @mona, not Copilot.");
    return { passed: results.every(item => item.passed), results, tips };
}
