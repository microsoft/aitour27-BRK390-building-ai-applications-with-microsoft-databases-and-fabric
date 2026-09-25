# Act 2 Azure infrastructure

These templates belong to the standalone Act 2 variant. They are not invoked by
the repository's Fabric `create-data.sh` or `create-data.ps1` scripts.

| Template | Purpose |
| --- | --- |
| `main.bicep` | New HorizonDB cluster, AI parameter group and single-IP firewall |
| `existing.bicep` | Reference an existing HorizonDB cluster; create configuration resources |
| `parameters.bicep` | AI extension allowlist, pg_durable preload, TLS settings |
| `firewall.bicep` | One permitted development-client IPv4 address |
| `factory-bot.bicep` | F0 Azure Bot registration and Teams channel |
| `memory-support.bicep` | Counter and lease containers in an existing Cosmos database |

## HorizonDB

From the component root:

```sh
uv run python scripts/deploy.py existing \
  --subscription YOUR_SUBSCRIPTION_ID \
  --resource-group YOUR_HORIZONDB_RESOURCE_GROUP \
  --cluster YOUR_CLUSTER_NAME \
  --location swedencentral \
  --client-ip YOUR_PUBLIC_IPV4 \
  --action validate
```

Use `--action what-if` to inspect changes (`--full-diff` for detail), then
`--action deploy`. The existing-cluster path uses Bicep for configuration resources
and an explicit PATCH for the parameter-group association, preserving compute and
credentials. Preload changes can restart the cluster.

Use `new` with a new cluster name to provision one. Defaults are two vCores and zero
read replicas. The helper prompts for the admin password and supplies it through
stdin as a secure parameter. New resources incur Azure charges. Validation and
what-if require the resource group to exist; the deploy action creates it if needed.

## Tested preview constraints

- Parameter groups are immutable. Reuse matching groups; choose a new name for
  changed settings. ARM validation alone did not detect an attempted update.
- Set only configurable preload libraries. HorizonDB injects its internal modules.
- `pg_durable.database` was not configurable; the worker used `postgres`.
- Named `schema_name` on `ai.table_sink` works; do not rely on dotted-name parsing.
- BCP081 warnings indicate unpublished preview resource type metadata. The source's
  existing-cluster deployment succeeded; its new-cluster template was not deployed.
- The source Checkov scan had one passing check and no failures, but limited coverage
  for HorizonDB. It was not a comprehensive assessment.

This demo uses PostgreSQL authentication, TLS and a single-IP public firewall, not
private networking. Credentials and generated deployment state remain ignored.
See [setup instructions](../../../instructions/act2.md) for the other services.

References:
- https://learn.microsoft.com/azure/horizondb/configure-maintain/quickstart-create-cluster
- https://learn.microsoft.com/azure/horizondb/parameters/how-to-parameter-groups-create
- https://learn.microsoft.com/azure/horizondb/ai/ai-pipelines
