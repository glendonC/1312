import { canonicalSha256 } from "../canonicalIdentity.ts";
import type { VerifiedComputerUseSession } from "../computerUse/computerUseAudit.ts";
import type { RuntimeArtifact } from "../model/artifacts.ts";
import type { ContentIdentity } from "../model/source.ts";

function computerUseArtifactId(input: {
  runId: string;
  sessionId: string;
  ordinal: number | null;
  kind: string;
  contentId: string;
}): string {
  return `artifact:${canonicalSha256(input)}`;
}

export function computerUseFixtureArtifactId(runId: string, sessionId: string, contentId: string): string {
  return computerUseArtifactId({
    runId,
    sessionId,
    ordinal: null,
    kind: "studio.external-screen-fixture.v1",
    contentId,
  });
}

export function computerUseScreenshotId(input: {
  runId: string;
  sessionId: string;
  stateId: string;
  ordinal: number;
  contentId: string;
}): string {
  return `external-screen-screenshot:${canonicalSha256(input)}`;
}

export function computerUseScreenshotArtifactId(
  runId: string,
  sessionId: string,
  ordinal: number,
  contentId: string,
): string {
  return computerUseArtifactId({
    runId,
    sessionId,
    ordinal,
    kind: "studio.external-screen-screenshot.v1",
    contentId,
  });
}

export function computerUseContentArtifactId(
  runId: string,
  sessionId: string,
  ordinal: number,
  contentId: string,
): string {
  return computerUseArtifactId({
    runId,
    sessionId,
    ordinal,
    kind: "studio.external-screen-content.v1",
    contentId,
  });
}

export function computerUseActionArtifactId(
  runId: string,
  sessionId: string,
  ordinal: number,
  contentId: string,
): string {
  return computerUseArtifactId({
    runId,
    sessionId,
    ordinal,
    kind: "studio.external-screen-action.receipt.v1",
    contentId,
  });
}

export function computerUseSessionArtifactId(
  runId: string,
  sessionId: string,
  contentId: string,
): string {
  return computerUseArtifactId({
    runId,
    sessionId,
    ordinal: null,
    kind: "studio.external-screen-session.receipt.v1",
    contentId,
  });
}

function storageKey(contentId: string): string {
  const digest = contentId.replace(/^sha256:/, "");
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`;
}

function artifact(input: {
  id: string;
  runId: string;
  kind: string;
  content: ContentIdentity;
  sourceArtifactIds: string[];
  taskId: string;
  agentId: string;
  origin: RuntimeArtifact["origin"];
  mediaClass?: RuntimeArtifact["mediaClass"];
}): RuntimeArtifact {
  return {
    schema: "studio.runtime.artifact.v1",
    id: input.id,
    runId: input.runId,
    kind: input.kind,
    mediaClass: input.mediaClass ?? "non_media",
    publication: "private",
    content: structuredClone(input.content),
    storageKey: storageKey(input.content.contentId),
    durationMs: null,
    tracks: [],
    sourceArtifactIds: [...input.sourceArtifactIds],
    producerTaskId: input.taskId,
    producerAgentId: input.agentId,
    origin: structuredClone(input.origin),
  };
}

/** Builds the exact ordered runtime artifact set for one already cold-audited S1 session. */
export function buildComputerUseRuntimeArtifacts(input: {
  runId: string;
  taskId: string;
  agentId: string;
  mediaSourceArtifactId: string;
  r1CauseArtifactId: string;
  verified: VerifiedComputerUseSession;
  sessionContent: ContentIdentity;
}): {
  artifacts: RuntimeArtifact[];
  fixtureArtifactId: string;
  screenshotArtifactIds: string[];
  visibleContentArtifactIds: string[];
  actionArtifactIds: string[];
  sessionArtifactId: string;
} {
  const { receipt } = input.verified;
  const fixtureArtifactId = receipt.fixture.artifactId;
  const artifacts: RuntimeArtifact[] = [artifact({
    id: fixtureArtifactId,
    runId: input.runId,
    kind: "studio.external-screen-fixture.v1",
    content: receipt.fixture.content,
    sourceArtifactIds: [input.mediaSourceArtifactId, input.r1CauseArtifactId],
    taskId: input.taskId,
    agentId: input.agentId,
    origin: {
      kind: "external_screen_fixture",
      operationId: receipt.operationId,
      sessionId: receipt.sessionId,
      r1CauseArtifactId: input.r1CauseArtifactId,
      mediaSourceArtifactId: input.mediaSourceArtifactId,
    },
  })];
  const screenshotArtifactIds: string[] = [];
  const visibleContentArtifactIds: string[] = [];
  for (const state of receipt.states) {
    screenshotArtifactIds.push(state.screenshot.artifactId);
    visibleContentArtifactIds.push(state.visibleContent.artifactId);
    artifacts.push(artifact({
      id: state.screenshot.artifactId,
      runId: input.runId,
      kind: "studio.external-screen-screenshot.v1",
      mediaClass: "derived",
      content: state.screenshot.content,
      sourceArtifactIds: [fixtureArtifactId],
      taskId: input.taskId,
      agentId: input.agentId,
      origin: {
        kind: "external_screen_screenshot",
        operationId: receipt.operationId,
        sessionId: receipt.sessionId,
        stateId: state.stateId,
        ordinal: state.ordinal,
        screenshotId: state.screenshot.screenshotId,
        fixtureArtifactId,
      },
    }));
    artifacts.push(artifact({
      id: state.visibleContent.artifactId,
      runId: input.runId,
      kind: "studio.external-screen-content.v1",
      content: state.visibleContent.content,
      sourceArtifactIds: [fixtureArtifactId, state.screenshot.artifactId],
      taskId: input.taskId,
      agentId: input.agentId,
      origin: {
        kind: "external_screen_content",
        operationId: receipt.operationId,
        sessionId: receipt.sessionId,
        stateId: state.stateId,
        ordinal: state.ordinal,
        fixtureArtifactId,
        screenshotArtifactId: state.screenshot.artifactId,
      },
    }));
  }
  const actionArtifactIds: string[] = [];
  for (const [index, action] of receipt.actions.entries()) {
    const before = receipt.states[index];
    const after = receipt.states[index + 1];
    actionArtifactIds.push(action.artifactId);
    artifacts.push(artifact({
      id: action.artifactId,
      runId: input.runId,
      kind: "studio.external-screen-action.receipt.v1",
      content: action.content,
      sourceArtifactIds: [
        before.screenshot.artifactId,
        before.visibleContent.artifactId,
        after.screenshot.artifactId,
        after.visibleContent.artifactId,
      ],
      taskId: input.taskId,
      agentId: input.agentId,
      origin: {
        kind: "external_screen_action_receipt",
        operationId: receipt.operationId,
        sessionId: receipt.sessionId,
        actionId: action.actionId,
        index,
        beforeScreenshotArtifactId: before.screenshot.artifactId,
        beforeContentArtifactId: before.visibleContent.artifactId,
        afterScreenshotArtifactId: after.screenshot.artifactId,
        afterContentArtifactId: after.visibleContent.artifactId,
      },
    }));
  }
  const sessionArtifactId = input.verified.receiptArtifactId;
  artifacts.push(artifact({
    id: sessionArtifactId,
    runId: input.runId,
    kind: "studio.external-screen-session.receipt.v1",
    content: input.sessionContent,
    sourceArtifactIds: [
      input.mediaSourceArtifactId,
      input.r1CauseArtifactId,
      fixtureArtifactId,
      ...receipt.states.flatMap((state) => [state.screenshot.artifactId, state.visibleContent.artifactId]),
      ...actionArtifactIds,
    ],
    taskId: input.taskId,
    agentId: input.agentId,
    origin: {
      kind: "external_screen_session_receipt",
      operationId: receipt.operationId,
      sessionId: receipt.sessionId,
      receiptId: receipt.receiptId,
      mediaSourceArtifactId: input.mediaSourceArtifactId,
      r1CauseArtifactId: input.r1CauseArtifactId,
      fixtureArtifactId,
      screenshotArtifactIds,
      visibleContentArtifactIds,
      actionArtifactIds,
    },
  }));
  return { artifacts, fixtureArtifactId, screenshotArtifactIds, visibleContentArtifactIds, actionArtifactIds, sessionArtifactId };
}
