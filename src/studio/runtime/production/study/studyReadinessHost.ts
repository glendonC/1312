import {
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "../artifactStore.ts";
import type { RuntimeLedger } from "../journal.ts";
import type {
  StudyReadinessReasonCode,
  StudyReadinessReceipt,
  StudyReadinessReceiptIdentity,
} from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { reopenOwnedMediaStudy } from "./studySynthesisAudit.ts";

function receiptId(receipt: StudyReadinessReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `study-readiness-receipt:${canonicalSha256(body)}`;
}

export interface StudyReadinessAuditResult extends StudyReadinessReceiptIdentity {
  receipt: StudyReadinessReceipt;
}

/** Deterministic structural audit. It produces no score and makes no semantic-quality decision. */
export class StudyReadinessHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  async audit(studyId: string): Promise<StudyReadinessAuditResult> {
    const state = this.ledger.state();
    const study = state.ownedMediaStudies[studyId];
    if (!study) throw new Error(`Owned-media study ${studyId} is absent`);
    if (Object.values(state.studyReadiness).some((entry) => entry.studyId === studyId)) {
      throw new Error(`Owned-media study ${studyId} already has a readiness receipt`);
    }
    const planning = state.studyPlanningDecisions[study.planningDecisionId];
    if (!planning) throw new Error("Study readiness lost the exact planning decision identity");
    let reopened: StudyReadinessReceipt["reopened"] = {
      sourceArtifactIds: [],
      semanticEvidenceArtifactIds: [],
      reportArtifactIds: [],
      admissionIds: [],
      planningDecisionIds: [planning.id],
      executorIds: [study.executionId],
    };
    const reasons = new Set<StudyReadinessReasonCode>();
    let coverageIds = [...study.coverageIds];
    let conflictIds = [...study.conflictIds];
    try {
      const verified = await reopenOwnedMediaStudy(state, this.artifacts, studyId);
      reopened = verified.reopened;
      coverageIds = verified.envelope.coverage.map((entry) => entry.coverageId);
      conflictIds = verified.envelope.conflicts.map((entry) => entry.conflictId);
      if (verified.envelope.coverage.some((entry) => entry.state !== "supported")) reasons.add("non_supported_root_coverage");
      if (verified.envelope.conflicts.length > 0) reasons.add("unresolved_conflict");
      if (coverageIds.length !== planning.coverageIds.length || planning.coverageIds.some((id) => !coverageIds.includes(id))) {
        reasons.add("hidden_gap");
      }
    } catch {
      reasons.add("stored_content_integrity_failed");
    }
    const reasonCodes = [...reasons].sort();
    const outcome = reasonCodes.length === 0 ? "proceed_to_caption_review" as const : "withheld" as const;
    const readinessId = `study-readiness:${canonicalSha256({
      runId: state.runId,
      studyId,
      studyArtifactId: study.artifactId,
      studyContentId: study.contentId,
      outcome,
      reasonCodes,
    })}`;
    const receipt: StudyReadinessReceipt = {
      schema: "studio.study-readiness.receipt.v1",
      receiptId: "pending",
      readinessId,
      input: {
        studyId,
        artifactId: study.artifactId,
        contentId: study.contentId,
        executorReceiptId: study.executorReceiptId,
        executorReceiptContentId: study.executorReceiptContentId,
        planningDecisionId: planning.id,
        planningReceiptId: planning.receiptId,
        planningReceiptContentId: planning.receiptContentId,
      },
      reopened,
      producer: { id: "studio.deterministic-study-readiness-audit", version: "1", policy: "closed_gap_and_integrity_gate_no_quality_score" },
      result: { outcome, reasonCodes, coverageIds, conflictIds },
      nonClaims: { semanticCorrectness: "not_assessed", translationQuality: "not_assessed", truthArbitration: "not_performed" },
    };
    receipt.receiptId = receiptId(receipt);
    const stored = await this.artifacts.storeJson(receipt);
    const artifact = this.artifacts.buildStudyReadinessArtifact({ runId: state.runId, studyId, receipt, storedReceipt: stored });
    await this.ledger.transact(
      { producer: { kind: "study_audit_host", id: "deterministic-study-readiness-host" }, causationId: studyId },
      ({ state: current }) => {
        if (Object.values(current.studyReadiness).some((entry) => entry.studyId === studyId)) {
          throw new Error(`Owned-media study ${studyId} already has a readiness receipt`);
        }
        return {
          pending: [
            { type: "artifact.recorded", data: { artifact } },
            { type: "study.readiness_audited", data: { studyId, outputArtifactId: artifact.id, receiptContentId: stored.content.contentId, receipt } },
          ] satisfies PendingRuntimeEvent[],
          result: undefined,
        };
      },
    );
    return {
      readinessId,
      artifactId: artifact.id,
      receiptId: receipt.receiptId,
      receiptContentId: stored.content.contentId,
      receipt,
    };
  }
}
