import { capabilityOperationExists, taskCapabilityCallCount } from "../capabilityUsage.ts";
import { canonicalJson } from "../canonicalIdentity.ts";
import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { computerUseRequestFingerprint, computerUseSessionId } from "../validation/computerUse.ts";
import { invariant } from "./shared.ts";

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function applyComputerUseEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "computer_use.operation_started") {
    invariant(event.producer.kind === "computer_use_host", event, "Computer-use must come from its bounded runtime host");
    const { request, scope } = event.data;
    const task = next.tasks[request.taskId];
    const grant = task?.grants.find((candidate) => candidate.id === request.grantId);
    invariant(task?.status === "working" && task.ownerAgentId === request.agentId, event, `Computer-use ${request.operationId} has no working owner`);
    invariant(!capabilityOperationExists(next, request.operationId), event, `Computer-use ${request.operationId} is duplicated`);
    invariant(grant?.capability === "computer.use.readonly" && grant.computerUseScope && same(grant.computerUseScope, scope), event, `Computer-use ${request.operationId} changed its grant scope`);
    const fingerprint = computerUseRequestFingerprint({ grantId: request.grantId });
    invariant(fingerprint === event.data.requestFingerprint, event, `Computer-use ${request.operationId} changed request identity`);
    invariant(!Object.values(next.computerUseOperations).some((operation) => operation.grantId === grant.id || operation.requestFingerprint === fingerprint), event, `Computer-use grant ${grant.id} is already charged`);
    invariant(taskCapabilityCallCount(next, task.id) < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    const execution = next.executions[event.data.executionId];
    const launch = next.taskLaunches[task.id];
    invariant(execution?.status === "active" && execution.taskId === task.id && execution.agentId === request.agentId &&
      execution.launchClaimId === event.data.launchClaimId && launch?.id === event.data.launchClaimId && launch.executionId === execution.id,
    event, `Computer-use ${request.operationId} lost executor lineage`);
    const exhaustion = next.researchExhaustions[scope.r1Cause.receiptId];
    const researchTask = exhaustion ? next.tasks[exhaustion.taskId] : undefined;
    invariant(exhaustion && researchTask?.parentTaskId === task.parentTaskId && task.parentTaskId !== null &&
      exhaustion.outputArtifactId === scope.r1Cause.receiptArtifactId && exhaustion.receiptContentId === scope.r1Cause.receiptContentId &&
      exhaustion.reason === scope.r1Cause.reason && same(exhaustion.gap, scope.gap),
    event, `Computer-use ${request.operationId} lost its exact sibling R1 exhaustion cause`);
    invariant(task.inputArtifactIds.length === 1 && task.inputArtifactIds[0] === scope.gap.media.artifactId &&
      task.mediaScope.length === 1 && task.mediaScope[0].artifactId === scope.gap.media.artifactId &&
      task.mediaScope[0].trackId === scope.gap.media.trackId &&
      task.mediaScope[0].startMs === scope.gap.media.startMs && task.mediaScope[0].endMs === scope.gap.media.endMs,
    event, `Computer-use ${request.operationId} changed its exact media gap`);
    invariant(event.data.sessionId === computerUseSessionId({ runId: next.runId, operationId: request.operationId, grantId: grant.id }), event, `Computer-use ${request.operationId} changed session identity`);
    next.computerUseOperations[request.operationId] = {
      id: request.operationId,
      taskId: task.id,
      agentId: request.agentId,
      grantId: grant.id,
      executionId: execution.id,
      launchClaimId: launch.id,
      requestFingerprint: fingerprint,
      gap: structuredClone(scope.gap),
      r1Cause: structuredClone(scope.r1Cause),
      surface: structuredClone(scope.surface),
      status: "started",
      sessionId: event.data.sessionId,
      fixtureArtifactId: null,
      screenshotArtifactIds: [],
      visibleContentArtifactIds: [],
      actionArtifactIds: [],
      sessionArtifactId: null,
      sessionReceiptId: null,
      sessionReceiptContentId: null,
      failure: null,
    };
    return true;
  }
  if (event.type === "computer_use.operation_completed") {
    invariant(event.producer.kind === "computer_use_host", event, "Computer-use completion must come from its bounded runtime host");
    const operation = next.computerUseOperations[event.data.operationId];
    invariant(operation?.status === "started", event, `Computer-use ${event.data.operationId} is not active`);
    const task = next.tasks[operation.taskId];
    const grant = task?.grants.find((candidate) => candidate.id === operation.grantId);
    const receipt = event.data.receipt;
    invariant(grant?.capability === "computer.use.readonly" && grant.computerUseScope, event, `Computer-use ${operation.id} lost its grant`);
    invariant(receipt.runId === next.runId && receipt.operationId === operation.id && receipt.sessionId === operation.sessionId,
      event, `Computer-use ${operation.id} changed run, operation, or session identity`);
    invariant(receipt.authorization.grantId === operation.grantId && receipt.authorization.taskId === operation.taskId &&
      receipt.authorization.agentId === operation.agentId,
    event, `Computer-use ${operation.id} changed authorization identity`);
    invariant(same(receipt.gap, operation.gap) && same(receipt.r1Cause, operation.r1Cause) && same(receipt.surface, operation.surface),
      event, `Computer-use ${operation.id} changed gap, R1 cause, or surface identity`);
    invariant(same(receipt.limits, grant.computerUseScope.limits), event, `Computer-use ${operation.id} changed its fixed limits`);
    invariant(receipt.accounting.egressRequests === 0 && receipt.accounting.egressBytes === 0 &&
      receipt.accounting.downloads === 0 && receipt.accounting.downloadBytes === 0,
    event, `Computer-use ${operation.id} changed offline accounting`);
    const fixture = next.artifacts[event.data.fixtureArtifactId];
    const session = next.artifacts[event.data.sessionArtifactId];
    invariant(fixture?.origin.kind === "external_screen_fixture" && fixture.origin.operationId === operation.id &&
      fixture.origin.sessionId === operation.sessionId &&
      fixture.origin.mediaSourceArtifactId === operation.gap.media.artifactId &&
      fixture.origin.r1CauseArtifactId === operation.r1Cause.receiptArtifactId &&
      fixture.id === receipt.fixture.artifactId && fixture.content.contentId === receipt.fixture.content.contentId,
    event, `Computer-use ${operation.id} changed fixture identity`);
    invariant(same(event.data.screenshotArtifactIds, receipt.states.map((state) => state.screenshot.artifactId)) &&
      same(event.data.visibleContentArtifactIds, receipt.states.map((state) => state.visibleContent.artifactId)) &&
      same(event.data.actionArtifactIds, receipt.actions.map((action) => action.artifactId)),
    event, `Computer-use ${operation.id} changed ordered state or action artifacts`);
    for (const [index, state] of receipt.states.entries()) {
      const screenshot = next.artifacts[event.data.screenshotArtifactIds[index]];
      const content = next.artifacts[event.data.visibleContentArtifactIds[index]];
      invariant(screenshot?.origin.kind === "external_screen_screenshot" && screenshot.origin.operationId === operation.id &&
        screenshot.origin.sessionId === operation.sessionId && screenshot.origin.stateId === state.stateId &&
        screenshot.origin.ordinal === index && screenshot.origin.screenshotId === state.screenshot.screenshotId &&
        screenshot.origin.fixtureArtifactId === fixture.id && screenshot.content.contentId === state.screenshot.content.contentId,
      event, `Computer-use ${operation.id} changed screenshot ${index}`);
      invariant(content?.origin.kind === "external_screen_content" && content.origin.operationId === operation.id &&
        content.origin.sessionId === operation.sessionId && content.origin.stateId === state.stateId &&
        content.origin.ordinal === index && content.origin.fixtureArtifactId === fixture.id &&
        content.origin.screenshotArtifactId === state.screenshot.artifactId &&
        content.content.contentId === state.visibleContent.content.contentId,
      event, `Computer-use ${operation.id} changed visible content ${index}`);
    }
    for (const [index, action] of receipt.actions.entries()) {
      const actionArtifact = next.artifacts[event.data.actionArtifactIds[index]];
      const before = receipt.states[index];
      const after = receipt.states[index + 1];
      invariant(actionArtifact?.origin.kind === "external_screen_action_receipt" &&
        actionArtifact.origin.operationId === operation.id && actionArtifact.origin.sessionId === operation.sessionId &&
        actionArtifact.origin.actionId === action.actionId && actionArtifact.origin.index === index &&
        actionArtifact.origin.beforeScreenshotArtifactId === before.screenshot.artifactId &&
        actionArtifact.origin.beforeContentArtifactId === before.visibleContent.artifactId &&
        actionArtifact.origin.afterScreenshotArtifactId === after.screenshot.artifactId &&
        actionArtifact.origin.afterContentArtifactId === after.visibleContent.artifactId &&
        actionArtifact.content.contentId === action.content.contentId,
      event, `Computer-use ${operation.id} changed action ${index}`);
    }
    invariant(session?.origin.kind === "external_screen_session_receipt" && session.origin.operationId === operation.id &&
      session.origin.sessionId === operation.sessionId && session.origin.receiptId === receipt.receiptId &&
      session.origin.mediaSourceArtifactId === operation.gap.media.artifactId &&
      session.origin.r1CauseArtifactId === operation.r1Cause.receiptArtifactId &&
      session.origin.fixtureArtifactId === fixture.id && session.content.contentId === event.data.sessionReceiptContentId &&
      same(session.origin.screenshotArtifactIds, event.data.screenshotArtifactIds) &&
      same(session.origin.visibleContentArtifactIds, event.data.visibleContentArtifactIds) &&
      same(session.origin.actionArtifactIds, event.data.actionArtifactIds),
    event, `Computer-use ${operation.id} changed terminal session lineage`);
    operation.status = "completed";
    operation.fixtureArtifactId = fixture.id;
    operation.screenshotArtifactIds = [...event.data.screenshotArtifactIds];
    operation.visibleContentArtifactIds = [...event.data.visibleContentArtifactIds];
    operation.actionArtifactIds = [...event.data.actionArtifactIds];
    operation.sessionArtifactId = session.id;
    operation.sessionReceiptId = receipt.receiptId;
    operation.sessionReceiptContentId = event.data.sessionReceiptContentId;
    return true;
  }
  if (event.type === "computer_use.operation_failed") {
    invariant(event.producer.kind === "computer_use_host", event, "Computer-use failure must come from its bounded runtime host");
    const operation = next.computerUseOperations[event.data.operationId];
    invariant(operation?.status === "started", event, `Computer-use ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return true;
  }
  return false;
}
