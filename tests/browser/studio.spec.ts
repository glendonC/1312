import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { canonicalJsonLine } from "../../src/studio/runtime/production/observability/hash.ts";
import {
  DurableRuntimeCommandStore,
  DeterministicRuntimeExecutor,
  RuntimeSourceRegistry,
  RuntimeStartService,
  YouTubeLocalIngestService,
  createRuntimeHostHttpServer,
  listenRuntimeHost,
} from "../../src/studio/runtime/production/runtimeHost/index.ts";

function sourceResolutionReceipt(url: string, durationMs = 83_000) {
  const payload = {
    schema: "studio.remote-source-resolution.v1" as const,
    producer: {
      id: "studio.youtube-metadata-resolver" as const,
      version: "1" as const,
      tool: { id: "yt-dlp" as const, version: "fixture" },
    },
    resolvedAt: "2026-07-16T12:00:00.000Z",
    request: { url: new URL(url).toString() },
    source: {
      kind: "youtube" as const,
      canonicalUrl: "https://www.youtube.com/watch?v=fixturevideo",
      externalId: "fixturevideo",
      label: "Resolved browser-test video",
      creator: "Recorded test producer",
      durationMs,
      durationMeasurement: {
        kind: "provider_metadata" as const,
        field: "duration" as const,
        producer: "yt-dlp" as const,
      },
    },
  };
  const bytes = Buffer.from(canonicalJsonLine(payload), "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    ...payload,
    resolutionId: `source-resolution:${digest}`,
    content: {
      algorithm: "sha256" as const,
      digest,
      contentId: `sha256:${digest}`,
      bytes: bytes.byteLength,
    },
  };
}

async function openLab(page: Page): Promise<void> {
  await page.goto("/studio/?lab=1");
  await expect(page.getByRole("button", { name: "Input Source" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Studio trace lab" })).toBeVisible();
}

function scenario(page: Page) {
  return page.getByLabel("Exact scenario");
}

function readout(page: Page) {
  return page.locator(".lab-readout b");
}

function productStudioUrl(): string {
  const runtimeHost = process.env.STUDIO_RUNTIME_HOST_URL;
  return runtimeHost ? `/studio/?runtimeHost=${encodeURIComponent(runtimeHost)}` : "/studio/";
}

async function openSourceChooser(page: Page): Promise<Locator> {
  const trigger = page.getByRole("button", { name: "Choose source: local or recorded" });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  const panel = page.getByRole("dialog", { name: "Choose a Studio source" });
  await expect(panel).toBeVisible();
  return panel;
}

async function chooseSource(page: Page, name: string): Promise<void> {
  const panel = await openSourceChooser(page);
  await panel.getByRole("button", { name, exact: true }).click();
}

async function finishPreparation(page: Page, keyboard = false): Promise<void> {
  for (const label of [
    "Continue to Range",
    "Continue to Language",
    "Continue to Output",
    "Continue to Forecast",
  ]) {
    const action = page.getByRole("button", { name: label });
    if (keyboard) await action.press("Enter");
    else await action.click();
  }
  await expect(page.getByRole("heading", { name: /^I’ve bound / })).toBeVisible();
  const reviewAction = page.getByRole("button", { name: "Continue to Review" });
  if (keyboard) await reviewAction.press("Enter");
  else await reviewAction.click();
  await expect(page.getByRole("heading", {
    name: /^I’m ready to replay this recorded analysis/,
  })).toBeVisible();
  const finalAction = page.getByRole("button", { name: "Replay recorded analysis" });
  if (keyboard) await finalAction.press("Enter");
  else await finalAction.click();
}

async function startRecordedDemo(page: Page): Promise<void> {
  await chooseSource(page, "Explore the recorded run-006 demo");
  await finishPreparation(page);
}

function ownedWav(seed: number): Buffer {
  const sampleRate = 8_000;
  const samples = sampleRate;
  const dataBytes = samples * 2;
  const output = Buffer.alloc(44 + dataBytes);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.round(Math.sin((index + seed) * 2 * Math.PI * 220 / sampleRate) * 2_000);
    output.writeInt16LE(sample, 44 + index * 2);
  }
  return output;
}

async function settledBox(page: Page, locator: Locator) {
  let previous = await locator.boundingBox();
  let stableSamples = 0;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(180);
    const current = await locator.boundingBox();
    if (!previous || !current) {
      previous = current;
      stableSamples = 0;
      continue;
    }

    const delta = Math.max(
      Math.abs(previous.x - current.x),
      Math.abs(previous.y - current.y),
      Math.abs(previous.width - current.width),
      Math.abs(previous.height - current.height),
    );
    stableSamples = delta <= 0.5 ? stableSamples + 1 : 0;
    previous = current;
    if (stableSamples >= 3) return current;
  }

  throw new Error("Agent node did not settle before focus opened.");
}

async function expectFocusSettled(focus: Locator): Promise<void> {
  await expect(focus.locator(".agent-focus-hero")).toHaveCSS("opacity", "1");
  await expect(focus.locator(".agent-focus-shell")).toHaveCSS("opacity", "1");
}

async function renderedDifference(
  page: Page,
  before: Uint8Array,
  after: Uint8Array,
): Promise<number> {
  return page.evaluate(
    async ({ beforeBase64, afterBase64 }) => {
      const load = async (base64: string) =>
        createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const [beforeImage, afterImage] = await Promise.all([
        load(beforeBase64),
        load(afterBase64),
      ]);
      const sample = new OffscreenCanvas(16, 16);
      const context = sample.getContext("2d");
      if (!context) return 0;

      context.drawImage(beforeImage, 0, 0, 16, 16);
      const beforePixels = context.getImageData(0, 0, 16, 16).data;
      context.clearRect(0, 0, 16, 16);
      context.drawImage(afterImage, 0, 0, 16, 16);
      const afterPixels = context.getImageData(0, 0, 16, 16).data;
      beforeImage.close();
      afterImage.close();

      let difference = 0;
      let channels = 0;
      for (let index = 0; index < beforePixels.length; index += 4) {
        difference += Math.abs(beforePixels[index] - afterPixels[index]);
        difference += Math.abs(beforePixels[index + 1] - afterPixels[index + 1]);
        difference += Math.abs(beforePixels[index + 2] - afterPixels[index + 2]);
        channels += 3;
      }
      return difference / (channels * 255);
    },
    {
      beforeBase64: Buffer.from(before).toString("base64"),
      afterBase64: Buffer.from(after).toString("base64"),
    },
  );
}

test("the lab is opt-in during development", async ({ page }) => {
  await page.goto("/studio/");
  await expect(page.getByRole("button", { name: "Input Source" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose source: local or recorded" })).toBeVisible();
  await expect((await openSourceChooser(page)).getByRole("button", { name: "Process a file I own locally" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Studio trace lab" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Local runtime host" })).toHaveCount(0);

  await openLab(page);
  await page.getByText("Local runtime host", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Local runtime host" })).toBeVisible();
  await expect(page.getByText("development-only · separate from replay")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect to local host" })).toBeDisabled();
});

test("the default Studio exposes a separate owned-source operator path", async ({ page }) => {
  await page.goto("/studio/");
  await chooseSource(page, "Process a file I own locally");

  const productRuntime = page.getByRole("region", { name: "Owned local source" });
  await expect(productRuntime).toBeVisible();
  await productRuntime.getByRole("button", { name: "Open about this local production path" }).click();
  await expect(productRuntime.getByText(/a separate private caption job may be explicitly requested/)).toBeVisible();
  await expect(productRuntime.getByText(/Neither path uploads or publishes/)).toBeVisible();
  await expect(productRuntime.getByText(/Submitted YouTube URLs remain unprocessed recorded previews/)).toBeVisible();
  await page.keyboard.press("Escape");
  await productRuntime.getByRole("button", { name: "Open connect to local host" }).click();
  await productRuntime.getByText("Local host setup and CLI escape hatch").click();
  await expect(productRuntime.getByText(/run-runtime-host\.ts --executor deterministic/)).toBeVisible();
  await expect(productRuntime.getByText(/--source-directory/)).toBeVisible();
  await expect(productRuntime.getByRole("button", { name: "Connect to local host", exact: true })).toBeDisabled();

  await productRuntime.getByRole("button", { name: "Exit setup" }).click();
  await expect(page.getByRole("button", { name: "Input Source" })).toBeVisible();
  await expect((await openSourceChooser(page)).getByRole("button", { name: "Explore the recorded run-006 demo" })).toBeVisible();
});

test("recorded and owned setup paths share the centered staged panel", async ({ page }) => {
  await page.goto("/studio/");
  const dockBefore = await page.locator(".studio-source-dock").boundingBox();

  await chooseSource(page, "Explore the recorded run-006 demo");
  const recorded = page.locator('.preflight[data-preview-mode="recorded-demo"]');
  const recordedPanel = recorded.locator(".preflight-stage-panel");
  await expect(recorded.locator(".preflight-stage-nav button")).toHaveCount(6);
  await expect(recordedPanel).toBeVisible();
  await expect(recorded).toHaveCSS("position", "relative");
  await expect(recorded).toHaveCSS("box-shadow", "none");
  await expect(recorded).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByRole("button", { name: "01 Source" })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("button", { name: "02 Range" })).toBeDisabled();
  const recordedLifecycle = page.getByLabel("Studio lifecycle");
  await expect(recordedLifecycle).toHaveAttribute("data-lifecycle-mode", "preparation");
  await expect(recordedLifecycle).toHaveAttribute("data-preparation-stage", "source");
  await expect(recordedLifecycle.locator(".dock-status")).toHaveText("Source");
  await expect(recordedLifecycle.locator(".dock-pct")).toHaveText("1 / 6");

  const dockDuringRecorded = await page.locator(".studio-source-dock").boundingBox();
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs((dockDuringRecorded?.[key] ?? Infinity) - (dockBefore?.[key] ?? -Infinity))).toBeLessThanOrEqual(2);
  }

  await page.goto("/studio/");

  await chooseSource(page, "Process a file I own locally");
  const owned = page.getByRole("region", { name: "Owned local source" });
  await expect(owned.locator(".preflight-stage-nav button")).toHaveCount(6);
  await expect(owned.locator(".preflight-stage-panel")).toBeVisible();
  await expect(owned.locator(".product-runtime-header")).toHaveCount(0);
  await expect(owned).toHaveAttribute("data-runtime", "false");
  await expect(owned.getByRole("button", { name: "Continue to Range" })).toBeDisabled();
  const ownedLifecycle = owned.getByLabel("Studio lifecycle");
  await expect(ownedLifecycle).toHaveAttribute("data-lifecycle-mode", "preparation");
  await expect(ownedLifecycle).toHaveAttribute("data-preparation-stage", "source");
  await expect(ownedLifecycle.locator(".dock-status")).toHaveText("Source");
  await expect(ownedLifecycle.locator(".dock-pct")).toHaveText("1 / 6");
  await owned.getByRole("button", { name: "Exit setup" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Studio/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
});

test("the development processing fixture exposes honest running state and worker focus", async ({ page }) => {
  await page.goto("/studio/?processingMock=running");

  const fixture = page.getByRole("region", { name: "Processing contract fixture" });
  await expect(fixture.getByText("Development contract fixture · no host work")).toBeVisible();
  await expect(fixture.getByText(/creates no receipt or artifact/)).toBeVisible();

  const canvas = fixture.getByRole("region", { name: "Processing canvas" });
  await expect(canvas.getByRole("heading", { name: "Running" })).toBeVisible();
  await expect(canvas.getByText("13 validated events")).toBeVisible();
  await expect(canvas.getByText("media.operation_started", { exact: true })).toHaveCount(2);
  await expect(canvas.getByRole("heading", { name: "2 workers are active" })).toBeVisible();
  await expect(canvas.getByRole("heading", { name: "No usable caption artifact" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Pause" })).toHaveCount(0);
  await expect(canvas.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(canvas.getByText(/no pause or cancellation command/)).toHaveCount(1);

  const worker = canvas.getByRole("button", { name: "Inspect bounded-media-child, Working" });
  await expect(worker.locator("small.text-shimmer")).toHaveClass(/text-shimmer/);
  await worker.click();
  const focus = page.getByRole("dialog", { name: "bounded-media-child" });
  await expect(focus).toBeVisible();
  await expect(focus.getByText(/not an autonomous playback control/)).toBeVisible();
  const activity = focus.locator(".processing-focus-activity");
  await expect(activity).toHaveAttribute("data-activity-follow", "latest");
  await expect(activity.locator(".processing-focus-activity-scroll")).toHaveCSS("scroll-behavior", "smooth");
  await expect(activity.locator("dl")).toHaveAttribute("aria-live", "polite");
  await expect(activity.locator("[data-processing-focus-activity-row]")).toHaveCount(5);
  await expect(activity.getByRole("button", { name: "New activity" })).toHaveCount(0);
  await expect(activity.locator('[data-processing-focus-activity-row="execution"]')).toContainText(
    "active · determ…shot",
  );
  await focus.getByRole("button", { name: "Close" }).press("Escape");
  await expect(focus).toHaveCount(0);
  await expect(worker).toBeFocused();
});

test("the development processing fixture separates a journal connection error from runtime failure", async ({ page }) => {
  await page.goto("/studio/?processingMock=poll-error");

  const canvas = page.getByRole("region", { name: "Processing canvas" });
  await expect(canvas.getByRole("heading", { name: "Journal updates paused" })).toBeVisible();
  await expect(canvas.getByText(/fixture transport is unavailable/)).toBeVisible();
  const retry = canvas.getByRole("button", { name: "Retry from cursor 13" });
  await retry.click();
  await expect(canvas.getByRole("heading", { name: "Running" })).toBeVisible();
  await expect(canvas.getByText("Healthy at validated journal head 13.")).toBeVisible();
  await expect(retry).toHaveCount(0);

  await page.goto("/studio/?processingMock=failed");
  const failed = page.getByRole("region", { name: "Processing canvas" });
  await expect(failed.getByRole("heading", { name: "Failed" })).toBeVisible();
  await expect(failed.getByText(/executor closed without a successful terminal result/)).toBeVisible();
  await expect(failed.getByRole("button", { name: "Prepare another run" })).toBeVisible();
});

test("owned browser media requires rights, registers, and continues through the existing plan/start flow", async ({ page }, testInfo) => {
  const token = process.env.STUDIO_RUNTIME_HOST_TOKEN;
  test.skip(testInfo.project.name !== "desktop", "one ingest is sufficient across browser projects");
  test.skip(!token, "requires an operator-started deterministic runtime host");

  await page.goto(productStudioUrl());
  await chooseSource(page, "Process a file I own locally");
  const productRuntime = page.getByRole("region", { name: "Owned local source" });
  await productRuntime.getByLabel("Paste-once bearer token").fill(token ?? "");
  await productRuntime.getByRole("button", { name: "Connect to local host" }).click();

  await productRuntime.getByLabel("Owned media file").setInputFiles({
    name: "browser-owned.wav",
    mimeType: "audio/wav",
    buffer: ownedWav(Date.now() % 8_000),
  });
  await productRuntime.getByLabel("Source label").fill("Browser-owned WAV");
  await productRuntime.getByLabel("Rights holder").fill("Browser Test Studio");
  const confirm = productRuntime.getByRole("button", { name: "Confirm ownership and ingest" });
  await expect(confirm).toBeDisabled();
  await productRuntime.getByLabel(/I attest that I own or control this media/).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const progress = productRuntime.getByRole("status", { name: "Owned media ingest progress" });
  await expect(progress).toHaveAttribute("data-state", "registered", { timeout: 15_000 });
  await expect(progress).toContainText("source is registered and selected");
  await expect(productRuntime.getByLabel("Registered owned source")).toContainText("Browser-owned WAV");
  await expect(productRuntime.locator(".product-runtime-source-facts").getByText("Unavailable", { exact: true })).toBeVisible();

  await productRuntime.getByRole("button", { name: "Continue to Range" }).click();
  await productRuntime.getByRole("button", { name: "Continue to Language" }).click();
  await productRuntime.getByLabel("Declared source language").fill("ko");
  await productRuntime.getByRole("button", { name: "Continue to Output" }).click();
  await productRuntime.getByRole("button", { name: "Continue to Forecast" }).click();
  const plan = productRuntime.getByRole("region", { name: "Review the local runtime plan" });
  await expect(plan).toBeVisible();
  await productRuntime.getByRole("button", { name: "Continue to Review" }).click();
  await productRuntime.getByRole("button", { name: "Accept forecast and start local runtime" }).click();
  const status = productRuntime.getByRole("region", { name: "Local runtime status" });
  await expect(status.getByRole("heading", { name: "Terminal", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.studio[data-stage="input"]')).toBeVisible();
  await expect(page.locator(".hub")).toHaveCount(0);
});

test("the product path reviews and freezes an exact local forecast without entering replay", async ({ page }) => {
  const token = process.env.STUDIO_RUNTIME_HOST_TOKEN;
  test.skip(!token, "requires an operator-started deterministic runtime host");

  await page.goto(productStudioUrl());
  await chooseSource(page, "Process a file I own locally");
  const productRuntime = page.getByRole("region", { name: "Owned local source" });
  await productRuntime.getByLabel("Paste-once bearer token").fill(token ?? "");
  await productRuntime.getByRole("button", { name: "Connect to local host" }).click();
  await expect(productRuntime.getByLabel("Registered owned source")).toBeVisible();
  await expect(productRuntime.getByText("Owned/local", { exact: false })).toBeVisible();

  await productRuntime.getByRole("button", { name: "Continue to Range" }).click();
  await productRuntime.getByRole("button", { name: "Continue to Language" }).click();
  await productRuntime.getByLabel("Declared source language").fill("ko");
  await productRuntime.getByLabel("Language-pack identity (optional)").fill("ko-v3");
  await productRuntime.getByRole("button", { name: "Continue to Output" }).click();
  await productRuntime.getByRole("button", { name: "Continue to Forecast" }).click();

  const plan = productRuntime.getByRole("region", { name: "Review the local runtime plan" });
  await expect(plan.getByText("studio.forecast.v1 · not started or frozen")).toBeVisible();
  await expect(plan.getByText("Workload floor")).toBeVisible();
  await expect(plan.getByText("Unavailable", { exact: true })).toHaveCount(2);
  await expect(plan.getByText(/Unavailable · amount and currency are null/)).toBeVisible();

  await productRuntime.getByRole("button", { name: "Continue to Review" }).click();
  await productRuntime.getByRole("button", { name: "Accept forecast and start local runtime" }).click();
  const status = productRuntime.getByRole("region", { name: "Local runtime status" });
  await expect(status.getByRole("heading", { name: "Terminal", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(status.getByText(/Closed at validated journal head/)).toBeVisible();
  const production = status.getByRole("region", { name: "Production task and handoff facts" });
  await expect(production).toBeVisible();
  await expect(production.getByText(/recorded production evidence, not a presence signal/)).toBeVisible();
  await expect(production.locator("[data-production-task-id]")).toHaveCount(2);
  await expect(production.locator("[data-production-worker-id]")).toHaveCount(2);
  await expect(production.locator("[data-production-grant-id]")).toHaveCount(6);
  await expect(production.locator("[data-production-report-id]")).toHaveCount(1);
  await expect(production.locator("[data-production-spawn-request-id]")).toHaveCount(1);
  await expect(production.locator('[data-production-spawn-request-id][data-decision="accepted"]')).toBeVisible();
  await expect(production.locator("[data-production-output-artifact-id]")).toHaveCount(2);
  await expect(production.locator('[data-production-output-artifact-id][data-origin-kind="worker_output"]')).toBeVisible();
  await expect(production.getByRole("heading", { name: "Production tasks" })).toBeVisible();
  await expect(production.getByRole("heading", { name: "Spawn requests and decisions" })).toBeVisible();
  await expect(production.getByRole("heading", { name: "Registered workers" })).toBeVisible();
  await expect(production.getByRole("heading", { name: "Capability grants" })).toBeVisible();
  await expect(production.getByRole("heading", { name: "Output artifact lineage" })).toBeVisible();
  await expect(production.getByRole("heading", { name: "Structured reports" })).toBeVisible();
  await expect(page.locator('.studio[data-stage="input"]')).toBeVisible();
  await expect(page.locator(".hub")).toHaveCount(0);
});

test("the lab starts and polls an explicitly running deterministic host without changing replay state", async ({ page }) => {
  const token = process.env.STUDIO_RUNTIME_HOST_TOKEN;
  test.skip(!token, "requires an operator-started deterministic runtime host");

  await openLab(page);
  await page.getByText("Local runtime host", { exact: true }).click();
  const localRuntime = page.getByRole("region", { name: "Local runtime host" });
  if (process.env.STUDIO_RUNTIME_HOST_URL) {
    await localRuntime.getByLabel("Host origin").fill(process.env.STUDIO_RUNTIME_HOST_URL);
  }
  await localRuntime.getByLabel("Paste-once bearer token").fill(token ?? "");
  await localRuntime.getByRole("button", { name: "Connect to local host" }).click();
  await expect(localRuntime.getByLabel("Registered source")).toBeVisible();

  await localRuntime.getByLabel("Declared source language").fill("ko");
  await localRuntime.getByLabel("Language-pack identity (optional)").fill("ko-v3");
  await localRuntime.getByRole("button", { name: "Start local runtime" }).click();

  await expect(localRuntime.locator(".local-runtime-lifecycle b")).toHaveText("Terminal", {
    timeout: 10_000,
  });
  await expect(localRuntime.locator('.local-runtime-poll[data-health="complete"]')).toBeVisible();
  await expect(localRuntime.getByText(/Last consumed cursor [1-9]/)).toBeVisible();
  await expect(page.locator('.studio[data-stage="input"]')).toBeVisible();
  await expect(page.getByText(/Recorded replay controls below use/)).toBeVisible();

  await localRuntime.getByRole("button", { name: "Repeat identical start" }).click();
  await expect(localRuntime.getByText(/Same command, runtime, journal, receipt, and forecast identities/)).toBeVisible();
});

test("the input stage introduces the orchestrator before asking for a source", async ({ page }) => {
  await page.goto("/studio/");

  const heading = page.getByRole("heading", {
    name: "Welcome to Studio. Add a source when you’re ready. We’ll take it from there, so you can sit back and watch it come together.",
  });
  const sourceTrigger = page.getByRole("button", { name: "Choose source: local or recorded" });
  const sourcePanel = page.getByRole("dialog", { name: "Choose a Studio source" });
  const previewTrigger = page.getByRole("button", { name: "Input Source" });
  await expect(heading).toBeVisible();
  await expect(previewTrigger).toBeVisible();
  await expect(sourceTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(sourcePanel).toHaveCount(0);

  await sourceTrigger.click();
  await expect(sourcePanel).toBeVisible();
  await expect(sourcePanel.getByRole("group", { name: "Process locally" })).toBeVisible();
  await expect(sourcePanel.getByRole("group", { name: "Explore a recording" })).toBeVisible();

  const identity = page.locator('[data-agent-identity="orchestrator-root"]');
  await expect(identity).toBeVisible();
  await expect(identity).toHaveAttribute("data-topology", "confluence");
  const mesh = identity.locator(".agent-mark-mesh");
  await expect(mesh).toHaveAttribute("data-mesh-ready", /true|fallback/);
  await expect(mesh).toHaveAttribute("data-mesh-motion", "still");
  expect(
    await identity.evaluate((mark) => ({
      animation: getComputedStyle(mark).animationName,
      fieldMotion: mark.getAttribute("data-field-motion"),
      shape: getComputedStyle(mark).borderRadius,
      ring: getComputedStyle(mark.closest(".welcome-orchestrator-core") as Element, "::before").content,
    })),
  ).toEqual({
    animation: "none",
    fieldMotion: "still",
    shape: "50%",
    ring: "none",
  });

  await sourceTrigger.focus();
  await page.keyboard.press("Escape");
  await expect(sourcePanel).toHaveCount(0);
  await expect(sourceTrigger).toBeFocused();
  await sourceTrigger.click();
  await expect(sourcePanel).toBeVisible();
  await heading.click();
  await expect(sourcePanel).toHaveCount(0);

  await previewTrigger.click();
  await expect(page.getByRole("textbox", { name: "YouTube link" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(previewTrigger).toBeFocused();
  await expect(sourcePanel).toHaveCount(0);
});

test("client navigation from Home preserves Studio material tokens", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "View demo", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/$/);
  await expect(page.getByRole("heading", { name: /Welcome to Studio/ })).toBeVisible();

  const home = page.getByRole("link", { name: "1321 home" });
  const sourceTrigger = page.getByRole("button", { name: "Choose source: local or recorded" });
  await expect(sourceTrigger).toBeVisible();
  const clientNavigationStyle = await sourceTrigger.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: style.width,
      height: style.height,
      backgroundColor: style.backgroundColor,
      backdropFilter: style.backdropFilter,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
    };
  });
  const homeStyle = await home.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: style.width,
      height: style.height,
      backgroundColor: style.backgroundColor,
      backdropFilter: style.backdropFilter,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
    };
  });
  expect(clientNavigationStyle).toEqual(homeStyle);
  expect(clientNavigationStyle.width).toBe("40px");
  expect(clientNavigationStyle.height).toBe("40px");
  expect(clientNavigationStyle.backdropFilter).not.toBe("none");
  expect(clientNavigationStyle.borderRadius).toBe("13px");

  await page.reload();
  await expect(sourceTrigger).toBeVisible();
  await expect.poll(async () => sourceTrigger.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: style.width,
      height: style.height,
      backgroundColor: style.backgroundColor,
      backdropFilter: style.backdropFilter,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
    };
  })).toEqual(clientNavigationStyle);
});

test("source authority options separate live local ingest from recorded preview", async ({ page }) => {
  await page.goto("/studio/");

  const trigger = page.getByRole("button", { name: "Choose source: local or recorded" });
  const previewTrigger = page.getByRole("button", { name: "Input Source" });
  const panel = page.getByRole("dialog", { name: "Choose a Studio source" });
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toHaveCount(0);
  await expect(previewTrigger).toBeVisible();
  await expect(page.locator('.source-entry[data-source-authority="live-local"]')).toBeVisible();

  await trigger.click();
  const local = panel.getByRole("group", { name: "Process locally" });
  const recorded = panel.getByRole("group", { name: "Explore a recording" });
  const localChoices = local.locator(".studio-source-choice");
  const recordedChoices = recorded.locator(".studio-source-choice");
  const firstSample = panel.getByRole("button", { name: "Fill the source bar with Korean sample 01" });
  const secondSample = panel.getByRole("button", { name: "Fill the source bar with Korean sample 02" });

  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  await expect(localChoices).toHaveCount(2);
  await expect(recordedChoices).toHaveCount(1);
  await expect(localChoices.nth(0)).toHaveAttribute("data-source-authority", "live-local");
  await expect(localChoices.nth(1)).toHaveAttribute("data-source-authority", "live-local");
  await expect(recordedChoices.nth(0)).toHaveAttribute("data-source-authority", "recorded");
  await expect(local).toContainText("Private local host");
  await expect(recorded).toContainText("No new processing");
  await expect(recorded.getByRole("button", { name: "Explore the recorded run-006 demo" })).toBeVisible();
  await expect(firstSample).toHaveAttribute("data-source-example-authority", "live-local");
  await expect(secondSample).toHaveAttribute("data-source-example-authority", "live-local");

  await firstSample.click();
  const sourceField = page.getByRole("textbox", { name: "YouTube link" });
  await expect(sourceField).toBeFocused();
  await expect(sourceField).toHaveValue(
    "https://www.youtube.com/watch?v=hWxESR68Olg&list=RDhWxESR68Olg&start_radio=1&pp=oAcB",
  );
  await page.waitForTimeout(420);
  const sourceBarBefore = await page.locator(".source-entry .dock-bar").boundingBox();

  await trigger.click();
  await expect(panel).toBeVisible();
  await secondSample.click();
  await expect(sourceField).toBeFocused();
  await expect(sourceField).toHaveValue("https://www.youtube.com/watch?v=XauBqFepc-s");
  await expect(page.getByRole("button", { name: "Set up local processing for this link" })).toBeVisible();
  await page.waitForTimeout(240);
  const sourceBarAfter = await page.locator(".source-entry .dock-bar").boundingBox();
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs((sourceBarAfter?.[key] ?? Infinity) - (sourceBarBefore?.[key] ?? -Infinity))).toBeLessThanOrEqual(2);
  }
});

test("the recorded preflight's Skip setup control confirms with defaults and starts processing", async ({ page }) => {
  await page.goto("/studio/");
  await expect(page.locator(".studio")).toHaveAttribute("data-stage", "input");

  // Reach the recorded preflight through the source chooser.
  await page.getByRole("button", { name: "Choose source: local or recorded" }).click();
  await page.getByRole("button", { name: "Explore the recorded run-006 demo" }).click();
  const preflight = page.locator('.preflight[data-preview-mode="recorded-demo"]');
  await expect(preflight).toBeVisible();

  // The skip control is a standing part of the preflight (like the run's Pause / Open Results pills):
  // it confirms with the recorded defaults and hands off to processing.
  const skip = page.getByRole("button", { name: "Skip setup" });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(page.locator(".studio")).toHaveAttribute("data-stage", "run");
});

test("YouTube local ingest registers exact local bytes and enters the existing plan/start flow without replay", async ({ page }, testInfo) => {
  test.setTimeout(30_000);
  test.skip(testInfo.project.name !== "desktop", "one real local-host browser walk is sufficient");
  const metadataRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/studio/source-resolutions")) metadataRequests.push(request.url());
  });
  const directory = await mkdtemp(join(tmpdir(), "studio-youtube-local-browser-"));
  const sources = await RuntimeSourceRegistry.open({ sourceDirectories: [] });
  const store = await DurableRuntimeCommandStore.open(join(directory, "runtime"));
  const executor = new DeterministicRuntimeExecutor();
  const service = await RuntimeStartService.open({
    store,
    sources,
    launcherFactory: executor.factory(),
    recoverOnOpen: false,
  });
  const youtubeLocalIngest = await YouTubeLocalIngestService.open({
    root: join(directory, "youtube-sources"),
    repositoryRoot: resolve("."),
    sources,
    maximumRangeMs: 120_000,
    resolveSource: async (raw) => sourceResolutionReceipt(raw),
    download: async ({ outputPath }) => copyFile(resolve("public/demo/runs/run-005/clip.m4a"), outputPath),
  });
  const token = "b".repeat(64);
  await page.goto("/studio/");
  const origin = new URL(page.url()).origin;
  const server = createRuntimeHostHttpServer({
    service,
    youtubeLocalIngest,
    token,
    allowedOrigins: [origin],
  });
  try {
    const address = await listenRuntimeHost(server, { port: 0 });
    await page.goto(`/studio/?runtimeHost=${encodeURIComponent(`http://${address.host}:${address.port}`)}`);
    await chooseSource(page, "Process a YouTube range locally");

    const productRuntime = page.getByRole("region", { name: "YouTube local source" });
    await expect(productRuntime).toBeVisible();
    await productRuntime.getByRole("button", { name: "Open connect to local host" }).click();
    await productRuntime.getByRole("textbox", { name: "Paste-once bearer token", exact: true }).fill(token);
    await productRuntime.getByRole("button", { name: "Connect to local host", exact: true }).click();
    await productRuntime.getByRole("textbox", { name: "YouTube URL for local processing", exact: true }).fill("https://www.youtube.com/watch?v=fixturevideo");
    await productRuntime.getByRole("spinbutton", { name: "YouTube start seconds", exact: true }).fill("0");
    await productRuntime.getByRole("spinbutton", { name: "YouTube end seconds", exact: true }).fill("47.2");
    const confirm = productRuntime.getByRole("button", { name: "Confirm local processing and ingest" });
    await expect(confirm).toBeDisabled();
    await productRuntime.getByLabel(/I confirm this exact YouTube range/).check();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    const progress = productRuntime.getByRole("status", { name: "YouTube local ingest progress" });
    await expect(progress).toHaveAttribute("data-state", "registered", { timeout: 15_000 });
    await expect(progress).toContainText("registered and selected");
    await expect(productRuntime.getByLabel("Registered YouTube local source")).toContainText("Resolved browser-test video");
    await expect(productRuntime.locator(".product-runtime-source-facts")).toContainText("YouTube / local");
    await page.keyboard.press("Escape");

    await productRuntime.getByRole("button", { name: "Continue to Range" }).click();
    await productRuntime.getByRole("button", { name: "Continue to Language" }).click();
    await productRuntime.getByLabel("Declared source language").fill("ko");
    await productRuntime.getByRole("button", { name: "Continue to Output" }).click();
    await productRuntime.getByRole("button", { name: "Continue to Forecast" }).click();
    await expect(productRuntime.getByRole("region", { name: "Review the local runtime plan" })).toBeVisible();
    await productRuntime.getByRole("button", { name: "Continue to Review" }).click();
    await productRuntime.getByRole("button", { name: "Accept forecast and start local runtime" }).click();
    const status = productRuntime.getByRole("region", { name: "Local runtime status" });
    await expect(status.getByRole("heading", { name: "Terminal", exact: true })).toBeVisible({ timeout: 10_000 });

    await expect(page.locator(".studio")).toHaveAttribute("data-stage", "input");
    await expect(page.locator("#top-source-provenance")).toHaveCount(0);
    await expect(page.getByText("This interface preview uses a recorded run.")).toHaveCount(0);
    await expect(page.locator('[data-source-run="run-006"]')).toHaveCount(0);
    expect(metadataRequests).toEqual([]);
    expect(sources.list()).toHaveLength(1);
    expect(sources.list()[0].sourceKind).toBe("youtube_local");
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test("an identified source keeps the URL editor unchanged", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Input Source" }).click();
  const source = page.getByRole("textbox", { name: "YouTube link" });
  const editor = page.locator(".source-entry .dock-bar");
  await page.waitForTimeout(420);
  const editorBox = await editor.boundingBox();

  await source.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await source.press("Tab");
  await page.waitForTimeout(240);

  await expect(source).toBeVisible();
  await expect(source).toHaveValue("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect(page.locator(".source-entry .dock-bar-source")).toHaveCount(0);
  expect(editorBox).not.toBeNull();
  const editorAfterBlur = await editor.boundingBox();
  expect(editorAfterBlur).not.toBeNull();
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs((editorAfterBlur?.[key] ?? Infinity) - (editorBox?.[key] ?? -Infinity))).toBeLessThanOrEqual(2);
  }
});

test("the welcome composition fits every supported viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one pass covers the responsive viewport contract");

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/studio/");
    await expect(page.getByRole("heading", { name: /Welcome to Studio/ })).toBeVisible();

    const home = page.getByRole("link", { name: "1321 home" });
    const sourceTrigger = page.getByRole("button", { name: "Choose source: local or recorded" });
    const orchestrator = page.locator(".welcome-orchestrator-anchor");
    const welcomePanel = page.locator(".welcome-panel");
    const [homeBox, sourceTriggerBox] = await Promise.all([
      home.boundingBox(),
      sourceTrigger.boundingBox(),
    ]);

    expect(homeBox).not.toBeNull();
    expect(sourceTriggerBox).not.toBeNull();
    expect(sourceTriggerBox?.width).toBe(40);
    expect(sourceTriggerBox?.height).toBe(40);
    expect(Math.abs((sourceTriggerBox?.y ?? Infinity) - (homeBox?.y ?? -Infinity))).toBeLessThanOrEqual(0.5);

    if ((await sourceTrigger.getAttribute("aria-expanded")) === "false") await sourceTrigger.click();
    const sourcePanel = page.getByRole("dialog", { name: "Choose a Studio source" });
    await expect(sourcePanel).toBeVisible();
    const sourcePanelBox = await sourcePanel.boundingBox();
    expect(sourcePanelBox).not.toBeNull();
    expect(sourcePanelBox?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect(sourcePanelBox?.y ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect((sourcePanelBox?.x ?? 0) + (sourcePanelBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
    expect((sourcePanelBox?.y ?? 0) + (sourcePanelBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 0.5);

    await sourceTrigger.focus();
    await page.keyboard.press("Escape");
    await expect(sourcePanel).toHaveCount(0);
    await expect(sourceTrigger).toBeFocused();

    const [orchestratorBox, welcomePanelBox] = await Promise.all([
      orchestrator.boundingBox(),
      welcomePanel.boundingBox(),
    ]);

    expect(orchestratorBox).not.toBeNull();
    expect(welcomePanelBox).not.toBeNull();
    expect(orchestratorBox?.x ?? 0).toBeLessThan(welcomePanelBox?.x ?? 0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

    for (const locator of [home, sourceTrigger, orchestrator, welcomePanel]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 0.5);
    }
  }
});

test("completed recorded runs arrive on the finished statement and open the report", async ({ page }, testInfo) => {
  await openLab(page);
  await scenario(page).selectOption("unscored-complete");
  await page.locator(".studio-lab").evaluate((element) => {
    (element as HTMLElement).style.display = "none";
  });

  // Completion lands on the arrival face once: the finished statement over the result brief,
  // its parameter values read from the bundle, and one way forward.
  await expect(page.getByRole("heading", { name: "Your video has finished processing." })).toBeVisible();
  const arrivalBrief = page.locator(".result-arrival .result-brief");
  await expect(arrivalBrief).toContainText("0:00–0:40");
  await expect(arrivalBrief).toContainText("11 of its 15 lines");
  await page.getByRole("button", { name: "View result" }).click();

  const results = page.locator("#studio-recorded-results");
  await expect(results).toBeVisible();
  await expect(results).toHaveAccessibleName(/Result/);
  await expect(page.getByRole("button", { name: "Open Results" })).toHaveCount(0);
  // The canvas persists beneath the auto-opened workspace: one world, never a screen swap.
  await expect(page.locator(".stage-complete")).toHaveCount(1);
  await expect(page.locator(".dock-well")).toHaveCount(0);
  await expect(results.getByRole("button", { name: "Run again", exact: true })).toHaveCount(0);
  const viewer = results.getByRole("region", { name: "Learning viewer" });
  await expect(viewer).toBeVisible();
  // The report reads clip beside brief: the transcript belongs to the watch face, and the
  // workbench viewer carries no Split/Cinema choice — the watch face is the stage.
  await expect(page.locator(".result-brief-rail")).toBeVisible();
  await expect(page.locator(".result-brief-rail .result-brief")).toContainText("held back instead of guessed");
  await expect(results.locator(".learning-workspace")).toBeHidden();
  await expect(viewer.locator(".pm-view")).toHaveCount(0);
  // The report shows the clip as a calm, chrome-free preview, not a second operable player: the
  // caption-mode bar stands down, and the transport, settings pill, and viewing modes are withheld —
  // those belong to the watch room reached through the door. The preview plays muted so the result
  // reads as alive rather than frozen.
  const previewPlayer = viewer.locator('.player[data-player-surface="results"]');
  await expect(previewPlayer).toHaveAttribute("data-preview", "true");
  await expect(viewer.locator(".watch-caption-controls")).toBeHidden();
  await expect(viewer.getByRole("button", { name: "Full screen" })).toHaveCount(0);
  await expect(viewer.getByRole("slider", { name: "Volume" })).toHaveCount(0);
  await expect(viewer.getByRole("combobox", { name: "Playback speed" })).toHaveCount(0);
  await expect(previewPlayer).toHaveAttribute("data-playing", "true");
  await expect(previewPlayer.locator("video.screen-video")).toHaveJSProperty("muted", true);
  // The workbench frame carries no authority bar over the composition: the authority stays
  // machine-readable on the region, and the evidence class is stated by the Source disclosure,
  // never worn as a hero label.
  await expect(viewer).toHaveAttribute("data-result-authority", "recorded_demo");
  await expect(viewer).toHaveAttribute("data-shell-frame", "workbench");
  await expect(viewer.locator(".result-authority-badge")).toHaveCount(0);
  // The hero facts fold away on the compact band; on desktop they carry accounting only.
  if (testInfo.project.name === "desktop") {
    const hero = page.locator(".result-workspace-hero");
    await expect(hero).toContainText("KO → EN");
    await expect(hero).not.toContainText("Recorded demo");
  }
  // The environment head carries the source title, focus-panel style.
  await expect(page.locator(".result-workspace-source-head h3")).toContainText("Natural Korean Conversation");

  // The watch face opens as a normal video: no docked panel until the command bar reveals one,
  // and Back is a step, not an exit.
  await page.getByRole("button", { name: "Watch the clip" }).click();
  await expect(results.locator(".learning-workspace")).toBeHidden();
  const watchBar = page.getByRole("navigation", { name: "Watch commands" });
  await expect(watchBar).toBeVisible();
  await watchBar.getByRole("button", { name: "Transcript" }).click();
  await expect(results.locator(".learning-workspace")).toBeVisible();
  // The watch command bar's Notes option opens the depth-wheel prep face.
  await watchBar.getByRole("button", { name: "Notes", exact: true }).click();
  const face = results.getByRole("region", { name: "Learning notes" });
  await expect(face).toHaveAttribute("data-learning-prep-authority", "recorded_fixture");
  await results.getByRole("button", { name: "Close notes" }).click();
  await expect(results.locator(".result-media-meta")).toHaveCount(0);
  // Source and Coverage are one Details command in the watch room; Back is the room's one exit.
  await expect(page.getByRole("button", { name: "Details", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to the result report" })).toBeVisible();
});

test("completion replaces an open agent focus and gives the result sole interaction authority", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("withheld");

  const lab = page.getByRole("complementary", { name: "Studio trace lab" });
  await lab.getByLabel("Playback speed").selectOption("24");

  const orchestrator = page.getByRole("button", { name: /^orchestrator,/ });
  await orchestrator.focus();
  await page.keyboard.press("Enter");
  const focus = page.getByRole("dialog", { name: "Orchestrator" });
  await expect(focus).toBeVisible();
  await expect(focus.getByRole("button", { name: "Close agent focus" })).toBeFocused();

  // The lab is intentionally behind the modal. Trigger its deterministic transport control from
  // the test so the real end() transition occurs while agent focus still owns the viewport.
  await lab.getByRole("button", { name: "Resume", exact: true }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  const arrival = page.getByRole("dialog", { name: "Your video has finished processing." });
  await expect(arrival).toBeVisible();
  await expect(focus).toHaveCount(0);
  await expect(page.locator(".stage-complete"))
    .not.toHaveAttribute("data-agent-focus");
  await expect(page.locator(".stage-complete")).toHaveAttribute("inert", "");
  await expect(page.locator(".top")).toHaveAttribute("inert", "");
  await expect(page.locator(".studio-lab-host")).toHaveAttribute("inert", "");
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1);
  await expect(arrival.getByRole("button", { name: "View result" })).toBeFocused();
});

test("a completed run opens and closes the result workspace over the persistent process graph", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("unscored-complete");
  await page.locator(".studio-lab").evaluate((element) => {
    (element as HTMLElement).style.display = "none";
  });

  // The workspace auto-opened on its arrival face over the canvas, which stays mounted
  // beneath it the whole time.
  const arrival = page.getByRole("heading", { name: "Your video has finished processing." });
  await expect(arrival).toBeVisible();
  await page.getByRole("button", { name: "View result" }).click();

  const results = page.locator("#studio-recorded-results");
  await expect(results).toBeVisible();
  const viewer = results.getByRole("region", { name: "Learning viewer" });
  const stage = page.locator(".stage-complete");
  await expect(stage).toHaveCount(1);
  // The focus-panel command baseline: two distinctly named disclosures and the one exit.
  // There is no Result/Process switch anywhere on the recorded surface.
  const commands = page.getByRole("navigation", { name: "Result commands" });
  await expect(commands.getByRole("button", { name: "Source" })).toBeVisible();
  await expect(commands.getByRole("button", { name: "Method" })).toBeVisible();
  await expect(commands.getByRole("button", { name: "Coverage" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Run view" })).toHaveCount(0);

  // Method is the one consolidated technical record, projected from the same recorded
  // artifacts: measured process facts, the per-line accounting, content identity, and an
  // honest scoring state — never a quality claim.
  await commands.getByRole("button", { name: "Method" }).click();
  const method = commands.getByRole("dialog", { name: "Method and technical record" });
  await expect(method).toBeVisible();
  await expect(method).toContainText("1:51");
  await expect(method).toContainText("0:55");
  await expect(method).toContainText("5 recorded");
  await expect(method).toContainText("13 checks, 5 failed");
  await expect(method).toContainText("8 of 11 lines");
  await expect(method).toContainText("Checked against whisper-1");
  await expect(method).toContainText("11 captioned, 4 withheld, 0 silent");
  await expect(method).toContainText("Of 15 lines in range");
  await expect(method).toContainText("sha256:4f60799f8a71");
  await expect(method).toContainText("h264 1280×720, aac 48 kHz stereo");
  await expect(method).toContainText("00:05:10–00:05:50");
  await expect(method).toContainText("Not scored");
  await expect(method).toContainText("No gold exists for this clip");
  await expect(method).toContainText("7 glossary terms, 5 correction rows");
  await expect(method.getByRole("link", { name: "evidence.json" })).toBeVisible();
  await commands.getByRole("button", { name: "Method" }).click();
  await expect(method).toBeHidden();

  // Watch is a room inside the workspace: it opens as a bare video with its own command bar, and
  // Back (or Esc) returns to the report, never past it.
  await page.getByRole("button", { name: "Watch the clip" }).click();
  await expect(page.getByRole("navigation", { name: "Watch commands" })).toBeVisible();
  await expect(results.locator(".learning-workspace")).toBeHidden();
  await expect(commands.getByRole("button", { name: /^Close the result/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Watch commands" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Watch the clip" })).toBeVisible();

  await commands.getByRole("button", { name: /^Close the result/ }).click();
  await expect(stage).toBeVisible();
  await expect(results).toBeHidden();
  await expect(stage.locator(".graph")).toBeVisible();
  await expect(stage.locator(".hub")).toBeVisible();
  // The result is on the graph: a golden node at the terminus carrying the run's language pair,
  // linked from the orchestrator, never drawn as a worker identity.
  const artifact = stage.getByRole("button", { name: /^Result,/ });
  await expect(artifact).toBeVisible();
  await expect(artifact).toContainText("KO → EN captions");
  await expect(stage.locator(".wire-artifact")).toHaveCount(1);
  // The completed graph keeps the run's global bar rather than a recorded-demo chip: the status now
  // reads Done, with Open Results and Clear where Pause/Stop were. No recorded-evidence toolbar.
  await expect(page.locator(".run-evidence-chip")).toHaveCount(0);
  const dock = page.locator(".dock-well");
  await expect(dock).toBeVisible();
  await expect(dock.getByText("Done")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Results" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Pause|Resume|Stop)$/ })).toHaveCount(0);

  // The orb is a re-entry anchor: opening it resumes the report — never arrival, which belongs to
  // the completion moment alone — and the run dock stands down for the watch room's own bottom bar.
  await artifact.click();
  await expect(results).toBeVisible();
  await expect(viewer).toBeVisible();
  await expect(arrival).toHaveCount(0);
  await expect(page.locator(".dock-well")).toHaveCount(0);
  await expect(stage).toHaveCount(1);

  // Esc steps back out of the workspace to the completed world with the orb.
  await page.keyboard.press("Escape");
  await expect(results).toBeHidden();
  await expect(stage).toBeVisible();
  await expect(artifact).toBeVisible();

  await artifact.click();
  await expect(results).toBeVisible();
  await expect(viewer).toBeVisible();
});

test("active agent materials visibly change at canvas scale", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one rendered sample covers the shared shader");

  await openLab(page);
  await scenario(page).selectOption("current-run");
  await page.getByLabel("Playback speed").selectOption("0.5");
  const lab = page.getByRole("complementary", { name: "Studio trace lab" });
  await lab.getByRole("button", { name: "Resume", exact: true }).click();

  const runningMeshes = page.locator('.agent-mark-mesh[data-mesh-motion="running"]');
  await expect
    .poll(async () => runningMeshes.count())
    .toBeGreaterThanOrEqual(2);

  const meshes = await runningMeshes.elementHandles();
  expect(meshes.length).toBeGreaterThanOrEqual(2);
  const before = await Promise.all(meshes.map((mesh) => mesh.screenshot()));
  await page.waitForTimeout(1_600);
  const after = await Promise.all(meshes.map((mesh) => mesh.screenshot()));
  const differences = await Promise.all(
    before.map((frame, index) => renderedDifference(page, frame, after[index])),
  );

  expect(differences).toHaveLength(meshes.length);
  for (const difference of differences) {
    expect(difference, `rendered differences: ${differences.join(", ")}`).toBeGreaterThan(0.015);
  }
});

test("the public Dock pauses and resumes without stopping the run", async ({ page }, testInfo) => {
  await page.goto("/studio/");
  await startRecordedDemo(page);

  const dock = page.locator(".dock");
  const rail = page.locator(".rail");
  const compactPause = page.locator(".dock-hold");
  if (testInfo.project.name === "desktop") {
    await expect(rail).toBeVisible();
    await expect(compactPause).toBeHidden();
    const [railBox, dockBox] = await Promise.all([rail.boundingBox(), dock.boundingBox()]);
    expect(railBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect((railBox?.y ?? 0) + (railBox?.height ?? 0)).toBeLessThan(dockBox?.y ?? 0);
  } else {
    await expect(rail).toBeHidden();
    await expect(compactPause).toBeVisible();
  }

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(dock).toHaveAttribute("data-paused", "true");
  await expect(page.locator(".hub .node-state")).not.toHaveClass(/text-shimmer/);
  await expect(page.locator(".dock-status")).toHaveText("Paused");
  const hubMesh = page.locator(".hub .agent-mark-mesh");
  await expect(hubMesh).toHaveAttribute("data-mesh-motion", "still");
  let heldFrame = "";
  await expect
    .poll(async () => {
      const currentFrame = await hubMesh.evaluate(
        (canvas) => (canvas as HTMLCanvasElement).toDataURL(),
      );
      const stable = currentFrame === heldFrame;
      heldFrame = currentFrame;
      return stable;
    }, { intervals: [200, 200, 300], timeout: 5_000 })
    .toBe(true);
  await expect.poll(() => page.locator(".studio").evaluate((studio) => (
    parseFloat(getComputedStyle(studio, "::after").opacity)
  ))).toBeGreaterThan(0.95);
  const pauseField = await page.locator(".studio").evaluate((studio) => {
    const style = getComputedStyle(studio, "::after");
    const top = studio.querySelector<HTMLElement>(".top");
    const dockWell = studio.querySelector<HTMLElement>(".dock-well");
    return {
      background: style.backgroundImage,
      blur: style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter"),
      mask: style.maskImage || style.getPropertyValue("-webkit-mask-image"),
      shadow: style.boxShadow,
      layer: parseFloat(style.zIndex),
      topLayer: top ? parseFloat(getComputedStyle(top).zIndex) : Number.NaN,
      dockLayer: dockWell ? parseFloat(getComputedStyle(dockWell).zIndex) : Number.NaN,
    };
  });
  expect(pauseField.background.match(/linear-gradient/g)?.length).toBe(4);
  expect(pauseField.blur).toContain("blur(14px)");
  expect(pauseField.mask).toContain("radial-gradient");
  expect(pauseField.shadow).not.toBe("none");
  expect(pauseField.layer).toBeGreaterThan(pauseField.topLayer);
  expect(pauseField.layer).toBeLessThan(pauseField.dockLayer);
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(dock).toHaveAttribute("data-paused", "false");
  await expect(hubMesh).toHaveAttribute("data-mesh-motion", "running");
  await expect(page.locator(".hub .node-state")).toHaveClass(/text-shimmer/);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(" ");
  await expect(dock).toHaveAttribute("data-paused", "true");
});

test("cancelling a run resolves in the dock without replacing the canvas", async ({ page }) => {
  await page.goto("/studio/");
  await startRecordedDemo(page);
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.locator('.studio[data-stage="run"]')).toBeVisible();
  await expect(page.locator('.dock[data-outcome="cancelled"]')).toBeVisible();
  await expect(page.locator(".dock-status")).toHaveText("Cancelled");
  await expect(page.locator(".input-status")).toHaveCount(0);
  await expect(page.locator(".hub")).toBeVisible();
  await expect(page.locator(".hub .node-state")).toHaveText("Stopped");
  await expect(page.locator(".hub .agent-mark-mesh")).toHaveAttribute(
    "data-mesh-motion",
    "still",
  );
  await expect(page.getByRole("button", { name: "Run again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
});

test("workers use distinct inherited identity materials", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("withheld");

  const marks = page.locator(".worker-node .agent-mark");
  await expect(marks).toHaveCount(5);
  await expect
    .poll(async () =>
      marks.locator(".agent-mark-mesh").evaluateAll((nodes) =>
        nodes.every((node) => node.getAttribute("data-mesh-ready") === "true"),
      ),
    )
    .toBe(true);
  const identities = await marks.evaluateAll((nodes) =>
    nodes.map((node) => ({
      key: node.getAttribute("data-agent-identity"),
      role: node.getAttribute("data-role"),
      topology: node.getAttribute("data-topology"),
      shape: getComputedStyle(node).borderRadius,
      size: [getComputedStyle(node).width, getComputedStyle(node).height],
      current: getComputedStyle(node).getPropertyValue("--agent-current").trim(),
      counter: getComputedStyle(node).getPropertyValue("--agent-counter").trim(),
      caustic: getComputedStyle(node).getPropertyValue("--agent-caustic").trim(),
      materialFilter: getComputedStyle(node).filter,
      fallbackOpacity: getComputedStyle(
        node.querySelector(".agent-mark-fallback") as Element,
      ).opacity,
    })),
  );

  expect(new Set(identities.map((identity) => identity.key)).size).toBe(identities.length);
  expect(new Set(identities.map((identity) => identity.current)).size).toBeGreaterThanOrEqual(4);
  expect(new Set(identities.map((identity) => identity.counter)).size).toBeGreaterThanOrEqual(4);
  expect(identities.every((identity) => identity.caustic.length > 0)).toBe(true);
  expect(new Set(identities.map((identity) => identity.role))).toEqual(
    new Set(["segment", "context", "translate", "qc"]),
  );
  expect(new Set(identities.map((identity) => identity.topology))).toEqual(
    new Set(["strata", "basin", "braid", "interference"]),
  );
  expect(identities.every((identity) => identity.shape === "50%")).toBe(true);
  expect(identities.every((identity) => identity.size.join("×") === "60px×60px")).toBe(true);
  expect(identities.every((identity) => identity.materialFilter === "none")).toBe(true);
  expect(identities.every((identity) => identity.fallbackOpacity === "0")).toBe(true);
  await expect(page.locator(".worker-node .env")).toHaveCount(0);
});

test("agent focus presents one bare media stage and one recorded activity narrative", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("withheld");
  await page.getByRole("button", { name: "Collapse trace lab" }).click();

  const translator = page.getByRole("button", { name: /^Translator 01,/ });
  const sourceIdentity = await translator.locator(".agent-mark").getAttribute("data-agent-identity");
  await translator.focus();
  await page.keyboard.press("Enter");

  const focus = page.getByRole("dialog", { name: "Translator 01" });
  await expect(focus).toBeVisible();
  await expect(page.locator(".stage")).toHaveAttribute("data-agent-focus", "true");
  await expect(translator).toHaveAttribute("aria-expanded", "true");
  await expect(focus.getByRole("button", { name: "Close agent focus" })).toBeFocused();
  await expect(focus.locator(".agent-focus-identity .agent-mark")).toHaveAttribute(
    "data-agent-identity",
    sourceIdentity ?? "",
  );

  const nameplate = focus.locator(".agent-focus-hero-copy");
  await expect(nameplate.locator(".agent-focus-state")).toContainText("Translating");
  await expect(nameplate.locator(".agent-focus-state")).not.toHaveClass(/text-shimmer/);
  await expect(nameplate.locator(".agent-focus-role-remit")).toContainText(
    "Drafts the assigned clip window in the target language.",
  );
  expect(
    await nameplate.evaluate((element) =>
      [...element.children].map((child) => child.className || child.id || child.tagName),
    ),
  ).toEqual([
    "agent-focus-state",
    "agent-focus-material-rule",
    "agent-focus-title",
    "agent-focus-nameplate-rule",
    "agent-focus-role-remit",
    "agent-focus-lineage",
  ]);

  const environment = focus.locator(".agent-focus-environment");
  const visualEvidence = focus.locator(".agent-focus-visual-evidence");
  const narrative = focus.locator(".agent-focus-activity-region");

  const workbenchPlayer = visualEvidence.locator('.player[data-player-surface="workbench"]');
  await expect(workbenchPlayer).toBeVisible();
  await expect(visualEvidence.getByLabel("Recorded source video")).toBeVisible();
  await expect(visualEvidence.getByLabel("Recorded source video")).not.toHaveAttribute("controls");
  await expect(visualEvidence.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(visualEvidence.getByRole("slider", { name: "Seek through clip" })).toBeVisible();
  await expect(
    environment.getByRole("heading", { name: /Natural Korean Conversation/ }),
  ).toBeVisible();
  await expect(environment.locator(".agent-focus-source-head p")).toHaveCount(0);
  await expect(environment.locator(".agent-focus-stage-rule")).toHaveCount(2);
  const dividerStyle = await environment.locator(".agent-focus-stage-rule").first().evaluate((element) => ({
    accentContent: getComputedStyle(element, "::after").content,
    lineBackground: getComputedStyle(element, "::before").backgroundImage,
  }));
  expect(dividerStyle.accentContent).toBe("none");
  expect(dividerStyle.lineBackground).toContain("linear-gradient");
  await expect(visualEvidence.locator(".env-media-frame")).toHaveCount(0);
  await expect(visualEvidence.locator(".env-media-transcript")).toHaveCount(0);
  await expect(visualEvidence.locator(".agent-focus-evidence-map")).toHaveCount(0);
  await expect(narrative).toHaveAttribute("aria-label", "Recorded activity");
  await expect(narrative.getByRole("heading", { name: "Translating" })).toBeVisible();
  await expect(narrative.locator(".agent-focus-activity-group > ol > li").first()).toContainText("draft");
  await expect(narrative.locator(".agent-focus-activity-group")).not.toHaveCount(0);
  const historyChip = narrative.locator(".activity-chips li").first();
  await expect(historyChip).toBeVisible();
  const historyChipSurface = await historyChip.evaluate((element) => ({
    backgroundColor: getComputedStyle(element).backgroundColor,
    borderColor: getComputedStyle(element).borderColor,
  }));
  expect(historyChipSurface.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(historyChipSurface.borderColor).not.toBe("rgba(0, 0, 0, 0)");
  for (const label of ["Media", "Process", "Assignment", "History", "Results"]) {
    await expect(focus.getByRole("button", { name: label, exact: true })).toHaveCount(0);
  }

  const mediaGeometry = (scope: typeof focus) =>
    scope.locator(".agent-focus-media-instrument").evaluate((element) => {
      const root = element.closest(".agent-focus") as HTMLElement;
      const rect = element.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      return {
        x: rect.left - rootRect.left + root.scrollLeft,
        y: rect.top - rootRect.top + root.scrollTop,
        width: rect.width,
        height: rect.height,
      };
    });
  const initialMediaBox = await mediaGeometry(focus);
  const expectMediaGeometryStable = async (scope: typeof focus) => {
    const current = await mediaGeometry(scope);
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(current[dimension] - initialMediaBox[dimension]))
        .toBeLessThanOrEqual(0.5);
    }
  };

  const commands = focus.getByRole("navigation", { name: "Agent focus commands" });
  const [environmentBox, commandsBox, closeFocusBox] = await Promise.all([
    environment.boundingBox(),
    commands.boundingBox(),
    commands.getByRole("button", { name: "Close agent focus" }).boundingBox(),
  ]);
  expect(environmentBox).not.toBeNull();
  expect(commandsBox).not.toBeNull();
  expect(closeFocusBox).not.toBeNull();
  expect(commandsBox?.y ?? 0).toBeGreaterThanOrEqual(
    (environmentBox?.y ?? 0) + (environmentBox?.height ?? 0) - 0.5,
  );
  expect((commandsBox?.y ?? Infinity) - ((environmentBox?.y ?? 0) + (environmentBox?.height ?? 0)))
    .toBeLessThanOrEqual(8);
  await expect(commands.locator(".agent-focus-cycle-eyebrow")).toHaveText("Cycle agents");
  await expect(commands.locator(".agent-focus-cycle-position")).toContainText(/\d+of \d+/);
  await expect(commands.getByRole("button", { name: "Previous agent" })).toBeVisible();
  await expect(commands.getByRole("button", { name: "Next agent" })).toBeVisible();
  const closeFocus = commands.getByRole("button", { name: "Close agent focus" });
  await expect(closeFocus).toBeVisible();
  await expect(closeFocus).toContainText("Close");
  await expect(closeFocus).toContainText("Esc");
  await expect(closeFocus.locator(".agent-focus-escape-x")).toHaveCount(0);
  const closeSurface = await closeFocus.evaluate((element) => {
    const shortcut = element.querySelector("kbd") as HTMLElement;
    return {
      backgroundColor: getComputedStyle(element).backgroundColor,
      borderRadius: getComputedStyle(element).borderRadius,
      shortcutBackground: getComputedStyle(shortcut).backgroundColor,
      shortcutBorder: getComputedStyle(shortcut).borderTopWidth,
      shortcutRadius: getComputedStyle(shortcut).borderRadius,
      shortcutShadow: getComputedStyle(shortcut).boxShadow,
    };
  });
  expect(closeSurface.backgroundColor).toBe("rgb(226, 61, 45)");
  expect(Number.parseFloat(closeSurface.borderRadius)).toBeGreaterThanOrEqual(20);
  expect(closeSurface.shortcutBackground).toBe("rgba(0, 0, 0, 0)");
  expect(closeSurface.shortcutBorder).toBe("0px");
  expect(closeSurface.shortcutRadius).toBe("0px");
  expect(closeSurface.shortcutShadow).toBe("none");
  expect(Math.abs(
    ((closeFocusBox?.x ?? 0) + (closeFocusBox?.width ?? 0)) -
    ((commandsBox?.x ?? 0) + (commandsBox?.width ?? 0)),
  )).toBeLessThanOrEqual(0.5);
  await expect(focus.getByText("Reasoning", { exact: true })).toHaveCount(0);

  await expect(closeFocus).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const verifierFocus = page.getByRole("dialog", { name: "Verifier 01" });
  await expect(verifierFocus).toBeVisible();
  await expect(verifierFocus.getByLabel("Recorded source video")).toBeVisible();
  await expect(verifierFocus.getByRole("button", { name: "Close agent focus" })).toBeFocused();
  await expectFocusSettled(verifierFocus);
  await expectMediaGeometryStable(verifierFocus);

  await page.keyboard.press("ArrowLeft");
  const translatorFocus = page.getByRole("dialog", { name: "Translator 01" });
  await expect(translatorFocus).toBeVisible();
  await expect(translatorFocus.getByRole("button", { name: "Close agent focus" })).toBeFocused();
  await expectFocusSettled(translatorFocus);
  await expectMediaGeometryStable(translatorFocus);

  await translatorFocus.getByRole("button", { name: "Close agent focus" }).click();
  await expect(focus).toHaveCount(0);
});

test("cycling agents preserves the focus room while identity and content transition", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("withheld");
  await page.getByRole("button", { name: "Collapse trace lab" }).click();

  const translator = page.getByRole("button", { name: /^Translator 01,/ });
  await translator.click();
  const translatorFocus = page.getByRole("dialog", { name: "Translator 01" });
  await expect(translatorFocus).toBeVisible();
  await expectFocusSettled(translatorFocus);

  const paletteBefore = await translatorFocus.locator(".agent-focus-spatial").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--agent-current").trim()
  );
  const identityGeometry = (scope: typeof translatorFocus) =>
    scope.locator(".agent-focus-identity").evaluate((element) => {
      const root = element.closest(".agent-focus") as HTMLElement;
      const rootBox = root.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return {
        x: box.left - rootBox.left + root.scrollLeft,
        y: box.top - rootBox.top + root.scrollTop,
      };
    });
  const identityBoxBefore = await identityGeometry(translatorFocus);
  await translatorFocus.evaluate((root) => {
    const continuity = window as Window & {
      __agentFocusContinuity?: {
        identityFrame: Element | null;
        identityCanvas: Element | null;
        mediaPlayer: Element | null;
      };
    };
    continuity.__agentFocusContinuity = {
      identityFrame: root.querySelector(".agent-focus-identity"),
      identityCanvas: root.querySelector(".agent-focus-identity .agent-mark-mesh"),
      mediaPlayer: root.querySelector('.player[data-player-surface="workbench"]'),
    };
  });

  await translatorFocus.getByRole("button", { name: "Next agent" }).click();
  // The orb changes inside one shader canvas; the room and playing media never remount.
  await expect(page.locator(".agent-focus-identity-material")).toHaveCount(1);
  await expect(page.locator(".agent-focus-identity .agent-mark-mesh"))
    .toHaveAttribute("data-identity-transition", "running");

  const verifierFocus = page.getByRole("dialog", { name: "Verifier 01" });
  await expect(verifierFocus).toBeVisible();
  await expect(verifierFocus.locator('[id^="agent-focus-title-"]')).toHaveCount(1);
  await expect(verifierFocus.locator('[id^="agent-focus-state-"]')).toHaveCount(1);
  await expect(verifierFocus.locator(".agent-focus-activity-switch")).toHaveCount(1);
  await expect(verifierFocus.locator(".agent-focus-identity-material")).toHaveCount(1);
  await expect(verifierFocus.locator(".agent-focus-identity .agent-mark-mesh"))
    .toHaveAttribute("data-identity-transition", "settled");
  await expect(verifierFocus.getByRole("button", { name: "Close agent focus" })).toBeFocused();

  const continuity = await verifierFocus.evaluate((root) => {
    const state = window as Window & {
      __agentFocusContinuity?: {
        identityFrame: Element | null;
        identityCanvas: Element | null;
        mediaPlayer: Element | null;
      };
    };
    const preserved = {
      identityFrame: root.querySelector(".agent-focus-identity")
        === state.__agentFocusContinuity?.identityFrame,
      identityCanvas: root.querySelector(".agent-focus-identity .agent-mark-mesh")
        === state.__agentFocusContinuity?.identityCanvas,
      mediaPlayer: root.querySelector('.player[data-player-surface="workbench"]')
        === state.__agentFocusContinuity?.mediaPlayer,
    };
    delete state.__agentFocusContinuity;
    return preserved;
  });
  expect(continuity).toEqual({ identityFrame: true, identityCanvas: true, mediaPlayer: true });

  const identityBoxAfter = await identityGeometry(verifierFocus);
  expect(Math.abs(identityBoxAfter.x - identityBoxBefore.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(identityBoxAfter.y - identityBoxBefore.y)).toBeLessThanOrEqual(2);

  const paletteAfter = await verifierFocus.locator(".agent-focus-spatial").evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--agent-current").trim()
  );
  expect(paletteAfter).not.toBe(paletteBefore);
});

test("agent focus keeps its spatial stylesheet after client navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the failure was specific to the routed desktop surface");

  await page.goto("/");
  await page.getByRole("link", { name: "Open Studio" }).click();
  await expect(page.getByRole("button", { name: "Input Source" })).toBeVisible();
  await startRecordedDemo(page);
  await expect(page.locator(".graph-preview-mark")).toHaveCount(0);
  await expect(page.getByText(/These agents replay a bundled demonstration/)).toHaveCount(0);

  const orchestrator = page.getByRole("button", { name: /^orchestrator,/ });
  await expect(orchestrator).toBeVisible();
  await orchestrator.click();

  const focus = page.getByRole("dialog", { name: "Orchestrator" });
  await expect(focus).toBeVisible();
  await expectFocusSettled(focus);
  await expect(focus.getByLabel("Recorded source video")).toBeVisible();
  await expect(focus.getByRole("complementary", { name: "Recorded activity" })).toBeVisible();
  await expect(focus.getByRole("navigation", { name: "Focus instruments" })).toHaveCount(0);
  await expect(focus.locator(".agent-focus-body")).toHaveCSS("display", "grid");
  await expect(page.locator(".top")).toHaveCSS("opacity", "0.08");
  await expect(focus.getByRole("note")).toHaveCount(0);

  const focusStyles = await focus.evaluate((root) => {
    const spatial = root.querySelector(".agent-focus-spatial");
    const body = root.querySelector(".agent-focus-body");
    const hero = root.querySelector(".agent-focus-hero");
    const identity = root.querySelector(".agent-focus-identity");
    const media = root.querySelector(".agent-focus-media-instrument");
    const mediaFrame = root.querySelector('.player[data-player-surface="workbench"] .screen');
    const projection = root.querySelector(".agent-focus-activity-region");
    const commands = root.querySelector(".agent-focus-commands");
    const top = document.querySelector(".top");
    const dock = document.querySelector(".dock");
    if (!spatial || !body || !hero || !identity || !media || !mediaFrame
      || !projection || !commands || !top || !dock) {
      return null;
    }
    const mediaBox = media.getBoundingClientRect();
    const heroBox = hero.getBoundingClientRect();
    const identityBox = identity.getBoundingClientRect();
    const projectionBox = projection.getBoundingClientRect();
    const environmentBox = root.querySelector(".agent-focus-environment")!.getBoundingClientRect();
    const commandsBox = commands.getBoundingClientRect();
    return {
      rootPosition: getComputedStyle(root).position,
      rootZIndex: getComputedStyle(root).zIndex,
      pauseLayerZIndex: getComputedStyle(root.closest(".studio")!, "::after").zIndex,
      spatialDisplay: getComputedStyle(spatial).display,
      bodyDisplay: getComputedStyle(body).display,
      heroDisplay: getComputedStyle(hero).display,
      identityWidth: identityBox.width,
      identityCentered: Math.abs(
        (identityBox.left + identityBox.width / 2) - (heroBox.left + heroBox.width / 2),
      ),
      mediaProjectionGap: projectionBox.left - mediaBox.right,
      identityMediaGap: mediaBox.left - heroBox.right,
      mediaBackground: getComputedStyle(media).backgroundImage,
      mediaBorder: getComputedStyle(media).borderTopWidth,
      mediaFrameRadius: getComputedStyle(mediaFrame).borderRadius,
      projectionBackdrop: getComputedStyle(projection).backdropFilter,
      projectionBackgroundColor: getComputedStyle(projection).backgroundColor,
      projectionBackgroundImage: getComputedStyle(projection).backgroundImage,
      projectionClip: getComputedStyle(projection).clipPath,
      commandsBelowEnvironment: commandsBox.top >= environmentBox.bottom - 0.5,
      topFilter: getComputedStyle(top).filter,
      topOpacity: getComputedStyle(top).opacity,
      dockFilter: getComputedStyle(dock).filter,
      dockOpacity: getComputedStyle(dock).opacity,
    };
  });
  expect(focusStyles).not.toBeNull();
  expect(focusStyles).toMatchObject({
    rootPosition: "fixed",
    spatialDisplay: "grid",
    bodyDisplay: "grid",
    heroDisplay: "flex",
    mediaBackground: "none",
    mediaBorder: "0px",
    commandsBelowEnvironment: true,
    projectionBackdrop: "none",
    projectionBackgroundColor: "rgba(0, 0, 0, 0)",
    projectionBackgroundImage: "none",
    projectionClip: "none",
    topOpacity: "0.08",
    dockFilter: "none",
    dockOpacity: "1",
  });
  expect(focusStyles?.identityWidth ?? 0).toBeGreaterThanOrEqual(170);
  expect(focusStyles?.identityWidth ?? 999).toBeLessThanOrEqual(255);
  expect(focusStyles?.identityCentered ?? 999).toBeLessThanOrEqual(0.5);
  expect(focusStyles?.identityMediaGap ?? -1).toBeGreaterThanOrEqual(20);
  expect(focusStyles?.mediaProjectionGap ?? -1).toBeGreaterThanOrEqual(30);
  // The workbench plays in the shared squircle screen of the on-video chrome, same as Results.
  expect(parseFloat(focusStyles?.mediaFrameRadius ?? "0")).toBe(18);
  expect(Number(focusStyles?.rootZIndex ?? 0)).toBeGreaterThan(
    Number(focusStyles?.pauseLayerZIndex ?? 0),
  );
  const focusBlur = Number(focusStyles?.topFilter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0);
  expect(focusBlur).toBeGreaterThanOrEqual(9.5);
});
test("agent focus separates identity, bare media, narrative, and commands at every supported viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one pass covers the responsive viewport contract");
  test.setTimeout(60_000);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 2048, height: 1152 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await openLab(page);
    await scenario(page).selectOption("withheld");
    await page.getByRole("button", { name: "Collapse trace lab" }).click();

    const anchor = page.getByRole("button", { name: /^orchestrator,/ });
    const before = await settledBox(page, anchor);
    await anchor.focus();
    await page.keyboard.press("Enter");

    const focus = page.getByRole("dialog", { name: "Orchestrator" });
    await expect(focus).toBeVisible();
    await expectFocusSettled(focus);

    const environment = focus.locator(".agent-focus-environment");
    const focusBody = focus.locator(".agent-focus-body");
    const hero = focus.locator(".agent-focus-hero");
    const identity = focus.locator(".agent-focus-identity");
    const media = page.locator(".agent-focus-media-instrument");
    const mediaFrame = focus.locator('.player[data-player-surface="workbench"] .screen');
    const projection = focus.locator(".agent-focus-activity-region");
    const commands = page.getByRole("navigation", { name: "Agent focus commands" });
    const cycleButtons = commands.locator(".agent-focus-cycle-buttons > button");
    const cycleLabel = commands.locator(".agent-focus-cycle-label");

    await expect(focus.getByRole("navigation", { name: "Focus instruments" })).toHaveCount(0);
    await expect(focus.locator('.player[data-player-surface="workbench"]')).toBeVisible();
    await expect(focus.getByLabel("Recorded source video")).toBeVisible();
    await expect(focus.locator(".agent-focus-visual-evidence")).toBeVisible();
    await expect(focus.locator(".agent-focus-activity-feed")).toBeVisible();
    await expect(projection.getByRole("heading", { name: "Coordinating" })).toBeVisible();

    const [focusBox, environmentBox, focusBodyBox, heroBox, identityBox, mediaBox,
      mediaFrameBox, projectionBox, commandsBox, closeBox, dockBox, after, graphState] =
      await Promise.all([
        focus.boundingBox(),
        environment.boundingBox(),
        focusBody.boundingBox(),
        hero.boundingBox(),
        identity.boundingBox(),
        media.boundingBox(),
        mediaFrame.boundingBox(),
        projection.boundingBox(),
        commands.boundingBox(),
        commands.getByRole("button", { name: "Close agent focus" }).boundingBox(),
        page.locator(".dock-well").boundingBox(),
        anchor.boundingBox(),
        page.locator(".graph").evaluate((element) => ({
          transform: getComputedStyle(element).transform,
          filter: getComputedStyle(element).filter,
        })),
      ]);

    for (const box of [
      focusBox,
      environmentBox,
      focusBodyBox,
      heroBox,
      identityBox,
      mediaBox,
      mediaFrameBox,
      projectionBox,
      commandsBox,
      closeBox,
      dockBox,
      before,
      after,
    ]) {
      expect(box).not.toBeNull();
    }

    for (const box of [focusBox, environmentBox, heroBox, identityBox, mediaBox,
      mediaFrameBox, projectionBox, commandsBox]) {
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
    }

    const overlaps = (a: NonNullable<typeof mediaBox>, b: NonNullable<typeof mediaBox>) =>
      a.x < b.x + b.width - 0.5
      && a.x + a.width > b.x + 0.5
      && a.y < b.y + b.height - 0.5
      && a.y + a.height > b.y + 0.5;
    expect(overlaps(identityBox!, mediaFrameBox!)).toBe(false);
    expect(overlaps(mediaFrameBox!, projectionBox!)).toBe(false);
    expect((commandsBox?.y ?? 0) - ((environmentBox?.y ?? 0) + (environmentBox?.height ?? 0)))
      .toBeGreaterThanOrEqual(-0.5);
    expect((commandsBox?.y ?? Infinity) - ((environmentBox?.y ?? 0) + (environmentBox?.height ?? 0)))
      .toBeLessThanOrEqual(8);
    expect(Math.abs(
      ((closeBox?.x ?? 0) + (closeBox?.width ?? 0)) -
      ((commandsBox?.x ?? 0) + (commandsBox?.width ?? 0)),
    )).toBeLessThanOrEqual(0.5);

    expect(focusBox).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    expect(graphState.transform).not.toBe("none");
    expect(graphState.filter).toContain("blur");
    expect(
      Math.max(
        Math.abs((before?.x ?? 0) - (after?.x ?? 0)),
        Math.abs((before?.y ?? 0) - (after?.y ?? 0)),
      ),
    ).toBeGreaterThan(1);

    const mediaLayoutBox = () => media.evaluate((element) => {
      const root = element.closest(".agent-focus") as HTMLElement;
      const rect = element.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      return {
        x: rect.left - rootRect.left + root.scrollLeft,
        y: rect.top - rootRect.top + root.scrollTop,
        width: rect.width,
        height: rect.height,
      };
    });

    const initialMedia = await mediaLayoutBox();
    await commands.getByRole("button", { name: "Next agent" }).click();
    const segmentFocus = page.getByRole("dialog", { name: "Segmenter 01" });
    await expect(segmentFocus).toBeVisible();
    await expectFocusSettled(segmentFocus);
    const afterNext = await mediaLayoutBox();
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(afterNext[dimension] - initialMedia[dimension])).toBeLessThanOrEqual(0.5);
    }

    await commands.getByRole("button", { name: "Previous agent" }).click();
    const orchestratorFocus = page.getByRole("dialog", { name: "Orchestrator" });
    await expect(orchestratorFocus).toBeVisible();
    await expectFocusSettled(orchestratorFocus);
    const afterPrevious = await mediaLayoutBox();
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(afterPrevious[dimension] - initialMedia[dimension])).toBeLessThanOrEqual(0.5);
    }

    await commands.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const [visibleCommandsBox, visibleDockBox, previousBox, nextBox, cycleLabelBox] =
      await Promise.all([
        commands.boundingBox(),
        page.locator(".dock-well").boundingBox(),
        cycleButtons.nth(0).boundingBox(),
        cycleButtons.nth(1).boundingBox(),
        cycleLabel.boundingBox(),
      ]);
    for (const box of [visibleCommandsBox, visibleDockBox, previousBox, nextBox, cycleLabelBox]) {
      expect(box).not.toBeNull();
    }
    expect((visibleCommandsBox?.y ?? 0) + (visibleCommandsBox?.height ?? 0)).toBeLessThanOrEqual(
      (visibleDockBox?.y ?? viewport.height) + 0.5,
    );
    expect((previousBox?.x ?? 0) + (previousBox?.width ?? 0)).toBeLessThanOrEqual(
      nextBox?.x ?? 0,
    );
    expect((cycleLabelBox?.x ?? 0) + (cycleLabelBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width + 0.5,
    );

    await page.keyboard.press("Escape");
    await expect(focus).toHaveCount(0);
  }
});
test("the recorded run uses its receipted source identity", async ({ page }) => {
  await page.goto("/studio/");
  await chooseSource(page, "Explore the recorded run-006 demo");
  await finishPreparation(page);

  const source = page.getByRole("group", {
    name: "Source: YouTube source Natural Korean Conversation with 태웅쌤 | 이렇게 귀하신 분이 ①",
  });
  await expect(source).toBeVisible();
  await expect(source.locator(".source-display-url")).toContainText(
    "Natural Korean Conversation with 태웅쌤 | 이렇게 귀하신 분이 ①",
  );
  await expect(page.locator(".top-source-provenance")).toHaveCount(0);
});

test("pause freezes the replay cursor and step advances exactly once", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("current-run");
  const lab = page.getByRole("complementary", { name: "Studio trace lab" });
  const transport = lab.getByRole("button", { name: "Resume", exact: true });
  await expect(transport).toBeEnabled();

  await transport.click();
  await expect.poll(async () => Number((await readout(page).textContent())?.split("/")[0].trim())).toBeGreaterThan(0);
  await lab.getByRole("button", { name: "Pause", exact: true }).click();

  const held = await readout(page).textContent();
  await page.waitForTimeout(400);
  await expect(readout(page)).toHaveText(held ?? "");

  const before = Number(held?.split("/")[0].trim());
  await page.getByRole("button", { name: "Step one" }).click();
  await expect.poll(async () => Number((await readout(page).textContent())?.split("/")[0].trim())).toBe(before + 1);
});

test("keyboard opens agent focus, restores the trigger, and keeps playback on the media", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("withheld");
  await page.getByRole("button", { name: "Collapse trace lab" }).click();

  const orchestrator = page.getByRole("button", { name: /^orchestrator,/ });
  const nodeBoxBefore = await settledBox(page, orchestrator);
  await orchestrator.focus();
  await page.keyboard.press("Enter");
  const focus = page.getByRole("dialog", { name: "Orchestrator" });
  await expect(focus).toBeVisible();
  await expect(focus.getByRole("button", { name: "Close agent focus" })).toBeFocused();
  expect(nodeBoxBefore).not.toBeNull();
  await page.keyboard.press("Escape");
  await expect(focus).toHaveCount(0);
  await expect(orchestrator).toBeFocused();

  const segmenter = page.getByRole("button", { name: /^Segmenter 01,/ });
  await segmenter.focus();
  await page.keyboard.press("Enter");
  const segmentFocus = page.getByRole("dialog", { name: "Segmenter 01" });
  await expect(segmentFocus.getByRole("complementary", { name: "Recorded activity" })).toBeVisible();
  await expect(segmentFocus.getByRole("heading", { name: "Complete" })).toBeVisible();
  await expect(segmentFocus.locator('.player[data-player-surface="workbench"]')).toBeVisible();
  await expect(segmentFocus.getByLabel("Recorded source video")).toBeVisible();
  await expect(segmentFocus.getByLabel("Recorded source video")).not.toHaveAttribute("controls");
  await expect(segmentFocus.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(segmentFocus.getByRole("button", { name: "Close agent focus" })).toBeFocused();
  await expect(segmentFocus.getByRole("button", { name: /recording/i })).toHaveCount(0);
});

test("mobile controls remain in the viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only layout assertion");
  await openLab(page);
  await scenario(page).selectOption("withheld");

  for (const locator of [page.locator(".dock"), page.locator(".studio-lab")]) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390.5);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
  }
});

test("reduced motion disables decorative animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/studio/");
  await startRecordedDemo(page);
  const thinkingMesh = page.locator('.hub [data-field-motion="thinking"] .agent-mark-mesh');
  await expect(thinkingMesh).toBeVisible();
  await expect(thinkingMesh).toHaveAttribute("data-mesh-motion", "still");

  await openLab(page);
  await scenario(page).selectOption("withheld");

  const orchestrator = page.getByRole("button", { name: /^orchestrator,/ });
  await orchestrator.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Orchestrator" })).toBeVisible();
  const focusTransitionSeconds = await page.locator(".agent-focus-spatial").evaluate((element) =>
    Math.max(...getComputedStyle(element).transitionDuration.split(",").map(Number.parseFloat))
  );
  expect(focusTransitionSeconds).toBeLessThanOrEqual(0.00001);

  const animations = await page.locator(".studio").evaluate((root) =>
    [...root.querySelectorAll("*")].filter((node) => {
      const style = getComputedStyle(node);
      return style.animationName !== "none" && style.animationDuration !== "0s";
    }).length,
  );
  expect(animations).toBe(0);
});

test("owned-media preflight keeps receipted language decisions separate from job configuration", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("regression");
  await expect(readout(page)).toHaveText(/\d+ \/ 72/);
  await page.getByRole("button", { name: "Ready", exact: true }).click();
  await page.getByRole("button", { name: "Collapse trace lab" }).click();
  await page.getByRole("button", { name: "Input Source" }).click();
  await chooseSource(page, "Explore the recorded run-006 demo");

  // The recorded source stage narrates its boundary conversationally. Opening the
  // range editor must still state that detector language ranges are not a
  // replayable job choice: only the recorded selection window can replay.
  await expect(page.getByRole("heading", { name: /^I found / })).toBeVisible();

  await page.getByRole("button", { name: "Continue to Range" }).click();
  await page.getByRole("button", { name: /^Update range/ }).click();
  const rangeSelection = page.getByLabel("Recorded range selection");
  await expect(rangeSelection).toBeVisible();
  await expect(rangeSelection).toContainText("Recorded selection");
  await expect(rangeSelection).toContainText(/no[\s\S]*detected-language sub-range/);
});
