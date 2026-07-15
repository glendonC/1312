import type {
  ReportDecisionRequest,
  ReportRecord,
  ReportSubmitRequest,
} from "../model.ts";
import {
  boolean,
  exact,
  fail,
  nullableString,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

export function validateReportRecord(
  value: unknown,
  context: string,
  path: string,
): asserts value is ReportRecord {
  const item = object(value, context, path);
  exact(
    item,
    [
      "id",
      "taskId",
      "agentId",
      "parentTaskId",
      "parentAgentId",
      "outputArtifactIds",
      "summary",
      "status",
      "decisionReason",
    ],
    context,
    path,
  );
  string(item.id, context, `${path}.id`);
  string(item.taskId, context, `${path}.taskId`);
  string(item.agentId, context, `${path}.agentId`);
  string(item.parentTaskId, context, `${path}.parentTaskId`);
  string(item.parentAgentId, context, `${path}.parentAgentId`);
  const artifacts = uniqueStrings(item.outputArtifactIds, context, `${path}.outputArtifactIds`);
  if (artifacts.length === 0) {
    fail(context, `${path}.outputArtifactIds`, "must contain an output artifact");
  }
  string(item.summary, context, `${path}.summary`);
  const status = oneOf<string>(
    item.status,
    new Set(["submitted", "accepted", "rejected"]),
    context,
    `${path}.status`,
  );
  const reason = nullableString(item.decisionReason, context, `${path}.decisionReason`);
  if ((status === "submitted") !== (reason === null)) {
    fail(context, path, "decision reason must match report status");
  }
}

export function assertReportSubmitRequest(
  value: unknown,
  context = "Report submission",
): asserts value is ReportSubmitRequest {
  const item = object(value, context, "request");
  exact(
    item,
    ["taskId", "agentId", "outputArtifactIds", "summary"],
    context,
    "request",
  );
  string(item.taskId, context, "request.taskId");
  string(item.agentId, context, "request.agentId");
  const artifacts = uniqueStrings(item.outputArtifactIds, context, "request.outputArtifactIds");
  if (artifacts.length === 0) {
    fail(context, "request.outputArtifactIds", "must contain an output artifact");
  }
  string(item.summary, context, "request.summary");
}

export function assertReportDecisionRequest(
  value: unknown,
  context = "Report decision",
): asserts value is ReportDecisionRequest {
  const item = object(value, context, "request");
  exact(
    item,
    ["reportId", "decidedByTaskId", "decidedByAgentId", "accepted", "reason"],
    context,
    "request",
  );
  string(item.reportId, context, "request.reportId");
  string(item.decidedByTaskId, context, "request.decidedByTaskId");
  string(item.decidedByAgentId, context, "request.decidedByAgentId");
  boolean(item.accepted, context, "request.accepted");
  string(item.reason, context, "request.reason");
}
