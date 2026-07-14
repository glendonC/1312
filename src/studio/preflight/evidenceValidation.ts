import type { MediaProbeReceipt, IngestReceipt } from "../types";
import type { LanguageRangesReceipt, PreflightBundle, SpeechActivityReceipt } from "./contracts";
import { assertLanguageRangesReceipt } from "./languageReceiptValidation";
import { assertPreflightBundle } from "./preflightBundleValidation";
import { assertSpeechActivityReceipt } from "./speechReceiptValidation";
import { preflightSourceBinding } from "./sourceAdapters";

export interface PreflightEvidenceCarrier {
  ingestReceipt?: IngestReceipt | null;
  mediaProbe?: MediaProbeReceipt | null;
  preflightBundle?: PreflightBundle | null;
  speechActivity?: SpeechActivityReceipt | null;
  languageRanges?: LanguageRangesReceipt | null;
}

function schemaOf(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>).schema;
}

/**
 * Validate optional detector evidence as one unit at a transport or fixture boundary.
 * V1 remains source/probe-only, V2 requires speech, and V3 requires speech plus language. Detector
 * receipts cannot be presented downstream without their exact index generation and source binding.
 */
export function assertPreflightEvidence(
  value: PreflightEvidenceCarrier,
  context = "Studio preflight evidence",
): void {
  const preflightBundle = value.preflightBundle ?? null;
  const speechActivity = value.speechActivity ?? null;
  const languageRanges = value.languageRanges ?? null;
  if (preflightBundle === null && speechActivity === null && languageRanges === null) return;

  const binding = preflightSourceBinding(value.ingestReceipt ?? null);
  if (!binding) {
    throw new Error(`${context}: evidence has no content-addressed source adapter`);
  }

  if (preflightBundle === null) {
    if (languageRanges !== null) {
      throw new Error(`${context}: language receipt requires studio.preflight-bundle.v3`);
    }
    throw new Error(`${context}: speech receipt requires studio.preflight-bundle.v2 or v3`);
  }

  const schema = schemaOf(preflightBundle);
  if (schema === "studio.preflight-bundle.v3") {
    if (speechActivity === null) {
      throw new Error(`${context}: studio.preflight-bundle.v3 requires its speech receipt`);
    }
    if (languageRanges === null) {
      throw new Error(`${context}: studio.preflight-bundle.v3 requires its language receipt`);
    }
    if (!value.mediaProbe) {
      throw new Error(`${context}: detector receipts require a validated media-probe receipt`);
    }
    assertSpeechActivityReceipt(speechActivity, binding, value.mediaProbe, `${context} speech receipt`);
    assertLanguageRangesReceipt(
      languageRanges,
      binding,
      value.mediaProbe,
      speechActivity,
      `${context} language receipt`,
    );
    assertPreflightBundle(preflightBundle, binding, `${context} index`, speechActivity, languageRanges);
    return;
  }

  if (schema === "studio.preflight-bundle.v2") {
    if (languageRanges !== null) {
      throw new Error(`${context}: language receipt requires studio.preflight-bundle.v3`);
    }
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

  if (schema === "studio.preflight-bundle.v1") {
    if (speechActivity !== null || languageRanges !== null) {
      throw new Error(`${context}: studio.preflight-bundle.v1 forbids detector receipts`);
    }
    assertPreflightBundle(preflightBundle, binding, `${context} index`);
    return;
  }

  assertPreflightBundle(preflightBundle, binding, `${context} index`);
}
