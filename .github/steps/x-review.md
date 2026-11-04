## Review

_Congratulations, you've worked three AKS incidents with GitHub Copilot as your SRE agent, and approved every fix yourself._

<img src="https://octodex.github.com/images/jetpacktocat.png" alt="celebrate" width=200 align=right>

Here's a recap of your accomplishments:

- Investigated incidents with the signals Azure SRE Agent uses: KQL over Container insights, plus `kubectl`.
- Diagnosed an OOMKilled container, a failed downstream dependency, and a Service selector mismatch.
- Kept a human in the loop. Copilot proposed each mitigation, and you reviewed it before it ran.
- Wrote post-incident reports in `incidents/` that CI checked with GitHub Actions.

### What's next?

- **Break it for real.** Follow [docs/azure-lab.md](../blob/main/docs/azure-lab.md) to deploy the same pets store to AKS with the [Azure SRE Agent sandbox](https://github.com/matthansen0/azure-sre-agent-sandbox), then run `break-oom`, `break-mongodb`, and `break-service` against a real cluster. It costs money while it runs, so tear it down with `scripts/destroy.ps1` when you're done.
- **Choose a run mode on purpose.** Read [Run modes in Azure SRE Agent](https://learn.microsoft.com/en-us/azure/sre-agent/run-modes) and decide which of today's fixes you would ever let run autonomously.
- **Go deeper on AKS.** [Troubleshoot OOMKilled in AKS](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/availability-performance/troubleshoot-oomkilled-aks-clusters) and [Resource management best practices](https://learn.microsoft.com/en-us/azure/aks/developer-best-practices-resource-management).
- **Read the docs.** Start with the [Azure SRE Agent overview](https://learn.microsoft.com/en-us/azure/sre-agent/overview), then [incident response](https://learn.microsoft.com/en-us/azure/sre-agent/incident-response).
