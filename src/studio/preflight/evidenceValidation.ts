import type { MediaProbeReceipt, IngestReceipt } from "../types";
import type { PreflightBundle, SpeechActivityReceipt } from "./contracts";
import { assertPreflightBundle } from "./preflightBundleValidation";
import { assertSpeechActivityReceipt } from "./speechReceiptValidation";
import { preflightSourceBinding } from "./sourceAdapters";

export interface PreflightEvidenceCarrier {
  ingestReceipt?: IngestReceipt | null;
  mediaProbe?: MediaProbeReceipt | null;
  preflightBundle?: PreflightBundle | null;
  speechActivity?: SpeechActivityReceipt | null;
}

function schemaOf(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>).schema;
}

/**
 * Validate optional detector evidence as one unit at a transport or fixture boundary.
 * V1 remains a valid source/probe-only index. V2 and its receipt are inseparable, so neither can
 * be presented downstream when its counterpart or provider-neutral source binding is absent.
 */
export function assertPreflightEvidence(
  value: PreflightEvidenceCarrier,
  context = "Studio preflight evidence",
): void {
  const preflightBundle = value.preflightBundle ?? null;
  const speechActivity = value.speechActivity ?? null;
  if (preflightBundle === null && speechActivity === null) return;

  const binding = preflightSourceBinding(value.ingestReceipt ?? null);
  if (!binding) {
    throw new Error(`${context}: evidence has no content-addressed source adapter`);
  }

  if (preflightBundle === null) {
    throw new Error(`${context}: speech receipt requires studio.preflight-bundle.v2`);
  }

  if (schemaOf(preflightBundle) === "studio.preflight-bundle.v2") {
    if (speechActivity === null) {
      throw new Error(`${context}: studio.preflight-bundle.v2 requires its speech receipt`);
    }
    if (!value.mediaProbe) {
      throw new Error(`${context}: speech receipt requires a validated media-probe receipt`);
    }
    assertSpeechActivityReceipt(speechActivity, binding, value.mediaProbe, `${context} speech receipt`);
    assertPreflightBundle(preflightBundle, binding, `${context} index`, speechActivity);
    return;
  }

  if (speechActivity !== null) {
    throw new Error(`${context}: speech receipt requires studio.preflight-bundle.v2`);
  }
  assertPreflightBundle(preflightBundle, binding, `${context} index`);
}
