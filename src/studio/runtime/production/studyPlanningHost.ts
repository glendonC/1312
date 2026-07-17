import {
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  RuntimeProjection,
  StudyCoverageReasonCode,
  StudyPlanningDecisionReceipt,
  StudyPlanningDecisionRequest,
  StudyPlanningInput,
  StudyPlanningReportInput,
  StudyReportArtifact,
} from "./model.ts";
import { reopenParentArtifactDisposition } from "./parentArtifactAdmissionAudit.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import { validateStudyPlanningDecisionRequest } from "./validation/studies.ts";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function planningReceiptId(receipt: StudyPlanningDecisionReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `study-planning-receipt:${canonicalSha256(body)}`;
}

interface PlanningReport {
  input: StudyPlanningReportInput;
  envelope: StudyReportArtifact;
}

async function planningReports(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  rootTaskId: string,
  rootAgentId: string,
  reportIds?: readonly string[],
): Promise<PlanningReport[]> {
  const selected = Object.values(state.parentArtifactReads)
    .filter((read) => read.parentTaskId === rootTaskId && read.parentAgentId === rootAgentId && read.status === "completed")
    .map((read) => ({ read, grant: state.parentArtifactReadGrants[read.grantId] }))
    .filter((entry) => entry.grant && (!reportIds || reportIds.includes(entry.grant.reportId)))
    .sort((left, right) => left.grant.reportId.localeCompare(right.grant.reportId));
  if (reportIds && (selected.length !== reportIds.length || reportIds.some((id) => !selected.some((entry) => entry.grant.reportId === id)))) {
    throw new Error("Study planning input lost one of its exact admitted artifact reads");
  }
  const results: PlanningReport[] = [];
  for (const { read, grant } of selected) {
    const disposition = state.parentArtifactDispositions[grant.dispositionId];
    if (
      !disposition || disposition.outcome !== "accepted" || !disposition.admissionId ||
      !disposition.admissionReceiptId || !disposition.admissionReceiptContentId ||
      !read.receiptId || read.returnedContentIds.length !== 1 ||
      read.returnedContentIds[0] !== grant.contentScope[0]?.contentId
    ) throw new Error("Study planning requires completed reads of exact accepted parent admissions");
    const reopened = await reopenParentArtifactDisposition(state, artifacts, disposition.id);
    if (!reopened.admission || reopened.admission.grant.id !== grant.id) {
      throw new Error("Study planning admission or read grant failed recursive reopening");
    }
    results.push({
      input: {
        reportId: disposition.reportId,
        childTaskId: disposition.childTaskId,
        childAgentId: disposition.childAgentId,
        artifactId: reopened.study.artifact.id,
        contentId: reopened.study.artifact.content.contentId,
        dispositionId: disposition.id,
        dispositionReceiptId: disposition.receiptId,
        dispositionReceiptContentId: disposition.receiptContentId,
        admissionId: disposition.admissionId,
        admissionReceiptId: disposition.admissionReceiptId,
        admissionReceiptContentId: disposition.admissionReceiptContentId,
        readOperationId: read.id,
        readReceiptId: read.receiptId,
      },
      envelope: reopened.study.envelope,
    });
  }
  if (results.length < 2) throw new Error("Study planning requires at least two admitted study reports read by the active root");
  return results;
}

function deriveCoverage(rootScopes: RuntimeProjection["tasks"][string]["mediaScope"], reports: PlanningReport[]) {
  const coverage: StudyPlanningInput["coverage"] = [];
  const gaps: StudyPlanningInput["gaps"] = [];
  const conflicts: StudyPlanningInput["conflicts"] = [];
  for (const root of rootScopes) {
    const boundaries = new Set([root.startMs, root.endMs]);
    for (const report of reports) {
      for (const child of report.envelope.coverage) {
        if (child.artifactId === root.artifactId && child.trackId === root.trackId && child.startMs < root.endMs && child.endMs > root.startMs) {
          boundaries.add(Math.max(root.startMs, child.startMs));
          boundaries.add(Math.min(root.endMs, child.endMs));
        }
      }
    }
    const ordered = [...boundaries].sort((left, right) => left - right);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const mediaRange = { artifactId: root.artifactId, trackId: root.trackId, startMs: ordered[index], endMs: ordered[index + 1] };
      const childRanges = reports.flatMap((report) => report.envelope.coverage
        .filter((child) => child.artifactId === root.artifactId && child.trackId === root.trackId && child.startMs <= mediaRange.startMs && child.endMs >= mediaRange.endMs)
        .map((child) => ({
          reportId: report.input.reportId,
          artifactId: report.input.artifactId,
          state: child.state,
          claimIds: [...child.claimIds],
          reasonCode: child.reason?.code ?? null,
        })));
      const supportedClaims = reports.flatMap((report) => report.envelope.claims
        .filter((claim) => claim.artifactId === root.artifactId && claim.trackId === root.trackId && claim.startMs <= mediaRange.startMs && claim.endMs >= mediaRange.endMs)
        .map((claim) => ({ reportId: report.input.reportId, artifactId: report.input.artifactId, claimId: claim.claimId, statement: claim.statement })));
      const statements = new Set(supportedClaims.map((claim) => claim.statement.normalize("NFC").trim()));
      const aggregate = supportedClaims.length === 0 ? "gap" as const : statements.size > 1 ? "conflict" as const : "supported_candidate" as const;
      const coverageBody = { range: mediaRange, aggregate, childRanges };
      const coverageId = `study-coverage:${canonicalSha256(coverageBody)}`;
      coverage.push({ coverageId, ...coverageBody });
      if (aggregate === "gap") {
        const reasonCodes = sorted([...new Set(childRanges.map((child) => child.reasonCode).filter((reason): reason is StudyCoverageReasonCode => reason !== null))]) as StudyCoverageReasonCode[];
        if (reasonCodes.length === 0) reasonCodes.push("unobserved_range");
        gaps.push({
          gapId: `study-gap:${canonicalSha256({ coverageId, range: mediaRange, reasonCodes })}`,
          coverageId,
          range: mediaRange,
          reasonCodes,
        });
      } else if (aggregate === "conflict") {
        const claims = supportedClaims.sort((left, right) => left.reportId.localeCompare(right.reportId) || left.claimId.localeCompare(right.claimId));
        conflicts.push({
          conflictId: `study-conflict:${canonicalSha256({ coverageId, range: mediaRange, claims })}`,
          coverageId,
          range: mediaRange,
          claims,
        });
      }
    }
  }
  return { coverage, gaps, conflicts };
}

export async function deriveStudyPlanningInput(
  state: RuntimeProjection,
  artifacts: ContentAddressedArtifactStore,
  executionId: string,
  reportIds?: readonly string[],
  allowFinishedExecutor = false,
): Promise<StudyPlanningInput> {
  const execution = state.executions[executionId];
  const root = execution ? state.tasks[execution.taskId] : null;
  if (
    !execution || (!allowFinishedExecutor && execution.status !== "active") ||
    (allowFinishedExecutor && execution.status !== "active" && execution.status !== "completed") ||
    !root || root.parentTaskId !== null ||
    root.workerKind !== "orchestrator" || root.ownerAgentId !== execution.agentId ||
    (!allowFinishedExecutor && root.status !== "working" && root.status !== "waiting_for_children")
  ) throw new Error("Study planning input requires the active model-root executor");
  const reports = await planningReports(state, artifacts, root.id, execution.agentId, reportIds);
  const derived = deriveCoverage(root.mediaScope, reports);
  const body = {
    schema: "studio.study-planning-input.v1" as const,
    runId: state.runId,
    rootTaskId: root.id,
    rootAgentId: execution.agentId,
    rootExecutionId: execution.id,
    jobContextId: root.jobContext.contextId,
    reports: reports.map((report) => report.input),
    ...derived,
  };
  return { ...body, inputId: `study-planning-input:${canonicalSha256(body)}` };
}

export interface StudyPlanningDecisionResult {
  planningInput: StudyPlanningInput;
  receipt: StudyPlanningDecisionReceipt;
  artifactId: string;
  receiptContentId: string;
}

/** Records the model's closed opinion; it never chooses an outcome on the model's behalf. */
export class StudyPlanningHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  inspect(executionId: string): Promise<StudyPlanningInput> {
    return deriveStudyPlanningInput(this.ledger.state(), this.artifacts, executionId);
  }

  async record(executionId: string, requestValue: unknown): Promise<StudyPlanningDecisionResult> {
    const request: StudyPlanningDecisionRequest = validateStudyPlanningDecisionRequest(requestValue);
    const input = await this.inspect(executionId);
    const expectedCoverage = input.coverage.map((entry) => entry.coverageId);
    const expectedGaps = input.gaps.map((entry) => entry.gapId);
    const expectedConflicts = input.conflicts.map((entry) => entry.conflictId);
    if (
      request.inputId !== input.inputId || !same(request.coverageIds, expectedCoverage) ||
      !same(request.gapIds, expectedGaps) || !same(request.conflictIds, expectedConflicts)
    ) throw new Error("Study planning decision did not close over the exact current coverage, gap, and conflict identities");
    if (request.citedGapIds.some((id) => !expectedGaps.includes(id)) || request.citedConflictIds.some((id) => !expectedConflicts.includes(id))) {
      throw new Error("Study planning decision cited a gap or conflict outside its exact input");
    }
    if (request.outcome === "request_follow_up" && request.citedGapIds.length + request.citedConflictIds.length === 0) {
      throw new Error("A follow-up planning decision must cite at least one exact gap or conflict");
    }
    if (request.outcome !== "request_follow_up" &&
        (!same(sorted(request.citedGapIds), sorted(expectedGaps)) || !same(sorted(request.citedConflictIds), sorted(expectedConflicts)))) {
      throw new Error("A no-follow-up planning decision must explicitly close every current gap and conflict identity");
    }
    const state = this.ledger.state();
    if (Object.values(state.studyPlanningDecisions).some((decision) => decision.inputId === input.inputId)) {
      throw new Error("This exact study planning input already has a model decision");
    }
    const decisionBody = {
      runId: state.runId,
      inputId: input.inputId,
      executionId,
      outcome: request.outcome,
      citedGapIds: request.citedGapIds,
      citedConflictIds: request.citedConflictIds,
      reason: request.reason,
    };
    const decisionId = `study-planning-decision:${canonicalSha256(decisionBody)}`;
    const receiptWithoutId = {
      decisionId,
      input,
      modelExecutor: { executionId, taskId: input.rootTaskId, agentId: input.rootAgentId },
      decision: {
        outcome: request.outcome,
        citedGapIds: [...request.citedGapIds],
        citedConflictIds: [...request.citedConflictIds],
        reason: request.reason,
      },
      nonClaims: { semanticCorrectness: "not_assessed" as const, truthArbitration: "not_performed" as const, readiness: "not_decided" as const },
    };
    const receipt: StudyPlanningDecisionReceipt = {
      schema: "studio.study-planning-decision.receipt.v1",
      receiptId: "pending",
      ...receiptWithoutId,
    };
    receipt.receiptId = planningReceiptId(receipt);
    const stored = await this.artifacts.storeJson(receipt);
    const artifact = this.artifacts.buildStudyPlanningDecisionArtifact({ runId: this.ledger.runId, receipt, storedReceipt: stored });
    await this.ledger.transact(
      { producer: { kind: "study_planning_host", id: "model-root-study-planning-host" }, causationId: executionId },
      ({ state: current }) => {
        const active = current.executions[executionId];
        if (active?.status !== "active" || Object.values(current.studyPlanningDecisions).some((decision) => decision.inputId === input.inputId)) {
          throw new Error("Study planning authority changed before its receipt was recorded");
        }
        return {
          pending: [
            { type: "artifact.recorded", data: { artifact } },
            { type: "study.planning_decision_recorded", data: { outputArtifactId: artifact.id, receiptContentId: stored.content.contentId, receipt } },
          ] satisfies PendingRuntimeEvent[],
          result: undefined,
        };
      },
    );
    return { planningInput: input, receipt, artifactId: artifact.id, receiptContentId: stored.content.contentId };
  }
}
