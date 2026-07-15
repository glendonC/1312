import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  callChildEvidenceBridge,
  fetchChildEvidenceManifest,
} from "./childEvidenceBridge.ts";

const endpoint = process.env.STUDIO_CHILD_EVIDENCE_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_EVIDENCE_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded child evidence bridge environment is unavailable");

const manifest = await fetchChildEvidenceManifest(endpoint, token);
const allowedArtifacts = new Set(manifest.tool.evidenceScope.map((scope) => scope.artifactId));
const server = new McpServer(
  { name: "studio-bounded-evidence", version: "1" },
  {
    instructions:
      "Read only the listed existing evidence artifacts. The host returns bounded producer facts and receipt lineage; reading does not create or broaden findings.",
  },
);

const title = "Authorized evidence read";
server.registerTool(
  manifest.tool.name,
  {
    title,
    description:
      "Read an explicitly granted, already-produced VAD or language evidence receipt. " +
      "The host rechecks live ownership, exact artifact scope, tool-call/item/byte budgets, and content identity. Paths and raw media bytes are unavailable.",
    inputSchema: z.object({ artifactId: z.string().min(1) }).strict().refine(
      (value) => allowedArtifacts.has(value.artifactId),
      { message: "artifactId must be one of the scheduler-granted evidence artifacts" },
    ),
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ artifactId }) => {
    try {
      const result = await callChildEvidenceBridge(endpoint, token, artifactId);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The bounded evidence read failed closed.";
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  },
);

await server.connect(new StdioServerTransport());
