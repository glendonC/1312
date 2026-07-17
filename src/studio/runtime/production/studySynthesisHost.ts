import {
  canonicalSha256,
  ContentAddressedArtifactStore,
} from "./artifactStore.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  OwnedMediaStudyArtifact,
  OwnedMediaStudyExecutorReceipt,
  OwnedMediaStudySynthesisRequest,
  StudyCoverageRange,
} from "./model.ts";
import { OWNED_MEDIA_STUDY_LIMITS } from "./model.ts";
import { reopenParentArtifactDisposition } from "./parentArtifactAdmissionAudit.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import { reopenStudyPlanningDecision } from "./studyPlanningAudit.ts";
import {
  deriveOwnedMediaStudyChildDispositions,
  deriveOwnedMediaStudyFollowUpHistory,
} from "./studySynthesisLineage.ts";
import { validateCoveragePartition } from "./validation/studyReports.ts";
import { validateOwnedMediaStudySynthesisRequest } from "./validation/studies.ts";

function same(left: unknown, right: unknown): boolean {
  return canonicalSha256(left) === canonicalSha256(right);
}

function receiptId(receipt: OwnedMediaStudyExecutorReceipt): string {
  const body = structuredClone(receipt) as unknown as Record<string, unknown>;
  delete body.schema;
  delete body.receiptId;
  return `owned-media-study-executor-receipt:${canonicalSha256(body)}`;
}

export interface OwnedMediaStudySynthesisResult {
  studyId: string;
  artifactId: string;
  contentId: string;
  executorReceipt: OwnedMediaStudyExecutorReceipt;
  executorReceiptContentId: string;
  envelope: OwnedMediaStudyArtifact;
}

/** Persists model-authored synthesis fields after deterministic lineage and support validation. */
export class OwnedMediaStudySynthesisHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;
  constructor(
    ledger: RuntimeLedger,
    artifacts: ContentAddressedArtifactStore,
  ) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  async synthesize(executionId: string, requestValue: unknown): Promise<OwnedMediaStudySynthesisResult> {
    const request: OwnedMediaStudySynthesisRequest = validateOwnedMediaStudySynthesisRequest(requestValue);
    const state = this.ledger.state();
    const execution = state.executions[executionId];
    const root = execution ? state.tasks[execution.taskId] : null;
    const planningRecord = state.studyPlanningDecisions[request.planningDecisionId];
    if (
      !execution || execution.status !== "active" || !root || root.parentTaskId !== null ||
      root.ownerAgentId !== execution.agentId || !root.grants.some((grant) => grant.capability === "study.synthesize") ||
      !planningRecord || planningRecord.executionId !== execution.id || planningRecord.outcome !== "synthesize_with_gaps"
    ) throw new Error("Owned-media study synthesis requires an active authorized root and its exact synthesis decision");
    if (Object.keys(state.ownedMediaStudies).length > 0) throw new Error("The root already emitted its owned-media study");
    const planning = await reopenStudyPlanningDecision(state, this.artifacts, request.planningDecisionId);
    const planningById = new Map(planning.receipt.input.coverage.map((entry) => [entry.coverageId, entry]));
    if (!same(request.coverage.map((entry) => entry.coverageId), planning.receipt.input.coverage.map((entry) => entry.coverageId))) {
      throw new Error("Owned-media study hid, duplicated, or reordered a planning coverage identity");
    }
    validateCoveragePartition(request.coverage as StudyCoverageRange[], root.mediaScope, "Owned-media study root coverage");
    for (const range of request.coverage) {
      const planned = planningById.get(range.coverageId);
      if (!planned || !same(planned.range, { artifactId: range.artifactId, trackId: range.trackId, startMs: range.startMs, endMs: range.endMs })) {
        throw new Error(`Owned-media study coverage ${range.coverageId} changed its exact root range`);
      }
      if ((planned.aggregate === "gap" || planned.aggregate === "conflict") && range.state === "supported") {
        throw new Error(`Owned-media study cannot turn ${planned.aggregate} coverage ${range.coverageId} into supported coverage`);
      }
    }
    const expectedConflicts = planning.receipt.input.conflicts.map((conflict) => conflict.conflictId);
    if (!same(request.conflicts.map((conflict) => conflict.conflictId), expectedConflicts) ||
        request.conflicts.some((conflict) => !planning.receipt.input.conflicts.some((expected) =>
          expected.conflictId === conflict.conflictId && expected.coverageId === conflict.coverageId))) {
      throw new Error("Owned-media study must retain every exact conflict identity as unresolved");
    }

    const reopenedReports = new Map<string, Awaited<ReturnType<typeof reopenParentArtifactDisposition>>>();
    for (const report of planning.receipt.input.reports) {
      reopenedReports.set(report.reportId, await reopenParentArtifactDisposition(state, this.artifacts, report.dispositionId));
    }
    const claimsById = new Map(request.claims.map((claim) => [claim.claimId, claim]));
    for (const range of request.coverage.filter((entry) => entry.state === "supported")) {
      for (const claimId of range.claimIds) {
        const claim = claimsById.get(claimId);
        if (!claim || claim.artifactId !== range.artifactId || claim.trackId !== range.trackId || claim.startMs !== range.startMs || claim.endMs !== range.endMs) {
          throw new Error(`Owned-media study claim ${claimId} changed its supported range`);
        }
      }
    }
    if (new Set(request.coverage.flatMap((entry) => entry.claimIds)).size !== request.claims.length ||
        request.claims.some((claim) => !request.coverage.some((entry) => entry.claimIds.includes(claim.claimId)))) {
      throw new Error("Owned-media study claims must be referenced exactly once by supported coverage");
    }
    for (const claim of request.claims) {
      const requiredSemantic: unknown[] = [];
      for (const citation of claim.childReportCitations) {
        const plannedReport = planning.receipt.input.reports.find((report) => report.reportId === citation.reportId);
        const reopened = reopenedReports.get(citation.reportId);
        const childClaim = reopened?.study.envelope.claims.find((candidate) => candidate.claimId === citation.claimId);
        if (
          !plannedReport || !reopened?.admission || citation.artifactId !== plannedReport.artifactId ||
          citation.contentId !== plannedReport.contentId || citation.admissionId !== plannedReport.admissionId ||
          !childClaim || childClaim.artifactId !== claim.artifactId || childClaim.trackId !== claim.trackId ||
          childClaim.startMs !== claim.startMs || childClaim.endMs !== claim.endMs
        ) throw new Error(`Owned-media study claim ${claim.claimId} has an unsupported child-report citation`);
        requiredSemantic.push(...childClaim.citations);
      }
      for (const citation of requiredSemantic) {
        if (!claim.semanticCitations.some((candidate) => same(candidate, citation))) {
          throw new Error(`Owned-media study claim ${claim.claimId} omitted a child claim's semantic observation citation`);
        }
      }
      if (claim.semanticCitations.some((citation) => !requiredSemantic.some((candidate) => same(candidate, citation)))) {
        throw new Error(`Owned-media study claim ${claim.claimId} added a semantic citation absent from its cited child claims`);
      }
    }

    const dispositions = deriveOwnedMediaStudyChildDispositions(state, root.id);
    const history = deriveOwnedMediaStudyFollowUpHistory(state);
    const hasLimitation = (code: OwnedMediaStudySynthesisRequest["limitations"][number]["code"], coverageId?: string) =>
      request.limitations.some((limitation) => limitation.code === code && (!coverageId || limitation.coverageIds.includes(coverageId)));
    if (planning.receipt.input.gaps.some((gap) => !hasLimitation("explicit_gap", gap.coverageId)) ||
        planning.receipt.input.conflicts.some((conflict) => !hasLimitation("unresolved_conflict", conflict.coverageId)) ||
        dispositions.some((entry) => ["failed", "withheld", "interrupted"].includes(entry.outcome)) && !hasLimitation("partial_child_failure") ||
        dispositions.some((entry) => entry.outcome === "rejected") && !hasLimitation("rejected_child_input")) {
      throw new Error("Owned-media study limitations must name every exact gap, conflict, partial child failure, and rejected child input");
    }
    if (history.some((entry) => entry.accepted && (!entry.terminal || !new Set(["completed", "failed", "withheld", "interrupted"]).has(entry.terminal.status)))) {
      throw new Error("Owned-media study synthesis requires every accepted follow-up to reach a terminal disposition");
    }
    const sourceIdentities = new Map<string, string>();
    sourceIdentities.set(root.jobContext.source.artifactId, root.jobContext.source.contentId);
    sourceIdentities.set(planning.artifact.id, planning.artifact.content.contentId);
    for (const report of planning.receipt.input.reports) {
      sourceIdentities.set(report.artifactId, report.contentId);
      const disposition = state.parentArtifactDispositions[report.dispositionId];
      if (disposition) {
        const dispositionArtifact = state.artifacts[disposition.receiptArtifactId];
        const admissionArtifact = disposition.admissionArtifactId ? state.artifacts[disposition.admissionArtifactId] : null;
        if (dispositionArtifact) sourceIdentities.set(dispositionArtifact.id, dispositionArtifact.content.contentId);
        if (admissionArtifact) sourceIdentities.set(admissionArtifact.id, admissionArtifact.content.contentId);
      }
    }
    for (const claim of request.claims) {
      for (const citation of claim.semanticCitations) sourceIdentities.set(citation.artifactId, citation.contentId);
    }
    const envelope: OwnedMediaStudyArtifact = {
      schema: "studio.owned-media-study.v1",
      runId: state.runId,
      root: { taskId: root.id, agentId: execution.agentId, executionId: execution.id, jobContext: structuredClone(root.jobContext) },
      planning: {
        decisionId: planning.receipt.decisionId,
        receiptId: planning.receipt.receiptId,
        receiptContentId: planning.artifact.content.contentId,
        outcome: "synthesize_with_gaps",
        inputId: planning.receipt.input.inputId,
      },
      reports: structuredClone(planning.receipt.input.reports),
      childDispositions: dispositions,
      followUpHistory: history,
      coverage: structuredClone(request.coverage),
      claims: structuredClone(request.claims),
      conflicts: structuredClone(request.conflicts),
      limitations: structuredClone(request.limitations),
      sourceArtifacts: [...sourceIdentities.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([artifactId, contentId]) => ({ artifactId, contentId })),
      limits: OWNED_MEDIA_STUDY_LIMITS,
      nonClaims: { semanticCorrectness: "not_assessed", translationQuality: "not_assessed", truthArbitration: "not_performed", publication: "not_authorized" },
    };
    const prepared = await this.artifacts.prepareOwnedMediaStudy(state.runId, envelope);
    const synthesisId = `study-synthesis:${canonicalSha256({ runId: state.runId, executionId, planningDecisionId: request.planningDecisionId, studyId: prepared.studyId })}`;
    const executorReceipt: OwnedMediaStudyExecutorReceipt = {
      schema: "studio.owned-media-study.executor-receipt.v1",
      receiptId: "pending",
      synthesisId,
      execution: { executionId, taskId: root.id, agentId: execution.agentId },
      planning: { decisionId: planning.receipt.decisionId, receiptId: planning.receipt.receiptId, receiptContentId: planning.artifact.content.contentId },
      output: { artifactId: prepared.artifactId, contentId: prepared.content.contentId, bytes: prepared.content.bytes, schema: "studio.owned-media-study.v1" },
      producer: { id: "studio.model-root-study-synthesis", version: "1", authorship: "active_root_executor_tool_call" },
      outcome: "completed",
    };
    executorReceipt.receiptId = receiptId(executorReceipt);
    const storedReceipt = await this.artifacts.storeJson(executorReceipt);
    const artifact = this.artifacts.buildOwnedMediaStudyArtifact({
      runId: state.runId,
      receipt: executorReceipt,
      receiptContentId: storedReceipt.content.contentId,
      prepared,
    });
    await this.ledger.transact(
      { producer: { kind: "study_synthesis_host", id: "model-root-owned-media-study-host" }, causationId: executionId },
      ({ state: current }) => {
        if (current.executions[executionId]?.status !== "active" || Object.keys(current.ownedMediaStudies).length > 0) {
          throw new Error("Owned-media synthesis authority changed before durable recording");
        }
        return {
          pending: [
            { type: "artifact.recorded", data: { artifact } },
            { type: "study.synthesis_completed", data: {
              studyId: prepared.studyId,
              outputArtifactId: artifact.id,
              outputContentId: artifact.content.contentId,
              executorReceiptContentId: storedReceipt.content.contentId,
              executorReceipt,
              projection: {
                coverage: structuredClone(prepared.envelope.coverage),
                conflicts: structuredClone(prepared.envelope.conflicts),
              },
            } },
          ] satisfies PendingRuntimeEvent[],
          result: undefined,
        };
      },
    );
    return {
      studyId: prepared.studyId,
      artifactId: artifact.id,
      contentId: artifact.content.contentId,
      executorReceipt,
      executorReceiptContentId: storedReceipt.content.contentId,
      envelope: prepared.envelope,
    };
  }
}
