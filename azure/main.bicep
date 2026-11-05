targetScope = 'resourceGroup'

@minLength(3)
@maxLength(20)
param labId string
param location string

var tags = {
  purpose: 'copilot-sre-lab'
  labId: labId
}

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${labId}-env'
  location: location
  tags: tags
  properties: {
    // No Log Analytics workspace or dedicated workload profile.
    appLogsConfiguration: {
      destination: 'none'
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: '${labId}-app'
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 80
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'hello'
          image: 'mcr.microsoft.com/k8se/quickstart:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output appId string = app.id
output endpoint string = 'https://${app.properties.configuration.ingress.fqdn}'
