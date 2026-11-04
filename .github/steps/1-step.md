## Step 1: Checkout is crash-looping

It's 09:40 and your pager fires: **order-service pod restarts > 3 in 10m**. Customers of the pets store on Azure Kubernetes Service (AKS) can't check out.

You're on call, and GitHub Copilot is your SRE agent. It can run diagnostics and propose a fix. Only you can approve one.

<img width="160" alt="Inspectocat" src="../images/inspectocat.png" align="right" />

### 📖 Theory: An SRE agent in Review mode

When an alert fires, [Azure SRE Agent](https://learn.microsoft.com/en-us/azure/sre-agent/overview) queries your observability stack (Azure Monitor, Application Insights, and Log Analytics) for correlated signals. It forms a root cause hypothesis, then suggests a mitigation or, when configured, runs one.

Whether it asks first depends on its [run mode](https://learn.microsoft.com/en-us/azure/sre-agent/run-modes):

| Mode | What happens | Best for |
| --- | --- | --- |
| **Review** | The agent proposes an action. A human approves or denies it. | Production systems, critical infrastructure |
| **Autonomous** | The agent runs the action and reports what it did. | Nonproduction environments, trusted recurring tasks |

You set the mode per incident response plan and per scheduled task, and both default to **Autonomous**. Choose Review on purpose for production. Every incident in this exercise runs in Review mode.

The console simulates the signals an agent would gather on AKS: KQL over [Container insights](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/container-insights-log-query) tables such as `KubePodInventory`, `ContainerLogV2`, and `Perf`, plus `kubectl` output from the cluster.

### ⌨️ Activity: Open the SRE console

1. In the GitHub Copilot app, add this repository (`{{ full_repo_name }}`) and start a session on it.
1. Ask Copilot:

    > Open the Azure SRE console canvas.

    The console opens beside the chat. It loads from this repository's project extension in `.github/extensions/sre-console/`.

<details>
<summary>No Copilot app? Use the console in a browser 🌐</summary><br/>

From the repository root, in a Codespace or on your machine, run:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/console/`. You run every step yourself, and **Download report** replaces **Save to incidents/**. Upload the file to `incidents/` on `main` with **Add file → Upload files**.

</details>

### ⌨️ Activity: Work the incident

1. **Investigate.** Run signals until the evidence explains the alert. You can click them, or ask Copilot to do it:

    > Act as Azure SRE Agent. Investigate the open incident in the SRE console and tell me what the evidence says.

1. **Diagnose.** Pick the root cause that explains _every_ symptom, not just the loudest one.
1. **Mitigate.** Ask Copilot to propose a fix:

    > Propose a mitigation in the SRE console and explain your reasoning. Don't approve it.

1. **Review.** Read the command and its risk. If it's wrong, select **Deny** and ask for a better one. When you agree, enter your GitHub handle (`{{ login }}`) and select **Approve**.
1. **Report.** Add a note for the post-incident review and select **Save to incidents/**. This writes `incidents/oom-killed.md`.
1. Ask Copilot to ship it:

    > Commit incidents/oom-killed.md and push it to main.

1. Wait about 20 seconds and refresh this issue. A results table appears, and the next step follows once every check passes.

<details>
<summary>Having trouble? 🤷</summary><br/>

- If the canvas doesn't appear, ask Copilot to run `extensions_reload` and then open the console again.
- Diagnose stays locked until you run at least one signal. Mitigate stays locked until you pick a root cause.
- Restarting or scaling out doesn't help a pod that is killed for exceeding its memory limit. Look at the exit code and the memory chart.
- If a check fails, fix the incident in the console, save again, and push the updated report.

</details>
