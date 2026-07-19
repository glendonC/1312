import { capabilityOperationExists, taskCapabilityCallCount } from "../capabilityUsage.ts";
import type { RuntimeProjection } from "../model.ts";
import { SEPARATION_METHOD } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { conditionalSeparationRequestFingerprint } from "../validation/separation.ts";
import { u1AcousticTriggerLineageMatches } from "../separation/acousticSeparationTrigger.ts";
import { invariant } from "./shared.ts";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyConditionalSeparationEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "media.conditional_separation_started") {
    invariant(event.producer.kind === "separation_host", event, "Conditional separation must come from its bounded host");
    const { request, scope, trigger } = event.data;
    const task = next.tasks[request.taskId];
    invariant(task?.status === "working" && task.ownerAgentId === request.agentId, event, `Conditional separation ${request.operationId} has no working owner`);
    invariant(!capabilityOperationExists(next, request.operationId), event, `Conditional separation ${request.operationId} is duplicated`);
    const grant = task.grants.find((candidate) => candidate.id === request.grantId);
    invariant(grant?.capability === "media.audio.separate" && grant.separationScope, event, `Conditional separation ${request.operationId} lacks its exact grant`);
    invariant(grant.mediaScope.length === 1 && same(grant.mediaScope[0], scope), event, `Conditional separation ${request.operationId} changed scheduler range`);
    invariant(same(grant.separationScope.source.range, { startMs: scope.startMs, endMs: scope.endMs }) && same(grant.separationScope.trigger, trigger), event, `Conditional separation ${request.operationId} changed trigger or exact range`);
    invariant(same(grant.separationScope.limits, event.data.limits), event, `Conditional separation ${request.operationId} changed limits`);
    const source = next.artifacts[scope.artifactId];
    const track = source?.tracks.find((candidate) => candidate.id === scope.trackId);
    invariant(
      source?.origin.kind === "ingest" && source.content.contentId === event.data.sourceContentId && source.content.contentId === grant.separationScope.source.contentId &&
      source.content.bytes <= grant.separationScope.limits.maxSourceBytes && task.jobContext.source.artifactId === source.id && task.jobContext.source.contentId === source.content.contentId,
      event,
      `Conditional separation ${request.operationId} changed immutable raw source`,
    );
    invariant(track?.kind === "audio" && scope.endMs <= (source.durationMs ?? 0) && scope.endMs - scope.startMs <= grant.separationScope.limits.maxRangeMs, event, `Conditional separation ${request.operationId} has no bounded exact audio range`);
    if (trigger.kind === "u6_speaker_overlap") {
      const speaker = next.speakerOverlapOperations[trigger.operationId];
      invariant(
        speaker?.status === "completed" && speaker.sourceArtifactId === source.id && speaker.trackId === track.id &&
        speaker.outputArtifactId === trigger.observationsArtifactId && speaker.receiptArtifactId === trigger.receiptArtifactId &&
        speaker.receiptId === trigger.receiptId && speaker.receiptContentId === trigger.receiptContentId,
        event,
        `Conditional separation ${request.operationId} lost its U6.1 (speaker_overlap) trigger`,
      );
    } else {
      invariant(
        u1AcousticTriggerLineageMatches(next.artifacts, trigger, source.id, track.id),
        event,
        `Conditional separation ${request.operationId} lost its U1 acoustic trigger`,
      );
    }
    const fingerprint = conditionalSeparationRequestFingerprint({
      sourceContentId: source.content.contentId,
      trackId: track.id,
      range: { startMs: scope.startMs, endMs: scope.endMs },
      trigger,
      modelContentIds: [...SEPARATION_METHOD.modelContentIds],
      configurationContentId: SEPARATION_METHOD.configurationContentId,
    });
    invariant(fingerprint === event.data.requestFingerprint, event, `Conditional separation ${request.operationId} changed request identity`);
    invariant(!Object.values(next.conditionalSeparationOperations).some((entry) => entry.taskId === task.id && entry.requestFingerprint === fingerprint), event, `Conditional separation ${request.operationId} repeats identical work`);
    invariant(Object.values(next.conditionalSeparationOperations).filter((entry) => entry.grantId === grant.id).length < grant.separationScope.limits.maxCalls, event, `Conditional separation grant ${grant.id} exhausted its call budget`);
    invariant(taskCapabilityCallCount(next, task.id) < task.budget.toolCalls, event, `task ${task.id} exhausted its tool-call budget`);
    const execution = next.executions[event.data.executionId];
    const launch = next.taskLaunches[task.id];
    invariant(execution?.status === "active" && execution.taskId === task.id && execution.agentId === request.agentId && execution.launchClaimId === event.data.launchClaimId && launch?.id === event.data.launchClaimId && launch.executionId === execution.id, event, `Conditional separation ${request.operationId} lost executor lineage`);
    next.conditionalSeparationOperations[request.operationId] = {
      id: request.operationId, taskId: task.id, agentId: request.agentId, grantId: grant.id,
      executionId: execution.id, launchClaimId: launch.id, sourceArtifactId: source.id, trackId: track.id,
      startMs: scope.startMs, endMs: scope.endMs, requestFingerprint: fingerprint, trigger: structuredClone(trigger),
      limits: structuredClone(event.data.limits), status: "started", stemArtifactIds: [], receiptArtifactId: null,
      receiptId: null, receiptContentId: null, comparisonArtifactId: null, comparisonReceiptArtifactId: null,
      comparisonReceiptId: null, failure: null,
    };
    return true;
  }
  if (event.type === "media.conditional_separation_completed") {
    invariant(event.producer.kind === "separation_host", event, "Conditional separation completion must come from its bounded host");
    const operation = next.conditionalSeparationOperations[event.data.operationId];
    invariant(operation?.status === "started", event, `Conditional separation ${event.data.operationId} is not active`);
    const stems = event.data.stemArtifactIds.map((id) => next.artifacts[id]);
    const receiptArtifact = next.artifacts[event.data.receiptArtifactId];
    const comparison = next.artifacts[event.data.comparisonArtifactId];
    const comparisonReceiptArtifact = next.artifacts[event.data.comparisonReceiptArtifactId];
    invariant(stems.length === 2 && stems.every((artifact) => artifact?.origin.kind === "separation_stem") && receiptArtifact?.origin.kind === "conditional_separation_receipt" && comparison?.origin.kind === "raw_stem_comparison" && comparisonReceiptArtifact?.origin.kind === "raw_stem_comparison_receipt", event, `Conditional separation ${operation.id} has incomplete stored artifacts`);
    const receipt = event.data.receipt;
    invariant(receipt.operationId === operation.id && receipt.authorization.grantId === operation.grantId && receipt.authorization.taskId === operation.taskId && receipt.authorization.agentId === operation.agentId && receipt.authorization.executionId === operation.executionId && receipt.authorization.launchClaimId === operation.launchClaimId, event, `Conditional separation ${operation.id} receipt changed authorization`);
    invariant(same(receipt.outputs.map((output) => output.artifactId), event.data.stemArtifactIds) && receiptArtifact.content.contentId === event.data.receiptContentId && receiptArtifact.origin.receiptId === receipt.receiptId, event, `Conditional separation ${operation.id} changed stem or receipt identities`);
    for (const [index, stem] of stems.entries()) {
      invariant(stem.origin.kind === "separation_stem", event, `Conditional separation ${operation.id} stem ${index + 1} changed origin`);
      invariant(stem.id === receipt.outputs[index].artifactId && stem.content.contentId === receipt.outputs[index].contentId && stem.content.bytes === receipt.outputs[index].bytes && stem.origin.operationId === operation.id && stem.origin.receiptId === receipt.receiptId && stem.origin.receiptContentId === event.data.receiptContentId, event, `Conditional separation ${operation.id} changed stem ${index + 1}`);
    }
    const comparisonReceipt = event.data.comparisonReceipt;
    invariant(comparisonReceipt.operationId === operation.id && comparisonReceipt.separationReceiptId === receipt.receiptId && comparisonReceipt.comparison.artifactId === comparison.id && comparisonReceipt.comparison.contentId === comparison.content.contentId && comparisonReceiptArtifact.content.contentId === event.data.comparisonReceiptContentId && comparisonReceiptArtifact.origin.receiptId === comparisonReceipt.receiptId, event, `Conditional separation ${operation.id} changed raw/stem comparison identity`);
    operation.status = "completed";
    operation.stemArtifactIds = [...event.data.stemArtifactIds];
    operation.receiptArtifactId = receiptArtifact.id;
    operation.receiptId = receipt.receiptId;
    operation.receiptContentId = receiptArtifact.content.contentId;
    operation.comparisonArtifactId = comparison.id;
    operation.comparisonReceiptArtifactId = comparisonReceiptArtifact.id;
    operation.comparisonReceiptId = comparisonReceipt.receiptId;
    return true;
  }
  if (event.type === "media.conditional_separation_failed") {
    invariant(event.producer.kind === "separation_host", event, "Conditional separation failure must come from its bounded host");
    const operation = next.conditionalSeparationOperations[event.data.operationId];
    invariant(operation?.status === "started", event, `Conditional separation ${event.data.operationId} is not active`);
    operation.status = "failed";
    operation.failure = event.data.reason;
    return true;
  }
  return false;
}
