import type {
  MediaScope,
  RootOutputDispositionReceipt,
  RootOutputDispositionRequest,
  WorkerKind,
} from "../model.ts";
import {
  array,
  contentId,
  exact,
  fail,
  integer,
  literal,
  object,
  oneOf,
  string,
} from "./primitives.ts";
import { roleAllowsCapabilities, validateGrants, WORKER_KINDS } from "./scheduling.ts";

const OUTCOMES = new Set(["promoted_to_root", "rejected_by_root"]);

function mediaScopes(value: unknown, context: string, path: string): MediaScope[] {
  const scopes = array(value, context, path).map((candidate, index) => {
    const scope = object(candidate, context, `${path}[${index}]`);
    exact(scope, ["artifactId", "trackId", "startMs", "endMs"], context, `${path}[${index}]`);
    const startMs = integer(scope.startMs, context, `${path}[${index}].startMs`);
    const endMs = integer(scope.endMs, context, `${path}[${index}].endMs`, 1);
    if (endMs <= startMs) fail(context, `${path}[${index}]`, "must contain a non-empty half-open range");
    return {
      artifactId: string(scope.artifactId, context, `${path}[${index}].artifactId`),
      trackId: string(scope.trackId, context, `${path}[${index}].trackId`),
      startMs,
      endMs,
    };
  });
  if (new Set(scopes.map((scope) => JSON.stringify(scope))).size !== scopes.length) {
    fail(context, path, "must not repeat a media scope");
  }
  return scopes;
}

export function assertRootOutputDispositionRequest(
  value: unknown,
  context = "Root output disposition",
): asserts value is RootOutputDispositionRequest {
  const item = object(value, context, "request");
  exact(
    item,
    ["reportId", "rootTaskId", "rootAgentId", "outputArtifactId", "outcome", "reason"],
    context,
    "request",
  );
  string(item.reportId, context, "request.reportId");
  string(item.rootTaskId, context, "request.rootTaskId");
  string(item.rootAgentId, context, "request.rootAgentId");
  string(item.outputArtifactId, context, "request.outputArtifactId");
  oneOf(item.outcome, OUTCOMES, context, "request.outcome");
  string(item.reason, context, "request.reason");
}

export function validateRootOutputDispositionReceipt(
  value: unknown,
  context = "Root output disposition receipt",
  path = "receipt",
): asserts value is RootOutputDispositionReceipt {
  const item = object(value, context, path);
  exact(
    item,
    ["schema", "receiptId", "dispositionId", "delegation", "report", "input", "authority", "producer", "decision"],
    context,
    path,
  );
  literal(item.schema, "studio.root-output-disposition.receipt.v1", context, `${path}.schema`);
  string(item.receiptId, context, `${path}.receiptId`);
  string(item.dispositionId, context, `${path}.dispositionId`);

  const delegation = object(item.delegation, context, `${path}.delegation`);
  exact(
    delegation,
    [
      "spawnRequestId",
      "requestedByTaskId",
      "requestedByAgentId",
      "childTaskId",
      "childAgentId",
      "workerKind",
      "mediaScope",
      "grants",
    ],
    context,
    `${path}.delegation`,
  );
  string(delegation.spawnRequestId, context, `${path}.delegation.spawnRequestId`);
  const requestedByTaskId = string(
    delegation.requestedByTaskId,
    context,
    `${path}.delegation.requestedByTaskId`,
  );
  const requestedByAgentId = string(
    delegation.requestedByAgentId,
    context,
    `${path}.delegation.requestedByAgentId`,
  );
  const childTaskId = string(delegation.childTaskId, context, `${path}.delegation.childTaskId`);
  const childAgentId = string(delegation.childAgentId, context, `${path}.delegation.childAgentId`);
  const workerKind = oneOf<WorkerKind>(
    delegation.workerKind,
    WORKER_KINDS,
    context,
    `${path}.delegation.workerKind`,
  );
  mediaScopes(delegation.mediaScope, context, `${path}.delegation.mediaScope`);
  const grants = validateGrants(delegation.grants, context, `${path}.delegation.grants`);
  if (
    grants.length === 0 ||
    grants.some((grant) => grant.taskId !== childTaskId || grant.agentId !== childAgentId) ||
    !roleAllowsCapabilities(workerKind, grants.map((grant) => grant.capability))
  ) {
    fail(context, `${path}.delegation.grants`, "must be the child's non-empty exact grants");
  }

  const report = object(item.report, context, `${path}.report`);
  exact(report, ["reportId", "decisionReason"], context, `${path}.report`);
  string(report.reportId, context, `${path}.report.reportId`);
  string(report.decisionReason, context, `${path}.report.decisionReason`);

  const input = object(item.input, context, `${path}.input`);
  exact(
    input,
    [
      "artifactId",
      "contentId",
      "kind",
      "producerTaskId",
      "producerAgentId",
      "executionId",
      "executorReceiptId",
      "executorReceiptContentId",
    ],
    context,
    `${path}.input`,
  );
  string(input.artifactId, context, `${path}.input.artifactId`);
  contentId(input.contentId, context, `${path}.input.contentId`);
  string(input.kind, context, `${path}.input.kind`);
  if (
    string(input.producerTaskId, context, `${path}.input.producerTaskId`) !== childTaskId ||
    string(input.producerAgentId, context, `${path}.input.producerAgentId`) !== childAgentId
  ) {
    fail(context, `${path}.input`, "must be produced by the delegated child");
  }
  string(input.executionId, context, `${path}.input.executionId`);
  string(input.executorReceiptId, context, `${path}.input.executorReceiptId`);
  contentId(input.executorReceiptContentId, context, `${path}.input.executorReceiptContentId`);

  const authority = object(item.authority, context, `${path}.authority`);
  exact(authority, ["rootTaskId", "rootAgentId"], context, `${path}.authority`);
  if (
    string(authority.rootTaskId, context, `${path}.authority.rootTaskId`) !== requestedByTaskId ||
    string(authority.rootAgentId, context, `${path}.authority.rootAgentId`) !== requestedByAgentId
  ) {
    fail(context, `${path}.authority`, "must equal the root delegation requester");
  }

  const producer = object(item.producer, context, `${path}.producer`);
  exact(producer, ["id", "version", "policy"], context, `${path}.producer`);
  literal(producer.id, "studio.root-output-disposition", context, `${path}.producer.id`);
  literal(producer.version, "1", context, `${path}.producer.version`);
  literal(
    producer.policy,
    "accepted_or_rejected_child_report_exact_output_only",
    context,
    `${path}.producer.policy`,
  );

  const decision = object(item.decision, context, `${path}.decision`);
  exact(decision, ["outcome", "reason"], context, `${path}.decision`);
  oneOf(decision.outcome, OUTCOMES, context, `${path}.decision.outcome`);
  string(decision.reason, context, `${path}.decision.reason`);
}
