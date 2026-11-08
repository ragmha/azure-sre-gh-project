import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gradeReport, parseReport, renderReport, transitionRun } from "./report.mjs";

const { app, scenarios } = JSON.parse(await readFile(new URL("./scenarios.json", import.meta.url), "utf8"));
const services = new Set(app.tiers.flatMap(tier => tier.services));

const solve = scenario => ({
    evidence: scenario.evidence.filter(item => item.required).map(item => item.id),
    rootCause: scenario.rootCauses.find(item => item.correct).id,
    mitigation: scenario.mitigations.find(item => item.correct).id,
    approvedBy: "@mona",
    verified: true,
});

for (const scenario of scenarios) {
    test(`${scenario.id}: scenario data is consistent`, () => {
        assert.equal(scenario.rootCauses.filter(item => item.correct).length, 1);
        assert.ok(scenario.mitigations.some(item => item.correct));
        assert.ok(scenario.mitigations.some(item => !item.correct), "needs a tempting wrong fix");
        assert.ok(scenario.evidence.some(item => item.required));
        for (const service of Object.keys(scenario.health)) assert.ok(services.has(service), service);
        for (const link of scenario.learn) assert.match(link.url, /^https:\/\/learn\.microsoft\.com\/en-us\//);
    });

    test(`${scenario.id}: the correct path passes and round-trips`, () => {
        const choices = solve(scenario);
        const markdown = renderReport(scenario, choices);
        assert.deepEqual(parseReport(markdown), {
            scenario: scenario.id,
            evidence: choices.evidence,
            rootCause: choices.rootCause,
            mitigation: choices.mitigation,
            approvedBy: choices.approvedBy,
            verification: scenario.mitigations.find(item => item.id === choices.mitigation).outcome,
        });
        const grade = gradeReport(markdown, scenario);
        assert.equal(grade.passed, true, JSON.stringify(grade));
        assert.deepEqual(grade.tips, []);
    });

    test(`${scenario.id}: wrong answers fail with a tip`, () => {
        const choices = solve(scenario);
        const wrongCause = scenario.rootCauses.find(item => !item.correct).id;
        const wrongFix = scenario.mitigations.find(item => !item.correct);
        for (const [change, failing] of [
            [{ rootCause: wrongCause }, "Identified the root cause"],
            [{ mitigation: wrongFix.id }, "Chose a mitigation that fixes the root cause"],
            [{ evidence: [] }, "Collected the key evidence"],
        ]) {
            const grade = gradeReport(renderReport(scenario, { ...choices, ...change }), scenario);
            assert.equal(grade.passed, false);
            assert.ok(grade.results.find(row => row.description.startsWith(failing)).passed === false, failing);
            assert.ok(grade.tips.length > 0);
        }
        assert.throws(() => renderReport(scenario, { ...choices, verified: false }), /Verify the simulated recovery/);
    });
}

test("reports need a GitHub handle as the approver", () => {
    const [scenario] = scenarios;
    assert.throws(() => renderReport(scenario, { ...solve(scenario), approvedBy: "" }), /GitHub handle/);
    assert.match(renderReport(scenario, { ...solve(scenario), approvedBy: "mona" }), /Approved by:\*\* @mona/);
    const unapproved = renderReport(scenario, solve(scenario)).replace("@mona", "pending");
    assert.equal(gradeReport(unapproved, scenario).results.at(-1).passed, false);
    assert.match(gradeReport(unapproved, scenario).tips.join(), /your GitHub handle/);
    assert.throws(() => renderReport(scenario, { ...solve(scenario), verified: false }), /Verify the simulated recovery/);
});

test("a report for another incident doesn't pass", () => {
    const [first, second] = scenarios;
    assert.equal(gradeReport(renderReport(first, solve(first)), second).passed, false);
    assert.equal(gradeReport("", first).passed, false);
});

test("incident actions require investigation, plan review, approval, application and separate verification", () => {
    const scenario = scenarios[0];
    let run = { evidence: [], rootCause: null, proposal: null, reviewedPlan: false, approved: null, applied: null, verification: null };
    const action = (action, extra = {}) => ({ action, ...extra });
    assert.throws(() => transitionRun(scenario, run, action("diagnose", { rootCause: scenario.rootCauses.find(item => item.correct).id })), /required signal/);
    for (const signal of scenario.evidence.filter(item => item.required)) {
        run = transitionRun(scenario, run, action("investigate", { evidenceId: signal.id }));
    }
    const cause = scenario.rootCauses.find(item => item.correct).id;
    run = transitionRun(scenario, run, action("diagnose", { rootCause: cause }));
    assert.throws(() => transitionRun(scenario, run, action("apply")), /approve/);
    const fix = scenario.mitigations.find(item => item.correct);
    run = transitionRun(scenario, run, action("propose", { mitigationId: fix.id, rationale: "Evidence supports this targeted recovery." }));
    assert.throws(() => transitionRun(scenario, run, action("approve", { approvedBy: "@mona" })), /Review the proposed plan/);
    run = transitionRun(scenario, run, action("review-plan", { confirm: true }));
    assert.throws(() => transitionRun(scenario, run, action("approve")), /GitHub handle/);
    run = transitionRun(scenario, run, action("approve", { approvedBy: "@mona" }));
    assert.throws(() => transitionRun(scenario, run, action("verify")), /Apply the approved/);
    run = transitionRun(scenario, run, action("apply"));
    assert.equal(run.verification, null);
    run = transitionRun(scenario, run, action("verify"));
    assert.equal(run.verification, "passed");

    const revised = transitionRun(scenario, run, action("investigate", { evidenceId: scenario.evidence.find(item => !item.required).id }));
    assert.equal(revised.approved, null, "New evidence invalidates the plan and approval.");
    assert.equal(revised.verification, null);
});

test("a wrong mitigation fails simulated verification and requires reapproval", () => {
    const scenario = scenarios[0];
    let run = { evidence: [], rootCause: null, proposal: null, reviewedPlan: false, approved: null, applied: null, verification: null };
    const action = (action, extra = {}) => ({ action, ...extra });
    for (const signal of scenario.evidence.filter(item => item.required)) run = transitionRun(scenario, run, action("investigate", { evidenceId: signal.id }));
    run = transitionRun(scenario, run, action("diagnose", { rootCause: scenario.rootCauses.find(item => item.correct).id }));
    run = transitionRun(scenario, run, action("propose", { mitigationId: scenario.mitigations.find(item => !item.correct).id, rationale: "A tempting but wrong response." }));
    run = transitionRun(scenario, run, action("review-plan", { confirm: true }));
    run = transitionRun(scenario, run, action("approve", { approvedBy: "@mona" }));
    run = transitionRun(scenario, run, action("apply"));
    run = transitionRun(scenario, run, action("verify"));
    assert.equal(run.verification, "failed");
    run = transitionRun(scenario, run, action("retry"));
    assert.equal(run.approved, null);
    assert.equal(run.evidence.length, scenario.evidence.filter(item => item.required).length);
});
