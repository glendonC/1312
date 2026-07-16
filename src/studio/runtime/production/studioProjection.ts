import { assertRuntimeEvent } from "./assertions.ts";
import type { RuntimeProjection } from "./model.ts";
import type { RuntimeEvent } from "./protocol.ts";
import { applyRuntimeEvent, initialRuntimeProjection } from "./projection.ts";
import {
  projectOutputArtifacts,
  projectSourceArtifacts,
} from "./studioProjection/artifactMappers.ts";
import {
  projectAssessmentArtifacts,
  projectDecisionArtifacts,
  projectEvidenceArtifacts,
  projectEvidenceAssessments,
  projectEvidenceDecisions,
  projectEvidenceReads,
} from "./studioProjection/evidenceMappers.ts";
import type { ProductionStudioProjection } from "./studioProjection/model.ts";
import {
  projectCaptionArtifacts,
  projectCaptionProductions,
  projectCaptionQualityControls,
  projectPublishReviewDecisionArtifacts,
  projectPublishReviewDecisions,
  projectPublishReviewIntakeArtifacts,
  projectPublishReviewIntakes,
  projectPublishReviewRevocationArtifacts,
  projectPublishReviewRevocations,
} from "./studioProjection/reviewMappers.ts";
import {
  projectGrants,
  projectOperations,
  projectReports,
  projectRootOutputDispositions,
  projectSpawnRequests,
  projectTasks,
  projectWorkers,
} from "./studioProjection/workMappers.ts";

export * from "./studioProjection/model.ts";

export function adaptProductionRuntime(state: RuntimeProjection): ProductionStudioProjection {
  const tasks = projectTasks(state);
  const grants = projectGrants(state);
  const reports = projectReports(state);
  const spawnRequests = projectSpawnRequests(state);
  const rootOutputDispositions = projectRootOutputDispositions(state);
  const operations = projectOperations(state);
  const evidenceReads = projectEvidenceReads(state);
  const evidenceAssessments = projectEvidenceAssessments(state);
  const evidenceDecisions = projectEvidenceDecisions(state);
  const publishReviewIntakes = projectPublishReviewIntakes(state);
  const publishReviewDecisions = projectPublishReviewDecisions(state);
  const publishReviewRevocations = projectPublishReviewRevocations(state);
  const captionProductions = projectCaptionProductions(state);
  const captionQualityControls = projectCaptionQualityControls(state);
  const sourceArtifacts = projectSourceArtifacts(state);
  const outputArtifacts = projectOutputArtifacts(state, reports);
  const evidenceArtifacts = projectEvidenceArtifacts(state);
  const assessmentArtifacts = projectAssessmentArtifacts(state);
  const decisionArtifacts = projectDecisionArtifacts(state);
  const publishReviewIntakeArtifacts = projectPublishReviewIntakeArtifacts(state);
  const publishReviewDecisionArtifacts = projectPublishReviewDecisionArtifacts(state);
  const publishReviewRevocationArtifacts = projectPublishReviewRevocationArtifacts(state);
  const captionArtifacts = projectCaptionArtifacts(state);
  const workers = projectWorkers(state);

  return {
    schema: "studio.production-projection.v1",
    source: { kind: "production_runtime_journal", recordedDemo: false },
    runId: state.runId,
    lastSeq: state.lastSeq,
    tasks,
    workers,
    grants,
    reports,
    spawnRequests,
    rootOutputDispositions,
    operations,
    evidenceReads,
    evidenceAssessments,
    evidenceDecisions,
    publishReviewIntakes,
    publishReviewDecisions,
    publishReviewRevocations,
    captionProductions,
    captionQualityControls,
    sourceArtifacts,
    evidenceArtifacts,
    assessmentArtifacts,
    decisionArtifacts,
    publishReviewIntakeArtifacts,
    publishReviewDecisionArtifacts,
    publishReviewRevocationArtifacts,
    captionArtifacts,
    outputArtifacts,
    counts: {
      tasks: tasks.length,
      workers: workers.length,
      grants: grants.length,
      executions: Object.keys(state.executions).length,
      reports: reports.length,
      spawnRequests: spawnRequests.length,
      rootOutputDispositions: rootOutputDispositions.length,
      operations: operations.length,
      evidenceReads: evidenceReads.length,
      evidenceAssessments: evidenceAssessments.length,
      evidenceDecisions: evidenceDecisions.length,
      publishReviewIntakes: publishReviewIntakes.length,
      publishReviewDecisions: publishReviewDecisions.length,
      publishReviewRevocations: publishReviewRevocations.length,
      captionProductions: captionProductions.length,
      captionQualityControls: captionQualityControls.length,
      sourceArtifacts: sourceArtifacts.length,
      evidenceArtifacts: evidenceArtifacts.length,
      assessmentArtifacts: assessmentArtifacts.length,
      decisionArtifacts: decisionArtifacts.length,
      publishReviewIntakeArtifacts: publishReviewIntakeArtifacts.length,
      publishReviewDecisionArtifacts: publishReviewDecisionArtifacts.length,
      publishReviewRevocationArtifacts: publishReviewRevocationArtifacts.length,
      captionArtifacts: captionArtifacts.length,
      outputArtifacts: outputArtifacts.length,
    },
  };
}

/**
 * Separate production adapter. It consumes only `studio.runtime.event.v1` and never creates
 * legacy traces, RunBundles, or recorded-run identities.
 */
export class ProductionStudioAdapter {
  private state: RuntimeProjection;

  constructor(runId: string) {
    this.state = initialRuntimeProjection(runId);
  }

  append(candidate: unknown): ProductionStudioProjection {
    return this.appendBatch([candidate]);
  }

  /** A rejected event leaves the adapter at the last completely accepted poll batch. */
  appendBatch(candidates: readonly unknown[]): ProductionStudioProjection {
    let next = this.state;
    for (const candidate of candidates) next = applyRuntimeEvent(next, candidate);
    const view = adaptProductionRuntime(next);
    this.state = next;
    return view;
  }

  view(): ProductionStudioProjection {
    return adaptProductionRuntime(this.state);
  }
}

export function projectProductionRuntimeJournal(events: readonly unknown[]): ProductionStudioProjection {
  if (events.length === 0) throw new Error("Production Studio journal is empty");
  assertRuntimeEvent(events[0], "Production Studio journal event 1");
  const first = events[0] as RuntimeEvent;
  const adapter = new ProductionStudioAdapter(first.runId);
  events.forEach((event, index) => assertRuntimeEvent(event, `Production Studio journal event ${index + 1}`));
  return adapter.appendBatch(events);
}
