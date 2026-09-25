import { DefaultAzureCredential } from "@azure/identity";
import { Client as KustoClient, KustoConnectionStringBuilder } from "azure-kusto-data";
import sql from "mssql";

import type { ActionCommand, ActionReceipt } from "./action-service.ts";
import type { Act3Snapshot, LiveLineTelemetry, ProductionOption } from "./domain.ts";
import type { Act3Runtime } from "./runtime.ts";

export type FabricRuntimeConfig = {
  sqlServer: string;
  sqlDatabase: string;
  kustoCluster: string;
  kustoDatabase: string;
  managedIdentityClientId?: string;
};

type SqlPool = {
  request(): {
    input(name: string, type: unknown, value: unknown): unknown;
    execute(procedure: string): Promise<{ recordset: Record<string, unknown>[] }>;
    query(query: string): Promise<{ recordsets: Record<string, unknown>[][] }>;
  };
  connect(): Promise<unknown>;
};

type KustoQueryClient = {
  executeQuery(database: string, query: string): Promise<{
    primaryResults: Array<{
      columns: Array<{ name: string; ordinal: number }>;
      rows(): Iterable<{ getValueAt(ordinal: number): unknown }>;
    }>;
  }>;
};

export function loadFabricRuntimeConfig(env: NodeJS.ProcessEnv): FabricRuntimeConfig {
  const required = {
    FABRIC_SQL_SERVER: env.FABRIC_SQL_SERVER,
    FABRIC_SQL_DATABASE: env.FABRIC_SQL_DATABASE,
    FABRIC_KUSTO_CLUSTER: env.FABRIC_KUSTO_CLUSTER,
    FABRIC_KUSTO_DATABASE: env.FABRIC_KUSTO_DATABASE,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Fabric runtime configuration is incomplete: ${missing.join(", ")}.`);
  }
  return {
    sqlServer: required.FABRIC_SQL_SERVER!,
    sqlDatabase: required.FABRIC_SQL_DATABASE!,
    kustoCluster: required.FABRIC_KUSTO_CLUSTER!,
    kustoDatabase: required.FABRIC_KUSTO_DATABASE!,
    managedIdentityClientId: env.AZURE_CLIENT_ID,
  };
}

function numberValue(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Fabric returned an invalid numeric value for ${field}.`);
  }
  return parsed;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Fabric returned an invalid value for ${field}.`);
  }
  return value;
}

function mapKustoRow(result: Awaited<ReturnType<KustoQueryClient["executeQuery"]>>): Record<string, unknown> | undefined {
  const table = result.primaryResults[0];
  const row = table ? [...table.rows()][0] : undefined;
  if (!table || !row) return undefined;
  return Object.fromEntries(table.columns.map((column) => [column.name, row.getValueAt(column.ordinal)]));
}

export class FabricAct3Runtime implements Act3Runtime {
  readonly authority = "fabric" as const;
  readonly #config: FabricRuntimeConfig;
  readonly #pool: SqlPool;
  readonly #kusto: KustoQueryClient;

  constructor(config: FabricRuntimeConfig, pool?: SqlPool, kusto?: KustoQueryClient) {
    this.#config = config;
    this.#pool = pool ?? new sql.ConnectionPool({
      server: config.sqlServer,
      database: config.sqlDatabase,
      port: 1433,
      authentication: {
        type: "azure-active-directory-default",
        options: config.managedIdentityClientId ? { clientId: config.managedIdentityClientId } : undefined,
      },
      options: { encrypt: true },
    }) as unknown as SqlPool;
    const credential = new DefaultAzureCredential(
      config.managedIdentityClientId ? { managedIdentityClientId: config.managedIdentityClientId } : undefined,
    );
    const connection = KustoConnectionStringBuilder.withTokenCredential(config.kustoCluster, credential);
    this.#kusto = kusto ?? new KustoClient(connection);
  }

  async connect(): Promise<void> {
    await this.#pool.connect();
    await this.getSnapshot();
  }

  async getSnapshot(): Promise<Act3Snapshot> {
    const result = await this.#pool.request().query(`
      SELECT TOP (1) * FROM dbo.vw_capacity_conflict ORDER BY shortfallUnits DESC, lineId;
      SELECT TOP (1) maintenanceWindowId, lineId, deferralDays
      FROM dbo.maintenance_windows WHERE insideCampaignPeriod = 1 ORDER BY maintenanceWindowId;
      SELECT TOP (1) dc.caseId
      FROM dbo.decision_cases AS dc
      INNER JOIN dbo.vw_capacity_conflict AS conflict ON conflict.lineId = dc.lineId
      ORDER BY dc.openedAt DESC, dc.caseId;
      SELECT po.*, mpe.projectedStressPctOfThreshold, mpe.stressCeilingPct, mpe.policyPass
      FROM dbo.production_options AS po
      LEFT JOIN dbo.maintenance_policy_evaluations AS mpe ON mpe.optionId = po.optionId
      ORDER BY po.optionId;
    `);
    const [conflicts = [], windows = [], cases = [], optionRows = []] = result.recordsets;
    const conflict = conflicts[0];
    const maintenance = windows[0];
    const decisionCase = cases[0];
    if (!conflict || !maintenance || !decisionCase || optionRows.length === 0) {
      throw new Error("Fabric SQL did not return the Act 3 case, conflict, maintenance window, and options.");
    }

    const options: ProductionOption[] = optionRows.map((row) => ({
      optionId: stringValue(row.optionId, "optionId"),
      name: stringValue(row.optionName, "optionName"),
      requiredRateFactor: numberValue(row.requiredRateFactor, "requiredRateFactor"),
      requiredUtilisation: numberValue(row.requiredUtilisation, "requiredUtilisation"),
      incrementalUnitsDelivered: numberValue(row.incrementalUnitsDelivered, "incrementalUnitsDelivered"),
      shortfallUnits: numberValue(row.shortfallUnits, "shortfallUnits"),
      effectOnExistingOrders: stringValue(row.effectOnExistingOrders, "effectOnExistingOrders"),
      policyCompliant: booleanValue(row.policyCompliant) && booleanValue(row.policyPass ?? true),
      recommended: booleanValue(row.recommended),
      secondaryApproverRole: typeof row.secondaryApproverRole === "string" ? row.secondaryApproverRole : undefined,
      ...row,
    }));
    const recommendedOption = options.find((option) => option.recommended && option.policyCompliant);
    if (!recommendedOption) {
      throw new Error("Fabric SQL returned no recommended policy-compliant production option.");
    }

    const lineId = stringValue(conflict.lineId, "lineId");
    const telemetry = await this.#getTelemetry(lineId);
    const projectedStress = numberValue(
      optionRows.find((row) => row.optionId === recommendedOption.optionId)?.projectedStressPctOfThreshold,
      "projectedStressPctOfThreshold",
    );
    const stressCeiling = numberValue(
      optionRows.find((row) => row.optionId === recommendedOption.optionId)?.stressCeilingPct,
      "stressCeilingPct",
    );

    return {
      caseId: stringValue(decisionCase.caseId, "caseId"),
      lineId,
      maintenanceWindowId: stringValue(maintenance.maintenanceWindowId, "maintenanceWindowId"),
      capacityWithoutMaintenanceUnits: numberValue(conflict.capacityWithoutMaintenanceUnits, "capacityWithoutMaintenanceUnits"),
      capacityWithMaintenanceUnits: numberValue(conflict.capacityWithMaintenanceUnits, "capacityWithMaintenanceUnits"),
      headroomWithoutMaintenanceUnits: numberValue(conflict.headroomWithoutMaintenanceUnits, "headroomWithoutMaintenanceUnits"),
      headroomWithMaintenanceUnits: numberValue(conflict.headroomWithMaintenanceUnits, "headroomWithMaintenanceUnits"),
      requiredIncrementalUnits: numberValue(conflict.requiredIncrementalUnits, "requiredIncrementalUnits"),
      shortfallUnits: numberValue(conflict.shortfallUnits, "shortfallUnits"),
      deferralDays: numberValue(maintenance.deferralDays, "deferralDays"),
      projectedStressPctOfThreshold: projectedStress,
      stressCeilingPct: stressCeiling,
      recommendedOption,
      options,
      telemetry,
      source: {
        mode: "fabric",
        sqlDatabase: this.#config.sqlDatabase,
        eventhouseDatabase: this.#config.kustoDatabase,
        retrievedAt: new Date().toISOString(),
      },
    };
  }

  async applyProductionPlan(command: ActionCommand, actorObjectId: string): Promise<ActionReceipt> {
    return this.#execute("production_plan_change", command, actorObjectId);
  }

  async deferMaintenance(command: ActionCommand, actorObjectId: string): Promise<ActionReceipt> {
    return this.#execute("maintenance_deferral", command, actorObjectId);
  }

  async #getTelemetry(lineId: string): Promise<LiveLineTelemetry | undefined> {
    if (!/^[A-Za-z0-9_-]+$/.test(lineId)) {
      throw new Error("Fabric SQL returned an unsafe line identifier.");
    }
    const result = await this.#kusto.executeQuery(this.#config.kustoDatabase, `
      LineSignals
      | where lineId == '${lineId}'
      | top 1 by timestamp desc
      | project observedAt=timestamp, actualRateUnitsPerMin, rateFactor, utilisation, cumulativeStressIndex, state
    `);
    const row = mapKustoRow(result);
    if (!row) return undefined;
    return {
      observedAt: new Date(row.observedAt as string | Date).toISOString(),
      actualRateUnitsPerMin: numberValue(row.actualRateUnitsPerMin, "actualRateUnitsPerMin"),
      rateFactor: numberValue(row.rateFactor, "rateFactor"),
      utilisation: numberValue(row.utilisation, "utilisation"),
      cumulativeStressIndex: numberValue(row.cumulativeStressIndex, "cumulativeStressIndex"),
      state: stringValue(row.state, "state"),
    };
  }

  async #execute(actionType: string, command: ActionCommand, actorObjectId: string): Promise<ActionReceipt> {
    const snapshot = await this.getSnapshot();
    const request = this.#pool.request();
    request.input("invocationId", sql.VarChar(80), command.actionId);
    request.input("correlationId", sql.VarChar(120), command.correlationId);
    request.input("actionType", sql.VarChar(50), actionType);
    request.input("actorObjectId", sql.VarChar(80), actorObjectId);
    request.input("actorRole", sql.VarChar(50), command.approval.role);
    request.input("approvedAt", sql.DateTime2, new Date(command.approval.approvedAt));
    request.input("optionId", sql.VarChar(30), snapshot.recommendedOption.optionId);
    request.input(
      "maintenanceWindowId",
      sql.VarChar(40),
      actionType === "maintenance_deferral" ? snapshot.maintenanceWindowId : null,
    );
    const result = await request.execute("dbo.execute_governed_action");
    const row = result.recordset[0];
    if (!row) throw new Error("Fabric SQL executed the action without returning a receipt.");
    return {
      receiptId: stringValue(row.receiptId, "receiptId"),
      actionId: stringValue(row.actionId, "actionId"),
      correlationId: stringValue(row.correlationId, "correlationId"),
      issuedAt: new Date(row.issuedAt as string | Date).toISOString(),
      approverRole: stringValue(row.approverRole, "approverRole"),
      policyId: stringValue(row.policyId, "policyId"),
      policyVersion: stringValue(row.policyVersion, "policyVersion"),
      outcome: "success",
      details: typeof row.detailsJson === "string" ? JSON.parse(row.detailsJson) : {},
    };
  }
}

export async function createFabricRuntimeFromEnv(env: NodeJS.ProcessEnv): Promise<FabricAct3Runtime> {
  const runtime = new FabricAct3Runtime(loadFabricRuntimeConfig(env));
  await runtime.connect();
  return runtime;
}