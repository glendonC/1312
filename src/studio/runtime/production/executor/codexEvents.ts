import { LauncherFailure } from "./launcherFailure.ts";

export interface CodexUsageEvent {
  type: "turn.completed";
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
  };
}

export interface ParsedCodexEvents {
  usageEvent: CodexUsageEvent;
  rawUsageEvent: Record<string, unknown>;
  finalMessage: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function measuredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new LauncherFailure(
      `Codex usage ${field} is not a non-negative safe integer`,
      "Codex executor usage failed validation.",
    );
  }
  return value as number;
}

export function parseCodexEvents(stdout: string): ParsedCodexEvents {
  const lines = stdout.trimEnd().split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new LauncherFailure(
      "Codex emitted no JSONL events",
      "Codex executor emitted no validated events.",
    );
  }

  let threadStarts = 0;
  const usageEvents: Array<{ normalized: CodexUsageEvent; raw: Record<string, unknown> }> = [];
  const messages: string[] = [];

  for (const [index, line] of lines.entries()) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new LauncherFailure(
        `Codex JSONL line ${index + 1} is invalid: ${error instanceof Error ? error.message : "invalid JSON"}`,
        "Codex executor output failed validation.",
      );
    }
    const event = record(value);
    const type = event?.type;
    if (!event || typeof type !== "string") {
      throw new LauncherFailure(
        `Codex JSONL line ${index + 1} has no event type`,
        "Codex executor output failed validation.",
      );
    }
    if (type === "error" || type === "turn.failed") {
      throw new LauncherFailure(`Codex emitted ${type}`, "Codex executor reported a failed turn.");
    }
    if (type === "thread.started") threadStarts += 1;
    if (type === "turn.completed") {
      const usage = record(event.usage);
      if (!usage) {
        throw new LauncherFailure(
          "Codex completed turn has no usage",
          "Codex executor usage failed validation.",
        );
      }
      const parsed: CodexUsageEvent = {
        type: "turn.completed",
        usage: {
          input_tokens: measuredInteger(usage.input_tokens, "input_tokens"),
          cached_input_tokens: measuredInteger(usage.cached_input_tokens, "cached_input_tokens"),
          output_tokens: measuredInteger(usage.output_tokens, "output_tokens"),
          reasoning_output_tokens: measuredInteger(
            usage.reasoning_output_tokens,
            "reasoning_output_tokens",
          ),
        },
      };
      if (parsed.usage.cached_input_tokens > parsed.usage.input_tokens) {
        throw new LauncherFailure(
          "Codex cached input tokens exceed input tokens",
          "Codex executor usage failed validation.",
        );
      }
      usageEvents.push({ normalized: parsed, raw: event });
    }
    if (type === "item.completed") {
      const item = record(event.item);
      if (item?.type === "agent_message" && typeof item.text === "string") {
        messages.push(item.text);
      }
    }
  }

  if (threadStarts !== 1 || usageEvents.length !== 1 || messages.length === 0) {
    throw new LauncherFailure(
      `Codex stream required one thread, one completed turn, and a final agent message; received ${threadStarts}, ${usageEvents.length}, ${messages.length}`,
      "Codex executor did not emit one complete validated turn.",
    );
  }
  return {
    usageEvent: usageEvents[0].normalized,
    rawUsageEvent: usageEvents[0].raw,
    finalMessage: messages[messages.length - 1],
  };
}
