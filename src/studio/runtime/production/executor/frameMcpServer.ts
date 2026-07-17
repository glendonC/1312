import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  callChildFrameBridge,
  CHILD_FRAME_TOOL_NAME,
  fetchChildFrameManifest,
} from "./childFrameBridge.ts";

const endpoint = process.env.STUDIO_CHILD_FRAME_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_FRAME_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded child frame bridge environment is unavailable");

const manifest = await fetchChildFrameManifest(endpoint, token);
const server = new McpServer(
  { name: "studio-bounded-frames", version: "1" },
  {
    instructions:
      "Use media_frames_sample only for bounded inspection of the scheduler-granted video range. The host returns authorized PNG image content plus a sampling receipt. The receipt proves sampling and byte delivery only; it does not prove OCR, scene understanding, identity, or right-frame selection.",
  },
);

const inputSchema = z.object({
  timestampsMs: z.array(z.number().int().nonnegative())
    .min(1)
    .max(manifest.tool.limits.maxFrames)
    .refine((values) => values.every((value, index) => index === 0 || value > values[index - 1]), {
      message: "timestampsMs must be unique and strictly increasing",
    }),
}).strict();

server.registerTool(
  CHILD_FRAME_TOOL_NAME,
  {
    title: "Authorized bounded frame sampling",
    description:
      `Decode PNG frames at requested integer timestamps inside [${manifest.tool.grantedRange.startMs}, ${manifest.tool.grantedRange.endMs}) ms. ` +
      "The host injects source, video track, task, agent, and grant scope; re-hashes the source; bounds decode resources; and returns verified image bytes with deterministic receipt lineage.",
    inputSchema,
    annotations: {
      title: "Authorized bounded frame sampling",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      const result = await callChildFrameBridge(endpoint, token, args);
      const metadata = {
        ...result,
        frames: result.frames.map(({ dataBase64: _dataBase64, ...frame }) => frame),
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(metadata) },
          ...result.frames.map((frame) => ({
            type: "image" as const,
            data: frame.dataBase64,
            mimeType: frame.mimeType,
          })),
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The bounded frame request failed closed.";
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  },
);

await server.connect(new StdioServerTransport());
