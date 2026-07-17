import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import { callChildOcrBridge, CHILD_OCR_TOOL_NAME, fetchChildOcrManifest } from "./childOcrBridge.ts";

const endpoint = process.env.STUDIO_CHILD_OCR_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_OCR_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded child OCR bridge environment is unavailable");

const manifest = await fetchChildOcrManifest(endpoint, token);
const server = new McpServer(
  { name: "studio-bounded-ocr", version: "1" },
  {
    instructions:
      "Use media_frames_ocr only after media_frames_sample and only when an exact on-screen-text gap matters. OCR output is a receipted visual hypothesis, not dialogue, identity, spelling truth, translation, cultural meaning, or person identification.",
  },
);

server.registerTool(
  CHILD_OCR_TOOL_NAME,
  {
    title: "Authorized bounded on-screen text OCR",
    description:
      `Run pinned local OCR over at most ${manifest.tool.limits.maxFrames} already-receipted U2 frame identities. ` +
      `Text below confidence ${manifest.tool.limits.minConfidence} is withheld. The host injects task, grant, source, video track, and range; OCR remains cite-only and cannot authorize captions.`,
    inputSchema: z.object({ frameSamplingOperationId: z.string().min(1).max(256) }).strict(),
    annotations: { title: "Authorized bounded on-screen text OCR", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (args) => {
    try {
      const result = await callChildOcrBridge(endpoint, token, args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The bounded OCR request failed closed.";
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  },
);

await server.connect(new StdioServerTransport());
