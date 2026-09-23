targetScope = 'resourceGroup'

param clusterName string
@description('Single IPv4 address permitted to connect; no allow-all rule.')
param clientIp string

resource firewall 'Microsoft.HorizonDB/clusters/pools/firewallRules@2026-05-01-preview' = {
  name: '${clusterName}/DefaultPool/caldova-dev-client'
  properties: {
    startIpAddress: clientIp
    endIpAddress: clientIp
  }
}
