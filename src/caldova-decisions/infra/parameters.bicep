targetScope = 'resourceGroup'

param location string = resourceGroup().location
param parameterGroupName string = 'caldova-ai-pg17'
param reuseParameterGroup bool = false

resource existingParameters 'Microsoft.HorizonDB/parameterGroups@2026-05-01-preview' existing = {
  name: parameterGroupName
}

// Service-owned preload libraries are injected by HorizonDB automatically.
// pg_durable.database is not configurable through this preview resource provider.
resource parameters 'Microsoft.HorizonDB/parameterGroups@2026-05-01-preview' = if (!reuseParameterGroup) {
  name: parameterGroupName
  location: location
  properties: {
    pgVersion: 17
    description: 'Caldova AI Pipelines: AI extensions and durable execution'
    applyImmediately: true
    parameters: [
      { name: 'azure.extensions', value: 'azure_ai,pg_durable,vector' }
      { name: 'shared_preload_libraries', value: 'pg_durable' }
      { name: 'require_secure_transport', value: 'on' }
      { name: 'ssl_min_protocol_version', value: 'TLSv1.2' }
    ]
  }
}

output parameterGroupId string = reuseParameterGroup ? existingParameters.id : parameters!.id
