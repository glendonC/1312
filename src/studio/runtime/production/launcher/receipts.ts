import { canonicalSha256, type ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { RuntimeLedger } from "../journal.ts";
import type {
  ExecutorSpanReceipt,
  ModelUsageReceipt,
  TaskRecord,
} from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import type { CodexUsageEvent } from "../executor/codexEvents.ts";
import type { ProcessResult } from "../executor/processRunner.ts";

export async function recordCodexModelUsage(input: {
  artifacts: ContentAddressedArtifactStore;
  ledger: RuntimeLedger;
  executionId: string;
  task: TaskRecord;
  version: string;
  model: string | null;
  usageEvent: CodexUsageEvent;
  rawUsageEvent: Record<string, unknown>;
}): Promise<ModelUsageReceipt> {
  const raw = await input.artifacts.storeJson(input.rawUsageEvent);
  const body = {
    executionId: input.executionId,
    taskId: input.task.id,
    agentId: input.task.assignedAgentId,
    producer: { id: "codex.exec" as const, version: input.version },
    model: input.model,
    measured: {
      inputTokens: input.usageEvent.usage.input_tokens,
      cachedInputTokens: input.usageEvent.usage.cached_input_tokens,
      outputTokens: input.usageEvent.usage.output_tokens,
      reasoningOutputTokens: input.usageEvent.usage.reasoning_output_tokens,
    },
    providerUnits: null,
    billing: { amount: null, currency: null },
    rawReceipt: {
      source: "codex.exec.turn.completed" as const,
      contentId: raw.content.contentId,
      storageKey: raw.storageKey,
    },
  };
  const receipt: ModelUsageReceipt = {
    schema: "studio.model-usage.receipt.v1",
    receiptId: `usage:${canonicalSha256(body)}`,
    ...body,
  };
  await input.ledger.transact(
    { producer: { kind: "launcher", id: "codex-exec-worker-launcher" }, causationId: input.executionId },
    () => ({
      pending: [{ type: "model.usage_recorded", data: { receipt } }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  return receipt;
}

export function codexExecutorSpanReceipt(input: {
  executionId: string;
  task: TaskRecord;
  version: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outcome: ExecutorSpanReceipt["outcome"];
  process: Pick<ProcessResult, "exitCode" | "signal">;
  outputArtifactIds: string[];
  usageReceiptId: string | null;
  failure: string | null;
}): ExecutorSpanReceipt {
  const body = {
    executionId: input.executionId,
    taskId: input.task.id,
    agentId: input.task.assignedAgentId,
    phase: "active" as const,
    producer: {
      id: "codex.exec" as const,
      version: input.version,
      sandbox: "read-only" as const,
      ephemeral: true as const,
    },
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    monotonicDurationMs: input.durationMs,
    outcome: input.outcome,
    process: { exitCode: input.process.exitCode, signal: input.process.signal },
    outputArtifactIds: input.outputArtifactIds,
    modelUsageReceiptId: input.usageReceiptId,
    failure: input.failure,
  };
  return {
    schema: "studio.executor-span.receipt.v1",
    receiptId: `span:${canonicalSha256(body)}`,
    ...body,
  };
}

export function closedProcessExitReason(result: ProcessResult): string {
  const diagnostic = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (diagnostic.includes("mcp") || diagnostic.includes("model context protocol")) {
    return "Codex executor could not start its required closed MCP tool surface.";
  }
  if (diagnostic.includes("429") || diagnostic.includes("rate limit") || diagnostic.includes("too many requests")) {
    return "Codex executor was rejected by the model service rate limit before a completed turn.";
  }
  if (diagnostic.includes("401") || diagnostic.includes("403") || diagnostic.includes("unauthorized") || diagnostic.includes("authentication")) {
    return "Codex executor lacked model-service authorization before a completed turn.";
  }
  if (diagnostic.includes("model") && (diagnostic.includes("not found") || diagnostic.includes("unsupported") || diagnostic.includes("invalid"))) {
    return "Codex executor model configuration was rejected before a completed turn.";
  }
  if (diagnostic.includes("stream") || diagnostic.includes("connection") || diagnostic.includes("transport")) {
    return "Codex executor transport closed before a completed turn.";
  }
  if (diagnostic.includes("schema")) {
    return "Codex executor output-schema configuration was rejected before a completed turn.";
  }
  return "Codex executor exited without a completed turn.";
}
