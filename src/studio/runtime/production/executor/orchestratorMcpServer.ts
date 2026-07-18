import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import { isConditionalSeparationHostArtifactKind, isFrameHostArtifactKind } from "../model.ts";

import {
  ORCHESTRATOR_SPAWN_TOOL,
  ORCHESTRATOR_WAIT_TOOL,
  ORCHESTRATOR_DISPOSITION_TOOL,
  ORCHESTRATOR_READ_TOOL,
  ORCHESTRATOR_PLAN_TOOL,
  ORCHESTRATOR_RESTUDY_TOOL,
  ORCHESTRATOR_SEPARATION_TOOL,
  ORCHESTRATOR_RESEARCH_TOOL,
  ORCHESTRATOR_COMPUTER_USE_TOOL,
  ORCHESTRATOR_SYNTHESIZE_TOOL,
} from "./orchestratorBridge.ts";
import {
  callOrchestratorBridge,
  fetchOrchestratorManifest,
} from "./orchestratorBridgeHttp.ts";

const endpoint = process.env.STUDIO_ORCHESTRATOR_BRIDGE_URL;
const token = process.env.STUDIO_ORCHESTRATOR_BRIDGE_TOKEN;
if (!endpoint || !token) throw new Error("The bounded orchestrator bridge environment is unavailable");

const manifest = await fetchOrchestratorManifest(endpoint, token);
const names = new Set(manifest.tools.map((tool) => tool.name));
const exactToolSets = [
  [ORCHESTRATOR_SPAWN_TOOL, ORCHESTRATOR_WAIT_TOOL],
  [ORCHESTRATOR_SPAWN_TOOL, ORCHESTRATOR_WAIT_TOOL, ORCHESTRATOR_DISPOSITION_TOOL, ORCHESTRATOR_READ_TOOL, ORCHESTRATOR_SYNTHESIZE_TOOL],
  [ORCHESTRATOR_SPAWN_TOOL, ORCHESTRATOR_WAIT_TOOL, ORCHESTRATOR_DISPOSITION_TOOL, ORCHESTRATOR_READ_TOOL, ORCHESTRATOR_PLAN_TOOL, ORCHESTRATOR_SYNTHESIZE_TOOL],
  [ORCHESTRATOR_SPAWN_TOOL, ORCHESTRATOR_WAIT_TOOL, ORCHESTRATOR_DISPOSITION_TOOL, ORCHESTRATOR_READ_TOOL, ORCHESTRATOR_RESTUDY_TOOL, ORCHESTRATOR_SYNTHESIZE_TOOL],
  [ORCHESTRATOR_SPAWN_TOOL, ORCHESTRATOR_WAIT_TOOL, ORCHESTRATOR_DISPOSITION_TOOL, ORCHESTRATOR_READ_TOOL, ORCHESTRATOR_RESTUDY_TOOL, ORCHESTRATOR_SEPARATION_TOOL, ORCHESTRATOR_SYNTHESIZE_TOOL],
  [ORCHESTRATOR_SPAWN_TOOL, ORCHESTRATOR_WAIT_TOOL, ORCHESTRATOR_DISPOSITION_TOOL, ORCHESTRATOR_READ_TOOL, ORCHESTRATOR_RESTUDY_TOOL, ORCHESTRATOR_RESEARCH_TOOL, ORCHESTRATOR_SYNTHESIZE_TOOL],
  [ORCHESTRATOR_SPAWN_TOOL, ORCHESTRATOR_WAIT_TOOL, ORCHESTRATOR_DISPOSITION_TOOL, ORCHESTRATOR_READ_TOOL, ORCHESTRATOR_RESTUDY_TOOL, ORCHESTRATOR_SEPARATION_TOOL, ORCHESTRATOR_RESEARCH_TOOL, ORCHESTRATOR_SYNTHESIZE_TOOL],
  [ORCHESTRATOR_SPAWN_TOOL, ORCHESTRATOR_WAIT_TOOL, ORCHESTRATOR_DISPOSITION_TOOL, ORCHESTRATOR_READ_TOOL, ORCHESTRATOR_RESTUDY_TOOL, ORCHESTRATOR_RESEARCH_TOOL, ORCHESTRATOR_COMPUTER_USE_TOOL, ORCHESTRATOR_SYNTHESIZE_TOOL],
  [ORCHESTRATOR_SPAWN_TOOL, ORCHESTRATOR_WAIT_TOOL, ORCHESTRATOR_DISPOSITION_TOOL, ORCHESTRATOR_READ_TOOL, ORCHESTRATOR_RESTUDY_TOOL, ORCHESTRATOR_SEPARATION_TOOL, ORCHESTRATOR_RESEARCH_TOOL, ORCHESTRATOR_COMPUTER_USE_TOOL, ORCHESTRATOR_SYNTHESIZE_TOOL],
] as const;
if (manifest.tools.length !== names.size || !exactToolSets.some((expected) => expected.length === names.size && expected.every((name) => names.has(name)))) {
  throw new Error("The bounded orchestrator tool manifest is incomplete or open");
}

const server = new McpServer(
  { name: "studio-owned-swarm-orchestrator", version: "1" },
  {
    instructions:
      "Use only the exact manifest tools. The host injects task, agent, grant, context, path, and executor authority. Multiple initial spawn requests may be issued before waiting; post-report spawns require exact planning causation.",
  },
);

const mediaScope = z.object({
  artifactId: z.string().min(1),
  trackId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
}).strict().refine((value) => value.endMs > value.startMs, { message: "endMs must be greater than startMs" });

const spawnInput = z.object({
  workloadKey: z.string().min(1).max(256),
  objective: z.string().min(1).max(4_000),
  workerKind: z.enum(["media", "analysis", "translation", "quality"]),
  workerLabel: z.string().min(1).max(256),
  mediaScope: z.array(mediaScope).max(8),
  inputArtifactIds: z.array(z.string().min(1)).max(16),
  requiredOutputs: z.array(z.object({
    name: z.string().min(1).max(128),
    artifactKind: z.string().min(1).max(128).refine(
      (kind) => !isFrameHostArtifactKind(kind) && !isConditionalSeparationHostArtifactKind(kind),
      "Host-only frame or conditional-separation artifact kinds cannot be worker outputs",
    ),
    required: z.boolean(),
  }).strict()).min(1).max(8),
  requiredCapabilities: z.array(z.enum([
    "report.submit",
    "media.extract",
    "media.seek",
    "media.frames.sample",
    "speech.transcribe",
    "evidence.read",
    "analysis.evidence.assess",
    "analysis.evidence.decide",
  ])).min(1).max(6),
  dependencyWorkloadKeys: z.array(z.string().min(1).max(256)).max(8),
  budget: z.object({
    wallMs: z.number().int().positive().max(180_000),
    toolCalls: z.number().int().positive().max(16),
  }).strict(),
  followUpCause: z.object({
    planningDecisionId: z.string().min(1),
    kind: z.enum(["gap", "conflict"]),
    causeId: z.string().min(1),
  }).strict().nullable().optional(),
}).strict();

server.registerTool(
  ORCHESTRATOR_SPAWN_TOOL,
  {
    title: "Request bounded child task",
    description:
      "Submit one model-authored bounded child contract. No task, agent, grant, dependency-task, context, executor, path, or launch identity is accepted. The scheduler records an accepted or rejected decision.",
    inputSchema: spawnInput,
    annotations: {
      title: "Request bounded child task",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_SPAWN_TOOL, args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The spawn request failed closed." }] };
    }
  },
);

server.registerTool(
  ORCHESTRATOR_WAIT_TOOL,
  {
    title: "Wait for terminal child reports",
    description:
      "Wait for accepted direct children and return only terminal task, report, artifact, and closed failure identities. The input is empty; no path or open query is accepted.",
    inputSchema: z.object({}).strict(),
    annotations: {
      title: "Wait for terminal child reports",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (args) => {
    try {
      const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_WAIT_TOOL, args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The report wait failed closed." }] };
    }
  },
);

if (names.has(ORCHESTRATOR_DISPOSITION_TOOL)) {
  server.registerTool(
    ORCHESTRATOR_DISPOSITION_TOOL,
    {
      title: "Disposition one child study report",
      description: "Accept or reject one exact terminal child study-report artifact. Acceptance alone creates one bounded path-free read grant.",
      inputSchema: z.object({
        reportId: z.string().min(1),
        outputArtifactId: z.string().min(1),
        outcome: z.enum(["accepted", "rejected"]),
        reason: z.string().min(1).max(2_000),
      }).strict(),
      annotations: { title: "Disposition child report", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args: unknown) => {
      try {
        const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_DISPOSITION_TOOL, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The report disposition failed closed." }] };
      }
    },
  );
}

if (names.has(ORCHESTRATOR_READ_TOOL)) {
  server.registerTool(
    ORCHESTRATOR_READ_TOOL,
    {
      title: "Read one admitted child study report",
      description: "Read structured content only through one exact parent-admission grant. Paths and prose identifiers confer no authority.",
      inputSchema: z.object({
        grantId: z.string().min(1),
        contentIds: z.array(z.string().min(1)).min(1).max(1),
      }).strict(),
      annotations: { title: "Read admitted study report", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args: unknown) => {
      try {
        const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_READ_TOOL, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The admitted artifact read failed closed." }] };
      }
    },
  );
}

if (names.has(ORCHESTRATOR_PLAN_TOOL)) {
  server.registerTool(
    ORCHESTRATOR_PLAN_TOOL,
    {
      title: "Record post-report planning decision",
      description: "Record the model-selected request_follow_up, synthesize_with_gaps, or withhold decision over every exact current coverage, gap, and conflict identity.",
      inputSchema: z.object({
        inputId: z.string().min(1),
        coverageIds: z.array(z.string().min(1)).min(1).max(256),
        gapIds: z.array(z.string().min(1)).max(256),
        conflictIds: z.array(z.string().min(1)).max(128),
        outcome: z.enum(["request_follow_up", "synthesize_with_gaps", "withhold"]),
        citedGapIds: z.array(z.string().min(1)).max(256),
        citedConflictIds: z.array(z.string().min(1)).max(128),
        reason: z.string().min(1).max(4_000),
      }).strict(),
      annotations: { title: "Record study planning decision", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_PLAN_TOOL, args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The planning decision failed closed." }] };
      }
    },
  );
}

if (names.has(ORCHESTRATOR_RESTUDY_TOOL)) {
  const restudyDelta = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("attenuated_subrange"), executionRange: mediaScope }).strict(),
    z.object({ kind: z.literal("padded_audio_window"), executionRange: mediaScope, paddingBeforeMs: z.number().int().nonnegative(), paddingAfterMs: z.number().int().nonnegative() }).strict(),
    z.object({ kind: z.literal("denser_frame_timestamps"), executionRange: mediaScope, timestampsMs: z.array(z.number().int().nonnegative()).min(1).max(256) }).strict(),
    z.object({ kind: z.literal("alternate_receipted_config"), executionRange: mediaScope, configurationContentId: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("granted_specialist"), executionRange: mediaScope, specialistKind: z.enum(["acoustic", "visual", "speaker", "context"]) }).strict(),
  ]);
  server.registerTool(
    ORCHESTRATOR_RESTUDY_TOOL,
    {
      title: "Request one bounded range pass",
      description: "Name one exact host-derived weak coverage/cause and one required evidence or configuration delta. Only attenuated current-run speech is registered: speaker_overlap must copy the host-derived overlap range exactly; other causes require a strict weak-range subrange.",
      inputSchema: z.object({
        inputId: z.string().min(1),
        coverageId: z.string().min(1),
        causeId: z.string().min(1),
        delta: restudyDelta,
      }).strict(),
      annotations: { title: "Request bounded range pass", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args: unknown) => {
      try {
        const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_RESTUDY_TOOL, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "The bounded range pass failed closed." }] };
      }
    },
  );
}

if (names.has(ORCHESTRATOR_SEPARATION_TOOL)) {
  server.registerTool(
    ORCHESTRATOR_SEPARATION_TOOL,
    {
      title: "Request exact conditional separation",
      description: "Select one exact host-derived U6.1 overlap trigger. The host fixes raw identity, range, local model/configuration, anonymous stems, budgets, and raw-versus-stem comparison; this grants no semantic or caption preference.",
      inputSchema: z.object({ inputId: z.string().min(1), triggerId: z.string().min(1) }).strict(),
      annotations: { title: "Request exact conditional separation", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args: unknown) => {
      try {
        const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_SEPARATION_TOOL, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Conditional separation failed closed." }] };
      }
    },
  );
}

if (names.has(ORCHESTRATOR_RESEARCH_TOOL)) {
  server.registerTool(
    ORCHESTRATOR_RESEARCH_TOOL,
    {
      title: "Request exact gap-triggered research",
      description: "Select one exact host-derived unresolved-conflict research trigger. The host fixes the gap binding, domain allowlist, budgets, and child contract; snippets are routing hints and document spans stay cite-only, never claim-support or caption authority.",
      inputSchema: z.object({ inputId: z.string().min(1), triggerId: z.string().min(1) }).strict(),
      annotations: { title: "Request exact gap-triggered research", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args: unknown) => {
      try {
        const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_RESEARCH_TOOL, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Gap-triggered research failed closed." }] };
      }
    },
  );
}

if (names.has(ORCHESTRATOR_COMPUTER_USE_TOOL)) {
  server.registerTool(
    ORCHESTRATOR_COMPUTER_USE_TOOL,
    {
      title: "Request bounded offline external-screen context",
      description: "Echo one current host-derived R1 exhaustion candidate. The host fixes the offline fixture, read-only action graph, child contract, grant, and limits.",
      inputSchema: z.object({ inputId: z.string().min(1), candidateId: z.string().min(1) }).strict(),
      annotations: { title: "Request bounded offline external-screen context", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_COMPUTER_USE_TOOL, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "The computer-use request failed closed." }] };
      }
    },
  );
}

const studyCoverage = z.object({
  coverageId: z.string().min(1),
  artifactId: z.string().min(1),
  trackId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  state: z.enum(["supported", "withheld", "unknown", "failed"]),
  claimIds: z.array(z.string().min(1)).max(256),
  reason: z.object({
    code: z.enum(["semantic_evidence_unavailable", "semantic_evidence_empty", "insufficient_semantic_evidence", "worker_withheld", "operation_failed", "unobserved_range", "explicit_study_gap", "unresolved_conflict", "child_failure", "rejected_input"]),
    detail: z.string().min(1).max(4_000),
  }).strict().nullable(),
}).strict();

const semanticCitation = z.object({
  operationId: z.string().min(1),
  artifactId: z.string().min(1),
  contentId: z.string().min(1),
  receiptId: z.string().min(1),
  receiptContentId: z.string().min(1),
  observations: z.array(z.object({
    observationId: z.string().min(1),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  }).strict()).min(1).max(256),
}).strict();

const generalizedRange = {
  artifactId: z.string().min(1),
  trackId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
};
const generalizedCoverage = z.object({
  coverageId: z.string().min(1),
  ...generalizedRange,
  state: z.enum(["supported", "unknown", "withheld", "unavailable", "truncated", "conflicting", "failed", "not_in_scope"]),
  preservedStates: z.array(z.enum(["supported", "unknown", "withheld", "unavailable", "truncated", "conflicting", "failed", "not_in_scope"])).min(1).max(8),
  rawStates: z.array(z.string().min(1)).max(32),
  claimIds: z.array(z.string().min(1)).max(256),
  citationIds: z.array(z.string().min(1)).max(512),
  reason: z.object({
    code: z.enum(["evidence_unknown", "worker_withheld", "evidence_unavailable", "evidence_truncated", "evidence_conflicting", "operation_failed", "not_in_requested_scope"]),
    detail: z.string().min(1).max(4_000),
  }).strict().nullable(),
}).strict();
const generalizedClaim = z.object({
  claimId: z.string().min(1),
  ...generalizedRange,
  statement: z.string().min(1).max(8_000),
  childClaims: z.array(z.object({
    admissionId: z.string().min(1),
    reportArtifactId: z.string().min(1),
    reportContentId: z.string().min(1),
    claimId: z.string().min(1),
  }).strict()).min(1).max(512),
  citationIds: z.array(z.string().min(1)).min(1).max(512),
}).strict();
const restudiedCoverage = generalizedCoverage.extend({ passIds: z.array(z.string().min(1)).max(32) }).strict();

const legacySynthesisInput = z.object({
  planningDecisionId: z.string().min(1),
  coverage: z.array(studyCoverage).min(1).max(256),
  claims: z.array(z.object({
    claimId: z.string().min(1), artifactId: z.string().min(1), trackId: z.string().min(1),
    startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), statement: z.string().min(1).max(8_000),
    childReportCitations: z.array(z.object({ reportId: z.string().min(1), artifactId: z.string().min(1), contentId: z.string().min(1), admissionId: z.string().min(1), claimId: z.string().min(1) }).strict()).min(1).max(512),
    semanticCitations: z.array(semanticCitation).min(1).max(512),
  }).strict()).max(256),
  conflicts: z.array(z.object({ conflictId: z.string().min(1), coverageId: z.string().min(1), status: z.literal("unresolved"), detail: z.string().min(1).max(4_000) }).strict()).max(128),
  limitations: z.array(z.object({
    code: z.enum(["explicit_gap", "unresolved_conflict", "partial_child_failure", "rejected_child_input", "recognizer_hypothesis_not_truth", "semantic_quality_not_assessed"]),
    coverageIds: z.array(z.string().min(1)).max(256), detail: z.string().min(1).max(4_000),
  }).strict()).max(128),
}).strict();

if (names.has(ORCHESTRATOR_SYNTHESIZE_TOOL)) {
  server.registerTool(
    ORCHESTRATOR_SYNTHESIZE_TOOL,
    {
      title: "Emit owned-media study",
      description: "Emit model-authored study coverage, claims, conflicts, and limitations. The host injects immutable context, dispositions, and follow-up history and rejects unsupported support.",
      inputSchema: names.has(ORCHESTRATOR_PLAN_TOOL)
        ? legacySynthesisInput
        : z.object({ coverage: z.array(names.has(ORCHESTRATOR_RESTUDY_TOOL) ? restudiedCoverage : generalizedCoverage).min(1).max(256), claims: z.array(generalizedClaim).max(256) }).strict(),
      annotations: { title: "Emit owned-media study", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args: unknown) => {
      try {
        const result = await callOrchestratorBridge(endpoint, token, ORCHESTRATOR_SYNTHESIZE_TOOL, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "The owned-media study synthesis failed closed." }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
