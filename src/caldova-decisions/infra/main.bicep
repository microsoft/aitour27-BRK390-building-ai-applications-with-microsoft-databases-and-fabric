targetScope = 'resourceGroup'

param location string = resourceGroup().location
param clusterName string
param parameterGroupName string = 'caldova-ai-pg17'
param reuseParameterGroup bool = false
param administratorLogin string = 'horizonadmin'
@secure()
param administratorLoginPassword string
param clientIp string
@minValue(2)
param vCores int = 2
@minValue(0)
param replicaCount int = 0

module configuration './parameters.bicep' = {
  name: 'caldova-parameters'
  params: {
    location: location
    parameterGroupName: parameterGroupName
    reuseParameterGroup: reuseParameterGroup
  }
}

resource cluster 'Microsoft.HorizonDB/clusters@2026-05-01-preview' = {
  name: clusterName
  location: location
  tags: { workload: 'caldova-marketing', environment: 'demo' }
  properties: {
    createMode: 'Default'
    version: '17'
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    vCores: vCores
    replicaCount: replicaCount
    zonePlacementPolicy: 'BestEffort'
    network: { publicNetworkAccess: 'Enabled' }
    parameterGroup: {
      id: configuration.outputs.parameterGroupId
      applyImmediately: true
    }
  }
}

module firewall './firewall.bicep' = {
  name: 'caldova-firewall'
  params: {
    clusterName: cluster.name
    clientIp: clientIp
  }
}

output clusterId string = cluster.id
output host string = cluster.properties.fullyQualifiedDomainName
output database string = 'postgres'
output schema string = 'caldova'
