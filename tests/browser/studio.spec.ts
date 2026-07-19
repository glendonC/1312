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

test.beforeEach(async ({ page }) => {
  await page.route("**/api/studio/source-resolutions", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { url: string };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sourceResolutionReceipt(body.url)) });
  });
});

async function openLab(page: Page): Promise<void> {
  await page.goto("/studio/?lab=1");
  await expect(page.getByRole("button", { name: "Preview YouTube with recorded demo" })).toBeVisible();
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

async function finishPreparation(page: Page, previewMode = true, keyboard = false): Promise<void> {
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
    name: previewMode ? /^I’m ready to open the recorded run-006 interface preview/ : /^I’m ready to replay this recorded analysis/,
  })).toBeVisible();
  const finalAction = page.getByRole("button", {
    name: previewMode ? "Preview run-006 recorded processing" : "Replay recorded analysis",
  });
  if (keyboard) await finalAction.press("Enter");
  else await finalAction.click();
}

async function startSubmittedPreview(
  page: Page,
  source = "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
): Promise<void> {
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  await page.getByRole("textbox", { name: "YouTube link for recorded preview" }).fill(source);
  await page.keyboard.press("Enter");
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
  await expect(page.getByRole("button", { name: "Preview YouTube with recorded demo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Owned file local ingest" })).toBeVisible();
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
  await page.getByRole("button", { name: "Owned file local ingest" }).click();

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
  await expect(page.getByRole("button", { name: "Preview YouTube with recorded demo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explore run-006 recorded demo" })).toBeVisible();
});

test("recorded and owned setup paths share the centered staged panel", async ({ page }) => {
  await page.goto("/studio/");
  const dockBefore = await page.locator(".studio-source-dock").boundingBox();

  await page.getByRole("button", { name: "Explore run-006 recorded demo" }).click();
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

  await page.getByRole("button", { name: "Owned file local ingest" }).click();
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
  await page.getByRole("button", { name: "Owned file local ingest" }).click();
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
  await page.getByRole("button", { name: "Owned file local ingest" }).click();
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

  await expect(page.getByRole("heading", { name: /Welcome to Studio/ })).toBeVisible();
  await expect(page.getByText(/sit back and watch it come together/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Explore run-006 recorded demo" })).toBeVisible();

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

  const addSource = page.getByRole("button", { name: "Preview YouTube with recorded demo" });
  await addSource.click();
  await expect(page.getByRole("textbox", { name: "YouTube link for recorded preview" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(addSource).toBeFocused();
});

test("client navigation from Home preserves Studio material tokens", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "View demo", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/$/);
  await expect(page.getByRole("heading", { name: /Welcome to Studio/ })).toBeVisible();

  const option = page.locator('.studio-source-option[data-palette="peach"]');
  await expect(option).toBeVisible();
  const clientNavigationStyle = await option.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      palette: style.getPropertyValue("--palette-color").trim(),
      highlight: style.getPropertyValue("--glass-highlight-soft").trim(),
      blur: style.getPropertyValue("--glass-blur-compact").trim(),
      backgroundImage: style.backgroundImage,
      backdropFilter: style.backdropFilter,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
    };
  });

  expect(clientNavigationStyle.palette).not.toBe("");
  expect(clientNavigationStyle.highlight).not.toBe("");
  expect(clientNavigationStyle.blur).not.toBe("");
  expect(clientNavigationStyle.backgroundImage).not.toBe("none");
  expect(clientNavigationStyle.backdropFilter).not.toBe("none");
  expect(clientNavigationStyle.borderRadius).toBe("12px");
  expect(clientNavigationStyle.boxShadow).toContain("inset");

  await page.reload();
  await expect(option).toBeVisible();
  await expect.poll(async () => option.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      backdropFilter: style.backdropFilter,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
    };
  })).toEqual({
    backgroundImage: clientNavigationStyle.backgroundImage,
    backdropFilter: clientNavigationStyle.backdropFilter,
    borderRadius: clientNavigationStyle.borderRadius,
    boxShadow: clientNavigationStyle.boxShadow,
  });
});

test("source authority options separate live local ingest from recorded preview", async ({ page }) => {
  await page.goto("/studio/");

  const optionRow = page.locator(".studio-source-options");
  const optionControls = optionRow.locator(".studio-source-option");
  const youtubeLocal = page.getByRole("button", { name: "YouTube local ingest" });
  const demo = page.getByRole("button", { name: "Explore run-006 recorded demo" });
  const ownedMedia = page.getByRole("button", { name: "Owned file local ingest" });
  const samples = page.getByRole("button", { name: "Recorded YouTube samples" });

  await expect(optionRow).toBeVisible();
  await expect(optionControls).toHaveCount(4);
  await expect(youtubeLocal).toHaveAttribute("data-source-authority", "live-local");
  await expect(ownedMedia).toHaveAttribute("data-source-authority", "live-local");
  await expect(demo).toHaveAttribute("data-source-authority", "recorded");
  await expect(samples).toHaveAttribute("data-source-authority", "recorded");
  await expect(demo).toBeVisible();
  await expect(ownedMedia).toBeVisible();
  await expect(samples).toHaveAttribute("aria-haspopup", "menu");
  expect(await optionControls.evaluateAll((controls) => controls.map((control) => ({
    palette: control.getAttribute("data-palette"),
    height: Math.round(control.getBoundingClientRect().height),
    radius: Number.parseFloat(getComputedStyle(control).borderRadius),
  })))).toEqual([
    { palette: "teal", height: 34, radius: 12 },
    { palette: "blue", height: 34, radius: 12 },
    { palette: "peach", height: 34, radius: 12 },
    { palette: "coral", height: 34, radius: 12 },
  ]);

  const optionShadowsAreInset = await optionControls.evaluateAll((controls) => {
    const splitLayers = (value: string) => {
      const layers: string[] = [];
      let depth = 0;
      let start = 0;
      for (let index = 0; index < value.length; index += 1) {
        if (value[index] === "(") depth += 1;
        if (value[index] === ")") depth -= 1;
        if (value[index] === "," && depth === 0) {
          layers.push(value.slice(start, index).trim());
          start = index + 1;
        }
      }
      layers.push(value.slice(start).trim());
      return layers;
    };
    return controls.every((control) => {
      const shadow = getComputedStyle(control).boxShadow;
      return shadow === "none" || splitLayers(shadow).every((layer) => layer.includes("inset"));
    });
  });
  expect(optionShadowsAreInset).toBe(true);

  await samples.focus();
  await samples.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Recorded YouTube samples" });
  const firstSample = page.getByRole("menuitem", { name: "Korean sample 01 Recorded preview link" });
  const secondSample = page.getByRole("menuitem", { name: "Korean sample 02 Recorded preview link" });
  await expect(menu).toBeVisible();
  await expect(firstSample).toBeFocused();
  await firstSample.press("ArrowDown");
  await expect(secondSample).toBeFocused();
  await secondSample.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(samples).toBeFocused();

  await samples.click();
  await expect(firstSample).toBeFocused();
  await page.getByRole("heading", { name: /Welcome to Studio/ }).click();
  await expect(menu).toHaveCount(0);

  await samples.click();
  await firstSample.click();
  const sourceField = page.getByRole("textbox", { name: "YouTube link for recorded preview" });
  await expect(sourceField).toBeFocused();
  await expect(sourceField).toHaveValue(
    "https://www.youtube.com/watch?v=hWxESR68Olg&list=RDhWxESR68Olg&start_radio=1&pp=oAcB",
  );
  await page.waitForTimeout(420);
  const sourceBarBefore = await page.locator(".source-entry .dock-bar").boundingBox();

  await samples.click();
  await secondSample.click();
  await expect(sourceField).toBeFocused();
  await expect(sourceField).toHaveValue("https://www.youtube.com/watch?v=XauBqFepc-s");
  await expect(page.getByRole("button", { name: "Resolve metadata for recorded preview" })).toBeVisible();
  await page.waitForTimeout(240);
  const sourceBarAfter = await page.locator(".source-entry .dock-bar").boundingBox();
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs((sourceBarAfter?.[key] ?? Infinity) - (sourceBarBefore?.[key] ?? -Infinity))).toBeLessThanOrEqual(2);
  }
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
    await page.getByRole("button", { name: "YouTube local ingest" }).click();

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

test("a failed source check reports directly above the source dock", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  const source = page.getByRole("textbox", { name: "YouTube link for recorded preview" });
  await source.fill("https://example.com/media");
  await page.keyboard.press("Enter");

  const notice = page.getByRole("alert");
  await expect(notice).toHaveText("example.com has no registered source adapter.");
  await expect(source).toBeVisible();

  const [noticeBox, dockBox] = await Promise.all([
    notice.boundingBox(),
    page.locator(".source-dock-actions").boundingBox(),
  ]);
  expect(noticeBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect((noticeBox?.y ?? 0) + (noticeBox?.height ?? 0)).toBeLessThan(dockBox?.y ?? 0);
});

test("an identified source keeps the URL editor unchanged", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  const source = page.getByRole("textbox", { name: "YouTube link for recorded preview" });
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

    const orchestrator = page.locator(".welcome-orchestrator-anchor");
    const panel = page.locator(".welcome-panel");
    const addSource = page.getByRole("button", { name: "Preview YouTube with recorded demo" });
    const options = page.locator(".studio-source-options");
    const youtubeLocal = page.getByRole("button", { name: "YouTube local ingest" });
    const demo = page.getByRole("button", { name: "Explore run-006 recorded demo" });
    const ownedMedia = page.getByRole("button", { name: "Owned file local ingest" });
    const samples = page.getByRole("button", { name: "Recorded YouTube samples" });
    const [orchestratorBox, panelBox, addSourceBox, optionsBox] = await Promise.all([
      orchestrator.boundingBox(),
      panel.boundingBox(),
      addSource.boundingBox(),
      options.boundingBox(),
    ]);

    expect(orchestratorBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(addSourceBox).not.toBeNull();
    expect(optionsBox).not.toBeNull();
    expect(orchestratorBox?.x ?? 0).toBeLessThan(panelBox?.x ?? 0);
    expect(
      Math.abs((addSourceBox?.x ?? 0) + (addSourceBox?.width ?? 0) / 2 - viewport.width / 2),
    ).toBeLessThanOrEqual(0.5);
    await expect(youtubeLocal).toBeVisible();
    await expect(demo).toBeVisible();
    await expect(ownedMedia).toBeVisible();
    await expect(samples).toBeVisible();
    expect(optionsBox?.y ?? 0).toBeGreaterThanOrEqual((panelBox?.y ?? 0) + (panelBox?.height ?? 0));

    await samples.click();
    const sampleMenu = page.getByRole("menu", { name: "Recorded YouTube samples" });
    await expect(sampleMenu).toBeVisible();
    const sampleMenuBox = await sampleMenu.boundingBox();
    expect(sampleMenuBox).not.toBeNull();
    expect(sampleMenuBox?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect((sampleMenuBox?.x ?? 0) + (sampleMenuBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

    for (const locator of [orchestrator, panel, addSource, options, demo, ownedMedia, samples]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 0.5);
    }
  }
});

test("a submitted source moves through setup and forecast before the recorded interface preview", async ({ page }, testInfo) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  const clipField = page.getByRole("textbox", { name: "YouTube link for recorded preview" });
  const submittedUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  await clipField.fill(submittedUrl);
  await page.waitForTimeout(420);
  const welcomeLockupBefore = await page.locator(".welcome-lockup").boundingBox();
  const welcomeOrbBefore = await page.locator(".welcome-orchestrator-anchor").boundingBox();
  const welcomePanelBefore = await page.locator(".welcome-panel").boundingBox();
  const sourceDockBefore = await page.locator(".studio-source-dock").boundingBox();
  const sourceBarBefore = await page.locator(".source-entry .dock-bar").boundingBox();
  await page.keyboard.press("Enter");

  await expect(page.locator('.studio[data-stage="input"]')).toBeVisible();
  await expect(page.getByText("Source guide", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Metadata resolved" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resolved browser-test video" })).toBeVisible();
  await expect(clipField).toHaveCount(0);
  const lifecycleBar = page.getByLabel("Studio lifecycle");
  await expect(lifecycleBar).toHaveAttribute("data-lifecycle-mode", "preparation");
  await expect(lifecycleBar).toHaveAttribute("data-preparation-stage", "source");
  await expect(lifecycleBar.locator(".dock-status")).toHaveText("Source");
  await expect(lifecycleBar.locator(".dock-pct")).toHaveText("1 / 6");
  await expect(lifecycleBar.getByRole("button", { name: "Exit setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Pause|Resume/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Live local and recorded source options" })).toHaveCount(0);
  await page.waitForTimeout(420);
  const welcomeLockupAfter = await page.locator(".welcome-lockup").boundingBox();
  const welcomeOrbAfter = await page.locator(".welcome-orchestrator-anchor").boundingBox();
  const welcomePanelAfter = await page.locator(".preflight-stage-panel").boundingBox();
  const sourceDockAfter = await page.locator(".studio-source-dock").boundingBox();
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs((sourceDockAfter?.[key] ?? Infinity) - (sourceDockBefore?.[key] ?? -Infinity))).toBeLessThanOrEqual(2);
  }
  expect(sourceBarBefore).not.toBeNull();
  const lifecycleBarBox = await lifecycleBar.boundingBox();
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  expect(lifecycleBarBox).not.toBeNull();
  expect(Math.abs((lifecycleBarBox?.x ?? 0) + (lifecycleBarBox?.width ?? 0) / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1);
  if (testInfo.project.name === "desktop") {
    expect(Math.abs((welcomeLockupAfter?.x ?? Infinity) - (welcomeLockupBefore?.x ?? -Infinity))).toBeLessThanOrEqual(1);
    expect(Math.abs((welcomeLockupAfter?.width ?? Infinity) - (welcomeLockupBefore?.width ?? -Infinity))).toBeLessThanOrEqual(1);
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(Math.abs((welcomeOrbAfter?.[key] ?? Infinity) - (welcomeOrbBefore?.[key] ?? -Infinity))).toBeLessThanOrEqual(1);
    }
    const welcomePanelCenterBefore = (welcomePanelBefore?.x ?? Infinity) + (welcomePanelBefore?.width ?? 0) / 2;
    const welcomePanelCenterAfter = (welcomePanelAfter?.x ?? -Infinity) + (welcomePanelAfter?.width ?? 0) / 2;
    expect(Math.abs(welcomePanelCenterAfter - welcomePanelCenterBefore)).toBeLessThanOrEqual(1);
  }
  const sourceBoundary = page.getByRole("note", { name: "Submitted source metadata boundary" });
  await expect(sourceBoundary).toContainText(
    "I found Resolved browser-test video by Recorded test producer. It’s 1:23 long. I haven’t downloaded or processed the media.",
  );
  const sourceLink = sourceBoundary.getByRole("link", {
    name: "Resolved browser-test video",
  });
  await expect(sourceLink).toHaveAttribute("href", "https://www.youtube.com/watch?v=fixturevideo");
  await expect(sourceLink).toHaveAttribute("target", "_blank");
  await expect(sourceLink).toHaveAttribute("rel", "noreferrer");
  await expect(sourceLink).toHaveAttribute("title", "Open on YouTube in a new tab");
  const sourceLinkIdleBackground = await sourceLink.evaluate((element) => getComputedStyle(element).backgroundColor);
  await sourceLink.hover();
  await expect.poll(() => sourceLink.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(sourceLinkIdleBackground);
  await expect(sourceBoundary).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".preflight-stage-panel")).toHaveCSS("min-height", "0px");
  await expect(page.locator(".preflight-stage-panel")).toHaveCSS("max-height", "none");
  await expect(page.locator(".preflight-stage-panel .preflight-actions")).toHaveCount(0);
  const preparationControls = page.getByRole("group", { name: "Preparation controls" });
  await expect(preparationControls).toBeVisible();
  await expect(page.locator(".preflight-stage-panel")).toHaveCSS("z-index", "2");
  await expect(preparationControls).toHaveCSS("z-index", "1");
  await expect(preparationControls.getByRole("button", { name: /Back to/ })).toHaveCount(0);
  const continueToRange = preparationControls.getByRole("button", { name: "Continue to Range" });
  await expect(continueToRange).toBeVisible();
  await expect(continueToRange.locator("svg")).toHaveCount(1);
  expect(await continueToRange.evaluate((element) => getComputedStyle(element, "::before").content)).toBe("none");
  expect(await continueToRange.evaluate((element) => getComputedStyle(element, "::after").content)).toBe("none");
  await expect(continueToRange).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(continueToRange.locator(".preflight-control-label")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  const preparationControlsBox = await preparationControls.boundingBox();
  const continueToRangeBox = await continueToRange.boundingBox();
  expect(preparationControlsBox).not.toBeNull();
  expect(continueToRangeBox).not.toBeNull();
  expect(preparationControlsBox?.width ?? Infinity).toBeLessThan(welcomePanelAfter?.width ?? 0);
  expect(Math.abs(
    (continueToRangeBox?.x ?? 0) + (continueToRangeBox?.width ?? 0) / 2 -
    ((preparationControlsBox?.x ?? 0) + (preparationControlsBox?.width ?? 0) / 2),
  )).toBeLessThanOrEqual(1);
  expect(Math.abs(
    (preparationControlsBox?.y ?? 0) -
    ((welcomePanelAfter?.y ?? 0) + (welcomePanelAfter?.height ?? 0) - 1),
  )).toBeLessThanOrEqual(2.5);
  expect((preparationControlsBox?.y ?? 0) + (preparationControlsBox?.height ?? 0))
    .toBeLessThan((lifecycleBarBox?.y ?? 0) - 8);
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  await expect(page.getByText("Source ready", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Resolved source", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Source details", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Provider metadata only/i)).toHaveCount(0);
  await expect(page.getByLabel("Recorded selection · 0:00–0:40")).toHaveCount(0);
  await expect(page.getByText("Recorded fixture facts · not the submitted link")).toHaveCount(0);
  await expect(page.getByText("Didi's Korean Culture Podcast")).toHaveCount(0);
  await expect(page.getByText("Creative Commons Attribution license (reuse allowed)")).toHaveCount(0);
  await expect(page.getByText("ko-v3")).toHaveCount(0);
  await expect(page.getByText("mp4 · h264 1280×720 · aac 48000Hz 2ch")).toHaveCount(0);

  const requestForm = page.locator(".preflight-form");
  await expect(requestForm).toHaveAttribute("data-preparation-status", "ready");
  await expect(requestForm.locator(".preflight-stage-nav button")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "01 Source" })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("button", { name: "02 Range" })).toBeDisabled();
  const stagePaletteContracts = await requestForm.locator(".preflight-stage-nav").evaluate((navigation) =>
    [...navigation.querySelectorAll("button")].map((button) => {
      const style = getComputedStyle(button);
      return {
        name: button.getAttribute("data-palette"),
        color: style.getPropertyValue("--palette-color").trim(),
        ink: style.getPropertyValue("--palette-ink").trim(),
        soft: style.getPropertyValue("--palette-soft").trim(),
        shadow: style.boxShadow,
      };
    }),
  );
  expect(stagePaletteContracts.map(({ name }) => name)).toEqual([
    "coral",
    "citron",
    "blue",
    "lilac",
    "peach",
    "teal",
  ]);
  expect(new Set(stagePaletteContracts.map(({ color }) => color)).size).toBe(6);
  expect(new Set(stagePaletteContracts.map(({ ink }) => ink)).size).toBe(6);
  expect(new Set(stagePaletteContracts.map(({ soft }) => soft)).size).toBe(6);
  expect(stagePaletteContracts.every(({ shadow }) =>
    shadow
      .split(/,\s*(?=(?:rgba?|color)\()/)
      .every((layer) => layer.includes("inset")),
  )).toBe(true);
  await expect(requestForm).toHaveAttribute("data-palette", "coral");
  expect(await requestForm.evaluate((element) => getComputedStyle(element, "::before").content)).toBe("none");
  const initialRequestId = await requestForm.getAttribute("data-submitted-preparation-request-id");
  expect(initialRequestId).toMatch(/^submitted-preparation:/);

  await page.getByRole("button", { name: "Continue to Range" }).click();
  await expect(preparationControls.getByRole("button", { name: "Back to Source" })).toBeVisible();
  await expect(lifecycleBar).toHaveAttribute("data-preparation-stage", "range");
  await expect(lifecycleBar.locator(".dock-status")).toHaveText("Range");
  await expect(lifecycleBar.locator(".dock-pct")).toHaveText("2 / 6");
  await expect(page.getByRole("heading", { name: /^I’ll prepare / })).toBeFocused();
  await expect(requestForm).toHaveAttribute("data-palette", "citron");
  const rangeParameter = preparationControls.getByRole("button", { name: "Update range: 0:00–1:23" });
  const backToSource = preparationControls.getByRole("button", { name: "Back to Source" });
  const continueToLanguage = preparationControls.getByRole("button", { name: "Continue to Language" });
  for (const navigationAction of [backToSource, continueToLanguage]) {
    await expect(navigationAction.locator("svg")).toHaveCount(1);
    await expect(navigationAction).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(navigationAction.locator(".preflight-control-label")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    expect(await navigationAction.evaluate((element) => getComputedStyle(element, "::before").content)).toBe("none");
    expect(await navigationAction.evaluate((element) => getComputedStyle(element, "::after").content)).toBe("none");
  }
  const [rangePanelBox, rangeShelfBox, backIconBox] = await Promise.all([
    page.locator(".preflight-stage-panel").boundingBox(),
    preparationControls.boundingBox(),
    backToSource.locator(".preflight-control-icon").boundingBox(),
  ]);
  const visibleTopSpace = (backIconBox?.y ?? Infinity) -
    ((rangePanelBox?.y ?? 0) + (rangePanelBox?.height ?? 0));
  const visibleBottomSpace = ((rangeShelfBox?.y ?? 0) + (rangeShelfBox?.height ?? 0)) -
    ((backIconBox?.y ?? Infinity) + (backIconBox?.height ?? 0));
  expect(Math.abs(visibleTopSpace - visibleBottomSpace)).toBeLessThanOrEqual(1.5);
  await expect(rangeParameter).toHaveAttribute("aria-expanded", "false");
  const geometryBeforeRangePopover = await Promise.all([
    page.locator(".preflight-stage-panel").boundingBox(),
    preparationControls.boundingBox(),
    lifecycleBar.boundingBox(),
  ]);
  await rangeParameter.click();
  await expect(rangeParameter).toHaveAttribute("aria-expanded", "true");
  const rangePopover = page.getByRole("dialog", { name: "Range options" });
  await expect(rangePopover).toBeVisible();
  await expect(rangePopover).toHaveAttribute("popover", "auto");
  const geometryWithRangePopover = await Promise.all([
    page.locator(".preflight-stage-panel").boundingBox(),
    preparationControls.boundingBox(),
    lifecycleBar.boundingBox(),
  ]);
  for (let index = 0; index < geometryBeforeRangePopover.length; index += 1) {
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(
        (geometryWithRangePopover[index]?.[key] ?? Infinity) -
        (geometryBeforeRangePopover[index]?.[key] ?? -Infinity),
      )).toBeLessThanOrEqual(1);
    }
  }
  const [rangePopoverBox, rangeTriggerBox] = await Promise.all([
    rangePopover.boundingBox(),
    rangeParameter.boundingBox(),
  ]);
  expect(rangePopoverBox).not.toBeNull();
  expect(rangeTriggerBox).not.toBeNull();
  expect(rangePopoverBox?.x ?? -1).toBeGreaterThanOrEqual(7.5);
  expect(rangePopoverBox?.y ?? -1).toBeGreaterThanOrEqual(7.5);
  expect((rangePopoverBox?.x ?? 0) + (rangePopoverBox?.width ?? 0)).toBeLessThanOrEqual(viewportWidth - 7.5);
  // The Range editor opens downward, attached below the control shelf — it never covers the panel face.
  await expect(rangePopover).toHaveAttribute("data-placement", "below");
  expect(rangePopoverBox?.y ?? -1).toBeGreaterThanOrEqual(
    (rangeShelfBox?.y ?? 0) + (rangeShelfBox?.height ?? 0) - 1,
  );
  // ...and stays clamped within the center panel's horizontal bounds, not merely the viewport.
  expect(rangePopoverBox?.x ?? -1).toBeGreaterThanOrEqual((rangePanelBox?.x ?? 0) - 0.5);
  expect((rangePopoverBox?.x ?? 0) + (rangePopoverBox?.width ?? 0)).toBeLessThanOrEqual(
    (rangePanelBox?.x ?? 0) + (rangePanelBox?.width ?? 0) + 0.5,
  );
  await expect(page.getByLabel("Entire video, 1:23")).toBeChecked();
  await expect(
    rangePopover.locator('.preflight-range-choice[data-selected="true"] .preflight-range-choice-indicator'),
  ).toBeVisible();
  // The oversized checkmark tile is gone; selection now reads through a restrained radio indicator.
  await expect(rangePopover.locator(".preflight-choice-check")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(rangePopover).not.toBeVisible();
  await expect(rangeParameter).toHaveAttribute("aria-expanded", "false");
  await expect(rangeParameter).toBeFocused();
  await rangeParameter.click();
  await expect(rangePopover).toBeVisible();
  await lifecycleBar.locator(".dock-status").click();
  await expect(rangePopover).not.toBeVisible();
  await expect(rangeParameter).toBeFocused();
  await rangeParameter.click();
  await page.getByRole("radio", { name: "Custom range" }).check();
  await expect(rangePopover.getByText("2 min max", { exact: true })).toBeVisible();
  const rangeTrim = rangePopover.getByRole("group", { name: "Custom range trim" });
  const startGrip = rangeTrim.getByRole("slider", { name: "Start trim handle" });
  await startGrip.press("ArrowRight");
  await expect(page.getByRole("textbox", { name: "Start timestamp" })).toHaveValue("0:01");
  const rangeEnd = page.getByRole("textbox", { name: "End timestamp" });
  await expect(rangeEnd).toHaveValue("1:23");
  await expect.poll(() => rangePopover.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
  await rangeEnd.fill("1:30");
  // The invalid reason is shown inline in the editor (the stage sentence echoes it too, so scope here).
  await expect(rangePopover.getByText("Choose a valid range within 0:00–1:23.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to Language" })).toBeDisabled();
  // Bare seconds are accepted and normalized to M:SS when the field commits.
  await rangeEnd.fill("80");
  await rangeEnd.press("Enter");
  await expect(rangeEnd).toHaveValue("1:20");
  await expect(page.getByRole("button", { name: "Continue to Language" })).toBeEnabled();
  await expect(requestForm).toHaveAttribute("data-preparation-status", "ready");
  const changedRangeRequestId = await requestForm.getAttribute("data-submitted-preparation-request-id");
  expect(changedRangeRequestId).not.toBe(initialRequestId);
  await page.getByLabel("Entire video, 1:23").check();

  await page.getByRole("button", { name: "Continue to Language" }).click();
  await expect(lifecycleBar).toHaveAttribute("data-preparation-stage", "language");
  await expect(lifecycleBar.locator(".dock-status")).toHaveText("Language");
  await expect(lifecycleBar.locator(".dock-pct")).toHaveText("3 / 6");
  await expect(requestForm).toHaveAttribute("data-palette", "blue");
  const languageParameter = preparationControls.getByRole("button", {
    name: "Update language: Detect later → English",
  });
  await expect(languageParameter).toHaveAttribute("aria-expanded", "false");
  await languageParameter.click();
  const languagePopover = page.getByRole("dialog", { name: "Language options" });
  await expect(languagePopover).toBeVisible();
  const automaticLanguage = page.getByLabel("Automatic (detection requested later)");
  const declaredLanguage = page.getByLabel("Declare the source language");
  await expect(automaticLanguage).toBeChecked();
  await expect(automaticLanguage).toBeFocused();
  await automaticLanguage.press("ArrowDown");
  await expect(declaredLanguage).toBeChecked();
  await page.getByRole("textbox", { name: "Declared BCP-47 language" }).fill("ko");
  await expect(requestForm).toHaveAttribute("data-preparation-status", "ready");
  const changedLanguageRequestId = await requestForm.getAttribute("data-submitted-preparation-request-id");
  expect(changedLanguageRequestId).not.toBe(changedRangeRequestId);
  await page.keyboard.press("Escape");
  await expect(languagePopover).not.toBeVisible();
  await expect(preparationControls.getByRole("button", {
    name: "Update language: Korean → English",
  })).toBeFocused();

  await page.getByRole("button", { name: "Continue to Output" }).click();
  await expect(lifecycleBar).toHaveAttribute("data-preparation-stage", "output");
  await expect(lifecycleBar.locator(".dock-status")).toHaveText("Output");
  await expect(lifecycleBar.locator(".dock-pct")).toHaveText("4 / 6");
  await expect(requestForm).toHaveAttribute("data-palette", "lilac");
  const outputParameter = preparationControls.getByRole("button", {
    name: "Update output: Watch aids + evidence",
  });
  await outputParameter.click();
  const outputPopover = page.getByRole("dialog", { name: "Output options" });
  await expect(outputPopover).toBeVisible();
  await expect(page.getByLabel("Watch aids plus evidence and breakdown")).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(outputPopover).not.toBeVisible();
  await expect(outputParameter).toBeFocused();
  await page.getByRole("button", { name: "Continue to Forecast" }).click();
  await expect(lifecycleBar).toHaveAttribute("data-preparation-stage", "forecast");
  await expect(lifecycleBar.locator(".dock-status")).toHaveText("Forecast");
  await expect(lifecycleBar.locator(".dock-pct")).toHaveText("5 / 6");
  await expect(requestForm).toHaveAttribute("data-palette", "peach");
  const forecast = page.getByRole("heading", { name: /^I’ve bound / });
  await expect(forecast).toBeVisible();
  await expect(forecast).toBeFocused();
  await expect(forecast).toContainText("I still can’t forecast processing time, cost, scale, or workload");
  const currentSetup = preparationControls.getByRole("button", { name: "Review current setup" });
  await currentSetup.click();
  const forecastPopover = page.getByRole("dialog", { name: "Forecast options" });
  await expect(forecastPopover).toBeVisible();
  await expect(page.getByRole("group", { name: "Current setup parameters" })).toBeVisible();
  const rangeSetupRow = page.getByRole("button", { name: /Edit range:/ });
  const languageSetupRow = page.getByRole("button", { name: /Edit language: Korean → English/ });
  await expect(rangeSetupRow).toBeFocused();
  await rangeSetupRow.press("ArrowDown");
  await expect(languageSetupRow).toBeFocused();
  await expect(page.locator("[data-submitted-preparation-request-id]")).toHaveCount(1);
  await languageSetupRow.click();
  await expect(page.getByRole("heading", { name: /^I’ll / })).toBeFocused();
  await page.getByRole("button", { name: "05 Forecast" }).click();
  await expect(forecast).toBeFocused();
  await page.getByRole("button", { name: "Continue to Review" }).click();
  await expect(lifecycleBar).toHaveAttribute("data-preparation-stage", "confirm");
  await expect(lifecycleBar.locator(".dock-status")).toHaveText("Review");
  await expect(lifecycleBar.locator(".dock-pct")).toHaveText("6 / 6");
  await expect(requestForm).toHaveAttribute("data-palette", "teal");
  await expect(page.getByRole("heading", { name: /^I’m ready to open the recorded run-006 interface preview/ }))
    .toBeFocused();
  await expect(page.getByRole("heading", { name: /won’t download or process Resolved browser-test video/i })).toBeVisible();
  await expect(page.getByText(/does not submit a runtime command/i)).toBeVisible();
  const reviewSetup = preparationControls.getByRole("button", { name: "Review current setup" });
  await reviewSetup.click();
  const reviewPopover = page.getByRole("dialog", { name: "Review options" });
  await expect(reviewPopover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(reviewPopover).not.toBeVisible();
  await expect(reviewSetup).toBeFocused();
  await page.getByRole("button", { name: "Preview run-006 recorded processing" }).click();

  await expect(lifecycleBar).toHaveAttribute("data-lifecycle-mode", "initializing");
  await expect(lifecycleBar).toContainText("Initializing recorded preview");
  await expect(lifecycleBar.locator(".dock-pct")).toHaveText("");
  await expect(lifecycleBar.locator(".dock-pct")).toHaveAttribute("aria-hidden", "true");
  await expect(preparationControls).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pause|Resume/ })).toHaveCount(0);
  await lifecycleBar.getByRole("button", { name: "Cancel start" }).click();
  await expect(lifecycleBar).toHaveAttribute("data-lifecycle-mode", "preparation");
  await expect(lifecycleBar).toHaveAttribute("data-preparation-stage", "confirm");
  await expect(preparationControls).toBeVisible();
  await expect(page.locator('.studio[data-stage="input"]')).toBeVisible();
  await page.getByRole("button", { name: "Preview run-006 recorded processing" }).click();
  await expect(lifecycleBar).toHaveAttribute("data-lifecycle-mode", "initializing");
  await expect(preparationControls).toHaveCount(0);

  await expect(page.locator('.studio[data-stage="run"]')).toBeVisible();
  await expect(lifecycleBar).toHaveCount(0);
  await expect(page.locator('.hub [data-agent-identity="orchestrator-root"]')).toBeVisible();
  const thinking = page.locator('.hub [data-field-motion="thinking"]');
  await expect(thinking).toBeVisible();
  await expect(thinking.locator(".agent-mark-mesh")).toHaveAttribute("data-mesh-motion", "running");
  const sourceIdentity = page.getByRole("group", {
    name: "Source: YouTube video link dQw4w9WgXcQ",
  });
  const provenance = page.getByRole("note").filter({
    hasText: "This interface preview uses a recorded run. Your source was not processed.",
  });
  await expect(sourceIdentity).toBeVisible();
  await expect(provenance).toBeVisible();
  await expect(provenance).toContainText("preparation request did not start a runtime");
  expect(await provenance.evaluate((element) => element.closest(".top-mid"))).toBeNull();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Hosted source probe unavailable")).toHaveCount(0);

  const runDock = page.locator(".dock");
  const stop = page.getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible();
  await expect
    .poll(async () => {
      const [dockBox, stopBox] = await Promise.all([runDock.boundingBox(), stop.boundingBox()]);
      if (!dockBox || !stopBox) return Infinity;
      return dockBox.x + dockBox.width - (stopBox.x + stopBox.width);
    })
    .toBeLessThanOrEqual(10);
});

test("submitted metadata resolution stays in the welcome composition", async ({ page }) => {
  await page.unroute("**/api/studio/source-resolutions");
  let releaseResolution!: () => void;
  const resolutionGate = new Promise<void>((resolve) => {
    releaseResolution = resolve;
  });
  await page.route("**/api/studio/source-resolutions", async (route) => {
    const request = route.request().postDataJSON() as { url: string };
    await resolutionGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sourceResolutionReceipt(request.url)),
    });
  });

  await page.goto("/studio/");
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  await page.getByRole("textbox", { name: "YouTube link for recorded preview" }).fill("https://youtu.be/resolvingfixture");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Source guide", { exact: true })).toBeVisible();
  const sourceGuideStatus = page.locator('.welcome-guide-copy [role="status"]');
  await expect(sourceGuideStatus).toHaveText("Resolving provider metadata…");
  await expect(sourceGuideStatus).toHaveClass(/text-shimmer/);
  await expect(sourceGuideStatus).toHaveCSS("color", "rgba(0, 0, 0, 0)");
  await expect(sourceGuideStatus).toHaveCSS("animation-name", "text-shimmer-sweep");
  const lifecycleBar = page.getByLabel("Studio lifecycle");
  await expect(lifecycleBar).toHaveAttribute("data-lifecycle-mode", "resolving");
  await expect(lifecycleBar.locator(".dock-status")).toHaveText("Resolving metadata…");
  await expect(lifecycleBar.locator(".dock-pct")).toHaveText("");
  await expect(lifecycleBar.locator(".dock-pct")).toHaveAttribute("aria-hidden", "true");
  await expect(lifecycleBar.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(lifecycleBar).toHaveCSS("display", "flex");
  await expect(lifecycleBar).toHaveCSS("border-radius", "999px");
  await expect(lifecycleBar).toHaveCSS("background-color", "rgba(255, 255, 255, 0.58)");
  expect(await lifecycleBar.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
  await expect(lifecycleBar.locator(".studio-lifecycle-bar-content")).toHaveCSS("display", "grid");
  await expect(lifecycleBar.getByRole("button", { name: "Cancel" })).toHaveCSS("height", "40px");
  await expect(page.getByRole("button", { name: /Pause|Resume/ })).toHaveCount(0);
  await expect(page.getByRole("heading", {
    name: "One moment—I’m asking YouTube for the title, creator, and duration. The media itself remains untouched.",
  })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "YouTube link for recorded preview" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Live local and recorded source options" })).toHaveCount(0);
  await expect(page.locator(".preflight")).toHaveCount(0);

  releaseResolution();
  await expect(sourceGuideStatus).toHaveText("Metadata resolved");
  await expect(sourceGuideStatus).not.toHaveClass(/text-shimmer/);
  await expect(page.getByRole("heading", { name: "Resolved browser-test video" })).toBeVisible();
});

test("metadata resolution can be cancelled without implying a pausable operation", async ({ page }) => {
  await page.unroute("**/api/studio/source-resolutions");
  let releaseResolution!: () => void;
  const resolutionGate = new Promise<void>((resolve) => {
    releaseResolution = resolve;
  });
  await page.route("**/api/studio/source-resolutions", async (route) => {
    const request = route.request().postDataJSON() as { url: string };
    await resolutionGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sourceResolutionReceipt(request.url)),
    }).catch(() => undefined);
  });

  await page.goto("/studio/");
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  const submittedUrl = "https://youtu.be/cancelledfixture";
  await page.getByRole("textbox", { name: "YouTube link for recorded preview" }).fill(submittedUrl);
  await page.getByRole("button", { name: "Resolve metadata for recorded preview" }).click();

  const lifecycleBar = page.getByLabel("Studio lifecycle");
  await expect(lifecycleBar).toHaveAttribute("data-lifecycle-mode", "resolving");
  await expect(page.getByRole("button", { name: /Pause|Resume/ })).toHaveCount(0);
  await lifecycleBar.getByRole("button", { name: "Cancel" }).click();

  const sourceField = page.getByRole("textbox", { name: "YouTube link for recorded preview" });
  await expect(sourceField).toBeVisible();
  await expect(sourceField).toHaveValue(submittedUrl);
  await expect(sourceField).toBeFocused();
  await expect(lifecycleBar).toHaveCount(0);

  releaseResolution();
  await page.waitForTimeout(150);
  await expect(page.locator(".preflight-form")).toHaveCount(0);
  await expect(sourceField).toBeVisible();
});

test("a submitted custom range presents one exact and directly manipulable trim control", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  await page.getByRole("textbox", { name: "YouTube link for recorded preview" }).fill("https://youtu.be/customrangefixture");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Continue to Range" }).click();
  await page.getByRole("button", { name: "Update range: 0:00–1:23" }).click();

  const rangePopover = page.getByRole("dialog", { name: "Range options" });
  await page.getByRole("radio", { name: "Custom range" }).check();
  const trimControl = rangePopover.getByRole("group", { name: "Custom range trim" });
  const sourceRange = trimControl.getByRole("group", { name: "Source range" });
  const startTimestamp = page.getByRole("textbox", { name: "Start timestamp" });
  const endTimestamp = page.getByRole("textbox", { name: "End timestamp" });
  const selectedDuration = trimControl.getByLabel("Selected duration");
  const startHandle = sourceRange.getByRole("slider", { name: "Start trim handle" });
  const endHandle = sourceRange.getByRole("slider", { name: "End trim handle" });
  await expect(startTimestamp).toHaveValue("0:00");
  await expect(endTimestamp).toHaveValue("1:23");
  await expect(selectedDuration).toHaveText("1:23 selected");
  await expect(startHandle).toHaveAttribute("aria-valuetext", "0:00 start");
  await expect(endHandle).toHaveAttribute("aria-valuetext", "1:23 end");
  await expect(rangePopover).toHaveAttribute("data-scrollable", "false");
  const customControlSurface = await trimControl.evaluate((element) => ({
    borderWidth: getComputedStyle(element).borderTopWidth,
    backgroundImage: getComputedStyle(element).backgroundImage,
  }));
  expect(customControlSurface).toEqual({ borderWidth: "0px", backgroundImage: "none" });
  const endpointSurface = await startTimestamp.evaluate((element) => ({
    borderWidth: getComputedStyle(element).borderTopWidth,
    borderRadius: Number.parseFloat(getComputedStyle(element).borderRadius),
    backgroundColor: getComputedStyle(element).backgroundColor,
  }));
  expect(endpointSurface.borderWidth).toBe("1px");
  expect(endpointSurface.borderRadius).toBeGreaterThanOrEqual(7);
  expect(endpointSurface.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  for (const handle of [startHandle, endHandle]) {
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  }

  await startTimestamp.focus();
  await expect(trimControl).toHaveAttribute("data-active-boundary", "start");
  await expect(startHandle).toHaveAttribute("data-active", "true");
  expect(await startTimestamp.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth)))
    .toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Tab");
  await expect(endTimestamp).toBeFocused({ timeout: 10_000 });
  await expect(trimControl).toHaveAttribute("data-active-boundary", "end");
  await page.keyboard.press("Tab");
  await expect(startHandle).toBeFocused({ timeout: 10_000 });
  await page.keyboard.press("Tab");
  await expect(endHandle).toBeFocused({ timeout: 10_000 });

  await startHandle.press("ArrowRight");
  await expect(startTimestamp).toHaveValue("0:01");
  await endHandle.press("ArrowLeft");
  await expect(endTimestamp).toHaveValue("1:22");
  const [trackBox, endHandleBox] = await Promise.all([
    trimControl.locator(".preflight-range-trim-track").boundingBox(),
    endHandle.boundingBox(),
  ]);
  expect(trackBox).not.toBeNull();
  expect(endHandleBox).not.toBeNull();
  await page.mouse.move(
    (endHandleBox?.x ?? 0) + (endHandleBox?.width ?? 0) / 2,
    (endHandleBox?.y ?? 0) + (endHandleBox?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    (trackBox?.x ?? 0) + (trackBox?.width ?? 0) * 0.75,
    (trackBox?.y ?? 0) + (trackBox?.height ?? 0) / 2,
  );
  await page.mouse.up();
  await expect(endTimestamp).toHaveValue("1:02");
  await expect(selectedDuration).toHaveText("1:01 selected");

  await endTimestamp.fill("1:30");
  await expect(rangePopover.getByText("Choose a valid range within 0:00–1:23.")).toBeVisible();
  await expect(endTimestamp).toHaveAttribute("aria-invalid", "true");
  await expect(sourceRange.getByRole("slider", { name: "End trim handle" })).toHaveCount(0);
  await expect(trimControl.locator(".preflight-range-trim-selection")).toHaveCount(0);
  await expect(page.locator(".preflight-stage-panel .preflight-block")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to Language" })).toBeDisabled();

  await startTimestamp.fill("70");
  await startTimestamp.press("Enter");
  await endTimestamp.fill("60");
  await endTimestamp.press("Enter");
  await expect(startTimestamp).toHaveValue("1:10");
  await expect(endTimestamp).toHaveValue("1:00");
  await expect(startTimestamp).toHaveAttribute("aria-invalid", "true");
  await expect(endTimestamp).toHaveAttribute("aria-invalid", "true");
  await expect(selectedDuration).toHaveText("Range incomplete");
  await expect(trimControl.locator(".preflight-range-trim-selection")).toHaveCount(0);

  await endTimestamp.fill("80");
  await endTimestamp.press("Enter");
  await expect(endTimestamp).toHaveValue("1:20");
  await expect(selectedDuration).toHaveText("0:10 selected");
  await expect(page.getByRole("button", { name: "Continue to Language" })).toBeEnabled();
  await expect.poll(() => rangePopover.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
});

test("a long submitted source opens with an explicit editable two-minute request default", async ({ page }) => {
  await page.unroute("**/api/studio/source-resolutions");
  await page.route("**/api/studio/source-resolutions", async (route) => {
    const request = route.request().postDataJSON() as { url: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sourceResolutionReceipt(request.url, 758_000)),
    });
  });

  await page.goto("/studio/");
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  await page.getByRole("textbox", { name: "YouTube link for recorded preview" }).fill("https://youtu.be/longfixture");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("note", { name: "Submitted source metadata boundary" })).toContainText(
    "It’s 12:38 long",
  );
  await page.getByRole("button", { name: "Continue to Range" }).click();
  await page.getByRole("button", { name: "Update range: 0:00–2:00" }).click();
  await expect(page.getByRole("radio", { name: "Custom range" })).toBeChecked();
  const longRangePopover = page.getByRole("dialog", { name: "Range options" });
  const longRangeTrim = longRangePopover.getByRole("group", { name: "Custom range trim" });
  const longSourceRange = longRangeTrim.getByRole("group", { name: "Source range" });
  const longStartTimestamp = page.getByRole("textbox", { name: "Start timestamp" });
  const longEndTimestamp = page.getByRole("textbox", { name: "End timestamp" });
  const selectedDuration = longRangeTrim.getByLabel("Selected duration");
  await expect(longStartTimestamp).toHaveValue("0:00");
  await expect(longEndTimestamp).toHaveValue("2:00");
  await expect(selectedDuration).toHaveText("2:00 selected");
  const longStartHandle = longSourceRange.getByRole("slider", { name: "Start trim handle" });
  await longStartHandle.press("ArrowRight");
  await expect(longStartTimestamp).toHaveValue("0:01");
  const longEndHandle = longSourceRange.getByRole("slider", { name: "End trim handle" });
  await longEndHandle.press("ArrowRight");
  await expect(longEndTimestamp).toHaveValue("2:01");
  await longStartTimestamp.fill("0:00:50");
  await longStartTimestamp.press("Enter");
  await longEndTimestamp.fill("170");
  await longEndTimestamp.press("Enter");
  await expect(longStartTimestamp).toHaveValue("0:50");
  await expect(longEndTimestamp).toHaveValue("2:50");
  await expect(selectedDuration).toHaveText("2:00 selected");
  const [sourceTrackBox, selectedRangeBox] = await Promise.all([
    longRangeTrim.locator(".preflight-range-trim-track").boundingBox(),
    longRangeTrim.locator(".preflight-range-trim-selection").boundingBox(),
  ]);
  expect(sourceTrackBox).not.toBeNull();
  expect(selectedRangeBox).not.toBeNull();
  const selectedWidthRatio = (selectedRangeBox?.width ?? 0) / (sourceTrackBox?.width ?? 1);
  expect(selectedWidthRatio).toBeGreaterThan(0.14);
  expect(selectedWidthRatio).toBeLessThan(0.18);

  await longEndTimestamp.fill("171");
  await longEndTimestamp.press("Enter");
  await expect(selectedDuration).toHaveText("2:01 selected");
  await expect(selectedDuration).toHaveAttribute("data-invalid", "true");
  await expect(longRangePopover.getByText(
    "The current hosted request contract is limited to 120 seconds. Choose a custom range within the resolved video.",
  )).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to Language" })).toBeDisabled();
  await longEndTimestamp.fill("170");
  await longEndTimestamp.press("Enter");
  await expect.poll(() => longRangePopover.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
  // A source longer than the limit makes the Entire option visibly unavailable rather than selectable.
  await expect(page.getByLabel("Entire video, 12:38, exceeds 2:00 limit")).toBeDisabled();
  await expect(longRangePopover.getByText("2 min max", { exact: true })).toBeVisible();
  await expect(longRangePopover.getByText("Choose up to 2:00.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to Language" })).toBeEnabled();
});

test("a compact submitted range popover does not show a phantom scrollbar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one compact viewport covers popover measurement");
  await page.setViewportSize({ width: 440, height: 340 });
  await page.unroute("**/api/studio/source-resolutions");
  await page.route("**/api/studio/source-resolutions", async (route) => {
    const request = route.request().postDataJSON() as { url: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sourceResolutionReceipt(request.url, 758_000)),
    });
  });

  await page.goto("/studio/");
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  await page.getByRole("textbox", { name: "YouTube link for recorded preview" }).fill("https://youtu.be/compactrangefixture");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Continue to Range" }).click();
  await page.getByRole("button", { name: "Update range: 0:00–2:00" }).click();

  const rangePopover = page.getByRole("dialog", { name: "Range options" });
  await expect(rangePopover).toBeVisible();
  await expect(rangePopover).toHaveAttribute("data-scrollable", "false");
  const compactTrim = rangePopover.getByRole("group", { name: "Custom range trim" });
  const compactStart = compactTrim.getByRole("textbox", { name: "Start timestamp" });
  const compactEnd = compactTrim.getByRole("textbox", { name: "End timestamp" });
  const compactSourceRange = compactTrim.getByRole("group", { name: "Source range" });
  const [popoverBox, trimBox, startBox, endBox, stripBox, startHandleBox, endHandleBox, lifecycleBox] = await Promise.all([
    rangePopover.boundingBox(),
    compactTrim.boundingBox(),
    compactStart.boundingBox(),
    compactEnd.boundingBox(),
    compactSourceRange.boundingBox(),
    compactSourceRange.getByRole("slider", { name: "Start trim handle" }).boundingBox(),
    compactSourceRange.getByRole("slider", { name: "End trim handle" }).boundingBox(),
    page.getByLabel("Studio lifecycle").boundingBox(),
  ]);
  for (const box of [popoverBox, trimBox, startBox, endBox, stripBox, startHandleBox, endHandleBox, lifecycleBox]) {
    expect(box).not.toBeNull();
  }
  expect(startBox?.x ?? Infinity).toBeGreaterThanOrEqual((popoverBox?.x ?? 0) - 0.5);
  expect((endBox?.x ?? 0) + (endBox?.width ?? 0)).toBeLessThanOrEqual(
    (popoverBox?.x ?? 0) + (popoverBox?.width ?? 0) + 0.5,
  );
  expect((startBox?.x ?? 0) + (startBox?.width ?? 0)).toBeLessThan(endBox?.x ?? 0);
  expect(stripBox?.width ?? 0).toBeGreaterThan(startBox?.width ?? Infinity);
  expect(startHandleBox?.width ?? 0).toBeGreaterThanOrEqual(24);
  expect(endHandleBox?.width ?? 0).toBeGreaterThanOrEqual(24);
  expect((popoverBox?.y ?? 0) + (popoverBox?.height ?? 0)).toBeLessThanOrEqual(
    (lifecycleBox?.y ?? 0) - 8,
  );
  await compactEnd.focus();
  expect(await compactEnd.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth)))
    .toBeGreaterThanOrEqual(2);
  await expect(compactTrim).toHaveAttribute("data-active-boundary", "end");
  expect(await rangePopover.evaluate((element) => getComputedStyle(element).overflowY))
    .toMatch(/^(clip|hidden)$/);
  await expect.poll(() => rangePopover.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeLessThanOrEqual(2);
});

test("submitted preview Results reports no submitted artifact before recorded demo output", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one completed replay covers the shared Results boundary");

  await page.goto("/studio/");
  await startSubmittedPreview(page);

  const boundary = page.locator(".submitted-results-boundary");
  await expect(boundary.getByRole("heading", { name: "Submitted source was not processed" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(boundary).toContainText("Resolved browser-test video");
  await expect(boundary).toContainText("The viewer below shows only the recorded demo run-006");
  const submittedDetails = boundary.getByText("Submitted request details");
  await expect(submittedDetails).toBeVisible();
  await expect(boundary.getByText("Unavailable", { exact: true })).not.toBeVisible();
  await submittedDetails.click();
  await expect(boundary).toContainText("Unavailable");
  await expect(boundary).toContainText("no runtime receipt");
  await expect(boundary).toHaveAttribute("data-submitted-preparation-request-id", /^submitted-preparation:/);
  await expect(page.locator('.dock[data-outcome="complete"]')).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Learning viewer" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Pause|Resume/ })).toHaveCount(0);
});

test("completed recorded runs transition directly into the learning viewer", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("unscored-complete");
  await page.locator(".studio-lab").evaluate((element) => {
    (element as HTMLElement).style.display = "none";
  });

  const results = page.locator("#studio-recorded-results");
  await expect(results).toBeVisible();
  await expect(results).toHaveAccessibleName(/Result/);
  await expect(page.getByRole("button", { name: "Open Results" })).toHaveCount(0);
  await expect(page.locator(".stage")).toHaveCount(0);
  await expect(page.locator(".dock-well")).toHaveCount(0);
  await expect(results.getByRole("button", { name: "Run again", exact: true })).toHaveCount(0);
  const viewer = results.getByRole("region", { name: "Learning viewer" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Study" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByRole("button", { name: "Theater" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Full screen" })).toBeVisible();
  await expect(viewer.getByRole("slider", { name: "Volume" })).toBeVisible();
  await expect(viewer.getByRole("combobox", { name: "Playback speed" })).toBeVisible();
  await expect(results.getByText("Run details", { exact: true })).toBeVisible();
  await expect(results.getByText("11 captioned", { exact: true })).toBeVisible();
  await expect(results.locator(".result-details-list")).not.toBeVisible();
});

test("a remote metadata failure keeps duration and range controls unavailable", async ({ page }) => {
  await page.unroute("**/api/studio/source-resolutions");
  let attempts = 0;
  await page.route("**/api/studio/source-resolutions", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "source_inaccessible", message: "YouTube video metadata is unavailable." } }),
      });
      return;
    }
    const request = route.request().postDataJSON() as { url: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sourceResolutionReceipt(request.url)),
    });
  });
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  await page.getByRole("textbox", { name: "YouTube link for recorded preview" }).fill("https://youtu.be/privatevideo");
  await page.getByRole("button", { name: "Resolve metadata for recorded preview" }).click();

  await expect(page.getByRole("heading", { name: "Source metadata unavailable" })).toBeVisible();
  await expect(page.getByText("YouTube video metadata is unavailable.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Analysis range" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry same source" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open recorded demo" })).toBeVisible();
  await expect(page.getByLabel("Studio lifecycle")).toHaveAttribute("data-lifecycle-mode", "failed");
  await expect(page.getByLabel("Studio lifecycle").locator(".dock-pct")).toHaveText("");
  await expect(page.getByLabel("Studio lifecycle").locator(".dock-pct")).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByRole("button", { name: /Pause|Resume/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry same source" }).click();
  await expect(page.getByRole("heading", { name: "Resolved browser-test video" })).toBeVisible();
  expect(attempts).toBe(2);
  await expect(page.getByText("Recorded fixture facts · not the submitted link")).toHaveCount(0);
});

test("the submitted preparation sequence stays horizontally contained at every supported viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one pass covers the responsive preparation contract");

  for (const viewport of [
    { width: 2048, height: 1152 },
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/studio/");
    await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
    await page.getByRole("textbox", { name: "YouTube link for recorded preview" }).fill("https://youtu.be/dQw4w9WgXcQ");
    await page.getByRole("button", { name: "Resolve metadata for recorded preview" }).click();

    const panel = page.locator(".preflight-stage-panel");
    await expect(page.getByRole("heading", { name: "Resolved browser-test video" })).toBeVisible();
    await expect(page.locator('.studio-welcome[data-source-guide="true"]')).toBeVisible();
    await expect(page.getByText("Source guide", { exact: true })).toBeVisible();
    await expect(panel).toHaveCSS("position", "relative");
    await expect(panel).toHaveCSS("overflow-y", "visible");
    const lifecycleBar = page.getByLabel("Studio lifecycle");
    await expect(page.getByRole("textbox", { name: "YouTube link for recorded preview" })).toHaveCount(0);
    await expect(lifecycleBar).toHaveAttribute("data-lifecycle-mode", "preparation");
    await expect(lifecycleBar).toHaveAttribute("data-preparation-stage", "source");
    await page.waitForTimeout(360);
    const sourceDock = page.locator(".studio-source-dock");
    const sourceDockBox = await sourceDock.boundingBox();
    expect(sourceDockBox).not.toBeNull();
    expect(
      Math.abs((sourceDockBox?.x ?? 0) + (sourceDockBox?.width ?? 0) / 2 - viewport.width / 2),
    ).toBeLessThanOrEqual(0.5);
    const expectedDockBottom = Math.min(34, Math.max(20, viewport.height * 0.04));
    expect(
      Math.abs(viewport.height - ((sourceDockBox?.y ?? 0) + (sourceDockBox?.height ?? 0)) - expectedDockBottom),
    ).toBeLessThanOrEqual(0.6);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    const panelBox = await panel.boundingBox();
    const preparationControls = page.getByRole("group", { name: "Preparation controls" });
    const preparationControlsBox = await preparationControls.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(preparationControlsBox).not.toBeNull();
    expect(panelBox?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(Math.abs(
      (preparationControlsBox?.y ?? 0) - ((panelBox?.y ?? 0) + (panelBox?.height ?? 0) - 1),
    )).toBeLessThanOrEqual(2.5);
    expect((preparationControlsBox?.y ?? 0) + (preparationControlsBox?.height ?? 0))
      .toBeLessThanOrEqual((sourceDockBox?.y ?? 0) - 8);

    await page.getByRole("button", { name: "Continue to Range" }).click();
    const rangeHeading = page.getByRole("heading", { name: /^I’ll prepare / });
    await expect(rangeHeading).toBeFocused();
    const rangeParameter = preparationControls.getByRole("button", { name: "Update range: 0:00–1:23" });
    const [rangePanelBefore, rangeControlsBefore, rangeDockBefore, rangeHeadingBox] = await Promise.all([
      panel.boundingBox(),
      preparationControls.boundingBox(),
      sourceDock.boundingBox(),
      rangeHeading.boundingBox(),
    ]);
    expect((rangePanelBefore?.height ?? Infinity) - (rangeHeadingBox?.height ?? 0)).toBeLessThanOrEqual(60);
    await rangeParameter.click();
    const rangePopover = page.getByRole("dialog", { name: "Range options" });
    await expect(rangePopover).toBeVisible();
    await expect(page.getByLabel("Entire video, 1:23")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    const [editedPanelBox, editedControlsBox, editedDockBox, rangePopoverBox] = await Promise.all([
      panel.boundingBox(),
      preparationControls.boundingBox(),
      sourceDock.boundingBox(),
      rangePopover.boundingBox(),
    ]);
    for (const [before, after] of [
      [rangePanelBefore, editedPanelBox],
      [rangeControlsBefore, editedControlsBox],
      [rangeDockBefore, editedDockBox],
    ] as const) {
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(Math.abs((after?.[key] ?? Infinity) - (before?.[key] ?? -Infinity))).toBeLessThanOrEqual(1);
      }
    }
    expect(rangePopoverBox?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect(rangePopoverBox?.y ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect((rangePopoverBox?.x ?? 0) + (rangePopoverBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
    // The editor may open below, flip above, or become a contained sheet — it stays within the viewport either way.
    expect((rangePopoverBox?.y ?? 0) + (rangePopoverBox?.height ?? 0)).toBeLessThanOrEqual(
      viewport.height + 0.5,
    );
    await page.keyboard.press("Escape");
    await expect(rangePopover).not.toBeVisible();
    await expect(rangeParameter).toBeFocused();
    await page.getByRole("button", { name: "Continue to Language" }).click();
    await page.getByRole("button", { name: "Continue to Output" }).click();
    await page.getByRole("button", { name: "Continue to Forecast" }).click();
    await expect(lifecycleBar).toHaveAttribute("data-preparation-stage", "forecast");
    await expect(page.getByRole("heading", { name: /^I’ve bound / })).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    const forecastPanelBox = await panel.boundingBox();
    const forecastDockBox = await sourceDock.boundingBox();
    const forecastControlsBox = await preparationControls.boundingBox();
    expect(Math.abs(
      (forecastControlsBox?.y ?? 0) -
      ((forecastPanelBox?.y ?? 0) + (forecastPanelBox?.height ?? 0) - 1),
    )).toBeLessThanOrEqual(2.5);
    expect((forecastControlsBox?.y ?? 0) + (forecastControlsBox?.height ?? 0))
      .toBeLessThanOrEqual((forecastDockBox?.y ?? 0) - 8);

    await page.getByRole("button", { name: "Continue to Review" }).click();
    await expect(lifecycleBar).toHaveAttribute("data-preparation-stage", "confirm");
    await expect(page.getByRole("heading", { name: /^I’m ready to open the recorded run-006 interface preview/ }))
      .toBeFocused();
    await expect(page.getByRole("button", { name: "Preview run-006 recorded processing" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
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
  await startSubmittedPreview(page);

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
  await startSubmittedPreview(page);
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
test("agent focus keeps its spatial stylesheet after client navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the failure was specific to the routed desktop surface");

  await page.goto("/");
  await page.getByRole("link", { name: "Open Studio" }).click();
  await expect(page.getByRole("button", { name: "Preview YouTube with recorded demo" })).toBeVisible();
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  await page.getByRole("textbox", { name: "YouTube link for recorded preview" }).fill(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  await page.keyboard.press("Enter");
  await finishPreparation(page);
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
  // Workbench screen is square-cornered; radius was a legacy env-media-frame claim.
  expect(parseFloat(focusStyles?.mediaFrameRadius ?? "0")).toBe(0);
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
test("the submitted preview fits every supported viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one pass covers the responsive viewport contract");

  const longVideoId = "source-identity-".repeat(12);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/studio/?lab=1");
    await page.getByRole("button", { name: "Collapse trace lab" }).click();
    await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
    await page.getByRole("textbox", { name: "YouTube link for recorded preview" }).fill(`https://youtu.be/${longVideoId}`);
    await page.keyboard.press("Enter");
    await finishPreparation(page, true, true);
    await expect(page.locator('.studio[data-stage="run"]')).toBeVisible();

    const capsule = page.locator(".top-mid");
    const sourceLabel = capsule.locator(".source-display-url");
    await expect(sourceLabel).toHaveAttribute("data-overflow", "true");
    expect(
      await sourceLabel.evaluate((element) => getComputedStyle(element).maskImage),
    ).not.toBe("none");

    for (const locator of [capsule, page.locator(".dock")]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 0.5);
    }

    const [capsuleBox, markBox, labBox] = await Promise.all([
      capsule.boundingBox(),
      page.locator(".top-mark").boundingBox(),
      page.getByRole("complementary", { name: "Studio trace lab" }).boundingBox(),
    ]);
    expect(capsuleBox).not.toBeNull();
    expect(markBox).not.toBeNull();
    expect(labBox).not.toBeNull();
    const overlaps = (
      first: NonNullable<typeof capsuleBox>,
      second: NonNullable<typeof capsuleBox>,
    ) =>
      first.x < second.x + second.width
      && first.x + first.width > second.x
      && first.y < second.y + second.height
      && first.y + first.height > second.y;
    expect(overlaps(capsuleBox!, markBox!)).toBe(false);
    expect(overlaps(capsuleBox!, labBox!)).toBe(false);
  }
});

test("the source capsule sizes to content before applying its maximum", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  await page.getByRole("textbox", { name: "YouTube link for recorded preview" }).fill("https://youtu.be/dQw4w9WgXcQ");
  await page.keyboard.press("Enter");
  await finishPreparation(page);

  const capsule = page.locator(".top-mid");
  const label = capsule.locator(".source-display-url");
  await expect(label).toHaveAttribute("data-overflow", "false");
  const shortWidth = await capsule.evaluate((element) => element.getBoundingClientRect().width);
  expect(shortWidth).toBeLessThan(360);

  await page.goto("/studio/");
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  await page
    .getByRole("textbox", { name: "YouTube link for recorded preview" })
    .fill(`https://youtu.be/${"deliberately-long-source-id-".repeat(12)}`);
  await page.keyboard.press("Enter");
  await finishPreparation(page);

  await expect(label).toHaveAttribute("data-overflow", "true");
  const longWidth = await capsule.evaluate((element) => element.getBoundingClientRect().width);
  expect(longWidth).toBeGreaterThan(shortWidth + 30);
  expect(longWidth).toBeLessThanOrEqual(480.5);
});

test("the recorded run uses its receipted source identity", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Explore run-006 recorded demo" }).click();
  await finishPreparation(page, false);

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
  await startSubmittedPreview(page);
  const thinkingMesh = page.locator('.hub [data-field-motion="thinking"] .agent-mark-mesh');
  await expect(thinkingMesh).toBeVisible();
  await expect(thinkingMesh).toHaveAttribute("data-mesh-motion", "still");

  await openLab(page);
  await scenario(page).selectOption("withheld");

  const orchestrator = page.getByRole("button", { name: /^orchestrator,/ });
  await orchestrator.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Orchestrator" })).toBeVisible();

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
  await page.getByRole("button", { name: "Preview YouTube with recorded demo" }).click();
  await page.getByRole("button", { name: "Explore run-006 recorded demo" }).click();

  // The recorded source stage now narrates its boundary conversationally instead of
  // rendering the receipted evidence tables. The measured language ranges stay
  // preflight-only: the detected-language range is offered but never replayable.
  await expect(page.getByRole("heading", { name: /^I found / })).toBeVisible();

  await page.getByRole("button", { name: "Continue to Range" }).click();
  await page.getByRole("button", { name: /^Update range/ }).click();
  await expect(
    page.getByLabel(/Measured language ranges · preflight evidence only; no replayable detected-language subrange/),
  ).toBeDisabled();
});
