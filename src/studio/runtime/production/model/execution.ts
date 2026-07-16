export type ExecutorOutcome = "completed" | "failed" | "timed_out";
export type ExecutorStatus = "active" | ExecutorOutcome | "interrupted";

export interface ExecutorSpanReceipt {
  schema: "studio.executor-span.receipt.v1";
  receiptId: string;
  executionId: string;
  taskId: string;
  agentId: string;
  phase: "active";
  producer:
    | {
        id: "codex.exec";
        version: string;
        sandbox: "read-only";
        ephemeral: true;
      }
    | {
        id: "studio.deterministic-test-executor";
        version: "1";
        sandbox: "read-only";
        ephemeral: true;
      };
  startedAt: string;
  endedAt: string;
  monotonicDurationMs: number;
  outcome: ExecutorOutcome;
  process: {
    exitCode: number | null;
    signal: string | null;
  };
  outputArtifactIds: string[];
  modelUsageReceiptId: string | null;
  failure: string | null;
}

export interface ModelUsageReceipt {
  schema: "studio.model-usage.receipt.v1";
  receiptId: string;
  executionId: string;
  taskId: string;
  agentId: string;
  producer: {
    id: "codex.exec";
    version: string;
  };
  /** Explicit host configuration; the CLI usage event is measured separately below. */
  model: string | null;
  measured: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  };
  /** No provider-unit or billing producer exists in this launcher. */
  providerUnits: null;
  billing: {
    amount: null;
    currency: null;
  };
  rawReceipt: {
    source: "codex.exec.turn.completed";
    contentId: string;
    storageKey: string;
  };
}

export interface ExecutorRecord {
  id: string;
  taskId: string;
  agentId: string;
  startedAt: string;
  launchClaimId: string;
  status: ExecutorStatus;
  receipt: ExecutorSpanReceipt | null;
  outputArtifactIds: string[];
  modelUsageReceiptId: string | null;
}
