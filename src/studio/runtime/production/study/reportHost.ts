import { randomUUID } from "node:crypto";

import { assertReportDecisionRequest, assertReportSubmitRequest } from "../assertions.ts";
import type { RuntimeLedger } from "../journal.ts";
import type { ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { ReportDecisionRequest, ReportRecord, ReportSubmitRequest, StudyReportSubmissionBindingV2 } from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { reopenStudyReport } from "./studyReportAudit.ts";
import { canonicalJsonContentId } from "../artifactStore.ts";
import { validateStudyReportArtifactV2, validateStudyReportSubmissionBindingV2 } from "../validation/studyReportsV2.ts";

async function reopenStudyReportV2Submission(
  ledger: RuntimeLedger,
  artifacts: ContentAddressedArtifactStore,
  artifactId: string,
): Promise<StudyReportSubmissionBindingV2> {
  const state = ledger.state();
  const artifact = state.artifacts[artifactId];
  if (!artifact || artifact.kind !== "studio.study-report.v2" || artifact.origin.kind !== "study_report") {
    throw new Error("Typed study report v2 submission requires one recorded report artifact");
  }
  const outputSlotName = artifact.origin.outputSlotName;
  const bytes = await artifacts.receiptBytes(artifact.content.contentId);
  if (bytes.byteLength !== artifact.content.bytes) throw new Error("Stored study report v2 changed byte identity");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error("Stored study report v2 is not valid JSON"); }
  const envelope = validateStudyReportArtifactV2(value);
  const task = state.tasks[envelope.task.taskId];
  const execution = state.executions[envelope.task.executionId];
  const slot = task?.requiredOutputs.find((candidate) => candidate.required && candidate.name === outputSlotName && candidate.artifactKind === envelope.schema);
  if (
    canonicalJsonContentId(envelope) !== artifact.content.contentId || !task || !slot ||
    execution?.status !== "completed" || !execution.receipt ||
    execution.receipt.receiptId !== artifact.origin.receiptId ||
    envelope.runId !== state.runId || envelope.task.agentId !== task.assignedAgentId ||
    envelope.task.jobContextId !== task.jobContext.contextId ||
    envelope.task.executionId !== execution.id ||
    envelope.parent.taskId !== task.parentTaskId || envelope.parent.agentId !== task.parentAgentId
  ) throw new Error("Stored study report v2 lost its task, executor, output, or parent binding");
  return validateStudyReportSubmissionBindingV2({
    schema: "studio.study-report-submission.v2",
    jobContextId: envelope.task.jobContextId,
    outputSlot: { name: slot.name, artifactKind: "studio.study-report.v2" },
    assignment: envelope.assignment,
    coverage: envelope.coverage,
    claims: envelope.claims,
    evidenceCitations: envelope.evidenceCitations,
    output: { artifactId: artifact.id, contentId: artifact.content.contentId, bytes: artifact.content.bytes, schema: envelope.schema },
    sourceArtifacts: envelope.sourceArtifacts,
    executor: { executionId: execution.id, receiptId: artifact.origin.receiptId, receiptContentId: artifact.origin.receiptContentId },
    parentEdge: { childTaskId: task.id, childAgentId: task.assignedAgentId, parentTaskId: task.parentTaskId, parentAgentId: task.parentAgentId },
  }, "Study report v2 submission", "submission");
}

export class BoundedReportHost {
  private readonly ledger: RuntimeLedger;
  private readonly nextId: () => string;
  private readonly artifacts: ContentAddressedArtifactStore | null;

  constructor(
    ledger: RuntimeLedger,
    nextId: () => string = () => `report:${randomUUID()}`,
    artifacts: ContentAddressedArtifactStore | null = null,
  ) {
    this.ledger = ledger;
    this.nextId = nextId;
    this.artifacts = artifacts;
  }

  async submit(requestValue: unknown): Promise<ReportRecord> {
    assertReportSubmitRequest(requestValue);
    const request: ReportSubmitRequest = structuredClone(requestValue);
    const submittedArtifacts = request.outputArtifactIds.map((id) => this.ledger.state().artifacts[id]).filter(Boolean);
    const typedArtifacts = submittedArtifacts.filter((artifact) => artifact.kind === "studio.study-report.v1" || artifact.kind === "studio.study-report.v2");
    if (typedArtifacts.length > 0 && (typedArtifacts.length !== 1 || request.outputArtifactIds.length !== 1)) {
      throw new Error("Typed study report submission requires one exact output artifact and output slot");
    }
    const study = typedArtifacts.length === 1
      ? (this.artifacts
          ? typedArtifacts[0].kind === "studio.study-report.v2"
            ? await reopenStudyReportV2Submission(this.ledger, this.artifacts, typedArtifacts[0].id)
            : (await reopenStudyReport(this.ledger.state(), this.artifacts, typedArtifacts[0].id)).submission
          : (() => { throw new Error("Typed study report submission requires authenticated artifact storage"); })())
      : null;
    const transaction = await this.ledger.transact<ReportRecord>(
      { producer: { kind: "handoff_host", id: "bounded-report-host" }, causationId: request.taskId },
      ({ state }) => {
        const task = state.tasks[request.taskId];
        if (!task || task.status !== "working" || task.ownerAgentId !== request.agentId) {
          throw new Error("Report submission requires a working task owned by the submitting agent");
        }
        if (!task.grants.some((grant) => grant.capability === "report.submit")) {
          throw new Error("Report submission is not granted to this task");
        }
        if (!task.parentTaskId || !task.parentAgentId) throw new Error("Root tasks cannot report to a missing parent");
        if (
          !request.outputArtifactIds.every((id) => {
            const artifact = state.artifacts[id];
            return artifact?.producerTaskId === task.id && artifact.producerAgentId === request.agentId;
          })
        ) {
          throw new Error("Report output artifacts must be produced by the submitting task");
        }
        for (const required of task.requiredOutputs.filter((output) => output.required)) {
          if (!request.outputArtifactIds.some((id) => state.artifacts[id]?.kind === required.artifactKind)) {
            throw new Error(`Report does not satisfy required output ${required.name}`);
          }
        }
        const report: ReportRecord = {
          id: this.nextId(),
          taskId: task.id,
          agentId: request.agentId,
          parentTaskId: task.parentTaskId,
          parentAgentId: task.parentAgentId,
          outputArtifactIds: [...request.outputArtifactIds],
          summary: request.summary,
          study: study ? structuredClone(study) : null,
          status: "submitted",
          decisionReason: null,
        };
        return {
          pending: [{ type: "report.submitted", data: { report } }] satisfies PendingRuntimeEvent[],
          result: report,
        };
      },
    );
    return transaction.result;
  }

  async decide(requestValue: unknown): Promise<void> {
    assertReportDecisionRequest(requestValue);
    const request: ReportDecisionRequest = structuredClone(requestValue);
    await this.ledger.transact(
      { producer: { kind: "handoff_host", id: "bounded-report-host" }, causationId: request.reportId },
      ({ state }) => {
        const report = state.reports[request.reportId];
        const parent = report ? state.tasks[report.parentTaskId] : null;
        if (!report || report.status !== "submitted") throw new Error("Report is not pending a decision");
        if (report.study?.schema === "studio.study-report-submission.v1") throw new Error("Typed study reports v1 require atomic parent artifact disposition");
        if (
          !parent ||
          parent.id !== request.decidedByTaskId ||
          parent.ownerAgentId !== request.decidedByAgentId ||
          parent.status !== "working"
        ) {
          throw new Error("Only the working parent task owner may decide a report");
        }
        return {
          pending: [
            {
              type: "report.decided",
              data: {
                reportId: request.reportId,
                decidedByTaskId: request.decidedByTaskId,
                decidedByAgentId: request.decidedByAgentId,
                accepted: request.accepted,
                reason: request.reason,
              },
            },
          ] satisfies PendingRuntimeEvent[],
          result: undefined,
        };
      },
    );
  }
}
