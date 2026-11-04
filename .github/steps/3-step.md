## Step 3: Orders fail, but every pod is green

Last page of the shift: **Order placement failure rate > 20%**. This alert comes from Application Insights, and Kubernetes says every pod is `Running` with zero restarts.

### 📖 Theory: Healthy pods, broken service

A Kubernetes [Service](https://learn.microsoft.com/en-us/azure/aks/concepts-network-services) routes traffic to the pods whose labels match its selector. If the selector and the labels drift apart, the Service has no endpoints. Every pod stays healthy while every request fails.

This is where a human reviewer matters most. A restart looks safe and changes nothing. Deleting the Service looks decisive and makes the outage worse.

### ⌨️ Activity: Find where traffic stops

1. Open the **Step 3** incident in the SRE console, and ask Copilot to investigate it.
1. Compare what the Service selects with the labels the pods actually have.
1. Pick the root cause, have Copilot propose a fix, and approve it only once you can say why it restores the Service's endpoints.
1. Save the report and ask Copilot to commit `incidents/service-mismatch.md` and push it to main.
1. Wait about 20 seconds and refresh this issue.

<details>
<summary>Having trouble? 🤷</summary><br/>

- Look for `Endpoints: <none>` in the Service description.
- Pod health alone can't explain this incident. You need the signals that compare the Service with the pods.

</details>
