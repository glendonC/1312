import type { EvidenceAssessmentAudit } from "../runtime/production/assessmentAudit";
import type { CaptionProductionVerification } from "../runtime/production/captionProductionAudit";
import type { EvidenceDecisionReceiptVerification } from "../runtime/production/decisionReceiptAudit";
import type { PublishReviewDecisionVerification } from "../runtime/production/publishReviewDecisionAudit";
import type { PublishReviewIntakeVerification } from "../runtime/production/publishReviewIntakeAudit";
import type {
  RuntimeHostCaptionProductionRequest,
  RuntimeHostPublishReviewDecisionRequest,
  RuntimeHostPublishReviewOperator,
  RuntimeHostPublishReviewRevocationRequest,
} from "../runtime/production/runtimeHost/model";
import type { ProductionStudioProjection } from "../runtime/production/studioProjection";
import { ProductionCaptionFacts } from "./productProductionFacts/captionFacts";
import { ProductionAgentRecoveryFacts } from "./productProductionFacts/agentRecoveryFacts";
import { buildProductionFactsContext } from "./productProductionFacts/context";
import { ProductionDecisionFacts } from "./productProductionFacts/decisionFacts";
import { ProductionEvidenceFacts } from "./productProductionFacts/evidenceFacts";
import { ProductionOutputFacts } from "./productProductionFacts/outputFacts";
import { ProductionReviewFacts } from "./productProductionFacts/reviewFacts";
import { ProductionSemanticEvidenceFacts } from "./productProductionFacts/semanticEvidenceFacts";
import { ProductionReviewedMemoryFacts } from "./productProductionFacts/reviewedMemoryFacts";
import { ProductionSourceWorkFacts } from "./productProductionFacts/sourceWorkFacts";

export function ProductionJournalFacts({
  projection,
  assessmentAudits,
  decisionReceipts,
  publishReviewIntakes,
  publishReviewDecisions,
  captionProductions,
  reviewOperator,
  reviewBusy,
  reviewError,
  captionBusy,
  captionError,
  onPublishReviewDecision,
  onPublishReviewRevocation,
  onCaptionProduction,
}: {
  projection: ProductionStudioProjection;
  assessmentAudits: readonly EvidenceAssessmentAudit[];
  decisionReceipts: readonly EvidenceDecisionReceiptVerification[];
  publishReviewIntakes: readonly PublishReviewIntakeVerification[];
  publishReviewDecisions: readonly PublishReviewDecisionVerification[];
  captionProductions: readonly CaptionProductionVerification[];
  reviewOperator: RuntimeHostPublishReviewOperator | null;
  reviewBusy: boolean;
  reviewError: string | null;
  captionBusy: boolean;
  captionError: string | null;
  onPublishReviewDecision: (request: RuntimeHostPublishReviewDecisionRequest) => Promise<void>;
  onPublishReviewRevocation: (request: RuntimeHostPublishReviewRevocationRequest) => Promise<void>;
  onCaptionProduction: (request: RuntimeHostCaptionProductionRequest) => Promise<void>;
}) {
  const context = buildProductionFactsContext({
    projection,
    assessmentAudits,
    decisionReceipts,
    publishReviewIntakes,
    publishReviewDecisions,
    captionProductions,
  });

  return (
    <section
      className="product-runtime-production"
      data-production-projection="journal"
      aria-labelledby="product-runtime-production-title"
    >
      <header>
        <span>Validated production adapter · never added to RunBundle</span>
        <h3 id="product-runtime-production-title">Production task and handoff facts</h3>
        <p>
          Latest validated journal facts, including source identity, scheduler decisions, and
          output lineage. They are recorded production evidence, not a presence signal, progress
          estimate, or replay topology.
        </p>
      </header>

      <ProductionSourceWorkFacts context={context} />
      <ProductionReviewedMemoryFacts context={context} />
      <ProductionAgentRecoveryFacts context={context} />
      <ProductionSemanticEvidenceFacts context={context} />
      <ProductionEvidenceFacts context={context} />
      <ProductionDecisionFacts context={context} />
      <ProductionReviewFacts
        context={context}
        reviewOperator={reviewOperator}
        reviewBusy={reviewBusy}
        reviewError={reviewError}
        onPublishReviewDecision={onPublishReviewDecision}
        onPublishReviewRevocation={onPublishReviewRevocation}
      />
      <ProductionCaptionFacts
        context={context}
        captionBusy={captionBusy}
        captionError={captionError}
        reviewBusy={reviewBusy}
        onCaptionProduction={onCaptionProduction}
      />
      <ProductionOutputFacts context={context} />
    </section>
  );
}
