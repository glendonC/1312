import type { CapabilityGrant } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";

export function invariant(condition: unknown, event: RuntimeEvent, message: string): asserts condition {
  if (!condition) throw new Error(`Runtime event ${event.eventId}: ${message}`);
}

export function sameGrants(left: CapabilityGrant[], right: CapabilityGrant[]): boolean {
  const canonical = (grants: CapabilityGrant[]) =>
    [...grants]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((grant) => ({
        ...grant,
        mediaScope: [...grant.mediaScope],
        evidenceScope: [...grant.evidenceScope],
      }));
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
