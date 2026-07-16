import type { RuntimeProjection } from "../model.ts";
import type { ProductionStudioSemanticEvidenceView } from "./model.ts";

/** Projects identities and closed availability only; timed hypothesis text remains in the audited private artifact. */
export function projectSemanticEvidence(state: RuntimeProjection): ProductionStudioSemanticEvidenceView[] {
  return Object.values(state.semanticEvidence)
    .map((operation): ProductionStudioSemanticEvidenceView => {
      const completed = operation.status === "completed" &&
        operation.outputArtifactId !== null && operation.outputContentId !== null &&
        operation.receiptId !== null && operation.receiptContentId !== null &&
        operation.observationCount !== null && operation.availability !== null;
      return {
        operationId: operation.id,
        capability: "speech.transcribe",
        status: operation.status,
        audit: completed ? "verified_at_completion" : "not_completed",
        producer: {
          id: operation.producer.id,
          version: operation.producer.version,
          model: operation.producer.model,
          runtimeId: operation.producer.runtime.id,
          runtimeVersion: operation.producer.runtime.version,
          configurationId: operation.producer.configuration.id,
          configurationContentId: operation.producer.configuration.contentId,
          executionScope: operation.producer.executionScope,
        },
        executor: {
          taskId: operation.taskId,
          agentId: operation.agentId,
          executionId: operation.executionId,
          launchClaimId: operation.launchClaimId,
          grantId: operation.grantId,
        },
        source: {
          artifactId: operation.sourceArtifactId,
          contentId: operation.sourceContentId,
          trackId: operation.trackId,
          range: { startMs: operation.startMs, endMs: operation.endMs },
        },
        returnedRange: completed ? structuredClone(operation.returnedRange) : null,
        artifact: completed ? { artifactId: operation.outputArtifactId!, contentId: operation.outputContentId! } : null,
        receipt: completed ? { receiptId: operation.receiptId!, contentId: operation.receiptContentId! } : null,
        observationCount: completed ? operation.observationCount : null,
        availability: completed ? {
          id: operation.availability!.id,
          state: operation.availability!.state,
          truncated: operation.availability!.truncated,
        } : null,
        failure: operation.failure,
      };
    })
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
}
