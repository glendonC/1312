import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { canonicalJsonContentId } from "../artifactStore/contentIdentity.ts";
import { computerUseSessionArtifactId } from "../artifactStore/computerUseArtifacts.ts";
import { COMPUTER_USE_CAPABILITY, COMPUTER_USE_LIMITS, type ComputerUseGrantView } from "../model.ts";
import type { VerifiedComputerUseSession } from "../computerUse/computerUseAudit.ts";
import { inspectBoundedRgbPng } from "../frames/png.ts";
import { validateComputerUseSessionReceipt, validateComputerUseVisibleContentSnapshot } from "../validation/computerUse.ts";

export const CHILD_COMPUTER_USE_TOOL_NAME = "computer_use_readonly" as const;
const MAX_REQUEST_BYTES = 2 * 1024;
const MAX_RESPONSE_BYTES = COMPUTER_USE_LIMITS.maxTotalScreenshotBytes + 2 * 1024 * 1024;

export interface ChildComputerUseManifest {
  schema: "studio.child-computer-use-tool.v1";
  taskId: string;
  agentId: string;
  capability: typeof COMPUTER_USE_CAPABILITY;
  mode: "offline_fixture";
  gap: { hypothesis: string; media: { artifactId: string; contentId: string; trackId: string; startMs: number; endMs: number } };
  surface: { surfaceId: string; origin: string; entryUrl: string; fixtureId: string };
  limits: { maxSteps: number; maxActions: number; maxScreenshots: number; maxWallMs: number; maxEgressRequests: 0; maxDownloads: 0 };
  tool: { name: typeof CHILD_COMPUTER_USE_TOOL_NAME };
}

export interface ChildComputerUseResult {
  schema: "studio.child-computer-use-tool-result.v1";
  capability: typeof COMPUTER_USE_CAPABILITY;
  operationId: string;
  sessionArtifactId: string;
  sessionReceiptContentId: string;
  receipt: VerifiedComputerUseSession["receipt"];
  states: Array<{
    stateId: string;
    ordinal: number;
    screenshotArtifactId: string;
    screenshotContentId: string;
    width: number;
    height: number;
    screenshotBase64: string;
    visibleContentArtifactId: string;
    visibleContentId: string;
    visibleContent: VerifiedComputerUseSession["states"][number]["visibleContent"];
  }>;
}

export interface ChildComputerUseHost {
  inspect(request: unknown): Promise<VerifiedComputerUseSession>;
}

type ErrorCode = "invalid_request" | "capability_not_granted" | "operation_rejected" | "bridge_unavailable";
class ChildComputerUseBridgeError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.name = "ChildComputerUseBridgeError"; this.code = code; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}
function empty(value: unknown): void {
  const item = record(value);
  if (!item || !exact(item, [])) throw new ChildComputerUseBridgeError("invalid_request", "The computer-use tool accepts only an empty object.");
}

export class BoundedChildComputerUseBridge {
  private readonly nextOperationId: () => string;
  private readonly view: ComputerUseGrantView;
  private readonly host: ChildComputerUseHost;
  constructor(view: ComputerUseGrantView, host: ChildComputerUseHost, options: { nextOperationId?: () => string } = {}) {
    this.view = structuredClone(view);
    this.host = host;
    this.nextOperationId = options.nextOperationId ?? (() => `operation:child:computer-use:${randomUUID()}`);
  }
  private grant() {
    const grants = this.view.grants.filter((grant) => grant.capability === COMPUTER_USE_CAPABILITY);
    if (grants.length !== 1) throw new ChildComputerUseBridgeError("capability_not_granted", "The child has no exact computer-use grant.");
    return grants[0];
  }
  manifest(): ChildComputerUseManifest {
    const scope = this.grant().computerUseScope;
    return {
      schema: "studio.child-computer-use-tool.v1",
      taskId: this.view.taskId,
      agentId: this.view.agentId,
      capability: COMPUTER_USE_CAPABILITY,
      mode: "offline_fixture",
      gap: { hypothesis: scope.gap.hypothesis, media: structuredClone(scope.gap.media) },
      surface: { surfaceId: scope.surface.surfaceId, origin: scope.surface.origin, entryUrl: scope.surface.entryUrl, fixtureId: scope.surface.source.fixtureId },
      limits: {
        maxSteps: scope.limits.maxSteps,
        maxActions: scope.limits.maxActions,
        maxScreenshots: scope.limits.maxScreenshots,
        maxWallMs: scope.limits.maxWallMs,
        maxEgressRequests: 0,
        maxDownloads: 0,
      },
      tool: { name: CHILD_COMPUTER_USE_TOOL_NAME },
    };
  }
  async call(name: string, value: unknown): Promise<ChildComputerUseResult> {
    if (name !== CHILD_COMPUTER_USE_TOOL_NAME) throw new ChildComputerUseBridgeError("invalid_request", "The child computer-use tool name is unknown.");
    empty(value);
    const grant = this.grant();
    const operationId = this.nextOperationId();
    let verified: VerifiedComputerUseSession;
    try {
      verified = await this.host.inspect({ operationId, taskId: this.view.taskId, agentId: this.view.agentId, grantId: grant.id });
    } catch {
      throw new ChildComputerUseBridgeError("operation_rejected", "The bounded computer-use host rejected or failed the request.");
    }
    const receipt = validateComputerUseSessionReceipt(verified.receipt, "Child computer-use receipt");
    if (receipt.operationId !== operationId || receipt.authorization.taskId !== this.view.taskId ||
        receipt.authorization.agentId !== this.view.agentId || receipt.authorization.grantId !== grant.id ||
        canonicalJsonContentId(receipt) !== verified.receiptContentId || !verified.receiptArtifactId) {
      throw new ChildComputerUseBridgeError("operation_rejected", "The computer-use host returned content outside the injected grant.");
    }
    return {
      schema: "studio.child-computer-use-tool-result.v1",
      capability: COMPUTER_USE_CAPABILITY,
      operationId,
      sessionArtifactId: verified.receiptArtifactId,
      sessionReceiptContentId: verified.receiptContentId,
      receipt,
      states: verified.states.map((state) => ({
        stateId: state.identity.stateId,
        ordinal: state.identity.ordinal,
        screenshotArtifactId: state.identity.screenshot.artifactId,
        screenshotContentId: state.identity.screenshot.content.contentId,
        width: state.identity.screenshot.width,
        height: state.identity.screenshot.height,
        screenshotBase64: state.screenshotBytes.toString("base64"),
        visibleContentArtifactId: state.identity.visibleContent.artifactId,
        visibleContentId: state.identity.visibleContent.content.contentId,
        visibleContent: state.visibleContent,
      })),
    };
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  if (Buffer.byteLength(payload) > MAX_RESPONSE_BYTES) {
    const fallback = `${JSON.stringify({ error: { code: "bridge_unavailable", message: "The computer-use bridge response exceeded its byte limit." } })}\n`;
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(fallback), "Cache-Control": "no-store" }); response.end(fallback); return;
  }
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload), "Cache-Control": "no-store" }); response.end(payload);
}
function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) { const found = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += found.length; if (bytes > MAX_REQUEST_BYTES) throw new ChildComputerUseBridgeError("invalid_request", "The computer-use bridge request is too large."); chunks.push(found); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ChildComputerUseBridgeError("invalid_request", "The computer-use bridge request is invalid JSON."); }
}

export interface OpenChildComputerUseBridge { endpoint: string; token: string; manifest: ChildComputerUseManifest; close(): Promise<void> }
export async function openChildComputerUseBridge(bridge: BoundedChildComputerUseBridge): Promise<OpenChildComputerUseBridge> {
  const token = randomBytes(32).toString("hex"); const manifest = bridge.manifest();
  const server: Server = createServer(async (request, response) => {
    try {
      if (!authorized(request, token)) { json(response, 401, { error: { code: "bridge_unavailable", message: "The computer-use bridge bearer is invalid." } }); return; }
      if (request.method === "GET" && request.url === "/manifest") { json(response, 200, manifest); return; }
      if (request.method !== "POST" || request.url !== "/call") { json(response, 404, { error: { code: "invalid_request", message: "The computer-use bridge route is unknown." } }); return; }
      const body = record(await requestJson(request));
      if (!body || !exact(body, ["name", "arguments"]) || typeof body.name !== "string") throw new ChildComputerUseBridgeError("invalid_request", "The computer-use bridge call shape is invalid.");
      json(response, 200, await bridge.call(body.name, body.arguments));
    } catch (error) {
      const safe = error instanceof ChildComputerUseBridgeError ? error : new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use bridge failed closed.");
      json(response, safe.code === "invalid_request" ? 400 : 409, { error: { code: safe.code, message: safe.message } });
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("The computer-use bridge did not bind exact loopback TCP");
  return { endpoint: `http://127.0.0.1:${address.port}`, token, manifest, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

async function bridgeFetch(endpoint: string, token: string, path: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(path, endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== new URL(endpoint).origin) throw new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use bridge endpoint is not exact loopback HTTP.");
  let response: Response; try { response = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } }); } catch { throw new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use bridge could not be reached."); }
  const declared = Number(response.headers.get("content-length")); if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_RESPONSE_BYTES) throw new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use bridge returned an invalid byte envelope.");
  const body = Buffer.from(await response.arrayBuffer()); if (body.length !== declared) throw new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use bridge response changed its byte envelope.");
  let value: unknown; try { value = JSON.parse(body.toString("utf8")); } catch { throw new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use bridge returned invalid JSON."); }
  if (!response.ok) throw new ChildComputerUseBridgeError("operation_rejected", "The computer-use bridge rejected the call."); return value;
}

export async function fetchChildComputerUseManifest(endpoint: string, token: string): Promise<ChildComputerUseManifest> {
  const value = await bridgeFetch(endpoint, token, "/manifest");
  const item = record(value);
  const gap = record(item?.gap);
  const media = record(gap?.media);
  const surface = record(item?.surface);
  const limits = record(item?.limits);
  const tool = record(item?.tool);
  if (
    !item || !exact(item, ["schema", "taskId", "agentId", "capability", "mode", "gap", "surface", "limits", "tool"]) ||
    item.schema !== "studio.child-computer-use-tool.v1" || item.capability !== COMPUTER_USE_CAPABILITY || item.mode !== "offline_fixture" ||
    typeof item.taskId !== "string" || !item.taskId || typeof item.agentId !== "string" || !item.agentId ||
    !gap || !exact(gap, ["hypothesis", "media"]) || typeof gap.hypothesis !== "string" || !gap.hypothesis ||
    !media || !exact(media, ["artifactId", "contentId", "trackId", "startMs", "endMs"]) ||
    typeof media.artifactId !== "string" || typeof media.contentId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(media.contentId) ||
    typeof media.trackId !== "string" || !Number.isSafeInteger(media.startMs) || !Number.isSafeInteger(media.endMs) ||
    (media.startMs as number) < 0 || (media.endMs as number) <= (media.startMs as number) ||
    !surface || !exact(surface, ["surfaceId", "origin", "entryUrl", "fixtureId"]) ||
    [surface.surfaceId, surface.origin, surface.entryUrl, surface.fixtureId].some((entry) => typeof entry !== "string" || !entry) ||
    !limits || !exact(limits, ["maxSteps", "maxActions", "maxScreenshots", "maxWallMs", "maxEgressRequests", "maxDownloads"]) ||
    limits.maxSteps !== COMPUTER_USE_LIMITS.maxSteps || limits.maxActions !== COMPUTER_USE_LIMITS.maxActions ||
    limits.maxScreenshots !== COMPUTER_USE_LIMITS.maxScreenshots || limits.maxWallMs !== COMPUTER_USE_LIMITS.maxWallMs ||
    limits.maxEgressRequests !== 0 || limits.maxDownloads !== 0 ||
    !tool || !exact(tool, ["name"]) || tool.name !== CHILD_COMPUTER_USE_TOOL_NAME
  ) throw new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use bridge manifest failed validation.");
  return structuredClone(value) as ChildComputerUseManifest;
}

export async function callChildComputerUseBridge(endpoint: string, token: string, args: Record<string, never>): Promise<ChildComputerUseResult> {
  empty(args);
  const value = await bridgeFetch(endpoint, token, "/call", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ name: CHILD_COMPUTER_USE_TOOL_NAME, arguments: args }) });
  const result = record(value);
  if (!result || !exact(result, ["schema", "capability", "operationId", "sessionArtifactId", "sessionReceiptContentId", "receipt", "states"]) ||
      result.schema !== "studio.child-computer-use-tool-result.v1" || result.capability !== COMPUTER_USE_CAPABILITY ||
      typeof result.operationId !== "string" || !result.operationId || typeof result.sessionArtifactId !== "string" || !result.sessionArtifactId ||
      typeof result.sessionReceiptContentId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(result.sessionReceiptContentId) ||
      !Array.isArray(result.states)) throw new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use bridge result failed validation.");
  const receipt = validateComputerUseSessionReceipt(result.receipt, "Computer-use client receipt");
  if (receipt.operationId !== result.operationId || canonicalJsonContentId(receipt) !== result.sessionReceiptContentId ||
      computerUseSessionArtifactId(receipt.runId, receipt.sessionId, result.sessionReceiptContentId) !== result.sessionArtifactId ||
      result.states.length !== receipt.states.length) {
    throw new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use result changed session identity.");
  }
  for (const [index, candidate] of result.states.entries()) {
    const state = record(candidate);
    const expected = receipt.states[index];
    if (!state || !exact(state, ["stateId", "ordinal", "screenshotArtifactId", "screenshotContentId", "width", "height", "screenshotBase64", "visibleContentArtifactId", "visibleContentId", "visibleContent"]) ||
        state.stateId !== expected.stateId || state.ordinal !== index ||
        state.screenshotArtifactId !== expected.screenshot.artifactId || state.screenshotContentId !== expected.screenshot.content.contentId ||
        state.width !== expected.screenshot.width || state.height !== expected.screenshot.height ||
        state.visibleContentArtifactId !== expected.visibleContent.artifactId || state.visibleContentId !== expected.visibleContent.content.contentId ||
        typeof state.screenshotBase64 !== "string") {
      throw new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use result changed an audited state.");
    }
    const screenshot = Buffer.from(state.screenshotBase64, "base64");
    if (screenshot.toString("base64") !== state.screenshotBase64 || screenshot.length !== expected.screenshot.content.bytes ||
        `sha256:${createHash("sha256").update(screenshot).digest("hex")}` !== expected.screenshot.content.contentId) {
      throw new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use result changed screenshot bytes.");
    }
    const dimensions = inspectBoundedRgbPng(screenshot, {
      maxWidthPx: COMPUTER_USE_LIMITS.maxScreenshotWidthPx,
      maxHeightPx: COMPUTER_USE_LIMITS.maxScreenshotHeightPx,
      maxPixels: COMPUTER_USE_LIMITS.maxScreenshotPixels,
    });
    const visible = validateComputerUseVisibleContentSnapshot(state.visibleContent);
    if (dimensions.width !== expected.screenshot.width || dimensions.height !== expected.screenshot.height ||
        visible.stateId !== expected.stateId || visible.ordinal !== index ||
        visible.screenshot.artifactId !== expected.screenshot.artifactId ||
        visible.screenshot.contentId !== expected.screenshot.content.contentId ||
        canonicalJsonContentId(visible) !== expected.visibleContent.content.contentId) {
      throw new ChildComputerUseBridgeError("bridge_unavailable", "The computer-use result changed audited visible content.");
    }
  }
  return structuredClone(value) as unknown as ChildComputerUseResult;
}
