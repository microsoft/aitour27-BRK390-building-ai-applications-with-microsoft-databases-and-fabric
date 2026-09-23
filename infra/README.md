# Infrastructure boundary

The Fabric deployment uses the root Bash and PowerShell scripts plus the Fabio CLI.
The standalone Act 2 variant also includes component-owned Bicep templates, indexed
in [Act 2 infrastructure](act2/README.md). These are separate deployments and are
not invoked by the root scripts.

## Resources

The default deployment creates or resolves:

- A Lakehouse named `CaldovaAnalytics`.
- An Eventhouse and KQL database named `CaldovaSignals`.
- A Fabric SQL Database named `CaldovaOperations`.
- A Fabric IQ ontology named `CaldovaBusinessMeaning`.
- A Direct Lake semantic model named `CaldovaLaunchModel`.
- A Fabric data agent named `CaldovaAnalyst`.
- Optionally, a Cosmos DB for NoSQL database named
  `CaldovaDecisionMemory`.

Use `--prefix <value>` to change the common `Caldova` prefix.

## Deployment model

Run the scripts from the repository root:

```bash
./create-data.sh --workspace <workspace-id> --dry-run
./create-data.sh --workspace <workspace-id>
```

PowerShell:

```powershell
pwsh ./create-data.ps1 --workspace <workspace-id> --dry-run
pwsh ./create-data.ps1 --workspace <workspace-id>
```

The scripts discover dependencies, create items in order, load data, deploy the
Fabric item definitions under `src/fabric/`, and verify the result. They do not
configure tenant-wide settings, capacities, networking, identity governance, or
application permissions beyond the Fabio operations requested by the current
user.

See the [attendee instructions](../instructions/README.md) for prerequisites,
flags, verification, app deployment, troubleshooting, and cleanup.

## Safety

- Use an empty or disposable demonstration workspace.
- Start with `--dry-run`.
- Do not use `--overwrite` until you have reviewed the target workspace.
- Do not commit credentials, tenant identifiers, generated deployment state, or
  customer data.
- Remove the demo items or workspace after delivery according to your tenant's
  governance process.
