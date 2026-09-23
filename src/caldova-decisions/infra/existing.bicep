targetScope = 'resourceGroup'

param location string = resourceGroup().location
param clusterName string
param parameterGroupName string = 'caldova-ai-pg17'
param reuseParameterGroup bool = false
param clientIp string

// Reference the shared cluster. The deployment script PATCHes only the
// parameter-group association after deploying these additive resources.
resource cluster 'Microsoft.HorizonDB/clusters@2026-05-01-preview' existing = {
  name: clusterName
}

module configuration './parameters.bicep' = {
  name: 'caldova-parameters'
  params: {
    location: location
    parameterGroupName: parameterGroupName
    reuseParameterGroup: reuseParameterGroup
  }
}

module firewall './firewall.bicep' = {
  name: 'caldova-firewall'
  params: {
    clusterName: cluster.name
    clientIp: clientIp
  }
}

output parameterGroupId string = configuration.outputs.parameterGroupId
output host string = cluster.properties.fullyQualifiedDomainName
output database string = 'postgres'
output schema string = 'caldova'
