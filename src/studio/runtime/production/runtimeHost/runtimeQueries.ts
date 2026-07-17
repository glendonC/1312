import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { reopenEvidenceAssessmentAudits } from "../assessmentAudit.ts";
import { reopenEvidenceDecisionReceipts } from "../decisionReceiptAudit.ts";
import { reopenCaptionProductionResults, reopenCaptionProductions } from "../captions/captionProductionAudit.ts";
import { reopenCaptionQualityControls } from "../captions/captionQualityControlAudit.ts";
import type { PublishReviewOperator } from "../model.ts";
import { reopenPublishReviewDecisions } from "../review/publishReviewDecisionAudit.ts";
import { reopenPublishReviewIntakes } from "../review/publishReviewIntakeAudit.ts";
import {
  PUBLISH_REVIEW_DECISION_ATTESTATION,
  PUBLISH_REVIEW_REVOCATION_ATTESTATION,
} from "../validation/publishReviewDecision.ts";
import { DurableRuntimeCommandStore } from "./commandStore.ts";
import { RuntimeHostError } from "./errors.ts";
import { readValidatedRuntimeJournal } from "./journalPolling.ts";
import type {
  RuntimeHostAssessmentAuditResponse,
  RuntimeHostCaptionProductionResultsResponse,
  RuntimeHostCaptionProductionResponse,
  RuntimeHostCaptionQualityControlResponse,
  RuntimeHostCommandRecord,
  RuntimeHostDecisionReceiptResponse,
  RuntimeHostPublishReviewDecisionResponse,
  RuntimeHostPublishReviewIntakeResponse,
} from "./model.ts";

export class RuntimeHostQueries {
  private readonly store: DurableRuntimeCommandStore;
  private readonly reviewer: PublishReviewOperator;
  private readonly reconcile: (
    record: RuntimeHostCommandRecord,
    recovery: boolean,
  ) => Promise<RuntimeHostCommandRecord>;

  constructor(
    store: DurableRuntimeCommandStore,
    reviewer: PublishReviewOperator,
    reconcile: (
      record: RuntimeHostCommandRecord,
      recovery: boolean,
    ) => Promise<RuntimeHostCommandRecord>,
  ) {
    this.store = store;
    this.reviewer = reviewer;
    this.reconcile = reconcile;
  }

  async assessmentAudits(runtimeId: string): Promise<RuntimeHostAssessmentAuditResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let audits;
    try {
      audits = await reopenEvidenceAssessmentAudits(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored assessment receipt or its cited read lineage failed closed audit validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-assessment-audits.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      audits,
    };
  }

  async decisionReceipts(runtimeId: string): Promise<RuntimeHostDecisionReceiptResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let decisions;
    try {
      decisions = await reopenEvidenceDecisionReceipts(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored evidence decision or its audited assessment lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-decision-receipts.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      decisions,
    };
  }

  async publishReviewIntakes(runtimeId: string): Promise<RuntimeHostPublishReviewIntakeResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let intakes;
    try {
      intakes = await reopenPublishReviewIntakes(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored publish-review intake or its verified decision lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-publish-review-intakes.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      intakes,
    };
  }

  async publishReviewDecisions(runtimeId: string): Promise<RuntimeHostPublishReviewDecisionResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let reviews;
    try {
      reviews = await reopenPublishReviewDecisions(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored publish-review decision, revocation, or verified intake lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-publish-review-decisions.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      reviewer: {
        ...structuredClone(this.reviewer),
        decisionAttestation: PUBLISH_REVIEW_DECISION_ATTESTATION,
        revocationAttestation: PUBLISH_REVIEW_REVOCATION_ATTESTATION,
      },
      reviews,
    };
  }

  async captionProductions(runtimeId: string): Promise<RuntimeHostCaptionProductionResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let captions;
    try {
      captions = await reopenCaptionProductions(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored caption artifact, receipt, or approval lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-caption-productions.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      captions,
    };
  }

  async captionProductionResults(
    runtimeId: string,
  ): Promise<RuntimeHostCaptionProductionResultsResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let results;
    try {
      results = await reopenCaptionProductionResults(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored caption artifact, receipt, or approval lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-caption-production-results.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      results,
    };
  }

  async captionQualityControls(runtimeId: string): Promise<RuntimeHostCaptionQualityControlResponse> {
    const record = await this.store.findByRuntimeId(runtimeId);
    if (!record) throw new RuntimeHostError("unknown_runtime", "The runtime identity is unknown.", 404);
    const reconciled = await this.reconcile(record, false);
    const paths = this.store.paths(runtimeId);
    const journal = await readValidatedRuntimeJournal(paths.journalPath, runtimeId);
    let qualityControls;
    try {
      qualityControls = await reopenCaptionQualityControls(
        journal.state,
        journal.events,
        new ContentAddressedArtifactStore(paths.artifactStoreRoot),
      );
    } catch (error) {
      throw new RuntimeHostError(
        "stored_content_inconsistent",
        "A stored caption QC receipt or current-run candidate lineage failed closed validation.",
        409,
        { cause: error },
      );
    }
    return {
      schema: "studio.local-runtime-caption-quality-controls.v1",
      commandId: reconciled.commandId,
      runtimeId,
      journalHead: journal.head,
      qualityControls,
    };
  }
}
