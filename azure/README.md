# Opt-in Azure lab

The default experience is the repository's free local simulation. **This directory is a separate, real Azure lab that can incur charges.** Reading these files does not deploy anything. GitHub Copilot helps investigate and propose commands; it is not the Azure SRE Agent service.

The tracks are intentionally distinct: the game simulates AKS incidents with seeded data; this executable lab creates an Azure Container Apps (ACA) sample; an actual Azure SRE Agent is a separate, optional service. This is a repeatable learning pilot, not an enterprise certification or production-readiness assessment.

The Bicep template creates a Workload profiles (v2) Container Apps environment with a Consumption workload profile, and one public HTTPS sample app using Microsoft's `mcr.microsoft.com/k8se/quickstart:latest` image on port 80. Environment app logs are explicitly set to `none`. The app uses 0.25 vCPU / 0.5 GiB, minimum zero and maximum one replica per revision. There is no AKS, private registry, Log Analytics workspace, custom application build, or automatic Azure SRE Agent deployment.

Consumption billing is based on actual resource usage and requests; scaled-to-zero app compute may be zero, but free monthly grants are not a spending cap. Requests, verification (which can wake a replica), deployment overlap, failed image pulls, networking or other added Azure resources, and any optional SRE Agent can incur charges. Set your own budget alerts and tear down promptly. A budget alert does not stop spending.

## Prerequisites and boundaries

- Bash, curl, a current Azure CLI with the documented `containerapp` commands, and its Bicep compiler already installed. No added project dependencies. The script disables automatic CLI extension installation.
- Sign in yourself using Azure CLI. Choose a disposable subscription, confirm your tenant/subscription, and have permission to create a new resource group and the two resource types. A subscription administrator must have registered `Microsoft.App`; the script checks but never registers providers.
- Select a Container Apps region supported by your subscription and quota. Examples use `eastus2`, not a promise of availability. Only public Azure (`*.azurecontainerapps.io`) is supported.
- Before a multi-cohort trial, inspect the live subscription-and-region quotas and the managed-environment quota. ACA quota scope and defaults vary; do not rely on fixed numeric limits from this guide. Use the Quotas blade and `az containerapp env show-usages` for the selected environment.
- Choose a unique lab ID, 3–20 lowercase letters/digits/hyphens, beginning with a letter. Resource group **must** be `rg-sre-lab-ID`; deploy refuses every existing group, including an old tagged lab group.
- Every call explicitly carries the subscription GUID. The script never changes your default subscription. Subsequent operations require matching `purpose=copilot-sre-lab` and `labId` tags on the group and resources, and refuse unexpected resources.
- Keep the group dedicated and do not modify it concurrently. Tags and confirmation flags are accident-prevention measures, not a security boundary or proof of human identity. Azure RBAC is the authorization boundary.
- Do not put credentials, private data, or production integrations in this public sample.

## Human-run deployment

`deploy` creates a **new resource group**, so it requires subscription-scoped permission to create that group in addition to permission to deploy the ACA resources. An enterprise facilitator with the organization's approved RG-creation rights runs deploy first. A learner with Contributor scoped only to an already-created group cannot run this deploy flow. After provisioning, the facilitator can delegate narrower, customer-approved roles on each dedicated lab group for break/fix and verification. Do not give learners subscription-wide Contributor merely to make the script work.

Run commands individually from the repository root. Replace the GUID before executing. A person must decide whether to approve each write; Copilot should show the exact scope, diff, and confirmation command first, not supply approval on the person's behalf.

```bash
SUB='00000000-0000-0000-0000-000000000000' # replace
ID='demo'
RG="rg-sre-lab-$ID"
REGION='eastus2' # check availability first

bash azure/lab.sh deploy \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID" --location "$REGION" \
  --confirm "deploy:$SUB:$RG"

bash azure/lab.sh verify \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID"

# Inspect actual deployed inventory; do not assume the script's tracked IDs
# are a complete account-wide billable-resource list.
az resource list --subscription "$SUB" --resource-group "$RG" --output table
```

Deployment waits for Azure provisioning, then polls the actual public HTTPS endpoint. Verification requires HTTP **200** and expected configuration/revision state; `provisioningState=Succeeded` alone is not success.

If provisioning fails partway, do not broaden permissions or rerun deploy against the existing group. Inspect the error, use the scoped teardown below for tagged resources, then choose a new lab ID or remove the empty group manually before retrying.

## Three reversible incidents

Run one incident at a time and fix it before starting another. Every break first verifies a healthy baseline. Every break and fix checks the result; neither automatically rolls back or escalates privileges on failure.

| ID | Deliberate failure | Evidence | Approved recovery |
| --- | --- | --- | --- |
| `config` | Change ingress target port from 80 to 81. | Config shows 81; public HTTPS returns 4xx/5xx. | Restore target port 80 and verify HTTP 200. |
| `image` | Request a revision using an intentionally missing sample-image tag, `lab-missing-ID`. | Template contains that tag; new revision provisioning fails; previous ready revision stays active and serves HTTP 200. | Deploy the valid Microsoft sample image as a new revision and verify it becomes ready. |
| `scale` | Switch to multiple-revision mode, then deactivate the ready revision. | Revision becomes inactive; public HTTPS returns 4xx/5xx. | Activate that exact ready revision, restore single-revision mode, and verify HTTP 200. |

`image` is a **failed rollout**, not a fabricated site outage: Container Apps preserves the previous healthy revision. `scale` deliberately removes all serving capacity by deactivation, not by setting unsupported `maxReplicas=0` or generating load. These are configuration-only faults; no data is deleted. The missing image tag depends on the public registry continuing not to publish that deliberately invalid tag. The upstream `latest` sample is mutable.

### Config

```bash
bash azure/lab.sh break --incident config \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID" \
  --confirm "break:config:$SUB:$RG"
bash azure/lab.sh verify --expect config \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID"

# Separate human approval after investigation:
bash azure/lab.sh fix --incident config \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID" \
  --confirm "fix:config:$SUB:$RG"
```

### Image rollout

```bash
bash azure/lab.sh break --incident image \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID" \
  --confirm "break:image:$SUB:$RG"
bash azure/lab.sh verify --expect image \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID"

# Separate human approval after investigation:
bash azure/lab.sh fix --incident image \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID" \
  --confirm "fix:image:$SUB:$RG"
```

### Serving capacity

```bash
bash azure/lab.sh break --incident scale \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID" \
  --confirm "break:scale:$SUB:$RG"
bash azure/lab.sh verify --expect scale \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID"

# Separate human approval after investigation:
bash azure/lab.sh fix --incident scale \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID" \
  --confirm "fix:scale:$SUB:$RG"
```

Verification polls at five-second intervals, up to 36 attempts (120 for image provisioning failure), plus CLI/HTTP request time. HTTP requests have a ten-second timeout. DNS/TLS/transport failure does **not** count as proof of the injected fault. A timeout is a failed check, not permission to retry a write automatically. If a break is interrupted, the same scenario's approved fix can recover partial changes. Investigate mixed or externally changed state manually; the script refuses cross-scenario fixes.

Read-only evidence for Copilot or an operator:

```bash
az containerapp show --subscription "$SUB" --resource-group "$RG" --name "$ID-app"
az containerapp revision list --subscription "$SUB" --resource-group "$RG" --name "$ID-app"
az containerapp logs show --subscription "$SUB" --resource-group "$RG" --name "$ID-app" --type system --tail 30
```

Do not paste tokens or credentials into chat. Log Analytics and alerts are deliberately not provisioned. Container Apps' available system logs, revision state, config, and HTTPS probes are the lab's evidence.

## Optional: evaluate the actual Azure SRE Agent

The console does not create, connect to, or execute the Azure SRE Agent. Any live evaluation is a **separate service deployment with separate permissions, data, and charges**. Microsoft Learn pages were checked on **2026-11-05**; re-check the linked pages and your tenant's live policy before every trial. This material is not a compliance determination or a claim that the demo is certified or production-ready.

### Enterprise preflight

1. **Trial and cost** — [Evaluate](https://learn.microsoft.com/en-us/azure/sre-agent/evaluate) and [pricing and billing](https://learn.microsoft.com/en-us/azure/sre-agent/pricing-billing) currently describe a 30-day waiver of the always-on charge for eligible new customers, up to three agents per account; deleted agents still count toward that cap. Active usage can still be billed. After the trial, standard pricing applies automatically to agents that still exist. The always-on charge continues while an agent exists, including when stopped; deletion is required to stop it. Verify eligibility and terms before creating any agent.
2. **Region and scope** — use the current [supported-regions](https://learn.microsoft.com/en-us/azure/sre-agent/supported-regions) list and the creation wizard; region availability is subscription-specific, and an empty region list may mean the subscription is not registered. An agent's home region/subscription does not constrain the resources its identity can access: review the full RBAC scope and inherited grants.
3. **Data residency and retention** — obtain enterprise sign-off on the model provider and data path before connecting telemetry. [Data privacy](https://learn.microsoft.com/en-us/azure/sre-agent/data-privacy) distinguishes Azure OpenAI from Anthropic; Anthropic may process data globally and is not covered by Microsoft's EU Data Boundary commitments. Microsoft and Anthropic state that customer data is not used to train their AI models. The service keeps conversations, uploaded knowledge, agent memory, and connector settings until explicitly deleted; deleting a thread may leave learned memory until the agent is deleted, while removing a connector deletes its stored credentials. Define a data cleanup owner and retention procedure before the trial. Customer Lockbox is not currently supported according to that page. Do not infer a compliance certification or data-residency guarantee beyond the current service documentation.
4. **Create, operate, approve** — keep the roles distinct:
   - Creating the agent requires **Owner**, or **Contributor plus User Access Administrator**, on the subscription or resource group where it is created ([setup prerequisites](https://learn.microsoft.com/en-us/azure/sre-agent/create-and-set-up#prerequisites)).
   - The agent uses a **UAMI** for Azure resource RBAC and connector authentication, and also has a **SAMI** for service infrastructure. Review the current [agent identity](https://learn.microsoft.com/en-us/azure/sre-agent/agent-identity) and [manage permissions](https://learn.microsoft.com/en-us/azure/sre-agent/manage-permissions) pages before assignment. The [`permissions` page](https://learn.microsoft.com/en-us/azure/sre-agent/permissions), dated 2026-03-18 and updated 2026-03-27, documents Reader, Log Analytics Reader, and Monitoring Reader at resource-group scope plus Monitoring Contributor at subscription scope. Do not describe that preset as purely resource-group-scoped; inspect actual and inherited assignments.
   - [Run modes](https://learn.microsoft.com/en-us/azure/sre-agent/run-modes) (2026-06-11) documents **Review** and **Autonomous**. Review is the agent-level fallback, while incident response plans and scheduled tasks default to Autonomous; configure each artifact explicitly for Review in a trial. Only **SRE Agent Administrators** can approve. Run mode and permissions are independent gates.
5. **Observation-only policy** — the older [execute mitigations](https://learn.microsoft.com/en-us/azure/sre-agent/execute-mitigations) page (2026-03-18) refers to a `ReadOnly` mode, while the newer run-modes page documents only two modes. This remains a Microsoft Learn documentation conflict; this guide does not assert a third mode. For an observation-only trial, use the Reader permission level, explicitly prohibit on-behalf-of (OBO) elevation in the trial policy, and audit actual assigned/inherited scopes. The [permissions page](https://learn.microsoft.com/en-us/azure/sre-agent/permissions) says Reader can request temporary write access through OBO; only an SRE Agent Administrator using a work or school Entra account can authorize it. Reader alone is not a guarantee that write access can never be requested.
6. **Feature maturity** — the REST API reference and managed connectors pages retain preview labels in the Microsoft Learn pages checked (API reference: 2026-05-14; managed connectors: 2026-08-20). Verify current labels and limitations before relying on those features; do not infer a launch/GA date from marketing material.
7. **Cleanup** — document who owns agent deletion, connector/role cleanup, retained data deletion, and cost review before the trial. Agent deletion is irreversible; stopping is not a billing stop. This cleanup is separate from the ACA lab's scoped script, and **Azure SRE Agent must not be asked to run teardown**.

The agent's default assigned roles and available permissions can change. [`manage-permissions`](https://learn.microsoft.com/en-us/azure/sre-agent/manage-permissions) was updated 2026-10-29; re-review its current resource-type-dependent grants rather than copying a role list into a long-lived policy.

## Human-run scoped teardown

Approve separately, even after a successful exercise:

```bash
bash azure/lab.sh teardown \
  --subscription "$SUB" --resource-group "$RG" --lab-id "$ID" \
  --confirm "teardown:$SUB:$RG"

az resource list --subscription "$SUB" --resource-group "$RG" --output table
```

The script validates ownership and inventory, deletes only the exact tagged app ID, then the exact tagged environment ID, waits for deletion, and verifies the group's resource inventory is empty. It **never deletes the resource group**, avoiding a group-wide deletion that could sweep in unrelated resources. The empty tagged group and ARM deployment history are retained; remove them manually in the portal if desired. Rerunning teardown can finish partially completed cleanup. If an unrelated resource or changed tag appears, it refuses rather than expanding the deletion scope.

After teardown, inspect the group and the subscription's Cost Management view; the script inventory is not an account-wide billing report, and this guide does not promise that only two resources can incur charges. Optional Azure SRE Agent resources, identities, monitoring resources, role assignments, or incident connectors created outside this group require separate human cleanup. Stopping an actual Azure SRE Agent does **not** stop its always-on charge: deletion is required, is irreversible, and is separate from this ACA teardown. Follow the service's current deletion and data-retention guidance, and explicitly remove retained conversations, knowledge, memory, or connector credentials as required by your organization's policy.

## Portable offline validation

These commands do not sign in, provision resources, make public requests, or run live break/fix operations. The shell contract tests replace `az`, `curl`, and `sleep` with exported Bash functions; they exercise scope/approval refusals, tagged ownership, break/fix paths, probe failures, partial cleanup safety, and deployment's existing-group refusal.

```bash
bash -n azure/lab.sh azure/test.sh
bash azure/test.sh
```

If Bicep is already installed, compile locally without contacting Azure:

```bash
bicep build azure/main.bicep --outfile /tmp/sre-lab-main.json
```

Local compilation and mocked tests do not establish subscription quota, RBAC, region availability, public-image availability, billing, or live control-plane behavior.

## Infrastructure references

Microsoft Learn pages checked on 2026-11-05:

- [Container Apps public sample, image, target port](https://learn.microsoft.com/en-us/azure/container-apps/get-started)
- [Container Apps Bicep schema, API 2025-01-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2025-01-01/containerapps)
- [Managed environment Bicep schema, API 2025-01-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2025-01-01/managedenvironments)
- [CLI update, image and no-wait arguments](https://learn.microsoft.com/en-us/cli/azure/containerapp?view=azure-cli-latest)
- [Revision activate/deactivate/set-mode commands](https://learn.microsoft.com/en-us/cli/azure/containerapp/revision?view=azure-cli-latest)
- [Revision lifecycle and zero-downtime single-revision rollout](https://learn.microsoft.com/en-us/azure/container-apps/revisions)
- [Container Apps quotas](https://learn.microsoft.com/en-us/azure/container-apps/quotas) — current usage is scoped by subscription/region and managed environment; inspect live values before scaling cohorts.
- [Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing) — consumption charges, free grants, and possible charges from additional Azure resources or networking; free grants are not a spending cap.
- [Azure role assignment scope](https://learn.microsoft.com/en-us/azure/role-based-access-control/scope-overview) — role grants inherit downward, not from an existing resource group to its parent subscription.
- [SRE Agent run modes and per-plan/task approvals](https://learn.microsoft.com/en-us/azure/sre-agent/run-modes)
- [SRE Agent permissions](https://learn.microsoft.com/en-us/azure/sre-agent/permissions) — page metadata: ms.date 2026-03-18, updated 2026-03-27.
- [SRE Agent permission management](https://learn.microsoft.com/en-us/azure/sre-agent/manage-permissions) — updated 2026-10-29; check live role details.
- [SRE Agent privacy](https://learn.microsoft.com/en-us/azure/sre-agent/data-privacy)
- [SRE Agent trial evaluation](https://learn.microsoft.com/en-us/azure/sre-agent/evaluate)
- [SRE Agent billing](https://learn.microsoft.com/en-us/azure/sre-agent/pricing-billing)
- [SRE Agent mitigation guardrails](https://learn.microsoft.com/en-us/azure/sre-agent/execute-mitigations) — page metadata: ms.date 2026-03-18; its `ReadOnly` wording conflicts with the newer two-mode run-modes page.
- [AKS OOMKilled troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/availability-performance/troubleshoot-oomkilled-aks-clusters) — updated 2026-10-27.
- [AKS application/service connectivity troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/connectivity/connection-issues-application-hosted-aks-cluster) — updated 2026-10-30.
- [AKS pod and service connectivity](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/connectivity/troubleshoot-connection-pods-services-same-cluster) — updated 2026-09-23.
