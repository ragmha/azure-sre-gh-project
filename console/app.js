import { HANDLE, gradeReport, mergeState, renderReport, requiredEvidenceCollected, resolved, roundScore, shiftScore, transitionRun } from "../lab/report.mjs";

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const blank = () => ({ evidence: [], rootCause: null, proposal: null, reviewedPlan: false, approved: null, applied: null, verification: null, failedChecks: 0, notes: "" });
const motion = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
const stars = count => "★".repeat(count) + "☆".repeat(3 - count);
// Only touch the DOM when markup changes, so focus, live regions and one-shot animations aren't reset on every render.
const shown = new WeakMap();
const setHTML = (element, html) => {
    if (shown.get(element) === html) return;
    shown.set(element, html);
    element.innerHTML = html;
};

const { app, scenarios } = await fetch("../lab/scenarios.json").then(res => res.json());
const byId = new Map(scenarios.map(item => [item.id, item]));
const hosted = await fetch("../api/state").then(res => (res.ok ? res.json() : null)).catch(() => null);
let state = hosted ?? JSON.parse(localStorage.getItem("sre-console") ?? "null") ?? { scenarioId: scenarios[0].id, approver: "", runs: {} };
let progress = hosted ? await fetch("../api/progress").then(res => res.json()) : JSON.parse(localStorage.getItem("sre-progress") ?? "{}");
let timer;
let pending = null;
let stateEvents = 0;
let shownProposal = "";
let shownCoachPrompt = "";
let started = false;
let wasWon = null;

const scenario = () => byId.get(state.scenarioId) ?? scenarios[0];
const run = id => ({ ...blank(), ...state.runs[id ?? scenario().id] });
const handle = () => (state.approver.startsWith("@") ? state.approver : `@${state.approver}`);
const phaseNames = ["Investigate", "Review plan", "Approve & apply", "Verify", "Debrief"];

// The shop scene: each service is a station, each incident brings three customers. Everything drawn comes from game state.
const STATIONS = {
    "store-front": "Shop counter", "store-admin": "Back office", "order-service": "Till", "product-service": "Shelf catalogue",
    rabbitmq: "Order belt", "makeline-service": "Packing bench", mongodb: "Stockroom",
};
const EARS = {
    cat: '<path d="M-14-42-10-58-3-45ZM14-42 10-58 3-45Z"/>',
    dog: '<ellipse cx="-16" cy="-33" rx="6" ry="12"/><ellipse cx="16" cy="-33" rx="6" ry="12"/>',
    rabbit: '<ellipse cx="-7" cy="-56" rx="5" ry="14"/><ellipse cx="7" cy="-56" rx="5" ry="14"/>',
};
const FACES = {
    waiting: "M-5-25H5",
    failed: "M-6-22Q0-28 6-22M-10-41-3-38M10-41 3-38",
    served: "M-6-26Q0-20 6-26",
};

function renderScene(s, r) {
    const mood = resolved(s, r) ? "served" : r.verification === "failed" ? "failed" : "waiting";
    const line = mood === "served" ? s.shift.served : mood === "failed" ? "That change didn't help. We're still waiting." : s.shift.waiting;
    $("#round-heading").textContent = `Incident ${s.step} of ${scenarios.length}: ${s.shift.round}`;
    $("#scene").className = `shop ${mood}`;
    setHTML($("#scene"), `<div class="queue"><p class="bubble">“${esc(line)}”</p>
        <ul class="customers" aria-label="${mood === "served" ? "Customers served" : "Customers waiting"}">${s.shift.customers.map(customer => `<li>
            <svg viewBox="-34 -76 68 104" aria-hidden="true" class="pet ${esc(customer.pet)}"><g class="fur">${EARS[customer.pet] ?? ""}<ellipse rx="22" ry="26"/><circle cy="-32" r="15"/></g>
            <circle cx="-5" cy="-34" r="2" class="eye"/><circle cx="5" cy="-34" r="2" class="eye"/><path d="${FACES[mood]}" class="face"/>
            ${mood === "served" ? '<rect x="12" y="-2" width="16" height="20" rx="3" class="bag"/>' : ""}</svg>
            <span>${esc(customer.want)}</span></li>`).join("")}</ul></div>
        <div class="floor">${app.tiers.map(tier => `<div class="tier"><h3>${esc(tier.label)}</h3>${tier.services.map(service => {
        const health = mood === "served" ? "healthy" : s.health[service] ?? "healthy";
        const deps = app.dependencies[service]?.join(", ");
        return `<div class="station ${health}${mood === "served" && s.health[service] ? " recovered" : ""}" title="${deps ? `Depends on ${esc(deps)}` : "No dependencies"}">
            <strong>${esc(STATIONS[service] ?? service)}</strong><code>${esc(service)}</code><span class="state">${health}</span></div>`;
    }).join("")}</div>`).join("")}</div>`);
}

function phase(s, r) {
    if (!requiredEvidenceCollected(s, r.evidence)) return 0;
    if (!r.rootCause || (!r.proposal && !r.approved) || (r.proposal && !r.reviewedPlan)) return 1;
    if (!r.approved || !r.applied) return 2;
    if (!r.verification || r.verification === "failed") return 3;
    return 4;
}

function coachPrompt(s, r) {
    switch (phase(s, r)) {
        case 0: return `Help me investigate “${s.title}” in the SRE console. Suggest the next useful signal, explain what its output does and does not prove, and wait for evidence before naming a cause. Do not run any real Azure or AKS command.`;
        case 1: return `Coach my diagnosis for “${s.title}”. Challenge the selected cause against the collected signals, then review the proposed command, risk and expected outcome. Do not approve or apply it.`;
        case 2: return `The proposed “${s.title}” plan has been reviewed. Explain its blast radius and rollback. Wait for my explicit approval; this console applies only simulated outcomes and must not run Azure or AKS commands.`;
        case 3: return `Help me verify the simulated “${s.title}” recovery against the expected evidence. Distinguish a recorded simulation result from live Azure telemetry.`;
        default: return `Help me debrief “${s.title}”: summarize impact, evidence, cause, approved change, simulated verification, and remaining uncertainty. Do not claim a live Azure recovery.`;
    }
}

function change(patch) {
    state = mergeState(state, patch);
    render();
    if (!hosted) return localStorage.setItem("sre-console", JSON.stringify(state));
    pending = mergeState(pending ?? {}, patch);
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(error => { $("#save-status").textContent = error.message; }), 100);
}

const setState = patch => change(patch);
const setRun = patch => change({ runs: { [scenario().id]: patch } });

async function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const patch = pending;
    pending = null;
    const response = await fetch("../api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!response.ok) {
        pending = mergeState(patch, pending ?? {});
        throw new Error((await response.json()).error ?? "Could not save incident notes.");
    }
}

async function act(action) {
    const s = byId.get(action.scenarioId) ?? scenario();
    if (hosted) {
        await flush();
        const seen = stateEvents;
        const response = await fetch("../api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenarioId: s.id, ...action }) });
        const next = await response.json();
        if (!response.ok) throw new Error(next.error);
        // The host broadcasts every update. If an event arrived mid-request, let the stream win:
        // this response may be older and would hide newer state, such as a Copilot proposal.
        if (seen === stateEvents) state = next;
    } else {
        const updated = transitionRun(s, run(s.id), action);
        state = mergeState(state, { runs: { [s.id]: updated } });
        localStorage.setItem("sre-console", JSON.stringify(state));
    }
    render();
}

// Replay starts a clean shift. Saved incidents/*.md reports are files, so they stay.
async function replay() {
    started = true;
    for (const item of scenarios) await act({ scenarioId: item.id, action: "reset" });
    setState({ scenarioId: scenarios[0].id });
    $("#round-heading").focus();
}

function render() {
    const s = scenario();
    const r = run();
    const fixed = resolved(s, r);
    const activePhase = phase(s, r);
    const resolvedCount = scenarios.filter(item => resolved(item, run(item.id))).length;
    const savedCount = scenarios.filter(item => progress[item.id]?.saved).length;
    const passedCount = scenarios.filter(item => progress[item.id]?.passed).length;
    const shift = shiftScore(scenarios, state.runs);
    document.title = `${s.title} · Azure SRE console`;
    $("#app-name").textContent = `${app.name} · namespace ${app.namespace}`;
    $("#shift-summary").textContent = `${resolvedCount}/${scenarios.length} recoveries verified in simulation · ${passedCount}/${scenarios.length} debriefs pass the shared report checks`;
    $("#shift-score").innerHTML = `Score <strong>${shift.total}</strong> · ${shift.served}/${shift.customers} customers served`;
    $("#shift-progress").value = passedCount;
    $("#queue-status").textContent = `${resolvedCount} recoveries verified · ${passedCount} debriefs pass · ${savedCount} saved`;

    $("#tabs").innerHTML = scenarios.map(item => {
        const p = progress[item.id] ?? {};
        const itemRun = run(item.id);
        // A replayed incident shows its live progress; a saved report's status shows once it's verified again or not yet replayed.
        const live = itemRun.evidence.length > 0 && !resolved(item, itemRun);
        const status = !live && p.passed ? "Report checks passed" : !live && p.saved ? "Debrief needs revision" : resolved(item, itemRun) ? "Verified · simulated"
            : itemRun.verification === "failed" ? "Verification failed" : itemRun.applied ? "Ready to verify"
                : itemRun.approved ? "Approved · not applied" : itemRun.proposal ? "Plan for review"
                    : itemRun.rootCause ? "Diagnosis selected" : itemRun.evidence.length ? "Investigating" : "Queued";
        const mark = p.passed || resolved(item, itemRun) ? "✓" : item.step;
        const label = !live && p.passed ? "report checks passed" : !live && p.saved ? "debrief needs revision" : status;
        return `<button class="tab ${p.passed ? "passed" : p.saved ? "saved" : ""}" type="button" data-scenario="${item.id}" aria-current="${item.id === s.id ? "page" : "false"}" title="Step ${item.step}: ${esc(label)}">
            <span class="mark">${mark}</span><span><small>${esc(status)}</small>${esc(item.title)}</span></button>`;
    }).join("");

    const complete = passedCount === scenarios.length;
    $("#shift-win").hidden = !complete && !shift.won;
    setHTML($("#shift-win"), !complete && !shift.won ? "" : `<div><strong>Shift complete${shift.won ? ` · ${shift.total} of ${scenarios.length * 100} points` : ""}</strong>
        ${shift.won ? `<ol class="results">${scenarios.map((item, index) => {
        const round = shift.rounds[index];
        const report = progress[item.id]?.passed ? "debrief passes" : progress[item.id]?.saved ? "debrief needs revision" : "debrief not saved";
        return `<li><span aria-hidden="true">${stars(round.stars)}</span><span class="visually-hidden">${round.stars} of 3 stars</span> <strong>${round.total}</strong> ${esc(item.shift.round)} · root cause ${round.diagnosis ? "right" : "missed"} · ${round.failed} failed verification${round.failed === 1 ? "" : "s"} · ${report}</li>`;
    }).join("")}</ol>` : ""}
        <p>${complete ? `All ${scenarios.length} incident debriefs pass the shared report checks used by GitHub Actions.` : "Save each debrief to finish the exercise."} No AKS resource was changed.</p></div>
        ${shift.won ? '<button id="replay" type="button">Replay shift</button>' : ""}`);
    if (wasWon === false && shift.won) $("#shift-win").scrollIntoView({ block: "nearest", behavior: motion });
    wasWon = shift.won;
    $("#intro").hidden = started || scenarios.some(item => run(item.id).evidence.length > 0);
    renderScene(s, r);

    $("#stage-track").innerHTML = phaseNames.map((name, index) => {
        const completeStage = index === 0 ? requiredEvidenceCollected(s, r.evidence)
            : index === 1 ? Boolean(r.reviewedPlan)
                : index === 2 ? Boolean(r.applied)
                    : index === 3 ? r.verification === "passed"
                        : Boolean(progress[s.id]?.passed);
        const failed = index === 3 && r.verification === "failed";
        return `<li class="${completeStage ? "complete" : failed ? "failed" : ""}"${!completeStage && index === activePhase ? ' aria-current="step"' : ""}><span>${index + 1}</span>${name}${failed ? " · failed" : ""}</li>`;
    }).join("");
    const prompt = coachPrompt(s, r);
    if (prompt !== shownCoachPrompt) {
        $("#coach-status").textContent = "";
        shownCoachPrompt = prompt;
    }
    $("#coach-prompt").textContent = prompt;

    $("#alert").className = `alert ${fixed ? "ok" : s.alert.severity.toLowerCase()}`;
    $("#alert").innerHTML = fixed
        ? `<span class="sev">Resolved · simulation</span><div><strong>${esc(s.alert.name)}</strong><p>${esc(s.mitigations.find(item => item.id === r.applied).outcome)}</p><small class="muted">Recorded, not live Azure telemetry.</small></div>`
        : `<span class="sev">${esc(s.alert.severity)}</span><div><strong>${esc(s.alert.name)}</strong><p>${esc(s.alert.summary)}</p><small class="muted">${esc(s.alert.source)}</small></div>`;

    const requiredReady = requiredEvidenceCollected(s, r.evidence);
    $("#signal-count").textContent = `${r.evidence.length} of ${s.evidence.length} revealed · ${s.evidence.filter(item => item.required && r.evidence.includes(item.id)).length}/${s.evidence.filter(item => item.required).length} required`;
    $("#investigate-hint").textContent = requiredReady ? "Required seeded signals collected. Ask Copilot to challenge what the evidence supports." : "Reveal signal samples. Collect every required sample before diagnosing.";
    // A verified incident with a passing report is locked; a replayed one is playable again.
    const reportPassed = fixed && Boolean(progress[s.id]?.passed);
    $("#signals").innerHTML = s.evidence.map(item => `<button class="signal" type="button" data-evidence="${item.id}" aria-pressed="${r.evidence.includes(item.id)}" ${reportPassed ? "disabled" : ""}>
        <span>${esc(item.title)}</span><small>${esc(item.tool)}</small></button>`).join("");
    $("#evidence").innerHTML = s.evidence.filter(item => r.evidence.includes(item.id)).map(item => `<article class="evidence" id="ev-${item.id}">
        <header><strong>${esc(item.title)}</strong><span class="chip">${esc(item.tool)}</span></header>
        <pre class="query"><code>${esc(item.query)}</code></pre><pre class="output">${esc(item.output)}</pre>
        <p class="finding">${esc(item.finding)}</p></article>`).join("");

    $("#diagnose-hint").textContent = !requiredReady ? "Collect the required signals before choosing a hypothesis."
        : !r.rootCause ? "Which cause explains every symptom you collected, not just the loudest one?"
            : "Revising your diagnosis clears the proposal and any downstream approval.";
    $("#causes").innerHTML = s.rootCauses.map(item => `<label class="option"><input type="radio" name="cause" value="${item.id}" ${item.id === r.rootCause ? "checked" : ""} ${!requiredReady || reportPassed ? "disabled" : ""}><span>${esc(item.label)}</span></label>`).join("");

    $("#mitigate-hint").textContent = !requiredReady ? "Investigate all required signals first."
        : !r.rootCause ? "Select an evidence-backed root cause first."
            : fixed ? "Verified in simulation."
                : r.approved ? "Your approved plan is recorded. Apply it in the simulation, then verify separately."
                    : hosted ? "Choose a candidate or ask Copilot to propose one. Review the command, risks and expected outcome before approving."
                        : "Choose a candidate. The displayed command is never run by this preview.";
    $("#fixes").innerHTML = s.mitigations.map(item => `<div class="option fix${r.proposal?.mitigationId === item.id ? " proposed" : ""}${r.applied === item.id ? r.verification === "failed" ? " failed" : " applied" : ""}">
        <div><strong>${esc(item.label)}</strong><code>${esc(item.command)}</code><small class="muted">Risk: ${esc(item.risk)}</small></div>
        <button type="button" data-propose="${item.id}" ${!r.rootCause || reportPassed || r.proposal || r.approved ? "disabled" : ""}>Choose</button></div>`).join("");

    const proposal = r.proposal && s.mitigations.find(item => item.id === r.proposal.mitigationId);
    $("#proposal").hidden = !proposal;
    if (proposal) {
        $("#proposal-status").textContent = r.reviewedPlan ? "Reviewed · awaiting your approval" : "Plan awaiting your review";
        $("#proposal-by").textContent = r.proposal.by === "copilot" ? "Proposed by Copilot, acting as SRE Agent" : "Proposed by you";
        $("#proposal-title").textContent = proposal.label;
        $("#proposal-rationale").textContent = r.proposal.rationale || "Review whether this change explains the observed failure.";
        $("#proposal-command").textContent = proposal.command;
        $("#proposal-risk").textContent = `Risk: ${proposal.risk}`;
        $("#proposal-outcome").textContent = `Expected outcome (simulation): ${proposal.outcome}`;
        $("#review-plan").checked = r.reviewedPlan;
        $("#approve").disabled = !r.reviewedPlan || !HANDLE.test(handle());
        const key = `${s.id}:${proposal.id}:${r.proposal.by}`;
        if (key !== shownProposal) $("#proposal").scrollIntoView({ block: "nearest", behavior: motion });
        shownProposal = key;
    } else {
        $("#review-plan").checked = false;
        $("#approve").disabled = true;
    }
    if (document.activeElement !== $("#approver")) $("#approver").value = state.approver;
    $("#apply-panel").hidden = !r.approved || Boolean(r.applied);
    $("#apply").disabled = !r.approved || Boolean(r.applied);
    $("#outcome").hidden = !r.applied;
    if (r.applied) {
        const applied = s.mitigations.find(item => item.id === r.applied);
        $("#outcome").className = `outcome ${r.verification === "passed" ? "ok" : r.verification === "failed" ? "warn" : ""}`;
        $("#outcome").innerHTML = `<strong>Applied in simulation.</strong> ${esc(applied.outcome)} <small class="muted">No AKS command was run.</small>`;
    }
    $("#verify-hint").textContent = !r.applied ? "Apply the learner-approved plan in simulation first."
        : r.verification === "passed" ? "The expected simulation result passed. It is not a live health probe."
            : r.verification === "failed" ? "This mitigation did not restore the expected state. Review the evidence and try a different plan."
                : `Compare the expected signal: ${s.mitigations.find(item => item.id === r.applied).outcome}`;
    $("#verify").disabled = !r.applied || Boolean(r.verification);
    $("#verification").hidden = !r.verification;
    if (r.verification) {
        const applied = s.mitigations.find(item => item.id === r.applied);
        const score = roundScore(s, r);
        const scoreLine = r.verification === "passed"
            ? `<p class="round-score"><span aria-hidden="true">${stars(score.stars)}</span><span class="visually-hidden">${score.stars} of 3 stars</span> <strong>${score.total} points</strong>: recovery +60, root cause +${score.diagnosis}, failed verifications −${15 * score.failed}.</p>`
            : `<p class="round-score"><strong>−15 points.</strong> The customers are still waiting.</p>`;
        $("#verification").className = `verification ${r.verification === "passed" ? "ok" : "warn"}`;
        setHTML($("#verification"), `<strong>${r.verification === "passed" ? "Verification passed · simulation" : "Verification failed · simulation"}</strong><p>${esc(applied.outcome)}</p>${scoreLine}${r.verification === "failed" ? '<button type="button" data-retry>Review another mitigation</button>' : '<small>No Azure telemetry was queried.</small>'}`);
    }

    let markdown = "";
    try {
        if (fixed) markdown = renderReport(s, {
            evidence: r.evidence, rootCause: r.rootCause, mitigation: r.approved.mitigationId,
            approvedBy: r.approved.by, notes: r.notes, verified: true,
        });
    } catch (error) { $("#save-status").textContent = error.message; }
    $("#report-file").textContent = s.id;
    $("#report-hint").textContent = !fixed ? "Verify a successful simulated recovery before writing the debrief."
        : progress[s.id]?.passed ? `The shared report checks pass. Commit incidents/${s.id}.md to main for GitHub Actions to record the step.`
            : progress[s.id]?.saved ? "The latest debrief needs revision. Revisit your evidence and diagnosis, then save again."
                : `Compare the evidence with the simulated result, add your debrief note, then save incidents/${s.id}.md.`;
    $("#preview").textContent = markdown || "Complete verification before a report is available.";
    if (document.activeElement !== $("#notes")) $("#notes").value = r.notes;
    $("#save").disabled = !markdown;
    $("#save").textContent = hosted ? "Save debrief to incidents/" : "Download debrief";
    const upcoming = scenarios.find(item => item.id !== s.id && !resolved(item, run(item.id)));
    setHTML($("#next-round"), fixed && upcoming ? `<button type="button" data-scenario="${upcoming.id}">Next incident: ${esc(upcoming.title)}</button>` : "");

    $("#learn-links").innerHTML = s.learn.map(item => `<li><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a></li>`).join("");
}

async function save() {
    const s = scenario();
    const status = $("#save-status");
    if (!hosted) {
        const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([$("#preview").textContent], { type: "text/markdown" })), download: `${s.id}.md` });
        link.click();
        URL.revokeObjectURL(link.href);
        progress[s.id] = { saved: true, passed: gradeReport($("#preview").textContent, s).passed };
        localStorage.setItem("sre-progress", JSON.stringify(progress));
        status.textContent = `Downloaded. Put it in incidents/${s.id}.md and push to main for GitHub grading.`;
        render();
        return;
    }
    await flush();
    const res = await fetch("../api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenarioId: s.id }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    progress = await fetch("../api/progress").then(response => response.json());
    status.textContent = `Saved ${data.path}. Commit it to main; GitHub Actions grades the report.`;
    render();
}

document.addEventListener("click", async event => {
    const target = event.target.closest("button");
    if (!target || target.disabled) return;
    try {
        if (target.dataset.scenario) {
            $("#save-status").textContent = "";
            setState({ scenarioId: target.dataset.scenario });
            return $("#round-heading").focus();
        }
        if (target.id === "start") {
            started = true;
            render();
            return $("#round-heading").focus();
        }
        if (target.id === "replay") return await replay();
        if (target.dataset.evidence) {
            await act({ action: "investigate", evidenceId: target.dataset.evidence });
            return $(`#ev-${target.dataset.evidence}`)?.scrollIntoView({ block: "nearest", behavior: motion });
        }
        if (target.dataset.propose) return await act({ action: "propose", mitigationId: target.dataset.propose, rationale: "" });
        if (target.dataset.retry !== undefined) return await act({ action: "retry" });
        if (target.id === "approve") return await act({ action: "approve", approvedBy: handle() });
        if (target.id === "deny") return await act({ action: "deny" });
        if (target.id === "apply") return await act({ action: "apply" });
        if (target.id === "verify") return await act({ action: "verify" });
        if (target.id === "copy-coach") {
            await navigator.clipboard.writeText($("#coach-prompt").textContent);
            $("#coach-status").textContent = "Prompt copied. Paste it in Copilot chat.";
            return;
        }
        if (target.id === "save") await save();
    } catch (error) {
        $("#save-status").textContent = error.message;
    }
});
document.addEventListener("change", async event => {
    try {
        if (event.target.name === "cause") return await act({ action: "diagnose", rootCause: event.target.value });
        if (event.target.id === "review-plan") return await act({ action: "review-plan", confirm: event.target.checked });
    } catch (error) {
        $("#save-status").textContent = error.message;
    }
});
$("#approver").addEventListener("input", event => setState({ approver: event.target.value.trim() }));
$("#approver").addEventListener("keydown", event => event.key === "Enter" && $("#approve").click());
$("#notes").addEventListener("input", event => setRun({ notes: event.target.value }));

if (hosted) {
    const events = new EventSource("../events");
    events.addEventListener("state", event => {
        stateEvents += 1;
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
