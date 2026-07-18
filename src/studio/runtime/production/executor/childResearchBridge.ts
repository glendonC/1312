import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { canonicalJsonContentId } from "../artifactStore/contentIdentity.ts";
import {
  RESEARCH_CAPABILITY,
  RESEARCH_LIMITS,
  type ResearchDocumentSnapshotReceipt,
  type ResearchExtractionArtifact,
  type ResearchGrantView,
  type ResearchSearchReceipt,
} from "../model/research.ts";
import {
  validateResearchExtractionArtifact,
  validateResearchSearchReceipt,
  validateResearchSnapshotReceipt,
} from "../validation/research.ts";
import type { VerifiedResearchSearch, VerifiedResearchSnapshot } from "../research/researchHost.ts";

export const CHILD_RESEARCH_SEARCH_TOOL_NAME = "research_search" as const;
export const CHILD_RESEARCH_SNAPSHOT_TOOL_NAME = "research_document_snapshot" as const;
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 384 * 1024;

export interface ChildResearchSearchArguments {
  query: string;
}

export interface ChildResearchSnapshotArguments {
  searchOperationId: string;
  resultIndex: number;
}

export interface ChildResearchToolManifest {
  schema: "studio.child-research-tools.v1";
  taskId: string;
  agentId: string;
  capability: typeof RESEARCH_CAPABILITY;
  gap: { hypothesis: string; media: { artifactId: string; trackId: string; startMs: number; endMs: number } };
  allowedDomains: string[];
  limits: {
    maxQueries: number;
    maxQueryChars: number;
    maxResultsPerQuery: number;
    maxDocuments: number;
    maxRedirects: number;
    maxWallMs: number;
  };
  tools: [
    { name: typeof CHILD_RESEARCH_SEARCH_TOOL_NAME },
    { name: typeof CHILD_RESEARCH_SNAPSHOT_TOOL_NAME },
  ];
}

export interface ChildResearchSearchResult {
  schema: "studio.child-research-tool-result.v1";
  capability: typeof RESEARCH_CAPABILITY;
  op: "search";
  operationId: string;
  receiptArtifactId: string;
  receiptContentId: string;
  receipt: ResearchSearchReceipt;
}

export interface ChildResearchSnapshotResult {
  schema: "studio.child-research-tool-result.v1";
  capability: typeof RESEARCH_CAPABILITY;
  op: "document_snapshot";
  operationId: string;
  receiptArtifactId: string;
  receiptContentId: string;
  receipt: ResearchDocumentSnapshotReceipt;
  extractionArtifactId: string;
  extractionContentId: string;
  extraction: ResearchExtractionArtifact;
}

export type ChildResearchToolResult = ChildResearchSearchResult | ChildResearchSnapshotResult;

export type ChildResearchBridgeErrorCode =
  | "invalid_request"
  | "capability_not_granted"
  | "operation_rejected"
  | "bridge_unavailable";

export class ChildResearchBridgeError extends Error {
  readonly code: ChildResearchBridgeErrorCode;

  constructor(code: ChildResearchBridgeErrorCode, message: string) {
    super(message);
    this.name = "ChildResearchBridgeError";
    this.code = code;
  }
}

export interface ChildResearchHost {
  search(request: unknown): Promise<VerifiedResearchSearch>;
  snapshotDocument(request: unknown): Promise<VerifiedResearchSnapshot>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function searchArguments(value: unknown): ChildResearchSearchArguments {
  const item = record(value);
  if (!item || !exact(item, ["query"]) || typeof item.query !== "string" ||
      item.query.trim().length === 0 || item.query.length > RESEARCH_LIMITS.maxQueryChars) {
    throw new ChildResearchBridgeError("invalid_request", "The research search tool accepts one bounded query string.");
  }
  return { query: item.query };
}

function snapshotArguments(value: unknown): ChildResearchSnapshotArguments {
  const item = record(value);
  if (!item || !exact(item, ["searchOperationId", "resultIndex"]) ||
      typeof item.searchOperationId !== "string" || item.searchOperationId.length === 0 ||
      item.searchOperationId.length > 256 || !Number.isSafeInteger(item.resultIndex) ||
      (item.resultIndex as number) < 0 || (item.resultIndex as number) >= RESEARCH_LIMITS.maxResultsPerQuery) {
    throw new ChildResearchBridgeError("invalid_request", "The research snapshot tool accepts one recorded search result index.");
  }
  return { searchOperationId: item.searchOperationId, resultIndex: item.resultIndex as number };
}

export class BoundedChildResearchBridge {
  private readonly view: ResearchGrantView;
  private readonly host: ChildResearchHost;
  private readonly nextOperationId: () => string;

  constructor(view: ResearchGrantView, host: ChildResearchHost, options: { nextOperationId?: () => string } = {}) {
    this.view = structuredClone(view);
    this.host = host;
    this.nextOperationId = options.nextOperationId ?? (() => `operation:child:research-investigate:${randomUUID()}`);
  }

  private grant() {
    const grants = this.view.grants.filter((grant) => grant.capability === RESEARCH_CAPABILITY);
    if (grants.length !== 1) {
      throw new ChildResearchBridgeError("capability_not_granted", "The child task has no exact research grant.");
    }
    return grants[0];
  }

  manifest(): ChildResearchToolManifest {
    const scope = this.grant().researchScope;
    return {
      schema: "studio.child-research-tools.v1",
      taskId: this.view.taskId,
      agentId: this.view.agentId,
      capability: RESEARCH_CAPABILITY,
      gap: {
        hypothesis: scope.gap.hypothesis,
        media: {
          artifactId: scope.gap.media.artifactId,
          trackId: scope.gap.media.trackId,
          startMs: scope.gap.media.startMs,
          endMs: scope.gap.media.endMs,
        },
      },
      allowedDomains: [...scope.allowedDomains],
      limits: {
        maxQueries: scope.limits.maxQueries,
        maxQueryChars: scope.limits.maxQueryChars,
        maxResultsPerQuery: scope.limits.maxResultsPerQuery,
        maxDocuments: scope.limits.maxDocuments,
        maxRedirects: scope.limits.maxRedirects,
        maxWallMs: scope.limits.maxWallMs,
      },
      tools: [{ name: CHILD_RESEARCH_SEARCH_TOOL_NAME }, { name: CHILD_RESEARCH_SNAPSHOT_TOOL_NAME }],
    };
  }

  async call(name: string, value: unknown): Promise<ChildResearchToolResult> {
    const grant = this.grant();
    const operationId = this.nextOperationId();
    try {
      if (name === CHILD_RESEARCH_SEARCH_TOOL_NAME) {
        const input = searchArguments(value);
        const verified = await this.host.search({
          operationId,
          taskId: this.view.taskId,
          agentId: this.view.agentId,
          grantId: grant.id,
          op: "search",
          query: input.query,
        });
        const receipt = validateResearchSearchReceipt(verified.receipt, "Child research bridge search receipt");
        if (
          receipt.operationId !== operationId ||
          receipt.authorization.taskId !== this.view.taskId ||
          receipt.authorization.agentId !== this.view.agentId ||
          receipt.authorization.grantId !== grant.id ||
          canonicalJsonContentId(receipt) !== verified.receiptContentId
        ) {
          throw new ChildResearchBridgeError("operation_rejected", "The research host returned content outside the injected child grant.");
        }
        return {
          schema: "studio.child-research-tool-result.v1",
          capability: RESEARCH_CAPABILITY,
          op: "search",
          operationId,
          receiptArtifactId: verified.receiptArtifactId,
          receiptContentId: verified.receiptContentId,
          receipt,
        };
      }
      if (name === CHILD_RESEARCH_SNAPSHOT_TOOL_NAME) {
        const input = snapshotArguments(value);
        const verified = await this.host.snapshotDocument({
          operationId,
          taskId: this.view.taskId,
          agentId: this.view.agentId,
          grantId: grant.id,
          op: "document_snapshot",
          searchOperationId: input.searchOperationId,
          resultIndex: input.resultIndex,
        });
        const receipt = validateResearchSnapshotReceipt(verified.receipt, "Child research bridge snapshot receipt");
        const extraction = validateResearchExtractionArtifact(verified.extraction.envelope, "Child research bridge extraction");
        if (
          receipt.operationId !== operationId ||
          receipt.authorization.taskId !== this.view.taskId ||
          receipt.authorization.agentId !== this.view.agentId ||
          receipt.authorization.grantId !== grant.id ||
          canonicalJsonContentId(receipt) !== verified.receiptContentId ||
          canonicalJsonContentId(extraction) !== verified.extraction.contentId ||
          receipt.extraction.contentId !== verified.extraction.contentId ||
          receipt.extraction.artifactId !== verified.extraction.artifactId ||
          receipt.nonClaims.speechEvidenceAuthority !== "not_granted"
        ) {
          throw new ChildResearchBridgeError("operation_rejected", "The research host returned content outside the injected child grant.");
        }
        return {
          schema: "studio.child-research-tool-result.v1",
          capability: RESEARCH_CAPABILITY,
          op: "document_snapshot",
          operationId,
          receiptArtifactId: verified.receiptArtifactId,
          receiptContentId: verified.receiptContentId,
          receipt,
          extractionArtifactId: verified.extraction.artifactId,
          extractionContentId: verified.extraction.contentId,
          extraction,
        };
      }
      throw new ChildResearchBridgeError("invalid_request", "The child research bridge tool name is unknown.");
    } catch (error) {
      if (error instanceof ChildResearchBridgeError) throw error;
      throw new ChildResearchBridgeError("operation_rejected", "The research capability host rejected or failed the bounded request.");
    }
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  if (Buffer.byteLength(payload) > MAX_RESPONSE_BYTES) {
    const fallback = `${JSON.stringify({ error: { code: "bridge_unavailable", message: "The research bridge response exceeded its byte limit." } })}\n`;
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(fallback), "Cache-Control": "no-store" });
    response.end(fallback);
    return;
  }
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload), "Cache-Control": "no-store" });
  response.end(payload);
}

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(token);
  const candidate = Buffer.from(supplied);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) throw new ChildResearchBridgeError("invalid_request", "The child research bridge request is too large.");
    chunks.push(buffer);
  }
  if (bytes === 0) throw new ChildResearchBridgeError("invalid_request", "The child research bridge request is empty.");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ChildResearchBridgeError("invalid_request", "The child research bridge request is not valid JSON."); }
}

export interface OpenChildResearchBridge {
  endpoint: string;
  token: string;
  manifest: ChildResearchToolManifest;
  close(): Promise<void>;
}

export async function openChildResearchBridge(bridge: BoundedChildResearchBridge): Promise<OpenChildResearchBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server: Server = createServer(async (request, response) => {
    try {
      if (!authorized(request, token)) {
        json(response, 401, { error: { code: "bridge_unavailable", message: "The child research bridge bearer is invalid." } });
        return;
      }
      if (request.method === "GET" && request.url === "/manifest") {
        json(response, 200, manifest);
        return;
      }
      if (request.method !== "POST" || request.url !== "/call") {
        json(response, 404, { error: { code: "invalid_request", message: "The child research bridge route is unknown." } });
        return;
      }
      const body = record(await requestJson(request));
      if (!body || !exact(body, ["name", "arguments"]) || typeof body.name !== "string") {
        throw new ChildResearchBridgeError("invalid_request", "The child research bridge call shape is invalid.");
      }
      json(response, 200, await bridge.call(body.name, body.arguments));
    } catch (error) {
      const safe = error instanceof ChildResearchBridgeError ? error : new ChildResearchBridgeError("bridge_unavailable", "The child research bridge failed closed.");
      json(response, safe.code === "invalid_request" ? 400 : 409, { error: { code: safe.code, message: safe.message } });
    }
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The child research bridge did not bind exact loopback TCP");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    manifest,
    close: () => new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())),
  };
}

async function bridgeFetch(endpoint: string, token: string, path: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(path, endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== new URL(endpoint).origin) {
    throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge endpoint is not exact loopback HTTP.");
  }
  let response: Response;
  try { response = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } }); }
  catch { throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge could not be reached."); }
  const declared = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_RESPONSE_BYTES) {
    throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge returned an invalid byte envelope.");
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length !== declared || body.length > MAX_RESPONSE_BYTES) throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge response changed its byte envelope.");
  let value: unknown;
  try { value = JSON.parse(body.toString("utf8")); }
  catch { throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge returned invalid JSON."); }
  if (!response.ok) {
    const error = record(record(value)?.error);
    throw new ChildResearchBridgeError("operation_rejected", typeof error?.message === "string" ? error.message : "Research bridge rejected the call.");
  }
  return value;
}

export async function fetchChildResearchManifest(endpoint: string, token: string): Promise<ChildResearchToolManifest> {
  const value = await bridgeFetch(endpoint, token, "/manifest");
  const item = record(value);
  const limits = record(item?.limits);
  const gap = record(item?.gap);
  const media = record(gap?.media);
  const tools = Array.isArray(item?.tools) ? item?.tools : null;
  if (!item || !exact(item, ["schema", "taskId", "agentId", "capability", "gap", "allowedDomains", "limits", "tools"]) ||
      item.schema !== "studio.child-research-tools.v1" || item.capability !== RESEARCH_CAPABILITY ||
      typeof item.taskId !== "string" || item.taskId.length === 0 ||
      typeof item.agentId !== "string" || item.agentId.length === 0 ||
      !Array.isArray(item.allowedDomains) || item.allowedDomains.length > RESEARCH_LIMITS.maxAllowedDomains ||
      item.allowedDomains.some((domain) => typeof domain !== "string" || domain.length === 0)) {
    throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge manifest failed validation.");
  }
  if (!gap || !exact(gap, ["hypothesis", "media"]) || typeof gap.hypothesis !== "string" || gap.hypothesis.length === 0 ||
      !media || !exact(media, ["artifactId", "trackId", "startMs", "endMs"]) ||
      typeof media.artifactId !== "string" || typeof media.trackId !== "string" ||
      !Number.isSafeInteger(media.startMs) || !Number.isSafeInteger(media.endMs) || (media.endMs as number) <= (media.startMs as number)) {
    throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge manifest gap failed validation.");
  }
  if (!limits || !exact(limits, ["maxQueries", "maxQueryChars", "maxResultsPerQuery", "maxDocuments", "maxRedirects", "maxWallMs"]) ||
      limits.maxQueries !== RESEARCH_LIMITS.maxQueries || limits.maxQueryChars !== RESEARCH_LIMITS.maxQueryChars ||
      limits.maxResultsPerQuery !== RESEARCH_LIMITS.maxResultsPerQuery || limits.maxDocuments !== RESEARCH_LIMITS.maxDocuments ||
      limits.maxRedirects !== RESEARCH_LIMITS.maxRedirects || limits.maxWallMs !== RESEARCH_LIMITS.maxWallMs) {
    throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge manifest limits failed validation.");
  }
  if (!tools || tools.length !== 2 ||
      !tools.every((tool) => record(tool) && exact(record(tool)!, ["name"])) ||
      (tools[0] as { name: unknown }).name !== CHILD_RESEARCH_SEARCH_TOOL_NAME ||
      (tools[1] as { name: unknown }).name !== CHILD_RESEARCH_SNAPSHOT_TOOL_NAME) {
    throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge manifest tools failed validation.");
  }
  return value as ChildResearchToolManifest;
}

export async function callChildResearchBridge(
  endpoint: string,
  token: string,
  name: typeof CHILD_RESEARCH_SEARCH_TOOL_NAME | typeof CHILD_RESEARCH_SNAPSHOT_TOOL_NAME,
  args: ChildResearchSearchArguments | ChildResearchSnapshotArguments,
): Promise<ChildResearchToolResult> {
  if (name === CHILD_RESEARCH_SEARCH_TOOL_NAME) searchArguments(args);
  else snapshotArguments(args);
  const value = await bridgeFetch(endpoint, token, "/call", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ name, arguments: args }),
  });
  const result = record(value);
  if (!result || result.schema !== "studio.child-research-tool-result.v1" || result.capability !== RESEARCH_CAPABILITY ||
      typeof result.operationId !== "string" || typeof result.receiptArtifactId !== "string" ||
      typeof result.receiptContentId !== "string" || (result.op !== "search" && result.op !== "document_snapshot")) {
    throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge result failed validation.");
  }
  if (result.op === "search") {
    const receipt = validateResearchSearchReceipt(result.receipt, "Child research client search receipt");
    if (receipt.operationId !== result.operationId || canonicalJsonContentId(receipt) !== result.receiptContentId) {
      throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge result identities do not agree.");
    }
  } else {
    const receipt = validateResearchSnapshotReceipt(result.receipt, "Child research client snapshot receipt");
    const extraction = validateResearchExtractionArtifact(result.extraction, "Child research client extraction");
    if (receipt.operationId !== result.operationId || canonicalJsonContentId(receipt) !== result.receiptContentId ||
        canonicalJsonContentId(extraction) !== result.extractionContentId ||
        receipt.extraction.contentId !== result.extractionContentId) {
      throw new ChildResearchBridgeError("bridge_unavailable", "The child research bridge result identities do not agree.");
    }
  }
  return value as ChildResearchToolResult;
}
