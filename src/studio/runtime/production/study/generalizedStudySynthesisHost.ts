import { canonicalJsonContentId, canonicalSha256, ContentAddressedArtifactStore } from "../artifactStore.ts";
import {
  GeneralizedEvidenceAdmissionHost,
  type GeneralizedAdmissionResult,
  type GeneralizedEvidenceAdmissionOptions,
} from "../admission/generalizedEvidenceAdmissionHost.ts";
import type {
  AdmittedStudyReportV2,
  EvidenceCitationEnvelope,
  GeneralizedCoverageReasonCode,
  GeneralizedCoverageState,
  OwnedMediaStudyArtifactV2,
  OwnedMediaStudyClaimV2,
  OwnedMediaStudyCoverageRangeV2,
  OwnedMediaStudyExecutorReceiptV2,
  OwnedMediaStudyV2Identity,
  RuntimeProjection,
} from "../model.ts";
import { OWNED_MEDIA_STUDY_V2_LIMITS } from "../model.ts";
import { validateOwnedMediaStudyArtifactV2, validateOwnedMediaStudyExecutorReceiptV2 } from "../validation/studiesV2.ts";

function same(left: unknown, right: unknown): boolean { return canonicalSha256(left) === canonicalSha256(right); }
function normalizeStatement(value: string): string { return value.normalize("NFC").trim(); }

function receiptId(prefix: string, value: { schema: string; receiptId: string }): string {
  const body = structuredClone(value) as unknown as Record<string, unknown>; delete body.schema; delete body.receiptId;
  return `${prefix}:${canonicalSha256(body)}`;
}

const STATE_PRIORITY: Array<Exclude<GeneralizedCoverageState, "supported">> = [
  "conflicting", "failed", "truncated", "unavailable", "withheld", "unknown", "not_in_scope",
];
function aggregateState(states: Set<GeneralizedCoverageState>): GeneralizedCoverageState {
  if (states.size === 1 && states.has("not_in_scope")) return "not_in_scope";
  return STATE_PRIORITY.find((candidate) => states.has(candidate)) ?? "supported";
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

async function storedJson(artifacts: ContentAddressedArtifactStore, contentId: string, maximumBytes: number, label: string): Promise<unknown> {
  const bytes = await artifacts.receiptBytes(contentId); if (bytes.byteLength <= 0 || bytes.byteLength > maximumBytes) throw new Error(`${label} exceeds its byte ceiling`);
  let value: unknown; try { value = JSON.parse(bytes.toString("utf8")) as unknown; } catch { throw new Error(`${label} is not valid JSON`); }
  if (canonicalJsonContentId(value) !== contentId) throw new Error(`${label} changed canonical content identity`); return value;
}

export interface GeneralizedStudySynthesisRequest {
  coverage: OwnedMediaStudyCoverageRangeV2[];
  claims: OwnedMediaStudyClaimV2[];
}
export interface GeneralizedStudyV2Reference {
  study: OwnedMediaStudyV2Identity;
  executorReceiptId: string;
  executorReceiptContentId: string;
}
export interface GeneralizedStudySynthesisResult extends GeneralizedStudyV2Reference {
  envelope: OwnedMediaStudyArtifactV2;
  executorReceipt: OwnedMediaStudyExecutorReceiptV2;
}

interface InspectedSynthesis extends GeneralizedStudySynthesisRequest {
  reports: GeneralizedAdmissionResult[];
  root: OwnedMediaStudyArtifactV2["root"];
  evidenceCitations: EvidenceCitationEnvelope[];
  sourceArtifacts: OwnedMediaStudyArtifactV2["sourceArtifacts"];
}

/** Additive U3 synthesis; it has no modality arbitration and cannot author new citations or states. */
export class GeneralizedStudySynthesisHost {
  private readonly state: RuntimeProjection;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly admission: GeneralizedEvidenceAdmissionHost;

  constructor(state: RuntimeProjection, artifacts: ContentAddressedArtifactStore, options: GeneralizedEvidenceAdmissionOptions = {}) {
    this.state = state; this.artifacts = artifacts; this.admission = new GeneralizedEvidenceAdmissionHost(state, artifacts, options);
  }

  async inspect(admitted: readonly AdmittedStudyReportV2[]): Promise<InspectedSynthesis> {
    if (admitted.length === 0 || admitted.length > OWNED_MEDIA_STUDY_V2_LIMITS.maxReports) throw new Error("Generalized synthesis requires bounded admitted report input");
    const reports: GeneralizedAdmissionResult[] = [];
    for (const identity of admitted) reports.push(await this.admission.reopen(identity));
    const first = reports[0].reportEnvelope;
    const rootTask = this.state.tasks[first.parent.taskId];
    const rootExecution = Object.values(this.state.executions).find((entry) => entry.taskId === rootTask?.id && (entry.status === "active" || entry.status === "completed"));
    if (!rootTask || rootTask.parentTaskId !== null || rootTask.assignedAgentId !== first.parent.agentId || !rootExecution || rootExecution.agentId !== rootTask.assignedAgentId) {
      throw new Error("Generalized synthesis lost its current-run root task/executor authority");
    }
    if (reports.some((entry) => entry.reportEnvelope.parent.taskId !== rootTask.id || entry.reportEnvelope.parent.agentId !== rootTask.assignedAgentId || entry.reportEnvelope.assignment.source.artifactId !== rootTask.jobContext.source.artifactId || entry.reportEnvelope.assignment.source.contentId !== rootTask.jobContext.source.contentId)) {
      throw new Error("Generalized synthesis reports do not share one exact root/source parent");
    }
    const root: OwnedMediaStudyArtifactV2["root"] = {
      taskId: rootTask.id, agentId: rootTask.assignedAgentId, executionId: rootExecution.id,
      jobContextId: rootTask.jobContext.contextId, source: structuredClone(rootTask.jobContext.source), mediaScope: structuredClone(rootTask.mediaScope),
    };
    const coverage: OwnedMediaStudyCoverageRangeV2[] = [];
    const claims: OwnedMediaStudyClaimV2[] = [];
    for (const scope of root.mediaScope) {
      const boundaries = new Set([scope.startMs, scope.endMs]);
      for (const report of reports) for (const child of report.reportEnvelope.coverage) {
        if (child.artifactId === scope.artifactId && child.trackId === scope.trackId && child.startMs < scope.endMs && child.endMs > scope.startMs) {
          boundaries.add(Math.max(scope.startMs, child.startMs)); boundaries.add(Math.min(scope.endMs, child.endMs));
        }
      }
      const ordered = [...boundaries].sort((left, right) => left - right);
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const mediaRange = { artifactId: scope.artifactId, trackId: scope.trackId, startMs: ordered[index], endMs: ordered[index + 1] };
        const children = reports.flatMap((report) => report.reportEnvelope.coverage
          .filter((entry) => entry.artifactId === mediaRange.artifactId && entry.trackId === mediaRange.trackId && entry.startMs <= mediaRange.startMs && entry.endMs >= mediaRange.endMs)
          .map((entry) => ({ report, coverage: entry })));
        const preserved = new Set<GeneralizedCoverageState>(children.map((entry) => entry.coverage.state));
        if (preserved.size === 0) preserved.add("unknown");
        const childClaims = children.flatMap(({ report, coverage: childCoverage }) => childCoverage.claimIds.map((claimId) => {
          const childClaim = report.reportEnvelope.claims.find((entry) => entry.claimId === claimId);
          return childClaim ? { report, claim: childClaim } : null;
        }).filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry.claim.startMs === mediaRange.startMs && entry.claim.endMs === mediaRange.endMs));
        const statements = new Set(childClaims.map((entry) => normalizeStatement(entry.claim.statement)));
        if (statements.size > 1) preserved.add("conflicting");
        if (statements.size === 0 && [...preserved].every((entry) => entry === "supported")) preserved.add("unknown");
        const state = aggregateState(preserved);
        const rawStates = [...new Set([
          ...children.flatMap((entry) => entry.coverage.rawStates),
          ...(children.length === 0 ? ["unobserved_range"] : []),
          ...(statements.size > 1 ? ["conflicting_child_claim_statements"] : []),
        ])].sort();
        const coverageCitationIds = [...new Set(children.flatMap((entry) => entry.coverage.citationIds))].sort();
        const body = {
          range: mediaRange,
          reports: children.map((entry) => ({ admissionId: entry.report.admission.admissionId, state: entry.coverage.state, rawStates: entry.coverage.rawStates })),
          preservedStates: [...preserved].sort(),
        };
        const coverageId = `study-coverage:${canonicalSha256(body)}`;
        const reason = reasonCode(state);
        let claimIds: string[] = [];
        if (state === "supported") {
          const statement = childClaims[0]?.claim.statement;
          if (!statement) throw new Error("Supported generalized study range lost its child claim");
          const childClaimIdentities = childClaims.map(({ report, claim }) => ({ admissionId: report.admission.admissionId, reportArtifactId: report.report.artifactId, reportContentId: report.report.contentId, claimId: claim.claimId }));
          const citationIds = [...new Set(childClaims.flatMap((entry) => entry.claim.citationIds))].sort();
          const claimId = `study-claim:${canonicalSha256({ coverageId, statement, childClaimIdentities, citationIds })}`;
          claims.push({ claimId, ...mediaRange, statement, childClaims: childClaimIdentities, citationIds });
          claimIds = [claimId];
        }
        coverage.push({ coverageId, ...mediaRange, state, preservedStates: [...preserved].sort(), rawStates, claimIds, citationIds: coverageCitationIds, reason: reason ? { code: reason, detail: `Preserved admitted state: ${state}.` } : null });
      }
    }
    const citationMap = new Map<string, EvidenceCitationEnvelope>();
    for (const report of reports) for (const citation of report.reportEnvelope.evidenceCitations) {
      const prior = citationMap.get(citation.citationId); if (prior && !same(prior, citation)) throw new Error(`Citation ${citation.citationId} changed between admitted reports`);
      citationMap.set(citation.citationId, citation);
    }
    const evidenceCitations = [...citationMap.values()].sort((left, right) => left.citationId.localeCompare(right.citationId));
    const sourceMap = new Map<string, string>(); sourceMap.set(root.source.artifactId, root.source.contentId);
    for (const report of reports) sourceMap.set(report.report.artifactId, report.report.contentId);
    for (const citation of evidenceCitations) { sourceMap.set(citation.evidence.artifactId, citation.evidence.contentId); if (citation.receipt.artifactId) sourceMap.set(citation.receipt.artifactId, citation.receipt.contentId); }
    return { reports, root, coverage, claims, evidenceCitations, sourceArtifacts: [...sourceMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([artifactId, contentId]) => ({ artifactId, contentId })) };
  }

  async synthesize(admitted: readonly AdmittedStudyReportV2[], request: GeneralizedStudySynthesisRequest): Promise<GeneralizedStudySynthesisResult> {
    const inspected = await this.inspect(admitted);
    if (!same(request.coverage, inspected.coverage) || !same(request.claims, inspected.claims)) {
      throw new Error("Generalized synthesis cannot upgrade, rewrite, hide, or reorder deterministic admitted states and citations");
    }
    const envelope: OwnedMediaStudyArtifactV2 = validateOwnedMediaStudyArtifactV2({
      schema: "studio.owned-media-study.v2", runId: this.state.runId, root: inspected.root,
      reports: admitted.map((entry) => ({ report: structuredClone(entry.report), admission: structuredClone(entry.admission) })), coverage: request.coverage, claims: request.claims,
      evidenceCitations: inspected.evidenceCitations, sourceArtifacts: inspected.sourceArtifacts,
      limits: OWNED_MEDIA_STUDY_V2_LIMITS,
      nonClaims: { semanticCorrectness: "not_assessed", translationQuality: "not_assessed", truthArbitration: "not_performed", modalityReliabilityEquivalence: "not_claimed", independentCorroboration: "not_assessed", publication: "not_authorized" },
    });
    const stored = await this.artifacts.storeJson(envelope); if (stored.content.bytes > OWNED_MEDIA_STUDY_V2_LIMITS.maxArtifactBytes) throw new Error("Owned-media study v2 exceeds its byte ceiling");
    const studyId = `owned-media-study:${canonicalSha256({ runId: this.state.runId, rootExecutionId: envelope.root.executionId, reports: envelope.reports, contentId: stored.content.contentId })}`;
    const identity: OwnedMediaStudyV2Identity = { studyId, artifactId: `artifact:${canonicalSha256({ runId: this.state.runId, studyId, kind: envelope.schema, contentId: stored.content.contentId })}`, contentId: stored.content.contentId, bytes: stored.content.bytes, schema: "studio.owned-media-study.v2" };
    const executorReceipt: OwnedMediaStudyExecutorReceiptV2 = { schema: "studio.owned-media-study.executor-receipt.v2", receiptId: "pending", runId: this.state.runId, input: { reportArtifactIds: admitted.map((entry) => entry.report.artifactId), admissionIds: admitted.map((entry) => entry.admission.admissionId) }, output: identity, producer: { id: "studio.generalized-study-synthesis", version: "2", policy: "preserve_all_admitted_states_and_copy_only_audited_citations" }, nonClaims: { semanticCorrectness: "not_assessed", truthArbitration: "not_performed" } };
    executorReceipt.receiptId = receiptId("owned-media-study-executor-receipt", executorReceipt); validateOwnedMediaStudyExecutorReceiptV2(executorReceipt);
    const storedReceipt = await this.artifacts.storeJson(executorReceipt);
    return { study: identity, executorReceiptId: executorReceipt.receiptId, executorReceiptContentId: storedReceipt.content.contentId, envelope, executorReceipt };
  }

  async reopen(reference: GeneralizedStudyV2Reference): Promise<GeneralizedStudySynthesisResult> {
    const [studyValue, receiptValue] = await Promise.all([
      storedJson(this.artifacts, reference.study.contentId, OWNED_MEDIA_STUDY_V2_LIMITS.maxArtifactBytes, "Stored owned-media study v2"),
      storedJson(this.artifacts, reference.executorReceiptContentId, 256 * 1024, "Stored owned-media study executor receipt v2"),
    ]);
    const envelope = validateOwnedMediaStudyArtifactV2(studyValue); const executorReceipt = validateOwnedMediaStudyExecutorReceiptV2(receiptValue);
    const inspected = await this.inspect(envelope.reports);
    const expectedEnvelope = validateOwnedMediaStudyArtifactV2({ ...envelope, root: inspected.root, coverage: inspected.coverage, claims: inspected.claims, evidenceCitations: inspected.evidenceCitations, sourceArtifacts: inspected.sourceArtifacts });
    const expectedStudyId = `owned-media-study:${canonicalSha256({ runId: this.state.runId, rootExecutionId: envelope.root.executionId, reports: envelope.reports, contentId: reference.study.contentId })}`;
    const expectedArtifactId = `artifact:${canonicalSha256({ runId: this.state.runId, studyId: expectedStudyId, kind: envelope.schema, contentId: reference.study.contentId })}`;
    if (!same(envelope, expectedEnvelope) || canonicalJsonContentId(envelope) !== reference.study.contentId || expectedStudyId !== reference.study.studyId || expectedArtifactId !== reference.study.artifactId || executorReceipt.receiptId !== receiptId("owned-media-study-executor-receipt", executorReceipt) || executorReceipt.receiptId !== reference.executorReceiptId || !same(executorReceipt.output, reference.study) || !same(executorReceipt.input.reportArtifactIds, envelope.reports.map((entry) => entry.report.artifactId)) || !same(executorReceipt.input.admissionIds, envelope.reports.map((entry) => entry.admission.admissionId))) {
      throw new Error("Owned-media study v2 changed admitted state, citation, artifact, or executor receipt identity");
    }
    return { ...structuredClone(reference), envelope, executorReceipt };
  }
}
