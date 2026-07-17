import { canonicalJsonContentId, canonicalSha256, ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { RuntimeLedger } from "../journal.ts";
import type { StudyReadinessReceiptV4 } from "../model.ts";
import { validateStudyReadinessReceiptV4 } from "../validation/studiesV3.ts";
import type { RuntimeProjection } from "../model.ts";
import { reopenRangePass } from "./rangePassHost.ts";
import {
  RestudiedStudySynthesisHost,
  type RestudiedStudySynthesisResult,
  type RestudiedStudyV3Reference,
} from "./restudiedStudySynthesisHost.ts";

function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function receiptId(receipt: StudyReadinessReceiptV4): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `study-readiness-receipt-v4:${canonicalSha256(body)}`;
}

async function storedJson(artifacts: ContentAddressedArtifactStore, contentId: string): Promise<unknown> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > 256 * 1024) throw new Error("Stored study readiness v4 exceeds its byte ceiling");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Stored study readiness v4 is not valid JSON");
  }
  if (canonicalJsonContentId(value) !== contentId) throw new Error("Stored study readiness v4 changed canonical identity");
  return value;
}

export interface RestudiedReadinessV4Reference {
  readinessId: string;
  receiptId: string;
  receiptContentId: string;
  study: RestudiedStudyV3Reference;
}

export interface RestudiedReadinessV4Result extends RestudiedReadinessV4Reference {
  receipt: StudyReadinessReceiptV4;
  reopenedStudy: RestudiedStudySynthesisResult | null;
}

/** V4 integrity gate: terminal weak cells remain line-level weak and do not globally withhold supported cells. */
export class RestudiedStudyReadinessHost {
  private readonly synthesis: RestudiedStudySynthesisHost;
  private readonly state: RuntimeProjection;
  private readonly runId: string;
  private readonly artifacts: ContentAddressedArtifactStore;

  constructor(ledgerOrState: RuntimeLedger | RuntimeProjection, artifacts: ContentAddressedArtifactStore) {
    this.artifacts = artifacts;
    this.state = "state" in ledgerOrState && typeof ledgerOrState.state === "function" ? ledgerOrState.state() : ledgerOrState as RuntimeProjection;
    this.runId = this.state.runId;
    this.synthesis = new RestudiedStudySynthesisHost(this.state, artifacts, { reopen: (pass) => reopenRangePass(artifacts, pass) });
  }

  private async derive(reference: RestudiedStudyV3Reference): Promise<{ receipt: StudyReadinessReceiptV4; study: RestudiedStudySynthesisResult | null }> {
    let study: RestudiedStudySynthesisResult | null = null;
    let integrityFailed = false;
    try {
      study = await this.synthesis.reopen(reference);
    } catch {
      integrityFailed = true;
    }
    const reasonCodes = new Set<StudyReadinessReceiptV4["result"]["reasonCodes"][number]>();
    if (integrityFailed) reasonCodes.add("stored_content_integrity_failed");
    if (study?.envelope.coverage.some((entry) => entry.preservedStates.includes("conflicting"))) reasonCodes.add("unresolved_conflict");
    const reasons = [...reasonCodes].sort();
    const states = study ? [...new Set([
      ...study.envelope.coverage.flatMap((entry) => entry.preservedStates),
      ...study.envelope.evidenceCitations.map((entry) => entry.upstreamState),
    ])].sort() : [];
    const terminalWeakCoverageIds = study?.envelope.coverage
      .filter((entry) => entry.state !== "supported" && entry.state !== "not_in_scope")
      .map((entry) => entry.coverageId) ?? [];
    const reopened = study ? {
      reportArtifactIds: study.envelope.reports.map((entry) => entry.report.artifactId).sort(),
      admissionIds: study.envelope.reports.map((entry) => entry.admission.admissionId).sort(),
      evidenceArtifactIds: [...new Set(study.envelope.evidenceCitations.map((entry) => entry.evidence.artifactId))].sort(),
      evidenceReceiptContentIds: [...new Set(study.envelope.evidenceCitations.map((entry) => entry.receipt.contentId))].sort(),
      passIds: study.envelope.passes.map((entry) => entry.id),
      passRequestReceiptContentIds: study.envelope.passes.map((entry) => entry.requestReceiptContentId),
      passTerminalReceiptContentIds: study.envelope.passes.map((entry) => entry.terminalReceiptContentId!),
    } : {
      reportArtifactIds: [], admissionIds: [], evidenceArtifactIds: [], evidenceReceiptContentIds: [],
      passIds: [], passRequestReceiptContentIds: [], passTerminalReceiptContentIds: [],
    };
    const outcome = reasons.length === 0 ? "proceed_to_caption_review" as const : "withheld" as const;
    const readinessId = `study-readiness-v4:${canonicalSha256({ runId: this.runId, study: reference.study, outcome, reasons, states, terminalWeakCoverageIds })}`;
    const receipt: StudyReadinessReceiptV4 = {
      schema: "studio.study-readiness.receipt.v4",
      receiptId: "pending",
      readinessId,
      runId: this.runId,
      input: structuredClone(reference.study),
      reopened,
      producer: { id: "studio.deterministic-restudied-study-readiness-audit", version: "4", policy: "terminal_weak_ranges_do_not_block_unrelated_supported_ranges_no_quality_score" },
      result: {
        outcome,
        reasonCodes: reasons,
        states,
        coverageIds: study?.envelope.coverage.map((entry) => entry.coverageId) ?? [],
        terminalWeakCoverageIds,
      },
      nonClaims: { semanticCorrectness: "not_assessed", translationQuality: "not_assessed", truthArbitration: "not_performed", terminalWeaknessImpliesGlobalFailure: "not_claimed" },
    };
    receipt.receiptId = receiptId(receipt);
    return { receipt: validateStudyReadinessReceiptV4(receipt), study };
  }

  async audit(reference: RestudiedStudyV3Reference): Promise<RestudiedReadinessV4Result> {
    const derived = await this.derive(reference);
    const stored = await this.artifacts.storeJson(derived.receipt);
    return { readinessId: derived.receipt.readinessId, receiptId: derived.receipt.receiptId, receiptContentId: stored.content.contentId, study: structuredClone(reference), receipt: derived.receipt, reopenedStudy: derived.study };
  }

  async reopen(reference: RestudiedReadinessV4Reference): Promise<RestudiedReadinessV4Result> {
    const receipt = validateStudyReadinessReceiptV4(await storedJson(this.artifacts, reference.receiptContentId));
    const derived = await this.derive(reference.study);
    if (receipt.receiptId !== receiptId(receipt) || receipt.receiptId !== reference.receiptId || receipt.readinessId !== reference.readinessId || !same(receipt, derived.receipt)) {
      throw new Error("Study readiness v4 changed its deterministic pass/coverage integrity result");
    }
    return { ...structuredClone(reference), receipt, reopenedStudy: derived.study };
  }
}
