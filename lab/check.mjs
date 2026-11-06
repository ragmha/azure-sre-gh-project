// Grade incidents/<scenario>.md. Used by the step workflows and runnable locally:
//   node lab/check.mjs oom-killed
import { appendFile, readFile } from "node:fs/promises";
import { gradeReport } from "./report.mjs";

const id = process.argv[2];
const { scenarios } = JSON.parse(await readFile(new URL("./scenarios.json", import.meta.url), "utf8"));
const scenario = scenarios.find(item => item.id === id);
if (!scenario) {
    console.error(`Unknown scenario "${id}". Use one of: ${scenarios.map(item => item.id).join(", ")}`);
    process.exit(2);
}

const file = `incidents/${id}.md`;
const markdown = await readFile(new URL(`../${file}`, import.meta.url), "utf8").catch(() => "");
const grade = gradeReport(markdown, scenario);
const results = [{ description: `Committed \`${file}\``, passed: markdown !== "" }, ...grade.results];
const tips = markdown ? grade.tips : [`Save the report from the SRE console, then commit \`${file}\` to main.`];

for (const row of results) console.log(`${row.passed ? "✅" : "❌"} ${row.description}`);
for (const tip of tips) console.log(`💡 ${tip}`);
if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `vars=${JSON.stringify({ step_number: scenario.step, results_table: results, tips })}\n`);
}
process.exit(results.every(row => row.passed) ? 0 : 1);
