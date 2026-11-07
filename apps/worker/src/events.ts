import { EventPayloads, type EventPayload, type EventType } from "@nologo/core";
import { mustOk, toJson, type Db } from "./db.ts";

// Validates the payload against its schema so the debug UI can trust what it receives.
export async function emit<T extends EventType>(
  db: Db,
  analysisId: string,
  type: T,
  payload: EventPayload<T>,
): Promise<void> {
  const valid: unknown = EventPayloads[type].parse(payload);
  mustOk(await db.rpc("emit_event", { p_analysis_id: analysisId, p_type: type, p_payload: toJson(valid) }), `emit ${type}`);
}
