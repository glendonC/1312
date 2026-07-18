import { readFile } from "node:fs/promises";

import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { canonicalJson, canonicalJsonContentId } from "../artifactStore/contentIdentity.ts";
import type { OwnedMediaStudyRecord, RuntimeArtifact } from "../model.ts";
import { OWNED_MEDIA_STUDY_LIMITS } from "../model.ts";
import {
  type ResearchGapBinding,
  type ResearchRequestInput,
  type ResearchRequestReceipt,
  type ResearchTriggerOption,
} from "../model/research.ts";
import { validateOwnedMediaStudyArtifact } from "../validation/studies.ts";
import { exact, object, string } from "../validation/primitives.ts";
import {
  researchRequestInputId,
  researchRequestReceiptId,
  researchTriggerId,
  validateResearchRequestReceipt,
} from "../validation/research.ts";

/** Narrow structural view of RuntimeProjection; the projection satisfies it unchanged. */
export interface ResearchTriggerStateView {
  runId: string;
  ownedMediaStudies: Record<string, OwnedMediaStudyRecord>;
  artifacts: Record<string, RuntimeArtifact>;
}

export interface VerifiedResearchRequest {
  trigger: ResearchTriggerOption;
  gap: ResearchGapBinding;
  receipt: ResearchRequestReceipt;
  receiptContentId: string;
  storageKey: string;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Host-derived, reopen-audited research trigger options: one per unresolved conflict of an
 * admitted owned-media study, each bound to the exact coverage range the conflict names. The
 * model can only echo {inputId, triggerId} exactly; there is no free-text research request.
 * Scheduler admission (spawning a context specialist under a minted research grant) is the
 * deferred hub wiring; this host owns derivation, exactness, and the request receipt.
 */
export class ResearchRequestHost {
  private readonly artifacts: ContentAddressedArtifactStore;

  constructor(artifacts: ContentAddressedArtifactStore) {
    this.artifacts = artifacts;
  }

  async inspect(state: ResearchTriggerStateView): Promise<ResearchRequestInput> {
    const triggers: ResearchTriggerOption[] = [];
    const records = Object.values(state.ownedMediaStudies).sort((left, right) => left.id.localeCompare(right.id));
    for (const record of records) {
      const artifact = state.artifacts[record.artifactId];
      if (
        !artifact || artifact.origin.kind !== "owned_media_study" || artifact.origin.studyId !== record.id ||
        artifact.content.contentId !== record.contentId
      ) {
        throw new Error(`Research trigger study ${record.id} lost its owned-media study artifact lineage`);
      }
      const path = await this.artifacts.resolveVerified(artifact);
      const bytes = await readFile(path);
      if (bytes.length > OWNED_MEDIA_STUDY_LIMITS.maxArtifactBytes) {
        throw new Error(`Research trigger study ${record.id} escapes its bounded artifact contract`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new Error(`Research trigger study ${record.id} is not valid JSON`);
      }
      const envelope = validateOwnedMediaStudyArtifact(parsed);
      if (canonicalJsonContentId(envelope) !== record.contentId || envelope.runId !== state.runId) {
        throw new Error(`Research trigger study ${record.id} is not canonical content for this run`);
      }
      if (!same(envelope.conflicts, record.conflicts) || !same(envelope.coverage, record.coverage)) {
        throw new Error(`Research trigger study ${record.id} projection drifted from its stored artifact`);
      }
      for (const conflict of envelope.conflicts) {
        const coverage = envelope.coverage.find((candidate) => candidate.coverageId === conflict.coverageId);
        if (!coverage) {
          throw new Error(`Research trigger conflict ${conflict.conflictId} names absent coverage ${conflict.coverageId}`);
        }
        const source = state.artifacts[coverage.artifactId];
        if (!source) {
          throw new Error(`Research trigger coverage ${coverage.coverageId} lost its media source artifact`);
        }
        const body: Omit<ResearchTriggerOption, "triggerId"> = {
          source: {
            artifactId: coverage.artifactId,
            contentId: source.content.contentId,
            trackId: coverage.trackId,
            startMs: coverage.startMs,
            endMs: coverage.endMs,
          },
          gap: {
            kind: "unresolved_study_conflict",
            studyId: record.id,
            studyArtifactId: artifact.id,
            studyContentId: record.contentId,
            conflictId: conflict.conflictId,
            coverageId: conflict.coverageId,
            detail: conflict.detail,
          },
        };
        triggers.push({ triggerId: researchTriggerId(body), ...body });
      }
    }
    const body: Omit<ResearchRequestInput, "inputId"> = {
      schema: "studio.research-request-input.v1",
      runId: state.runId,
      triggers,
    };
    return { schema: body.schema, runId: body.runId, inputId: researchRequestInputId(body), triggers };
  }

  async request(state: ResearchTriggerStateView, value: unknown): Promise<VerifiedResearchRequest> {
    const item = object(value, "Research model request", "request");
    exact(item, ["inputId", "triggerId"], "Research model request", "request");
    const requestedInputId = string(item.inputId, "Research model request", "request.inputId");
    const requestedTriggerId = string(item.triggerId, "Research model request", "request.triggerId");
    const inspected = await this.inspect(state);
    if (requestedInputId !== inspected.inputId) {
      throw new Error("Research request used stale or forged host input");
    }
    const matches = inspected.triggers.filter((candidate) => candidate.triggerId === requestedTriggerId);
    if (matches.length !== 1) {
      throw new Error("Research request requires one exact audited trigger");
    }
    const trigger = matches[0];
    const gap: ResearchGapBinding = {
      inputId: inspected.inputId,
      triggerId: trigger.triggerId,
      hypothesis: trigger.gap.detail,
      media: structuredClone(trigger.source),
    };
    const receiptBody: Omit<ResearchRequestReceipt, "receiptId"> = {
      schema: "studio.research-request.receipt.v1",
      runId: state.runId,
      inputId: inspected.inputId,
      trigger: structuredClone(trigger),
      gap,
    };
    const receipt = validateResearchRequestReceipt({
      ...receiptBody,
      receiptId: researchRequestReceiptId(receiptBody),
    });
    const stored = await this.artifacts.storeJson(receipt);
    return {
      trigger,
      gap,
      receipt,
      receiptContentId: stored.content.contentId,
      storageKey: stored.storageKey,
    };
  }
}
