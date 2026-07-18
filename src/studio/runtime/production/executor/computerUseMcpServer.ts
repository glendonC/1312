import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import { callChildComputerUseBridge, CHILD_COMPUTER_USE_TOOL_NAME, fetchChildComputerUseManifest } from "./childComputerUseBridge.ts";

const endpoint = process.env.STUDIO_CHILD_COMPUTER_USE_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_COMPUTER_USE_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded child computer-use bridge environment is unavailable");
const manifest = await fetchChildComputerUseManifest(endpoint, token);
if (manifest.tool.name !== CHILD_COMPUTER_USE_TOOL_NAME || manifest.mode !== "offline_fixture") throw new Error("The bounded computer-use manifest is incomplete or open");

const server = new McpServer(
  { name: "studio-bounded-offline-computer-use", version: "1" },
  { instructions: "Inspect only the sealed offline fixture for the granted gap. The empty-object tool exposes ordered screenshots and visible content. It is cite-only context, not live state, truth, speech, claims, coverage, captions, or quality." },
);
server.registerTool(
  CHILD_COMPUTER_USE_TOOL_NAME,
  {
    title: "Inspect sealed read-only external-screen fixture",
    description: `Run one offline read-only fixture session with at most ${manifest.limits.maxSteps} states and ${manifest.limits.maxActions} declared transitions. The host injects every authority and surface.`,
    inputSchema: z.object({}).strict(),
    annotations: { title: "Inspect sealed read-only external-screen fixture", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (args) => {
    try {
      const result = await callChildComputerUseBridge(endpoint, token, args);
      const metadata = {
        ...result,
        states: result.states.map(({ screenshotBase64: _screenshotBase64, ...state }) => state),
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(metadata) },
          ...result.states.map((state) => ({ type: "image" as const, data: state.screenshotBase64, mimeType: "image/png" })),
        ],
      };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "The bounded computer-use session failed closed." }] };
    }
  },
);
await server.connect(new StdioServerTransport());
