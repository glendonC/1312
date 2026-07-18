import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  COMPUTER_USE_CAPABILITY,
  COMPUTER_USE_LIMITS,
  type ComputerUseActionAccounting,
  type ComputerUseActionReceipt,
  type ComputerUseDriverIdentity,
  type ComputerUseFixtureManifest,
  type ComputerUseGrantScope,
  type ComputerUseIsolation,
  type ComputerUseLimits,
  type ComputerUseRequest,
  type ComputerUseResearchCauseBinding,
  type ComputerUseSessionReceipt,
  type ComputerUseStateIdentity,
  type ComputerUseStopReason,
  type ComputerUseSurface,
  type ComputerUseVisibleContentSnapshot,
} from "../model/computerUse.ts";
import { validateResearchGapBinding } from "./research.ts";
import {
  array,
  contentId,
  exact,
  fail,
  hash,
  integer,
  literal,
  object,
  oneOf,
  string,
  uniqueStrings,
} from "./primitives.ts";

const LIMIT_KEYS = Object.keys(COMPUTER_USE_LIMITS) as Array<keyof ComputerUseLimits>;
const STOP_REASONS = new Set<ComputerUseStopReason>([
  "fixture_complete",
  "no_readonly_transition",
  "action_limit_reached",
]);

function boundedIdentifier(value: unknown, context: string, path: string): string {
  const identifier = string(value, context, path);
  if (identifier.length > COMPUTER_USE_LIMITS.maxIdentifierChars) fail(context, path, "exceeds the identifier limit");
  return identifier;
}

export function computerUseRequestFingerprint(input: { grantId: string }): string {
  return `computer-use-request:${canonicalSha256(input)}`;
}

export function computerUseSessionId(input: { runId: string; operationId: string; grantId: string }): string {
  return `computer-use-session:${canonicalSha256(input)}`;
}

export function computerUseActionId(input: {
  operationId: string;
  sessionId: string;
  index: number;
  beforeStateId: string;
  transitionId: string;
  afterStateId: string;
}): string {
  return `computer-use-action:${canonicalSha256(input)}`;
}

export function computerUseActionReceiptId(value: Omit<ComputerUseActionReceipt, "receiptId">): string {
  const { schema: _schema, ...body } = value;
  return `computer-use-action-receipt:${canonicalSha256(body)}`;
}

export function computerUseSessionReceiptId(value: Omit<ComputerUseSessionReceipt, "receiptId">): string {
  const { schema: _schema, ...body } = value;
  return `computer-use-session-receipt:${canonicalSha256(body)}`;
}

export function validateComputerUseLimits(value: unknown, context: string, path: string): ComputerUseLimits {
  const item = object(value, context, path);
  exact(item, LIMIT_KEYS, context, path);
  for (const key of LIMIT_KEYS) {
    const measured = integer(item[key], context, `${path}.${key}`);
    if (measured !== COMPUTER_USE_LIMITS[key]) {
      fail(context, `${path}.${key}`, `must equal the registered R2 producer limit ${COMPUTER_USE_LIMITS[key]}`);
    }
  }
  return item as unknown as ComputerUseLimits;
}

function validateCanonicalHttpsUrl(value: unknown, context: string, path: string): URL {
  const raw = string(value, context, path);
  if (raw.length > COMPUTER_USE_LIMITS.maxUrlChars) fail(context, path, "exceeds the URL limit");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail(context, path, "must be a canonical https URL");
  }
  if (
    parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash ||
    parsed.hostname !== parsed.hostname.toLowerCase() || parsed.href !== raw
  ) {
    fail(context, path, "must be canonical lowercase https without credentials, port, or fragment");
  }
  return parsed;
}

function validateHttpsOrigin(value: unknown, context: string, path: string): URL {
  const raw = string(value, context, path);
  if (raw.length > COMPUTER_USE_LIMITS.maxUrlChars) fail(context, path, "exceeds the URL limit");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail(context, path, "must be an exact https origin");
  }
  if (
    parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash ||
    parsed.hostname !== parsed.hostname.toLowerCase() || parsed.origin !== raw || parsed.pathname !== "/" || parsed.search
  ) fail(context, path, "must be an exact lowercase https origin");
  return parsed;
}

export function validateComputerUseSurface(value: unknown, context: string, path: string): ComputerUseSurface {
  const item = object(value, context, path);
  exact(item, ["surfaceId", "origin", "entryUrl", "source"], context, path);
  boundedIdentifier(item.surfaceId, context, `${path}.surfaceId`);
  validateHttpsOrigin(item.origin, context, `${path}.origin`);
  const entry = validateCanonicalHttpsUrl(item.entryUrl, context, `${path}.entryUrl`);
  if (entry.origin !== item.origin) fail(context, `${path}.entryUrl`, "must remain on the exact granted origin");
  const source = object(item.source, context, `${path}.source`);
  exact(source, ["mode", "fixtureId", "fixtureContentId"], context, `${path}.source`);
  literal(source.mode, "offline_fixture", context, `${path}.source.mode`);
  boundedIdentifier(source.fixtureId, context, `${path}.source.fixtureId`);
  contentId(source.fixtureContentId, context, `${path}.source.fixtureContentId`);
  return item as unknown as ComputerUseSurface;
}

export function validateComputerUseFixtureManifest(
  value: unknown,
  context = "Computer-use fixture manifest",
  path = "fixture",
): ComputerUseFixtureManifest {
  const item = object(value, context, path);
  exact(item, [
    "schema", "fixtureId", "surfaceId", "origin", "entryUrl", "initialStateId", "transitionScript", "states",
  ], context, path);
  literal(item.schema, "studio.external-screen-fixture.v1", context, `${path}.schema`);
  boundedIdentifier(item.fixtureId, context, `${path}.fixtureId`);
  boundedIdentifier(item.surfaceId, context, `${path}.surfaceId`);
  validateHttpsOrigin(item.origin, context, `${path}.origin`);
  const entryUrl = validateCanonicalHttpsUrl(item.entryUrl, context, `${path}.entryUrl`);
  if (entryUrl.origin !== item.origin) fail(context, `${path}.entryUrl`, "must remain on the fixture origin");
  const initialStateId = boundedIdentifier(item.initialStateId, context, `${path}.initialStateId`);
  const transitionScript = array(item.transitionScript, context, `${path}.transitionScript`).map((entry, index) =>
    boundedIdentifier(entry, context, `${path}.transitionScript[${index}]`));
  if (transitionScript.length > COMPUTER_USE_LIMITS.maxSteps) fail(context, `${path}.transitionScript`, "exceeds the fixture script limit");
  const states = array(item.states, context, `${path}.states`);
  if (states.length < 1 || states.length > COMPUTER_USE_LIMITS.maxSteps) fail(context, `${path}.states`, "escapes the fixture state limit");
  const stateIds = new Set<string>();
  const transitionsByState = new Map<string, Map<string, string>>();
  let initialUrl: string | null = null;
  for (const [index, stateValue] of states.entries()) {
    const state = object(stateValue, context, `${path}.states[${index}]`);
    exact(state, ["stateId", "url", "title", "visibleText", "viewport", "screenshotContentId", "transitions"], context, `${path}.states[${index}]`);
    const stateId = boundedIdentifier(state.stateId, context, `${path}.states[${index}].stateId`);
    if (stateIds.has(stateId)) fail(context, `${path}.states`, "must not repeat state identities");
    stateIds.add(stateId);
    const url = validateCanonicalHttpsUrl(state.url, context, `${path}.states[${index}].url`);
    if (url.origin !== item.origin) fail(context, `${path}.states[${index}].url`, "escapes the fixture origin");
    if (stateId === initialStateId) initialUrl = url.href;
    const title = string(state.title, context, `${path}.states[${index}].title`);
    if (Buffer.byteLength(title, "utf8") > COMPUTER_USE_LIMITS.maxTitleBytes) fail(context, `${path}.states[${index}].title`, "exceeds the title limit");
    const visibleText = string(state.visibleText, context, `${path}.states[${index}].visibleText`);
    if (Buffer.byteLength(visibleText, "utf8") > COMPUTER_USE_LIMITS.maxVisibleTextBytes) fail(context, `${path}.states[${index}].visibleText`, "exceeds the visible-text limit");
    const viewport = object(state.viewport, context, `${path}.states[${index}].viewport`);
    exact(viewport, ["width", "height"], context, `${path}.states[${index}].viewport`);
    const width = integer(viewport.width, context, `${path}.states[${index}].viewport.width`, 1);
    const height = integer(viewport.height, context, `${path}.states[${index}].viewport.height`, 1);
    if (
      width > COMPUTER_USE_LIMITS.maxScreenshotWidthPx || height > COMPUTER_USE_LIMITS.maxScreenshotHeightPx ||
      width * height > COMPUTER_USE_LIMITS.maxScreenshotPixels
    ) fail(context, `${path}.states[${index}].viewport`, "exceeds screenshot dimensions");
    contentId(state.screenshotContentId, context, `${path}.states[${index}].screenshotContentId`);
    const transitions = array(state.transitions, context, `${path}.states[${index}].transitions`);
    if (transitions.length > COMPUTER_USE_LIMITS.maxTransitionsPerState) fail(context, `${path}.states[${index}].transitions`, "exceeds the transition limit");
    const mapping = new Map<string, string>();
    let priorTransitionId: string | null = null;
    for (const [transitionIndex, transitionValue] of transitions.entries()) {
      const transition = object(transitionValue, context, `${path}.states[${index}].transitions[${transitionIndex}]`);
      exact(transition, ["transitionId", "nextStateId"], context, `${path}.states[${index}].transitions[${transitionIndex}]`);
      const transitionId = boundedIdentifier(transition.transitionId, context, `${path}.states[${index}].transitions[${transitionIndex}].transitionId`);
      const nextStateId = boundedIdentifier(transition.nextStateId, context, `${path}.states[${index}].transitions[${transitionIndex}].nextStateId`);
      if (priorTransitionId !== null && priorTransitionId.localeCompare(transitionId) >= 0) fail(context, `${path}.states[${index}].transitions`, "must be uniquely sorted");
      priorTransitionId = transitionId;
      mapping.set(transitionId, nextStateId);
    }
    transitionsByState.set(stateId, mapping);
  }
  if (initialUrl !== item.entryUrl) fail(context, `${path}.initialStateId`, "must name the exact entry state");
  for (const [stateId, transitions] of transitionsByState) {
    for (const nextStateId of transitions.values()) if (!stateIds.has(nextStateId)) fail(context, `${path}.states`, `state ${stateId} names an unknown transition target`);
  }
  let currentStateId = initialStateId;
  const visited = new Set([currentStateId]);
  for (const [index, transitionId] of transitionScript.entries()) {
    const nextStateId = transitionsByState.get(currentStateId)?.get(transitionId);
    if (!nextStateId || visited.has(nextStateId)) fail(context, `${path}.transitionScript[${index}]`, "must follow a declared transition to a new state");
    visited.add(nextStateId);
    currentStateId = nextStateId;
  }
  return item as unknown as ComputerUseFixtureManifest;
}

export function validateComputerUseDriver(value: unknown, context: string, path: string): ComputerUseDriverIdentity {
  const item = object(value, context, path);
  exact(item, ["id", "version", "mode"], context, path);
  boundedIdentifier(item.id, context, `${path}.id`);
  boundedIdentifier(item.version, context, `${path}.version`);
  literal(item.mode, "offline_fixture", context, `${path}.mode`);
  return item as unknown as ComputerUseDriverIdentity;
}

export function validateComputerUseIsolation(value: unknown, context: string, path: string): ComputerUseIsolation {
  const item = object(value, context, path);
  exact(item, ["session", "network", "cookies", "credentials", "filesystem", "externalMutations"], context, path);
  literal(item.session, "ephemeral_in_memory", context, `${path}.session`);
  literal(item.network, "disabled", context, `${path}.network`);
  literal(item.cookies, "unavailable", context, `${path}.cookies`);
  literal(item.credentials, "unavailable", context, `${path}.credentials`);
  literal(item.filesystem, "no_access", context, `${path}.filesystem`);
  literal(item.externalMutations, "unavailable", context, `${path}.externalMutations`);
  return item as unknown as ComputerUseIsolation;
}

export function validateComputerUseResearchCause(
  value: unknown,
  context: string,
  path: string,
): ComputerUseResearchCauseBinding {
  const item = object(value, context, path);
  exact(item, ["receiptId", "receiptArtifactId", "receiptContentId", "reason"], context, path);
  boundedIdentifier(item.receiptId, context, `${path}.receiptId`);
  boundedIdentifier(item.receiptArtifactId, context, `${path}.receiptArtifactId`);
  contentId(item.receiptContentId, context, `${path}.receiptContentId`);
  literal(item.reason, "query_budget_exhausted_without_results", context, `${path}.reason`);
  return item as unknown as ComputerUseResearchCauseBinding;
}

export function validateComputerUseGrantScope(value: unknown, context: string, path: string): ComputerUseGrantScope {
  const item = object(value, context, path);
  exact(item, ["schema", "limits", "gap", "r1Cause", "surface", "driver", "policy"], context, path);
  literal(item.schema, "studio.computer-use-grant.v1", context, `${path}.schema`);
  validateComputerUseLimits(item.limits, context, `${path}.limits`);
  validateResearchGapBinding(item.gap, context, `${path}.gap`);
  validateComputerUseResearchCause(item.r1Cause, context, `${path}.r1Cause`);
  validateComputerUseSurface(item.surface, context, `${path}.surface`);
  validateComputerUseDriver(item.driver, context, `${path}.driver`);
  const policy = object(item.policy, context, `${path}.policy`);
  exact(policy, ["actions", "egress", "downloads", "cookies", "credentials", "uploads", "mutations"], context, `${path}.policy`);
  literal(policy.actions, "host_declared_readonly_transitions_only", context, `${path}.policy.actions`);
  for (const key of ["egress", "downloads", "cookies", "credentials", "uploads", "mutations"]) {
    literal(policy[key], "disabled", context, `${path}.policy.${key}`);
  }
  return item as unknown as ComputerUseGrantScope;
}

export function assertComputerUseRequest(value: unknown, context = "Computer-use request"): asserts value is ComputerUseRequest {
  const item = object(value, context, "request");
  exact(item, ["operationId", "taskId", "agentId", "grantId"], context, "request");
  for (const key of ["operationId", "taskId", "agentId", "grantId"]) boundedIdentifier(item[key], context, `request.${key}`);
}

function validateContentIdentity(value: unknown, context: string, path: string): void {
  hash(value, context, path);
}

export function validateComputerUseStateIdentity(
  value: unknown,
  context: string,
  path: string,
): ComputerUseStateIdentity {
  const item = object(value, context, path);
  exact(item, ["stateId", "ordinal", "screenshot", "visibleContent"], context, path);
  boundedIdentifier(item.stateId, context, `${path}.stateId`);
  integer(item.ordinal, context, `${path}.ordinal`);
  const screenshot = object(item.screenshot, context, `${path}.screenshot`);
  exact(screenshot, ["screenshotId", "artifactId", "content", "width", "height", "mimeType"], context, `${path}.screenshot`);
  boundedIdentifier(screenshot.screenshotId, context, `${path}.screenshot.screenshotId`);
  boundedIdentifier(screenshot.artifactId, context, `${path}.screenshot.artifactId`);
  validateContentIdentity(screenshot.content, context, `${path}.screenshot.content`);
  const width = integer(screenshot.width, context, `${path}.screenshot.width`, 1);
  const height = integer(screenshot.height, context, `${path}.screenshot.height`, 1);
  if (
    width > COMPUTER_USE_LIMITS.maxScreenshotWidthPx || height > COMPUTER_USE_LIMITS.maxScreenshotHeightPx ||
    width * height > COMPUTER_USE_LIMITS.maxScreenshotPixels
  ) fail(context, `${path}.screenshot`, "exceeds the screenshot dimension limits");
  literal(screenshot.mimeType, "image/png", context, `${path}.screenshot.mimeType`);
  const visibleContent = object(item.visibleContent, context, `${path}.visibleContent`);
  exact(visibleContent, ["artifactId", "content"], context, `${path}.visibleContent`);
  boundedIdentifier(visibleContent.artifactId, context, `${path}.visibleContent.artifactId`);
  validateContentIdentity(visibleContent.content, context, `${path}.visibleContent.content`);
  return item as unknown as ComputerUseStateIdentity;
}

function validateTransitionIds(value: unknown, context: string, path: string): string[] {
  const values = uniqueStrings(value, context, path);
  if (
    values.length > COMPUTER_USE_LIMITS.maxTransitionsPerState ||
    values.some((entry) => entry.length > COMPUTER_USE_LIMITS.maxIdentifierChars)
  ) fail(context, path, "exceeds the transition limit");
  if (values.some((entry, index) => index > 0 && values[index - 1].localeCompare(entry) >= 0)) {
    fail(context, path, "must be uniquely sorted");
  }
  return values;
}

export function validateComputerUseVisibleContentSnapshot(
  value: unknown,
  context = "Computer-use visible content",
  path = "content",
): ComputerUseVisibleContentSnapshot {
  const item = object(value, context, path);
  exact(item, [
    "schema", "operationId", "sessionId", "stateId", "ordinal", "surfaceId", "origin", "url",
    "title", "visibleText", "declaredTransitionIds", "viewport", "screenshot", "nonClaims",
  ], context, path);
  literal(item.schema, "studio.external-screen-content.v1", context, `${path}.schema`);
  for (const key of ["operationId", "sessionId", "stateId", "surfaceId"]) {
    boundedIdentifier(item[key], context, `${path}.${key}`);
  }
  const title = string(item.title, context, `${path}.title`);
  if (Buffer.byteLength(title, "utf8") > COMPUTER_USE_LIMITS.maxTitleBytes) fail(context, `${path}.title`, "exceeds the title limit");
  string(item.visibleText, context, `${path}.visibleText`);
  integer(item.ordinal, context, `${path}.ordinal`);
  validateHttpsOrigin(item.origin, context, `${path}.origin`);
  const url = validateCanonicalHttpsUrl(item.url, context, `${path}.url`);
  if (url.origin !== item.origin) fail(context, `${path}.url`, "escapes the recorded origin");
  if (Buffer.byteLength(item.visibleText as string, "utf8") > COMPUTER_USE_LIMITS.maxVisibleTextBytes) {
    fail(context, `${path}.visibleText`, "exceeds the visible-text limit");
  }
  validateTransitionIds(item.declaredTransitionIds, context, `${path}.declaredTransitionIds`);
  const viewport = object(item.viewport, context, `${path}.viewport`);
  exact(viewport, ["width", "height"], context, `${path}.viewport`);
  integer(viewport.width, context, `${path}.viewport.width`, 1);
  integer(viewport.height, context, `${path}.viewport.height`, 1);
  const screenshot = object(item.screenshot, context, `${path}.screenshot`);
  exact(screenshot, ["screenshotId", "artifactId", "contentId"], context, `${path}.screenshot`);
  boundedIdentifier(screenshot.screenshotId, context, `${path}.screenshot.screenshotId`);
  boundedIdentifier(screenshot.artifactId, context, `${path}.screenshot.artifactId`);
  contentId(screenshot.contentId, context, `${path}.screenshot.contentId`);
  const nonClaims = object(item.nonClaims, context, `${path}.nonClaims`);
  exact(nonClaims, ["pixelTextAgreement", "sourceTruth", "entityMatch", "currency"], context, `${path}.nonClaims`);
  literal(nonClaims.pixelTextAgreement, "not_assessed", context, `${path}.nonClaims.pixelTextAgreement`);
  literal(nonClaims.sourceTruth, "not_assessed", context, `${path}.nonClaims.sourceTruth`);
  literal(nonClaims.entityMatch, "not_assessed", context, `${path}.nonClaims.entityMatch`);
  literal(nonClaims.currency, "offline_fixture_not_live", context, `${path}.nonClaims.currency`);
  return item as unknown as ComputerUseVisibleContentSnapshot;
}

function validateActionAccountingFields(
  item: Record<string, unknown>,
  context: string,
  path: string,
): ComputerUseActionAccounting {
  for (const key of ["steps", "actions", "screenshots", "totalScreenshotBytes", "visibleContentBytes"]) {
    integer(item[key], context, `${path}.${key}`);
  }
  for (const key of ["egressRequests", "egressBytes", "downloads", "downloadBytes"]) {
    if (integer(item[key], context, `${path}.${key}`) !== 0) fail(context, `${path}.${key}`, "must remain zero in the offline fixture");
  }
  return item as unknown as ComputerUseActionAccounting;
}

function validateActionAccounting(value: unknown, context: string, path: string): ComputerUseActionAccounting {
  const item = object(value, context, path);
  exact(item, [
    "steps", "actions", "screenshots", "totalScreenshotBytes", "visibleContentBytes",
    "egressRequests", "egressBytes", "downloads", "downloadBytes",
  ], context, path);
  return validateActionAccountingFields(item, context, path);
}

export function validateComputerUseActionReceipt(
  value: unknown,
  context = "Computer-use action receipt",
  path = "receipt",
): ComputerUseActionReceipt {
  const item = object(value, context, path);
  exact(item, [
    "schema", "receiptId", "operationId", "sessionId", "actionId", "index", "before", "action",
    "after", "result", "driver", "cumulativeAccounting", "nonClaims",
  ], context, path);
  literal(item.schema, "studio.external-screen-action.receipt.v1", context, `${path}.schema`);
  const receiptId = boundedIdentifier(item.receiptId, context, `${path}.receiptId`);
  const operationId = boundedIdentifier(item.operationId, context, `${path}.operationId`);
  const sessionId = boundedIdentifier(item.sessionId, context, `${path}.sessionId`);
  const actionId = boundedIdentifier(item.actionId, context, `${path}.actionId`);
  const index = integer(item.index, context, `${path}.index`);
  const before = validateComputerUseStateIdentity(item.before, context, `${path}.before`);
  const action = object(item.action, context, `${path}.action`);
  exact(action, ["kind", "transitionId"], context, `${path}.action`);
  literal(action.kind, "follow_readonly_transition", context, `${path}.action.kind`);
  const transitionId = boundedIdentifier(action.transitionId, context, `${path}.action.transitionId`);
  const after = validateComputerUseStateIdentity(item.after, context, `${path}.after`);
  if (before.ordinal !== index || after.ordinal !== index + 1 || before.stateId === after.stateId) {
    fail(context, path, "must bind adjacent distinct states in trace order");
  }
  literal(item.result, "visible_state_changed", context, `${path}.result`);
  validateComputerUseDriver(item.driver, context, `${path}.driver`);
  const accounting = validateActionAccounting(item.cumulativeAccounting, context, `${path}.cumulativeAccounting`);
  if (accounting.actions !== index + 1 || accounting.steps !== index + 2 || accounting.screenshots !== accounting.steps) {
    fail(context, `${path}.cumulativeAccounting`, "must be cumulative through this action");
  }
  const expectedActionId = computerUseActionId({
    operationId,
    sessionId,
    index,
    beforeStateId: before.stateId,
    transitionId,
    afterStateId: after.stateId,
  });
  if (actionId !== expectedActionId) fail(context, `${path}.actionId`, "does not close the action transition");
  const nonClaims = object(item.nonClaims, context, `${path}.nonClaims`);
  exact(nonClaims, ["actionAuthority", "externalMutation", "understanding"], context, `${path}.nonClaims`);
  literal(nonClaims.actionAuthority, "read_only_fixture_transition", context, `${path}.nonClaims.actionAuthority`);
  literal(nonClaims.externalMutation, "not_possible", context, `${path}.nonClaims.externalMutation`);
  literal(nonClaims.understanding, "not_assessed", context, `${path}.nonClaims.understanding`);
  const receipt = item as unknown as ComputerUseActionReceipt;
  const { receiptId: _receiptId, ...body } = receipt;
  if (receiptId !== computerUseActionReceiptId(body)) fail(context, `${path}.receiptId`, "does not close the receipt body");
  return receipt;
}

export function validateComputerUseSessionReceipt(
  value: unknown,
  context = "Computer-use session receipt",
  path = "receipt",
): ComputerUseSessionReceipt {
  const item = object(value, context, path);
  exact(item, [
    "schema", "receiptId", "operationId", "sessionId", "runId", "capability", "authorization", "gap",
    "r1Cause", "surface", "driver", "isolation", "limits", "fixture", "states", "actions", "stopReason", "accounting", "nonClaims",
  ], context, path);
  literal(item.schema, "studio.external-screen-session.receipt.v1", context, `${path}.schema`);
  const receiptId = boundedIdentifier(item.receiptId, context, `${path}.receiptId`);
  boundedIdentifier(item.operationId, context, `${path}.operationId`);
  boundedIdentifier(item.sessionId, context, `${path}.sessionId`);
  boundedIdentifier(item.runId, context, `${path}.runId`);
  literal(item.capability, COMPUTER_USE_CAPABILITY, context, `${path}.capability`);
  const authorization = object(item.authorization, context, `${path}.authorization`);
  exact(authorization, ["grantId", "taskId", "agentId"], context, `${path}.authorization`);
  for (const key of ["grantId", "taskId", "agentId"]) boundedIdentifier(authorization[key], context, `${path}.authorization.${key}`);
  validateResearchGapBinding(item.gap, context, `${path}.gap`);
  validateComputerUseResearchCause(item.r1Cause, context, `${path}.r1Cause`);
  validateComputerUseSurface(item.surface, context, `${path}.surface`);
  validateComputerUseDriver(item.driver, context, `${path}.driver`);
  validateComputerUseIsolation(item.isolation, context, `${path}.isolation`);
  const limits = validateComputerUseLimits(item.limits, context, `${path}.limits`);
  const fixture = object(item.fixture, context, `${path}.fixture`);
  exact(fixture, ["artifactId", "content"], context, `${path}.fixture`);
  boundedIdentifier(fixture.artifactId, context, `${path}.fixture.artifactId`);
  validateContentIdentity(fixture.content, context, `${path}.fixture.content`);
  const fixtureContent = object(fixture.content, context, `${path}.fixture.content`);
  const surface = item.surface as ComputerUseSurface;
  if (fixtureContent.contentId !== surface.source.fixtureContentId) fail(context, `${path}.fixture.content.contentId`, "must match the sealed surface fixture");
  const states = array(item.states, context, `${path}.states`).map((entry, index) => {
    const state = validateComputerUseStateIdentity(entry, context, `${path}.states[${index}]`);
    if (state.ordinal !== index) fail(context, `${path}.states[${index}].ordinal`, "must preserve trace order");
    return state;
  });
  if (states.length < 1 || states.length > limits.maxSteps || states.length > limits.maxScreenshots) {
    fail(context, `${path}.states`, "escapes the step or screenshot limit");
  }
  if (new Set(states.map((state) => state.stateId)).size !== states.length) fail(context, `${path}.states`, "repeats a state identity");
  const actions = array(item.actions, context, `${path}.actions`);
  if (actions.length !== states.length - 1 || actions.length > limits.maxActions) {
    fail(context, `${path}.actions`, "must close every state transition within the action limit");
  }
  actions.forEach((entry, index) => {
    const action = object(entry, context, `${path}.actions[${index}]`);
    exact(action, ["actionId", "receiptId", "artifactId", "content"], context, `${path}.actions[${index}]`);
    boundedIdentifier(action.actionId, context, `${path}.actions[${index}].actionId`);
    boundedIdentifier(action.receiptId, context, `${path}.actions[${index}].receiptId`);
    boundedIdentifier(action.artifactId, context, `${path}.actions[${index}].artifactId`);
    validateContentIdentity(action.content, context, `${path}.actions[${index}].content`);
  });
  oneOf<ComputerUseStopReason>(item.stopReason, STOP_REASONS, context, `${path}.stopReason`);
  const accounting = object(item.accounting, context, `${path}.accounting`);
  exact(accounting, [
    "steps", "actions", "screenshots", "totalScreenshotBytes", "visibleContentBytes", "egressRequests",
    "egressBytes", "downloads", "downloadBytes", "calls", "sessions", "authorizedWallMs", "effectiveWallMs", "measuredBeforeReceiptMs", "wallAccounting",
  ], context, `${path}.accounting`);
  const actionAccounting = validateActionAccountingFields(accounting, context, `${path}.accounting`);
  if (integer(accounting.calls, context, `${path}.accounting.calls`, 1) !== 1) fail(context, `${path}.accounting.calls`, "must equal one");
  if (integer(accounting.sessions, context, `${path}.accounting.sessions`, 1) !== 1) fail(context, `${path}.accounting.sessions`, "must equal one");
  const authorizedWallMs = integer(accounting.authorizedWallMs, context, `${path}.accounting.authorizedWallMs`, 1);
  const effectiveWallMs = integer(accounting.effectiveWallMs, context, `${path}.accounting.effectiveWallMs`, 1);
  const measured = integer(accounting.measuredBeforeReceiptMs, context, `${path}.accounting.measuredBeforeReceiptMs`);
  if (authorizedWallMs !== limits.maxWallMs || effectiveWallMs > authorizedWallMs || measured > effectiveWallMs) fail(context, `${path}.accounting`, "escapes wall accounting");
  literal(accounting.wallAccounting, "full_grant_charged_before_completion", context, `${path}.accounting.wallAccounting`);
  if (
    actionAccounting.steps !== states.length || actionAccounting.actions !== actions.length || actionAccounting.screenshots !== states.length ||
    actionAccounting.totalScreenshotBytes !== states.reduce((sum, state) => sum + state.screenshot.content.bytes, 0) ||
    actionAccounting.totalScreenshotBytes > limits.maxTotalScreenshotBytes ||
    actionAccounting.visibleContentBytes > limits.maxVisibleContentBytes
  ) fail(context, `${path}.accounting`, "does not close the stored outputs or limits");
  const expectedSessionId = computerUseSessionId({
    runId: item.runId as string,
    operationId: item.operationId as string,
    grantId: authorization.grantId as string,
  });
  if (item.sessionId !== expectedSessionId) fail(context, `${path}.sessionId`, "does not close run, operation, and grant identity");
  const nonClaims = object(item.nonClaims, context, `${path}.nonClaims`);
  exact(nonClaims, [
    "liveExternalState", "sourceTruth", "entityMatch", "currency", "visualUnderstanding",
    "speechEvidenceAuthority", "claimSupportAuthority", "coverageAuthority", "captionAuthority", "evidenceAdmission",
  ], context, `${path}.nonClaims`);
  literal(nonClaims.liveExternalState, "not_observed", context, `${path}.nonClaims.liveExternalState`);
  literal(nonClaims.sourceTruth, "not_assessed", context, `${path}.nonClaims.sourceTruth`);
  literal(nonClaims.entityMatch, "not_assessed", context, `${path}.nonClaims.entityMatch`);
  literal(nonClaims.currency, "offline_fixture_not_live", context, `${path}.nonClaims.currency`);
  literal(nonClaims.visualUnderstanding, "not_assessed", context, `${path}.nonClaims.visualUnderstanding`);
  for (const key of ["speechEvidenceAuthority", "claimSupportAuthority", "coverageAuthority", "captionAuthority"]) {
    literal(nonClaims[key], "not_granted", context, `${path}.nonClaims.${key}`);
  }
  literal(nonClaims.evidenceAdmission, "not_granted_until_runtime_wiring", context, `${path}.nonClaims.evidenceAdmission`);
  const receipt = item as unknown as ComputerUseSessionReceipt;
  const { receiptId: _receiptId, ...body } = receipt;
  if (receiptId !== computerUseSessionReceiptId(body)) fail(context, `${path}.receiptId`, "does not close the receipt body");
  return receipt;
}
