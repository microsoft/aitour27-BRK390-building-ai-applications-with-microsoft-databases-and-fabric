# Act 3 infrastructure

Act 3 deploys to existing Azure resources. This repository packages the
application; create the services, network, identities, and database permissions
before following the deployment guide.

| Resource | Act 3 responsibility |
| --- | --- |
| Azure Functions app | Hosts the Node.js API and presenter web experience from `src/act3/` |
| Standalone Azure SQL database | Stores current policy, capacity, cases, approvals, plans, receipts, and vector guidance |
| Azure OpenAI embedding deployment | Produces the 1,536-dimensional policy-guidance vectors |
| Azure Cosmos DB for NoSQL container | Stores the create-once V3 synthetic colleague lesson under partition key `/caseId` |
| Microsoft Entra API and SPA registrations | Provide delegated access and the Act 3 reader, approver, and reviewer roles |
| Fabric SQL source | Supplies the synthetic source snapshot through read-only import |

The Function managed identity needs the SQL, Cosmos, and Azure OpenAI access
listed in
[Act 3 instructions](../../instructions/act3.md).

Local preparation produces `build/act3-deploy`:

```sh
npm ci
npm run demo:prepare
```

The package contains application code only. Deploy and verify it by following
[Act 3 instructions](../../instructions/act3.md).

The root Fabric scripts and the [Act 2 infrastructure](../act2/README.md) are
separate deployment paths.
