import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { canonicalJson } from "../artifactStore/contentIdentity.ts";
import {
  computerUseActionArtifactId,
  computerUseContentArtifactId,
  computerUseFixtureArtifactId,
  computerUseScreenshotArtifactId,
  computerUseScreenshotId,
  computerUseSessionArtifactId,
} from "../artifactStore/computerUseArtifacts.ts";
import { inspectBoundedRgbPng } from "../frames/png.ts";
import {
  COMPUTER_USE_CAPABILITY,
  type ComputerUseActionReceipt,
  type ComputerUseCapabilityGrant,
  type ComputerUseFixtureManifest,
  type ComputerUseGrantScope,
  type ComputerUseGrantView,
  type ComputerUseRequest,
  type ComputerUseSessionReceipt,
  type ComputerUseStateIdentity,
  type ComputerUseVisibleContentSnapshot,
} from "../model/computerUse.ts";
import type { ContentIdentity } from "../model/source.ts";
import { auditResearchExhaustion } from "../research/researchAudit.ts";
import {
  assertComputerUseRequest,
  computerUseActionId,
  computerUseActionReceiptId,
  computerUseRequestFingerprint,
  computerUseSessionId,
  computerUseSessionReceiptId,
  validateComputerUseActionReceipt,
  validateComputerUseDriver,
  validateComputerUseFixtureManifest,
  validateComputerUseGrantScope,
  validateComputerUseIsolation,
  validateComputerUseSessionReceipt,
  validateComputerUseVisibleContentSnapshot,
} from "../validation/computerUse.ts";
import { auditComputerUseSession, type VerifiedComputerUseSession } from "./computerUseAudit.ts";
import type { ExternalScreenDriverTrace, ReadOnlyExternalScreenDriver } from "./driver.ts";

interface RegisteredComputerUseOperation {
  operationId: string;
  grantId: string;
  fingerprint: string;
  status: "started" | "completed" | "failed";
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new Error(`${label} escapes its closed contract`);
  }
}

function positiveInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${label} must be a safe integer at least ${minimum}`);
  return value as number;
}

function ensureBefore(deadlineAtMs: number): void {
  if (performance.now() >= deadlineAtMs) throw new Error("Computer-use exhausted its wall-time grant");
}

function contentIdentityForBytes(bytes: Buffer): ContentIdentity {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return { algorithm: "sha256", digest, contentId: `sha256:${digest}`, bytes: bytes.length };
}

function canonicalIdentity(value: unknown): ContentIdentity {
  return contentIdentityForBytes(Buffer.from(`${canonicalJson(value)}\n`, "utf8"));
}

async function withComputerUseDeadline<T>(work: Promise<T>, deadlineAtMs: number): Promise<T> {
  const remainingMs = Math.floor(deadlineAtMs - performance.now());
  if (remainingMs <= 0) throw new Error("Computer-use exhausted its wall-time grant");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Computer-use exhausted its wall-time grant")), remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Producer-only R2 host. It has no scheduler, launcher, protocol, projection, or evidence authority. */
export class BoundedComputerUseHost {
  private readonly operations = new Map<string, RegisteredComputerUseOperation>();
  private readonly runId: string;
  private readonly view: ComputerUseGrantView;
  private readonly artifacts: ContentAddressedArtifactStore;
  private readonly driver: ReadOnlyExternalScreenDriver;
  private readonly temporaryRoot: string;
  private readonly maximumWallMs: number | undefined;

  constructor(
    runId: string,
    view: ComputerUseGrantView,
    artifacts: ContentAddressedArtifactStore,
    options: { driver: ReadOnlyExternalScreenDriver; temporaryRoot?: string; maximumWallMs?: number },
  ) {
    this.runId = runId;
    this.view = structuredClone(view);
    this.artifacts = artifacts;
    this.driver = options.driver;
    this.temporaryRoot = options.temporaryRoot ?? tmpdir();
    if (options.maximumWallMs !== undefined && (!Number.isSafeInteger(options.maximumWallMs) || options.maximumWallMs <= 0)) {
      throw new Error("Computer-use host wall override must be a positive safe integer");
    }
    this.maximumWallMs = options.maximumWallMs;
  }

  private authorize(requestValue: unknown): {
    request: ComputerUseRequest;
    grant: ComputerUseCapabilityGrant;
    scope: ComputerUseGrantScope;
    fingerprint: string;
  } {
    assertComputerUseRequest(requestValue);
    const request = structuredClone(requestValue);
    if (request.taskId !== this.view.taskId || request.agentId !== this.view.agentId) {
      throw new Error("Computer-use request identities escape the injected task view");
    }
    const grants = this.view.grants.filter((candidate) => candidate.id === request.grantId);
    if (grants.length !== 1 || grants[0].capability !== COMPUTER_USE_CAPABILITY) {
      throw new Error("Computer-use is outside the injected producer grant");
    }
    const grant = structuredClone(grants[0]);
    const scope = validateComputerUseGrantScope(grant.computerUseScope, "Computer-use grant scope", "computerUseScope");
    if (!same(this.driver.identity, scope.driver)) throw new Error("Computer-use driver identity differs from the sealed grant");
    if (this.operations.has(request.operationId)) throw new Error(`Computer-use operation ${request.operationId} already exists`);
    const charged = [...this.operations.values()].filter((operation) => operation.grantId === grant.id);
    if (charged.length >= scope.limits.maxCalls || charged.length >= scope.limits.maxSessions) {
      throw new Error("Computer-use grant call budget is exhausted");
    }
    const fingerprint = computerUseRequestFingerprint({ grantId: grant.id });
    if (charged.some((operation) => operation.fingerprint === fingerprint)) {
      throw new Error("Computer-use request duplicates already-charged work under the grant");
    }
    return { request, grant, scope: structuredClone(scope), fingerprint };
  }

  private validateTrace(
    traceValue: ExternalScreenDriverTrace,
    scope: ComputerUseGrantScope,
    manifest: ComputerUseFixtureManifest,
  ): {
    trace: ExternalScreenDriverTrace;
    dimensions: Array<{ width: number; height: number }>;
    totalScreenshotBytes: number;
  } {
    const trace = record(traceValue, "Computer-use driver trace");
    exactKeys(trace, ["driver", "isolation", "states", "actions", "stopReason", "accounting"], "Computer-use driver trace");
    const driver = validateComputerUseDriver(trace.driver, "Computer-use driver trace", "trace.driver");
    const isolation = validateComputerUseIsolation(trace.isolation, "Computer-use driver trace", "trace.isolation");
    if (!same(driver, scope.driver)) throw new Error("Computer-use trace changed its sealed driver identity");
    const expectedIsolation = {
      session: "ephemeral_in_memory",
      network: "disabled",
      cookies: "unavailable",
      credentials: "unavailable",
      filesystem: "no_access",
      externalMutations: "unavailable",
    };
    if (!same(isolation, expectedIsolation)) throw new Error("Computer-use trace changed its offline isolation declaration");
    if (!Array.isArray(trace.states) || !Array.isArray(trace.actions)) throw new Error("Computer-use trace states and actions must be arrays");
    if (
      trace.states.length < 1 || trace.states.length > scope.limits.maxSteps ||
      trace.states.length > scope.limits.maxScreenshots || trace.actions.length !== trace.states.length - 1 ||
      trace.actions.length > scope.limits.maxActions
    ) throw new Error("Computer-use trace escapes its step, action, or screenshot limits");

    const dimensions: Array<{ width: number; height: number }> = [];
    const stateIds = new Set<string>();
    const manifestStates = new Map(manifest.states.map((state) => [state.stateId, state]));
    let totalScreenshotBytes = 0;
    for (const [index, stateValue] of trace.states.entries()) {
      const state = record(stateValue, `Computer-use state ${index}`);
      exactKeys(state, [
        "stateId", "ordinal", "surfaceId", "origin", "url", "title", "visibleText",
        "declaredTransitionIds", "viewport", "screenshotPng",
      ], `Computer-use state ${index}`);
      if (
        typeof state.stateId !== "string" || !state.stateId || state.stateId.length > scope.limits.maxIdentifierChars ||
        stateIds.has(state.stateId)
      ) throw new Error(`Computer-use state ${index} repeats, omits, or exceeds its bounded identity`);
      stateIds.add(state.stateId);
      if (state.ordinal !== index || state.surfaceId !== scope.surface.surfaceId || state.origin !== scope.surface.origin) {
        throw new Error(`Computer-use state ${index} changed trace order or surface identity`);
      }
      if (typeof state.url !== "string" || state.url.length > scope.limits.maxUrlChars) throw new Error(`Computer-use state ${index} has no bounded URL`);
      let url: URL;
      try {
        url = new URL(state.url);
      } catch {
        throw new Error(`Computer-use state ${index} has an invalid URL`);
      }
      if (
        url.href !== state.url || url.origin !== scope.surface.origin || url.protocol !== "https:" ||
        url.username || url.password || url.port || url.hash
      ) throw new Error(`Computer-use state ${index} escaped the exact granted origin`);
      if (index === 0 && state.url !== scope.surface.entryUrl) throw new Error("Computer-use initial state changed the granted entry URL");
      if (typeof state.title !== "string" || !state.title.trim() || typeof state.visibleText !== "string" || !state.visibleText.trim()) {
        throw new Error(`Computer-use state ${index} has empty visible content`);
      }
      if (Buffer.byteLength(state.title, "utf8") > scope.limits.maxTitleBytes) {
        throw new Error(`Computer-use state ${index} exceeds the title limit`);
      }
      if (Buffer.byteLength(state.visibleText, "utf8") > scope.limits.maxVisibleTextBytes) {
        throw new Error(`Computer-use state ${index} exceeds the visible-text limit`);
      }
      if (
        !Array.isArray(state.declaredTransitionIds) ||
        state.declaredTransitionIds.some((entry) => typeof entry !== "string" || !entry || entry.length > scope.limits.maxIdentifierChars)
      ) {
        throw new Error(`Computer-use state ${index} has malformed transition identities`);
      }
      const transitionIds = state.declaredTransitionIds as string[];
      if (
        transitionIds.length > scope.limits.maxTransitionsPerState || new Set(transitionIds).size !== transitionIds.length ||
        transitionIds.some((entry, transitionIndex) => transitionIndex > 0 && transitionIds[transitionIndex - 1].localeCompare(entry) >= 0)
      ) throw new Error(`Computer-use state ${index} transitions escape their closed order or limit`);
      const viewport = record(state.viewport, `Computer-use state ${index} viewport`);
      exactKeys(viewport, ["width", "height"], `Computer-use state ${index} viewport`);
      const width = positiveInteger(viewport.width, `Computer-use state ${index} viewport width`, 1);
      const height = positiveInteger(viewport.height, `Computer-use state ${index} viewport height`, 1);
      if (!Buffer.isBuffer(state.screenshotPng)) throw new Error(`Computer-use state ${index} screenshot is not a Buffer`);
      const bytes = state.screenshotPng as Buffer;
      if (bytes.length <= 0 || bytes.length > scope.limits.maxScreenshotBytes) throw new Error(`Computer-use state ${index} exceeds the screenshot byte limit`);
      const measured = inspectBoundedRgbPng(bytes, {
        maxWidthPx: scope.limits.maxScreenshotWidthPx,
        maxHeightPx: scope.limits.maxScreenshotHeightPx,
        maxPixels: scope.limits.maxScreenshotPixels,
      });
      if (measured.width !== width || measured.height !== height) throw new Error(`Computer-use state ${index} screenshot changed viewport dimensions`);
      dimensions.push(measured);
      totalScreenshotBytes += bytes.length;
      if (totalScreenshotBytes > scope.limits.maxTotalScreenshotBytes) throw new Error("Computer-use trace exceeds the aggregate screenshot byte limit");
    }

    for (const [index, state] of trace.states.entries()) {
      const manifestState = manifestStates.get(state.stateId);
      const expectedTransitions = manifestState?.transitions.map((transition) => transition.transitionId) ?? [];
      if (
        !manifestState || (index === 0 && state.stateId !== manifest.initialStateId) ||
        state.url !== manifestState.url || state.title !== manifestState.title || state.visibleText !== manifestState.visibleText ||
        !same(state.viewport, manifestState.viewport) || !same(state.declaredTransitionIds, expectedTransitions) ||
        contentIdentityForBytes(state.screenshotPng).contentId !== manifestState.screenshotContentId
      ) throw new Error(`Computer-use state ${index} drifted from the sealed fixture manifest`);
    }

    for (const [index, actionValue] of trace.actions.entries()) {
      const action = record(actionValue, `Computer-use action ${index}`);
      exactKeys(action, ["index", "beforeStateId", "action", "afterStateId", "result"], `Computer-use action ${index}`);
      const actionBody = record(action.action, `Computer-use action ${index} body`);
      exactKeys(actionBody, ["kind", "transitionId"], `Computer-use action ${index} body`);
      const before = trace.states[index];
      const after = trace.states[index + 1];
      const manifestTransition = manifestStates.get(before.stateId)?.transitions.find(
        (transition) => transition.transitionId === actionBody.transitionId,
      );
      if (
        action.index !== index || action.beforeStateId !== before.stateId || action.afterStateId !== after.stateId ||
        action.result !== "visible_state_changed" || actionBody.kind !== "follow_readonly_transition" ||
        typeof actionBody.transitionId !== "string" || !before.declaredTransitionIds.includes(actionBody.transitionId) ||
        actionBody.transitionId !== manifest.transitionScript[index] || manifestTransition?.nextStateId !== after.stateId
      ) throw new Error(`Computer-use action ${index} is not a declared adjacent read-only transition`);
    }
    if (!new Set(["fixture_complete", "no_readonly_transition", "action_limit_reached"]).has(trace.stopReason as string)) {
      throw new Error("Computer-use trace has an unknown stop reason");
    }
    if (
      (trace.stopReason === "no_readonly_transition" && (trace.actions.length !== 0 || manifest.transitionScript.length !== 0)) ||
      (trace.stopReason === "fixture_complete" && (
        manifest.transitionScript.length === 0 || trace.actions.length !== manifest.transitionScript.length
      ))
    ) throw new Error("Computer-use stop reason contradicts its sealed fixture trace");
    if (
      trace.stopReason === "action_limit_reached" &&
      trace.actions.length < scope.limits.maxActions && trace.states.length < scope.limits.maxSteps
    ) throw new Error("Computer-use trace claimed a limit it did not reach");
    const accounting = record(trace.accounting, "Computer-use driver accounting");
    exactKeys(accounting, ["driverCalls", "sessions", "egressRequests", "egressBytes", "downloads", "downloadBytes"], "Computer-use driver accounting");
    if (positiveInteger(accounting.driverCalls, "Computer-use driver calls", 1) !== 1 || positiveInteger(accounting.sessions, "Computer-use sessions", 1) !== 1) {
      throw new Error("Computer-use driver must execute exactly one isolated session");
    }
    for (const key of ["egressRequests", "egressBytes", "downloads", "downloadBytes"]) {
      if (positiveInteger(accounting[key], `Computer-use ${key}`) !== 0) throw new Error(`Computer-use offline fixture ${key} must remain zero`);
    }
    return { trace: traceValue, dimensions, totalScreenshotBytes };
  }

  async inspect(requestValue: unknown): Promise<VerifiedComputerUseSession> {
    const startedAt = performance.now();
    const authorized = this.authorize(requestValue);
    const { request, grant, scope, fingerprint } = authorized;
    this.operations.set(request.operationId, {
      operationId: request.operationId,
      grantId: grant.id,
      fingerprint,
      status: "started",
    });
    const sessionId = computerUseSessionId({ runId: this.runId, operationId: request.operationId, grantId: grant.id });
    const effectiveWallMs = Math.min(this.maximumWallMs ?? scope.limits.maxWallMs, scope.limits.maxWallMs);
    const deadlineAtMs = startedAt + effectiveWallMs;
    let temporaryDirectory: string | null = null;
    try {
      ensureBefore(deadlineAtMs);
      const fixtureManifest = validateComputerUseFixtureManifest(this.driver.fixtureManifest);
      const fixtureContent = canonicalIdentity(fixtureManifest);
      if (
        fixtureContent.contentId !== scope.surface.source.fixtureContentId ||
        fixtureContent.bytes > scope.limits.maxFixtureManifestBytes ||
        fixtureManifest.fixtureId !== scope.surface.source.fixtureId ||
        fixtureManifest.surfaceId !== scope.surface.surfaceId || fixtureManifest.origin !== scope.surface.origin ||
        fixtureManifest.entryUrl !== scope.surface.entryUrl
      ) throw new Error("Computer-use fixture manifest changed its sealed surface identity or byte limit");
      const cause = await withComputerUseDeadline(
        auditResearchExhaustion(this.artifacts, this.runId, scope.r1Cause.receiptContentId),
        deadlineAtMs,
      );
      if (
        cause.receiptArtifactId !== scope.r1Cause.receiptArtifactId || cause.receipt.receiptId !== scope.r1Cause.receiptId ||
        cause.receipt.reason !== scope.r1Cause.reason || !same(cause.receipt.gap, scope.gap)
      ) throw new Error("Computer-use grant changed its cold-audited R1 insufficiency cause or exact gap");
      const raw = await withComputerUseDeadline(
        this.driver.inspect({ sessionId, surface: structuredClone(scope.surface), limits: structuredClone(scope.limits), deadlineAtMs }),
        deadlineAtMs,
      );
      ensureBefore(deadlineAtMs);
      const validated = this.validateTrace(raw, scope, fixtureManifest);
      const statePlans: Array<{
        state: ExternalScreenDriverTrace["states"][number];
        identity: ComputerUseStateIdentity;
        visibleContent: ComputerUseVisibleContentSnapshot;
      }> = [];
      let visibleContentBytes = 0;
      for (const [index, state] of validated.trace.states.entries()) {
        const screenshotContent = contentIdentityForBytes(state.screenshotPng);
        const screenshotId = computerUseScreenshotId({
          runId: this.runId,
          sessionId,
          stateId: state.stateId,
          ordinal: index,
          contentId: screenshotContent.contentId,
        });
        const screenshotArtifactId = computerUseScreenshotArtifactId(this.runId, sessionId, index, screenshotContent.contentId);
        const visibleContent: ComputerUseVisibleContentSnapshot = {
          schema: "studio.external-screen-content.v1",
          operationId: request.operationId,
          sessionId,
          stateId: state.stateId,
          ordinal: index,
          surfaceId: scope.surface.surfaceId,
          origin: scope.surface.origin,
          url: state.url,
          title: state.title,
          visibleText: state.visibleText,
          declaredTransitionIds: [...state.declaredTransitionIds],
          viewport: structuredClone(state.viewport),
          screenshot: {
            screenshotId,
            artifactId: screenshotArtifactId,
            contentId: screenshotContent.contentId,
          },
          nonClaims: {
            pixelTextAgreement: "not_assessed",
            sourceTruth: "not_assessed",
            entityMatch: "not_assessed",
            currency: "offline_fixture_not_live",
          },
        };
        validateComputerUseVisibleContentSnapshot(visibleContent);
        const visibleContentIdentity = canonicalIdentity(visibleContent);
        visibleContentBytes += visibleContentIdentity.bytes;
        if (visibleContentBytes > scope.limits.maxVisibleContentBytes) throw new Error("Computer-use visible content exceeds its aggregate byte limit");
        const identity: ComputerUseStateIdentity = {
          stateId: state.stateId,
          ordinal: index,
          screenshot: {
            screenshotId,
            artifactId: screenshotArtifactId,
            content: screenshotContent,
            width: validated.dimensions[index].width,
            height: validated.dimensions[index].height,
            mimeType: "image/png",
          },
          visibleContent: {
            artifactId: computerUseContentArtifactId(this.runId, sessionId, index, visibleContentIdentity.contentId),
            content: visibleContentIdentity,
          },
        };
        statePlans.push({ state, identity, visibleContent });
      }

      const stateIdentities = statePlans.map((plan) => plan.identity);
      const actionPlans: Array<{
        receipt: ComputerUseActionReceipt;
        identity: ComputerUseSessionReceipt["actions"][number];
      }> = [];
      for (const [index, action] of validated.trace.actions.entries()) {
        const actionId = computerUseActionId({
          operationId: request.operationId,
          sessionId,
          index,
          beforeStateId: action.beforeStateId,
          transitionId: action.action.transitionId,
          afterStateId: action.afterStateId,
        });
        const body: Omit<ComputerUseActionReceipt, "receiptId"> = {
          schema: "studio.external-screen-action.receipt.v1",
          operationId: request.operationId,
          sessionId,
          actionId,
          index,
          before: stateIdentities[index],
          action: structuredClone(action.action),
          after: stateIdentities[index + 1],
          result: "visible_state_changed",
          driver: structuredClone(scope.driver),
          cumulativeAccounting: {
            steps: index + 2,
            actions: index + 1,
            screenshots: index + 2,
            totalScreenshotBytes: stateIdentities.slice(0, index + 2).reduce((sum, state) => sum + state.screenshot.content.bytes, 0),
            visibleContentBytes: stateIdentities.slice(0, index + 2).reduce((sum, state) => sum + state.visibleContent.content.bytes, 0),
            egressRequests: 0,
            egressBytes: 0,
            downloads: 0,
            downloadBytes: 0,
          },
          nonClaims: {
            actionAuthority: "read_only_fixture_transition",
            externalMutation: "not_possible",
            understanding: "not_assessed",
          },
        };
        const receipt = validateComputerUseActionReceipt({ ...body, receiptId: computerUseActionReceiptId(body) });
        const content = canonicalIdentity(receipt);
        if (content.bytes > scope.limits.maxActionReceiptBytes) throw new Error(`Computer-use action receipt ${index} exceeds its byte limit`);
        actionPlans.push({
          receipt,
          identity: {
            actionId,
            receiptId: receipt.receiptId,
            artifactId: computerUseActionArtifactId(this.runId, sessionId, index, content.contentId),
            content,
          },
        });
      }

      ensureBefore(deadlineAtMs);
      temporaryDirectory = await withComputerUseDeadline(
        mkdtemp(join(this.temporaryRoot, "studio-computer-use-")),
        deadlineAtMs,
      );
      const storedFixture = await withComputerUseDeadline(this.artifacts.storeJson(fixtureManifest), deadlineAtMs);
      if (!same(storedFixture.content, fixtureContent)) throw new Error("Computer-use fixture manifest changed during storage");
      for (const [index, plan] of statePlans.entries()) {
        const screenshotPath = join(temporaryDirectory, `state-${index}.png`);
        await withComputerUseDeadline(writeFile(screenshotPath, plan.state.screenshotPng, { flag: "wx", mode: 0o600 }), deadlineAtMs);
        const prepared = await withComputerUseDeadline(this.artifacts.prepareDerived(screenshotPath, {
          runId: this.runId,
          kind: "studio.external-screen-screenshot.v1",
          operationId: `${sessionId}:${index}`,
          publication: "private",
          durationMs: 0,
          tracks: [],
        }), deadlineAtMs);
        if (!same(prepared.content, plan.identity.screenshot.content)) throw new Error(`Computer-use screenshot ${index} changed during storage`);
        const storedContent = await withComputerUseDeadline(this.artifacts.storeJson(plan.visibleContent), deadlineAtMs);
        if (!same(storedContent.content, plan.identity.visibleContent.content)) throw new Error(`Computer-use visible content ${index} changed during storage`);
      }
      for (const [index, plan] of actionPlans.entries()) {
        const stored = await withComputerUseDeadline(this.artifacts.storeJson(plan.receipt), deadlineAtMs);
        if (!same(stored.content, plan.identity.content)) throw new Error(`Computer-use action receipt ${index} changed during storage`);
      }

      const measuredBeforeReceiptMs = Math.ceil(performance.now() - startedAt);
      if (measuredBeforeReceiptMs > effectiveWallMs) throw new Error("Computer-use exceeded its wall-time grant before receipt storage");
      const actionIdentities = actionPlans.map((plan) => plan.identity);
      const body: Omit<ComputerUseSessionReceipt, "receiptId"> = {
        schema: "studio.external-screen-session.receipt.v1",
        operationId: request.operationId,
        sessionId,
        runId: this.runId,
        capability: COMPUTER_USE_CAPABILITY,
        authorization: { grantId: grant.id, taskId: request.taskId, agentId: request.agentId },
        gap: structuredClone(scope.gap),
        r1Cause: structuredClone(scope.r1Cause),
        surface: structuredClone(scope.surface),
        driver: structuredClone(scope.driver),
        isolation: structuredClone(validated.trace.isolation),
        limits: structuredClone(scope.limits),
        fixture: {
          artifactId: computerUseFixtureArtifactId(this.runId, sessionId, fixtureContent.contentId),
          content: fixtureContent,
        },
        states: stateIdentities,
        actions: actionIdentities,
        stopReason: validated.trace.stopReason,
        accounting: {
          calls: 1,
          sessions: 1,
          steps: stateIdentities.length,
          actions: actionIdentities.length,
          screenshots: stateIdentities.length,
          totalScreenshotBytes: validated.totalScreenshotBytes,
          visibleContentBytes,
          egressRequests: 0,
          egressBytes: 0,
          downloads: 0,
          downloadBytes: 0,
          authorizedWallMs: scope.limits.maxWallMs,
          effectiveWallMs,
          measuredBeforeReceiptMs,
          wallAccounting: "full_grant_charged_before_completion",
        },
        nonClaims: {
          liveExternalState: "not_observed",
          sourceTruth: "not_assessed",
          entityMatch: "not_assessed",
          currency: "offline_fixture_not_live",
          visualUnderstanding: "not_assessed",
          speechEvidenceAuthority: "not_granted",
          claimSupportAuthority: "not_granted",
          coverageAuthority: "not_granted",
          captionAuthority: "not_granted",
          evidenceAdmission: "not_granted_until_runtime_wiring",
        },
      };
      const receipt = validateComputerUseSessionReceipt({ ...body, receiptId: computerUseSessionReceiptId(body) });
      const receiptContent = canonicalIdentity(receipt);
      if (receiptContent.bytes > scope.limits.maxSessionReceiptBytes) throw new Error("Computer-use session receipt exceeds its byte limit");
      const storedReceipt = await withComputerUseDeadline(this.artifacts.storeJson(receipt), deadlineAtMs);
      if (!same(storedReceipt.content, receiptContent)) throw new Error("Computer-use session receipt changed during storage");
      const receiptArtifactId = computerUseSessionArtifactId(this.runId, sessionId, storedReceipt.content.contentId);
      const audited = await withComputerUseDeadline(
        auditComputerUseSession(this.artifacts, this.runId, storedReceipt.content.contentId),
        deadlineAtMs,
      );
      if (audited.receiptArtifactId !== receiptArtifactId || !same(audited.receipt, receipt)) {
        throw new Error("Computer-use cold audit changed the completed receipt");
      }
      if (temporaryDirectory) {
        await withComputerUseDeadline(rm(temporaryDirectory, { recursive: true, force: true }), deadlineAtMs);
        temporaryDirectory = null;
      }
      ensureBefore(deadlineAtMs);
      this.operations.set(request.operationId, { ...this.operations.get(request.operationId)!, status: "completed" });
      return audited;
    } catch (error) {
      this.operations.set(request.operationId, { ...this.operations.get(request.operationId)!, status: "failed" });
      throw error;
    } finally {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}
