# Act 3: reuse retained intelligence

Act 3 uses a prior synthetic colleague lesson to inform a new December staffing
decision. The application retrieves the retained lesson, checks it against current
Azure SQL policy and capacity, and requires separate operations and HR approvals
before publishing a workforce plan.

See [session order](session-order.md) for the transition from the Act 2 memory
capture to this later decision.

## System flow

1. The frozen Fabric scenario supplies product, plant, line, persona, and prior-case
   anchors.
2. [The staffing scenario generator](../scripts/act3/build-staffing-scenario.mjs)
   creates the separate December case and its versioned synthetic memory.
3. Azure Cosmos DB stores the create-once colleague lesson.
4. Azure SQL stores the current case, policies, options, approvals, and plan.
5. Azure OpenAI embeds approved policy guidance for retrieval.
6. The Azure Function and browser application orchestrate assessment, proposal,
   two approvals, and retained receipts under Microsoft Entra authorization.

## Systems of authority

| Concern | Authoritative surface |
| --- | --- |
| Frozen product, plant, line, and prior-case anchors | `data/scenario.json` |
| December demand and workforce assumptions | `src/act3/staffing-extension.json` |
| Prior colleague lesson | Versioned synthetic document in Azure Cosmos DB |
| Current policy, capacity, case state, approvals, and plan | Standalone Azure SQL database |
| Policy-guidance embeddings | Azure SQL vectors produced by the configured Azure OpenAI deployment |
| User identity and application roles | Microsoft Entra ID |
| Presenter experience and API orchestration | Azure Functions app in `src/act3/` |

The Fabric source import is read-only. The Act 3 setup scripts do not update the
Fabric estate. The Azure SQL database is separate from the Fabric SQL Database used
by the root deployment.

## Validate the deployed demo

Local tests validate the code and synthetic fixtures. Before presenting, deploy
the app, run preflight, sign in with the presenter account, and complete the
staffing flow against the configured Azure services.

The V3 memory is create-once. Use a new `SESSION-` or `REHEARSAL-` case for each
rehearsal.

## Navigation

- [Presenter setup and deployment](../instructions/act3.md)
- [AI coding-agent runbook](../instructions/act3-copilot.md)
- [Act 3 source](../src/act3/README.md)
- [Infrastructure](../infra/act3/README.md)
- [Security review](act3-security-review.md)
