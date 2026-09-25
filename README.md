<a name="start-building"></a>

<p align="center">
<img src="img/banner-ai-tour-27.png" alt="Microsoft AI Tour 2027" width="100%"/>
</p>

# [Microsoft AI Tour 2027](https://aitour.microsoft.com)

## BRK390: Building AI applications with Microsoft Databases and Fabric

### Session description

Caldova is preparing a seasonal product launch while demand, weather signals,
campaign plans, and production capacity are changing at the same time. This
session shows how Microsoft Fabric, Fabric databases, governed semantic models,
data agents, and a Fabric-embedded application turn those signals into an
explainable recommendation, a controlled decision, and reusable business memory.

All checked-in business records are synthetic and fictional. The deployment
scripts create demonstration resources in Microsoft Fabric and must be used only
with a reviewed, disposable workspace.

### Getting started

#### Session order

**Act 1:** Demo 1, see and understand demand. **Act 2:** Demo 2, marketing approval;
Demo 3, production response in Teams; Demo 4, retain decision memory. **Act 3:**
reuse that memory for the next workforce decision with current policy and capacity.
See [session order and numbering](docs/session-order.md). The portable Act 3
workforce application, setup scripts, tests, and Azure deployment steps are in
[`src/act3/`](src/act3/README.md).

#### Choose your demo path

The [Fabric scenario](data/README.md) and the [standalone Act 2 variant](docs/act2.md)
share the Caldova story but use different expected values. Fabric uses a
100,000-unit candidate campaign; the recorded Act 2 variant uses 57,000 additional
units and preserves maintenance through a line split. Do not mix their expected
answers. Follow [Act 2 setup](instructions/act2.md) for HorizonDB, Cowork, the Teams
factory agent, and Azure Cosmos DB decision memory. The root Fabric scripts do not
deploy these standalone Azure services.

#### During the session

1. Review the [scenario and data estate](data/README.md).
2. Use the [attendee instructions](instructions/README.md) for the deployment
   sequence and demo entry points.
3. Follow the presenter for the governed demand, campaign, capacity, and
   decision-memory walkthroughs.

#### On your own

1. Clone this repository to a machine with Node.js 24 or later and the Fabio
   CLI.
2. Prepare an empty or disposable Microsoft Fabric workspace where you can
   create and load the required item types.
3. Follow the complete [Fabric deployment and demo guide](instructions/README.md).
4. For Act 3, follow the [staffing demo guide](instructions/act3.md). It covers
   configuration, validation, seeding, deployment, and rehearsal against the
   Azure resources used by the demo.

### Learning outcomes

By the end of this session, you will be able to:

- Explain why AI architectures leak organizational knowledge, and describe a six-step blueprint that retains it.
- Design a governed, unified data estate using Microsoft Fabric and Fabric IQ so agents answer with business meaning rather than generic output.
- Select and combine Azure SQL, Cosmos DB and Azure HorizonDB to ground, retain and reuse the intelligence behind each decision.

### Technologies used

| Technology | Role in the demos |
|---|---|
| Microsoft Fabric Lakehouse and OneLake | Store analytical tables, evidence files, evaluation assets, and decision records. |
| Fabric SQL Database | Hosts the relational operational and decision-memory data. |
| Fabric Real-Time Intelligence and Eventhouse | Stores and queries sales, weather, forecast, campaign, and production time series. |
| Fabric IQ ontology and Direct Lake semantic model | Provide governed business meaning, relationships, measures, and agent grounding. |
| Fabric data agent | Answers the session's commercial and operational questions from approved sources. |
| Cosmos DB for NoSQL in Fabric | Optionally stores writable decision-case documents. |
| Caldova Insights | Fabric-embedded React and Rayfin application for the commercial dashboard and analyst assistant. |
| Fabio CLI | Validates, deploys, loads, and verifies the Fabric demo estate. |
| Azure HorizonDB and AI Pipelines | Evaluate and record the standalone Act 2 marketing and production decisions. |
| Copilot Cowork and Microsoft Teams SDK | Provide agent-led marketing planning and Karin's factory planning conversation. |
| Azure Cosmos DB and Agent Memory Toolkit | Retain the Act 2 decision, conversation, summaries, and facts; recall is reserved for Act 3. |

### Repository contents

| Path | Contents |
|---|---|
| [`data/`](data/README.md) | Deterministic synthetic dataset, generation tools, validation rules, and evaluation questions. |
| [`src/fabric/`](src/fabric/) | Fabric ontology, semantic model, data-agent, and authored model source. |
| [`src/caldova-insights/`](src/caldova-insights/README.md) | Fabric-embedded dashboard and analyst assistant. |
| [`src/caldova-decisions/`](src/caldova-decisions/README.md) | Standalone Act 2 campaign, Teams production, and Cosmos memory implementations. |
| [`src/act3/`](src/act3/README.md) | Act 3 staffing application, Azure SQL runtime, and browser experience. |
| [`instructions/`](instructions/README.md) | Public deployment, verification, and demo-running steps. |
| [`docs/`](docs/README.md) | Architecture and component references. |
| [`infra/`](infra/README.md) | Fabric and Azure resource requirements. |
| [`delivery-resources/`](delivery-resources/README.md) | Presenter preflight, reset, fallback, and re-delivery guidance. |

### Continue your learning

Pick your next step based on your learning style:

| Resource | What you'll get |
|----------|-----------------|
| **[Session Recording](https://aka.ms/aitour27/BRK390/youtube)** | A recording of session BRK390 by the session creator |
| **[Microsoft Learn](https://learn.microsoft.com)** | Official documentation and guided learning paths on these topics |
| **[AI Tour 2027 Resource Center](https://aka.ms/aitour27-resource-center)** | Additional session repos and materials from AI Tour 2027 |
| **[Microsoft Foundry Community](https://aka.ms/MicrosoftFoundryDiscord-AITour27)** | Connect with other learners and experts in our Discord community |

### Microsoft Learn MCP Server

<!-- Remove this section if the Microsoft Learn MCP Server is not relevant to the session. -->

The Microsoft Learn MCP Server gives your AI agent direct access to Microsoft's official documentation — grounded, up-to-date answers about the topics in this session.

**GitHub Copilot CLI** — Install with:

```shell
copilot plugin install microsoftdocs/mcp
```

**VS Code** — One-click install:  
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Microsoft_Learn_MCP-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=microsoft-learn&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Flearn.microsoft.com%2Fapi%2Fmcp%22%7D)

For more information, visit the [Learn MCP Server repo](https://aka.ms/learnmcp).

### Content owners

<table>
<tr>
    <td align="center"><a href="https://github.com/toolboc">
        <img src="https://github.com/toolboc.png" width="100px;" alt="Paul DeCarlo"/><br />
        <sub><b>Paul DeCarlo</b></sub></a><br />
            <a href="https://github.com/toolboc" title="talk">📢</a>
    </td>
    <td align="center"><a href="https://github.com/sinedied">
        <img src="https://github.com/sinedied.png" width="100px;" alt="Yohan Lasorsa"/><br />
        <sub><b>Yohan Lasorsa</b></sub></a><br />
            <a href="https://github.com/sinedied" title="talk">📢</a>
    </td>
    <td align="center"><a href="https://github.com/iemejia">
        <img src="https://github.com/iemejia.png" width="100px;" alt="Ismael Mejia Useche"/><br />
        <sub><b>Ismael Mejia Useche</b></sub></a><br />
            <a href="https://github.com/iemejia" title="talk">📢</a>
    </td>
    <td align="center"><a href="https://github.com/videlalvaro">
        <img src="https://github.com/videlalvaro.png" width="100px;" alt="Alvaro Videla Godoy"/><br />
        <sub><b>Alvaro Videla Godoy</b></sub></a><br />
            <a href="https://github.com/videlalvaro" title="talk">📢</a>
    </td>
</tr></table>

### Deliver this session

Presenters and re-delivery partners can find the deck, recordings, presenter
notes, and delivery guidance in [`delivery-resources/`](delivery-resources/README.md).

### Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.

Any use of third-party trademarks or logos are subject to those third-party's policies.
