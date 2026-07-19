import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test, type Locator, type Page, type Request, type Response } from "@playwright/test";

import {
  DeterministicRuntimeExecutor,
  DurableRuntimeCommandStore,
  RuntimeSourceRegistry,
  RuntimeStartService,
  createRuntimeHostHttpServer,
  deterministicOrchestratorLauncherFactory,
  listenRuntimeHost,
} from "../../src/studio/runtime/production/runtimeHost/index.ts";

function productStudioUrl(): string {
  const runtimeHost = process.env.STUDIO_RUNTIME_HOST_URL;
  return runtimeHost ? `/studio/?runtimeHost=${encodeURIComponent(runtimeHost)}` : "/studio/";
}

async function openCompletedDeterministicProjection(
  page: Page,
  endSeconds?: number,
  connection?: { url: string; token: string },
): Promise<Locator> {
  const token = connection?.token ?? process.env.STUDIO_RUNTIME_HOST_TOKEN ?? "";
  await page.goto(connection ? `/studio/?runtimeHost=${encodeURIComponent(connection.url)}` : productStudioUrl());
  await page.getByRole("button", { name: "Owned file local ingest" }).click();

  const productRuntime = page.getByRole("region", { name: "Owned local source" });
  await productRuntime.getByRole("button", { name: "Open connect to local host" }).click();
  await productRuntime.getByRole("textbox", { name: "Paste-once bearer token", exact: true }).fill(token);
  await productRuntime.getByRole("button", { name: "Connect to local host", exact: true }).click();
  await expect(productRuntime.getByRole("combobox", { name: "Registered owned source" })).toBeVisible();
  await page.keyboard.press("Escape");
  await productRuntime.getByRole("button", { name: "Continue to Range" }).click();
  if (endSeconds !== undefined) {
    await productRuntime.getByLabel("End timestamp").fill(String(endSeconds));
  }
  await productRuntime.getByRole("button", { name: "Continue to Language" }).click();
  await productRuntime.getByLabel("Declared source language").fill("ko");
  await productRuntime.getByLabel("Language-pack identity (optional)").fill("ko-v3");
  await productRuntime.getByRole("button", { name: "Continue to Output" }).click();
  await productRuntime.getByRole("button", { name: "Continue to Forecast" }).click();
  await expect(productRuntime.getByRole("region", { name: "Review the local runtime plan" })).toBeVisible();
  await productRuntime.getByRole("button", { name: "Continue to Review" }).click();
  await productRuntime.getByRole("button", { name: "Accept forecast and start local runtime" }).click();

  const status = productRuntime.getByRole("region", { name: "Local runtime status" });
  await expect(status.getByRole("heading", { name: /^(Terminal|Failed|Interrupted)$/, exact: true })).toBeVisible({
    timeout: 10_000,
  });
  return status.getByRole("region", { name: "Production task and handoff facts" });
}

test("owned processing canvas exposes projection facts and explicit missing receipt states", async ({ page }) => {
  await page.goto("/studio/?processingMock=running");

  const canvas = page.getByRole("region", { name: "Processing canvas" });
  const receiptedOperations = canvas.locator("[data-production-receipted-operations]");
  await expect(receiptedOperations).toHaveAttribute("data-production-receipted-operations", "0");
  await expect(receiptedOperations).toContainText("not receipted media work");
  const coordination = canvas.getByRole("region", { name: "Receipt-backed coordination" });
  await expect(coordination).toBeVisible();
  await expect(coordination).toContainText("host-validated composition");
  await expect(coordination.locator("[data-production-live-task-id]")).toHaveCount(2);
  await expect(coordination.locator("[data-production-live-grant-id]")).toHaveCount(0);
  await expect(coordination.getByText("No scheduler grant recorded")).toHaveCount(2);
  await expect(coordination.locator('[data-production-live-empty="handoffs"]')).toBeVisible();
  const operations = coordination.locator("[data-production-live-operation-id]");
  await expect(operations).toHaveCount(2);
  const mediaOperation = coordination.locator("[data-production-live-operation-id]:not([data-operation-capability])");
  await expect(mediaOperation).toHaveCount(1);
  await expect(mediaOperation).toHaveAttribute("data-operation-status", "started");
  await expect(mediaOperation.getByText("No perception observation recorded for this operation")).toBeVisible();
  const semanticOperation = coordination.locator('[data-production-live-operation-id][data-operation-capability="speech.transcribe"]');
  await expect(semanticOperation).toHaveCount(1);
  await expect(semanticOperation).toHaveAttribute("data-operation-status", "started");
  await expect(semanticOperation).toHaveAttribute("data-operation-audit", "not_completed");
  await expect(semanticOperation.locator('[data-semantic-audit-state="not_completed"]')).toHaveText("Not completed");
  await expect(semanticOperation.locator(".processing-receipt-missing")).not.toHaveCount(0);
  await expect(coordination.locator('[data-production-projection-coverage="media-operations"]')).toContainText(
    "not evidence about whether they ran",
  );
  await expect(coordination.locator('[data-production-live-empty="caption-lineage"]')).toBeVisible();
  await expect(coordination.getByText(/No caption-production start receipt/)).toBeVisible();
  await expect(coordination.locator('[data-production-live-empty="agent-recovery"]')).toBeVisible();
  await expect(coordination.locator("[data-production-live-recovery-boundary]")).toContainText("no best-of-K selection");
  await expect(canvas.getByRole("button", { name: "Evidence", exact: true })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Results", exact: true })).toHaveCount(0);
});

test("deterministic recovery receipts project absent, reported, and exhausted production facts", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== "desktop", "one deterministic desktop recovery projection is sufficient");

  const fixtures = [
    { label: "absent", executor: {}, state: null, classifications: 0 },
    { label: "replacement_reported", executor: { failFirstInitialCoverageCode: "process_failed" }, state: "replacement_reported", classifications: 1 },
    { label: "exhausted", executor: { exhaustInitialCoverageCode: "process_failed" }, state: "exhausted", classifications: 2 },
  ] as const;

  for (const fixture of fixtures) {
    const directory = await mkdtemp(join(tmpdir(), `studio-recovery-browser-${fixture.label}-`));
    const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [resolve("public/demo/runs/run-005")] });
    const store = await DurableRuntimeCommandStore.open(join(directory, "runtime"));
    const executor = new DeterministicRuntimeExecutor(fixture.executor);
    const service = await RuntimeStartService.open({
      store,
      sources,
      launcherFactory: executor.factory(),
      orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory({ mode: "spawn_one" }),
      recoverOnOpen: false,
    });
    const token = "c".repeat(64);
    await page.goto("/studio/");
    const origin = new URL(page.url()).origin;
    const server = createRuntimeHostHttpServer({ service, token, allowedOrigins: [origin] });
    try {
      const address = await listenRuntimeHost(server, { port: 0 });
      const url = `http://${address.host}:${address.port}`;
      const production = await openCompletedDeterministicProjection(page, 1, { url, token });
      const recoveryFacts = production.locator('[data-production-region="agent-recovery"]');
      await expect(recoveryFacts.getByRole("heading", { name: "Initial-coverage recovery" })).toBeVisible();
      await expect(recoveryFacts.locator("[data-production-recovery-boundary]")).toContainText("no best-of-K selection");
      await expect(recoveryFacts.locator("[data-production-recovery-boundary]")).toContainText("does not recover root, caption, or Learning work");
      await expect(recoveryFacts).not.toContainText("selected best report");

      const coordination = page.getByRole("region", { name: "Receipt-backed coordination" });
      if (fixture.state === null) {
        await expect(recoveryFacts.locator('[data-production-empty="agent-recovery"]')).toBeVisible();
        await expect(recoveryFacts.locator("[data-production-failure-classification-id]")).toHaveCount(0);
        await expect(recoveryFacts.locator("[data-production-agent-recovery-id]")).toHaveCount(0);
        await expect(coordination.locator('[data-production-live-empty="agent-recovery"]')).toBeVisible();
        continue;
      }

      const classification = recoveryFacts.locator("[data-production-failure-classification-id]");
      await expect(classification).toHaveCount(fixture.classifications);
      for (let index = 0; index < fixture.classifications; index += 1) {
        await expect(classification.nth(index)).toHaveAttribute("data-retryability", "replaceable");
        await expect(classification.nth(index)).toContainText("Eligible for scheduler policy review only");
      }

      const recovery = recoveryFacts.locator("[data-production-agent-recovery-id]");
      await expect(recovery).toHaveCount(1);
      await expect(recovery).toHaveAttribute("data-recovery-state", fixture.state);
      await expect(recovery.locator('[data-recovery-attempt="0"]')).toContainText("Attempt 0 · failed");
      await expect(recovery.locator('[data-recovery-attempt="1"]')).toContainText("Attempt 1 · exact replacement");
      await expect(recovery).toContainText("Replacement allocation ceiling");
      await expect(recovery).toContainText("Run recovery contingency ceiling");
      await expect(recovery).toContainText("2 / 0");
      await expect(recovery.locator('[data-recovery-attempt="2"]')).toHaveCount(0);
      await expect(recovery.getByRole("button")).toHaveCount(0);

      const failedAttemptTaskLink = recovery.locator('[data-recovery-attempt="0"] [data-production-navigation="task"]');
      await expect(failedAttemptTaskLink).toHaveCount(1);
      const failedAttemptHref = await failedAttemptTaskLink.getAttribute("href");
      expect(failedAttemptHref).toMatch(/^#product-production-task-/);
      expect(await page.evaluate((target) => Boolean(target && document.getElementById(target.slice(1))), failedAttemptHref)).toBe(true);
      expect(await page.evaluate(
        (target) => target ? document.getElementById(target.slice(1))?.getAttribute("data-status") : null,
        failedAttemptHref,
      )).toBe("failed");

      if (fixture.state === "replacement_reported") {
        await expect(recovery).toContainText("Replacement reported");
        await expect(recovery.locator('[data-recovery-attempt="1"] [data-production-navigation="report"]')).toHaveCount(1);
      } else {
        await expect(recovery).toContainText("Exhausted. Both authorized attempts were consumed, zero remain");
        await expect(recovery).toContainText("None; recovery exhausted");
        await expect(recovery.locator('[data-recovery-attempt="1"] [data-production-navigation="report"]')).toHaveCount(0);
      }

      const liveRecovery = coordination.locator("[data-production-live-recovery-id]");
      await expect(liveRecovery).toHaveCount(1);
      await expect(liveRecovery).toHaveAttribute("data-recovery-state", fixture.state);
      await expect(liveRecovery.locator('[data-recovery-attempt="0"]')).toBeVisible();
      await expect(liveRecovery.locator('[data-recovery-attempt="1"]')).toBeVisible();
      await expect(liveRecovery).toContainText("not a forecast");
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  }
});

test("attested approval explicitly produces private bounded captions without publication", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(testInfo.project.name !== "desktop", "one deterministic desktop review path is sufficient");
  test.skip(!process.env.STUDIO_RUNTIME_HOST_TOKEN, "requires an operator-started deterministic runtime host");

  const mediaRequests: Request[] = [];
  const mediaResponses: Response[] = [];
  const revocationRequests: Request[] = [];
  const revocationResponses: Response[] = [];
  const languageExplanationPosts: Request[] = [];
  let releaseFirstExplanationPost!: () => void;
  let observeFirstExplanationPost!: () => void;
  const firstExplanationPostGate = new Promise<void>((resolve) => { releaseFirstExplanationPost = resolve; });
  const firstExplanationPostObserved = new Promise<void>((resolve) => { observeFirstExplanationPost = resolve; });
  let delayedFirstExplanationPost = false;
  await page.route("**/v1/runtimes/*/language-explanations", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      languageExplanationPosts.push(request);
      if (!delayedFirstExplanationPost) {
        delayedFirstExplanationPost = true;
        observeFirstExplanationPost();
        await firstExplanationPostGate;
      }
    }
    await route.continue();
  });
  page.on("request", (request) => {
    if (request.url().includes("/v1/private-source-media/")) mediaRequests.push(request);
    if (request.url().includes("/private-playback-grants/") && request.url().endsWith("/revocations")) {
      revocationRequests.push(request);
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/v1/private-source-media/")) mediaResponses.push(response);
    if (response.url().includes("/private-playback-grants/") && response.url().endsWith("/revocations")) {
      revocationResponses.push(response);
    }
  });

  const production = await openCompletedDeterministicProjection(page, 47.2);
  const processingCanvas = page.getByRole("region", { name: "Processing canvas" });
  await expect(processingCanvas).toBeVisible();
  await expect(processingCanvas.getByRole("heading", { name: "Project-generated Korean conversation fixture" })).toBeVisible();
  await expect(processingCanvas.getByRole("heading", { name: "Terminal" })).toBeVisible();
  await expect(processingCanvas.getByText("Closed at validated journal head", { exact: false })).toBeVisible();
  await expect(processingCanvas.getByRole("button", { name: "Pause" })).toHaveCount(0);
  await expect(processingCanvas.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(processingCanvas.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(processingCanvas.getByText(/no pause or cancellation command/)).toBeVisible();
  const receiptedOperationsPairing = processingCanvas.locator("[data-production-receipted-operations]");
  await expect(receiptedOperationsPairing).toBeVisible();
  await expect.poll(async () =>
    Number(await receiptedOperationsPairing.getAttribute("data-production-receipted-operations")),
  ).toBeGreaterThan(0);
  await expect(receiptedOperationsPairing).toContainText("coordination ledger below");
  const coordination = processingCanvas.getByRole("region", { name: "Receipt-backed coordination" });
  await expect(coordination).toBeVisible();
  await expect.poll(() => coordination.locator("[data-production-live-task-id]").count()).toBeGreaterThan(1);
  await expect.poll(() => coordination.locator("[data-production-live-grant-id]").count()).toBeGreaterThan(0);
  const handoff = coordination.locator("[data-production-live-spawn-id]");
  await expect.poll(() => handoff.count()).toBeGreaterThan(0);
  await expect(handoff.first()).toHaveAttribute("data-spawn-decision", "accepted");
  const speechOperation = coordination.locator('[data-production-live-operation-id][data-operation-capability="speech.transcribe"]');
  await expect.poll(() => speechOperation.count()).toBeGreaterThan(0);
  await expect(speechOperation.first()).toHaveAttribute("data-operation-status", "completed");
  await expect(speechOperation.first()).toHaveAttribute("data-operation-audit", /verified/);
  await expect(speechOperation.first().getByText("speech.transcribe", { exact: true })).toBeVisible();
  await expect(speechOperation.first().getByText(/stream:0/)).toBeVisible();
  await expect(speechOperation.first().locator("[data-semantic-audit-state]")).toHaveText(/Verified at completion/);
  await expect(coordination.locator('[data-production-projection-coverage="media-operations"]')).toContainText(
    "not evidence about whether they ran",
  );
  await expect(coordination.locator('[data-production-live-empty="caption-lineage"]')).toBeVisible();

  const semanticFacts = production.locator('[data-production-region="semantic-evidence"]');
  await expect(semanticFacts.getByRole("heading", { name: "Semantic media evidence operations" })).toBeVisible();
  await expect(semanticFacts.locator('[data-production-empty="semantic-evidence"]')).toHaveCount(0);
  const semanticFact = semanticFacts.locator("[data-production-semantic-evidence-id]");
  await expect.poll(() => semanticFact.count()).toBeGreaterThan(0);
  await expect(semanticFact.first()).toHaveAttribute("data-status", "completed");
  await expect(semanticFact.first()).toHaveAttribute("data-operation-audit", /verified/);
  await expect(semanticFact.first().getByText(/Verified at completion/)).toBeVisible();
  const semanticFactId = await semanticFact.first().getAttribute("data-production-semantic-evidence-id");
  expect(semanticFactId).toBeTruthy();
  await expect(semanticFact.first().getByText(semanticFactId ?? "", { exact: true }).first()).toBeVisible();
  await expect(semanticFact.first().getByText(/\) ms/).first()).toBeVisible();
  await expect(semanticFacts.getByText("do not claim transcription accuracy")).toBeVisible();

  const semanticArtifact = production.locator('[data-production-output-artifact-id][data-origin-kind="semantic_media_evidence"]');
  await expect.poll(() => semanticArtifact.count()).toBeGreaterThan(0);
  const semanticOperationLink = semanticArtifact.first().locator('[data-production-navigation="operation"]');
  await expect(semanticOperationLink).toHaveCount(1);
  const semanticHref = await semanticOperationLink.getAttribute("href");
  expect(semanticHref).toMatch(/^#product-production-operation-/);
  expect(
    await page.evaluate((target) => Boolean(target && document.getElementById(target.slice(1))), semanticHref),
  ).toBe(true);

  const review = production.locator('[data-production-region="publish-review-human-review"]');
  await expect(review.getByRole("heading", { name: "Queued intake human review" })).toBeVisible();
  const control = review.locator("[data-production-review-control-intake-id]");
  await expect(control).toHaveCount(1);
  await control.locator("[data-production-review-attestation]").check();
  await control.locator('[data-production-review-action="approve_for_caption_production"]').click();

  const receipts = production.locator('[data-production-region="publish-review-decision-receipts"]');
  const receipt = receipts.locator("[data-production-publish-review-decision-receipt-id]");
  await expect(receipt).toHaveCount(1, { timeout: 10_000 });
  await expect(receipt).toHaveAttribute("data-integrity", "stored_review_and_verified_queued_intake");
  await expect(receipt).toHaveAttribute("data-review-outcome", "approve_for_caption_production");
  await expect(receipt).toHaveAttribute("data-review-state", "approved_for_caption_production");
  await expect(receipt.locator('[data-production-review-reason-code="reviewer_attested_caption_production_may_proceed"]')).toHaveCount(1);
  await expect(receipts.getByText(/separate caption producer may consume this review receipt/)).toBeVisible();
  await expect(production.getByText(/It creates no captions, upload, publication/)).toBeVisible();
  await expect(production.locator('[data-production-publish-review-revocation-receipt-id]')).toHaveCount(0);

  const captions = production.locator('[data-production-region="caption-production"]');
  await expect(captions.getByRole("heading", { name: "Caption production" })).toBeVisible();
  const productionResults = page.locator('[data-production-results-region="caption-lineage"]');
  await expect(productionResults.getByRole("heading", { name: "Production caption results" })).toBeVisible();
  await expect(productionResults.locator('[data-production-results-empty="no-verified-caption-job"]')).toBeVisible();
  await expect(productionResults.locator("[data-production-results-job-id]")).toHaveCount(0);
  await captions.locator('[data-production-caption-action="start"]').click();
  const job = captions.locator('[data-production-caption-job-id]');
  await expect(job).toHaveCount(1, { timeout: 10_000 });
  await expect(job).toHaveAttribute("data-status", "completed");
  await expect(job).toHaveAttribute("data-caption-authority-state", "unrevoked");
  await expect(job.locator("[data-production-caption-line-count]")).toHaveText("6");
  await expect(job.locator("[data-production-caption-withheld-count]")).toHaveText("0");
  await expect(job.locator("[data-production-caption-unavailable-count]")).toHaveText("0");
  await expect(captions.locator('[data-production-caption-artifact-id]')).toHaveCount(2);
  await expect(captions.locator('[data-caption-artifact-role="timed_captions"]')).toHaveCount(1);
  await expect(captions.locator('[data-caption-artifact-role="production_receipt"]')).toHaveCount(1);
  await expect(captions.locator("[data-production-caption-publish-boundary]")).toContainText(
    "Upload, CDN delivery, and public publication are absent",
  );
  await expect(productionResults.locator('[data-production-results-job-id]')).toHaveCount(1, { timeout: 10_000 });
  await expect(productionResults.locator('[data-production-results-line-id]')).toHaveCount(6);
  const productionLearning = productionResults.getByRole("region", { name: "Language learning workspace" });
  await expect(productionLearning).toHaveAttribute("data-learning-mode", "production");
  const privatePlayer = productionResults.getByRole("region", { name: "Private production media playback" });
  await expect(privatePlayer).toHaveCount(1);
  await expect(privatePlayer).toHaveAttribute("data-private-playback-state", "ready", { timeout: 10_000 });
  await expect(privatePlayer).toHaveAttribute("data-private-playback-timestamp-origin", "source_media_zero");
  const media = privatePlayer.locator("[data-private-production-media]");
  await expect(media).toHaveCount(1);
  await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  const decoded = await media.evaluate((element: HTMLMediaElement) => ({
    currentSrc: element.currentSrc,
    duration: element.duration,
    readyState: element.readyState,
    crossOrigin: element.crossOrigin,
  }));
  expect(decoded.currentSrc).toContain("/v1/private-source-media/");
  expect(decoded.duration).toBeGreaterThanOrEqual(47.2);
  expect(decoded.readyState).toBeGreaterThanOrEqual(2);
  expect(decoded.crossOrigin).toBe("anonymous");
  await expect.poll(() => mediaRequests.length).toBeGreaterThan(0);
  const initialMediaHeaders = await Promise.all(mediaRequests.map((request) => request.allHeaders()));
  expect(initialMediaHeaders.some((headers) => headers.origin === new URL(page.url()).origin)).toBe(true);
  expect(initialMediaHeaders.some((headers) => headers.range?.startsWith("bytes="))).toBe(true);
  expect(mediaResponses.some((response) => response.status() === 206)).toBe(true);

  const targetCue = productionLearning.locator("[data-production-results-line-id]").nth(5);
  const seekButton = targetCue.getByRole("button", { name: /^Seek to / });
  const seekLabel = await seekButton.getAttribute("aria-label");
  const seekMatch = /^Seek to (\d+):(\d+(?:\.\d+)?)$/.exec(seekLabel ?? "");
  expect(seekMatch).not.toBeNull();
  const expectedSeconds = Number(seekMatch?.[1]) * 60 + Number(seekMatch?.[2]);
  await seekButton.click();
  await expect(targetCue).toHaveClass(/is-active/);
  await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.currentTime))
    .toBeGreaterThan(expectedSeconds - 0.1);
  expect(await media.evaluate((element: HTMLMediaElement) => element.currentTime))
    .toBeLessThan(expectedSeconds + 0.5);

  const playButton = privatePlayer.getByRole("button", { name: "Play private source" });
  const beforePlay = await media.evaluate((element: HTMLMediaElement) => element.currentTime);
  await playButton.click();
  await expect(privatePlayer.getByRole("button", { name: "Pause private source" })).toBeVisible();
  await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.currentTime))
    .toBeGreaterThan(beforePlay + 0.1);
  await privatePlayer.getByRole("button", { name: "Pause private source" }).click();

  await expect(productionLearning.getByText("Production learning unavailable")).toHaveCount(0);
  await expect(productionLearning.getByText("Prepared prototype")).toHaveCount(0);
  await expect(productionLearning.getByRole("button", { name: /Saved/ })).toHaveCount(0);

  const firstCue = productionLearning.locator("[data-production-results-line-id]").first();
  const fullSource = firstCue.locator(".cue-src");
  const fullSourceText = await fullSource.textContent();
  expect(fullSourceText).not.toBeNull();
  await firstCue.getByRole("button", { name: /^Explain source sentence at / }).dblclick();
  await firstExplanationPostObserved;
  const explanationPanel = productionLearning.getByRole("complementary", { name: "Pinned language explanation" });
  await expect(explanationPanel).toHaveAttribute("data-learning-state", "production-loading");
  await expect(explanationPanel).toContainText("Requesting production explanation");
  expect(languageExplanationPosts).toHaveLength(1);
  const fullSentenceRequest = languageExplanationPosts[0].postDataJSON() as {
    lineId: string;
    selection: { side: string; unit: string; start: number; end: number; text: string };
    facetKinds: string[];
  };
  expect(fullSentenceRequest.lineId).toBe(await firstCue.getAttribute("data-learning-line-id"));
  expect(fullSentenceRequest.selection).toEqual({
    side: "source",
    unit: "unicode_code_point",
    start: 0,
    end: Array.from(fullSourceText ?? "").length,
    text: fullSourceText,
  });
  expect(fullSentenceRequest.facetKinds).toEqual(["meaning", "word", "phrase", "grammar", "translation_choice"]);
  releaseFirstExplanationPost();
  await expect(explanationPanel).toHaveAttribute("data-learning-state", "production-unavailable");
  await expect(explanationPanel).toContainText("production_explanation_executor_unavailable");
  await expect(explanationPanel.getByRole("button", { name: "Retry explanation" })).toHaveCount(0);
  await expect(explanationPanel).not.toContainText("Prepared prototype");
  await explanationPanel.getByRole("button", { name: "Close explanation" }).click();
  await firstCue.getByRole("button", { name: /^Explain source sentence at / }).click();
  await expect(explanationPanel).toHaveAttribute("data-learning-state", "production-unavailable");
  expect(languageExplanationPosts).toHaveLength(1);
  await explanationPanel.getByRole("button", { name: "Close explanation" }).click();

  const targetText = firstCue.locator(".cue-tgt");
  const selectedTarget = await targetText.evaluate((element) => {
    const text = element.textContent ?? "";
    const selected = "interval";
    const startOffset = text.indexOf(selected);
    if (!(element.firstChild instanceof Text) || startOffset < 0) throw new Error("Expected target phrase is absent");
    const range = document.createRange();
    range.setStart(element.firstChild, startOffset);
    range.setEnd(element.firstChild, startOffset + selected.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    return {
      text: selected,
      start: Array.from(text.slice(0, startOffset)).length,
      end: Array.from(text.slice(0, startOffset + selected.length)).length,
    };
  });
  await expect.poll(() => languageExplanationPosts.length).toBe(2);
  await expect(explanationPanel).toHaveAttribute("data-selected-side", "target");
  await expect(explanationPanel).toHaveAttribute("data-selected-start", String(selectedTarget.start));
  await expect(explanationPanel).toHaveAttribute("data-selected-end", String(selectedTarget.end));
  const targetSpanRequest = languageExplanationPosts[1].postDataJSON() as {
    selection: { side: string; unit: string; start: number; end: number; text: string };
  };
  expect(targetSpanRequest.selection).toEqual({
    side: "target",
    unit: "unicode_code_point",
    start: selectedTarget.start,
    end: selectedTarget.end,
    text: selectedTarget.text,
  });
  await expect(explanationPanel).toHaveAttribute("data-learning-state", "production-unavailable");
  await expect(explanationPanel.getByRole("button", { name: "Retry explanation" })).toHaveCount(0);
  await expect(productionResults).toContainText("not replay Results identity");
  await expect(productionResults).toContainText("does not claim transcription accuracy, English quality, or a Bet G score");
  await expect(processingCanvas.getByRole("heading", { name: "Structurally accepted private candidate" })).toBeVisible();
  const liveCaption = coordination.locator("[data-production-live-caption-job-id]");
  await expect(liveCaption).toHaveCount(1);
  await expect(liveCaption).toHaveAttribute("data-caption-execution-scope", "current_run");
  await expect(liveCaption).toHaveAttribute("data-caption-qc-outcome", "accepted");
  await expect(liveCaption).toContainText("deterministic_current_run_test_seam");
  await expect(liveCaption).toContainText("cognition claim none");

  await processingCanvas.getByRole("button", { name: "Prepare another run" }).click();
  await expect(privatePlayer).toHaveCount(0);
  await expect.poll(() => revocationRequests.length).toBeGreaterThan(0);
  await expect.poll(() => revocationResponses.some((response) => response.status() === 200)).toBe(true);
});

test("attested reviewer rejects one verified queued intake with a visible closed reason", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one deterministic desktop review path is sufficient");
  test.skip(!process.env.STUDIO_RUNTIME_HOST_TOKEN, "requires an operator-started deterministic runtime host");

  const production = await openCompletedDeterministicProjection(page, 0.8);
  const review = production.locator('[data-production-region="publish-review-human-review"]');
  const control = review.locator("[data-production-review-control-intake-id]");
  await expect(control).toHaveCount(1);
  await control.locator("[data-production-review-rejection-reason]").selectOption("evidence_requires_additional_review");
  await control.locator("[data-production-review-note]").fill("A new review is required before caption production.");
  await control.locator("[data-production-review-attestation]").check();
  await control.locator('[data-production-review-action="reject_with_reasons"]').click();

  const receipts = production.locator('[data-production-region="publish-review-decision-receipts"]');
  const receipt = receipts.locator("[data-production-publish-review-decision-receipt-id]");
  await expect(receipt).toHaveCount(1, { timeout: 10_000 });
  await expect(receipt).toHaveAttribute("data-review-outcome", "reject_with_reasons");
  await expect(receipt).toHaveAttribute("data-review-state", "rejected");
  await expect(receipt.locator('[data-production-review-reason-code="evidence_requires_additional_review"]')).toHaveCount(1);
  await expect(receipt.getByText("A new review is required before caption production.")).toBeVisible();
  await expect(receipt.locator('[data-production-review-revocation-control]')).toHaveCount(0);
});

test("receipted child media/evidence operations and artifact identity hooks project outside replay", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one deterministic projection covers identity hooks");
  test.skip(!process.env.STUDIO_RUNTIME_HOST_TOKEN, "requires an operator-started deterministic runtime host");

  const production = await openCompletedDeterministicProjection(page);
  const sourceRegion = production.locator('[data-production-region="source-artifacts"]');
  await expect(sourceRegion.getByRole("heading", { name: "Source artifacts" })).toBeVisible();
  await expect(sourceRegion.locator('[data-production-empty="source-artifacts"]')).toHaveCount(0);
  const sourceArtifact = sourceRegion.locator("[data-production-source-artifact-id]");
  await expect(sourceArtifact).toHaveCount(1);
  const sourceArtifactId = await sourceArtifact.getAttribute("data-production-source-artifact-id");
  expect(sourceArtifactId).toBeTruthy();
  const sourceLinks = production.locator(
    `[data-production-navigation="artifact"][data-production-target-id="${sourceArtifactId}"]`,
  );
  await expect.poll(() => sourceLinks.count()).toBeGreaterThan(0);
  for (const link of await sourceLinks.all()) {
    const href = await link.getAttribute("href");
    expect(href).toBe(`#product-production-artifact-${sourceArtifactId}`);
    expect(
      await page.evaluate((target) => Boolean(target && document.getElementById(target.slice(1))), href),
    ).toBe(true);
  }

  const evidenceArtifacts = production.locator('[data-production-region="evidence-artifacts"]');
  await expect(evidenceArtifacts.getByRole("heading", { name: "Evidence artifacts" })).toBeVisible();
  await expect(evidenceArtifacts.locator('[data-production-empty="evidence-artifacts"]')).toHaveCount(0);
  await expect(evidenceArtifacts.locator('[data-production-evidence-artifact-id]')).toHaveCount(2);
  await expect(evidenceArtifacts.locator('[data-evidence-kind="speech_activity"]')).toHaveCount(1);
  await expect(evidenceArtifacts.locator('[data-evidence-kind="language_ranges"]')).toHaveCount(1);

  const evidenceReads = production.locator('[data-production-region="evidence-reads"]');
  await expect(evidenceReads.getByRole("heading", { name: "Evidence reads" })).toBeVisible();
  await expect(evidenceReads.locator('[data-production-empty="evidence-reads"]')).toHaveCount(0);
  const reads = evidenceReads.locator('[data-production-evidence-read-id]');
  await expect(reads).toHaveCount(2);
  await expect(evidenceReads.locator('[data-production-evidence-read-id][data-status="completed"]')).toHaveCount(2);
  await expect(evidenceReads.getByText("64 items / 32768 bytes")).toHaveCount(2);
  await expect(evidenceReads.getByText(/^evidence-read:/)).toHaveCount(2);
  await expect(evidenceReads.locator('[data-production-navigation="artifact"]')).toHaveCount(2);

  const evidenceGrant = production.locator('[data-production-grant-id]').filter({ hasText: "evidence.read" });
  await expect(evidenceGrant).toHaveCount(1);
  await expect(evidenceGrant.getByText(/speech_activity/)).toBeVisible();
  await expect(evidenceGrant.getByText(/language_ranges/)).toBeVisible();

  const assessmentGrant = production.locator('[data-production-grant-id]').filter({ hasText: "analysis.evidence.assess" });
  await expect(assessmentGrant).toHaveCount(1);
  await expect(assessmentGrant.getByText(/1 assessment \/ 4 read receipts \/ 8 claims \/ 32 cited indexes \/ 512 structured tokens/)).toBeVisible();

  const decisionGrant = production.locator('[data-production-grant-id]').filter({ hasText: "analysis.evidence.decide" });
  await expect(decisionGrant).toHaveCount(1);
  await expect(decisionGrant.getByText(/1 decision \/ 4 audited assessments/)).toBeVisible();

  const assessments = production.locator('[data-production-region="evidence-assessments"]');
  await expect(assessments.getByRole("heading", { name: "Evidence assessments" })).toBeVisible();
  await expect(assessments.locator('[data-production-empty="evidence-assessments"]')).toHaveCount(0);
  const assessment = assessments.locator('[data-production-evidence-assessment-id]');
  await expect(assessment).toHaveCount(1);
  await expect(assessment).toHaveAttribute("data-status", "completed");
  await expect(assessment.getByRole("heading", { name: "analysis.evidence.assess" })).toBeVisible();
  await expect(assessment.getByText(/^evidence-assessment:/)).toBeVisible();
  await expect(assessment.locator('[data-production-navigation="artifact"]')).toHaveCount(1);

  const assessmentArtifacts = production.locator('[data-production-region="assessment-artifacts"]');
  await expect(assessmentArtifacts.getByRole("heading", { name: "Assessment artifacts" })).toBeVisible();
  await expect(assessmentArtifacts.locator('[data-production-empty="assessment-artifacts"]')).toHaveCount(0);
  const assessmentArtifact = assessmentArtifacts.locator('[data-production-assessment-artifact-id]');
  await expect(assessmentArtifact).toHaveCount(1);
  await expect(assessmentArtifact.getByRole("heading", { name: "evidence-assessment-receipt" })).toBeVisible();
  await expect(assessmentArtifact.locator('[data-production-navigation="task"]')).toHaveCount(1);
  await expect(assessmentArtifact.locator('[data-production-navigation="worker"]')).toHaveCount(1);
  await expect(assessmentArtifact.locator('[data-production-navigation="operation"]')).toHaveCount(1);

  const assessmentAudits = production.locator('[data-production-region="assessment-receipt-audits"]');
  await expect(assessmentAudits.getByRole("heading", { name: "Assessment receipt audit" })).toBeVisible();
  await expect(assessmentAudits.locator('[data-production-empty="assessment-receipt-audits"]')).toHaveCount(0);
  const assessmentAudit = assessmentAudits.locator('[data-production-assessment-audit-id]');
  await expect(assessmentAudit).toHaveCount(1);
  await expect(assessmentAudit).toHaveAttribute(
    "data-integrity",
    "stored_receipt_and_citations_verified",
  );
  await expect(assessmentAudit.getByText(/does not certify the assessment meaning|Stored bytes rehashed/).first()).toBeVisible();
  const claims = assessmentAudit.locator('[data-production-assessment-claim-index]');
  await expect(claims).toHaveCount(2);
  await expect(assessmentAudit.locator('[data-production-assessment-claim-index][data-claim-kind="speech_activity"]')).toHaveCount(1);
  await expect(assessmentAudit.locator('[data-production-assessment-claim-index][data-claim-kind="language_identity"]')).toHaveCount(1);
  await expect(claims.getByText(/Exact range/)).toHaveCount(2);
  await expect(claims.getByText(/Preserved states/)).toHaveCount(2);
  const citations = assessmentAudit.locator('[data-production-assessment-citation-receipt-id]');
  await expect(citations).toHaveCount(2);
  await expect(citations.getByText(/Fact indexes/)).toHaveCount(2);
  await expect(citations.locator('[data-production-navigation="receipt"]')).toHaveCount(2);
  for (const link of await assessmentAudit.locator("[data-production-navigation]").all()) {
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^#product-production-(task|worker|operation|artifact|receipt)-/);
    expect(href).not.toContain("/studio/runtime");
    expect(
      await page.evaluate((target) => Boolean(target && document.getElementById(target.slice(1))), href),
    ).toBe(true);
  }

  const decisions = production.locator('[data-production-region="evidence-decisions"]');
  await expect(decisions.getByRole("heading", { name: "Evidence decisions" })).toBeVisible();
  await expect(decisions.locator('[data-production-empty="evidence-decisions"]')).toHaveCount(0);
  const decision = decisions.locator('[data-production-evidence-decision-id]');
  await expect(decision).toHaveCount(1);
  await expect(decision).toHaveAttribute("data-status", "completed");
  await expect(decision).toHaveAttribute("data-decision-outcome", "proceed_to_publish_review");
  await expect(decision.getByRole("heading", { name: "analysis.evidence.decide" })).toBeVisible();
  await expect(decision.getByText(/^evidence-decision:/)).toBeVisible();
  await expect(decision.locator('[data-production-navigation="operation"]')).toHaveCount(1);
  await expect(decision.locator('[data-production-navigation="artifact"]')).toHaveCount(2);

  const decisionArtifacts = production.locator('[data-production-region="decision-artifacts"]');
  await expect(decisionArtifacts.getByRole("heading", { name: "Decision artifacts" })).toBeVisible();
  await expect(decisionArtifacts.locator('[data-production-empty="decision-artifacts"]')).toHaveCount(0);
  const decisionArtifact = decisionArtifacts.locator('[data-production-decision-artifact-id]');
  await expect(decisionArtifact).toHaveCount(1);
  await expect(decisionArtifact.getByRole("heading", { name: "evidence-decision-receipt" })).toBeVisible();
  await expect(decisionArtifact.locator('[data-production-navigation="task"]')).toHaveCount(1);
  await expect(decisionArtifact.locator('[data-production-navigation="worker"]')).toHaveCount(1);
  await expect(decisionArtifact.locator('[data-production-navigation="operation"]')).toHaveCount(1);

  const decisionReceipts = production.locator('[data-production-region="decision-receipts"]');
  await expect(decisionReceipts.getByRole("heading", { name: "Publish-review decision receipts" })).toBeVisible();
  await expect(decisionReceipts.locator('[data-production-empty="decision-receipts"]')).toHaveCount(0);
  const decisionReceipt = decisionReceipts.locator('[data-production-decision-receipt-id]');
  await expect(decisionReceipt).toHaveCount(1);
  await expect(decisionReceipt).toHaveAttribute("data-integrity", "stored_decision_and_audited_inputs_verified");
  await expect(decisionReceipt).toHaveAttribute("data-decision-outcome", "proceed_to_publish_review");
  await expect(decisionReceipt).toHaveAttribute("data-decision-producer", "deterministic_audit_state_gate_v1");
  await expect(decisionReceipt.locator('[data-production-decision-reason-code]')).toHaveCount(1);
  await expect(decisionReceipt.locator('[data-production-decision-reason-code="all_audited_claims_supported"]')).toHaveCount(1);
  await expect(decisionReceipt.locator('[data-production-decision-input-operation-id]')).toHaveCount(1);
  await expect(decisionReceipts.getByText(/unreviewed queue|does not mean captions exist/)).toBeVisible();
  for (const link of await decisionReceipt.locator("[data-production-navigation]").all()) {
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^#product-production-(operation|artifact)-/);
    expect(
      await page.evaluate((target) => Boolean(target && document.getElementById(target.slice(1))), href),
    ).toBe(true);
  }

  const reviewIntakes = production.locator('[data-production-region="publish-review-intakes"]');
  await expect(reviewIntakes.getByRole("heading", { name: "Publish-review intake lineage" })).toBeVisible();
  await expect(reviewIntakes.locator('[data-production-empty="publish-review-intakes"]')).toHaveCount(0);
  const reviewIntake = reviewIntakes.locator('[data-production-publish-review-intake-id]');
  await expect(reviewIntake).toHaveCount(1);
  await expect(reviewIntake).toHaveAttribute("data-status", "completed");
  await expect(reviewIntake).toHaveAttribute("data-intake-outcome", "queued");
  await expect(reviewIntake.locator('[data-production-intake-reason-code="all_audited_claims_supported"]')).toHaveCount(1);
  await expect(reviewIntakes.getByText(/awaiting review only|does not mean reviewed/)).toBeVisible();

  const reviewIntakeArtifacts = production.locator('[data-production-region="publish-review-intake-artifacts"]');
  await expect(reviewIntakeArtifacts.getByRole("heading", { name: "Publish-review intake artifacts" })).toBeVisible();
  await expect(reviewIntakeArtifacts.locator('[data-production-empty="publish-review-intake-artifacts"]')).toHaveCount(0);
  const reviewIntakeArtifact = reviewIntakeArtifacts.locator('[data-production-publish-review-intake-artifact-id]');
  await expect(reviewIntakeArtifact).toHaveCount(1);
  await expect(reviewIntakeArtifact.getByRole("heading", { name: "publish-review-intake-receipt" })).toBeVisible();

  const verifiedReviewIntakes = production.locator('[data-production-region="publish-review-intake-receipts"]');
  await expect(verifiedReviewIntakes.getByRole("heading", { name: "Verified publish-review intake receipts" })).toBeVisible();
  await expect(verifiedReviewIntakes.locator('[data-production-empty="publish-review-intake-receipts"]')).toHaveCount(0);
  const verifiedReviewIntake = verifiedReviewIntakes.locator('[data-production-publish-review-intake-receipt-id]');
  await expect(verifiedReviewIntake).toHaveCount(1);
  await expect(verifiedReviewIntake).toHaveAttribute("data-integrity", "stored_intake_and_verified_study_readiness");
  await expect(verifiedReviewIntake).toHaveAttribute("data-intake-outcome", "queued");
  await expect(verifiedReviewIntake).toHaveAttribute("data-intake-producer", "host_publish_review_intake_v1");
  await expect(verifiedReviewIntake.locator('[data-production-verified-intake-reason-code="all_audited_claims_supported"]')).toHaveCount(1);
  await expect(verifiedReviewIntakes.getByText(/unreviewed and unpublished/)).toBeVisible();
  for (const link of await verifiedReviewIntake.locator("[data-production-navigation]").all()) {
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^#product-production-(operation|artifact)-/);
    expect(
      await page.evaluate((target) => Boolean(target && document.getElementById(target.slice(1))), href),
    ).toBe(true);
  }

  await expect(production.locator('[data-production-region="operations"]')).toBeVisible();
  await expect(production.getByRole("heading", { name: "Production operations" })).toBeVisible();
  await expect(production.locator('[data-production-empty="operations"]')).toHaveCount(0);
  const operation = production.locator("[data-production-operation-id]");
  await expect(operation).toHaveCount(1);
  await expect(operation).toHaveAttribute("data-status", "completed");
  await expect(operation.getByRole("heading", { name: "media.seek" })).toBeVisible();
  await expect(operation.getByText(/^receipt:/)).toBeVisible();
  await expect(operation.locator('[data-production-navigation="artifact"]')).toHaveCount(2);

  const seekArtifact = production.locator('[data-production-output-artifact-id][data-origin-kind="media_observation"]');
  await expect(seekArtifact).toHaveCount(1);
  await expect(seekArtifact.locator('[data-production-navigation="operation"]')).toHaveCount(1);
  await expect(seekArtifact.locator('[data-production-navigation="artifact"]')).toHaveCount(1);

  const artifact = production.locator('[data-production-output-artifact-id][data-origin-kind="worker_output"]');
  await expect(artifact).toHaveAttribute("data-origin-kind", "worker_output");
  const links = artifact.locator("[data-production-navigation]");
  await expect(links).toHaveCount(4);
  await expect(artifact.locator('[data-production-navigation="task"]')).toHaveCount(1);
  await expect(artifact.locator('[data-production-navigation="worker"]')).toHaveCount(1);
  await expect(artifact.locator('[data-production-navigation="execution"]')).toHaveCount(1);
  await expect(artifact.locator('[data-production-navigation="report"]')).toHaveCount(1);

  for (const link of await links.all()) {
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^#product-production-(task|worker|execution|report)-/);
    expect(href).not.toContain("/studio/runtime");
    expect(
      await page.evaluate((target) => Boolean(target && document.getElementById(target.slice(1))), href),
    ).toBe(true);
  }

  const taskLink = artifact.locator('[data-production-navigation="task"]');
  const taskHref = await taskLink.getAttribute("href");
  await taskLink.click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(taskHref);

  const sourceHref = await sourceLinks.first().getAttribute("href");
  await sourceLinks.first().click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(sourceHref);
});

test("armed fine-tune prepares a receipted moments overlay that stays silent without justified help", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  test.skip(testInfo.project.name !== "desktop", "one deterministic desktop learning-prep path is sufficient");

  const { DeterministicCurrentRunCaptionTestExecutor } = await import(
    "../../src/studio/runtime/production/runtimeHost/index.ts"
  );
  const { DeterministicLearningPrepTestExecutor } = await import(
    "../../src/studio/runtime/production/learningPrep/deterministicTestExecutor.ts"
  );

  const prepExecutor = new DeterministicLearningPrepTestExecutor((input) => ({
    segmentation: { mode: "watch_through", reasonCode: "no_beat_boundaries_warranted" },
    candidates: [
      {
        lens: "situating",
        lineId: input.lines[0].lineId,
        availability: "available",
        reasonCode: null,
        content: { situation: "The clip opens with one speaker naming the current scene." },
      },
      ...(input.lines.length > 1
        ? [{
            lens: "culture_reference" as const,
            lineId: input.lines[1].lineId,
            availability: "withheld" as const,
            reasonCode: "external_grounding_unavailable" as const,
            content: null,
          }]
        : []),
    ],
    lensAbstentions: [
      { lens: "historical_reference", reasonCode: "no_reference_detected" },
    ],
  }));

  const fixtures = [
    { label: "prepared", learningPrepExecutor: prepExecutor },
    { label: "unconfigured", learningPrepExecutor: undefined },
  ] as const;

  for (const fixture of fixtures) {
    const directory = await mkdtemp(join(tmpdir(), `studio-learning-prep-browser-${fixture.label}-`));
    const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [resolve("public/demo/runs/run-005")] });
    const store = await DurableRuntimeCommandStore.open(join(directory, "runtime"));
    const service = await RuntimeStartService.open({
      store,
      sources,
      launcherFactory: new DeterministicRuntimeExecutor({}).factory(),
      orchestratorLauncherFactory: deterministicOrchestratorLauncherFactory(),
      captionExecutor: new DeterministicCurrentRunCaptionTestExecutor(),
      learningPrepExecutor: fixture.learningPrepExecutor,
      recoverOnOpen: false,
    });
    const token = "e".repeat(64);
    await page.goto("/studio/");
    const origin = new URL(page.url()).origin;
    const server = createRuntimeHostHttpServer({ service, token, allowedOrigins: [origin] });
    const learningPrepPosts: Request[] = [];
    await page.route("**/v1/runtimes/*/learning-preps", async (route) => {
      if (route.request().method() === "POST") learningPrepPosts.push(route.request());
      await route.continue();
    });
    try {
      const address = await listenRuntimeHost(server, { port: 0 });
      const url = `http://${address.host}:${address.port}`;
      const production = await openCompletedDeterministicProjection(page, 47.2, { url, token });

      const review = production.locator('[data-production-region="publish-review-human-review"]');
      const control = review.locator("[data-production-review-control-intake-id]");
      await expect(control).toHaveCount(1, { timeout: 15_000 });
      await control.locator("[data-production-review-attestation]").check();
      await control.locator('[data-production-review-action="approve_for_caption_production"]').click();
      const captions = production.locator('[data-production-region="caption-production"]');
      await captions.locator('[data-production-caption-action="start"]').click();
      const productionResults = page.locator('[data-production-results-region="caption-lineage"]');
      await expect(productionResults.locator("[data-production-results-job-id]")).toHaveCount(1, { timeout: 15_000 });

      const face = productionResults.getByRole("region", { name: "Customize learning" });
      await expect(face).toHaveAttribute("data-learning-prep-state", "not_requested");
      await expect(face).toContainText("never verified culture or history");
      const prepare = face.locator('[data-fine-tune-action="prepare"]');
      await expect(prepare).toBeDisabled();
      await face.locator('[data-fine-tune-lens="situating"] input').check();
      await face.locator('[data-fine-tune-lens="culture_reference"] input').check();
      await face.locator('[data-fine-tune-lens="historical_reference"] input').check();
      await face.locator('[data-fine-tune-temperature="low"] input').check();
      await expect(face).toHaveAttribute("data-armed-lenses", "situating,culture_reference,historical_reference");
      await expect(face).toHaveAttribute("data-temperature", "low");
      await expect(prepare).toBeEnabled();
      await prepare.click();

      await expect.poll(() => learningPrepPosts.length).toBe(1);
      const posted = learningPrepPosts[0].postDataJSON() as {
        caption: { jobId: string };
        fineTune: { schema: string; armedLenses: string[]; temperature: string };
      };
      expect(posted.fineTune).toEqual({
        schema: "studio.learning-fine-tune.v1",
        armedLenses: ["situating", "culture_reference", "historical_reference"],
        temperature: "low",
      });
      const resultsJobId = await productionResults
        .locator("[data-production-results-job-id]")
        .getAttribute("data-production-results-job-id");
      expect(posted.caption.jobId).toBe(resultsJobId);

      if (fixture.learningPrepExecutor) {
        await expect(face).toHaveAttribute("data-learning-prep-state", "ready", { timeout: 15_000 });
        await expect(face).toHaveAttribute("data-learning-prep-result-state", "partial");
        await expect(face.locator('[data-prep-lens="situating"]')).toHaveAttribute("data-lens-state", "surfaced");
        await expect(face.locator('[data-prep-lens="culture_reference"]')).toHaveAttribute("data-lens-state", "surfaced");
        await expect(face.locator('[data-prep-lens="historical_reference"]')).toHaveAttribute("data-lens-state", "abstained");
        await expect(face).toContainText("Withheld and abstained help stays withheld");
        await expect(face).toContainText("not culture or history authority");

        const privatePlayer = productionResults.getByRole("region", { name: "Private production media playback" });
        await expect(privatePlayer).toHaveAttribute("data-private-playback-state", "ready", { timeout: 15_000 });
        const overlay = page.locator('[data-moments-overlay-state="active"]');
        await expect(overlay).toHaveCount(1, { timeout: 10_000 });
        await expect(overlay).toHaveAttribute("data-moments-lens", "situating");
        await expect(overlay).toContainText("naming the current scene");
        await expect(overlay).toContainText("unreviewed note");

        const learning = productionResults.getByRole("region", { name: "Language learning workspace" });
        const secondCue = learning.locator("[data-production-results-line-id]").nth(1);
        await secondCue.getByRole("button", { name: /^Seek to / }).click();
        await expect(secondCue).toHaveClass(/is-active/, { timeout: 10_000 });
        await expect(page.locator('[data-moments-overlay-state="active"]')).toHaveCount(0);
      } else {
        await expect(face).toHaveAttribute("data-learning-prep-state", "unavailable", { timeout: 15_000 });
        await expect(face.locator('[data-reason-code="production_prep_executor_unavailable"]')).toBeVisible();
        await expect(face.locator('[data-fine-tune-action="retry"]')).toHaveCount(0);
      }
    } finally {
      await page.unroute("**/v1/runtimes/*/learning-preps");
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  }
});
