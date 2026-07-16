import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  callChildSemanticEvidenceBridge,
  CHILD_SEMANTIC_EVIDENCE_TOOL,
  fetchChildSemanticEvidenceManifest,
} from "./childSemanticEvidenceBridge.ts";

const endpoint = process.env.STUDIO_CHILD_SEMANTIC_EVIDENCE_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_SEMANTIC_EVIDENCE_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded child semantic evidence bridge environment is unavailable");

const manifest = await fetchChildSemanticEvidenceManifest(endpoint, token);
const server = new McpServer(
  { name: "studio-bounded-semantic-evidence", version: "1" },
  { instructions: "speech_transcribe runs a current-run recognizer over exactly one granted source track and range. Returned text is a timed hypothesis, not hearing, truth, understanding, or agreement. Cite only the returned structured identities and observation ranges." },
);

const inputSchema = z.object({
  artifactId: z.string().min(1),
  trackId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
}).strict().refine((value) => value.endMs > value.startMs, { message: "endMs must be greater than startMs" });

server.registerTool(
  CHILD_SEMANTIC_EVIDENCE_TOOL,
  {
    title: "Authorized current-run timed transcript hypotheses",
    description: `speech.transcribe under scheduler grant ${manifest.tool.mediaScope.map((scope) => `${scope.artifactId}/${scope.trackId}[${scope.startMs},${scope.endMs})`).join(", ")}. Returns only stored artifact/receipt identities, closed availability, and bounded timed hypotheses; no paths or accuracy claim.`,
    inputSchema,
    annotations: { title: "Authorized current-run timed transcript hypotheses", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (args) => {
    try {
      const result = await callChildSemanticEvidenceBridge(endpoint, token, args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The bounded semantic evidence request failed closed.";
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  },
);

await server.connect(new StdioServerTransport());
