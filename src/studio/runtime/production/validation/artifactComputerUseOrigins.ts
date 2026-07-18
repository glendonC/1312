import type { ArtifactOriginValidationInput } from "./artifactOrigin.ts";
import { exact, fail, integer, string, uniqueStrings } from "./primitives.ts";

function privateExternalScreen(input: ArtifactOriginValidationInput, expectedKind: string, mediaClass: "non_media" | "derived"): void {
  const { item, task, agent, context, path } = input;
  if (item.kind !== expectedKind || input.mediaClass !== mediaClass || item.publication !== "private" ||
      task === null || agent === null || item.durationMs !== null || (item.tracks as unknown[]).length !== 0) {
    fail(context, path, `${expectedKind} must be one private task-owned external-screen artifact`);
  }
}

export function validateComputerUseArtifactOrigin(kind: string, input: ArtifactOriginValidationInput): boolean {
  const { origin, sources, context, path } = input;
  if (kind === "external_screen_fixture") {
    exact(origin, ["kind", "operationId", "sessionId", "r1CauseArtifactId", "mediaSourceArtifactId"], context, `${path}.origin`);
    for (const key of ["operationId", "sessionId", "r1CauseArtifactId", "mediaSourceArtifactId"]) string(origin[key], context, `${path}.origin.${key}`);
    if (sources.length !== 2) fail(context, `${path}.sourceArtifactIds`, "fixture must bind media source and R1 cause");
    privateExternalScreen(input, "studio.external-screen-fixture.v1", "non_media");
    return true;
  }
  if (kind === "external_screen_screenshot") {
    exact(origin, ["kind", "operationId", "sessionId", "stateId", "ordinal", "screenshotId", "fixtureArtifactId"], context, `${path}.origin`);
    for (const key of ["operationId", "sessionId", "stateId", "screenshotId", "fixtureArtifactId"]) string(origin[key], context, `${path}.origin.${key}`);
    integer(origin.ordinal, context, `${path}.origin.ordinal`);
    if (sources.length !== 1) fail(context, `${path}.sourceArtifactIds`, "screenshot must bind its fixture");
    privateExternalScreen(input, "studio.external-screen-screenshot.v1", "derived");
    return true;
  }
  if (kind === "external_screen_content") {
    exact(origin, ["kind", "operationId", "sessionId", "stateId", "ordinal", "fixtureArtifactId", "screenshotArtifactId"], context, `${path}.origin`);
    for (const key of ["operationId", "sessionId", "stateId", "fixtureArtifactId", "screenshotArtifactId"]) string(origin[key], context, `${path}.origin.${key}`);
    integer(origin.ordinal, context, `${path}.origin.ordinal`);
    if (sources.length !== 2) fail(context, `${path}.sourceArtifactIds`, "visible content must bind fixture and screenshot");
    privateExternalScreen(input, "studio.external-screen-content.v1", "non_media");
    return true;
  }
  if (kind === "external_screen_action_receipt") {
    exact(origin, ["kind", "operationId", "sessionId", "actionId", "index", "beforeScreenshotArtifactId", "beforeContentArtifactId", "afterScreenshotArtifactId", "afterContentArtifactId"], context, `${path}.origin`);
    for (const key of ["operationId", "sessionId", "actionId", "beforeScreenshotArtifactId", "beforeContentArtifactId", "afterScreenshotArtifactId", "afterContentArtifactId"]) string(origin[key], context, `${path}.origin.${key}`);
    integer(origin.index, context, `${path}.origin.index`);
    if (sources.length !== 4) fail(context, `${path}.sourceArtifactIds`, "action must bind its adjacent state artifacts");
    privateExternalScreen(input, "studio.external-screen-action.receipt.v1", "non_media");
    return true;
  }
  if (kind === "external_screen_session_receipt") {
    exact(origin, ["kind", "operationId", "sessionId", "receiptId", "mediaSourceArtifactId", "r1CauseArtifactId", "fixtureArtifactId", "screenshotArtifactIds", "visibleContentArtifactIds", "actionArtifactIds"], context, `${path}.origin`);
    for (const key of ["operationId", "sessionId", "receiptId", "mediaSourceArtifactId", "r1CauseArtifactId", "fixtureArtifactId"]) string(origin[key], context, `${path}.origin.${key}`);
    const screenshots = uniqueStrings(origin.screenshotArtifactIds, context, `${path}.origin.screenshotArtifactIds`);
    const content = uniqueStrings(origin.visibleContentArtifactIds, context, `${path}.origin.visibleContentArtifactIds`);
    uniqueStrings(origin.actionArtifactIds, context, `${path}.origin.actionArtifactIds`);
    if (screenshots.length === 0 || screenshots.length !== content.length || sources.length < 5) {
      fail(context, `${path}.origin`, "session must bind one ordered external-screen artifact set");
    }
    privateExternalScreen(input, "studio.external-screen-session.receipt.v1", "non_media");
    return true;
  }
  return false;
}
