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

export function renderReport(scenario, { evidence = [], rootCause, mitigation, approvedBy = "", notes = "" }) {
    const cause = scenario.rootCauses.find(item => item.id === rootCause);
    const fix = scenario.mitigations.find(item => item.id === mitigation);
    if (!cause || !fix) throw new TypeError("Pick a root cause and an approved mitigation first.");
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
        { description: "A human approved the mitigation (Review mode)", passed: HANDLE.test(report.approvedBy) },
    ];
    const tips = [];
    if (missing.length) tips.push(`Run these signals in the SRE console: ${missing.map(item => item.title).join(", ")}.`);
    if (!cause?.correct) tips.push("Pick the root cause that explains every symptom in the evidence, not just the loudest one.");
    if (fix && !fix.correct) tips.push(`\`${fix.id}\` doesn't fix it: ${fix.outcome}`);
    if (!fix) tips.push("Propose a mitigation and approve it before saving the report.");
    if (!HANDLE.test(report.approvedBy)) tips.push("Approve the mitigation yourself in the console. `Approved by` must be your GitHub handle, like @mona, not Copilot.");
    return { passed: results.every(item => item.passed), results, tips };
}
