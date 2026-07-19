import { useEffect, useRef, useState } from "react";

import type { WorkerKind } from "../runtime/production/model";
// Type-only: the ProductionStudioAdapter *value* pulls the server runtime (node:crypto/node:fs via
// the artifact store) which cannot load in the browser. This DEV-only fixture imports the adapter
// lazily (dynamic import below) so it never enters the client's initial graph and StudioApp hydrates.
import type { ProductionStudioProjection } from "../runtime/production/studioProjection";
import type {
  RuntimeHostFailureReason,
  RuntimeHostLifecycleState,
  RuntimeHostSourceSummary,
} from "../runtime/production/runtimeHost/model";
import { projectLocalRuntimeLifecycle } from "./model";
import ProductionProcessingCanvas from "./ProductionProcessingCanvas";
import type { RuntimeStatusView } from "./productLocalRuntimeShared";

export const PROCESSING_MOCK_SCENARIOS = [
  "accepted",
  "initializing",
  "running",
  "poll-error",
  "failed",
  "interrupted",
] as const;

export type ProcessingMockScenario = (typeof PROCESSING_MOCK_SCENARIOS)[number];

const MOCK_RUNTIME_ID = "runtime:processing-contract-snapshot";
const SOURCE_ARTIFACT_ID = "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70";
const ROOT_TASK_ID = "task:fc5c35bf-0d4d-44c7-be7f-633227d38816";
const ROOT_AGENT_ID = "agent:c556568f-c266-4536-9a84-d55558ec704a";
const CHILD_TASK_ID = "task:07f92560-a7f5-4891-9c3d-e82a1cb7a586";
const CHILD_AGENT_ID = "agent:1e57a879-8ff6-40cc-a960-56d409d3a004";

const SOURCE: RuntimeHostSourceSummary = {
  sourceSessionId: "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
  sourceRevisionId: "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
  sourceContentId: "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
  sourceKind: "owned_local",
  label: "Project-generated Korean conversation fixture",
  rightsScope: "redistribution",
  durationMs: 47_200,
  trackCount: 1,
  preflightSchema: "studio.preflight-bundle.v3",
  detectedLanguageEvidenceAvailable: true,
};

const ROOT_OBJECTIVE = "Coordinate one bounded local worker launch with one receipted bounded seek, explicitly pinned evidence reads, and no invented media-content claims.";
const CHILD_OBJECTIVE = "Invoke media.seek once for the granted source range, consume only explicitly granted evidence, retain returned operation and receipt identities, and report without making transcription, translation, caption, or publication claims.";
const MEDIA_SCOPE = [{ artifactId: SOURCE_ARTIFACT_ID, trackId: "stream:0", startMs: 0, endMs: 47_200 }];
const JOB_CONTEXT = {
  contextId: `job-context:${"0".repeat(64)}`,
  sourceArtifactId: SOURCE_ARTIFACT_ID,
  sourceContentId: SOURCE.sourceContentId,
  analysisRequestId: "analysis-request:processing-contract-snapshot",
  requestedRange: { startMs: 0, endMs: 47_200 },
  taskRange: { startMs: 0, endMs: 47_200 },
  requestedSourceLanguagePolicy: { mode: "declared" as const, languages: ["ko"] as [string], reason: null },
  targetLanguage: "en",
  selectedLanguagePackId: "ko-v3",
  outputDepth: "evidence" as const,
  detectorEvidence: [],
  reviewedMemory: null,
};

function failureFor(scenario: ProcessingMockScenario): RuntimeHostFailureReason | null {
  if (scenario === "failed") {
    return {
      code: "executor_failed",
      message: "The executor closed without a successful terminal result.",
    };
  }
  if (scenario === "interrupted") {
    return {
      code: "executor_interrupted",
      message: "The host records that executor work was interrupted.",
    };
  }
  return null;
}

function activeProjection(empty: ProductionStudioProjection): ProductionStudioProjection {
  const rootKind: WorkerKind = "orchestrator";
  const childKind: WorkerKind = "media";
  return {
    ...empty,
    lastSeq: 13,
    sourceArtifacts: [{
      artifactId: SOURCE_ARTIFACT_ID,
      kind: "source-media",
      mediaClass: "raw",
      publication: "public",
      contentId: SOURCE.sourceContentId,
      bytes: 329_662,
      durationMs: SOURCE.durationMs,
      trackCount: SOURCE.trackCount,
    }],
    tasks: [
      {
        taskId: ROOT_TASK_ID,
        workloadKey: "root:processing-contract-snapshot",
        objective: ROOT_OBJECTIVE,
        kind: rootKind,
        label: "local-orchestrator",
        parentTaskId: null,
        parentAgentId: null,
        depth: 0,
        assignedAgentId: ROOT_AGENT_ID,
        ownerAgentId: ROOT_AGENT_ID,
        status: "working",
        terminalReason: null,
        jobContext: JOB_CONTEXT,
        mediaScope: MEDIA_SCOPE,
        inputArtifactIds: [SOURCE_ARTIFACT_ID],
        requiredOutputs: [{ name: "run report", artifactKind: "run-report", required: true }],
        dependencies: [],
      },
      {
        taskId: CHILD_TASK_ID,
        workloadKey: "bounded-media-seek:processing-contract-snapshot",
        objective: CHILD_OBJECTIVE,
        kind: childKind,
        label: "bounded-media-child",
        parentTaskId: ROOT_TASK_ID,
        parentAgentId: ROOT_AGENT_ID,
        depth: 1,
        assignedAgentId: CHILD_AGENT_ID,
        ownerAgentId: CHILD_AGENT_ID,
        status: "working",
        terminalReason: null,
        jobContext: JOB_CONTEXT,
        mediaScope: MEDIA_SCOPE,
        inputArtifactIds: [SOURCE_ARTIFACT_ID],
        requiredOutputs: [{ name: "execution report", artifactKind: "worker-execution-report", required: true }],
        dependencies: [],
      },
    ],
    workers: [
      {
        agentId: ROOT_AGENT_ID,
        taskId: ROOT_TASK_ID,
        label: "local-orchestrator",
        kind: rootKind,
        status: "working",
        taskStatus: "working",
        objective: ROOT_OBJECTIVE,
        parentAgentId: null,
        parentTaskId: null,
        depth: 0,
        capabilities: ["task.spawn.request"],
        mediaScope: MEDIA_SCOPE,
        execution: null,
        report: null,
      },
      {
        agentId: CHILD_AGENT_ID,
        taskId: CHILD_TASK_ID,
        label: "bounded-media-child",
        kind: childKind,
        status: "working",
        taskStatus: "working",
        objective: CHILD_OBJECTIVE,
        parentAgentId: ROOT_AGENT_ID,
        parentTaskId: ROOT_TASK_ID,
        depth: 1,
        capabilities: [
          "media.seek",
          "speech.transcribe",
          "evidence.read",
          "analysis.evidence.assess",
          "analysis.evidence.decide",
          "report.submit",
        ],
        mediaScope: MEDIA_SCOPE,
        execution: {
          id: "execution:deterministic:processing-contract-snapshot",
          launchClaimId: `launch:${CHILD_TASK_ID}`,
          status: "active",
          activeDurationMs: null,
          usage: null,
        },
        report: null,
      },
    ],
    operations: [{
      operationId: "operation:bounded-media-seek:processing-contract-snapshot",
      capability: "media.seek",
      status: "started",
      taskId: CHILD_TASK_ID,
      agentId: CHILD_AGENT_ID,
      grantId: "grant:media-seek:processing-contract-snapshot",
      inputArtifactId: SOURCE_ARTIFACT_ID,
      trackId: "stream:0",
      startMs: 0,
      endMs: 47_200,
      requestedDurationMs: 47_200,
      outputArtifactId: null,
      receiptId: null,
      observation: null,
      failure: null,
    }],
    semanticEvidence: [{
      operationId: "operation:semantic:processing-contract-snapshot",
      capability: "speech.transcribe",
      status: "started",
      audit: "not_completed",
      producer: {
        id: "fixture-recognizer",
        version: "0.0.0",
        model: null,
        runtimeId: "fixture-runtime",
        runtimeVersion: "0.0.0",
        configurationId: "fixture-configuration",
        configurationContentId: `sha256:${"0".repeat(64)}`,
        executionScope: "current_run",
      },
      executor: {
        taskId: CHILD_TASK_ID,
        agentId: CHILD_AGENT_ID,
        executionId: "execution:deterministic:processing-contract-snapshot",
        launchClaimId: `launch:${CHILD_TASK_ID}`,
        grantId: "grant:speech-transcribe:processing-contract-snapshot",
      },
      source: {
        artifactId: SOURCE_ARTIFACT_ID,
        contentId: SOURCE.sourceContentId,
        trackId: "stream:0",
        range: { startMs: 0, endMs: 47_200 },
      },
      returnedRange: null,
      artifact: null,
      receipt: null,
      observationCount: null,
      availability: null,
      failure: null,
    }],
    counts: {
      ...empty.counts,
      tasks: 2,
      workers: 2,
      executions: 1,
      operations: 1,
      semanticEvidence: 1,
      sourceArtifacts: 1,
    },
  };
}

function scenarioProjection(
  scenario: ProcessingMockScenario,
  empty: ProductionStudioProjection,
): ProductionStudioProjection {
  if (scenario === "running" || scenario === "poll-error") return activeProjection(empty);
  return empty;
}

function scenarioStatus(scenario: ProcessingMockScenario): RuntimeStatusView {
  const lifecycle: RuntimeHostLifecycleState = scenario === "poll-error" ? "running" : scenario;
  const active = scenario === "running" || scenario === "poll-error";
  const closed = scenario === "failed" || scenario === "interrupted";
  return {
    commandId: "runtime-start:processing-contract-snapshot",
    runtimeId: MOCK_RUNTIME_ID,
    journalId: `journal:${MOCK_RUNTIME_ID}`,
    lifecycle,
    acceptedAt: "2026-07-16T00:41:27.300Z",
    lastTransitionAt: "2026-07-16T00:41:27.366Z",
    reason: failureFor(scenario),
    sourceSessionId: SOURCE.sourceSessionId,
    sourceRevisionId: SOURCE.sourceRevisionId,
    analysisRequestId: "analysis-request:processing-contract-snapshot",
    forecast: null,
    runStartReceipt: null,
    journalHead: active ? 13 : 0,
    terminal: closed,
  };
}

export function isProcessingMockScenario(value: string | null): value is ProcessingMockScenario {
  return PROCESSING_MOCK_SCENARIOS.includes(value as ProcessingMockScenario);
}

export default function ProductionProcessingMock({
  scenario,
  onClose,
}: {
  scenario: ProcessingMockScenario;
  onClose: () => void;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [pollRecovered, setPollRecovered] = useState(false);
  const [projection, setProjection] = useState<ProductionStudioProjection | null>(null);
  const evidence = useRef<HTMLDivElement>(null);
  const status = scenarioStatus(scenario);
  const reason = failureFor(scenario);
  const lifecycle = projectLocalRuntimeLifecycle(status.lifecycle, reason);

  // The projection adapter is server-runtime code; load it lazily so it never enters the client's
  // initial bundle. This fixture is DEV-only, so an async first paint is fine.
  useEffect(() => {
    let alive = true;
    void import("../runtime/production/studioProjection").then(({ ProductionStudioAdapter }) => {
      if (!alive) return;
      setProjection(scenarioProjection(scenario, new ProductionStudioAdapter(MOCK_RUNTIME_ID).view()));
    });
    return () => {
      alive = false;
    };
  }, [scenario]);
  const active = scenario === "running" || scenario === "poll-error";
  const pollError = scenario === "poll-error" && !pollRecovered;

  function openEvidence(): void {
    setEvidenceOpen(true);
    window.requestAnimationFrame(() => evidence.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  return (
    <section className="product-runtime product-runtime-mock" data-runtime="true" aria-label="Processing contract fixture">
      <header className="product-runtime-header">
        <div>
          <span>Development contract fixture · no host work</span>
          <h1>{scenario} processing state</h1>
        </div>
        <button type="button" onClick={onClose}>Back to Studio</button>
      </header>
      <p className="processing-mock-boundary" role="note">
        Deterministic UI fixture over the current runtime and production-projection types. It makes no request,
        creates no receipt or artifact, and is unavailable in production builds.
      </p>
      <section className="product-runtime-status" aria-label="Local runtime status">
        {projection ? (
        <ProductionProcessingCanvas
          source={SOURCE}
          lifecycle={lifecycle}
          status={status}
          production={projection}
          cursor={active ? 13 : 0}
          eventCount={active ? 13 : 0}
          lastEventType={active ? "media.operation_started" : null}
          pollState={pollError ? "error" : active ? "healthy" : scenario === "failed" || scenario === "interrupted" ? "complete" : "polling"}
          pollMessage={pollError
            ? "Polling stopped after cursor 13: the fixture transport is unavailable."
            : active
              ? "Healthy at validated journal head 13."
            : scenario === "accepted"
              ? "Start accepted; no journal event has been consumed."
              : scenario === "initializing"
                ? "The start receipt and journal are not yet available."
                : "The fixture is closed at its last validated journal head."}
          captionResultCount={0}
          onOpenEvidence={openEvidence}
          onRetryPolling={pollError ? () => setPollRecovered(true) : undefined}
          onPrepareAnotherRun={onClose}
        />
        ) : (
          <p className="processing-mock-boundary" role="status">Loading fixture projection…</p>
        )}
        {evidenceOpen && (
          <div ref={evidence} className="processing-mock-evidence" role="status">
            <b>Fixture evidence boundary</b>
            <p>
              {active
                ? "This snapshot stops at the real started-operation projection shapes: two registered workers, two working tasks, one active execution, one started media.seek, and one started speech.transcribe with no completion receipt."
                : "No production event projection is attached to this lifecycle-only fixture state."}
            </p>
          </div>
        )}
      </section>
    </section>
  );
}
