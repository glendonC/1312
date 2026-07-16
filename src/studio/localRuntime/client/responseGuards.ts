import type {
  RuntimeHostFailureReason,
  RuntimeHostStatus,
} from "../../runtime/production/runtimeHost/model.ts";
import { isRuntimeHostLifecycle } from "../model.ts";

const FAILURE_CODES = new Set<RuntimeHostFailureReason["code"]>([
  "initialization_failed",
  "executor_failed",
  "executor_interrupted",
  "host_stopped_before_start_receipt",
  "host_stopped_before_journal",
  "host_stopped_before_executor_launch",
  "executor_launch_unconfirmed",
  "nonterminal_journal_after_restart",
  "runtime_evidence_failed",
  "stored_content_inconsistent",
]);

export class RuntimeHostClientError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;

  constructor(
    message: string,
    code: string,
    httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "RuntimeHostClientError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function fail(context: string, message: string): never {
  throw new RuntimeHostClientError(`${context}: ${message}`, "invalid_host_response");
}

export function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(context, "expected an object response.");
  }
  return value as Record<string, unknown>;
}

export function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  context: string,
): void {
  const expected = new Set(required);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) fail(context, `field ${key} is not allowed.`);
  }
  for (const key of required) {
    if (!(key in value)) fail(context, `field ${key} is required.`);
  }
}

export function string(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    fail(context, "expected a non-empty trimmed string.");
  }
  return value;
}

export function identity(value: unknown, context: string): string {
  const result = string(value, context);
  if (result.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    fail(context, "expected a stable identity without path characters.");
  }
  return result;
}

export function contentId(value: unknown, context: string): string {
  const result = string(value, context);
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) fail(context, "expected a SHA-256 content identity.");
  return result;
}

export function integer(value: unknown, context: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(context, `expected a safe integer of at least ${minimum}.`);
  }
  return value as number;
}

export function boolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") fail(context, "expected a boolean.");
  return value;
}

export function timestamp(value: unknown, context: string): string {
  const result = string(value, context);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) {
    fail(context, "expected an exact ISO timestamp.");
  }
  return result;
}

export function reason(value: unknown, context: string): RuntimeHostFailureReason | null {
  if (value === null) return null;
  const item = object(value, context);
  exact(item, ["code", "message"], context);
  if (!FAILURE_CODES.has(item.code as RuntimeHostFailureReason["code"])) {
    fail(`${context}.code`, "has an unsupported closed reason.");
  }
  const message = string(item.message, `${context}.message`);
  if (message.length > 256) fail(`${context}.message`, "is too long.");
  return { code: item.code as RuntimeHostFailureReason["code"], message };
}

export function lifecycle(value: unknown, context: string): RuntimeHostStatus["lifecycle"] {
  if (!isRuntimeHostLifecycle(value)) fail(context, "has an unsupported lifecycle.");
  return value;
}
