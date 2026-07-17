import { canonicalJsonContentId, canonicalSha256, ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { GeneralizedEvidenceAdmissionOptions } from "../admission/generalizedEvidenceAdmissionHost.ts";
import type { StudyReadinessReceiptV3 } from "../model.ts";
import type { RuntimeProjection } from "../model.ts";
import { validateStudyReadinessReceiptV3 } from "../validation/studiesV2.ts";
import {
  GeneralizedStudySynthesisHost,
  type GeneralizedStudySynthesisResult,
  type GeneralizedStudyV2Reference,
} from "./generalizedStudySynthesisHost.ts";

function same(left: unknown, right: unknown): boolean { return canonicalSha256(left) === canonicalSha256(right); }
function receiptId(receipt: StudyReadinessReceiptV3): string { const body = structuredClone(receipt) as unknown as Record<string, unknown>; delete body.schema; delete body.receiptId; return `study-readiness-receipt:${canonicalSha256(body)}`; }
async function storedJson(artifacts: ContentAddressedArtifactStore, contentId: string): Promise<unknown> { const bytes = await artifacts.receiptBytes(contentId); if (bytes.byteLength <= 0 || bytes.byteLength > 256 * 1024) throw new Error("Stored study readiness v3 exceeds its byte ceiling"); let value: unknown; try { value = JSON.parse(bytes.toString("utf8")) as unknown; } catch { throw new Error("Stored study readiness v3 is not valid JSON"); } if (canonicalJsonContentId(value) !== contentId) throw new Error("Stored study readiness v3 changed canonical identity"); return value; }

export interface GeneralizedReadinessV3Reference {
  readinessId: string;
  receiptId: string;
  receiptContentId: string;
  study: GeneralizedStudyV2Reference;
}
export interface GeneralizedReadinessV3Result extends GeneralizedReadinessV3Reference {
  receipt: StudyReadinessReceiptV3;
  reopenedStudy: GeneralizedStudySynthesisResult | null;
}

/** Deterministic integrity/coverage policy only. It performs no semantic or modality-quality QC. */
export class GeneralizedStudyReadinessHost {
  private readonly state: RuntimeProjection;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly synthesis: GeneralizedStudySynthesisHost;
  constructor(state: RuntimeProjection, artifacts: ContentAddressedArtifactStore, options: GeneralizedEvidenceAdmissionOptions = {}) {
    this.state = state; this.artifacts = artifacts; this.synthesis = new GeneralizedStudySynthesisHost(state, artifacts, options);
  }

  private async derive(reference: GeneralizedStudyV2Reference): Promise<{ receipt: StudyReadinessReceiptV3; study: GeneralizedStudySynthesisResult | null }> {
    let study: GeneralizedStudySynthesisResult | null = null; let integrityFailed = false;
    try { study = await this.synthesis.reopen(reference); } catch { integrityFailed = true; }
    const reasonCodes = new Set<StudyReadinessReceiptV3["result"]["reasonCodes"][number]>();
    if (integrityFailed) reasonCodes.add("stored_content_integrity_failed");
    if (study) {
      if (study.envelope.coverage.some((entry) => entry.state !== "supported" && entry.state !== "not_in_scope")) reasonCodes.add("non_supported_root_coverage");
      if (study.envelope.coverage.some((entry) => entry.preservedStates.includes("conflicting"))) reasonCodes.add("unresolved_conflict");
    }
    const reasons = [...reasonCodes].sort();
    const states = study ? [...new Set([
      ...study.envelope.coverage.flatMap((entry) => entry.preservedStates),
      ...study.envelope.evidenceCitations.map((entry) => entry.upstreamState),
    ])].sort() : [];
    const reopened = study ? {
      reportArtifactIds: study.envelope.reports.map((entry) => entry.report.artifactId).sort(),
      admissionIds: study.envelope.reports.map((entry) => entry.admission.admissionId).sort(),
      evidenceArtifactIds: [...new Set(study.envelope.evidenceCitations.map((entry) => entry.evidence.artifactId))].sort(),
      evidenceReceiptContentIds: [...new Set(study.envelope.evidenceCitations.map((entry) => entry.receipt.contentId))].sort(),
    } : { reportArtifactIds: [], admissionIds: [], evidenceArtifactIds: [], evidenceReceiptContentIds: [] };
    const outcome = reasons.length === 0 ? "proceed_to_caption_review" as const : "withheld" as const;
    const readinessId = `study-readiness:${canonicalSha256({ runId: this.state.runId, study: reference.study, outcome, reasons, states })}`;
    const receipt: StudyReadinessReceiptV3 = {
      schema: "studio.study-readiness.receipt.v3", receiptId: "pending", readinessId, runId: this.state.runId,
      input: structuredClone(reference.study), reopened,
      producer: { id: "studio.deterministic-study-readiness-audit", version: "3", policy: "generalized_state_integrity_and_coverage_gate_no_quality_score" },
      result: { outcome, reasonCodes: reasons, states, coverageIds: study?.envelope.coverage.map((entry) => entry.coverageId) ?? [] },
      nonClaims: { semanticCorrectness: "not_assessed", translationQuality: "not_assessed", truthArbitration: "not_performed" },
    };
    receipt.receiptId = receiptId(receipt); return { receipt: validateStudyReadinessReceiptV3(receipt), study };
  }

  async audit(reference: GeneralizedStudyV2Reference): Promise<GeneralizedReadinessV3Result> {
    const derived = await this.derive(reference); const stored = await this.artifacts.storeJson(derived.receipt);
    return { readinessId: derived.receipt.readinessId, receiptId: derived.receipt.receiptId, receiptContentId: stored.content.contentId, study: structuredClone(reference), receipt: derived.receipt, reopenedStudy: derived.study };
  }

  async reopen(reference: GeneralizedReadinessV3Reference): Promise<GeneralizedReadinessV3Result> {
    const value = await storedJson(this.artifacts, reference.receiptContentId); const receipt = validateStudyReadinessReceiptV3(value); const derived = await this.derive(reference.study);
    if (receipt.receiptId !== receiptId(receipt) || receipt.receiptId !== reference.receiptId || receipt.readinessId !== reference.readinessId || !same(receipt, derived.receipt)) throw new Error("Study readiness v3 changed its deterministic integrity/coverage result");
    return { ...structuredClone(reference), receipt, reopenedStudy: derived.study };
  }
}
