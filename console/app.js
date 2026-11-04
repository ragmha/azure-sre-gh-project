import { HANDLE, mergeState, renderReport } from "../lab/report.mjs";

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const blank = () => ({ evidence: [], rootCause: null, proposal: null, approved: null, notes: "" });
const motion = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

const { app, scenarios } = await fetch("../lab/scenarios.json").then(res => res.json());
const byId = new Map(scenarios.map(item => [item.id, item]));
const hosted = await fetch("../api/state").then(res => (res.ok ? res.json() : null)).catch(() => null);
let state = hosted ?? JSON.parse(localStorage.getItem("sre-console") ?? "null") ?? { scenarioId: scenarios[0].id, approver: "", runs: {} };
let progress = hosted ? await fetch("../api/progress").then(res => res.json()) : {};
let timer;
let pending = null;
let shownProposal = "";

const scenario = () => byId.get(state.scenarioId) ?? scenarios[0];
const run = () => ({ ...blank(), ...state.runs[scenario().id] });
const handle = () => (state.approver.startsWith("@") ? state.approver : `@${state.approver}`);
const resolved = () => Boolean(scenario().mitigations.find(item => item.id === run().approved?.mitigationId)?.correct);

function change(patch) {
    state = mergeState(state, patch);
    render();
    if (!hosted) return localStorage.setItem("sre-console", JSON.stringify(state));
    pending = mergeState(pending ?? {}, patch);
    clearTimeout(timer);
    timer = setTimeout(flush, 100);
}

const setState = patch => change(patch);
const setRun = patch => change({ runs: { [scenario().id]: patch } });

// Send only what changed so agent actions that land meanwhile (like a proposal) aren't overwritten.
async function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const patch = pending;
    pending = null;
    await fetch("../api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
}

function render() {
    const s = scenario();
    const r = run();
    const fixed = resolved();
    document.title = `${s.title} · Azure SRE console`;
    $("#app-name").textContent = `${app.name} · namespace ${app.namespace}`;

    $("#tabs").innerHTML = scenarios.map(item => {
        const p = progress[item.id] ?? {};
        const status = p.passed ? "passed" : p.saved ? "saved" : "";
        const mark = p.passed ? "✓" : p.saved ? "!" : item.step;
        const label = p.passed ? "report passes" : p.saved ? "report saved, not passing yet" : "not started";
        return `<button class="tab ${status}" type="button" data-scenario="${item.id}" aria-current="${item.id === s.id ? "page" : "false"}" title="Step ${item.step}: ${label}">
            <span class="mark">${mark}</span><span><small>Step ${item.step}</small>${esc(item.title)}</span></button>`;
    }).join("");

    $("#alert").className = `alert ${fixed ? "ok" : s.alert.severity.toLowerCase()}`;
    $("#alert").innerHTML = fixed
        ? `<span class="sev">Resolved</span><div><strong>${esc(s.alert.name)}</strong><p>Mitigation approved by ${esc(r.approved.by)}. The alert cleared.</p></div>`
        : `<span class="sev">${esc(s.alert.severity)}</span><div><strong>${esc(s.alert.name)}</strong><p>${esc(s.alert.summary)}</p><small class="muted">${esc(s.alert.source)}</small></div>`;

    $("#topology").innerHTML = app.tiers.map(tier => `<div class="tier"><h3>${esc(tier.label)}</h3>${tier.services.map(service => {
        const health = fixed ? "healthy" : s.health[service] ?? "healthy";
        const deps = app.dependencies[service]?.join(", ");
        return `<div class="svc ${health}" title="${deps ? `Depends on ${esc(deps)}` : "No dependencies"}"><span class="dot"></span><span class="name">${esc(service)}</span><span class="state">${health}</span></div>`;
    }).join("")}</div>`).join("");

    $("#signal-count").textContent = `${r.evidence.length} of ${s.evidence.length} run`;
    $("#signals").innerHTML = s.evidence.map(item => `<button class="signal" type="button" data-evidence="${item.id}" aria-pressed="${r.evidence.includes(item.id)}">
        <span>${esc(item.title)}</span><small>${esc(item.tool)}</small></button>`).join("");
    $("#evidence").innerHTML = s.evidence.filter(item => r.evidence.includes(item.id)).map(item => `<article class="evidence" id="ev-${item.id}">
        <header><strong>${esc(item.title)}</strong><span class="chip">${esc(item.tool)}</span></header>
        <pre class="query"><code>${esc(item.query)}</code></pre><pre class="output">${esc(item.output)}</pre>
        <p class="finding">${esc(item.finding)}</p></article>`).join("");

    const noEvidence = r.evidence.length === 0;
    $("#diagnose-hint").textContent = noEvidence ? "Run at least one signal first." : "Which cause explains every symptom you collected, not just the loudest one?";
    $("#causes").innerHTML = s.rootCauses.map(item => `<label class="option"><input type="radio" name="cause" value="${item.id}" ${item.id === r.rootCause ? "checked" : ""} ${noEvidence ? "disabled" : ""}><span>${esc(item.label)}</span></label>`).join("");

    $("#mitigate-hint").textContent = !r.rootCause ? "Pick a root cause first."
        : fixed ? "Incident mitigated."
        : hosted ? "Propose a fix, or ask Copilot to act as SRE Agent and propose one. Nothing runs until a human approves it."
        : "Propose a fix. In Review mode nothing runs until a human approves it.";
    $("#fixes").innerHTML = s.mitigations.map(item => `<div class="option fix${r.proposal?.mitigationId === item.id ? " proposed" : ""}${r.approved?.mitigationId === item.id ? " applied" : ""}">
        <div><strong>${esc(item.label)}</strong><code>${esc(item.command)}</code><small class="muted">Risk: ${esc(item.risk)}</small></div>
        <button type="button" data-propose="${item.id}" ${!r.rootCause || fixed || r.proposal ? "disabled" : ""}>Propose</button></div>`).join("");

    const proposal = r.proposal && s.mitigations.find(item => item.id === r.proposal.mitigationId);
    $("#proposal").hidden = !proposal;
    if (proposal) {
        $("#proposal-by").textContent = r.proposal.by === "copilot" ? "Proposed by Copilot, acting as SRE Agent" : "Proposed by you";
        $("#proposal-title").textContent = proposal.label;
        $("#proposal-rationale").textContent = r.proposal.rationale;
        $("#proposal-rationale").hidden = !r.proposal.rationale;
        $("#proposal-command").textContent = proposal.command;
        $("#proposal-risk").textContent = `Risk: ${proposal.risk}`;
        const key = `${s.id}:${proposal.id}:${r.proposal.by}`;
        if (key !== shownProposal) $("#proposal").scrollIntoView({ block: "nearest", behavior: motion });
        shownProposal = key;
    }
    if (document.activeElement !== $("#approver")) $("#approver").value = state.approver;
    $("#approve").disabled = !HANDLE.test(handle());

    const applied = s.mitigations.find(item => item.id === r.approved?.mitigationId);
    $("#outcome").hidden = !applied;
    if (applied) {
        $("#outcome").className = `outcome ${fixed ? "ok" : "warn"}`;
        $("#outcome").innerHTML = fixed
            ? `<strong>Mitigated.</strong> ${esc(applied.outcome)} <small class="muted">Approved by ${esc(r.approved.by)}.</small>`
            : `<strong>Applied, but the alert is still firing.</strong> ${esc(applied.outcome)} <button type="button" data-retry>Try another fix</button>`;
    }

    let markdown = "";
    try {
        if (r.approved) markdown = renderReport(s, { evidence: r.evidence, rootCause: r.rootCause, mitigation: r.approved.mitigationId, approvedBy: r.approved.by, notes: r.notes });
    } catch {}
    $("#report-file").textContent = s.id;
    $("#report-hint").textContent = !r.approved ? "Approve a mitigation to write the report."
        : fixed ? `Save it, then commit incidents/${s.id}.md to main. GitHub Actions grades it and opens step ${Math.min(s.step + 1, scenarios.length)}.`
        : "The alert is still firing, so this report won't pass. Try another fix first.";
    $("#preview").textContent = markdown || "Nothing to preview yet.";
    if (document.activeElement !== $("#notes")) $("#notes").value = r.notes;
    $("#save").disabled = !markdown;
    $("#save").textContent = hosted ? "Save to incidents/" : "Download report";

    $("#learn-links").innerHTML = s.learn.map(item => `<li><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></li>`).join("");
    $("#sandbox").textContent = `${s.sandbox.command}   # kubectl apply -f ${s.sandbox.manifest}\nfix-all     # restore the healthy baseline`;
}

async function save() {
    const s = scenario();
    const status = $("#save-status");
    if (!hosted) {
        const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([$("#preview").textContent], { type: "text/markdown" })), download: `${s.id}.md` });
        link.click();
        URL.revokeObjectURL(link.href);
        status.textContent = `Downloaded. Put it in incidents/${s.id}.md and push to main.`;
        return;
    }
    await flush();
    const res = await fetch("../api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenarioId: s.id }) });
    const data = await res.json();
    status.textContent = res.ok ? `Saved ${data.path}. Commit and push it to main, or ask Copilot to.` : data.error;
}

document.addEventListener("click", event => {
    const target = event.target.closest("button");
    if (!target || target.disabled) return;
    const r = run();
    if (target.dataset.scenario) {
        $("#save-status").textContent = "";
        return setState({ scenarioId: target.dataset.scenario });
    }
    if (target.dataset.evidence) {
        const id = target.dataset.evidence;
        if (!r.evidence.includes(id)) setRun({ evidence: [...r.evidence, id] });
        return $(`#ev-${id}`)?.scrollIntoView({ block: "nearest", behavior: motion });
    }
    if (target.dataset.propose) return setRun({ proposal: { mitigationId: target.dataset.propose, rationale: "", by: "learner" } });
    if (target.dataset.retry !== undefined) return setRun({ approved: null });
    if (target.id === "approve") return setRun({ approved: { mitigationId: r.proposal.mitigationId, by: handle() }, proposal: null });
    if (target.id === "deny") return setRun({ proposal: null });
    if (target.id === "save") save().catch(error => ($("#save-status").textContent = error.message));
});
document.addEventListener("change", event => {
    if (event.target.name === "cause") setRun({ rootCause: event.target.value });
});
$("#approver").addEventListener("input", event => setState({ approver: event.target.value.trim() }));
$("#approver").addEventListener("keydown", event => event.key === "Enter" && $("#approve").click());
$("#notes").addEventListener("input", event => setRun({ notes: event.target.value }));

if (hosted) {
    const events = new EventSource("../events");
    events.addEventListener("state", event => {
        const next = JSON.parse(event.data);
        state = pending ? mergeState(next, pending) : next;
        render();
    });
    events.addEventListener("progress", event => {
        progress = JSON.parse(event.data);
        render();
    });
}

const requested = new URLSearchParams(location.search).get("scenario");
if (!hosted && byId.has(requested)) state.scenarioId = requested;
render();
