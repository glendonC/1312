import { canonicalJsonContentId, canonicalSha256, ContentAddressedArtifactStore } from "../artifactStore.ts";
import type {
  AdmittedStudyReportV2,
  EvidenceCitationEnvelope,
  GeneralizedCoverageReasonCode,
  GeneralizedCoverageState,
  OwnedMediaStudyArtifactV3,
  OwnedMediaStudyClaimV2,
  OwnedMediaStudyCoverageRangeV3,
  OwnedMediaStudyExecutorReceiptV3,
  OwnedMediaStudyV3Identity,
  RangePassRecord,
  RangePassTerminalOutcome,
  RuntimeProjection,
} from "../model.ts";
import { OWNED_MEDIA_STUDY_V3_LIMITS } from "../model.ts";
import { validateOwnedMediaStudyArtifactV3, validateOwnedMediaStudyExecutorReceiptV3 } from "../validation/studiesV3.ts";
import { GeneralizedStudySynthesisHost } from "./generalizedStudySynthesisHost.ts";


function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function normalized(value: string): string {
  return value.normalize("NFC").trim();
}

function receiptId(prefix: string, value: { schema: string; receiptId: string }): string {
  const body = structuredClone(value) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `${prefix}:${canonicalSha256(body)}`;
}

function weakState(outcome: RangePassTerminalOutcome): GeneralizedCoverageState {
  if (outcome === "unknown_exhausted") return "unknown";
  if (outcome === "withheld_exhausted") return "withheld";
  return "unavailable";
}

function reasonCode(state: GeneralizedCoverageState): GeneralizedCoverageReasonCode | null {
  if (state === "supported") return null;
  if (state === "unknown") return "evidence_unknown";
  if (state === "withheld") return "worker_withheld";
  if (state === "unavailable") return "evidence_unavailable";
  if (state === "truncated") return "evidence_truncated";
  if (state === "conflicting") return "evidence_conflicting";
  if (state === "failed") return "operation_failed";
  return "not_in_requested_scope";
}

async function storedJson(
  artifacts: ContentAddressedArtifactStore,
  contentId: string,
  maximumBytes: number,
  label: string,
): Promise<unknown> {
  const bytes = await artifacts.receiptBytes(contentId);
  if (bytes.byteLength <= 0 || bytes.byteLength > maximumBytes) throw new Error(`${label} exceeds its byte ceiling`);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (canonicalJsonContentId(value) !== contentId) throw new Error(`${label} changed canonical content identity`);
  return value;
}

export interface RestudiedStudySynthesisRequest {
  coverage: OwnedMediaStudyCoverageRangeV3[];
  claims: OwnedMediaStudyClaimV2[];
}

export interface RestudiedStudyV3Reference {
  study: OwnedMediaStudyV3Identity;
  executorReceiptId: string;
  executorReceiptContentId: string;
}

export interface RestudiedStudySynthesisResult extends RestudiedStudyV3Reference {
  envelope: OwnedMediaStudyArtifactV3;
  executorReceipt: OwnedMediaStudyExecutorReceiptV3;
}

interface RestudiedStudyInspection extends RestudiedStudySynthesisRequest {
  reports: AdmittedStudyReportV2[];
  passes: RangePassRecord[];
  root: OwnedMediaStudyArtifactV3["root"];
  evidenceCitations: EvidenceCitationEnvelope[];
  sourceArtifacts: OwnedMediaStudyArtifactV3["sourceArtifacts"];
}

/** U4 projection: retain pass history; only a pass-new exact speech closure can upgrade its executed subrange. */
export class RestudiedStudySynthesisHost {
  private readonly state: RuntimeProjection;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly rangePassHost: { reopen(pass: RangePassRecord): Promise<RangePassRecord> };

  constructor(state: RuntimeProjection, artifacts: ContentAddressedArtifactStore, rangePassHost: { reopen(pass: RangePassRecord): Promise<RangePassRecord> }) {
    this.state = state;
    this.artifacts = artifacts;
    this.rangePassHost = rangePassHost;
  }

  async inspect(admitted: readonly AdmittedStudyReportV2[]): Promise<RestudiedStudyInspection> {
    const parentTaskIds = new Set(admitted.map((entry) =>
      this.state.generalizedParentArtifactAdmissions[entry.admission.admissionId]?.parentTaskId).filter((entry): entry is string => typeof entry === "string"));
    if (parentTaskIds.size !== 1) throw new Error("Restudied synthesis requires admitted reports from one exact root");
    const parentTaskId = [...parentTaskIds][0];
    const projectedPasses = Object.values(this.state.rangePasses)
      .filter((entry) => entry.accepted && entry.request.root.taskId === parentTaskId)
      .sort((left, right) => left.request.passNumber - right.request.passNumber || left.id.localeCompare(right.id));
    const passes: RangePassRecord[] = [];
    for (const pass of projectedPasses) passes.push(await this.rangePassHost.reopen(pass));
    const passAdmissionIds = new Set(passes.map((entry) => entry.terminal!.evidence.admissionId).filter((entry): entry is string => entry !== null));
    const baseline = admitted.filter((entry) => !passAdmissionIds.has(entry.admission.admissionId));
    if (baseline.length < 2) throw new Error("Restudied synthesis requires at least two baseline admitted reports");

    const baselineInspection = await new GeneralizedStudySynthesisHost(this.state, this.artifacts).inspect(baseline);
    const completeInspection = await new GeneralizedStudySynthesisHost(this.state, this.artifacts).inspect(admitted);
    const claims: OwnedMediaStudyClaimV2[] = [];
    const coverage: OwnedMediaStudyCoverageRangeV3[] = [];

    for (const base of baselineInspection.coverage) {
      const pass = passes.find((entry) => entry.request.coverageId === base.coverageId) ?? null;
      const successful = pass?.terminal?.outcome === "supported_new_citations" ? pass : null;
      const boundaries = successful
        ? [...new Set([base.startMs, successful.request.delta.executionRange.startMs, successful.request.delta.executionRange.endMs, base.endMs])].sort((left, right) => left - right)
        : [base.startMs, base.endMs];

      for (let index = 0; index < boundaries.length - 1; index += 1) {
        const mediaRange = { artifactId: base.artifactId, trackId: base.trackId, startMs: boundaries[index], endMs: boundaries[index + 1] };
        const insideExecution = successful !== null && mediaRange.startMs >= successful.request.delta.executionRange.startMs && mediaRange.endMs <= successful.request.delta.executionRange.endMs;
        const preservedStates = [...new Set([
          ...base.preservedStates,
          ...(pass?.terminal
            ? pass.terminal.outcome === "supported_new_citations"
              ? insideExecution ? ["supported" as const] : []
              : [weakState(pass.terminal.outcome)]
            : []),
          ...(pass?.terminal?.evidence.disagreementCitationIds.length ? ["conflicting" as const] : []),
        ])].sort() as GeneralizedCoverageState[];
        let state: GeneralizedCoverageState = base.state;
        let claimIds: string[] = [];
        let citationIds = completeInspection.evidenceCitations
          .filter((citation) => citation.target.kind === "coverage" &&
            citation.target.range.artifactId === mediaRange.artifactId && citation.target.range.trackId === mediaRange.trackId &&
            citation.target.range.startMs === mediaRange.startMs && citation.target.range.endMs === mediaRange.endMs)
          .map((citation) => citation.citationId)
          .sort();

        if (insideExecution && successful) {
          const admissionId = successful.terminal!.evidence.admissionId;
          const report = completeInspection.reports.find((entry) => entry.admission.admissionId === admissionId);
          const newCitationIds = successful.terminal!.evidence.newCitationIds;
          const childClaim = report?.reportEnvelope.claims.find((entry) =>
            entry.artifactId === mediaRange.artifactId && entry.trackId === mediaRange.trackId &&
            entry.startMs === mediaRange.startMs && entry.endMs === mediaRange.endMs &&
            entry.citationIds.length === newCitationIds.length && entry.citationIds.every((id) => newCitationIds.includes(id)));
          if (!report || !childClaim) throw new Error(`Supported range pass ${successful.id} lost its exact pass-new claim`);
          const childClaims = [{
            admissionId: report.admission.admissionId,
            reportArtifactId: report.report.artifactId,
            reportContentId: report.report.contentId,
            claimId: childClaim.claimId,
          }];
          const statement = normalized(childClaim.statement);
          const claimId = `study-claim-v3:${canonicalSha256({ passId: successful.id, mediaRange, statement, childClaims, citationIds: newCitationIds })}`;
          claims.push({ claimId, ...mediaRange, statement: childClaim.statement, childClaims, citationIds: [...newCitationIds].sort() });
          state = "supported";
          claimIds = [claimId];
        } else if (base.state === "supported") {
          const baseClaims = baselineInspection.claims.filter((claim) => base.claimIds.includes(claim.claimId));
          if (baseClaims.length !== 1 || baseClaims[0].startMs !== mediaRange.startMs || baseClaims[0].endMs !== mediaRange.endMs) {
            throw new Error(`Baseline supported coverage ${base.coverageId} changed during U4 projection`);
          }
          claims.push(structuredClone(baseClaims[0]));
          claimIds = [baseClaims[0].claimId];
        } else if (pass?.terminal && !successful) {
          state = weakState(pass.terminal.outcome);
        }

        const code = reasonCode(state);
        const coverageBody = {
          baseCoverageId: base.coverageId,
          mediaRange,
          state,
          passIds: pass ? [pass.id] : [],
          preservedStates,
          claimIds,
          citationIds,
        };
        coverage.push({
          coverageId: `study-coverage-v3:${canonicalSha256(coverageBody)}`,
          ...mediaRange,
          state,
          preservedStates,
          rawStates: [...new Set([
            ...base.rawStates,
            ...(pass?.terminal ? [`range_pass_${pass.terminal.outcome}`] : []),
            ...(pass && !insideExecution && successful ? ["range_pass_residual_weak"] : []),
          ])].sort(),
          claimIds,
          citationIds,
          reason: code ? { code, detail: pass ? `Range pass ${pass.id} terminated as ${pass.terminal!.outcome}; this exact cell remains weak.` : `Preserved admitted state: ${state}.` } : null,
          passIds: pass ? [pass.id] : [],
        });
      }
    }

    return {
      reports: admitted.map((entry) => structuredClone(entry)),
      passes,
      root: structuredClone(completeInspection.root),
      coverage,
      claims,
      evidenceCitations: structuredClone(completeInspection.evidenceCitations),
      sourceArtifacts: structuredClone(completeInspection.sourceArtifacts),
    };
  }

  async synthesize(admitted: readonly AdmittedStudyReportV2[], request: RestudiedStudySynthesisRequest): Promise<RestudiedStudySynthesisResult> {
    const inspected = await this.inspect(admitted);
    if (!same(request.coverage, inspected.coverage) || !same(request.claims, inspected.claims)) {
      throw new Error("Restudied synthesis cannot rewrite pass history, disagreement, weak states, or citation support");
    }
    const envelope = validateOwnedMediaStudyArtifactV3({
      schema: "studio.owned-media-study.v3",
      runId: this.state.runId,
      root: inspected.root,
      reports: inspected.reports,
      passes: inspected.passes,
      coverage: request.coverage,
      claims: request.claims,
      evidenceCitations: inspected.evidenceCitations,
      sourceArtifacts: inspected.sourceArtifacts,
      limits: OWNED_MEDIA_STUDY_V3_LIMITS,
      nonClaims: {
        semanticCorrectness: "not_assessed",
        translationQuality: "not_assessed",
        truthArbitration: "not_performed",
        modalityReliabilityEquivalence: "not_claimed",
        independentCorroboration: "not_assessed",
        passCountImpliesUnderstanding: "not_claimed",
        publication: "not_authorized",
      },
    });
    const stored = await this.artifacts.storeJson(envelope);
    if (stored.content.bytes > OWNED_MEDIA_STUDY_V3_LIMITS.maxArtifactBytes) throw new Error("Owned-media study v3 exceeds its byte ceiling");
    const studyId = `owned-media-study-v3:${canonicalSha256({ runId: this.state.runId, rootExecutionId: envelope.root.executionId, reports: envelope.reports, passIds: envelope.passes.map((entry) => entry.id), contentId: stored.content.contentId })}`;
    const identity: OwnedMediaStudyV3Identity = {
      studyId,
      artifactId: `artifact:${canonicalSha256({ runId: this.state.runId, studyId, kind: envelope.schema, contentId: stored.content.contentId })}`,
      contentId: stored.content.contentId,
      bytes: stored.content.bytes,
      schema: "studio.owned-media-study.v3",
    };
    const executorReceipt: OwnedMediaStudyExecutorReceiptV3 = {
      schema: "studio.owned-media-study.executor-receipt.v3",
      receiptId: "pending",
      runId: this.state.runId,
      input: {
        reportArtifactIds: admitted.map((entry) => entry.report.artifactId),
        admissionIds: admitted.map((entry) => entry.admission.admissionId),
        passIds: inspected.passes.map((entry) => entry.id),
      },
      output: identity,
      producer: { id: "studio.restudied-study-synthesis", version: "3", policy: "retain_all_passes_and_only_upgrade_with_new_range_closing_speech_citations" },
      nonClaims: { semanticCorrectness: "not_assessed", truthArbitration: "not_performed" },
    };
    executorReceipt.receiptId = receiptId("owned-media-study-executor-receipt-v3", executorReceipt);
    validateOwnedMediaStudyExecutorReceiptV3(executorReceipt);
    const storedReceipt = await this.artifacts.storeJson(executorReceipt);
    return { study: identity, executorReceiptId: executorReceipt.receiptId, executorReceiptContentId: storedReceipt.content.contentId, envelope, executorReceipt };
  }

  async reopen(reference: RestudiedStudyV3Reference): Promise<RestudiedStudySynthesisResult> {
    const [studyValue, receiptValue] = await Promise.all([
      storedJson(this.artifacts, reference.study.contentId, OWNED_MEDIA_STUDY_V3_LIMITS.maxArtifactBytes, "Stored owned-media study v3"),
      storedJson(this.artifacts, reference.executorReceiptContentId, 256 * 1024, "Stored owned-media study executor receipt v3"),
    ]);
    const envelope = validateOwnedMediaStudyArtifactV3(studyValue);
    const executorReceipt = validateOwnedMediaStudyExecutorReceiptV3(receiptValue);
    const inspected = await this.inspect(envelope.reports);
    const expectedEnvelope = validateOwnedMediaStudyArtifactV3({ ...envelope, root: inspected.root, passes: inspected.passes, coverage: inspected.coverage, claims: inspected.claims, evidenceCitations: inspected.evidenceCitations, sourceArtifacts: inspected.sourceArtifacts });
    const expectedStudyId = `owned-media-study-v3:${canonicalSha256({ runId: this.state.runId, rootExecutionId: envelope.root.executionId, reports: envelope.reports, passIds: envelope.passes.map((entry) => entry.id), contentId: reference.study.contentId })}`;
    const expectedArtifactId = `artifact:${canonicalSha256({ runId: this.state.runId, studyId: expectedStudyId, kind: envelope.schema, contentId: reference.study.contentId })}`;
    if (!same(envelope, expectedEnvelope) || canonicalJsonContentId(envelope) !== reference.study.contentId ||
        expectedStudyId !== reference.study.studyId || expectedArtifactId !== reference.study.artifactId ||
        executorReceipt.receiptId !== receiptId("owned-media-study-executor-receipt-v3", executorReceipt) ||
        executorReceipt.receiptId !== reference.executorReceiptId || !same(executorReceipt.output, reference.study) ||
        !same(executorReceipt.input.reportArtifactIds, envelope.reports.map((entry) => entry.report.artifactId)) ||
        !same(executorReceipt.input.admissionIds, envelope.reports.map((entry) => entry.admission.admissionId)) ||
        !same(executorReceipt.input.passIds, envelope.passes.map((entry) => entry.id))) {
      throw new Error("Owned-media study v3 changed report, pass, state, citation, artifact, or executor receipt identity");
    }
    return { ...structuredClone(reference), envelope, executorReceipt };
  }
}
