import { canonicalSha256 } from "../artifactStore.ts";
import {
  BoundedOrchestratorBridge,
  type ReportsWaitToolResult,
} from "../executor/orchestratorBridge.ts";
import type { ExecutorSpanReceipt, OwnedMediaStudyClaimV2, OwnedMediaStudyCoverageRangeV2, StudyPlanningInput, StudyReportArtifact, TaskRecord } from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import type {
  BoundedOrchestratorLauncher,
  BoundedOrchestratorLauncherContext,
  BoundedOrchestratorLauncherFactory,
} from "./runtimeApplication.ts";
import { ParentArtifactAdmissionHost } from "../admission/parentArtifactAdmissionHost.ts";
import { ParentArtifactReadHost } from "../admission/parentArtifactReadHost.ts";
import { StudyPlanningHost } from "../study/studyPlanningHost.ts";
import { OwnedMediaStudySynthesisHost } from "../study/studySynthesisHost.ts";
import { RangePassHost } from "../study/rangePassHost.ts";
import { ConditionalSeparationRequestHost } from "../study/conditionalSeparationRequestHost.ts";

export type DeterministicOrchestratorMode =
  | "spawn_one"
  | "follow_up"
  | "synthesize_gaps"
  | "conflict"
  | "partial_failure"
  | "rejected_input"
  | "unsupported_claim"
  | "hidden_gap"
  | "duplicate_synthesis"
  | "restudy_support"
  | "restudy_exhausted"
  | "restudy_disagreement"
  | "restudy_speaker_overlap"
  | "no_request";

export interface DeterministicOrchestratorOptions {
  mode?: DeterministicOrchestratorMode;
  now?: () => Date;
}

class DeterministicOrchestratorLauncher implements BoundedOrchestratorLauncher {
  private readonly context: BoundedOrchestratorLauncherContext;
  private readonly mode: DeterministicOrchestratorMode;
  private readonly now: () => Date;

  constructor(context: BoundedOrchestratorLauncherContext, options: DeterministicOrchestratorOptions) {
    this.context = context;
    this.mode = options.mode ?? "spawn_one";
    this.now = options.now ?? (() => new Date());
  }

  private span(task: TaskRecord, executionId: string, startedAt: string, outputArtifactIds: string[] = []): ExecutorSpanReceipt {
    const body = {
      executionId,
      taskId: task.id,
      agentId: task.assignedAgentId,
      phase: "active" as const,
      producer: {
        id: "studio.deterministic-test-executor" as const,
        version: "1" as const,
        sandbox: "read-only" as const,
        ephemeral: true as const,
      },
      startedAt,
      endedAt: this.now().toISOString(),
      monotonicDurationMs: 0,
      outcome: "completed" as const,
      process: { exitCode: 0, signal: null },
      outputArtifactIds,
      modelUsageReceiptId: null,
      failure: null,
    };
    return { schema: "studio.executor-span.receipt.v1", receiptId: `span:${canonicalSha256(body)}`, ...body };
  }

  async launch(permit: Parameters<BoundedOrchestratorLauncher["launch"]>[0]): Promise<void> {
    const { ledger, scheduler, artifacts, childLauncher } = this.context;
    const launchClaim = await scheduler.claimTaskLaunch(permit, "deterministic_test", this.now().toISOString());
    if (!launchClaim.won) throw new Error("Root already has a durable launch claim");
    await scheduler.registerAgent(permit);
    await scheduler.transitionTask(permit.taskId, permit.agentId, "working");
    const task = ledger.state().tasks[permit.taskId];
    const executionId = `execution:deterministic-root:${canonicalSha256({ runId: ledger.runId, taskId: task.id })}`;
    const startedAt = this.now().toISOString();
    await ledger.transact(
      { producer: { kind: "launcher", id: "deterministic-test-orchestrator" }, causationId: permit.requestId },
      () => ({
        pending: [{ type: "executor.started", data: {
          executionId,
          taskId: task.id,
          agentId: task.assignedAgentId,
          launchClaimId: launchClaim.claim.id,
          startedAt,
        } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    let callIndex = 0;
    const planningEnabled = task.grants.some((grant) => grant.capability === "study.plan");
    const generalizedEnabled = task.requiredOutputs.some((output) =>
      output.required && (output.artifactKind === "studio.owned-media-study.v2" || output.artifactKind === "studio.owned-media-study.v3"));
    const restudiedEnabled = task.requiredOutputs.some((output) =>
      output.required && output.artifactKind === "studio.owned-media-study.v3");
    const separationEnabled = restudiedEnabled && task.grants.some((grant) => grant.capability === "study.separate");
    const planningHost = new StudyPlanningHost(ledger, artifacts);
    const bridge = new BoundedOrchestratorBridge({
      task,
      executionId,
      ledger,
      scheduler,
      childLauncher,
      ...(generalizedEnabled ? { artifacts } : {}),
      ...(restudiedEnabled ? {
        rangePassHost: new RangePassHost(ledger, artifacts, scheduler),
      } : {}),
      ...(separationEnabled ? {
        separationRequestHost: new ConditionalSeparationRequestHost(ledger, artifacts, scheduler),
      } : {}),
      ...(planningEnabled ? {
        admissionHost: new ParentArtifactAdmissionHost(ledger, artifacts),
        readHost: new ParentArtifactReadHost(ledger, artifacts),
        planningHost,
        synthesisHost: new OwnedMediaStudySynthesisHost(ledger, artifacts),
      } : {}),
      nextCallId: (tool) => {
        callIndex += 1;
        return `tool-call:deterministic:${tool}:${canonicalSha256({ executionId, tool, callIndex })}`;
      },
    });
    let outcome: "completed" | "no_request" | "withheld" = "no_request";
    let reason = "The deterministic test seam deliberately issued no child request.";
    if (this.mode !== "no_request" && generalizedEnabled) {
      const sourceId = task.jobContext.source.artifactId;
      const rootScope = task.mediaScope[0];
      if (!rootScope || task.mediaScope.length !== 1) throw new Error("Deterministic generalized root requires one exact media scope");
      const midpoint = rootScope.startMs + Math.floor((rootScope.endMs - rootScope.startMs) / 2);
      if (midpoint <= rootScope.startMs || midpoint >= rootScope.endMs) throw new Error("Deterministic generalized root cannot split the bounded scope");
      const restudyDisagreement = this.mode === "restudy_disagreement";
      const restudyWeak = this.mode === "restudy_support" || this.mode === "restudy_exhausted";
      const restudySpeakerOverlap = this.mode === "restudy_speaker_overlap";
      const scopes = restudyDisagreement
        ? [rootScope, rootScope]
        : [{ ...rootScope, endMs: midpoint }, { ...rootScope, startMs: midpoint }];
      for (const [index, scope] of scopes.entries()) {
        await bridge.spawn({
          workloadKey: `deterministic-generalized-study-child:${ledger.runId}:${index}`,
          objective: "Return one v2 coverage partition from current-run speech. Speech alone may support claims; acoustic evidence is coverage qualification and frames are cite-only.",
          workerKind: "analysis",
          workerLabel: restudyDisagreement
            ? `deterministic-study-conflict-${index + 1}`
            : restudySpeakerOverlap && index === 0
              ? "deterministic-study-speaker-overlap-worker"
              : restudyWeak && index === 0
                ? "deterministic-study-gap-worker"
                : `deterministic-generalized-study-worker-${index + 1}`,
          mediaScope: [scope],
          inputArtifactIds: [sourceId],
          requiredOutputs: [{ name: `generalized coverage study ${index + 1}`, artifactKind: "studio.study-report.v2", required: true }],
          requiredCapabilities: [
            "speech.transcribe",
            ...(restudySpeakerOverlap && index === 0 ? ["media.speakers.analyze" as const] : []),
            "report.submit",
          ],
          dependencyWorkloadKeys: [],
          budget: { wallMs: 20_000, toolCalls: 2 },
        });
      }
      const waited = await bridge.wait({});
      if (waited.result !== "all_terminal") throw new Error(`Deterministic generalized fan-out failed as ${waited.failure}`);
      let synthesisInput: { coverage: OwnedMediaStudyCoverageRangeV2[]; claims: OwnedMediaStudyClaimV2[] } | null = null;
      let restudyInput: Awaited<ReturnType<RangePassHost["inspect"]>> | null = null;
      for (const child of waited.children) {
        if (!child.reportId || child.artifactIds.length !== 1) throw new Error("Deterministic generalized child did not return one typed report");
        const disposition = await bridge.disposition({
          reportId: child.reportId,
          outputArtifactId: child.artifactIds[0],
          outcome: "accepted",
          reason: "The deterministic seam accepts this structurally audited U3 report for bounded synthesis; no correctness or quality is claimed.",
        });
        if (!disposition.admission || !("grant" in disposition.admission)) throw new Error("Deterministic generalized admission did not create exact read authority");
        const read = await bridge.readAdmitted({
          grantId: disposition.admission.grant.id,
          contentIds: disposition.admission.grant.contentScope.map((entry) => entry.contentId),
        });
        synthesisInput = read.synthesisInput ?? synthesisInput;
        restudyInput = read.restudyInput ?? restudyInput;
      }
      if (restudyWeak || restudyDisagreement || restudySpeakerOverlap) {
        const candidate = restudyInput?.candidates[0];
        if (!candidate) throw new Error("Deterministic U4 proof requires one exact evidence-derived weak candidate");
        const width = candidate.range.endMs - candidate.range.startMs;
        const inset = Math.max(1, Math.floor(width / 4));
        const executionRange = restudySpeakerOverlap
          ? structuredClone(candidate.cause.range)
          : {
              ...candidate.range,
              startMs: candidate.range.startMs + inset,
              endMs: candidate.range.endMs - inset,
            };
        if (executionRange.startMs >= executionRange.endMs) throw new Error("Deterministic U4 candidate is too narrow for a strict attenuated subrange");

        if (restudySpeakerOverlap) {
          let forgedCauseRejected = false;
          try {
            await bridge.restudy({
              inputId: restudyInput!.inputId,
              coverageId: candidate.coverageId,
              causeId: `${candidate.cause.causeId}:recognizer_disagreement`,
              delta: { kind: "attenuated_subrange", executionRange },
            });
          } catch {
            forgedCauseRejected = true;
          }
          if (!forgedCauseRejected) throw new Error("Deterministic U6.1 proof accepted a forged recognizer-disagreement cause");
        }

        let unregisteredRejected = false;
        try {
          await bridge.restudy({
            inputId: restudyInput!.inputId,
            coverageId: candidate.coverageId,
            causeId: candidate.cause.causeId,
            delta: { kind: "padded_audio_window", executionRange, paddingBeforeMs: 1, paddingAfterMs: 1 },
          });
        } catch {
          unregisteredRejected = true;
        }
        if (!unregisteredRejected) throw new Error("Deterministic U4 proof did not reject an unregistered delta producer");

        let broadeningRejected = false;
        try {
          await bridge.restudy({
            inputId: restudyInput!.inputId,
            coverageId: candidate.coverageId,
            causeId: candidate.cause.causeId,
            delta: { kind: "attenuated_subrange", executionRange: candidate.range },
          });
        } catch {
          broadeningRejected = true;
        }
        if (!broadeningRejected) throw new Error("Deterministic U4 proof did not reject an unchanged/broadened range");

        const validRequest = {
          inputId: restudyInput!.inputId,
          coverageId: candidate.coverageId,
          causeId: candidate.cause.causeId,
          delta: { kind: "attenuated_subrange", executionRange },
        } as const;
        const concurrent = await Promise.all([bridge.restudy(validRequest), bridge.restudy(validRequest)]);
        const requested = concurrent.find((entry) => entry.spawn.decision === "accepted");
        const duplicate = concurrent.find((entry) => entry.spawn.decision === "rejected");
        if (!requested || duplicate?.spawn.rejection !== "restudy_duplicate_work") {
          throw new Error("Deterministic U4 concurrent fingerprint dedupe did not accept one exact pass and reject the duplicate");
        }
        if (requested.spawn.decision !== "accepted") throw new Error(`Deterministic U4 range pass was rejected as ${requested.spawn.rejection}`);
        const passTaskId = ledger.state().rangePasses[requested.requestReceipt.passId]?.taskId;
        if (!passTaskId) throw new Error("Deterministic U4 range pass lost its scheduled task");
        const passWait = await bridge.wait({});
        const passChild = passWait.children.find((entry) => entry.taskId === passTaskId);
        if (!passChild?.reportId || passChild.artifactIds.length !== 1) throw new Error("Deterministic U4 range pass did not return one typed report");
        const disposition = await bridge.disposition({
          reportId: passChild.reportId,
          outputArtifactId: passChild.artifactIds[0],
          outcome: "accepted",
          reason: "The deterministic U4 seam admits the structurally closed range-pass report; correctness, quality, and improvement remain unassessed.",
        });
        if (!disposition.admission || !("grant" in disposition.admission)) throw new Error("Deterministic U4 admission did not create exact read authority");
        const read = await bridge.readAdmitted({
          grantId: disposition.admission.grant.id,
          contentIds: disposition.admission.grant.contentScope.map((entry) => entry.contentId),
        });
        synthesisInput = read.synthesisInput ?? synthesisInput;

        if (!restudySpeakerOverlap) {
          let duplicateRejected = false;
          try {
            await bridge.restudy({
              inputId: restudyInput!.inputId,
              coverageId: candidate.coverageId,
              causeId: candidate.cause.causeId,
              delta: { kind: "attenuated_subrange", executionRange },
            });
          } catch {
            duplicateRejected = true;
          }
          if (!duplicateRejected) throw new Error("Deterministic U4 proof did not reject identical completed work/configuration");
        }
      }
      if (!synthesisInput) throw new Error("Deterministic generalized root did not receive host-derived synthesis input");
      const synthesis = await bridge.synthesize(synthesisInput);
      outcome = "completed";
      reason = `The deterministic seam copied the host-derived U3 synthesis input into ${synthesis.studyId}; this is wiring evidence, not semantic acceptance.`;
    } else if (this.mode !== "no_request" && planningEnabled) {
      const sourceId = task.jobContext.source.artifactId;
      const rootScope = task.mediaScope[0];
      if (!rootScope || task.mediaScope.length !== 1) throw new Error("Deterministic synthesis root requires one exact media scope");
      const midpoint = rootScope.startMs + Math.floor((rootScope.endMs - rootScope.startMs) / 2);
      const partition = [{ ...rootScope, endMs: midpoint }, { ...rootScope, startMs: midpoint }];
      const scopes = this.mode === "conflict" ? [rootScope, rootScope]
        : this.mode === "partial_failure" || this.mode === "rejected_input" ? [...partition, rootScope]
          : partition;
      for (const [index, scope] of scopes.entries()) {
        await bridge.spawn({
          workloadKey: `deterministic-study-child:${ledger.runId}:${index}`,
          objective: "Return one coverage-complete typed study report from a current-run test recognizer hypothesis without correctness or quality claims.",
          workerKind: "analysis",
          workerLabel: (this.mode === "follow_up" || this.mode === "synthesize_gaps") && index === 0
            ? "deterministic-study-gap-worker"
            : this.mode === "conflict"
              ? `deterministic-study-conflict-${index + 1}`
              : this.mode === "partial_failure" && index === 2
                ? "deterministic-study-fail-worker"
            : `deterministic-study-worker-${index + 1}`,
          mediaScope: [scope],
          inputArtifactIds: [sourceId],
          requiredOutputs: [{ name: `coverage study ${index + 1}`, artifactKind: "studio.study-report.v1", required: true }],
          requiredCapabilities: ["speech.transcribe", "report.submit"],
          dependencyWorkloadKeys: [],
          budget: { wallMs: 20_000, toolCalls: 2 },
        });
      }
      const waited = await bridge.wait({});
      if (waited.result !== "all_terminal" && !(this.mode === "partial_failure" && waited.failure === "child_failed")) {
        throw new Error(`Deterministic study fan-out failed as ${waited.failure}`);
      }
      let planningInput: StudyPlanningInput | null = null;
      const admittedReports = new Map<string, StudyReportArtifact>();
      for (const child of waited.children) {
        if (!child.reportId) {
          if (this.mode === "partial_failure" && child.status === "failed") continue;
          throw new Error("Deterministic study child did not return one typed report");
        }
        if (child.artifactIds.length !== 1) throw new Error("Deterministic study child did not return one typed report");
        const childTask = ledger.state().tasks[child.taskId];
        const reject = this.mode === "rejected_input" && childTask?.workerLabel === "deterministic-study-worker-3";
        const disposition = await bridge.disposition({
          reportId: child.reportId,
          outputArtifactId: child.artifactIds[0],
          outcome: reject ? "rejected" : "accepted",
          reason: reject
            ? "The deterministic test root rejected this exact child input while preserving its disposition; no read authority was created."
            : "The deterministic test root accepted the structurally audited report for bounded planning input; this is not semantic agreement or quality judgment.",
        });
        if (reject) continue;
        if (!disposition.admission) throw new Error("Deterministic study admission did not create a read grant");
        const read = await bridge.readAdmitted({
          grantId: disposition.admission.grant.id,
          contentIds: disposition.admission.grant.contentScope.map((entry) => entry.contentId),
        });
        for (const returned of read.artifacts) admittedReports.set(child.reportId, returned.content as StudyReportArtifact);
        planningInput = read.planningInput ?? planningInput;
      }
      planningInput ??= await planningHost.inspect(executionId);
      if (this.mode === "follow_up") {
        const gap = planningInput.gaps[0];
        if (!gap) throw new Error("Deterministic useful-follow-up proof requires one explicit initial gap");
        const followUpPlanning = await bridge.plan({
          inputId: planningInput.inputId,
          coverageIds: planningInput.coverage.map((entry) => entry.coverageId),
          gapIds: planningInput.gaps.map((entry) => entry.gapId),
          conflictIds: planningInput.conflicts.map((entry) => entry.conflictId),
          outcome: "request_follow_up",
          citedGapIds: [gap.gapId],
          citedConflictIds: [],
          reason: "The deterministic test root requests one bounded follow-up for the exact cited gap; this is contract evidence, not a semantic-quality claim.",
        });
        await bridge.spawn({
          workloadKey: `deterministic-study-follow-up:${ledger.runId}`,
          objective: "Re-observe only the exact cited planning gap and return a typed current-run study report without correctness or quality claims.",
          workerKind: "analysis",
          workerLabel: "deterministic-study-follow-up-worker",
          mediaScope: [gap.range],
          inputArtifactIds: [sourceId],
          requiredOutputs: [{ name: "coverage study follow-up", artifactKind: "studio.study-report.v1", required: true }],
          requiredCapabilities: ["speech.transcribe", "report.submit"],
          dependencyWorkloadKeys: [],
          budget: { wallMs: 20_000, toolCalls: 2 },
          followUpCause: { planningDecisionId: followUpPlanning.receipt.decisionId, kind: "gap", causeId: gap.gapId },
        });
        const followed = await bridge.wait({});
        if (followed.result !== "all_terminal") throw new Error(`Deterministic study follow-up failed as ${followed.failure}`);
        const child = followed.children.find((candidate) => candidate.reportId && !admittedReports.has(candidate.reportId));
        if (!child?.reportId || child.artifactIds.length !== 1) throw new Error("Deterministic follow-up did not return one new typed report");
        const disposition = await bridge.disposition({
          reportId: child.reportId,
          outputArtifactId: child.artifactIds[0],
          outcome: "accepted",
          reason: "The deterministic test root accepted the exact follow-up report for planning input; this is not agreement or quality judgment.",
        });
        if (!disposition.admission) throw new Error("Deterministic follow-up admission did not create a read grant");
        const read = await bridge.readAdmitted({
          grantId: disposition.admission.grant.id,
          contentIds: disposition.admission.grant.contentScope.map((entry) => entry.contentId),
        });
        for (const returned of read.artifacts) admittedReports.set(child.reportId, returned.content as StudyReportArtifact);
        planningInput = read.planningInput ?? await planningHost.inspect(executionId);
      }
      const planning = await bridge.plan({
        inputId: planningInput.inputId,
        coverageIds: planningInput.coverage.map((entry) => entry.coverageId),
        gapIds: planningInput.gaps.map((entry) => entry.gapId),
        conflictIds: planningInput.conflicts.map((entry) => entry.conflictId),
        outcome: "synthesize_with_gaps",
        citedGapIds: planningInput.gaps.map((entry) => entry.gapId),
        citedConflictIds: planningInput.conflicts.map((entry) => entry.conflictId),
        reason: "The deterministic test seam selected synthesis only to exercise the contract; it is not model-planning acceptance evidence.",
      });
      const claims = planningInput.coverage.flatMap((entry, index) => {
        if (entry.aggregate !== "supported_candidate") return [];
        const childRange = entry.childRanges.find((candidate) => candidate.state === "supported" && candidate.claimIds.length > 0);
        const reportInput = childRange ? planningInput.reports.find((candidate) => candidate.reportId === childRange.reportId) : null;
        const childClaim = childRange ? admittedReports.get(childRange.reportId)?.claims.find((candidate) => candidate.claimId === childRange.claimIds[0]) : null;
        if (!childRange || !reportInput || !childClaim) throw new Error("Deterministic study synthesis lost a supported child claim");
        return [{
          claimId: `owned-study-claim:deterministic:${index}`,
          ...entry.range,
          statement: `The cited child report records one current-run recognizer hypothesis for ${entry.range.startMs}-${entry.range.endMs}; correctness is not assessed.`,
          childReportCitations: [{
            reportId: reportInput.reportId,
            artifactId: reportInput.artifactId,
            contentId: reportInput.contentId,
            admissionId: reportInput.admissionId,
            claimId: childClaim.claimId,
          }],
          semanticCitations: childClaim.citations,
        }];
      });
      const synthesisRequest = {
        planningDecisionId: planning.receipt.decisionId,
        coverage: planningInput.coverage.map((entry) => {
          const claim = claims.find((candidate) => candidate.artifactId === entry.range.artifactId && candidate.trackId === entry.range.trackId && candidate.startMs === entry.range.startMs && candidate.endMs === entry.range.endMs);
          return claim
            ? { coverageId: entry.coverageId, ...entry.range, state: "supported", claimIds: [claim.claimId], reason: null }
            : { coverageId: entry.coverageId, ...entry.range, state: entry.aggregate === "gap" ? "unknown" : "withheld", claimIds: [], reason: { code: entry.aggregate === "conflict" ? "unresolved_conflict" : "explicit_study_gap", detail: "The deterministic test study preserves the planning gap or conflict without support." } };
        }),
        claims,
        conflicts: planningInput.conflicts.map((entry) => ({ conflictId: entry.conflictId, coverageId: entry.coverageId, status: "unresolved", detail: "The deterministic test study lists but does not arbitrate this child conflict." })),
        limitations: [
          { code: "recognizer_hypothesis_not_truth", coverageIds: planningInput.coverage.map((entry) => entry.coverageId), detail: "Current-run recognizer hypotheses are not ground truth." },
          { code: "semantic_quality_not_assessed", coverageIds: planningInput.coverage.map((entry) => entry.coverageId), detail: "No semantic or translation quality was assessed." },
          ...planningInput.gaps.map((entry) => ({ code: "explicit_gap" as const, coverageIds: [entry.coverageId], detail: "The exact planning gap remains non-supported." })),
          ...planningInput.conflicts.map((entry) => ({ code: "unresolved_conflict" as const, coverageIds: [entry.coverageId], detail: "The exact planning conflict remains unresolved." })),
          ...(this.mode === "partial_failure" ? [{ code: "partial_child_failure" as const, coverageIds: planningInput.coverage.map((entry) => entry.coverageId), detail: "One bounded child failed and contributed no report; the complete root partition is supported only by the other admitted reports." }] : []),
          ...(this.mode === "rejected_input" ? [{ code: "rejected_child_input" as const, coverageIds: planningInput.coverage.map((entry) => entry.coverageId), detail: "One exact child report was rejected and was not admitted as planning input." }] : []),
        ],
      };
      if (this.mode === "unsupported_claim" && synthesisRequest.claims[0]?.semanticCitations[0]) {
        synthesisRequest.claims[0].semanticCitations[0].operationId = "operation:unsupported-model-authored-citation";
      }
      if (this.mode === "hidden_gap") synthesisRequest.coverage = synthesisRequest.coverage.slice(1);
      let synthesis: Awaited<ReturnType<BoundedOrchestratorBridge["synthesize"]>> | null = null;
      try {
        synthesis = await bridge.synthesize(synthesisRequest);
      } catch (error) {
        if (this.mode !== "unsupported_claim" && this.mode !== "hidden_gap") throw error;
      }
      if (this.mode === "duplicate_synthesis" && synthesis) {
        let rejected = false;
        try {
          await bridge.synthesize(synthesisRequest);
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error("The deterministic duplicate-synthesis contract test did not fail closed");
      }
      outcome = synthesis ? "completed" : "withheld";
      reason = synthesis
        ? `The deterministic test seam exercised bounded reports, model-tool-shaped planning, and study ${synthesis.studyId}; it is not real-model acceptance evidence.`
        : "The deterministic adversarial seam confirmed that unsupported or hidden model synthesis failed before study authority was recorded.";
    } else if (this.mode === "spawn_one") {
      const evidenceIds = task.jobContext.detectorEvidence.map((evidence) => evidence.artifactId);
      await bridge.spawn({
        workloadKey: `deterministic-child:${ledger.runId}`,
        objective:
          "Exercise only the existing bounded v1 media/evidence receipt path and submit one structural execution report without semantic media, transcription, translation, synthesis, caption, or quality claims.",
        workerKind: "analysis",
        workerLabel: "deterministic-bounded-child",
        mediaScope: task.mediaScope,
        inputArtifactIds: [task.jobContext.source.artifactId, ...evidenceIds],
        requiredOutputs: [{ name: "execution report", artifactKind: "worker-execution-report", required: true }],
        requiredCapabilities: [
          "media.seek",
          ...(evidenceIds.length > 0 ? ["evidence.read" as const, "analysis.evidence.assess" as const, "analysis.evidence.decide" as const] : []),
          "report.submit",
        ],
        dependencyWorkloadKeys: [],
        budget: { wallMs: 45_000, toolCalls: 1 + evidenceIds.length + (evidenceIds.length > 0 ? 2 : 0) },
      });
      const waited = await bridge.wait({}) as ReportsWaitToolResult;
      outcome = waited.result === "all_terminal" ? "completed" : "withheld";
      reason = waited.result === "all_terminal"
        ? "The deterministic test seam completed its single host-authored child contract and wait."
        : `The deterministic test seam retained the closed wait failure ${waited.failure}.`;
    }
    await ledger.transact(
      { producer: { kind: "launcher", id: "deterministic-test-orchestrator" }, causationId: executionId },
      () => ({
        pending: [{ type: "orchestrator.decision_recorded", data: {
          decision: { executionId, taskId: task.id, outcome, reason },
        } }] satisfies PendingRuntimeEvent[],
        result: undefined,
      }),
    );
    const span = this.span(task, executionId, startedAt, bridge.synthesizedArtifactIds());
    await artifacts.storeJson(span);
    await ledger.transact(
      { producer: { kind: "launcher", id: "deterministic-test-orchestrator" }, causationId: executionId },
      () => ({ pending: [{ type: "executor.finished", data: { receipt: span } }] satisfies PendingRuntimeEvent[], result: undefined }),
    );
  }
}

/** Explicit fake seam for contract/restart tests; it is never model-directed planning evidence. */
export function deterministicOrchestratorLauncherFactory(
  options: DeterministicOrchestratorOptions = {},
): BoundedOrchestratorLauncherFactory {
  return (context) => new DeterministicOrchestratorLauncher(context, options);
}
