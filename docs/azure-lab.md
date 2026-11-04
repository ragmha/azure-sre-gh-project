# Break it for real: the optional Azure lab

The exercise runs on a simulation, so it's free and safe. The incidents come from the [Azure SRE Agent sandbox](https://github.com/matthansen0/azure-sre-agent-sandbox). It deploys the same pets store to AKS with Container insights, Application Insights, and Azure SRE Agent, so you can break a real cluster and watch a real agent respond.

> [!WARNING]
> The sandbox creates billable Azure resources. The sandbox estimates about **$22–28 a day**, or **$32–38 a day** with SRE Agent. Tear it down as soon as you finish.

## Before you start

- An Azure subscription where you have Owner or Contributor access.
- A region that supports Azure SRE Agent: **East US 2**, **Sweden Central**, or **Australia East**.
- The Azure CLI, and ideally VS Code with Dev Containers. The sandbox's dev container adds the `break-*` and `fix-all` shortcuts.

## Deploy

Follow the sandbox's [Quick Start](https://github.com/matthansen0/azure-sre-agent-sandbox#-quick-start):

```powershell
az login --use-device-code
.\scripts\deploy.ps1 -Location eastus2 -Yes
```

The deployment takes 15–25 minutes. It configures SRE Agent with an incident response plan in **Review** mode, the same human approval gate you practiced in the console.

## Run the exercise incidents

| Exercise step | Console scenario | Break it | Manifest |
| --- | --- | --- | --- |
| 1 | `oom-killed` | `break-oom` | `k8s/scenarios/oom-killed.yaml` |
| 2 | `mongodb-down` | `break-mongodb` | `k8s/scenarios/mongodb-down.yaml` |
| 3 | `service-mismatch` | `break-service` | `k8s/scenarios/service-mismatch.yaml` |

Outside the dev container, apply the manifest instead, for example `kubectl apply -f k8s/scenarios/oom-killed.yaml`.

Then open the [SRE Agent portal](https://sre.azure.com) and ask the agent to investigate, or let the response plan pick up the alert. Compare its evidence and its proposed action with what you approved in the console. When it asks for approval, decide as you did in the exercise.

Restore the baseline between incidents:

```bash
fix-all   # kubectl apply -f k8s/base/application.yaml
```

## Tear down

```powershell
.\scripts\destroy.ps1 -ResourceGroupName rg-srelab-eastus2
```

Check the Azure portal afterwards to make sure the resource group is gone.

## Learn more

- [Azure SRE Agent overview](https://learn.microsoft.com/en-us/azure/sre-agent/overview)
- [Run modes in Azure SRE Agent](https://learn.microsoft.com/en-us/azure/sre-agent/run-modes)
- [Incident response in Azure SRE Agent](https://learn.microsoft.com/en-us/azure/sre-agent/incident-response)
- [Query logs from Container insights](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/container-insights-log-query)
