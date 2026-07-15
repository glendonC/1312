/** Compatibility facade for the independently testable production validation domains. */
export {
  assertRuntimeArtifact,
  assertSourceArtifactDescriptor,
  assertWorkerOutputEnvelope,
} from "./validation/artifacts.ts";
export { assertRuntimeEvent } from "./validation/events.ts";
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
