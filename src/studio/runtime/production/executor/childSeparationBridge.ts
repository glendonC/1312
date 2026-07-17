import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { RawStemComparison, TaskRecord } from "../model.ts";
import type { VerifiedConditionalSeparation } from "../separationHost.ts";

export const CHILD_SEPARATION_TOOL_NAME = "media_audio_separate" as const;
const MAX_REQUEST_BYTES = 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type ChildSeparationToolArguments = Record<string, never>;

export interface ChildSeparationToolManifest {
  schema: "studio.child-separation-tools.v1";
  taskId: string;
  agentId: string;
  tool: { name: typeof CHILD_SEPARATION_TOOL_NAME; capability: "media.audio.separate"; exactRange: { startMs: number; endMs: number }; maxCalls: 1 };
}

export interface ChildSeparationToolResult {
  schema: "studio.child-separation-tool-result.v1";
  capability: "media.audio.separate";
  operationId: string;
  stemArtifactIds: [string, string];
  receiptArtifactId: string;
  receiptId: string;
  receiptContentId: string;
  comparisonArtifactId: string;
  comparisonReceiptArtifactId: string;
  comparisonReceiptId: string;
  outcome: RawStemComparison["outcome"];
  semanticPreference: null;
  semanticAuthority: "not_granted";
  captionAuthority: "not_granted";
}

export class ChildSeparationBridgeError extends Error {
  readonly code: "invalid_request" | "capability_not_granted" | "operation_rejected" | "bridge_unavailable";
  constructor(code: "invalid_request" | "capability_not_granted" | "operation_rejected" | "bridge_unavailable", message: string) {
    super(message);
    this.name = "ChildSeparationBridgeError";
    this.code = code;
  }
}

export interface ChildSeparationHost {
  separate(request: unknown): Promise<VerifiedConditionalSeparation>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function argumentsValue(value: unknown): ChildSeparationToolArguments {
  const item = record(value);
  if (!item || !exact(item, [])) throw new ChildSeparationBridgeError("invalid_request", "Conditional separation accepts only {}; the host injects the audited source, trigger, range, method, model, and configuration.");
  return {};
}

export class BoundedChildSeparationBridge {
  private readonly task: TaskRecord;
  private readonly host: ChildSeparationHost;
  private readonly options: { nextOperationId?: () => string };
  constructor(
    task: TaskRecord,
    host: ChildSeparationHost,
    options: { nextOperationId?: () => string } = {},
  ) {
    this.task = structuredClone(task);
    this.host = host;
    this.options = options;
  }

  private grant() {
    const grants = this.task.grants.filter((grant) => grant.capability === "media.audio.separate");
    if (grants.length !== 1 || !grants[0].separationScope || grants[0].mediaScope.length !== 1) throw new ChildSeparationBridgeError("capability_not_granted", "Child task has no exact conditional separation grant.");
    return grants[0] as typeof grants[number] & { separationScope: NonNullable<typeof grants[number]["separationScope"]> };
  }

  manifest(): ChildSeparationToolManifest {
    const grant = this.grant();
    return { schema: "studio.child-separation-tools.v1", taskId: this.task.id, agentId: this.task.assignedAgentId, tool: { name: CHILD_SEPARATION_TOOL_NAME, capability: "media.audio.separate", exactRange: structuredClone(grant.separationScope.source.range), maxCalls: 1 } };
  }

  async call(value: unknown): Promise<ChildSeparationToolResult> {
    argumentsValue(value);
    const grant = this.grant();
    const operationId = this.options.nextOperationId?.() ?? `operation:child:media-audio-separate:${randomUUID()}`;
    let verified: VerifiedConditionalSeparation;
    try {
      verified = await this.host.separate({ operationId, taskId: this.task.id, agentId: this.task.assignedAgentId, grantId: grant.id });
    } catch {
      throw new ChildSeparationBridgeError("operation_rejected", "The conditional separation host failed closed.");
    }
    if (
      verified.receipt.operationId !== operationId || verified.receipt.authorization.taskId !== this.task.id ||
      verified.receipt.authorization.agentId !== this.task.assignedAgentId || verified.receipt.authorization.grantId !== grant.id ||
      verified.comparison.operationId !== operationId || verified.comparison.separationReceiptId !== verified.receipt.receiptId ||
      verified.comparison.deterministicGate.semanticPreference !== null || verified.comparison.deterministicGate.semanticAuthority !== "not_granted" ||
      verified.comparison.deterministicGate.captionAuthority !== "not_granted" || verified.stems.some((artifact) => artifact.publication !== "private")
    ) throw new ChildSeparationBridgeError("operation_rejected", "Conditional separation host returned content outside the injected grant or attempted an authority upgrade.");
    return {
      schema: "studio.child-separation-tool-result.v1", capability: "media.audio.separate", operationId,
      stemArtifactIds: [verified.stems[0].id, verified.stems[1].id], receiptArtifactId: verified.receiptArtifact.id,
      receiptId: verified.receipt.receiptId, receiptContentId: verified.receiptArtifact.content.contentId,
      comparisonArtifactId: verified.comparisonArtifact.id, comparisonReceiptArtifactId: verified.comparisonReceiptArtifact.id,
      comparisonReceiptId: verified.comparisonReceipt.receiptId, outcome: verified.comparison.outcome,
      semanticPreference: null, semanticAuthority: "not_granted", captionAuthority: "not_granted",
    };
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  if (Buffer.byteLength(payload) > MAX_RESPONSE_BYTES) return json(response, 500, { error: { code: "bridge_unavailable", message: "Conditional separation response exceeded its byte limit." } });
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload), "Cache-Control": "no-store" });
  response.end(payload);
}

function authorized(request: IncomingMessage, token: string): boolean {
  const expected = Buffer.from(token);
  const candidate = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) throw new ChildSeparationBridgeError("invalid_request", "Conditional separation request exceeded its byte limit.");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ChildSeparationBridgeError("invalid_request", "Conditional separation request is not JSON."); }
}

export interface OpenChildSeparationBridge {
  endpoint: string;
  token: string;
  manifest: ChildSeparationToolManifest;
  close(): Promise<void>;
}

export async function openChildSeparationBridge(bridge: BoundedChildSeparationBridge): Promise<OpenChildSeparationBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server: Server = createServer(async (request, response) => {
    try {
      if (!authorized(request, token)) return json(response, 401, { error: { code: "bridge_unavailable", message: "Conditional separation bridge bearer is invalid." } });
      if (request.method === "GET" && request.url === "/manifest") return json(response, 200, manifest);
      if (request.method !== "POST" || request.url !== "/call") return json(response, 404, { error: { code: "invalid_request", message: "Conditional separation route is unknown." } });
      const body = record(await requestJson(request));
      if (!body || !exact(body, ["name", "arguments"]) || body.name !== CHILD_SEPARATION_TOOL_NAME) throw new ChildSeparationBridgeError("invalid_request", "Conditional separation bridge call shape is invalid.");
      json(response, 200, await bridge.call(body.arguments));
    } catch (error) {
      const safe = error instanceof ChildSeparationBridgeError ? error : new ChildSeparationBridgeError("bridge_unavailable", "Conditional separation bridge failed closed.");
      json(response, safe.code === "invalid_request" ? 400 : 409, { error: { code: safe.code, message: safe.message } });
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Conditional separation bridge did not bind exact loopback TCP");
  return { endpoint: `http://127.0.0.1:${address.port}`, token, manifest, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

async function bridgeFetch(endpoint: string, token: string, path: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(path, endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== new URL(endpoint).origin) throw new ChildSeparationBridgeError("bridge_unavailable", "Conditional separation endpoint is not exact loopback HTTP.");
  const response = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } }).catch(() => { throw new ChildSeparationBridgeError("bridge_unavailable", "Conditional separation bridge could not be reached."); });
  const declared = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_RESPONSE_BYTES) throw new ChildSeparationBridgeError("bridge_unavailable", "Conditional separation response has an invalid byte envelope.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== declared) throw new ChildSeparationBridgeError("bridge_unavailable", "Conditional separation response changed its byte envelope.");
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!response.ok) throw new ChildSeparationBridgeError("operation_rejected", "Conditional separation bridge rejected the call.");
  return value;
}

export async function fetchChildSeparationManifest(endpoint: string, token: string): Promise<ChildSeparationToolManifest> {
  const value = await bridgeFetch(endpoint, token, "/manifest");
  const item = record(value);
  const tool = record(item?.tool);
  const range = record(tool?.exactRange);
  if (!item || !exact(item, ["schema", "taskId", "agentId", "tool"]) || item.schema !== "studio.child-separation-tools.v1" || typeof item.taskId !== "string" || typeof item.agentId !== "string" || !tool || !exact(tool, ["name", "capability", "exactRange", "maxCalls"]) || tool.name !== CHILD_SEPARATION_TOOL_NAME || tool.capability !== "media.audio.separate" || tool.maxCalls !== 1 || !range || !exact(range, ["startMs", "endMs"]) || !Number.isSafeInteger(range.startMs) || !Number.isSafeInteger(range.endMs) || (range.endMs as number) <= (range.startMs as number)) throw new ChildSeparationBridgeError("bridge_unavailable", "Conditional separation manifest failed validation.");
  return value as ChildSeparationToolManifest;
}

export async function callChildSeparationBridge(endpoint: string, token: string, args: ChildSeparationToolArguments): Promise<ChildSeparationToolResult> {
  argumentsValue(args);
  const value = await bridgeFetch(endpoint, token, "/call", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ name: CHILD_SEPARATION_TOOL_NAME, arguments: args }) });
  const item = record(value);
  if (!item || !exact(item, ["schema", "capability", "operationId", "stemArtifactIds", "receiptArtifactId", "receiptId", "receiptContentId", "comparisonArtifactId", "comparisonReceiptArtifactId", "comparisonReceiptId", "outcome", "semanticPreference", "semanticAuthority", "captionAuthority"]) || item.schema !== "studio.child-separation-tool-result.v1" || item.capability !== "media.audio.separate" || !Array.isArray(item.stemArtifactIds) || item.stemArtifactIds.length !== 2 || item.semanticPreference !== null || item.semanticAuthority !== "not_granted" || item.captionAuthority !== "not_granted" || !new Set(["agreement", "disagreement", "abstention"]).has(item.outcome as string)) throw new ChildSeparationBridgeError("bridge_unavailable", "Conditional separation result failed its closed authority contract.");
  return value as ChildSeparationToolResult;
}
