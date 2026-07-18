import { canonicalSha256 } from "../canonicalIdentity.ts";

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
