import type {
  RuntimeHostStartAcknowledgement,
  RuntimeHostStatus,
} from "../runtime/production/runtimeHost/model";

export type RuntimeStatusView = Omit<RuntimeHostStatus, "schema">;

export function defaultHostUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:4312";
  return new URLSearchParams(window.location.search).get("runtimeHost") ?? "http://127.0.0.1:4312";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The local runtime operation failed closed.";
}

export function statusView(
  value: RuntimeHostStatus | RuntimeHostStartAcknowledgement,
): RuntimeStatusView {
  const { schema: _schema, ...status } = value;
  return status;
}

export function seconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(3).replace(/\.?(?:0+)$/, "")}s`;
}
