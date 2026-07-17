import type { RuntimeProjection } from "./model.ts";

export function capabilityOperationExists(state: RuntimeProjection, operationId: string): boolean {
  return Boolean(
    state.operations[operationId] ||
    state.frameSamples[operationId] ||
    state.ocrOperations[operationId] ||
    state.speakerOverlapOperations[operationId] ||
    state.conditionalSeparationOperations[operationId] ||
    state.semanticEvidence[operationId] ||
    state.evidenceReads[operationId] ||
    state.evidenceAssessments[operationId] ||
    state.evidenceDecisions[operationId]
  );
}

export function taskCapabilityCallCount(state: RuntimeProjection, taskId: string): number {
  return [
    ...Object.values(state.operations),
    ...Object.values(state.frameSamples),
    ...Object.values(state.ocrOperations),
    ...Object.values(state.speakerOverlapOperations),
    ...Object.values(state.conditionalSeparationOperations),
    ...Object.values(state.semanticEvidence),
    ...Object.values(state.evidenceReads),
    ...Object.values(state.evidenceAssessments),
    ...Object.values(state.evidenceDecisions),
  ].filter((operation) => operation.taskId === taskId).length;
}

export function taskHasActiveCapability(state: RuntimeProjection, taskId: string): boolean {
  return [
    ...Object.values(state.operations),
    ...Object.values(state.frameSamples),
    ...Object.values(state.ocrOperations),
    ...Object.values(state.speakerOverlapOperations),
    ...Object.values(state.conditionalSeparationOperations),
    ...Object.values(state.semanticEvidence),
    ...Object.values(state.evidenceReads),
    ...Object.values(state.evidenceAssessments),
    ...Object.values(state.evidenceDecisions),
  ].some((operation) => operation.taskId === taskId && operation.status === "started");
}
