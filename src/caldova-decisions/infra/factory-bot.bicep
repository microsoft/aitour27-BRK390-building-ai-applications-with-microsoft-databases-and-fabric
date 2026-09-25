targetScope = 'resourceGroup'
param botName string
param clientId string
param tenantId string = tenant().tenantId
param endpoint string

resource bot 'Microsoft.BotService/botServices@2022-09-15' = {
  name: botName
  location: 'global'
  kind: 'azurebot'
  sku: { name: 'F0' }
  properties: {
    displayName: 'Factory Planning Agent'
    endpoint: endpoint
    msaAppId: clientId
    msaAppType: 'SingleTenant'
    msaAppTenantId: tenantId
  }
}
resource teams 'Microsoft.BotService/botServices/channels@2022-09-15' = {
  parent: bot
  name: 'MsTeamsChannel'
  location: 'global'
  properties: {
    channelName: 'MsTeamsChannel'
    properties: { isEnabled: true }
  }
}
output botId string = bot.id
