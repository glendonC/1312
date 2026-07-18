import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  BoundedOrchestratorBridge,
  ORCHESTRATOR_SPAWN_TOOL,
  ORCHESTRATOR_WAIT_TOOL,
  ORCHESTRATOR_DISPOSITION_TOOL,
  ORCHESTRATOR_READ_TOOL,
  ORCHESTRATOR_PLAN_TOOL,
  ORCHESTRATOR_RESTUDY_TOOL,
  ORCHESTRATOR_SEPARATION_TOOL,
  ORCHESTRATOR_RESEARCH_TOOL,
  ORCHESTRATOR_SYNTHESIZE_TOOL,
  OrchestratorBridgeError,
  type OrchestratorToolManifest,
  type ReportsWaitToolResult,
  type SpawnToolResult,
  type OrchestratorToolName,
  type ReportDispositionToolResult,
  type AdmittedArtifactReadToolResult,
  type StudyPlanningToolResult,
  type StudyRestudyToolResult,
  type StudySynthesisToolResult,
} from "./orchestratorBridge.ts";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exact(item: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(item).length === keys.length && keys.every((key) => key in item);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

async function requestBody(request: IncomingMessage, maximumBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new OrchestratorBridgeError("invalid_request", "The orchestrator bridge request is too large.");
    chunks.push(chunk);
  }
  if (bytes === 0) throw new OrchestratorBridgeError("invalid_request", "The orchestrator bridge request is empty.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new OrchestratorBridgeError("invalid_request", "The orchestrator bridge request is not valid JSON.");
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export interface OpenOrchestratorBridge {
  endpoint: string;
  token: string;
  manifest: OrchestratorToolManifest;
  close(): Promise<void>;
}

export async function openOrchestratorBridge(bridge: BoundedOrchestratorBridge): Promise<OpenOrchestratorBridge> {
  const token = randomBytes(32).toString("hex");
  const manifest = bridge.manifest();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        json(response, 401, { ok: false, error: { code: "bridge_unavailable", message: "The orchestrator bridge credential is invalid." } });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/v1/manifest" && url.search === "") {
        json(response, 200, { ok: true, manifest });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/call" && url.search === "") {
        const body = record(await requestBody(request));
        if (!body || !exact(body, ["name", "arguments"])) throw new OrchestratorBridgeError("invalid_request", "The orchestrator bridge call shape is invalid.");
        if (body.name === ORCHESTRATOR_SPAWN_TOOL) json(response, 200, { ok: true, result: await bridge.spawn(body.arguments) });
        else if (body.name === ORCHESTRATOR_WAIT_TOOL) json(response, 200, { ok: true, result: await bridge.wait(body.arguments) });
        else if (body.name === ORCHESTRATOR_DISPOSITION_TOOL) json(response, 200, { ok: true, result: await bridge.disposition(body.arguments) });
        else if (body.name === ORCHESTRATOR_READ_TOOL) json(response, 200, { ok: true, result: await bridge.readAdmitted(body.arguments) });
        else if (body.name === ORCHESTRATOR_PLAN_TOOL) json(response, 200, { ok: true, result: await bridge.plan(body.arguments) });
        else if (body.name === ORCHESTRATOR_RESTUDY_TOOL) json(response, 200, { ok: true, result: await bridge.restudy(body.arguments) });
        else if (body.name === ORCHESTRATOR_SEPARATION_TOOL) json(response, 200, { ok: true, result: await bridge.separation(body.arguments) });
        else if (body.name === ORCHESTRATOR_RESEARCH_TOOL) json(response, 200, { ok: true, result: await bridge.research(body.arguments) });
        else if (body.name === ORCHESTRATOR_SYNTHESIZE_TOOL) json(response, 200, { ok: true, result: await bridge.synthesize(body.arguments) });
        else throw new OrchestratorBridgeError("invalid_request", "The orchestrator tool name is unavailable.");
        return;
      }
      json(response, 404, { ok: false, error: { code: "bridge_unavailable", message: "The orchestrator bridge endpoint is unavailable." } });
    })().catch((error: unknown) => {
      const safe = error instanceof OrchestratorBridgeError
        ? error
        : new OrchestratorBridgeError("bridge_unavailable", "The orchestrator bridge failed closed.");
      json(response, safe.code === "invalid_request" ? 400 : 403, { ok: false, error: { code: safe.code, message: safe.message } });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("The orchestrator bridge did not bind a loopback port");
  }
  return { endpoint: `http://127.0.0.1:${address.port}`, token, manifest, close: () => closeServer(server) };
}

function endpointOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
    (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new OrchestratorBridgeError("bridge_unavailable", "The orchestrator bridge endpoint is not exact loopback HTTP.");
  }
  return url.origin;
}

async function remoteJson(endpoint: string, token: string, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${endpointOrigin(endpoint)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  });
  const value = record(await response.json());
  if (!response.ok || !value || value.ok !== true) {
    const error = record(value?.error);
    throw new OrchestratorBridgeError("bridge_unavailable", typeof error?.message === "string" ? error.message : "The orchestrator bridge call failed.");
  }
  return value;
}

export async function fetchOrchestratorManifest(endpoint: string, token: string): Promise<OrchestratorToolManifest> {
  const value = await remoteJson(endpoint, token, "/v1/manifest");
  const manifest = record(value.manifest);
  if (!manifest || manifest.schema !== "studio.orchestrator-tools.v1" || !Array.isArray(manifest.tools)) {
    throw new OrchestratorBridgeError("bridge_unavailable", "The orchestrator tool manifest is invalid.");
  }
  return manifest as unknown as OrchestratorToolManifest;
}

export async function callOrchestratorBridge(
  endpoint: string,
  token: string,
  name: OrchestratorToolName,
  args: unknown,
): Promise<SpawnToolResult | ReportsWaitToolResult | ReportDispositionToolResult | AdmittedArtifactReadToolResult | StudyPlanningToolResult | StudyRestudyToolResult | StudySynthesisToolResult> {
  const value = await remoteJson(endpoint, token, "/v1/call", {
    method: "POST",
    body: JSON.stringify({ name, arguments: args }),
  });
  return value.result as SpawnToolResult | ReportsWaitToolResult | ReportDispositionToolResult | AdmittedArtifactReadToolResult | StudyPlanningToolResult | StudyRestudyToolResult | StudySynthesisToolResult;
}
