import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { deflateSync } from "node:zlib";

import { ContentAddressedArtifactStore } from "../src/studio/runtime/production/artifactStore.ts";
import { canonicalJsonContentId } from "../src/studio/runtime/production/artifactStore/contentIdentity.ts";
import { computerUseActionArtifactId } from "../src/studio/runtime/production/artifactStore/computerUseArtifacts.ts";
import { researchExhaustionReceiptArtifactId, researchSearchReceiptArtifactId } from "../src/studio/runtime/production/artifactStore/researchArtifacts.ts";
import { BoundedComputerUseHost } from "../src/studio/runtime/production/computerUse/computerUseHost.ts";
import { auditComputerUseSession } from "../src/studio/runtime/production/computerUse/computerUseAudit.ts";
import type { ExternalScreenDriverTrace, ReadOnlyExternalScreenDriver } from "../src/studio/runtime/production/computerUse/driver.ts";
import {
  FixtureExternalScreenDriver,
  fixtureExternalScreenContentId,
  type FixtureExternalScreenState,
} from "../src/studio/runtime/production/computerUse/fixtureDriver.ts";
import {
  COMPUTER_USE_LIMITS,
  type ComputerUseCapabilityGrant,
  type ComputerUseFixtureManifest,
  type ComputerUseGrantView,
  type ComputerUseSurface,
} from "../src/studio/runtime/production/model/computerUse.ts";
import {
  RESEARCH_LIMITS,
  type ResearchExhaustionReceipt,
  type ResearchGapBinding,
  type ResearchSearchReceipt,
} from "../src/studio/runtime/production/model/research.ts";
import {
  researchExhaustionReceiptId,
  researchReceiptId,
  validateResearchExhaustionReceipt,
  validateResearchSearchReceipt,
} from "../src/studio/runtime/production/validation/research.ts";
import {
  computerUseActionReceiptId,
  computerUseSessionReceiptId,
  validateComputerUseSessionReceipt,
} from "../src/studio/runtime/production/validation/computerUse.ts";

const RUN_ID = "runtime:r2-computer-use";
const TASK_ID = "task:r2-producer";
const AGENT_ID = "agent:r2-producer";
const GRANT_ID = "grant:r2-producer";

function gap(): ResearchGapBinding {
  return {
    inputId: "research-request-input:r2",
    triggerId: "research-trigger:r2",
    hypothesis: "The owned-media place reference remains unresolved after bounded R1 research.",
    media: {
      artifactId: "artifact:owned-media",
      contentId: `sha256:${"a".repeat(64)}`,
      trackId: "stream:1",
      startMs: 1_000,
      endMs: 4_000,
    },
  };
}

function fixtureStates(location: { origin: string; entryUrl: string }, screenshot: Buffer): FixtureExternalScreenState[] {
  return [
    {
      stateId: "state:map",
      url: location.entryUrl,
      title: "Fixture map",
      visibleText: "A static fixture map with one declared details transition.",
      viewport: { width: 3, height: 2 },
      screenshotPng: screenshot,
      transitions: { details: "state:details" },
    },
    {
      stateId: "state:details",
      url: `${location.origin}/map/details`,
      title: "Fixture map details",
      visibleText: "Static fixture details for the same external-screen source.",
      viewport: { width: 3, height: 2 },
      screenshotPng: screenshot,
      transitions: {},
    },
  ];
}

function surface(screenshot = rgbPng(3, 2)): ComputerUseSurface {
  const location = { origin: "https://reference.example", entryUrl: "https://reference.example/map" };
  const states = fixtureStates(location, screenshot);
  return {
    surfaceId: "surface:fixture-map",
    ...location,
    source: {
      mode: "offline_fixture",
      fixtureId: "fixture:map-v1",
      fixtureContentId: fixtureExternalScreenContentId({
        fixtureId: "fixture:map-v1",
        surfaceId: "surface:fixture-map",
        ...location,
        states,
        initialStateId: "state:map",
        transitionScript: ["details"],
      }),
    },
  };
}

async function makeStore(t: TestContext): Promise<{ store: ContentAddressedArtifactStore; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "studio-r2-computer-use-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return { store: new ContentAddressedArtifactStore(root), root };
}

async function storeR1Cause(store: ContentAddressedArtifactStore): Promise<ComputerUseCapabilityGrant["computerUseScope"]["r1Cause"]> {
  const authorization = {
    grantId: "grant:r1",
    taskId: "task:r1",
    agentId: "agent:r1",
    executionId: "execution:r1",
    launchClaimId: "launch:r1",
  };
  const operations: ResearchExhaustionReceipt["operations"] = [];
  for (let index = 0; index < RESEARCH_LIMITS.maxQueries; index += 1) {
    const operationId = `operation:r1-empty:${index}`;
    const body: Omit<ResearchSearchReceipt, "receiptId"> = {
      schema: "studio.research-search.receipt.v1",
      operationId,
      runId: RUN_ID,
      capability: "research.investigate",
      authorization,
      gap: gap(),
      provider: { id: "fixture-empty-provider", version: "1" },
      query: `empty fixture query ${index}`,
      results: [],
      limits: structuredClone(RESEARCH_LIMITS),
      allowedDomains: [],
      retrievedAt: "2026-07-18T00:00:00.000Z",
      state: "empty",
      nonClaims: { snippetEvidence: "routing_hint_only", sourceTruth: "not_assessed" },
    };
    const receipt = validateResearchSearchReceipt({ ...body, receiptId: researchReceiptId(body) });
    const stored = await store.storeJson(receipt);
    operations.push({
      operationId,
      receiptId: receipt.receiptId,
      receiptContentId: stored.content.contentId,
      receiptArtifactId: researchSearchReceiptArtifactId(RUN_ID, operationId, stored.content.contentId),
    });
  }
  const body: Omit<ResearchExhaustionReceipt, "receiptId"> = {
    schema: "studio.research-exhaustion.receipt.v1",
    runId: RUN_ID,
    authorization,
    gap: gap(),
    reason: "query_budget_exhausted_without_results",
    operations,
    limits: structuredClone(RESEARCH_LIMITS),
    outcome: "r1_insufficient",
    nonClaims: {
      semanticInsufficiency: "not_assessed",
      sourceTruth: "not_assessed",
      entityMatch: "not_assessed",
      speechEvidenceAuthority: "not_granted",
      claimSupportAuthority: "not_granted",
      captionAuthority: "not_granted",
      r2Authorization: "cause_only",
    },
  };
  const receipt = validateResearchExhaustionReceipt({ ...body, receiptId: researchExhaustionReceiptId(body) });
  const stored = await store.storeJson(receipt);
  return {
    receiptId: receipt.receiptId,
    receiptContentId: stored.content.contentId,
    receiptArtifactId: researchExhaustionReceiptArtifactId(RUN_ID, receipt.receiptId, stored.content.contentId),
    reason: receipt.reason,
  };
}

function fixtureDriver(customSurface?: ComputerUseSurface, screenshot = rgbPng(3, 2)): FixtureExternalScreenDriver {
  const selectedSurface = customSurface ?? surface(screenshot);
  return new FixtureExternalScreenDriver({
    surface: selectedSurface,
    initialStateId: "state:map",
    transitionScript: ["details"],
    states: fixtureStates(selectedSurface, screenshot),
  });
}

async function view(store: ContentAddressedArtifactStore, overrides: Partial<ComputerUseCapabilityGrant["computerUseScope"]> = {}): Promise<ComputerUseGrantView> {
  const r1Cause = await storeR1Cause(store);
  return {
    taskId: TASK_ID,
    agentId: AGENT_ID,
    grants: [{
      id: GRANT_ID,
      capability: "computer.use.readonly",
      computerUseScope: {
        schema: "studio.computer-use-grant.v1",
        limits: structuredClone(COMPUTER_USE_LIMITS),
        gap: gap(),
        r1Cause,
        surface: surface(),
        driver: { id: "fixture-external-screen-driver", version: "1", mode: "offline_fixture" },
        policy: {
          actions: "host_declared_readonly_transitions_only",
          egress: "disabled",
          downloads: "disabled",
          cookies: "disabled",
          credentials: "disabled",
          uploads: "disabled",
          mutations: "disabled",
        },
        ...overrides,
      },
    }],
  };
}

function request(operationId = "operation:r2:1", overrides: Record<string, unknown> = {}): unknown {
  return { operationId, taskId: TASK_ID, agentId: AGENT_ID, grantId: GRANT_ID, ...overrides };
}

class TransformingDriver implements ReadOnlyExternalScreenDriver {
  readonly identity = { id: "fixture-external-screen-driver", version: "1", mode: "offline_fixture" } as const;
  readonly fixtureManifest = fixtureDriver().fixtureManifest;
  calls = 0;
  private readonly transform: (trace: ExternalScreenDriverTrace) => ExternalScreenDriverTrace;

  constructor(transform: (trace: ExternalScreenDriverTrace) => ExternalScreenDriverTrace) {
    this.transform = transform;
  }

  async inspect(input: Parameters<ReadOnlyExternalScreenDriver["inspect"]>[0]): Promise<ExternalScreenDriverTrace> {
    this.calls += 1;
    return this.transform(await fixtureDriver(input.surface).inspect(input));
  }
}

async function tamperStoredObject(root: string, contentId: string, replacement: Buffer | string): Promise<void> {
  const digest = contentId.replace(/^sha256:/, "");
  await writeFile(join(root, "objects", "sha256", digest.slice(0, 2), digest), replacement);
}

test("offline read-only session stores and cold-audits exact screenshot, content, action, cause, and non-claim lineage", async (t) => {
  const { store } = await makeStore(t);
  const host = new BoundedComputerUseHost(RUN_ID, await view(store), store, { driver: fixtureDriver() });
  const produced = await host.inspect(request());

  assert.equal(produced.receipt.capability, "computer.use.readonly");
  assert.equal(produced.receipt.surface.source.mode, "offline_fixture");
  assert.equal(produced.receipt.accounting.egressRequests, 0);
  assert.equal(produced.receipt.accounting.downloads, 0);
  assert.equal(produced.receipt.nonClaims.liveExternalState, "not_observed");
  assert.equal(produced.receipt.nonClaims.evidenceAdmission, "not_granted_until_runtime_wiring");
  assert.equal(produced.states.length, 2);
  assert.equal(produced.actions.length, 1);
  assert.equal(produced.states[0].identity.screenshot.content.contentId, produced.states[1].identity.screenshot.content.contentId);
  assert.notEqual(produced.states[0].identity.screenshot.artifactId, produced.states[1].identity.screenshot.artifactId);
  assert.notEqual(produced.states[0].identity.screenshot.screenshotId, produced.states[1].identity.screenshot.screenshotId);
  assert.deepEqual(await auditComputerUseSession(store, RUN_ID, produced.receiptContentId), produced);
});

test("request shape and injected identities reject ambient URL, action, task, and grant choices before driver execution", async (t) => {
  const { store } = await makeStore(t);
  const driver = new TransformingDriver((trace) => trace);
  const host = new BoundedComputerUseHost(RUN_ID, await view(store), store, { driver });
  await assert.rejects(host.inspect(request("operation:extra", { url: surface().entryUrl })), /url is not allowed/);
  await assert.rejects(host.inspect(request("operation:action", { action: { kind: "click" } })), /action is not allowed/);
  await assert.rejects(host.inspect(request("operation:task", { taskId: "task:other" })), /identities escape/);
  await assert.rejects(host.inspect(request("operation:grant", { grantId: "grant:other" })), /outside the injected producer grant/);
  assert.equal(driver.calls, 0);
});

test("forged cold R1 cause is charged and cannot be retried under another operation id", async (t) => {
  const { store } = await makeStore(t);
  const base = await view(store);
  base.grants[0].computerUseScope.r1Cause.receiptArtifactId = "artifact:forged-r1-cause";
  const driver = new TransformingDriver((trace) => trace);
  const host = new BoundedComputerUseHost(RUN_ID, base, store, { driver });
  await assert.rejects(host.inspect(request("operation:forged-cause")), /changed its cold-audited R1/);
  await assert.rejects(host.inspect(request("operation:retry")), /call budget is exhausted/);
  assert.equal(driver.calls, 0);
});

test("origin escape, generic action, and nonzero egress fail closed without receipts", async (t) => {
  const cases: Array<[string, (trace: ExternalScreenDriverTrace) => ExternalScreenDriverTrace, RegExp]> = [
    ["origin", (trace) => { trace.states[1].url = "https://evil.example/escape"; return trace; }, /escaped the exact granted origin/],
    ["action", (trace) => { (trace.actions[0].action as unknown as { kind: string }).kind = "click"; return trace; }, /not a declared adjacent read-only transition/],
    ["egress", (trace) => { trace.accounting.egressRequests = 1; return trace; }, /egressRequests must remain zero/],
    ["fixture-content", (trace) => { trace.states[1].visibleText = "Different but otherwise valid fixture text."; return trace; }, /drifted from the sealed fixture manifest/],
  ];
  for (const [name, transform, expected] of cases) {
    await t.test(name, async (child) => {
      const { store } = await makeStore(child);
      const host = new BoundedComputerUseHost(RUN_ID, await view(store), store, { driver: new TransformingDriver(transform) });
      await assert.rejects(host.inspect(request(`operation:${name}`)), expected);
    });
  }
});

test("screenshot, trace-count, and visible-content ceilings fail before storage authority", async (t) => {
  const cases: Array<[string, (trace: ExternalScreenDriverTrace) => ExternalScreenDriverTrace, RegExp]> = [
    ["malformed", (trace) => { trace.states[0].screenshotPng = Buffer.from("not-png"); return trace; }, /not an 8-bit RGB PNG/],
    ["dimensions", (trace) => {
      trace.states[0].screenshotPng = rgbPng(COMPUTER_USE_LIMITS.maxScreenshotWidthPx + 1, 1);
      trace.states[0].viewport = { width: COMPUTER_USE_LIMITS.maxScreenshotWidthPx + 1, height: 1 };
      return trace;
    }, /exceeds output dimension limits/],
    ["per-screenshot-bytes", (trace) => {
      trace.states[0].screenshotPng = rgbPng(1_000, 1_000, true);
      trace.states[0].viewport = { width: 1_000, height: 1_000 };
      return trace;
    }, /exceeds the screenshot byte limit/],
    ["aggregate-screenshot-bytes", (trace) => {
      const screenshot = rgbPng(900, 600, true);
      trace.states = Array.from({ length: 6 }, (_, index) => ({
        stateId: `state:aggregate:${index}`,
        ordinal: index,
        surfaceId: surface().surfaceId,
        origin: surface().origin,
        url: index === 0 ? surface().entryUrl : `${surface().origin}/map/state-${index}`,
        title: `Aggregate state ${index}`,
        visibleText: `Visible aggregate state ${index}.`,
        declaredTransitionIds: index < 5 ? [`next-${index}`] : [],
        viewport: { width: 900, height: 600 },
        screenshotPng: screenshot,
      }));
      trace.actions = Array.from({ length: 5 }, (_, index) => ({
        index,
        beforeStateId: trace.states[index].stateId,
        action: { kind: "follow_readonly_transition", transitionId: `next-${index}` },
        afterStateId: trace.states[index + 1].stateId,
        result: "visible_state_changed",
      }));
      trace.stopReason = "fixture_complete";
      return trace;
    }, /aggregate screenshot byte limit/],
    ["trace-counts", (trace) => {
      trace.states = Array.from({ length: COMPUTER_USE_LIMITS.maxSteps + 1 }, (_, index) => ({
        ...trace.states[0],
        stateId: `state:overflow:${index}`,
        ordinal: index,
      }));
      trace.actions = Array.from({ length: COMPUTER_USE_LIMITS.maxSteps }, (_, index) => ({
        index,
        beforeStateId: trace.states[index].stateId,
        action: { kind: "follow_readonly_transition", transitionId: "details" },
        afterStateId: trace.states[index + 1].stateId,
        result: "visible_state_changed",
      }));
      return trace;
    }, /escapes its step, action, or screenshot limits/],
    ["visible-text", (trace) => {
      trace.states[0].visibleText = "x".repeat(COMPUTER_USE_LIMITS.maxVisibleTextBytes + 1);
      return trace;
    }, /visible-text limit/],
  ];
  for (const [name, transform, expected] of cases) {
    await t.test(name, async (child) => {
      const { store } = await makeStore(child);
      const host = new BoundedComputerUseHost(RUN_ID, await view(store), store, { driver: new TransformingDriver(transform) });
      await assert.rejects(host.inspect(request(`operation:png:${name}`)), expected);
    });
  }
});

test("fixed limits and driver identity cannot be widened by an injected producer grant", async (t) => {
  const { store } = await makeStore(t);
  const widened = await view(store);
  widened.grants[0].computerUseScope.limits.maxEgressRequests = 1;
  const host = new BoundedComputerUseHost(RUN_ID, widened, store, { driver: fixtureDriver() });
  await assert.rejects(host.inspect(request("operation:widened")), /must equal the registered R2 producer limit 0/);

  const other = await view(store);
  other.grants[0].computerUseScope.driver.id = "ambient-browser";
  const drifted = new BoundedComputerUseHost(RUN_ID, other, store, { driver: fixtureDriver() });
  await assert.rejects(drifted.inspect(request("operation:driver-drift")), /driver identity differs/);

  const changedFixture = surface();
  changedFixture.source.fixtureContentId = `sha256:${"0".repeat(64)}`;
  assert.throws(() => fixtureDriver(changedFixture), /does not match its sealed fixture content identity/);
});

test("wall timeout is enforced and the timed-out attempt remains charged", async (t) => {
  const { store } = await makeStore(t);
  const driver: ReadOnlyExternalScreenDriver = {
    identity: { id: "fixture-external-screen-driver", version: "1", mode: "offline_fixture" },
    fixtureManifest: fixtureDriver().fixtureManifest,
    inspect: () => new Promise<ExternalScreenDriverTrace>(() => undefined),
  };
  const host = new BoundedComputerUseHost(RUN_ID, await view(store), store, { driver, maximumWallMs: 10 });
  await assert.rejects(host.inspect(request("operation:timeout")), /exhausted its wall-time grant/);
  await assert.rejects(host.inspect(request("operation:timeout-retry")), /call budget is exhausted/);
});

test("cold audit detects screenshot, content, action, and session tamper plus cross-run replay", async (t) => {
  const lanes: Array<[string, (root: string, produced: Awaited<ReturnType<BoundedComputerUseHost["inspect"]>>) => Promise<void>]> = [
    ["fixture", (root, produced) => tamperStoredObject(root, produced.receipt.fixture.content.contentId, "{\"forged\":true}\n")],
    ["screenshot", (root, produced) => tamperStoredObject(root, produced.states[0].identity.screenshot.content.contentId, "forged screenshot")],
    ["content", (root, produced) => tamperStoredObject(root, produced.states[0].identity.visibleContent.content.contentId, "{\"forged\":true}\n")],
    ["action", (root, produced) => tamperStoredObject(root, produced.actions[0].identity.content.contentId, "{\"forged\":true}\n")],
    ["session", (root, produced) => tamperStoredObject(root, produced.receiptContentId, "{\"forged\":true}\n")],
  ];
  for (const [name, mutate] of lanes) {
    await t.test(name, async (child) => {
      const { store, root } = await makeStore(child);
      const produced = await new BoundedComputerUseHost(RUN_ID, await view(store), store, { driver: fixtureDriver() }).inspect(request(`operation:tamper:${name}`));
      await mutate(root, produced);
      await assert.rejects(auditComputerUseSession(store, RUN_ID, produced.receiptContentId));
    });
  }
  const { store } = await makeStore(t);
  const produced = await new BoundedComputerUseHost(RUN_ID, await view(store), store, { driver: fixtureDriver() }).inspect(request("operation:cross-run"));
  await assert.rejects(auditComputerUseSession(store, "runtime:other", produced.receiptContentId), /belongs to another run/);
});

test("session receipt cannot upgrade fixture activity into live state or evidence authority", async (t) => {
  const { store } = await makeStore(t);
  const produced = await new BoundedComputerUseHost(RUN_ID, await view(store), store, { driver: fixtureDriver() }).inspect(request("operation:nonclaims"));
  const live = structuredClone(produced.receipt) as unknown as { nonClaims: { liveExternalState: string } };
  live.nonClaims.liveExternalState = "observed";
  assert.throws(() => validateComputerUseSessionReceipt(live), /must equal not_observed/);
  const authority = structuredClone(produced.receipt) as unknown as { nonClaims: { claimSupportAuthority: string } };
  authority.nonClaims.claimSupportAuthority = "granted";
  assert.throws(() => validateComputerUseSessionReceipt(authority), /must equal not_granted/);
  assert.equal(canonicalJsonContentId(produced.receipt), produced.receiptContentId);
});

test("session id re-addressing and action cumulative-byte forgery fail cold audit", async (t) => {
  const { store } = await makeStore(t);
  const produced = await new BoundedComputerUseHost(RUN_ID, await view(store), store, { driver: fixtureDriver() }).inspect(request("operation:readdress"));

  const readdressed = structuredClone(produced.receipt);
  readdressed.sessionId = "computer-use-session:forged";
  const { receiptId: _oldSessionId, ...readdressedBody } = readdressed;
  readdressed.receiptId = computerUseSessionReceiptId(readdressedBody);
  assert.throws(() => validateComputerUseSessionReceipt(readdressed), /does not close run, operation, and grant identity/);
  const storedReaddressed = await store.storeJson(readdressed);
  await assert.rejects(auditComputerUseSession(store, RUN_ID, storedReaddressed.content.contentId), /does not close run, operation, and grant identity/);

  const forgedAction = structuredClone(produced.actions[0].receipt);
  forgedAction.cumulativeAccounting.totalScreenshotBytes += 1;
  forgedAction.cumulativeAccounting.visibleContentBytes += 1;
  const { receiptId: _oldActionId, ...forgedActionBody } = forgedAction;
  forgedAction.receiptId = computerUseActionReceiptId(forgedActionBody);
  const storedAction = await store.storeJson(forgedAction);
  const forgedSession = structuredClone(produced.receipt);
  forgedSession.actions[0] = {
    actionId: forgedAction.actionId,
    receiptId: forgedAction.receiptId,
    artifactId: computerUseActionArtifactId(RUN_ID, forgedSession.sessionId, 0, storedAction.content.contentId),
    content: storedAction.content,
  };
  const { receiptId: _oldReceiptId, ...forgedSessionBody } = forgedSession;
  forgedSession.receiptId = computerUseSessionReceiptId(forgedSessionBody);
  const storedSession = await store.storeJson(forgedSession);
  await assert.rejects(auditComputerUseSession(store, RUN_ID, storedSession.content.contentId), /changed ordered state lineage/);

  const forgedStop = structuredClone(produced.receipt);
  forgedStop.stopReason = "action_limit_reached";
  const { receiptId: _oldStopReceiptId, ...forgedStopBody } = forgedStop;
  forgedStop.receiptId = computerUseSessionReceiptId(forgedStopBody);
  const storedStop = await store.storeJson(forgedStop);
  await assert.rejects(auditComputerUseSession(store, RUN_ID, storedStop.content.contentId), /accounting changed its stored output set/);
});

class ObservedArtifactStore extends ContentAddressedArtifactStore {
  jsonWrites = 0;
  delayMs = 0;

  override async storeJson(value: unknown): Promise<Awaited<ReturnType<ContentAddressedArtifactStore["storeJson"]>>> {
    this.jsonWrites += 1;
    if (this.delayMs > 0) await delay(this.delayMs);
    return super.storeJson(value);
  }
}

test("oversized fixture JSON is rejected before CAS persistence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "studio-r2-computer-use-observed-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new ObservedArtifactStore(root);
  const baseSurface = surface();
  const oversizedManifest: ComputerUseFixtureManifest = {
    schema: "studio.external-screen-fixture.v1",
    fixtureId: baseSurface.source.fixtureId,
    surfaceId: baseSurface.surfaceId,
    origin: baseSurface.origin,
    entryUrl: baseSurface.entryUrl,
    initialStateId: "state:oversized:0",
    transitionScript: [],
    states: Array.from({ length: COMPUTER_USE_LIMITS.maxSteps }, (_, index) => ({
      stateId: `state:oversized:${index}`,
      url: index === 0 ? baseSurface.entryUrl : `${baseSurface.origin}/oversized/${index}`,
      title: `Oversized manifest state ${index}`,
      visibleText: "x".repeat(COMPUTER_USE_LIMITS.maxVisibleTextBytes),
      viewport: { width: 3, height: 2 },
      screenshotContentId: `sha256:${"a".repeat(64)}`,
      transitions: [],
    })),
  };
  baseSurface.source.fixtureContentId = canonicalJsonContentId(oversizedManifest);
  const scopedView = await view(store, { surface: baseSurface });
  store.jsonWrites = 0;
  let calls = 0;
  const driver: ReadOnlyExternalScreenDriver = {
    identity: { id: "fixture-external-screen-driver", version: "1", mode: "offline_fixture" },
    fixtureManifest: oversizedManifest,
    inspect: async () => { calls += 1; return fixtureDriver().inspect({
      sessionId: "unused",
      surface: surface(),
      limits: structuredClone(COMPUTER_USE_LIMITS),
      deadlineAtMs: Number.MAX_SAFE_INTEGER,
    }); },
  };
  const host = new BoundedComputerUseHost(RUN_ID, scopedView, store, { driver });
  await assert.rejects(host.inspect(request("operation:oversized-manifest")), /fixture manifest changed its sealed surface identity or byte limit/);
  assert.equal(store.jsonWrites, 0);
  assert.equal(calls, 0);
});

test("one effective wall deadline covers storage and keeps a delayed write failure charged", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "studio-r2-computer-use-delayed-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new ObservedArtifactStore(root);
  const scopedView = await view(store);
  store.delayMs = 30;
  const host = new BoundedComputerUseHost(RUN_ID, scopedView, store, { driver: fixtureDriver(), maximumWallMs: 10 });
  await assert.rejects(host.inspect(request("operation:storage-timeout")), /exhausted its wall-time grant/);
  await assert.rejects(host.inspect(request("operation:storage-timeout-retry")), /call budget is exhausted/);
});

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function rgbPng(width: number, height: number, noisy = false): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  let state = 0x12345678;
  for (let row = 0; row < height; row += 1) {
    const offset = row * (1 + width * 3);
    raw[offset] = 0;
    for (let byte = 1; byte < 1 + width * 3; byte += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      raw[offset + byte] = noisy ? state >>> 24 : 0;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: noisy ? 0 : 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
