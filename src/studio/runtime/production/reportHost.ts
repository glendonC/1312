import { randomUUID } from "node:crypto";

import { assertReportDecisionRequest, assertReportSubmitRequest } from "./assertions.ts";
import type { RuntimeLedger } from "./journal.ts";
import type { ReportDecisionRequest, ReportRecord, ReportSubmitRequest } from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";

export class BoundedReportHost {
  private readonly ledger: RuntimeLedger;
  private readonly nextId: () => string;

  constructor(
    ledger: RuntimeLedger,
    nextId: () => string = () => `report:${randomUUID()}`,
  ) {
    this.ledger = ledger;
    this.nextId = nextId;
  }

  async submit(requestValue: unknown): Promise<ReportRecord> {
    assertReportSubmitRequest(requestValue);
    const request: ReportSubmitRequest = structuredClone(requestValue);
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
