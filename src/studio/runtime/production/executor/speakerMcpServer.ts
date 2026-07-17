import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import { callChildSpeakerBridge, CHILD_SPEAKER_TOOL_NAME, fetchChildSpeakerManifest } from "./childSpeakerBridge.ts";

const endpoint = process.env.STUDIO_CHILD_SPEAKER_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_SPEAKER_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded child speaker bridge environment is unavailable");

const manifest = await fetchChildSpeakerManifest(endpoint, token);
const server = new McpServer(
  { name: "studio-bounded-anonymous-speakers", version: "1" },
  {
    instructions:
      "Use media_speakers_analyze only for anonymous, operation-local turn and overlap hypotheses. It never names people, links speakers across media, verifies transcript text, or authorizes captions.",
  },
);

server.registerTool(
  CHILD_SPEAKER_TOOL_NAME,
  {
    title: "Authorized bounded anonymous speaker/overlap analysis",
    description:
      `Run pinned local analysis over the host-injected audio track and range (at most ${manifest.tool.limits.maxRangeMs} ms). ` +
      "The closed request has no paths or media selectors. Results are coverage qualification only; speech evidence remains responsible for dialogue claims.",
    inputSchema: z.object({}).strict(),
    annotations: { title: "Authorized bounded anonymous speaker/overlap analysis", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async () => {
    try {
      const result = await callChildSpeakerBridge(endpoint, token, {});
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "The bounded speaker request failed closed." }] };
    }
  },
);

await server.connect(new StdioServerTransport());
