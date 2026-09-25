import type { ActionCommand, ActionReceipt } from "./action-service.ts";
import type { Act3Snapshot } from "./domain.ts";

export interface Act3Runtime {
  readonly authority: "fixture" | "fabric";
  getSnapshot(): Promise<Act3Snapshot>;
  applyProductionPlan(command: ActionCommand, actorObjectId: string): Promise<ActionReceipt>;
  deferMaintenance(command: ActionCommand, actorObjectId: string): Promise<ActionReceipt>;
}