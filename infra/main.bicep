/*
  Everything the CRM needs on Azure, in one deployment.

  WHY THIS EXISTS RATHER THAN A LIST OF PORTAL CLICKS. Forty-odd settings
  spread over six resources, several of which only matter when they are
  wrong — a firewall rule missing, TLS not enforced, a managed identity
  without the role it needs. Clicking through them once is slow and clicking
  through them twice, on the day something has to be rebuilt, is where the
  second environment quietly differs from the first. This is checked by the
  compiler, re-runnable, and reviewable in a diff.

  WHAT IT DOES NOT DO: it creates no secrets except the database password
  you pass in, and it puts none of the application's API keys anywhere. Those
  go in afterwards with infra/secrets.sh, which reads them from your own
  environment and never prints them.

  Deploy:
    az group create -n techzoid-crm -l centralindia
    az deployment group create -g techzoid-crm -f infra/main.bicep \
       -p namePrefix=techzoidcrm postgresAdminPassword='<a strong password>'
*/

@description('Short lowercase prefix for every resource name. Letters and digits only.')
@minLength(3)
/* Nine, not twelve. A storage account name may be 24 characters and this
   prefix carries a two-letter kind and a thirteen-character uniqueness
   suffix — at twelve the name is 27 and the deployment fails on the last
   resource rather than the first. Key Vault has the same 24-character cap. */
@maxLength(9)
param namePrefix string

@description('Where everything lives. Central India keeps the data in-country and the latency low for Delhi.')
param location string = resourceGroup().location

@description('The PostgreSQL administrator login.')
param postgresAdminLogin string = 'crmadmin'

@description('The PostgreSQL administrator password. Never commit this; pass it at deploy time and let the template put it straight into Key Vault.')
@secure()
param postgresAdminPassword string

@description('Database size. B1ms is the burstable entry tier — right for this workload, and changeable later without a rebuild.')
param postgresSkuName string = 'Standard_B1ms'

/* Static Web Apps is not offered in every region, and centralindia is one of
   the ones it is missing from -- the deployment fails outright with
   LocationNotAvailableForResourceType. At the time of writing it is offered
   in centralus, eastus2, westus2, westeurope and eastasia, so this is a
   SEPARATE knob from `location`: the database, the storage and the function
   app stay next to the people using them, and only the static host moves.
   eastasia is the closest of the five to India.

   It costs nothing in latency that matters. A Static Web App is a CDN in
   front of a handful of files, served from the edge wherever the visitor
   is; the requests that actually touch data go to /api, which is the linked
   backend, which is still in `location`. */
@description('Region for the Static Web App. It is not available in every region -- see the note in this file.')
@allowed([ 'centralus', 'eastus2', 'westus2', 'westeurope', 'eastasia' ])
param staticSiteLocation string = 'eastasia'

@description('Postgres major version. 17, because that is what the live Supabase server runs.')
param postgresVersion string = '17'

var suffix = uniqueString(resourceGroup().id)
var storageName = toLower('${namePrefix}st${suffix}')
var keyVaultName = toLower('${namePrefix}kv${suffix}')
var postgresName = toLower('${namePrefix}-pg-${suffix}')
var functionAppName = toLower('${namePrefix}-fn-${suffix}')
var staticSiteName = toLower('${namePrefix}-web-${suffix}')
var databaseName = 'crm'

/* Built-in role ids. Written out because the alternative is a GUID with no
   name next to it in a diff nobody can review. */
var roleStorageBlobDataOwner = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var roleKeyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var roleMonitoringMetricsPublisher = '3913510d-42f4-4e42-8a64-420c390055eb'

/* -- telemetry ------------------------------------------------------- */

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    /* Thirty days. Long enough to investigate last week's incident, short
       enough that log storage is not a line on the bill anybody notices. */
    retentionInDays: 30
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-ai-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
  }
}

/* -- storage ---------------------------------------------------------- */

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    /* NO SHARED KEYS. The function app reaches storage with its managed
       identity, so the account keys are not a credential anybody has to
       hold, rotate, or accidentally paste somewhere. Turning this off is
       also what stops a leaked key being useful. */
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

/* Where the function app's own code is deployed from. Required by the Flex
   Consumption plan. */
resource deploymentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'deployments'
}

/* Quotation and invoice attachments — what lives in Supabase Storage today.
   Private: every read goes through a time-limited signed URL issued by the
   API after the policies have had their say. */
resource attachmentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'attachments'
  properties: { publicAccess: 'None' }
}

/* -- key vault -------------------------------------------------------- */

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    /* RBAC rather than access policies: one permission model for the whole
       subscription instead of two that can disagree. */
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    /* A vault that can be purged is a vault a mistake can destroy. */
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

/* -- database --------------------------------------------------------- */

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  sku: {
    name: postgresSkuName
    tier: 'Burstable'
  }
  properties: {
    version: postgresVersion
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      /* Seven days of point-in-time restore. The cheapest insurance against
         the migration itself going wrong. */
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

/* The function app has no fixed outbound address on Flex Consumption, so
   this is the rule Azure provides for exactly that case. It does NOT open
   the server to the internet: 0.0.0.0/0.0.0.0 is a sentinel meaning "Azure
   services", not "everybody". A caller still needs the password. */
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServicesAndResources'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

/* TLS is not optional. The pg driver verifies the certificate against the
   roots Node already ships, so nothing needs disabling at the other end. */
resource requireTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'require_secure_transport'
  properties: {
    value: 'on'
    source: 'user-override'
  }
  dependsOn: [ database ]
}

/* The one secret this template creates, because it is the one it is given.
   Everything downstream reads the connection string from here rather than
   from an app setting, so rotating the password is a vault operation and not
   a redeployment. */
resource connectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'pg-connection-string'
  properties: {
    value: 'postgresql://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
  }
}

/* -- the function app ------------------------------------------------- */

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-plan-${suffix}'
  location: location
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  kind: 'functionapp'
  properties: { reserved: true }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}deployments'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        /* Bounded on purpose. Every instance holds a connection pool, and a
           burstable Postgres has a low connection ceiling — an unbounded
           scale-out answers a traffic spike by exhausting the database and
           failing every request instead of some of them. */
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '20'
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        { name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING', value: 'Authorization=AAD' }
        { name: 'PGCONNECTION_STRING', value: '@Microsoft.KeyVault(SecretUri=${connectionStringSecret.properties.secretUri})' }
        { name: 'ATTACHMENTS_ACCOUNT', value: storage.name }
        { name: 'ATTACHMENTS_CONTAINER', value: attachmentsContainer.name }
        { name: 'KEY_VAULT_URI', value: vault.properties.vaultUri }
        /* HS256 while sign-in is still Supabase. The switch to Entra ID is
           this value plus JWT_JWKS_URI, JWT_ISSUER and JWT_AUDIENCE — see
           docs/AZURE.md. The secret itself is added by infra/secrets.sh. */
        { name: 'JWT_ALG', value: 'HS256' }
      ]
    }
  }
  dependsOn: [ deploymentsContainer ]
}

/* -- what the function app is allowed to do ---------------------------
   Least privilege, and all of it through the managed identity. There is no
   connection string for storage and no client secret for the vault, which
   means there is nothing to leak and nothing to rotate. */

resource blobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, functionApp.id, roleStorageBlobDataOwner)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageBlobDataOwner)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource vaultAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, functionApp.id, roleKeyVaultSecretsUser)
  properties: {
    /* Secrets USER, not officer: the app reads secrets and cannot write or
       delete them. */
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultSecretsUser)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource metricsAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: insights
  name: guid(insights.id, functionApp.id, roleMonitoringMetricsPublisher)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleMonitoringMetricsPublisher)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

/* -- the site --------------------------------------------------------- */

resource staticSite 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticSiteName
  location: staticSiteLocation
  /* Standard, not Free: a linked backend needs it, and a linked backend is
     what puts the SPA and /api on ONE ORIGIN. Same origin means no CORS to
     configure and no cross-site cookie question to get wrong. */
  sku: { name: 'Standard', tier: 'Standard' }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
  }
}

resource linkedBackend 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  parent: staticSite
  name: 'api'
  properties: {
    backendResourceId: functionApp.id
    region: location
  }
}

/* -- what you need next ------------------------------------------------ */

output functionAppName string = functionApp.name
output functionAppHost string = functionApp.properties.defaultHostName
output staticSiteName string = staticSite.name
output staticSiteHost string = staticSite.properties.defaultHostname
output keyVaultName string = vault.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output postgresDatabase string = databaseName
output storageAccount string = storage.name
output attachmentsContainer string = attachmentsContainer.name
