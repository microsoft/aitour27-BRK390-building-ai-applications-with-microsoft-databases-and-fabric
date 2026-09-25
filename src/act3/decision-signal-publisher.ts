import { DefaultAzureCredential } from "@azure/identity";
import { Client as KustoClient, KustoConnectionStringBuilder } from "azure-kusto-data";

import type { Act3Snapshot } from "./domain.ts";
import { createFabricRuntimeFromEnv, loadFabricRuntimeConfig } from "./fabric-runtime.ts";
import type { Act3Runtime } from "./runtime.ts";

export type ProductionDecisionSignal = {
  observedAt: string;
  caseId: string;
  lineId: string;
  maintenanceWindowId: string;
  requiredIncrementalUnits: number;
  headroomWithMaintenanceUnits: number;
  shortfallUnits: number;
  recommendedOptionId: string;
  recommendationSummary: string;
  productionApproverRole: "ROLE-OPERATIONS-APPROVER";
  maintenanceApproverRole: "ROLE-MAINTENANCE-APPROVER";
  requiresDecision: boolean;
};

type KustoResult = {
  primaryResults: Array<{
    columns: Array<{ name: string; ordinal: number }>;
    rows(): Iterable<{ getValueAt(ordinal: number): unknown }>;
  }>;
};

export interface DecisionSignalClient {
  executeQuery(database: string, query: string): Promise<KustoResult>;
  executeMgmt(database: string, command: string): Promise<unknown>;
}

export type PublicationResult = {
  status: "published" | "unchanged";
  signal: ProductionDecisionSignal;
};

function kustoString(value: string): string {
  return JSON.stringify(value);
}

function firstRow(result: KustoResult): Record<string, unknown> | undefined {
  const table = result.primaryResults[0];
  const row = table ? [...table.rows()][0] : undefined;
  if (!table || !row) return undefined;
  return Object.fromEntries(table.columns.map((column) => [column.name, row.getValueAt(column.ordinal)]));
}

export function buildProductionDecisionSignal(
  snapshot: Act3Snapshot,
  observedAt = new Date(),
): ProductionDecisionSignal {
  if (snapshot.source?.mode !== "fabric") {
    throw new Error("Decision signals can be published only from a Fabric-authoritative snapshot.");
  }
  return {
    observedAt: observedAt.toISOString(),
    caseId: snapshot.caseId,
    lineId: snapshot.lineId,
    maintenanceWindowId: snapshot.maintenanceWindowId,
    requiredIncrementalUnits: snapshot.requiredIncrementalUnits,
    headroomWithMaintenanceUnits: snapshot.headroomWithMaintenanceUnits,
    shortfallUnits: snapshot.shortfallUnits,
    recommendedOptionId: snapshot.recommendedOption.optionId,
    recommendationSummary: `${snapshot.recommendedOption.name} delivers ${snapshot.recommendedOption.incrementalUnitsDelivered} incremental units and is policy compliant.`,
    productionApproverRole: "ROLE-OPERATIONS-APPROVER",
    maintenanceApproverRole: "ROLE-MAINTENANCE-APPROVER",
    requiresDecision: snapshot.shortfallUnits > 0,
  };
}

export function productionDecisionSignalCommand(signal: ProductionDecisionSignal): string {
  return `.append ProductionDecisionSignals <|
datatable(
  observedAt:datetime,
  caseId:string,
  lineId:string,
  maintenanceWindowId:string,
  requiredIncrementalUnits:long,
  headroomWithMaintenanceUnits:long,
  shortfallUnits:long,
  recommendedOptionId:string,
  recommendationSummary:string,
  productionApproverRole:string,
  maintenanceApproverRole:string,
  requiresDecision:bool
)[
  datetime(${signal.observedAt}),
  ${kustoString(signal.caseId)},
  ${kustoString(signal.lineId)},
  ${kustoString(signal.maintenanceWindowId)},
  ${signal.requiredIncrementalUnits},
  ${signal.headroomWithMaintenanceUnits},
  ${signal.shortfallUnits},
  ${kustoString(signal.recommendedOptionId)},
  ${kustoString(signal.recommendationSummary)},
  ${kustoString(signal.productionApproverRole)},
  ${kustoString(signal.maintenanceApproverRole)},
  ${signal.requiresDecision}
]`;
}

function sameDecision(row: Record<string, unknown> | undefined, signal: ProductionDecisionSignal): boolean {
  return row?.lineId === signal.lineId
    && row.maintenanceWindowId === signal.maintenanceWindowId
    && Number(row.requiredIncrementalUnits) === signal.requiredIncrementalUnits
    && Number(row.headroomWithMaintenanceUnits) === signal.headroomWithMaintenanceUnits
    && Number(row.shortfallUnits) === signal.shortfallUnits
    && row.recommendedOptionId === signal.recommendedOptionId
    && row.requiresDecision === signal.requiresDecision;
}

export async function publishProductionDecisionSignal(
  runtime: Act3Runtime,
  client: DecisionSignalClient,
  database: string,
  observedAt = new Date(),
): Promise<PublicationResult> {
  if (runtime.authority !== "fabric") {
    throw new Error("The decision-signal publisher requires the Fabric runtime.");
  }
  const signal = buildProductionDecisionSignal(await runtime.getSnapshot(), observedAt);
  const existing = firstRow(await client.executeQuery(database, `
    ProductionDecisionSignals
    | where caseId == ${kustoString(signal.caseId)}
    | top 1 by observedAt desc
    | project lineId, maintenanceWindowId, requiredIncrementalUnits,
        headroomWithMaintenanceUnits, shortfallUnits, recommendedOptionId, requiresDecision
  `));
  if (sameDecision(existing, signal)) return { status: "unchanged", signal };

  await client.executeMgmt(database, productionDecisionSignalCommand(signal));
  return { status: "published", signal };
}

if (import.meta.main) {
  const config = loadFabricRuntimeConfig(process.env);
  const runtime = await createFabricRuntimeFromEnv(process.env);
  const credential = new DefaultAzureCredential(
    config.managedIdentityClientId ? { managedIdentityClientId: config.managedIdentityClientId } : undefined,
  );
  const connection = KustoConnectionStringBuilder.withTokenCredential(config.kustoCluster, credential);
  const result = await publishProductionDecisionSignal(
    runtime,
    new KustoClient(connection),
    config.kustoDatabase,
  );
  console.log(JSON.stringify(result));
}
