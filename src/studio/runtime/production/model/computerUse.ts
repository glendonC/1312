import type { ContentIdentity } from "./source.ts";
import type { ResearchExhaustionReason, ResearchGapBinding } from "./research.ts";

/** Producer-local capability literal. S2 must add any global task-capability authority. */
export const COMPUTER_USE_CAPABILITY = "computer.use.readonly" as const;

export const COMPUTER_USE_LIMITS = {
  maxCalls: 1,
  maxSessions: 1,
  maxSteps: 8,
  maxActions: 6,
  maxScreenshots: 8,
  maxScreenshotWidthPx: 1_440,
  maxScreenshotHeightPx: 1_200,
  maxScreenshotPixels: 1_728_000,
  maxScreenshotBytes: 2 * 1024 * 1024,
  maxTotalScreenshotBytes: 8 * 1024 * 1024,
  maxIdentifierChars: 256,
  maxUrlChars: 2_048,
  maxTitleBytes: 4 * 1024,
  maxVisibleTextBytes: 64 * 1024,
  maxVisibleContentBytes: 512 * 1024,
  maxTransitionsPerState: 16,
  maxFixtureManifestBytes: 512 * 1024,
  maxActionReceiptBytes: 128 * 1024,
  maxSessionReceiptBytes: 512 * 1024,
  maxEgressRequests: 0,
  maxEgressBytes: 0,
  maxDownloads: 0,
  maxDownloadBytes: 0,
  maxWallMs: 30_000,
} as const;

export interface ComputerUseLimits {
  maxCalls: number;
  maxSessions: number;
  maxSteps: number;
  maxActions: number;
  maxScreenshots: number;
  maxScreenshotWidthPx: number;
  maxScreenshotHeightPx: number;
  maxScreenshotPixels: number;
  maxScreenshotBytes: number;
  maxTotalScreenshotBytes: number;
  maxIdentifierChars: number;
  maxUrlChars: number;
  maxTitleBytes: number;
  maxVisibleTextBytes: number;
  maxVisibleContentBytes: number;
  maxTransitionsPerState: number;
  maxFixtureManifestBytes: number;
  maxActionReceiptBytes: number;
  maxSessionReceiptBytes: number;
  maxEgressRequests: number;
  maxEgressBytes: number;
  maxDownloads: number;
  maxDownloadBytes: number;
  maxWallMs: number;
}

export interface ComputerUseResearchCauseBinding {
  receiptId: string;
  receiptArtifactId: string;
  receiptContentId: string;
  reason: ResearchExhaustionReason;
}

export interface ComputerUseSurface {
  surfaceId: string;
  origin: string;
  entryUrl: string;
  source: {
    mode: "offline_fixture";
    fixtureId: string;
    fixtureContentId: string;
  };
}

export interface ComputerUseFixtureManifest {
  schema: "studio.external-screen-fixture.v1";
  fixtureId: string;
  surfaceId: string;
  origin: string;
  entryUrl: string;
  initialStateId: string;
  transitionScript: string[];
  states: Array<{
    stateId: string;
    url: string;
    title: string;
    visibleText: string;
    viewport: { width: number; height: number };
    screenshotContentId: string;
    transitions: Array<{ transitionId: string; nextStateId: string }>;
  }>;
}

export interface ComputerUseDriverIdentity {
  id: string;
  version: string;
  mode: "offline_fixture";
}

export interface ComputerUseIsolation {
  session: "ephemeral_in_memory";
  network: "disabled";
  cookies: "unavailable";
  credentials: "unavailable";
  filesystem: "no_access";
  externalMutations: "unavailable";
}

export interface ComputerUseGrantScope {
  schema: "studio.computer-use-grant.v1";
  limits: ComputerUseLimits;
  gap: ResearchGapBinding;
  r1Cause: ComputerUseResearchCauseBinding;
  surface: ComputerUseSurface;
  driver: ComputerUseDriverIdentity;
  policy: {
    actions: "host_declared_readonly_transitions_only";
    egress: "disabled";
    downloads: "disabled";
    cookies: "disabled";
    credentials: "disabled";
    uploads: "disabled";
    mutations: "disabled";
  };
}

export interface ComputerUseCapabilityGrant {
  id: string;
  capability: typeof COMPUTER_USE_CAPABILITY;
  computerUseScope: ComputerUseGrantScope;
}

export interface ComputerUseGrantView {
  taskId: string;
  agentId: string;
  grants: ComputerUseCapabilityGrant[];
}

/** Closed request. The caller cannot choose a URL, surface, action, selector, or objective. */
export interface ComputerUseRequest {
  operationId: string;
  taskId: string;
  agentId: string;
  grantId: string;
}

export interface ComputerUseReadonlyAction {
  kind: "follow_readonly_transition";
  transitionId: string;
}

export interface ComputerUseScreenshotIdentity {
  screenshotId: string;
  artifactId: string;
  content: ContentIdentity;
  width: number;
  height: number;
  mimeType: "image/png";
}

export interface ComputerUseContentIdentity {
  artifactId: string;
  content: ContentIdentity;
}

export interface ComputerUseStateIdentity {
  stateId: string;
  ordinal: number;
  screenshot: ComputerUseScreenshotIdentity;
  visibleContent: ComputerUseContentIdentity;
}

export interface ComputerUseVisibleContentSnapshot {
  schema: "studio.external-screen-content.v1";
  operationId: string;
  sessionId: string;
  stateId: string;
  ordinal: number;
  surfaceId: string;
  origin: string;
  url: string;
  title: string;
  visibleText: string;
  declaredTransitionIds: string[];
  viewport: { width: number; height: number };
  screenshot: {
    screenshotId: string;
    artifactId: string;
    contentId: string;
  };
  nonClaims: {
    pixelTextAgreement: "not_assessed";
    sourceTruth: "not_assessed";
    entityMatch: "not_assessed";
    currency: "offline_fixture_not_live";
  };
}

export interface ComputerUseActionAccounting {
  steps: number;
  actions: number;
  screenshots: number;
  totalScreenshotBytes: number;
  visibleContentBytes: number;
  egressRequests: 0;
  egressBytes: 0;
  downloads: 0;
  downloadBytes: 0;
}

export interface ComputerUseActionReceipt {
  schema: "studio.external-screen-action.receipt.v1";
  receiptId: string;
  operationId: string;
  sessionId: string;
  actionId: string;
  index: number;
  before: ComputerUseStateIdentity;
  action: ComputerUseReadonlyAction;
  after: ComputerUseStateIdentity;
  result: "visible_state_changed";
  driver: ComputerUseDriverIdentity;
  cumulativeAccounting: ComputerUseActionAccounting;
  nonClaims: {
    actionAuthority: "read_only_fixture_transition";
    externalMutation: "not_possible";
    understanding: "not_assessed";
  };
}

export interface ComputerUseActionReceiptIdentity {
  actionId: string;
  receiptId: string;
  artifactId: string;
  content: ContentIdentity;
}

export type ComputerUseStopReason = "fixture_complete" | "no_readonly_transition" | "action_limit_reached";

export interface ComputerUseSessionAccounting extends ComputerUseActionAccounting {
  calls: 1;
  sessions: 1;
  authorizedWallMs: number;
  effectiveWallMs: number;
  measuredBeforeReceiptMs: number;
  wallAccounting: "full_grant_charged_before_completion";
}

export interface ComputerUseSessionReceipt {
  schema: "studio.external-screen-session.receipt.v1";
  receiptId: string;
  operationId: string;
  sessionId: string;
  runId: string;
  capability: typeof COMPUTER_USE_CAPABILITY;
  authorization: { grantId: string; taskId: string; agentId: string };
  gap: ResearchGapBinding;
  r1Cause: ComputerUseResearchCauseBinding;
  surface: ComputerUseSurface;
  driver: ComputerUseDriverIdentity;
  isolation: ComputerUseIsolation;
  limits: ComputerUseLimits;
  fixture: ComputerUseContentIdentity;
  states: ComputerUseStateIdentity[];
  actions: ComputerUseActionReceiptIdentity[];
  stopReason: ComputerUseStopReason;
  accounting: ComputerUseSessionAccounting;
  nonClaims: {
    liveExternalState: "not_observed";
    sourceTruth: "not_assessed";
    entityMatch: "not_assessed";
    currency: "offline_fixture_not_live";
    visualUnderstanding: "not_assessed";
    speechEvidenceAuthority: "not_granted";
    claimSupportAuthority: "not_granted";
    coverageAuthority: "not_granted";
    captionAuthority: "not_granted";
    evidenceAdmission: "not_granted_until_runtime_wiring";
  };
}
