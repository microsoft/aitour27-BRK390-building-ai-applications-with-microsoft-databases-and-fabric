# Act 2 infrastructure index

The standalone Azure demo owns its Bicep under
[`src/caldova-decisions/infra`](../../src/caldova-decisions/infra/README.md) so the
deployment helpers retain their tested component-relative paths.

| Template | Resource boundary |
| --- | --- |
| [main.bicep](../../src/caldova-decisions/infra/main.bicep) | New HorizonDB cluster and configuration |
| [existing.bicep](../../src/caldova-decisions/infra/existing.bicep) | Existing HorizonDB configuration |
| [factory-bot.bicep](../../src/caldova-decisions/infra/factory-bot.bicep) | Azure Bot Service and Teams channel |
| [memory-support.bicep](../../src/caldova-decisions/infra/memory-support.bicep) | Support containers in an existing Azure Cosmos database |

The root Fabric deployment is unchanged. It does not invoke these templates,
register Entra apps, install Teams/Cowork packages, or configure Cosmos memory.
Follow [Act 2 instructions](../../instructions/act2.md) for that separate sequence.
