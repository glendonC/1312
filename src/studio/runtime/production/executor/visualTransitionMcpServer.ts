import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  callChildVisualTransitionBridge,
  CHILD_VISUAL_TRANSITION_TOOL_NAME,
  fetchChildVisualTransitionManifest,
} from "./childVisualTransitionBridge.ts";

const endpoint = process.env.STUDIO_CHILD_VISUAL_TRANSITION_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_VISUAL_TRANSITION_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded child visual-transition bridge environment is unavailable");

const manifest = await fetchChildVisualTransitionManifest(endpoint, token);
const server = new McpServer(
  { name: "studio-bounded-visual-transitions", version: "1" },
  {
    instructions:
      "Use media_visual_transitions_analyze only after exact completed media_frames_sample and media_frames_ocr operations. Output intervals are cite-only pixel-difference candidates, not scenes, shots, cuts, semantic understanding, identities, or caption authority.",
  },
);

server.registerTool(
  CHILD_VISUAL_TRANSITION_TOOL_NAME,
  {
    title: "Authorized bounded visual-change candidates",
    description:
      `Compare ${manifest.tool.limits.minFrames}-${manifest.tool.limits.maxFrames} already-receipted U2 frames on a fixed ` +
      `${manifest.tool.limits.gridWidth}x${manifest.tool.limits.gridHeight} RGB grid. Scores at or above ` +
      `${manifest.tool.limits.candidateThresholdPpm} ppm are visual-change candidates only. OCR set changes retain lineage but cannot change the pixel threshold.`,
    inputSchema: z.object({
      frameSamplingOperationId: z.string().min(1).max(256),
      ocrOperationId: z.string().min(1).max(256),
    }).strict(),
    annotations: { title: "Authorized bounded visual-change candidates", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (args) => {
    try {
      const result = await callChildVisualTransitionBridge(endpoint, token, args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The bounded visual-transition request failed closed.";
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  },
);

await server.connect(new StdioServerTransport());
