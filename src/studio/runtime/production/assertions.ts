/** Compatibility facade for the independently testable production validation domains. */
export {
  assertRuntimeArtifact,
  assertPreflightEvidenceArtifactDescriptor,
  assertSourceArtifactDescriptor,
  assertWorkerOutputEnvelope,
} from "./validation/artifacts.ts";
export { assertRuntimeEvent } from "./validation/events.ts";
export {
  assertEvidenceAssessmentRequest,
  validateEvidenceAssessmentReceipt,
} from "./validation/assessment.ts";
export {
  assertEvidenceDecisionRequest,
  validateEvidenceDecisionReceipt,
} from "./validation/decision.ts";
export {
  assertEvidenceReadRequest,
  validateEvidenceReadReceipt,
} from "./validation/evidence.ts";
export {
  assertReportDecisionRequest,
  assertReportSubmitRequest,
} from "./validation/handoffs.ts";
export {
  assertProductionAnalysisRequest,
  assertProductionSourceSession,
} from "./validation/language.ts";
export {
  assertMediaExtractRequest,
  assertMediaSeekRequest,
} from "./validation/media.ts";
export {
  assertRuntimeLimits,
  assertSpawnRequestInput,
} from "./validation/scheduling.ts";
