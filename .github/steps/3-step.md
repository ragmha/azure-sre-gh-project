## Step 3: Orders fail, but every pod is green

Last page of the shift: **Order placement failure rate > 20%**. This alert comes from Application Insights, and Kubernetes says every pod is `Running` with zero restarts.

### 📖 Theory: Healthy pods, broken service

A Kubernetes [Service](https://learn.microsoft.com/en-us/azure/aks/concepts-network-services) routes traffic to the pods whose labels match its selector. If the selector and labels drift apart, the Service has no ready endpoints. Every pod can stay healthy while requests fail. Follow Microsoft's [AKS connectivity checks](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/connectivity/connection-issues-application-hosted-aks-cluster) and [pod/service troubleshooting sequence](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/connectivity/troubleshoot-connection-pods-services-same-cluster).

This is where a human reviewer matters most. A restart looks safe and changes nothing. Deleting the Service looks decisive and makes the outage worse.

### ⌨️ Activity: Find where traffic stops

1. Open the **Step 3** incident in the SRE console, and ask Copilot to investigate it.
1. Compare the Service selector with pod labels, then inspect its EndpointSlices for ready endpoints.
1. Pick the root cause, have Copilot propose a fix, inspect the risk, and approve it only once you can explain why it restores endpoints.
1. Apply the change in simulation and run the separate simulated verification.
1. Save the debrief and ask Copilot to commit `incidents/service-mismatch.md` and push it to main in your copied repository.
1. Wait about 20 seconds and refresh this issue.

<details>
<summary>Having trouble? 🤷</summary><br/>

- Compare `kubectl get service <service> -o jsonpath='{.spec.selector}{"\n"}'` with `kubectl get pods --show-labels`.
- Use `kubectl get endpointslice --selector kubernetes.io/service-name=<service>` to confirm whether the Service has ready endpoints.
- Pod health alone can't explain this incident. You need the signals that compare the Service with the pods.

</details>
