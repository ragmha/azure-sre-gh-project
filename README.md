# Azure SRE with GitHub Copilot

_Work three AKS incidents with GitHub Copilot as your SRE agent, inside a live console canvas, and approve every fix yourself._

## Welcome

- **Who is this for**: Developers, SREs, and platform engineers who want to see how an AI SRE agent investigates incidents, and how to keep a human in charge of what it changes.
- **What you'll learn**: How [Azure SRE Agent](https://learn.microsoft.com/en-us/azure/sre-agent/overview) correlates Azure Monitor signals into a root cause, and how its [Review run mode](https://learn.microsoft.com/en-us/azure/sre-agent/run-modes) keeps a human approval gate in front of every fix.
- **What you'll build**: Three post-incident reports in `incidents/`, graded by GitHub Actions.
- **Prerequisites**:
  - The GitHub Copilot app, so the console can open as a canvas. A browser works too.
  - Basic Kubernetes vocabulary: pods, deployments, and services.
  - No Azure subscription is needed. An optional [Azure lab](docs/azure-lab.md) lets you break a real cluster afterwards.

- **How long**: This exercise takes less than 45 minutes to complete.

In this exercise, you will:

1. Open the **Azure SRE console** canvas and diagnose an `OOMKilled` crash loop.
1. Trace a dependency chain to find out why orders are never fulfilled.
1. Find out why orders fail while every pod reports healthy.
1. For each incident, have Copilot propose a mitigation, then approve or deny it yourself.

<img alt="The Mitigate card in the Azure SRE console. Copilot, acting as SRE Agent, proposes raising the order-service memory limit, and the fix waits for a human to approve or deny it." src=".github/images/sre-console.png" width="720" />

### How to start this exercise

Simply copy the exercise to your account, then give your favorite Octocat (Mona) **about 20 seconds** to prepare the first lesson, then **refresh the page**.

[![](https://img.shields.io/badge/Copy%20Exercise-%E2%86%92-1f883d?style=for-the-badge&logo=github&labelColor=197935)](https://github.com/new?template_owner=ragmha&template_name=azure-sre-gh-project&owner=%40me&name=skills-azure-sre-with-copilot&description=Exercise:+Azure+SRE+with+GitHub+Copilot&visibility=public)

<details>
<summary>Having trouble? 🤷</summary><br/>

When copying the exercise, we recommend the following settings:

- For owner, choose your personal account or an organization to host the repository.

- We recommend creating a public repository, since private repositories will use Actions minutes.

If the exercise isn't ready in 20 seconds, please check the [Actions](../../actions) tab.

- Check to see if a job is running. Sometimes it simply takes a bit longer.

- If the page shows a failed job, please submit an issue. Nice, you found a bug! 🐛

</details>

## How it works

| Piece | Where | What it does |
| --- | --- | --- |
| Scenarios | `lab/scenarios.json` | The incidents: alert, service health, signals, root causes, and mitigations. Everything else reads this file. |
| Console | `console/` | The incident UI: investigate, diagnose, mitigate, review, and report. |
| Canvas extension | `.github/extensions/sre-console/` | Opens the console as a Copilot canvas and gives Copilot the `get_state`, `select_scenario`, `investigate`, `propose_mitigation`, and `get_progress` actions. It has no approve action. |
| Grader | `lab/check.mjs` | Checks `incidents/<scenario>.md`. The step workflows run it and post the results to the exercise issue. |

The console runs in **Review** mode. Copilot can investigate and propose, but only the learner can approve. That gate is a teaching device, not a security boundary. [`.github/copilot-instructions.md`](.github/copilot-instructions.md) tells Copilot never to approve on the learner's behalf.

### Run the console without the Copilot app

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/console/`. Progress stays in your browser, and **Download report** replaces **Save to incidents/**.

### Develop

Node 22 or later:

```bash
node --test 'lab/*.test.mjs' '.github/extensions/sre-console/*.test.mjs'
node lab/check.mjs oom-killed   # grade a report locally
```

To change an incident, edit `lab/scenarios.json`. The tests check that every scenario has required evidence, exactly one correct root cause, at least one correct mitigation plus a tempting wrong one, and Microsoft Learn links. After editing the extension in the Copilot app, run `extensions_reload`.

## Credits

The incidents and the pets store come from [matthansen0/azure-sre-agent-sandbox](https://github.com/matthansen0/azure-sre-agent-sandbox) (MIT). The canvas pattern follows [crazy4pi314/mos-diner-game](https://github.com/crazy4pi314/mos-diner-game). The exercise structure follows [skills/exercise-template](https://github.com/skills/exercise-template) and [skills/exercise-toolkit](https://github.com/skills/exercise-toolkit).
