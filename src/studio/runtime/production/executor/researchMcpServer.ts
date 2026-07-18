import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import { RESEARCH_LIMITS } from "../model/research.ts";
import {
  callChildResearchBridge,
  CHILD_RESEARCH_SEARCH_TOOL_NAME,
  CHILD_RESEARCH_SNAPSHOT_TOOL_NAME,
  fetchChildResearchManifest,
} from "./childResearchBridge.ts";

const endpoint = process.env.STUDIO_CHILD_RESEARCH_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_RESEARCH_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded child research bridge environment is unavailable");

const manifest = await fetchChildResearchManifest(endpoint, token);
const server = new McpServer(
  { name: "studio-bounded-research", version: "1" },
  {
    instructions:
      "Use research only for the one granted unresolved gap: " +
      `"${manifest.gap.hypothesis}". Search snippets are routing hints, never citations. ` +
      "Only a snapshotted document span is citable, as cite-only external context. Research " +
      "cannot support transcript claims, authorize captions, or overwrite speech evidence.",
  },
);

server.registerTool(
  CHILD_RESEARCH_SEARCH_TOOL_NAME,
  {
    title: "Authorized bounded research search",
    description:
      `Run one bounded provider search (at most ${manifest.limits.maxQueries} per grant, ` +
      `${manifest.limits.maxResultsPerQuery} recorded results). The host injects task, grant, and gap scope. ` +
      "Results are receipted routing hints; snippets are not evidence and cannot be cited.",
    inputSchema: z.object({ query: z.string().min(1).max(RESEARCH_LIMITS.maxQueryChars) }).strict(),
    annotations: { title: "Authorized bounded research search", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (args) => {
    try {
      const result = await callChildResearchBridge(endpoint, token, CHILD_RESEARCH_SEARCH_TOOL_NAME, args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The bounded research search failed closed.";
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  },
);

server.registerTool(
  CHILD_RESEARCH_SNAPSHOT_TOOL_NAME,
  {
    title: "Authorized bounded document snapshot",
    description:
      "Snapshot one document named by index into a completed research_search receipt (at most " +
      `${manifest.limits.maxDocuments} per grant, domains limited to the granted allowlist). ` +
      "The host owns egress, redirects, byte limits, and receipts. The returned extraction spans are " +
      "cite-only external context for the granted gap.",
    inputSchema: z.object({
      searchOperationId: z.string().min(1).max(256),
      resultIndex: z.number().int().min(0).max(RESEARCH_LIMITS.maxResultsPerQuery - 1),
    }).strict(),
    annotations: { title: "Authorized bounded document snapshot", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (args) => {
    try {
      const result = await callChildResearchBridge(endpoint, token, CHILD_RESEARCH_SNAPSHOT_TOOL_NAME, args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The bounded document snapshot failed closed.";
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  },
);

await server.connect(new StdioServerTransport());
