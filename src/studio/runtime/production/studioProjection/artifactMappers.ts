import type { RuntimeProjection } from "../model.ts";
import type {
  ProductionStudioOutputArtifactView,
  ProductionStudioReportView,
  ProductionStudioSourceArtifactView,
} from "./model.ts";

export function projectSourceArtifacts(state: RuntimeProjection) {
  const sourceArtifacts = Object.values(state.artifacts)
    .filter((artifact) => artifact.origin.kind === "ingest")
    .map((artifact): ProductionStudioSourceArtifactView => {
      if (artifact.origin.kind !== "ingest") {
        throw new Error(`Production Studio projection: source artifact ${artifact.id} has a non-ingest origin`);
      }
      if (artifact.mediaClass !== "raw") {
        throw new Error(`Production Studio projection: source artifact ${artifact.id} is not raw media`);
      }
      if (artifact.producerTaskId !== null || artifact.producerAgentId !== null) {
        throw new Error(`Production Studio projection: source artifact ${artifact.id} claims a task producer`);
      }
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        mediaClass: artifact.mediaClass,
        publication: artifact.publication,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        durationMs: artifact.durationMs,
        trackCount: artifact.tracks.length,
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return sourceArtifacts;
}


export function projectOutputArtifacts(state: RuntimeProjection, reports: readonly ProductionStudioReportView[]) {
  const outputArtifacts = Object.values(state.artifacts)
    .filter((artifact) =>
      artifact.origin.kind === "media_operation" ||
      artifact.origin.kind === "media_observation" ||
      artifact.origin.kind === "semantic_media_evidence" ||
      artifact.origin.kind === "worker_output")
    .map((artifact): ProductionStudioOutputArtifactView => {
      if (
        artifact.origin.kind === "ingest" ||
        artifact.origin.kind === "preflight_evidence" ||
        artifact.origin.kind === "evidence_assessment" ||
        artifact.origin.kind === "evidence_decision" ||
        artifact.origin.kind === "publish_review_intake" ||
        artifact.origin.kind === "publish_review_decision" ||
        artifact.origin.kind === "publish_review_revocation" ||
        artifact.origin.kind === "caption_production_output" ||
        artifact.origin.kind === "caption_production_receipt" ||
        artifact.origin.kind === "caption_quality_control" ||
        artifact.origin.kind === "language_explanation_output" ||
        artifact.origin.kind === "language_explanation_receipt" ||
        artifact.origin.kind === "learning_prep_output" ||
        artifact.origin.kind === "learning_prep_receipt" ||
        artifact.origin.kind === "study_report" ||
        artifact.origin.kind === "parent_artifact_disposition" ||
        artifact.origin.kind === "parent_admission" ||
        artifact.origin.kind === "root_output_disposition" ||
        artifact.origin.kind === "study_planning_decision" ||
        artifact.origin.kind === "owned_media_study" ||
        artifact.origin.kind === "study_readiness" ||
        artifact.origin.kind === "generalized_parent_admission" ||
        artifact.origin.kind === "generalized_parent_artifact_read" ||
        artifact.origin.kind === "generalized_owned_media_study" ||
        artifact.origin.kind === "generalized_study_readiness" ||
        artifact.origin.kind === "sampled_frame" ||
        artifact.origin.kind === "frame_sample_manifest" ||
        artifact.origin.kind === "frame_sampling_receipt" ||
        artifact.origin.kind === "ocr_observations" ||
        artifact.origin.kind === "ocr_receipt" ||
        artifact.origin.kind === "visual_transition_observations" ||
        artifact.origin.kind === "visual_transition_receipt" ||
        artifact.origin.kind === "speaker_overlap_observations" ||
        artifact.origin.kind === "speaker_overlap_receipt"
        || artifact.origin.kind === "separation_stem"
        || artifact.origin.kind === "conditional_separation_receipt"
        || artifact.origin.kind === "raw_stem_comparison"
        || artifact.origin.kind === "raw_stem_comparison_receipt"
        || artifact.origin.kind === "research_search_receipt"
        || artifact.origin.kind === "research_document_snapshot"
        || artifact.origin.kind === "research_extraction"
        || artifact.origin.kind === "research_snapshot_receipt"
        || artifact.origin.kind === "research_exhaustion_receipt"
        || artifact.origin.kind === "external_screen_fixture"
        || artifact.origin.kind === "external_screen_screenshot"
        || artifact.origin.kind === "external_screen_content"
        || artifact.origin.kind === "external_screen_action_receipt"
        || artifact.origin.kind === "external_screen_session_receipt"
      ) {
        throw new Error(`Production Studio projection: output artifact ${artifact.id} has an ingest origin`);
      }
      if (artifact.producerTaskId === null || artifact.producerAgentId === null) {
        throw new Error(`Production Studio projection: output artifact ${artifact.id} has no task and worker producer`);
      }
      if (artifact.mediaClass === "raw") {
        throw new Error(`Production Studio projection: output artifact ${artifact.id} is incorrectly marked raw`);
      }
      const reportIds = reports
        .filter((report) => report.outputArtifactIds.includes(artifact.id))
        .map((report) => report.reportId);
      return {
        artifactId: artifact.id,
        kind: artifact.kind,
        mediaClass: artifact.mediaClass,
        publication: artifact.publication,
        contentId: artifact.content.contentId,
        bytes: artifact.content.bytes,
        durationMs: artifact.durationMs,
        producerTaskId: artifact.producerTaskId,
        producerAgentId: artifact.producerAgentId,
        sourceArtifactIds: [...artifact.sourceArtifactIds],
        origin: structuredClone(artifact.origin),
        reportIds,
      };
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return outputArtifacts;
}
