import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import { callChildSeparationBridge, CHILD_SEPARATION_TOOL_NAME, fetchChildSeparationManifest } from "./childSeparationBridge.ts";

const endpoint = process.env.STUDIO_CHILD_SEPARATION_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_SEPARATION_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded conditional separation bridge environment is unavailable");

const manifest = await fetchChildSeparationManifest(endpoint, token);
const server = new McpServer(
  { name: "studio-conditional-source-separation", version: "1" },
  { instructions: "Call media_audio_separate exactly once with {}. The host injects the audited separation trigger (exact U6.1 speaker_overlap or U7.1 mixed acoustic cell) and exact raw range. Report only agreement, disagreement, or abstention. Never prefer stem text or claim quality, truth, caption, identity, or publication authority." },
);

server.registerTool(
  CHILD_SEPARATION_TOOL_NAME,
  {
    title: "Run exact conditional separation",
    description: `Run the host-pinned local separator over only ${manifest.tool.exactRange.startMs}-${manifest.tool.exactRange.endMs} ms and compare raw versus anonymous estimates with the same recognizer. This is comparability evidence only.`,
    inputSchema: z.object({}).strict(),
    annotations: { title: "Run exact conditional separation", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async () => {
    try {
      const result = await callChildSeparationBridge(endpoint, token, {});
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Conditional separation failed closed." }] };
    }
  },
);

await server.connect(new StdioServerTransport());
