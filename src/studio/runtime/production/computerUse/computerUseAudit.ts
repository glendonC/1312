import { createHash } from "node:crypto";

import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import { canonicalJson, canonicalJsonContentId } from "../artifactStore/contentIdentity.ts";
import {
  computerUseActionArtifactId,
  computerUseContentArtifactId,
  computerUseFixtureArtifactId,
  computerUseScreenshotArtifactId,
  computerUseScreenshotId,
  computerUseSessionArtifactId,
} from "../artifactStore/computerUseArtifacts.ts";
import { inspectBoundedRgbPng } from "../frames/png.ts";
import type {
  ComputerUseActionReceipt,
  ComputerUseFixtureManifest,
  ComputerUseSessionReceipt,
  ComputerUseVisibleContentSnapshot,
} from "../model/computerUse.ts";
import { auditResearchExhaustion } from "../research/researchAudit.ts";
import {
  validateComputerUseActionReceipt,
  validateComputerUseFixtureManifest,
  validateComputerUseSessionReceipt,
  validateComputerUseVisibleContentSnapshot,
} from "../validation/computerUse.ts";

export interface VerifiedComputerUseState {
  identity: ComputerUseSessionReceipt["states"][number];
  screenshotBytes: Buffer;
  visibleContent: ComputerUseVisibleContentSnapshot;
}

export interface VerifiedComputerUseAction {
  identity: ComputerUseSessionReceipt["actions"][number];
  receipt: ComputerUseActionReceipt;
}

export interface VerifiedComputerUseSession {
  receipt: ComputerUseSessionReceipt;
  receiptContentId: string;
  receiptArtifactId: string;
  fixtureManifest: ComputerUseFixtureManifest;
  states: VerifiedComputerUseState[];
  actions: VerifiedComputerUseAction[];
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function bytesContentId(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function storedCanonicalJson<T>(
  artifacts: ContentAddressedArtifactStore,
  expectedContentId: string,
  expectedBytes: number | null,
  maximumBytes: number,
  label: string,
  validate: (value: unknown) => T,
): Promise<T> {
  const bytes = await artifacts.receiptBytes(expectedContentId);
  if (bytes.length <= 0 || bytes.length > maximumBytes || (expectedBytes !== null && bytes.length !== expectedBytes)) {
    throw new Error(`${label} escapes its stored byte contract`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  const value = validate(parsed);
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8")) || canonicalJsonContentId(value) !== expectedContentId) {
    throw new Error(`${label} is not canonical content for its address`);
  }
  return value;
}

/**
 * Cold audit from content addresses alone. No driver is rerun and no projected metadata is
 * trusted: the R1 cause, session, every screenshot, content snapshot, and action receipt reopen.
 */
export async function auditComputerUseSession(
  artifacts: ContentAddressedArtifactStore,
  runId: string,
  receiptContentId: string,
): Promise<VerifiedComputerUseSession> {
  const receipt = await storedCanonicalJson(
    artifacts,
    receiptContentId,
    null,
    512 * 1024,
    "Stored computer-use session receipt",
    (value) => validateComputerUseSessionReceipt(value),
  );
  if (receipt.runId !== runId) throw new Error("Computer-use session receipt belongs to another run");
  const receiptArtifactId = computerUseSessionArtifactId(runId, receipt.sessionId, receiptContentId);
  const cause = await auditResearchExhaustion(artifacts, runId, receipt.r1Cause.receiptContentId);
  if (
    cause.receiptArtifactId !== receipt.r1Cause.receiptArtifactId || cause.receipt.receiptId !== receipt.r1Cause.receiptId ||
    cause.receipt.reason !== receipt.r1Cause.reason || !same(cause.receipt.gap, receipt.gap)
  ) throw new Error("Computer-use receipt changed its cold-audited R1 cause or exact gap");
  const fixtureManifest = await storedCanonicalJson(
    artifacts,
    receipt.fixture.content.contentId,
    receipt.fixture.content.bytes,
    receipt.limits.maxFixtureManifestBytes,
    "Stored computer-use fixture manifest",
    (value) => validateComputerUseFixtureManifest(value),
  );
  if (
    receipt.fixture.artifactId !== computerUseFixtureArtifactId(runId, receipt.sessionId, receipt.fixture.content.contentId) ||
    receipt.fixture.content.contentId !== receipt.surface.source.fixtureContentId ||
    fixtureManifest.fixtureId !== receipt.surface.source.fixtureId ||
    fixtureManifest.surfaceId !== receipt.surface.surfaceId || fixtureManifest.origin !== receipt.surface.origin ||
    fixtureManifest.entryUrl !== receipt.surface.entryUrl
  ) throw new Error("Computer-use fixture manifest changed its sealed surface lineage");
  const manifestStates = new Map(fixtureManifest.states.map((state) => [state.stateId, state]));

  const states: VerifiedComputerUseState[] = [];
  for (const [index, identity] of receipt.states.entries()) {
    const screenshotBytes = await artifacts.receiptBytes(identity.screenshot.content.contentId);
    if (
      screenshotBytes.length !== identity.screenshot.content.bytes ||
      bytesContentId(screenshotBytes) !== identity.screenshot.content.contentId ||
      screenshotBytes.length > receipt.limits.maxScreenshotBytes
    ) throw new Error(`Computer-use screenshot ${index} failed content verification`);
    const dimensions = inspectBoundedRgbPng(screenshotBytes, {
      maxWidthPx: receipt.limits.maxScreenshotWidthPx,
      maxHeightPx: receipt.limits.maxScreenshotHeightPx,
      maxPixels: receipt.limits.maxScreenshotPixels,
    });
    if (dimensions.width !== identity.screenshot.width || dimensions.height !== identity.screenshot.height) {
      throw new Error(`Computer-use screenshot ${index} changed dimensions`);
    }
    if (
      identity.screenshot.screenshotId !== computerUseScreenshotId({
        runId,
        sessionId: receipt.sessionId,
        stateId: identity.stateId,
        ordinal: index,
        contentId: identity.screenshot.content.contentId,
      }) ||
      identity.screenshot.artifactId !== computerUseScreenshotArtifactId(runId, receipt.sessionId, index, identity.screenshot.content.contentId)
    ) throw new Error(`Computer-use screenshot ${index} changed contextual identity`);
    const visibleContent = await storedCanonicalJson(
      artifacts,
      identity.visibleContent.content.contentId,
      identity.visibleContent.content.bytes,
      receipt.limits.maxVisibleContentBytes,
      `Stored computer-use visible content ${index}`,
      (value) => validateComputerUseVisibleContentSnapshot(value),
    );
    const manifestState = manifestStates.get(identity.stateId);
    if (
      !manifestState || (index === 0 && identity.stateId !== fixtureManifest.initialStateId) ||
      identity.visibleContent.artifactId !== computerUseContentArtifactId(runId, receipt.sessionId, index, identity.visibleContent.content.contentId) ||
      visibleContent.operationId !== receipt.operationId || visibleContent.sessionId !== receipt.sessionId ||
      visibleContent.stateId !== identity.stateId || visibleContent.ordinal !== index ||
      visibleContent.surfaceId !== receipt.surface.surfaceId || visibleContent.origin !== receipt.surface.origin ||
      (index === 0 && visibleContent.url !== receipt.surface.entryUrl) ||
      visibleContent.viewport.width !== identity.screenshot.width || visibleContent.viewport.height !== identity.screenshot.height ||
      visibleContent.screenshot.screenshotId !== identity.screenshot.screenshotId ||
      visibleContent.screenshot.artifactId !== identity.screenshot.artifactId ||
      visibleContent.screenshot.contentId !== identity.screenshot.content.contentId ||
      visibleContent.url !== manifestState.url || visibleContent.title !== manifestState.title ||
      visibleContent.visibleText !== manifestState.visibleText || !same(visibleContent.viewport, manifestState.viewport) ||
      identity.screenshot.content.contentId !== manifestState.screenshotContentId ||
      !same(visibleContent.declaredTransitionIds, manifestState.transitions.map((transition) => transition.transitionId))
    ) throw new Error(`Computer-use visible content ${index} changed screenshot or surface lineage`);
    states.push({ identity, screenshotBytes, visibleContent });
  }

  const actions: VerifiedComputerUseAction[] = [];
  for (const [index, identity] of receipt.actions.entries()) {
    const actionReceipt = await storedCanonicalJson(
      artifacts,
      identity.content.contentId,
      identity.content.bytes,
      receipt.limits.maxActionReceiptBytes,
      `Stored computer-use action receipt ${index}`,
      (value) => validateComputerUseActionReceipt(value),
    );
    if (
      identity.artifactId !== computerUseActionArtifactId(runId, receipt.sessionId, index, identity.content.contentId) ||
      identity.actionId !== actionReceipt.actionId || identity.receiptId !== actionReceipt.receiptId ||
      actionReceipt.operationId !== receipt.operationId || actionReceipt.sessionId !== receipt.sessionId || actionReceipt.index !== index ||
      !same(actionReceipt.before, receipt.states[index]) || !same(actionReceipt.after, receipt.states[index + 1]) ||
      !same(actionReceipt.driver, receipt.driver) ||
      !states[index].visibleContent.declaredTransitionIds.includes(actionReceipt.action.transitionId) ||
      actionReceipt.action.transitionId !== fixtureManifest.transitionScript[index] ||
      manifestStates.get(actionReceipt.before.stateId)?.transitions.find(
        (transition) => transition.transitionId === actionReceipt.action.transitionId,
      )?.nextStateId !== actionReceipt.after.stateId ||
      actionReceipt.cumulativeAccounting.totalScreenshotBytes !== receipt.states
        .slice(0, index + 2).reduce((sum, state) => sum + state.screenshot.content.bytes, 0) ||
      actionReceipt.cumulativeAccounting.visibleContentBytes !== receipt.states
        .slice(0, index + 2).reduce((sum, state) => sum + state.visibleContent.content.bytes, 0)
    ) throw new Error(`Computer-use action receipt ${index} changed ordered state lineage`);
    actions.push({ identity, receipt: actionReceipt });
  }
  const visibleContentBytes = states.reduce((sum, state) => sum + state.identity.visibleContent.content.bytes, 0);
  const screenshotBytes = states.reduce((sum, state) => sum + state.identity.screenshot.content.bytes, 0);
  if (
    visibleContentBytes !== receipt.accounting.visibleContentBytes || screenshotBytes !== receipt.accounting.totalScreenshotBytes ||
    actions.length !== states.length - 1 ||
    (receipt.stopReason === "fixture_complete" && (
      fixtureManifest.transitionScript.length === 0 || actions.length !== fixtureManifest.transitionScript.length
    )) ||
    (receipt.stopReason === "no_readonly_transition" && fixtureManifest.transitionScript.length !== 0) ||
    (receipt.stopReason === "action_limit_reached" && (
      actions.length >= fixtureManifest.transitionScript.length ||
      (actions.length < receipt.limits.maxActions && states.length < receipt.limits.maxSteps)
    ))
  ) throw new Error("Computer-use session accounting changed its stored output set");
  return { receipt, receiptContentId, receiptArtifactId, fixtureManifest, states, actions };
}
