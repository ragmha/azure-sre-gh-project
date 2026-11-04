import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gradeReport, parseReport, renderReport } from "./report.mjs";

const { app, scenarios } = JSON.parse(await readFile(new URL("./scenarios.json", import.meta.url), "utf8"));
const services = new Set(app.tiers.flatMap(tier => tier.services));

const solve = scenario => ({
    evidence: scenario.evidence.filter(item => item.required).map(item => item.id),
    rootCause: scenario.rootCauses.find(item => item.correct).id,
    mitigation: scenario.mitigations.find(item => item.correct).id,
    approvedBy: "@mona",
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
        assert.deepEqual(parseReport(markdown), { scenario: scenario.id, ...choices });
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
    });
}

test("reports need a GitHub handle as the approver", () => {
    const [scenario] = scenarios;
    assert.throws(() => renderReport(scenario, { ...solve(scenario), approvedBy: "" }), /GitHub handle/);
    assert.match(renderReport(scenario, { ...solve(scenario), approvedBy: "mona" }), /Approved by:\*\* @mona/);
    const unapproved = renderReport(scenario, solve(scenario)).replace("@mona", "pending");
    assert.equal(gradeReport(unapproved, scenario).results.at(-1).passed, false);
    assert.match(gradeReport(unapproved, scenario).tips.join(), /your GitHub handle/);
});

test("a report for another incident doesn't pass", () => {
    const [first, second] = scenarios;
    assert.equal(gradeReport(renderReport(first, solve(first)), second).passed, false);
    assert.equal(gradeReport("", first).passed, false);
});
