targetScope = 'resourceGroup'
param accountName string
param databaseName string = 'caldova-act2-demo'
resource account 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' existing = { name: accountName }
resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' existing = {
  parent: account
  name: databaseName
}
resource counter 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'memory_counter'
  properties: {
    resource: {
      id: 'memory_counter'
      partitionKey: { paths: ['/user_id', '/thread_id'], kind: 'MultiHash', version: 2 }
    }
  }
}
resource lease 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'memory_leases'
  properties: {
    resource: {
      id: 'memory_leases'
      partitionKey: { paths: ['/id'], kind: 'Hash', version: 2 }
    }
  }
}
