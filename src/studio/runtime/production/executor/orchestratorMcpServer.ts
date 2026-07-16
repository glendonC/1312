import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  ORCHESTRATOR_SPAWN_TOOL,
  ORCHESTRATOR_WAIT_TOOL,
} from "./orchestratorBridge.ts";
import {
  callOrchestratorBridge,
  fetchOrchestratorManifest,
} from "./orchestratorBridgeHttp.ts";

const endpoint = process.env.STUDIO_ORCHESTRATOR_BRIDGE_URL;
const token = process.env.STUDIO_ORCHESTRATOR_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded orchestrator bridge environment is unavailable");

const manifest = await fetchOrchestratorManifest(endpoint, token);
const names = new Set(manifest.tools.map((tool) => tool.name));
if (!names.has(ORCHESTRATOR_SPAWN_TOOL) || !names.has(ORCHESTRATOR_WAIT_TOOL) || names.size !== 2) {
  throw new Error("The bounded orchestrator requires exactly two tools");
}

const server = new McpServer(
  { name: "studio-owned-swarm-orchestrator", version: "1" },
  {
    instructions:
      "Use only task_spawn_request and task_reports_wait. The scheduler injects every task, agent, grant, dependency-task, context, and launch identity. Multiple spawn requests may be issued before waiting.",
  },
);

const mediaScope = z.object({
  artifactId: z.string().min(1),
  trackId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
}).strict().refine((value) => value.endMs > value.startMs, { message: "endMs must be greater than startMs" });

const spawnInput = z.object({
  workloadKey: z.string().min(1).max(256),
  objective: z.string().min(1).max(4_000),
  workerKind: z.enum(["media", "analysis", "translation", "quality"]),
  workerLabel: z.string().min(1).max(256),
  mediaScope: z.array(mediaScope).max(8),
  inputArtifactIds: z.array(z.string().min(1)).max(16),
  requiredOutputs: z.array(z.object({
    name: z.string().min(1).max(128),
    artifactKind: z.string().min(1).max(128),
    required: z.boolean(),
  }).strict()).min(1).max(8),
  requiredCapabilities: z.array(z.enum([
    "report.submit",
    "media.extract",
    "media.seek",
    "evidence.read",
    "analysis.evidence.assess",
    "analysis.evidence.decide",
  ])).min(1).max(6),
  dependencyWorkloadKeys: z.array(z.string().min(1).max(256)).max(8),
  budget: z.object({
    wallMs: z.number().int().positive().max(120_000),
    toolCalls: z.number().int().positive().max(16),
  }).strict(),
}).strict();

server.registerTool(
  ORCHESTRATOR_SPAWN_TOOL,
  {
    title: "Request bounded child task",
    description:
      "Submit one model-authored bounded child contract. No task, agent, grant, dependency-task, context, executor, path, or launch identity is accepted. The scheduler records an accepted or rejected decision.",
    inputSchema: spawnInput,
    annotations: {
      title: "Request bounded child task",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_SPAWN_TOOL, args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The spawn request failed closed." }] };
    }
  },
);

server.registerTool(
  ORCHESTRATOR_WAIT_TOOL,
  {
    title: "Wait for terminal child reports",
    description:
      "Wait for accepted direct children and return only terminal task, report, artifact, and closed failure identities. The input is empty; no path or open query is accepted.",
    inputSchema: z.object({}).strict(),
    annotations: {
      title: "Wait for terminal child reports",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_WAIT_TOOL, args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The report wait failed closed." }] };
    }
  },
);

await server.connect(new StdioServerTransport());
