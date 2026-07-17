import type { WorkerOutputEnvelope } from "../model.ts";
import { array, exact, fail, literal, object, string } from "./primitives.ts";
import { validateSemanticEvidenceCitationInput } from "./semanticEvidence.ts";

export function assertWorkerOutputEnvelope(
  value: unknown,
  context = "Worker output",
): asserts value is WorkerOutputEnvelope {
  const item = object(value, context, "envelope");
  exact(
    item,
    item.semanticEvidenceInputs === undefined
      ? ["schema", "executionId", "taskId", "agentId", "output"]
      : ["schema", "executionId", "taskId", "agentId", "semanticEvidenceInputs", "output"],
    context,
    "envelope",
  );
  literal(item.schema, "studio.worker-output.v1", context, "envelope.schema");
  string(item.executionId, context, "envelope.executionId");
  string(item.taskId, context, "envelope.taskId");
  string(item.agentId, context, "envelope.agentId");
  if (item.semanticEvidenceInputs !== undefined) {
    const inputs = array(item.semanticEvidenceInputs, context, "envelope.semanticEvidenceInputs");
    if (inputs.length === 0) {
      fail(context, "envelope.semanticEvidenceInputs", "must name at least one authenticated semantic operation");
    }
    inputs.forEach((input, index) =>
      validateSemanticEvidenceCitationInput(input, context, `envelope.semanticEvidenceInputs[${index}]`));
    const operationIds = inputs.map((input) => (input as { operationId: string }).operationId);
    if (new Set(operationIds).size !== operationIds.length) {
      fail(context, "envelope.semanticEvidenceInputs", "must not repeat operations");
    }
  }
  const output = object(item.output, context, "envelope.output");
  exact(output, ["name", "kind", "content"], context, "envelope.output");
  string(output.name, context, "envelope.output.name");
  string(output.kind, context, "envelope.output.kind");
  string(output.content, context, "envelope.output.content");
}
