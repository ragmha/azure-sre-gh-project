## Step 2: Orders are never fulfilled

New page: **makeline-service availability < 50%**. Customers can still place orders, but none has been fulfilled for 15 minutes.

### 📖 Theory: Follow the dependency chain

In the pets store, `order-service` publishes orders to RabbitMQ, and `makeline-service` consumes them and writes to MongoDB. When a downstream dependency fails, the service that alerts is often a victim, not the cause.

An SRE agent earns its keep here. It checks every tier in the [incident](https://learn.microsoft.com/en-us/azure/sre-agent/incident-response) before it trusts the first error it sees. Restarting the noisy service just restarts the symptom.

### ⌨️ Activity: Find what makeline-service depends on

1. In the SRE console, select the **Step 2** tab, or ask Copilot:

    > Switch the SRE console to the mongodb-down incident and investigate it.

1. Follow the evidence down the service map until you reach a dependency that isn't serving.
1. Pick the root cause, ask Copilot to propose a fix, review it, and approve it with your handle.
1. Save the report and ask Copilot to commit `incidents/mongodb-down.md` and push it to main.
1. Wait about 20 seconds and refresh this issue.

<details>
<summary>Having trouble? 🤷</summary><br/>

- Read the makeline-service logs first, then check which deployments have zero ready replicas.
- Purging the queue throws away customer orders. That's data loss, not a fix, so deny it.

</details>
