import type { RuntimeProjection } from "../model.ts";
import type { RuntimeEvent } from "../protocol.ts";
import { invariant } from "./shared.ts";

export function applyArtifactEvent(next: RuntimeProjection, event: RuntimeEvent): boolean {
  if (event.type === "artifact.recorded") {
    const artifact = event.data.artifact;
    const isAtomicParentReceipt =
      (artifact.origin.kind === "parent_admission" || artifact.origin.kind === "parent_artifact_disposition") &&
      event.producer.kind === "admission_host";
    const isAtomicStudyReceipt =
      (artifact.origin.kind === "study_planning_decision" && event.producer.kind === "study_planning_host") ||
      (artifact.origin.kind === "owned_media_study" && event.producer.kind === "study_synthesis_host") ||
      (artifact.origin.kind === "study_readiness" && event.producer.kind === "study_audit_host");
    const isAtomicFrameSampling =
      (artifact.origin.kind === "sampled_frame" ||
        artifact.origin.kind === "frame_sample_manifest" ||
        artifact.origin.kind === "frame_sampling_receipt") &&
      event.producer.kind === "frame_host";
    const isAtomicOcr =
      (artifact.origin.kind === "ocr_observations" || artifact.origin.kind === "ocr_receipt") &&
      event.producer.kind === "ocr_host";
    const isAtomicVisualTransition =
      (artifact.origin.kind === "visual_transition_observations" || artifact.origin.kind === "visual_transition_receipt") &&
      event.producer.kind === "visual_transition_host";
    const isAtomicSpeakerOverlap =
      (artifact.origin.kind === "speaker_overlap_observations" || artifact.origin.kind === "speaker_overlap_receipt") &&
      event.producer.kind === "speaker_host";
    const isAtomicConditionalSeparation =
      (artifact.origin.kind === "separation_stem" || artifact.origin.kind === "conditional_separation_receipt" || artifact.origin.kind === "raw_stem_comparison" || artifact.origin.kind === "raw_stem_comparison_receipt") &&
      event.producer.kind === "separation_host";
    const isAtomicResearch =
      (artifact.origin.kind === "research_search_receipt" || artifact.origin.kind === "research_document_snapshot" || artifact.origin.kind === "research_extraction" || artifact.origin.kind === "research_snapshot_receipt" || artifact.origin.kind === "research_exhaustion_receipt") &&
      event.producer.kind === "research_host";
    const isAtomicComputerUse =
      (artifact.origin.kind === "external_screen_fixture" || artifact.origin.kind === "external_screen_screenshot" ||
        artifact.origin.kind === "external_screen_content" || artifact.origin.kind === "external_screen_action_receipt" ||
        artifact.origin.kind === "external_screen_session_receipt") && event.producer.kind === "computer_use_host";
    const isAtomicLanguageExplanation =
      (artifact.origin.kind === "language_explanation_output" || artifact.origin.kind === "language_explanation_receipt") &&
      event.producer.kind === "language_explanation_host";
    invariant(
      event.producer.kind === "artifact_store" || isAtomicParentReceipt || isAtomicStudyReceipt || isAtomicFrameSampling || isAtomicOcr || isAtomicVisualTransition || isAtomicSpeakerOverlap || isAtomicConditionalSeparation || isAtomicResearch || isAtomicComputerUse || isAtomicLanguageExplanation,
      event,
      "artifact evidence must come from its bounded storage, capability, admission, planning, synthesis, or audit host",
    );
    invariant(artifact.runId === next.runId, event, `artifact ${artifact.id} belongs to another run`);
    invariant(!next.artifacts[artifact.id], event, `artifact ${artifact.id} is duplicated`);
    invariant(artifact.sourceArtifactIds.every((id) => Boolean(next.artifacts[id])), event, `artifact ${artifact.id} has missing lineage`);
    if (artifact.origin.kind === "media_operation" || artifact.origin.kind === "media_observation") {
      const operation = next.operations[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `artifact ${artifact.id} has no active media operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `artifact ${artifact.id} changed its operation producer`);
      invariant(artifact.sourceArtifactIds.includes(operation.artifactId), event, `artifact ${artifact.id} omits its operation input`);
      invariant(
        (operation.capability === "media.extract" && artifact.origin.kind === "media_operation") ||
          (operation.capability === "media.seek" && artifact.origin.kind === "media_observation"),
        event,
        `artifact ${artifact.id} has the wrong origin for ${operation.capability}`,
      );
    } else if (artifact.origin.kind === "sampled_frame") {
      const operation = next.frameSamples[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `frame ${artifact.id} has no active frame operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `frame ${artifact.id} changed its producer`);
      invariant(artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === operation.sourceArtifactId, event, `frame ${artifact.id} changed source lineage`);
    } else if (artifact.origin.kind === "frame_sample_manifest") {
      const operation = next.frameSamples[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `frame manifest ${artifact.id} has no active frame operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `frame manifest ${artifact.id} changed its producer`);
      invariant(artifact.sourceArtifactIds[0] === operation.sourceArtifactId && artifact.sourceArtifactIds.slice(1).every((id) => next.artifacts[id]?.origin.kind === "sampled_frame"), event, `frame manifest ${artifact.id} changed frame lineage`);
    } else if (artifact.origin.kind === "frame_sampling_receipt") {
      const operation = next.frameSamples[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `frame receipt ${artifact.id} has no active frame operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `frame receipt ${artifact.id} changed its producer`);
      invariant(artifact.sourceArtifactIds[0] === operation.sourceArtifactId && artifact.sourceArtifactIds[1] === artifact.origin.manifestArtifactId && next.artifacts[artifact.origin.manifestArtifactId]?.origin.kind === "frame_sample_manifest", event, `frame receipt ${artifact.id} changed manifest lineage`);
    } else if (artifact.origin.kind === "ocr_observations") {
      const operation = next.ocrOperations[artifact.origin.operationId];
      const frameOperation = next.frameSamples[artifact.origin.frameSamplingOperationId];
      invariant(operation?.status === "started" && frameOperation?.status === "completed", event, `OCR observations ${artifact.id} have no active OCR or completed frame input`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `OCR observations ${artifact.id} changed producer`);
      invariant(
        artifact.sourceArtifactIds[0] === operation.sourceArtifactId &&
          artifact.sourceArtifactIds[1] === frameOperation.manifestArtifactId &&
          artifact.sourceArtifactIds[2] === frameOperation.receiptArtifactId &&
          JSON.stringify(artifact.sourceArtifactIds.slice(3)) === JSON.stringify(frameOperation.frameArtifactIds),
        event,
        `OCR observations ${artifact.id} changed U2 lineage`,
      );
    } else if (artifact.origin.kind === "ocr_receipt") {
      const operation = next.ocrOperations[artifact.origin.operationId];
      const frameOperation = next.frameSamples[artifact.origin.frameSamplingOperationId];
      invariant(operation?.status === "started" && frameOperation?.status === "completed", event, `OCR receipt ${artifact.id} has no active OCR or completed frame input`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `OCR receipt ${artifact.id} changed producer`);
      invariant(
        artifact.sourceArtifactIds[0] === operation.sourceArtifactId &&
          artifact.sourceArtifactIds[1] === artifact.origin.observationsArtifactId && next.artifacts[artifact.origin.observationsArtifactId]?.origin.kind === "ocr_observations" &&
          artifact.sourceArtifactIds[2] === frameOperation.manifestArtifactId && artifact.sourceArtifactIds[3] === frameOperation.receiptArtifactId &&
          JSON.stringify(artifact.sourceArtifactIds.slice(4)) === JSON.stringify(frameOperation.frameArtifactIds),
        event,
        `OCR receipt ${artifact.id} changed observations or U2 lineage`,
      );
    } else if (artifact.origin.kind === "visual_transition_observations") {
      const operation = next.visualTransitionOperations[artifact.origin.operationId];
      const frameOperation = next.frameSamples[artifact.origin.frameSamplingOperationId];
      const ocrOperation = next.ocrOperations[artifact.origin.ocrOperationId];
      const upstream = operation && frameOperation && ocrOperation ? [
        operation.sourceArtifactId,
        frameOperation.manifestArtifactId,
        frameOperation.receiptArtifactId,
        ...frameOperation.frameArtifactIds,
        ocrOperation.outputArtifactId,
        ocrOperation.receiptArtifactId,
      ] : [];
      invariant(operation?.status === "started" && frameOperation?.status === "completed" && ocrOperation?.status === "completed", event, `Visual-transition observations ${artifact.id} have no active operation or completed U2/U5 inputs`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `Visual-transition observations ${artifact.id} changed producer`);
      invariant(JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify(upstream), event, `Visual-transition observations ${artifact.id} changed U2/U5 provenance`);
    } else if (artifact.origin.kind === "visual_transition_receipt") {
      const operation = next.visualTransitionOperations[artifact.origin.operationId];
      const frameOperation = next.frameSamples[artifact.origin.frameSamplingOperationId];
      const ocrOperation = next.ocrOperations[artifact.origin.ocrOperationId];
      const upstream = operation && frameOperation && ocrOperation ? [
        operation.sourceArtifactId,
        frameOperation.manifestArtifactId,
        frameOperation.receiptArtifactId,
        ...frameOperation.frameArtifactIds,
        ocrOperation.outputArtifactId,
        ocrOperation.receiptArtifactId,
        artifact.origin.observationsArtifactId,
      ] : [];
      invariant(operation?.status === "started" && frameOperation?.status === "completed" && ocrOperation?.status === "completed", event, `Visual-transition receipt ${artifact.id} has no active operation or completed U2/U5 inputs`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `Visual-transition receipt ${artifact.id} changed producer`);
      invariant(next.artifacts[artifact.origin.observationsArtifactId]?.origin.kind === "visual_transition_observations" && JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify(upstream), event, `Visual-transition receipt ${artifact.id} changed observations or U2/U5 provenance`);
    } else if (artifact.origin.kind === "speaker_overlap_observations") {
      const operation = next.speakerOverlapOperations[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `Speaker/overlap observations ${artifact.id} have no active operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `Speaker/overlap observations ${artifact.id} changed producer`);
      invariant(artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === operation.sourceArtifactId, event, `Speaker/overlap observations ${artifact.id} changed source lineage`);
    } else if (artifact.origin.kind === "speaker_overlap_receipt") {
      const operation = next.speakerOverlapOperations[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `Speaker/overlap receipt ${artifact.id} has no active operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `Speaker/overlap receipt ${artifact.id} changed producer`);
      invariant(
        artifact.sourceArtifactIds.length === 2 && artifact.sourceArtifactIds[0] === operation.sourceArtifactId &&
          artifact.sourceArtifactIds[1] === artifact.origin.observationsArtifactId &&
          next.artifacts[artifact.origin.observationsArtifactId]?.origin.kind === "speaker_overlap_observations",
        event,
        `Speaker/overlap receipt ${artifact.id} changed observations lineage`,
      );
    } else if (artifact.origin.kind === "separation_stem") {
      const operation = next.conditionalSeparationOperations[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `Separation stem ${artifact.id} has no active operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `Separation stem ${artifact.id} changed producer`);
      const stemProvenance = operation.trigger.kind === "u6_speaker_overlap"
        ? [operation.sourceArtifactId, operation.trigger.observationsArtifactId, operation.trigger.receiptArtifactId]
        : [operation.sourceArtifactId, operation.trigger.observationsArtifactId];
      invariant(JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify(stemProvenance), event, `Separation stem ${artifact.id} changed raw or trigger lineage`);
      invariant(artifact.origin.sourceArtifactId === operation.sourceArtifactId && artifact.origin.sourceContentId === next.artifacts[operation.sourceArtifactId]?.content.contentId && artifact.origin.trackId === operation.trackId && artifact.origin.startMs === operation.startMs && artifact.origin.endMs === operation.endMs && artifact.origin.triggerKind === operation.trigger.kind && artifact.origin.triggerObservationId === operation.trigger.observationId, event, `Separation stem ${artifact.id} changed exact source, range, or trigger`);
    } else if (artifact.origin.kind === "conditional_separation_receipt") {
      const operation = next.conditionalSeparationOperations[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `Separation receipt ${artifact.id} has no active operation`);
      const receiptProvenance = operation.trigger.kind === "u6_speaker_overlap"
        ? [operation.sourceArtifactId, operation.trigger.observationsArtifactId, operation.trigger.receiptArtifactId]
        : [operation.sourceArtifactId, operation.trigger.observationsArtifactId];
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId && JSON.stringify(artifact.sourceArtifactIds.slice(0, receiptProvenance.length)) === JSON.stringify(receiptProvenance) && JSON.stringify(artifact.sourceArtifactIds.slice(receiptProvenance.length)) === JSON.stringify(artifact.origin.stemArtifactIds) && artifact.origin.stemArtifactIds.every((id) => next.artifacts[id]?.origin.kind === "separation_stem"), event, `Separation receipt ${artifact.id} changed source, trigger, or stem lineage`);
    } else if (artifact.origin.kind === "raw_stem_comparison") {
      const operation = next.conditionalSeparationOperations[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `Raw/stem comparison ${artifact.id} has no active operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId && artifact.sourceArtifactIds.length === 4 && artifact.sourceArtifactIds[0] === operation.sourceArtifactId && artifact.sourceArtifactIds.slice(1, 3).every((id) => next.artifacts[id]?.origin.kind === "separation_stem") && next.artifacts[artifact.sourceArtifactIds[3]]?.origin.kind === "conditional_separation_receipt", event, `Raw/stem comparison ${artifact.id} changed raw, stem, or receipt lineage`);
    } else if (artifact.origin.kind === "raw_stem_comparison_receipt") {
      const operation = next.conditionalSeparationOperations[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `Raw/stem comparison receipt ${artifact.id} has no active operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId && artifact.sourceArtifactIds.length === 5 && artifact.sourceArtifactIds[0] === operation.sourceArtifactId && artifact.sourceArtifactIds.slice(1, 3).every((id) => next.artifacts[id]?.origin.kind === "separation_stem") && next.artifacts[artifact.sourceArtifactIds[3]]?.origin.kind === "conditional_separation_receipt" && artifact.sourceArtifactIds[4] === artifact.origin.comparisonArtifactId && next.artifacts[artifact.origin.comparisonArtifactId]?.origin.kind === "raw_stem_comparison", event, `Raw/stem comparison receipt ${artifact.id} changed lineage`);
    } else if (artifact.origin.kind === "research_search_receipt") {
      const operation = next.researchOperations[artifact.origin.operationId];
      invariant(operation?.status === "started" && operation.op === "search", event, `Research search receipt ${artifact.id} has no active search operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `Research search receipt ${artifact.id} changed producer`);
      invariant(artifact.sourceArtifactIds.length === 0, event, `Research search receipt ${artifact.id} claims artifact lineage it does not have`);
    } else if (artifact.origin.kind === "research_document_snapshot") {
      const operation = next.researchOperations[artifact.origin.operationId];
      const search = next.researchOperations[artifact.origin.searchOperationId];
      invariant(operation?.status === "started" && operation.op === "document_snapshot", event, `Research document ${artifact.id} has no active snapshot operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `Research document ${artifact.id} changed producer`);
      invariant(
        search?.status === "completed" && search.op === "search" && search.grantId === operation.grantId &&
          artifact.origin.searchOperationId === operation.searchOperationId && artifact.origin.resultIndex === operation.resultIndex &&
          artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === search.receiptArtifactId,
        event,
        `Research document ${artifact.id} changed its search lineage`,
      );
    } else if (artifact.origin.kind === "research_extraction") {
      const operation = next.researchOperations[artifact.origin.operationId];
      invariant(operation?.status === "started" && operation.op === "document_snapshot", event, `Research extraction ${artifact.id} has no active snapshot operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `Research extraction ${artifact.id} changed producer`);
      invariant(
        artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === artifact.origin.documentArtifactId &&
          next.artifacts[artifact.origin.documentArtifactId]?.origin.kind === "research_document_snapshot",
        event,
        `Research extraction ${artifact.id} changed its document lineage`,
      );
    } else if (artifact.origin.kind === "research_snapshot_receipt") {
      const operation = next.researchOperations[artifact.origin.operationId];
      const search = operation ? next.researchOperations[operation.searchOperationId ?? ""] : undefined;
      invariant(operation?.status === "started" && operation.op === "document_snapshot", event, `Research snapshot receipt ${artifact.id} has no active snapshot operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `Research snapshot receipt ${artifact.id} changed producer`);
      invariant(
        search?.status === "completed" && artifact.sourceArtifactIds.length === 3 &&
          artifact.sourceArtifactIds[0] === search.receiptArtifactId &&
          artifact.sourceArtifactIds[1] === artifact.origin.documentArtifactId &&
          next.artifacts[artifact.origin.documentArtifactId]?.origin.kind === "research_document_snapshot" &&
          artifact.sourceArtifactIds[2] === artifact.origin.extractionArtifactId &&
          next.artifacts[artifact.origin.extractionArtifactId]?.origin.kind === "research_extraction",
        event,
        `Research snapshot receipt ${artifact.id} changed search, document, or extraction lineage`,
      );
    } else if (artifact.origin.kind === "research_exhaustion_receipt") {
      const exhaustionGrantId = artifact.origin.grantId;
      const operations = artifact.sourceArtifactIds.map((sourceId) => {
        const source = next.artifacts[sourceId];
        invariant(source?.origin.kind === "research_search_receipt", event, `Research exhaustion ${artifact.id} names a non-search receipt source`);
        return next.researchOperations[source.origin.operationId];
      });
      invariant(
        operations.every((operation) =>
          operation?.status === "completed" && operation.op === "search" &&
          operation.grantId === exhaustionGrantId && operation.searchResultCount === 0 &&
          operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId),
        event,
        `Research exhaustion ${artifact.id} changed empty-search grant or producer lineage`,
      );
    } else if (artifact.origin.kind === "external_screen_fixture") {
      const operation = next.computerUseOperations[artifact.origin.operationId];
      invariant(operation?.status === "started" && operation.sessionId === artifact.origin.sessionId, event, `External-screen fixture ${artifact.id} has no active operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId, event, `External-screen fixture ${artifact.id} changed producer`);
      invariant(JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([operation.gap.media.artifactId, operation.r1Cause.receiptArtifactId]) &&
        artifact.origin.mediaSourceArtifactId === operation.gap.media.artifactId && artifact.origin.r1CauseArtifactId === operation.r1Cause.receiptArtifactId,
      event, `External-screen fixture ${artifact.id} changed media or R1 lineage`);
    } else if (artifact.origin.kind === "external_screen_screenshot") {
      const operation = next.computerUseOperations[artifact.origin.operationId];
      invariant(operation?.status === "started" && operation.sessionId === artifact.origin.sessionId, event, `External-screen screenshot ${artifact.id} has no active operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId && artifact.sourceArtifactIds.length === 1 &&
        artifact.sourceArtifactIds[0] === artifact.origin.fixtureArtifactId && next.artifacts[artifact.origin.fixtureArtifactId]?.origin.kind === "external_screen_fixture",
      event, `External-screen screenshot ${artifact.id} changed fixture or producer lineage`);
    } else if (artifact.origin.kind === "external_screen_content") {
      const operation = next.computerUseOperations[artifact.origin.operationId];
      invariant(operation?.status === "started" && operation.sessionId === artifact.origin.sessionId, event, `External-screen content ${artifact.id} has no active operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId &&
        JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([artifact.origin.fixtureArtifactId, artifact.origin.screenshotArtifactId]) &&
        next.artifacts[artifact.origin.fixtureArtifactId]?.origin.kind === "external_screen_fixture" &&
        next.artifacts[artifact.origin.screenshotArtifactId]?.origin.kind === "external_screen_screenshot",
      event, `External-screen content ${artifact.id} changed screenshot or fixture lineage`);
    } else if (artifact.origin.kind === "external_screen_action_receipt") {
      const operation = next.computerUseOperations[artifact.origin.operationId];
      invariant(operation?.status === "started" && operation.sessionId === artifact.origin.sessionId, event, `External-screen action ${artifact.id} has no active operation`);
      const expected = [artifact.origin.beforeScreenshotArtifactId, artifact.origin.beforeContentArtifactId, artifact.origin.afterScreenshotArtifactId, artifact.origin.afterContentArtifactId];
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId && JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify(expected) &&
        next.artifacts[expected[0]]?.origin.kind === "external_screen_screenshot" && next.artifacts[expected[1]]?.origin.kind === "external_screen_content" &&
        next.artifacts[expected[2]]?.origin.kind === "external_screen_screenshot" && next.artifacts[expected[3]]?.origin.kind === "external_screen_content",
      event, `External-screen action ${artifact.id} changed adjacent state lineage`);
    } else if (artifact.origin.kind === "external_screen_session_receipt") {
      const operation = next.computerUseOperations[artifact.origin.operationId];
      const origin = artifact.origin;
      const stateArtifacts = origin.screenshotArtifactIds.flatMap((screenshotId, index) => [screenshotId, origin.visibleContentArtifactIds[index]]);
      const expected = [origin.mediaSourceArtifactId, origin.r1CauseArtifactId, origin.fixtureArtifactId, ...stateArtifacts, ...origin.actionArtifactIds];
      invariant(operation?.status === "started" && operation.sessionId === origin.sessionId, event, `External-screen session ${artifact.id} has no active operation`);
      invariant(operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId && JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify(expected) &&
        origin.mediaSourceArtifactId === operation.gap.media.artifactId && origin.r1CauseArtifactId === operation.r1Cause.receiptArtifactId &&
        next.artifacts[origin.fixtureArtifactId]?.origin.kind === "external_screen_fixture" &&
        origin.screenshotArtifactIds.every((id) => next.artifacts[id]?.origin.kind === "external_screen_screenshot") &&
        origin.visibleContentArtifactIds.every((id) => next.artifacts[id]?.origin.kind === "external_screen_content") &&
        origin.actionArtifactIds.every((id) => next.artifacts[id]?.origin.kind === "external_screen_action_receipt"),
      event, `External-screen session ${artifact.id} changed its ordered runtime lineage`);
    } else if (artifact.origin.kind === "semantic_media_evidence") {
      const operation = next.semanticEvidence[artifact.origin.operationId];
      invariant(operation?.status === "started", event, `artifact ${artifact.id} has no active semantic operation`);
      invariant(
        operation.taskId === artifact.producerTaskId && operation.agentId === artifact.producerAgentId &&
          artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === operation.sourceArtifactId,
        event,
        `artifact ${artifact.id} changed its semantic producer or source`,
      );
    } else if (artifact.origin.kind === "worker_output") {
      const execution = next.executions[artifact.origin.executionId];
      invariant(execution?.status === "active", event, `artifact ${artifact.id} has no active worker execution`);
      invariant(
        execution.taskId === artifact.producerTaskId && execution.agentId === artifact.producerAgentId,
        event,
        `artifact ${artifact.id} changed its worker execution producer`,
      );
    } else if (artifact.origin.kind === "study_report") {
      const origin = artifact.origin;
      const execution = next.executions[origin.executionId];
      const task = artifact.producerTaskId ? next.tasks[artifact.producerTaskId] : null;
      invariant(execution?.status === "active", event, `artifact ${artifact.id} has no active study-report execution`);
      invariant(
        execution.taskId === artifact.producerTaskId && execution.agentId === artifact.producerAgentId &&
          task?.jobContext.contextId === origin.jobContextId &&
          task.requiredOutputs.some((slot) => slot.name === origin.outputSlotName && slot.artifactKind === artifact.kind),
        event,
        `artifact ${artifact.id} changed its study task, context, or output slot`,
      );
    } else if (artifact.origin.kind === "parent_artifact_disposition") {
      const report = next.reports[artifact.origin.reportId];
      invariant(report?.study && report.status === artifact.origin.outcome, event, `artifact ${artifact.id} has no matching typed report disposition`);
      invariant(
        report.parentTaskId === artifact.producerTaskId && report.parentAgentId === artifact.producerAgentId &&
          report.study.output.artifactId === artifact.origin.inputArtifactId &&
          artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === artifact.origin.inputArtifactId,
        event,
        `artifact ${artifact.id} changed its parent disposition lineage`,
      );
    } else if (artifact.origin.kind === "parent_admission") {
      const report = next.reports[artifact.origin.reportId];
      invariant(report?.study && report.status === "accepted", event, `artifact ${artifact.id} has no accepted typed report`);
      invariant(
        report.parentTaskId === artifact.producerTaskId && report.parentAgentId === artifact.producerAgentId &&
          report.study.output.artifactId === artifact.origin.inputArtifactId &&
          artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === artifact.origin.inputArtifactId,
        event,
        `artifact ${artifact.id} changed its parent admission lineage`,
      );
    } else if (artifact.origin.kind === "generalized_parent_admission") {
      const report = next.reports[artifact.origin.reportId];
      invariant(report?.study?.schema === "studio.study-report-submission.v2" && report.status === "accepted", event, `artifact ${artifact.id} has no accepted v2 report`);
      invariant(
        report.parentTaskId === artifact.producerTaskId && report.parentAgentId === artifact.producerAgentId &&
          report.study.output.artifactId === artifact.origin.reportArtifactId &&
          artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === artifact.origin.reportArtifactId,
        event,
        `artifact ${artifact.id} changed its generalized admission lineage`,
      );
    } else if (artifact.origin.kind === "generalized_parent_artifact_read") {
      const admission = next.generalizedParentArtifactAdmissions[artifact.origin.admissionId];
      invariant(admission?.contractVersion === 2, event, `artifact ${artifact.id} has no v2 admission authority`);
      invariant(
        admission.parentTaskId === artifact.producerTaskId && admission.parentAgentId === artifact.producerAgentId &&
          admission.inputArtifactId === artifact.origin.reportArtifactId &&
          artifact.sourceArtifactIds.length === 1 && artifact.sourceArtifactIds[0] === artifact.origin.reportArtifactId,
        event,
        `artifact ${artifact.id} changed its generalized read lineage`,
      );
    } else if (artifact.origin.kind === "study_planning_decision") {
      const execution = next.executions[artifact.origin.executionId];
      invariant(execution?.status === "active" && execution.taskId === artifact.producerTaskId && execution.agentId === artifact.producerAgentId, event, `artifact ${artifact.id} has no active root planning executor`);
    } else if (artifact.origin.kind === "owned_media_study") {
      const execution = next.executions[artifact.origin.executionId];
      const planning = next.studyPlanningDecisions[artifact.origin.planningDecisionId];
      invariant(execution?.status === "active" && execution.taskId === artifact.producerTaskId && execution.agentId === artifact.producerAgentId && planning?.outcome === "synthesize_with_gaps", event, `artifact ${artifact.id} has no active root synthesis executor or planning decision`);
    } else if (artifact.origin.kind === "generalized_owned_media_study") {
      const execution = next.executions[artifact.origin.executionId];
      invariant(execution?.status === "active" && execution.taskId === artifact.producerTaskId && execution.agentId === artifact.producerAgentId, event, `artifact ${artifact.id} has no active generalized root synthesis executor`);
    } else if (artifact.origin.kind === "study_readiness") {
      const study = next.ownedMediaStudies[artifact.origin.studyId];
      invariant(study?.artifactId === artifact.origin.studyArtifactId && artifact.producerTaskId === null && artifact.producerAgentId === null, event, `artifact ${artifact.id} has no exact owned-media study input`);
    } else if (artifact.origin.kind === "generalized_study_readiness") {
      const study = next.generalizedOwnedMediaStudies[artifact.origin.studyId];
      invariant(study?.artifactId === artifact.origin.studyArtifactId && (study.schema === "studio.owned-media-study.v2" || study.schema === "studio.owned-media-study.v3") && artifact.producerTaskId === null && artifact.producerAgentId === null, event, `artifact ${artifact.id} has no exact generalized study input`);
    } else if (artifact.origin.kind === "root_output_disposition") {
      const report = next.reports[artifact.origin.reportId];
      const expectedStatus = artifact.origin.outcome === "promoted_to_root" ? "accepted" : "rejected";
      invariant(report?.status === expectedStatus, event, `artifact ${artifact.id} has no matching root report decision`);
      invariant(
        report.parentTaskId === artifact.producerTaskId &&
          report.parentAgentId === artifact.producerAgentId &&
          report.outputArtifactIds.includes(artifact.origin.inputArtifactId) &&
          artifact.sourceArtifactIds.length === 1 &&
          artifact.sourceArtifactIds[0] === artifact.origin.inputArtifactId,
        event,
        `artifact ${artifact.id} changed its root disposition lineage`,
      );
    } else if (artifact.origin.kind === "evidence_assessment") {
      const assessment = next.evidenceAssessments[artifact.origin.operationId];
      invariant(assessment?.status === "started", event, `artifact ${artifact.id} has no active evidence assessment`);
      invariant(
        assessment.taskId === artifact.producerTaskId && assessment.agentId === artifact.producerAgentId,
        event,
        `artifact ${artifact.id} changed its assessment producer`,
      );
      invariant(
        JSON.stringify(artifact.origin.readReceiptIds) === JSON.stringify(assessment.readReceiptIds) &&
          JSON.stringify(artifact.origin.readReceiptContentIds) === JSON.stringify(assessment.readReceiptContentIds),
        event,
        `artifact ${artifact.id} changed its assessment receipt inputs`,
      );
    } else if (artifact.origin.kind === "evidence_decision") {
      const decision = next.evidenceDecisions[artifact.origin.operationId];
      invariant(decision?.status === "started", event, `artifact ${artifact.id} has no active evidence decision`);
      invariant(
        decision.taskId === artifact.producerTaskId && decision.agentId === artifact.producerAgentId,
        event,
        `artifact ${artifact.id} changed its decision producer`,
      );
      invariant(
        JSON.stringify(artifact.origin.assessmentOperationIds) === JSON.stringify(decision.assessmentOperationIds) &&
          JSON.stringify(artifact.origin.assessmentArtifactIds) === JSON.stringify(decision.assessmentArtifactIds) &&
          JSON.stringify(artifact.origin.assessmentReceiptIds) === JSON.stringify(decision.assessmentReceiptIds) &&
          JSON.stringify(artifact.origin.assessmentReceiptContentIds) === JSON.stringify(decision.assessmentReceiptContentIds),
        event,
        `artifact ${artifact.id} changed its audited assessment inputs`,
      );
    } else if (artifact.origin.kind === "publish_review_intake") {
      const intake = next.publishReviewIntakes[artifact.origin.intakeId];
      invariant(intake?.status === "started", event, `artifact ${artifact.id} has no active publish-review intake`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null,
        event,
        `artifact ${artifact.id} incorrectly claims a task producer`,
      );
      invariant(
        artifact.origin.readinessId === intake.readinessId &&
          artifact.origin.readinessArtifactId === intake.readinessArtifactId &&
          artifact.origin.readinessReceiptId === intake.readinessReceiptId &&
          artifact.origin.readinessReceiptContentId === intake.readinessReceiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([intake.readinessArtifactId]),
        event,
        `artifact ${artifact.id} changed its verified study-readiness input`,
      );
    } else if (artifact.origin.kind === "publish_review_decision") {
      const review = next.publishReviewDecisions[artifact.origin.reviewId];
      invariant(review?.status === "started", event, `artifact ${artifact.id} has no active publish-review decision`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null,
        event,
        `artifact ${artifact.id} incorrectly claims a task producer`,
      );
      invariant(
        artifact.origin.intakeId === review.intakeId &&
          artifact.origin.intakeArtifactId === review.intakeArtifactId &&
          artifact.origin.intakeReceiptId === review.intakeReceiptId &&
          artifact.origin.intakeReceiptContentId === review.intakeReceiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([review.intakeArtifactId]),
        event,
        `artifact ${artifact.id} changed its verified intake input`,
      );
    } else if (artifact.origin.kind === "publish_review_revocation") {
      const revocation = next.publishReviewRevocations[artifact.origin.revocationId];
      invariant(revocation?.status === "started", event, `artifact ${artifact.id} has no active publish-review revocation`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null,
        event,
        `artifact ${artifact.id} incorrectly claims a task producer`,
      );
      invariant(
        artifact.origin.reviewId === revocation.reviewId &&
          artifact.origin.approvalArtifactId === revocation.approvalArtifactId &&
          artifact.origin.approvalReceiptId === revocation.approvalReceiptId &&
          artifact.origin.approvalReceiptContentId === revocation.approvalReceiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([revocation.approvalArtifactId]),
        event,
        `artifact ${artifact.id} changed its verified approval input`,
      );
    } else if (artifact.origin.kind === "caption_production_output") {
      const job = next.captionProductions[artifact.origin.jobId];
      invariant(job?.status === "started", event, `artifact ${artifact.id} has no active caption production`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null &&
          artifact.origin.approvalReviewId === job.approvalReviewId &&
          artifact.origin.approvalArtifactId === job.approvalArtifactId &&
          artifact.origin.sourceArtifactId === job.sourceArtifactId &&
          artifact.origin.studyId === job.study.studyId &&
          artifact.origin.studyArtifactId === job.study.artifactId &&
          artifact.origin.readinessId === job.readiness.readinessId &&
          artifact.origin.readinessArtifactId === job.readiness.artifactId &&
          artifact.content.contentId !== artifact.origin.receiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            job.sourceArtifactId,
            job.study.artifactId,
            job.readiness.artifactId,
            job.approvalArtifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its caption source or approval authority`,
      );
    } else if (artifact.origin.kind === "caption_production_receipt") {
      const job = next.captionProductions[artifact.origin.jobId];
      const caption = next.artifacts[artifact.origin.captionArtifactId];
      invariant(job?.status === "started", event, `artifact ${artifact.id} has no active caption production`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null &&
          caption?.origin.kind === "caption_production_output" &&
          caption.origin.jobId === job.id &&
          caption.content.contentId === artifact.origin.captionContentId &&
          artifact.origin.approvalReviewId === job.approvalReviewId &&
          artifact.origin.approvalArtifactId === job.approvalArtifactId &&
          artifact.origin.studyId === job.study.studyId &&
          artifact.origin.studyArtifactId === job.study.artifactId &&
          artifact.origin.readinessId === job.readiness.readinessId &&
          artifact.origin.readinessArtifactId === job.readiness.artifactId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            caption.id,
            job.study.artifactId,
            job.readiness.artifactId,
            job.approvalArtifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its caption output or approval authority`,
      );
    } else if (artifact.origin.kind === "caption_quality_control") {
      const job = next.captionProductions[artifact.origin.jobId];
      const caption = next.artifacts[artifact.origin.captionArtifactId];
      invariant(job?.status === "completed", event, `artifact ${artifact.id} has no completed caption candidate`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null &&
          caption?.origin.kind === "caption_production_output" &&
          caption.id === job.captionArtifactId &&
          caption.content.contentId === artifact.origin.captionContentId &&
          artifact.origin.captionContentId === job.captionContentId &&
          artifact.origin.studyId === job.study.studyId &&
          artifact.origin.readinessId === job.readiness.readinessId &&
          artifact.origin.approvalReviewId === job.approvalReviewId &&
          artifact.content.contentId === artifact.origin.receiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            caption.id,
            job.study.artifactId,
            job.readiness.artifactId,
            job.approvalArtifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its caption candidate or study/approval lineage`,
      );
    } else if (artifact.origin.kind === "language_explanation_output") {
      const job = next.languageExplanations[artifact.origin.jobId];
      const caption = job ? next.captionProductions[job.caption.jobId] : null;
      invariant(job?.status === "started" && caption?.status === "completed", event, `artifact ${artifact.id} has no active explanation or completed caption`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null &&
          artifact.origin.captionArtifactId === job.caption.artifactId &&
          artifact.origin.captionContentId === job.caption.contentId &&
          artifact.origin.captionReceiptArtifactId === job.caption.receiptArtifactId &&
          artifact.origin.captionReceiptContentId === job.caption.receiptContentId &&
          artifact.origin.sourceArtifactId === caption.sourceArtifactId &&
          artifact.origin.studyArtifactId === caption.study.artifactId &&
          artifact.origin.readinessArtifactId === caption.readiness.artifactId &&
          artifact.origin.approvalArtifactId === caption.approvalArtifactId &&
          artifact.content.contentId !== artifact.origin.receiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            job.caption.artifactId,
            job.caption.receiptArtifactId,
            caption.sourceArtifactId,
            caption.study.artifactId,
            caption.readiness.artifactId,
            caption.approvalArtifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its exact caption authority`,
      );
    } else if (artifact.origin.kind === "language_explanation_receipt") {
      const job = next.languageExplanations[artifact.origin.jobId];
      const caption = job ? next.captionProductions[job.caption.jobId] : null;
      const explanation = next.artifacts[artifact.origin.explanationArtifactId];
      invariant(job?.status === "started" && caption?.status === "completed", event, `artifact ${artifact.id} has no active explanation or completed caption`);
      invariant(
        artifact.producerTaskId === null && artifact.producerAgentId === null &&
          explanation?.origin.kind === "language_explanation_output" &&
          explanation.origin.jobId === job.jobId &&
          explanation.content.contentId === artifact.origin.explanationContentId &&
          artifact.origin.captionArtifactId === job.caption.artifactId &&
          artifact.origin.captionContentId === job.caption.contentId &&
          artifact.origin.captionReceiptArtifactId === job.caption.receiptArtifactId &&
          artifact.origin.captionReceiptContentId === job.caption.receiptContentId &&
          artifact.origin.sourceArtifactId === caption.sourceArtifactId &&
          artifact.origin.studyArtifactId === caption.study.artifactId &&
          artifact.origin.readinessArtifactId === caption.readiness.artifactId &&
          artifact.origin.approvalArtifactId === caption.approvalArtifactId &&
          artifact.content.contentId === artifact.origin.receiptContentId &&
          JSON.stringify(artifact.sourceArtifactIds) === JSON.stringify([
            explanation.id,
            job.caption.artifactId,
            job.caption.receiptArtifactId,
            caption.sourceArtifactId,
            caption.study.artifactId,
            caption.readiness.artifactId,
            caption.approvalArtifactId,
          ]),
        event,
        `artifact ${artifact.id} changed its explanation or exact caption authority`,
      );
    }
    next.artifacts[artifact.id] = artifact;
    return true;
  }

  return false;
}
