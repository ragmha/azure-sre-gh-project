## Shift debrief

_Congratulations, you completed three simulated AKS incidents with GitHub Copilot coaching you through the response loop._

<img src="https://octodex.github.com/images/jetpacktocat.png" alt="celebrate" width=200 align=right>

Here's a recap of your accomplishments:

- Collected seeded KQL and `kubectl` evidence samples. The console did not query Azure or invoke the Azure SRE Agent service.
- Diagnosed an OOMKilled container, a failed downstream dependency, and a Service selector mismatch.
- Kept a human approval gate: you reviewed each plan and approved it yourself before applying its simulated outcome.
- Verified each simulated recovery separately, then wrote debriefs checked by the shared report grader. GitHub Actions records progress after reports are committed in your copied repository.

### What's next?

- **Optional executable lab.** The separate [Azure Container Apps lab](https://github.com/{{ full_repo_name }}/blob/main/azure/README.md) has its own provisioning, three configuration incidents, verification, scoped teardown, permissions, quotas, and cost guidance. It is not the simulated AKS pets store and is billable.
- **Try the real Azure SRE Agent separately.** Read [Run modes](https://learn.microsoft.com/en-us/azure/sre-agent/run-modes), [permissions](https://learn.microsoft.com/en-us/azure/sre-agent/permissions), and the [enterprise trial notes](https://github.com/{{ full_repo_name }}/blob/main/azure/README.md#optional-evaluate-the-actual-azure-sre-agent). Review the distinct identity, RBAC, approval, data, and billing decisions before any live trial.
- **Go deeper on AKS.** [Troubleshoot OOMKilled in AKS](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/availability-performance/troubleshoot-oomkilled-aks-clusters) and [Resource management best practices](https://learn.microsoft.com/en-us/azure/aks/developer-best-practices-resource-management).
- **Read the docs.** Start with the [Azure SRE Agent overview](https://learn.microsoft.com/en-us/azure/sre-agent/overview), then [incident response](https://learn.microsoft.com/en-us/azure/sre-agent/incident-response) and [AKS service connectivity](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/connectivity/troubleshoot-connection-pods-services-same-cluster).
