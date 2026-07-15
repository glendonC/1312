import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  callChildEvidenceAssessmentBridge,
  fetchChildEvidenceAssessmentManifest,
} from "./childEvidenceAssessmentBridge.ts";

const endpoint = process.env.STUDIO_CHILD_EVIDENCE_ASSESSMENT_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_EVIDENCE_ASSESSMENT_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded child evidence-assessment bridge environment is unavailable");

const manifest = await fetchChildEvidenceAssessmentManifest(endpoint, token);
const scope = manifest.tool.assessmentScope;
const receiptIdentity = z.object({
  receiptId: z.string().min(1),
  receiptContentId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
const citation = receiptIdentity.extend({
  factIndexes: z.array(z.number().int().nonnegative()).min(1).max(scope.maxCitations),
}).strict();
const range = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
}).strict().refine((value) => value.endMs > value.startMs, { message: "range must be non-empty" });
const speechClaim = z.object({
  kind: z.literal("speech_activity"),
  value: z.enum(["speech", "non_speech"]),
  range,
  citations: z.array(citation).min(1).max(scope.maxCitations),
}).strict();
const languageClaim = z.object({
  kind: z.literal("language_identity"),
  value: z.string().min(1).nullable(),
  range,
  citations: z.array(citation).min(1).max(scope.maxCitations),
}).strict();

const server = new McpServer(
  { name: "studio-bounded-evidence-assessment", version: "1" },
  {
    instructions:
      "Assess only completed evidence_read receipts. Every range-bound structured conclusion must cite exact receipt/content identities and returned fact indexes. Preserve unknown, withheld, and truncated states. Captions, translations, open prose, producer paths, and detector reruns are unavailable.",
  },
);

const title = "Bounded evidence assessment";
server.registerTool(
  manifest.tool.name,
  {
    title,
    description:
      "Create one receipted structured assessment over completed evidence_read receipts. " +
      "The host rechecks live ownership, grants, receipt content, fact indexes, exact ranges, upstream states, and hard receipt/claim/citation/token ceilings.",
    inputSchema: z.object({
      readReceipts: z.array(receiptIdentity).min(1).max(scope.maxReadReceipts),
      claims: z.array(z.discriminatedUnion("kind", [speechClaim, languageClaim])).min(1).max(scope.maxClaims),
    }).strict(),
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ readReceipts, claims }) => {
    try {
      const result = await callChildEvidenceAssessmentBridge(endpoint, token, { readReceipts, claims });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The bounded evidence assessment failed closed.";
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  },
);

await server.connect(new StdioServerTransport());
