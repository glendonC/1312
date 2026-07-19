import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { LocalRuntimeHostClient } from "../../src/studio/localRuntime/client/LocalRuntimeHostClient.ts";

const OWNED_ENABLED = process.env.STUDIO_LM04_PROOF === "1";
const YOUTUBE_ENABLED = process.env.STUDIO_LM04_YOUTUBE_PROOF === "1";
const EXPECTED_OWNED_CONTENT_ID = "sha256:125bfac33926fdafeb63ff8b99f241c339bfb60c68fcc2bef65b260535bcbb1b";

type SourceKind = "owned_local" | "youtube_local";

interface MediaOperationEvidence {
  operationId: string;
  status: string;
  capability: string;
  grant: string;
  requestedRange: string;
  receipt: string;
  output: string;
}

interface SharedProofInput {
  page: Page;
  runtime: Locator;
  sourceKind: SourceKind;
  sourceLabel: string;
  sourceSessionId: string;
  sourceRevisionId: string;
  sourceContentId: string;
  sourceRegistration: string;
  sourceLanguage: string;
  expectedDurationSeconds: number;
  selectedEndSeconds?: string | null;
  evidencePath: string;
  screenshotPath: string;
  allowOneLearningRetry?: boolean;
  extraEvidence?: Record<string, unknown>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the guarded LM-04 proof`);
  return value;
}

function requiredSeconds(name: string): number {
  const raw = requiredEnvironment(name);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number of seconds`);
  return value;
}

function contentId(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function connectLocalSource(
  page: Page,
  hostUrl: string,
  token: string,
  sourceKind: SourceKind,
): Promise<Locator> {
  const youtube = sourceKind === "youtube_local";
  await page.goto(`/studio/?runtimeHost=${encodeURIComponent(hostUrl)}`);
  await page.getByRole("button", { name: youtube ? "YouTube local ingest" : "Owned file local ingest" }).click();
  const runtime = page.getByRole("region", { name: youtube ? "YouTube local source" : "Owned local source" });
  const tokenInput = runtime.getByLabel("Paste-once bearer token", { exact: true });
  if (!await tokenInput.isVisible()) {
    await runtime.getByRole("button", { name: "Open connect to local host" }).click();
  }
  await tokenInput.fill(token);
  await runtime.getByRole("button", { name: "Connect to local host", exact: true }).click();
  await expect(runtime.getByLabel(
    youtube ? "YouTube URL for local processing" : "Owned media file",
    { exact: true },
  )).toBeVisible({ timeout: 15_000 });
  return runtime;
}

async function proveSharedInvestigationSpine(input: SharedProofInput): Promise<void> {
  const {
    page,
    runtime,
    sourceKind,
    sourceLabel,
    sourceSessionId,
    sourceRevisionId,
    sourceContentId,
    sourceRegistration,
    sourceLanguage,
    expectedDurationSeconds,
    selectedEndSeconds = null,
    evidencePath,
    screenshotPath,
    allowOneLearningRetry = false,
    extraEvidence = {},
  } = input;

  expect(page.context().pages()).toHaveLength(1);
  await page.keyboard.press("Escape");
  await runtime.getByRole("button", { name: "Continue to Range" }).click();
  if (selectedEndSeconds) await runtime.getByLabel("End timestamp").fill(selectedEndSeconds);
  await runtime.getByRole("button", { name: "Continue to Language" }).click();
  await runtime.getByLabel("Declared source language").fill(sourceLanguage);
  await runtime.getByLabel("Language-pack identity (optional)").fill(`${sourceLanguage}-v3`);
  await runtime.getByRole("button", { name: "Continue to Output" }).click();
  await runtime.getByRole("button", { name: "Continue to Forecast" }).click();
  await expect(runtime.getByRole("region", { name: "Review the local runtime plan" })).toBeVisible({ timeout: 30_000 });
  await runtime.getByRole("button", { name: "Continue to Review" }).click();
  await runtime.getByRole("button", { name: "Accept forecast and start local runtime" }).click();

  const status = runtime.getByRole("region", { name: "Local runtime status" });
  const closedHeading = status.getByRole("heading", { name: /^(Terminal|Failed)$/ });
  await expect(closedHeading).toBeVisible({ timeout: 420_000 });
  expect(await closedHeading.textContent(), (await status.textContent()) ?? "Runtime closed without status detail").toBe("Terminal");
  await expect(status).toContainText("Closed at validated journal head", { timeout: 420_000 });

  const processing = page.getByRole("region", { name: "Processing canvas" });
  await expect(processing).toContainText(sourceLabel);
  await expect(processing).toContainText(sourceKind === "youtube_local" ? "Registered YouTube-local source" : "Registered owned source");
  const production = status.getByRole("region", { name: "Production task and handoff facts" });
  const coordination = processing.getByRole("region", { name: "Receipt-backed coordination" });
  await expect.poll(() => coordination.locator("[data-production-live-task-id]").count()).toBeGreaterThan(1);
  await expect.poll(() => coordination.locator("[data-production-live-grant-id]").count()).toBeGreaterThan(0);
  await expect.poll(() => coordination.locator("[data-production-live-spawn-id]").count()).toBeGreaterThan(1);
  await expect(coordination.locator('[data-production-live-spawn-id][data-spawn-decision="accepted"]')).toHaveCount(
    await coordination.locator("[data-production-live-spawn-id]").count(),
  );

  const operations = coordination.locator("[data-production-live-operation-id]");
  await expect.poll(() => operations.count()).toBeGreaterThan(0);
  const operationEvidence = await operations.evaluateAll((elements): MediaOperationEvidence[] => elements.map((element) => {
    const facts = Object.fromEntries(Array.from(element.querySelectorAll("dl > div")).map((row) => [
      row.querySelector("dt")?.textContent?.trim() ?? "",
      row.querySelector("dd")?.textContent?.trim() ?? "",
    ]));
    return {
      operationId: element.getAttribute("data-production-live-operation-id") ?? "",
      status: element.getAttribute("data-operation-status") ?? "",
      capability: element.querySelector("h5")?.textContent?.trim() ?? "",
      grant: facts.Grant ?? "",
      requestedRange: facts["Requested range"] ?? "",
      receipt: facts.Receipt ?? "",
      output: facts.Output ?? "",
    };
  }));
  expect(operationEvidence.every((operation) => operation.status === "completed")).toBe(true);
  expect(operationEvidence.some((operation) => operation.capability === "speech.transcribe")).toBe(true);
  for (const operation of operationEvidence) {
    expect(operation.operationId).not.toBe("");
    expect(operation.grant).not.toBe("");
    expect(operation.requestedRange).not.toBe("");
    expect(operation.receipt).not.toBe("");
    expect(operation.output).not.toBe("");
  }

  const semanticEvidenceArtifacts = production.locator(
    '[data-production-output-artifact-id][data-origin-kind="semantic_media_evidence"]',
  );
  await expect.poll(() => semanticEvidenceArtifacts.count()).toBeGreaterThan(0);
  const sourceArtifact = production.locator("[data-production-source-artifact-id]");
  await expect(sourceArtifact).toHaveCount(1);
  await expect(sourceArtifact).toContainText(sourceContentId);
  await expect(sourceArtifact).toContainText("private");

  const captionRegion = production.locator('[data-production-region="caption-production"]');
  const captionJob = captionRegion.locator("[data-production-caption-job-id]");
  const reviewReceipt = production.locator("[data-production-publish-review-decision-receipt-id]");
  if (await captionJob.count() === 0) {
    const review = production.locator('[data-production-region="publish-review-human-review"]');
    const control = review.locator("[data-production-review-control-intake-id]");
    await expect(control).toHaveCount(1, { timeout: 30_000 });
    await control.locator("[data-production-review-attestation]").check();
    await control.locator('[data-production-review-action="approve_for_caption_production"]').click();
    await expect(reviewReceipt).toHaveCount(1, { timeout: 30_000 });
    await captionRegion.locator('[data-production-caption-action="start"]').click();
  }
  await expect(reviewReceipt).toHaveCount(1, { timeout: 30_000 });
  await expect(reviewReceipt).toHaveAttribute("data-review-outcome", "approve_for_caption_production");
  await expect(captionJob).toHaveCount(1, { timeout: 240_000 });
  await expect(captionJob).toHaveAttribute("data-status", "completed", { timeout: 240_000 });
  await expect(captionJob).toHaveAttribute("data-caption-authority-state", "unrevoked");
  await expect(captionRegion.locator("[data-production-caption-publish-boundary]")).toContainText(
    "Upload, CDN delivery, and public publication are absent",
  );

  const results = page.locator('[data-production-results-region="caption-lineage"]');
  const result = results.locator("[data-production-results-job-id]");
  await expect(result).toHaveCount(1, { timeout: 30_000 });
  const lines = result.locator("[data-production-results-line-id]");
  await expect.poll(() => lines.count()).toBeGreaterThan(0);
  const learning = result.getByRole("region", { name: "Language learning workspace" });
  await expect(learning).toHaveAttribute("data-learning-mode", "production");
  await expect(learning.getByText("Prepared prototype")).toHaveCount(0);

  const player = result.getByRole("region", { name: "Private production media playback" });
  await expect(player).toHaveAttribute("data-private-playback-state", "ready", { timeout: 30_000 });
  await expect(player).toHaveAttribute(
    "data-private-playback-source-artifact-id",
    await sourceArtifact.getAttribute("data-production-source-artifact-id") ?? "",
  );
  const media = player.locator("[data-private-production-media]");
  await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  const decoded = await media.evaluate((element: HTMLMediaElement) => ({
    currentSrc: element.currentSrc,
    duration: element.duration,
    readyState: element.readyState,
  }));
  expect(decoded.currentSrc).toContain("/v1/private-source-media/");
  expect(decoded.duration).toBeGreaterThan(Math.max(0, expectedDurationSeconds - 1.5));
  expect(decoded.duration).toBeLessThan(expectedDurationSeconds + 1.5);

  const firstLine = lines.first();
  const sourceText = (await firstLine.locator(".cue-src").textContent())?.trim() ?? "";
  expect(sourceText.length).toBeGreaterThan(0);
  await firstLine.getByRole("button", { name: /^Explain source sentence at / }).click();
  const explanation = learning.getByRole("complementary", { name: "Pinned language explanation" });
  await expect(explanation).toHaveAttribute(
    "data-learning-state",
    /production-(failed|available|partial)/,
    { timeout: 90_000 },
  );
  if (await explanation.getAttribute("data-learning-state") === "production-failed" && allowOneLearningRetry) {
    await explanation.getByRole("button", { name: "Retry explanation" }).click();
  }
  await expect(explanation).toHaveAttribute("data-learning-state", /production-(available|partial)/, { timeout: 180_000 });
  await expect(explanation.locator("[data-production-explanation-result-state]")).toHaveCount(1);
  await expect(explanation).toContainText("Verified production explanation");

  const runtimeText = await runtime.textContent();
  expect(runtimeText).not.toContain("Project-generated Korean conversation fixture");
  expect(await result.getAttribute("data-production-results-job-id")).not.toContain("run-006");
  expect(await player.getAttribute("data-private-playback-runtime-id")).not.toContain("run-006");
  await expect(page.locator('[data-source-run="run-006"]')).toHaveCount(0);
  await expect(page.getByText("This interface preview uses a recorded run.")).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);

  await mkdir(dirname(evidencePath), { recursive: true });
  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const evidence = {
    schema: "studio.live-media-browser-proof.v1",
    milestone: "LM-04",
    sourceKind,
    sourceLabel,
    sourceSessionId,
    sourceRevisionId,
    sourceContentId,
    sourceRegistration,
    sourceLanguage,
    selectedEndSeconds: selectedEndSeconds ? Number(selectedEndSeconds) : null,
    sourceArtifactId: await sourceArtifact.getAttribute("data-production-source-artifact-id"),
    runtimeId: await player.getAttribute("data-private-playback-runtime-id"),
    captionJobId: await result.getAttribute("data-production-results-job-id"),
    captionArtifactId: await player.getAttribute("data-private-playback-caption-artifact-id"),
    captionLineCount: await lines.count(),
    firstCaptionSourceText: sourceText,
    learningState: await explanation.getAttribute("data-learning-state"),
    taskCount: await coordination.locator("[data-production-live-task-id]").count(),
    grantCount: await coordination.locator("[data-production-live-grant-id]").count(),
    spawnCount: await coordination.locator("[data-production-live-spawn-id]").count(),
    semanticEvidenceArtifactCount: await semanticEvidenceArtifacts.count(),
    mediaOperations: operationEvidence,
    privateMedia: decoded,
    browserPageCount: page.context().pages().length,
    publication: "private_no_upload_or_publication_authority",
    screenshotPath,
    ...extraEvidence,
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

test("LM-04 proves a fresh owned source through real captions and Learning", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "LM-04 uses one desktop browser over one source artifact");
  test.skip(!OWNED_ENABLED, "guarded real owned LM-04 proof");
  test.setTimeout(600_000);

  const hostUrl = requiredEnvironment("STUDIO_RUNTIME_HOST_URL");
  const token = requiredEnvironment("STUDIO_RUNTIME_HOST_TOKEN");
  const ownedFile = resolve(requiredEnvironment("STUDIO_LM04_OWNED_FILE"));
  const evidencePath = resolve(process.env.STUDIO_LM04_OWNED_EVIDENCE ?? ".studio/live-media-proof/owned-browser-proof.json");
  const screenshotPath = resolve(process.env.STUDIO_LM04_OWNED_SCREENSHOT ?? ".studio/live-media-proof/owned-results.png");
  const reuseRegisteredSource = process.env.STUDIO_LM04_REUSE_REGISTERED_SOURCE === "1";
  const selectedEndSeconds = process.env.STUDIO_LM04_END_SECONDS?.trim() || null;
  const sourceBytes = await readFile(ownedFile);
  expect(`sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`).toBe(EXPECTED_OWNED_CONTENT_ID);

  const runtime = await connectLocalSource(page, hostUrl, token, "owned_local");
  if (!reuseRegisteredSource) {
    await runtime.getByLabel("Owned media file").setInputFiles(ownedFile);
    await runtime.getByLabel("Source label").fill("LM-04 fresh owned Korean proof");
    await runtime.getByLabel("Rights holder").fill("1321 LM-04 generated proof media");
    await runtime.getByLabel(/I attest that I own or control this media/).check();
    await runtime.getByRole("button", { name: "Confirm ownership and ingest" }).click();
    await expect(runtime.getByRole("status", { name: "Owned media ingest progress" }))
      .toHaveAttribute("data-state", "registered", { timeout: 30_000 });
  }

  const registeredSource = runtime.getByLabel("Registered owned source");
  const proofOption = registeredSource.locator("option").filter({ hasText: /^LM-04 fresh owned Korean proof \(20\.57s\)$/ });
  await expect(proofOption).toHaveCount(1);
  await registeredSource.selectOption(await proofOption.getAttribute("value") ?? "");
  const sourceSessionId = await registeredSource.inputValue();
  const client = new LocalRuntimeHostClient({ baseUrl: hostUrl, token });
  const source = (await client.listSourceSessions()).find((candidate) => candidate.sourceSessionId === sourceSessionId);
  expect(source).toBeTruthy();
  expect(source?.sourceKind).toBe("owned_local");
  expect(source?.sourceContentId).toBe(EXPECTED_OWNED_CONTENT_ID);
  await expect(runtime.locator(".product-runtime-source-facts")).toContainText("Owned / local");

  await proveSharedInvestigationSpine({
    page,
    runtime,
    sourceKind: "owned_local",
    sourceLabel: source?.label ?? "LM-04 fresh owned Korean proof",
    sourceSessionId,
    sourceRevisionId: source?.sourceRevisionId ?? "",
    sourceContentId: EXPECTED_OWNED_CONTENT_ID,
    sourceRegistration: reuseRegisteredSource ? "reused_first_browser_upload" : "uploaded_in_this_walk",
    sourceLanguage: "ko",
    expectedDurationSeconds: 20.57,
    selectedEndSeconds,
    evidencePath,
    screenshotPath,
    allowOneLearningRetry: reuseRegisteredSource,
  });
});

test("LM-04 proves a real YouTube range through the same captions and Learning spine", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "LM-04 uses one desktop browser over one source artifact");
  test.skip(!YOUTUBE_ENABLED, "guarded operator-authorized real YouTube LM-04 proof");
  test.setTimeout(900_000);

  const hostUrl = requiredEnvironment("STUDIO_RUNTIME_HOST_URL");
  const token = requiredEnvironment("STUDIO_RUNTIME_HOST_TOKEN");
  const youtubeUrl = requiredEnvironment("STUDIO_LM04_YOUTUBE_URL");
  const providerStartSeconds = requiredSeconds("STUDIO_LM04_YOUTUBE_START_SECONDS");
  const providerEndSeconds = requiredSeconds("STUDIO_LM04_YOUTUBE_END_SECONDS");
  if (providerStartSeconds < 0 || providerEndSeconds <= providerStartSeconds || providerEndSeconds - providerStartSeconds > 120) {
    throw new Error("The YouTube proof range must be positive, ordered, and no longer than 120 seconds");
  }
  const parsedUrl = new URL(youtubeUrl);
  if (parsedUrl.protocol !== "https:" || !new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]).has(parsedUrl.hostname)) {
    throw new Error("STUDIO_LM04_YOUTUBE_URL must be an HTTPS YouTube URL");
  }
  const sourceLanguage = process.env.STUDIO_LM04_YOUTUBE_SOURCE_LANGUAGE?.trim() || "ko";
  const reuseSourceSessionId = process.env.STUDIO_LM04_YOUTUBE_REUSE_SOURCE_SESSION_ID?.trim() || null;
  const analysisEndSeconds = process.env.STUDIO_LM04_YOUTUBE_ANALYSIS_END_SECONDS?.trim() || null;
  const evidencePath = resolve(process.env.STUDIO_LM04_YOUTUBE_EVIDENCE ?? ".studio/live-media-proof/youtube-browser-proof.json");
  const screenshotPath = resolve(process.env.STUDIO_LM04_YOUTUBE_SCREENSHOT ?? ".studio/live-media-proof/youtube-results.png");

  const runtime = await connectLocalSource(page, hostUrl, token, "youtube_local");
  const client = new LocalRuntimeHostClient({ baseUrl: hostUrl, token });
  let ingestId: string | null = null;
  let source = reuseSourceSessionId
    ? (await client.listSourceSessions()).find((candidate) => candidate.sourceSessionId === reuseSourceSessionId) ?? null
    : null;
  if (reuseSourceSessionId) {
    expect(source?.sourceKind).toBe("youtube_local");
  } else {
    await runtime.getByLabel("YouTube URL for local processing", { exact: true }).fill(youtubeUrl);
    await runtime.getByLabel("YouTube start seconds", { exact: true }).fill(String(providerStartSeconds));
    await runtime.getByLabel("YouTube end seconds", { exact: true }).fill(String(providerEndSeconds));
    await runtime.getByLabel(/I confirm this exact YouTube range/).check();
    const createResponse = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === "POST" && new URL(response.url()).pathname === "/v1/youtube-local-ingests";
    });
    await runtime.getByRole("button", { name: "Confirm local processing and ingest" }).click();
    const createPayload = await (await createResponse).json() as { ingestId?: unknown };
    expect(typeof createPayload.ingestId).toBe("string");
    ingestId = createPayload.ingestId as string;
    const progress = runtime.getByRole("status", { name: "YouTube local ingest progress" });
    await expect(progress).toHaveAttribute("data-state", "registered", { timeout: 180_000 });
    const ingest = await client.youtubeLocalIngestStatus(ingestId);
    expect(ingest.status).toBe("registered");
    expect(ingest.source?.sourceKind).toBe("youtube_local");
    source = ingest.source;
  }
  if (!source) throw new Error("The registered YouTube ingest omitted its source receipt summary");
  if (analysisEndSeconds) {
    const analysisEnd = Number(analysisEndSeconds);
    if (!Number.isFinite(analysisEnd) || analysisEnd <= 0 || Math.round(analysisEnd * 1_000) > source.durationMs) {
      throw new Error("STUDIO_LM04_YOUTUBE_ANALYSIS_END_SECONDS must be inside the registered local source");
    }
  }
  const registeredSource = runtime.getByLabel("Registered YouTube local source");
  await registeredSource.selectOption(source.sourceSessionId);
  await expect(registeredSource).toContainText(source.label);
  await expect(runtime.locator(".product-runtime-source-facts")).toContainText("YouTube / local");
  await expect(runtime.locator(".product-runtime-source-facts")).toContainText("local processing");

  await proveSharedInvestigationSpine({
    page,
    runtime,
    sourceKind: "youtube_local",
    sourceLabel: source.label,
    sourceSessionId: source.sourceSessionId,
    sourceRevisionId: source.sourceRevisionId,
    sourceContentId: source.sourceContentId,
    sourceRegistration: reuseSourceSessionId ? "reused_first_browser_youtube_ingest" : "downloaded_and_registered_in_this_walk",
    sourceLanguage,
    expectedDurationSeconds: source.durationMs / 1_000,
    selectedEndSeconds: analysisEndSeconds,
    evidencePath,
    screenshotPath,
    extraEvidence: {
      ingestId,
      ingestReceiptId: `youtube-local:${source.sourceContentId.replace(/^sha256:/, "")}`,
      providerSelection: { startSeconds: providerStartSeconds, endSeconds: providerEndSeconds },
      youtubeUrlContentId: contentId(youtubeUrl),
      youtubeUrlRecordedInEvidence: false,
      localProcessingOnlyConfirmed: true,
      redistributionAuthorized: false,
    },
  });
});
