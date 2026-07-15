import { authorizeEvidenceDecision } from "./authorization.ts";
import { canonicalJsonContentId, canonicalSha256, ContentAddressedArtifactStore } from "./artifactStore.ts";
import { reopenEvidenceAssessmentAudits } from "./assessmentAudit.ts";
import { deriveEvidenceDecision } from "./evidenceDecisionPolicy.ts";
import type { RuntimeLedger } from "./journal.ts";
import type {
  AuditedEvidenceAssessmentIdentity,
  EvidenceDecisionReceipt,
  EvidenceDecisionRequest,
} from "./model.ts";
import type { PendingRuntimeEvent } from "./protocol.ts";
import { validateEvidenceDecisionReceipt } from "./validation/decision.ts";

function sameIdentity(
  audit: Awaited<ReturnType<typeof reopenEvidenceAssessmentAudits>>[number],
  identity: AuditedEvidenceAssessmentIdentity,
): boolean {
  return audit.operationId === identity.operationId &&
    audit.artifactId === identity.artifactId &&
    audit.receiptId === identity.receiptId &&
    audit.receiptContentId === identity.receiptContentId;
}

export interface EvidenceDecisionHostResult {
  receipt: EvidenceDecisionReceipt;
  receiptContentId: string;
  outputArtifactId: string;
}

/** Decides only over identities that pass the live stored-assessment audit. */
export class BoundedEvidenceDecisionHost {
  private readonly ledger: RuntimeLedger;
  private readonly artifacts: ContentAddressedArtifactStore;

  constructor(ledger: RuntimeLedger, artifacts: ContentAddressedArtifactStore) {
    this.ledger = ledger;
    this.artifacts = artifacts;
  }

  async decide(requestValue: unknown): Promise<EvidenceDecisionHostResult> {
    let request: EvidenceDecisionRequest | null = null;
    let operationId: string | null = null;
    let started = false;
    try {
      const authorization = await this.ledger.transact(
        { producer: { kind: "decision_host", id: "bounded-evidence-decision-host" }, causationId: null },
        ({ state }) => {
          const authorized = authorizeEvidenceDecision(state, requestValue);
          request = structuredClone(authorized.request);
          operationId = authorized.request.operationId;
          return {
            pending: [{
              type: "analysis.evidence.decision_started",
              data: {
                request: authorized.request,
                grantId: authorized.grant.id,
                maxAuditedAssessments: authorized.scope.maxAuditedAssessments,
              },
            }] satisfies PendingRuntimeEvent[],
            result: authorized,
          };
        },
      );
      started = true;
      const authorized = authorization.result;
      const liveAudits = await reopenEvidenceAssessmentAudits(
        this.ledger.state(),
        await this.ledger.events(),
        this.artifacts,
      );
      const audits = authorized.request.auditedAssessments.map((identity) => {
        const audit = liveAudits.find((candidate) => sameIdentity(candidate, identity));
        if (!audit || audit.taskId !== authorized.request.taskId || audit.agentId !== authorized.request.agentId) {
          throw new Error("Evidence decision input did not pass the live same-task assessment audit");
        }
        return audit;
      });
      const derived = deriveEvidenceDecision(audits);
      const body = {
        operationId: authorized.request.operationId,
        capability: "analysis.evidence.decide" as const,
        authorization: {
          grantId: authorized.grant.id,
          taskId: authorized.request.taskId,
          agentId: authorized.request.agentId,
          maxDecisions: authorized.scope.maxDecisions,
          maxAuditedAssessments: authorized.scope.maxAuditedAssessments,
        },
        inputs: structuredClone(authorized.request.auditedAssessments),
        producer: {
          id: "studio.deterministic-audited-assessment-decision" as const,
          version: "1" as const,
          policy: "withhold_on_preserved_gap_state" as const,
        },
        decision: { outcome: derived.outcome, reasonCodes: derived.reasonCodes },
        result: { auditedAssessmentCount: audits.length, auditedClaimCount: derived.auditedClaimCount },
      };
      const receipt: EvidenceDecisionReceipt = {
        schema: "studio.evidence-decision.receipt.v1",
        receiptId: `evidence-decision:${canonicalSha256(body)}`,
        ...body,
      };
      validateEvidenceDecisionReceipt(receipt);
      const stored = await this.artifacts.storeJson(receipt);
      if (canonicalJsonContentId(receipt) !== stored.content.contentId) {
        throw new Error("Stored evidence decision changed its canonical content identity");
      }
      const artifact = this.artifacts.buildEvidenceDecisionArtifact({
        runId: this.ledger.runId,
        receipt,
        storedReceipt: stored,
      });
      await this.artifacts.record(this.ledger, artifact, authorized.request.operationId);
      await this.ledger.transact(
        {
          producer: { kind: "decision_host", id: "bounded-evidence-decision-host" },
          causationId: authorized.request.operationId,
        },
        () => ({
          pending: [{
            type: "analysis.evidence.decision_completed",
            data: {
              operationId: authorized.request.operationId,
              outputArtifactId: artifact.id,
              receiptContentId: stored.content.contentId,
              receipt,
            },
          }] satisfies PendingRuntimeEvent[],
          result: undefined,
        }),
      );
      return { receipt, receiptContentId: stored.content.contentId, outputArtifactId: artifact.id };
    } catch (error) {
      if (started && request && operationId) {
        const failedOperationId = operationId;
        await this.ledger.transact(
          {
            producer: { kind: "decision_host", id: "bounded-evidence-decision-host" },
            causationId: failedOperationId,
          },
          () => ({
            pending: [{
              type: "analysis.evidence.decision_failed",
              data: { operationId: failedOperationId, reason: "The audited evidence decision failed closed." },
            }] satisfies PendingRuntimeEvent[],
            result: undefined,
          }),
        );
      }
      throw error;
    }
  }
}
