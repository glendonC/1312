import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  callChildEvidenceDecisionBridge,
  fetchChildEvidenceDecisionManifest,
} from "./childEvidenceDecisionBridge.ts";

const endpoint = process.env.STUDIO_CHILD_EVIDENCE_DECISION_BRIDGE_URL;
const token = process.env.STUDIO_CHILD_EVIDENCE_DECISION_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded child evidence-decision bridge environment is unavailable");

const manifest = await fetchChildEvidenceDecisionManifest(endpoint, token);
const scope = manifest.tool.decisionScope;
const identity = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  artifactId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  receiptId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  receiptContentId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

const server = new McpServer(
  { name: "studio-bounded-evidence-decision", version: "1" },
  {
    instructions:
      "Submit only exact identities returned by completed audited evidence assessments. The host reopens stored assessment/read receipts and deterministically derives withheld or proceed_to_publish_review. Captions, publication, raw bytes, paths, prose, and caller-selected outcomes are unavailable.",
  },
);

const title = "Audited evidence decision";
server.registerTool(
  manifest.tool.name,
  {
    title,
    description:
      "Create one content-addressed decision receipt from fully audited assessment identities. " +
      "The host rechecks live ownership, grants, tool-call budgets, stored bytes, citation lineage, and closed audit states before deriving the outcome and reason codes.",
    inputSchema: z.object({
      auditedAssessments: z.array(identity).min(1).max(scope.maxAuditedAssessments),
    }).strict(),
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ auditedAssessments }) => {
    try {
      const result = await callChildEvidenceDecisionBridge(endpoint, token, { auditedAssessments });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The audited evidence decision failed closed.";
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  },
);

await server.connect(new StdioServerTransport());
