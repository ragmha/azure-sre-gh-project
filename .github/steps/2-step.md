## Step 2: Orders are never fulfilled

New page: **makeline-service availability < 50%**. Customers can still place orders, but none has been fulfilled for 15 minutes.

### 📖 Theory: Follow the dependency chain

In the pets store, `order-service` publishes orders to RabbitMQ, and `makeline-service` consumes them and writes to MongoDB. When a downstream dependency fails, the service that alerts is often a victim, not the cause.

In a real Azure SRE Agent workflow, incident context can help trace dependencies; the console's signals below are seeded simulation data. Restarting the noisy service just restarts the symptom.

This MongoDB scale-to-zero scenario illustrates generic Kubernetes dependency mechanics. Microsoft Learn documents AKS MongoDB high-availability patterns, not this exact failure; use the [service and EndpointSlice troubleshooting guidance](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/connectivity/troubleshoot-connection-pods-services-same-cluster) for the diagnostic approach.

### ⌨️ Activity: Find what makeline-service depends on

1. In the SRE console, select the **Step 2** tab, or ask Copilot:

    > Switch the SRE console to the mongodb-down incident and investigate it.

1. Reveal both required signals and follow the evidence down the service map until you reach a dependency that isn't serving.
1. Pick the root cause, ask Copilot to propose a fix, inspect its risk and expected outcome, and check the plan-review box.
1. Approve with your handle, then select **Apply in simulation** and **Run simulated verification**. The simulated result is not live Azure telemetry.
1. Save the debrief and ask Copilot to commit `incidents/mongodb-down.md` and push it to main in your copied repository.
1. Wait about 20 seconds and refresh this issue.

<details>
<summary>Having trouble? 🤷</summary><br/>

- Read the makeline-service logs first, then check which deployments have zero ready replicas.
- Purging the queue throws away customer orders. That's data loss, not a fix, so deny it.

</details>
