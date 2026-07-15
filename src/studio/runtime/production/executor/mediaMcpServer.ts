import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  callChildMediaBridge,
  fetchChildMediaManifest,
  type ChildMediaToolName,
} from "./childMediaBridge.ts";

const endpoint = process.env.STUDIO_CHILD_MEDIA_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_MEDIA_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded child media bridge environment is unavailable");

const manifest = await fetchChildMediaManifest(endpoint, token);
const server = new McpServer(
  { name: "studio-bounded-media", version: "1" },
  {
    instructions:
      "Use only the listed media tools and exact granted scopes. A media operation occurred only when the tool returns a receipted result. The tools expose receipts, not decoded media semantics.",
  },
);

const inputSchema = z.object({
  artifactId: z.string().min(1),
  trackId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
}).strict().refine((value) => value.endMs > value.startMs, {
  message: "endMs must be greater than startMs",
});

for (const tool of manifest.tools) {
  const title = tool.name === "media_extract" ? "Authorized media extraction" : "Authorized media seek";
  server.registerTool(
    tool.name,
    {
      title,
      description:
        `${tool.capability} through the existing 1321 media host. ` +
        "The host rechecks the scheduler grant, exact media scope, task tool-call budget, source bytes, and half-open integer-millisecond range, then returns only a real journaled receipt and artifact identity.",
      inputSchema,
      annotations: {
        title,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const result = await callChildMediaBridge(endpoint, token, tool.name as ChildMediaToolName, args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : "The bounded media request failed closed.";
        return { isError: true, content: [{ type: "text", text: message }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
