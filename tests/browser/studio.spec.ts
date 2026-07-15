import { expect, test, type Locator, type Page } from "@playwright/test";

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
  await expect(focus.locator(".agent-focus-environment-frame")).toHaveCSS("opacity", "1");
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
  await expect(page.getByRole("button", { name: "Use owned local source" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Studio trace lab" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Local runtime host" })).toHaveCount(0);

  await openLab(page);
  await expect(page.getByRole("region", { name: "Local runtime host" })).toBeVisible();
  await expect(page.getByText("development-only · separate from replay")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect to local host" })).toBeDisabled();
});

test("the default Studio exposes a separate owned-source operator path", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Use owned local source" }).click();

  const productRuntime = page.getByRole("region", { name: "Owned local source" });
  await expect(productRuntime).toBeVisible();
  await expect(productRuntime.getByText("Local production path · separate from replay")).toBeVisible();
  await expect(productRuntime.getByText(/does not produce captions, study output, or a multi-agent swarm/)).toBeVisible();
  await expect(productRuntime.getByText(/Submitted YouTube URLs remain unprocessed recorded previews/)).toBeVisible();
  await productRuntime.getByText("Local host setup and CLI escape hatch").click();
  await expect(productRuntime.getByText(/run-runtime-host\.ts --executor deterministic/)).toBeVisible();
  await expect(productRuntime.getByText(/--source-directory/)).toBeVisible();
  await expect(productRuntime.getByRole("button", { name: "Connect to local host" })).toBeDisabled();

  await productRuntime.getByRole("button", { name: "Back to source choices" }).click();
  await expect(page.getByRole("button", { name: "Input Source" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Demo" })).toBeVisible();
});

test("owned browser media requires rights, registers, and continues through the existing plan/start flow", async ({ page }, testInfo) => {
  const token = process.env.STUDIO_RUNTIME_HOST_TOKEN;
  test.skip(testInfo.project.name !== "desktop", "one ingest is sufficient across browser projects");
  test.skip(!token, "requires an operator-started deterministic runtime host");

  await page.goto(productStudioUrl());
  await page.getByRole("button", { name: "Use owned local source" }).click();
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

  await productRuntime.getByLabel("Declared source language").fill("ko");
  await productRuntime.getByRole("button", { name: "Review local plan" }).click();
  const plan = productRuntime.getByRole("region", { name: "Local runtime plan" });
  await expect(plan).toBeVisible();
  await plan.getByRole("button", { name: "Accept forecast and start local runtime" }).click();
  const status = productRuntime.getByRole("region", { name: "Local runtime status" });
  await expect(status.getByText(/Terminal/)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.studio[data-stage="input"]')).toBeVisible();
  await expect(page.locator(".hub")).toHaveCount(0);
});

test("the product path reviews and freezes an exact local forecast without entering replay", async ({ page }) => {
  const token = process.env.STUDIO_RUNTIME_HOST_TOKEN;
  test.skip(!token, "requires an operator-started deterministic runtime host");

  await page.goto(productStudioUrl());
  await page.getByRole("button", { name: "Use owned local source" }).click();
  const productRuntime = page.getByRole("region", { name: "Owned local source" });
  await productRuntime.getByLabel("Paste-once bearer token").fill(token ?? "");
  await productRuntime.getByRole("button", { name: "Connect to local host" }).click();
  await expect(productRuntime.getByLabel("Registered owned source")).toBeVisible();
  await expect(productRuntime.getByText("Owned/local", { exact: false })).toBeVisible();

  await productRuntime.getByLabel("Declared source language").fill("ko");
  await productRuntime.getByLabel("Language-pack identity (optional)").fill("ko-v3");
  await productRuntime.getByRole("button", { name: "Review local plan" }).click();

  const plan = productRuntime.getByRole("region", { name: "Local runtime plan" });
  await expect(plan.getByText("studio.forecast.v1 · not started or frozen")).toBeVisible();
  await expect(plan.getByText("Workload floor")).toBeVisible();
  await expect(plan.getByText("Unavailable", { exact: true })).toHaveCount(2);
  await expect(plan.getByText(/Unavailable · amount and currency are null/)).toBeVisible();

  await plan.getByRole("button", { name: "Accept forecast and start local runtime" }).click();
  const status = productRuntime.getByRole("region", { name: "Local runtime status" });
  await expect(status.getByText(/Terminal/)).toBeVisible({ timeout: 10_000 });
  await expect(status.getByText(/Closed at validated journal head/)).toBeVisible();
  const production = status.getByRole("region", { name: "Production task and handoff facts" });
  await expect(production).toBeVisible();
  await expect(production.getByText(/recorded production evidence, not a presence signal/)).toBeVisible();
  await expect(production.locator("[data-production-task-id]")).toHaveCount(2);
  await expect(production.locator("[data-production-worker-id]")).toHaveCount(2);
  await expect(production.locator("[data-production-grant-id]")).toHaveCount(2);
  await expect(production.locator("[data-production-report-id]")).toHaveCount(1);
  await expect(production.locator("[data-production-spawn-request-id]")).toHaveCount(1);
  await expect(production.locator('[data-production-spawn-request-id][data-decision="accepted"]')).toBeVisible();
  await expect(production.locator("[data-production-output-artifact-id]")).toHaveCount(1);
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
  const localRuntime = page.getByRole("region", { name: "Local runtime host" });
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
  await expect(page.getByRole("button", { name: "Run Demo" })).toBeVisible();

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

  const addSource = page.getByRole("button", { name: "Input Source" });
  await addSource.click();
  await expect(page.getByRole("textbox", { name: "Clip link" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(addSource).toBeFocused();
});

test("a failed source check reports directly above the source dock", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Input Source" }).click();
  const source = page.getByRole("textbox", { name: "Clip link" });
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

test("an identified source contracts into a compact review control", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Input Source" }).click();
  const source = page.getByRole("textbox", { name: "Clip link" });
  const editor = page.locator(".source-entry .dock-bar");
  const editorBox = await editor.boundingBox();

  await source.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await source.press("Tab");

  const review = page.locator(".source-entry .dock-bar-source");
  await expect(review).toBeVisible();
  const editSource = page.getByRole("button", { name: /Edit source/ });
  await expect(editSource).toBeVisible();
  await expect(editSource.locator(".source-display-url")).toBeVisible();

  expect(editorBox).not.toBeNull();
  await expect
    .poll(async () => {
      const reviewBox = await review.boundingBox();
      return (editorBox?.width ?? 0) - (reviewBox?.width ?? Infinity);
    })
    .toBeGreaterThan(20);

  await editSource.locator(".source-display-url").click();
  await expect(source).toBeFocused();
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
    const addSource = page.getByRole("button", { name: "Input Source" });
    const demo = page.getByRole("button", { name: "Run Demo" });
    const [orchestratorBox, panelBox, addSourceBox, demoBox] = await Promise.all([
      orchestrator.boundingBox(),
      panel.boundingBox(),
      addSource.boundingBox(),
      demo.boundingBox(),
    ]);

    expect(orchestratorBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(addSourceBox).not.toBeNull();
    expect(demoBox).not.toBeNull();
    expect(orchestratorBox?.x ?? 0).toBeLessThan(panelBox?.x ?? 0);
    expect(
      Math.abs((addSourceBox?.x ?? 0) + (addSourceBox?.width ?? 0) / 2 - viewport.width / 2),
    ).toBeLessThanOrEqual(0.5);
    expect(demoBox?.width ?? 0).toBeGreaterThan(72);
    expect(demoBox?.width ?? 0).toBeLessThan(112);
    expect(demoBox?.height).toBe(40);

    for (const locator of [orchestrator, panel, addSource, demo]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 0.5);
    }
  }
});

test("a submitted source launches the recorded interface preview", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Input Source" }).click();
  await page.getByRole("textbox", { name: "Clip link" }).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.keyboard.press("Enter");

  await expect(page.locator('.studio[data-stage="run"]')).toBeVisible();
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
  await page.getByRole("button", { name: "Input Source" }).click();
  await page
    .getByRole("textbox", { name: "Clip link" })
    .fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.keyboard.press("Enter");

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

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(" ");
  await expect(dock).toHaveAttribute("data-paused", "true");
});

test("cancelling a run resolves in the dock without replacing the canvas", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Input Source" }).click();
  await page
    .getByRole("textbox", { name: "Clip link" })
    .fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.keyboard.press("Enter");
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

test("agent focus keeps visual evidence present across human-readable sections", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("withheld");
  await page.getByRole("button", { name: "Collapse trace lab" }).click();

  const translator = page.getByRole("button", { name: /^Translator 01,/ });
  const sourceIdentity = await translator.locator(".agent-mark").getAttribute("data-agent-identity");
  await translator.focus();
  await page.keyboard.press("Enter");

  const focus = page.getByRole("dialog");
  await expect(focus).toBeVisible();
  await expect(focus).toHaveAccessibleName("Translator 01");
  await expect(page.locator(".stage")).toHaveAttribute("data-agent-focus", "true");
  await expect(translator).toHaveAttribute("aria-expanded", "true");
  await expect(focus.locator(".agent-focus-identity .agent-mark")).toHaveAttribute(
    "data-agent-identity",
    sourceIdentity ?? "",
  );
  await expect(focus.getByText("Recorded focus", { exact: true })).toBeVisible();
  await expect(focus.getByRole("heading", { name: "Translation draft" })).toBeVisible();
  await expect(focus.locator('.env[data-role="translate"]')).toBeVisible();
  const nameplate = focus.locator(".agent-focus-hero-copy");
  await expect(nameplate.locator(".agent-focus-state")).toContainText("Translating");
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
  ]);
  expect(
    await nameplate.locator(".agent-focus-material-rule").evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    ),
  ).toContain("linear-gradient");
  const environment = focus.locator(".agent-focus-environment");
  const visualEvidence = environment.locator(".agent-focus-visual-evidence");
  const activity = environment.locator(".agent-focus-detail > .agent-focus-activity");
  const sideRail = focus.locator(".agent-focus-side-rail");
  const sectionTabs = focus.getByRole("tablist", { name: "Focused agent sections" });
  const workbenchTab = sectionTabs.getByRole("tab", { name: "Workbench" });
  const assignmentTab = sectionTabs.getByRole("tab", { name: "Assignment" });
  const historyTab = sectionTabs.getByRole("tab", { name: "History" });
  const resultsTab = sectionTabs.getByRole("tab", { name: "Results" });
  const workbenchLabel = workbenchTab.locator(".agent-focus-section-label");
  const historyLabel = historyTab.locator(".agent-focus-section-label");
  await expect(sectionTabs.getByRole("tab")).toHaveCount(4);
  await expect(workbenchLabel).toHaveCSS("opacity", "1");
  await expect(visualEvidence).toBeVisible();
  await expect(visualEvidence.getByLabel("Recorded source video")).toBeVisible();
  await expect(visualEvidence.getByRole("img", { name: /Translator 01 media evidence/ })).toBeVisible();
  await expect(visualEvidence.getByText(/Playback is your inspection cursor/)).toBeVisible();
  await expect(visualEvidence.getByText(/Assigned 0:00–0:18/)).toBeVisible();
  await expect(sideRail).toHaveCSS("z-index", "2");
  const sectionControlMaterial = await workbenchTab.evaluate((button) => {
    const icon = button.querySelector(".agent-focus-section-icon");
    return {
      frameRadius: getComputedStyle(button).borderRadius,
      frameBackground: getComputedStyle(button).backgroundColor,
      frameShadow: getComputedStyle(button).boxShadow,
      frameHeight: getComputedStyle(button).height,
      frameOutline: getComputedStyle(button, "::before").borderTopStyle,
      iconRadius: icon ? getComputedStyle(icon).borderRadius : "0px",
      iconBackground: icon ? getComputedStyle(icon).backgroundImage : "none",
    };
  });
  expect(sectionControlMaterial.frameBackground).toBe("rgba(0, 0, 0, 0)");
  expect(sectionControlMaterial.frameShadow).toBe("none");
  expect(sectionControlMaterial.frameOutline).toBe("solid");
  expect(parseFloat(sectionControlMaterial.frameHeight)).toBeLessThanOrEqual(40);
  expect(parseFloat(sectionControlMaterial.iconRadius)).toBeGreaterThan(
    parseFloat(sectionControlMaterial.frameRadius),
  );
  expect(sectionControlMaterial.iconBackground).toContain("linear-gradient");
  const railGap = await sectionTabs.evaluate((rail) => parseFloat(getComputedStyle(rail).gap));
  expect(railGap).toBeLessThanOrEqual(4);
  if ((page.viewportSize()?.width ?? 0) > 900) {
    await historyTab.hover();
    await expect(historyLabel).toHaveCSS("opacity", "1");
    await page.mouse.move(0, 0);
    await historyTab.focus();
    await expect(historyLabel).toHaveCSS("opacity", "1");
  } else {
    await expect(historyLabel).toHaveCSS("display", "none");
    await historyTab.focus();
    expect(await historyLabel.evaluate((label) => getComputedStyle(label).display)).not.toBe("none");
  }
  await workbenchTab.focus();
  const [environmentBox, sideRailBox, workbenchTabBox, workbenchIconBox, workbenchLabelBox,
    historyTabBox] = await Promise.all([
    environment.boundingBox(),
    sideRail.boundingBox(),
    workbenchTab.boundingBox(),
    workbenchTab.locator(".agent-focus-section-icon").boundingBox(),
    workbenchLabel.boundingBox(),
    historyTab.boundingBox(),
  ]);
  expect(environmentBox).not.toBeNull();
  expect(sideRailBox).not.toBeNull();
  expect(workbenchTabBox).not.toBeNull();
  expect(workbenchIconBox).not.toBeNull();
  expect(workbenchLabelBox).not.toBeNull();
  expect(historyTabBox).not.toBeNull();
  expect(workbenchLabelBox?.x ?? 0).toBeGreaterThanOrEqual(
    (workbenchIconBox?.x ?? 0) + (workbenchIconBox?.width ?? 0) + 4,
  );
  if ((page.viewportSize()?.width ?? 0) > 900) {
    expect(sideRailBox?.x ?? 0).toBeGreaterThanOrEqual(
      (environmentBox?.x ?? 0) + (environmentBox?.width ?? 0),
    );
    expect(workbenchLabelBox?.x ?? 0).toBeGreaterThanOrEqual(
      (environmentBox?.x ?? 0) + (environmentBox?.width ?? 0),
    );
  } else {
    expect((sideRailBox?.x ?? 0) + (sideRailBox?.width ?? 0)).toBeLessThanOrEqual(
      (environmentBox?.x ?? 0) + (environmentBox?.width ?? 0),
    );
    expect(
      (environmentBox?.x ?? 0) + (environmentBox?.width ?? 0)
      - ((sideRailBox?.x ?? 0) + (sideRailBox?.width ?? 0)),
    ).toBeLessThanOrEqual(13);
    expect((sideRailBox?.y ?? 0) + (sideRailBox?.height ?? 0)).toBeLessThanOrEqual(
      environmentBox?.y ?? 0,
    );
    expect((workbenchLabelBox?.y ?? 0) + (workbenchLabelBox?.height ?? 0)).toBeLessThanOrEqual(
      environmentBox?.y ?? 0,
    );
  }
  await expect(workbenchTab).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(activity).toHaveCount(0);

  await assignmentTab.click();
  await expect(focus.getByRole("heading", { name: "Assignment" })).toBeVisible();
  await expect(focus.getByText("Production task objective", { exact: true })).toBeVisible();
  await expect(visualEvidence.getByLabel("Recorded source video")).toBeVisible();

  await resultsTab.click();
  await expect(focus.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(focus.getByText("Recorded result projection", { exact: true })).toBeVisible();
  await expect(focus.getByText("Production result fields unavailable", { exact: true })).toBeVisible();
  await expect(visualEvidence.getByLabel("Recorded source video")).toBeVisible();

  await historyTab.click();
  await expect(focus.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(activity).toBeVisible();
  await expect(historyLabel).toHaveCSS("opacity", "1");
  await expect(focus.locator(".agent-focus-log-row")).not.toHaveCount(0);
  expect(await activity.evaluate((element) => getComputedStyle(element).position)).toBe("relative");
  await expect(historyTab).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Home");
  await expect(workbenchTab).toBeFocused();
  await expect(focus.getByRole("heading", { name: "Workbench" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(resultsTab).toBeFocused();
  await expect(focus.getByRole("heading", { name: "Results" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(historyTab).toBeFocused();
  await expect(focus.getByRole("heading", { name: "History" })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(workbenchTab).toBeFocused();
  await expect(
    focus.locator(".agent-focus-hero-copy").getByText("Translator", { exact: true }),
  ).toHaveCount(0);
  await expect(focus.getByText("Latest recorded action", { exact: true })).toHaveCount(0);
  await expect(
    environment.locator(".agent-focus-environment-foot").getByText("translate-01", { exact: true }),
  ).toBeVisible();
  const focusCommands = focus.getByRole("navigation", { name: "Agent focus commands" });
  await expect(focusCommands).toBeVisible();
  await expect(environment.locator(".agent-focus-close")).toHaveCount(0);
  await expect(sideRail.getByRole("button", { name: "Close agent focus" })).toBeVisible();
  await expect(focusCommands.getByRole("button", { name: "Close focus" })).toBeVisible();
  const cycleButtons = focusCommands.locator(".agent-focus-cycle-buttons > button");
  const cycleLabel = focusCommands.locator(".agent-focus-cycle-label");
  await expect(cycleButtons).toHaveCount(2);
  await expect(cycleLabel).toHaveText(/Cycle agents\s*·\s*\d+\/\d+/);
  await expect(focusCommands.getByRole("button", { name: "Previous agent" })).toBeVisible();
  await expect(focusCommands.getByRole("button", { name: "Next agent" })).toBeVisible();
  await expect(focus.getByText(/^Previous(?:\s|$)/)).toHaveCount(0);
  await expect(focus.getByText(/^Next(?:\s|$)/)).toHaveCount(0);
  const [previousBox, nextBox] = await Promise.all([
    cycleButtons.nth(0).boundingBox(),
    cycleButtons.nth(1).boundingBox(),
  ]);
  expect(previousBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(Math.abs((previousBox?.y ?? 0) - (nextBox?.y ?? 0))).toBeLessThanOrEqual(0.5);
  expect((nextBox?.x ?? 0) - ((previousBox?.x ?? 0) + (previousBox?.width ?? 0)))
    .toBeLessThanOrEqual(3.5);
  await expect(focus.getByText("Reasoning", { exact: true })).toHaveCount(0);
  await expectFocusSettled(focus);

  const cyclePosition = cycleLabel.locator(".agent-focus-command-position");
  const cyclePositionBefore = await cyclePosition.textContent();
  await focus.getByRole("button", { name: "Next agent" }).click();
  await expect(cyclePosition).not.toHaveText(cyclePositionBefore ?? "");
  await expect(focus.getByRole("heading", { name: "Translator 01" })).toHaveCount(0);
  await expect(focus).toHaveAccessibleName("Verifier 01");
  await expect(focus.getByRole("heading", { name: "Gate review" })).toBeVisible();
  await expect(focus.locator('.env[data-role="qc"]')).toBeVisible();
  await expect(focus.getByLabel("Recorded source video")).toBeVisible();
  await expect(focus.locator(".agent-focus-role-remit")).toContainText(
    "Checks recorded measurements and publication gates.",
  );
  await expectFocusSettled(focus);
  await focus.getByRole("button", { name: "Next agent" }).click();
  await expect(focus.getByRole("heading", { name: "Translator 02" })).toBeVisible();
  await expectFocusSettled(focus);
  await focus.getByRole("button", { name: "Next agent" }).click();
  await expect(focus).toHaveAccessibleName("Orchestrator");
  await expect(focus.getByRole("heading", { name: "Run coordination" })).toBeVisible();
  await expect(focus.locator(".coordination-env")).toBeVisible();
  await expect(focus.getByLabel("Recorded source video")).toBeVisible();
  await expect(focus.locator(".agent-focus-role-remit")).toContainText(
    "Coordinates the recorded run and its projected workers.",
  );
  await expectFocusSettled(focus);
  await focus.getByRole("button", { name: "Next agent" }).click();
  await expect(focus).toHaveAccessibleName("Segmenter 01");
  await expect(focus.getByRole("heading", { name: "Recorded media" })).toBeVisible();
  await expect(focus.locator('.env[data-role="segment"]')).toBeVisible();
  await expect(focus.getByLabel("Recorded source video")).toBeVisible();
  await expect(focus.locator(".agent-focus-role-remit")).toContainText(
    "Maps the recorded source into inspectable ranges and marks.",
  );
  await expectFocusSettled(focus);
  await focus.getByRole("button", { name: "Next agent" }).click();
  await expect(focus).toHaveAccessibleName("Context 01");
  await expect(focus.getByRole("heading", { name: "Term resolution" })).toBeVisible();
  await expect(focus.getByLabel("Recorded source video")).toBeVisible();
  await expectFocusSettled(focus);
  await focus.getByRole("button", { name: "Close agent focus" }).click();
  await expect(focus).toHaveCount(0);
});

test("agent focus keeps its spatial stylesheet after client navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the failure was specific to the routed desktop surface");

  await page.goto("/");
  await page.getByRole("link", { name: "Open Studio" }).click();
  await expect(page.getByRole("button", { name: "Input Source" })).toBeVisible();
  await page.getByRole("button", { name: "Input Source" }).click();
  await page.getByRole("textbox", { name: "Clip link" }).fill(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  await page.keyboard.press("Enter");

  const orchestrator = page.getByRole("button", { name: /^orchestrator,/ });
  await expect(orchestrator).toBeVisible();
  await orchestrator.click();

  const focus = page.getByRole("dialog", { name: "Orchestrator" });
  await expect(focus).toBeVisible();
  await expectFocusSettled(focus);
  await expect(focus.getByRole("tab", { name: "Workbench" })).toHaveAttribute("aria-selected", "true");
  await expect(focus.getByLabel("Recorded source video")).toBeVisible();
  await expect(focus.locator(".agent-focus-body")).toHaveCSS("display", "grid");
  await expect(page.locator(".top")).toHaveCSS("opacity", "0.08");
  await expect(focus.getByRole("note")).toHaveText(
    "Recorded preview · The submitted source was not processed",
  );
  const focusStyles = await focus.evaluate((root) => {
    const spatial = root.querySelector(".agent-focus-spatial");
    const environment = root.querySelector(".agent-focus-environment");
    const sectionRail = root.querySelector(".agent-focus-section-rail");
    const activeSection = sectionRail?.querySelector('[aria-selected="true"]');
    const activeLabel = activeSection?.querySelector(".agent-focus-section-label");
    const closeKey = root.querySelector(".agent-focus-rail-close .agent-focus-section-icon");
    const top = document.querySelector(".top");
    const topMark = document.querySelector(".top-mark");
    const dock = document.querySelector(".dock");
    if (!spatial || !environment || !sectionRail || !activeSection || !activeLabel
      || !closeKey || !top || !topMark || !dock) {
      return null;
    }
    const environmentBox = environment.getBoundingClientRect();
    const sectionRailBox = sectionRail.getBoundingClientRect();
    const activeSectionBox = activeSection.getBoundingClientRect();
    const activeLabelBox = activeLabel.getBoundingClientRect();
    return {
      rootPosition: getComputedStyle(root).position,
      spatialDisplay: getComputedStyle(spatial).display,
      environmentDisplay: getComputedStyle(environment).display,
      environmentBackground: getComputedStyle(environment).backgroundImage,
      environmentRadius: getComputedStyle(environment).borderRadius,
      sectionRailIsRight: sectionRailBox.left >= environmentBox.right,
      activeLabelIsOutward: activeLabelBox.left >= activeSectionBox.right,
      activeLabelClearsEnvironment: activeLabelBox.left >= environmentBox.right,
      activeFrameBackground: getComputedStyle(activeSection).backgroundColor,
      activeFrameShadow: getComputedStyle(activeSection).boxShadow,
      closeKeyWidth: getComputedStyle(closeKey).width,
      topFilter: getComputedStyle(top).filter,
      topOpacity: getComputedStyle(top).opacity,
      topMarkPointerEvents: getComputedStyle(topMark).pointerEvents,
      dockFilter: getComputedStyle(dock).filter,
      dockOpacity: getComputedStyle(dock).opacity,
      identityBefore: getComputedStyle(
        root.querySelector(".agent-focus-identity") as Element,
        "::before",
      ).content,
      identityAfter: getComputedStyle(
        root.querySelector(".agent-focus-identity") as Element,
        "::after",
      ).content,
    };
  });
  expect(focusStyles).toMatchObject({
    rootPosition: "absolute",
    spatialDisplay: "grid",
    environmentDisplay: "flex",
    environmentRadius: "14px",
    sectionRailIsRight: true,
    activeLabelIsOutward: true,
    activeLabelClearsEnvironment: true,
    activeFrameBackground: "rgba(0, 0, 0, 0)",
    activeFrameShadow: "none",
    closeKeyWidth: "30px",
    topOpacity: "0.08",
    topMarkPointerEvents: "none",
    dockFilter: "none",
    dockOpacity: "1",
    identityBefore: "none",
    identityAfter: "none",
  });
  expect(focusStyles?.environmentBackground).toContain("linear-gradient");
  expect(focusStyles?.topFilter).toContain("blur(10px)");
});

test("agent focus moves the canvas and fits every supported viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one pass covers the responsive viewport contract");
  test.setTimeout(60_000);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
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
    await page.waitForTimeout(450);
    const environment = focus.locator(".agent-focus-environment");
    const focusBody = focus.locator(".agent-focus-body");
    const sideRail = focus.locator(".agent-focus-side-rail");
    const cycleButtons = focus.locator(".agent-focus-cycle-buttons > button");
    const cycleLabel = focus.locator(".agent-focus-cycle-label");
    await expect(focus.getByRole("tablist", { name: "Focused agent sections" }).getByRole("tab"))
      .toHaveCount(4);
    await expect(focus.getByLabel("Recorded source video")).toBeVisible();
    await expect(focus.locator(".agent-focus-visual-evidence")).toBeVisible();
    const [focusBox, environmentBox, focusBodyBox, sideRailBox, dockBox, after, graphState,
      visibleRailLabels, previousBox, nextBox, cycleLabelBox] = await Promise.all([
      focus.boundingBox(),
      environment.boundingBox(),
      focusBody.boundingBox(),
      sideRail.boundingBox(),
      page.locator(".dock-well").boundingBox(),
      anchor.boundingBox(),
      page.locator(".graph").evaluate((element) => ({
        transform: getComputedStyle(element).transform,
        filter: getComputedStyle(element).filter,
      })),
      sideRail.locator(".agent-focus-section-label").evaluateAll((labels) =>
        labels.flatMap((label) => {
          const style = getComputedStyle(label);
          if (style.display === "none" || style.opacity === "0") return [];
          const box = label.getBoundingClientRect();
          return [{ x: box.x, y: box.y, width: box.width, height: box.height }];
        })),
      cycleButtons.nth(0).boundingBox(),
      cycleButtons.nth(1).boundingBox(),
      cycleLabel.boundingBox(),
    ]);
    expect(focusBox).not.toBeNull();
    expect(environmentBox).not.toBeNull();
    expect(focusBodyBox).not.toBeNull();
    expect(sideRailBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(previousBox).not.toBeNull();
    expect(nextBox).not.toBeNull();
    expect(cycleLabelBox).not.toBeNull();
    expect(focusBox?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect(focusBox?.y ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect((focusBox?.x ?? 0) + (focusBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
    expect((focusBox?.y ?? 0) + (focusBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(environmentBox?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect((environmentBox?.x ?? 0) + (environmentBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width + 0.5,
    );
    expect(environmentBox?.y ?? -1).toBeGreaterThanOrEqual(56);
    expect((environmentBox?.y ?? 0) + (environmentBox?.height ?? 0)).toBeLessThanOrEqual(
      (dockBox?.y ?? viewport.height) + 0.5,
    );
    expect(focusBodyBox?.x ?? -1).toBeGreaterThanOrEqual((environmentBox?.x ?? 0) - 0.5);
    expect((focusBodyBox?.x ?? 0) + (focusBodyBox?.width ?? 0)).toBeLessThanOrEqual(
      (environmentBox?.x ?? 0) + (environmentBox?.width ?? 0) + 0.5,
    );
    expect((focusBodyBox?.y ?? 0) + (focusBodyBox?.height ?? 0)).toBeLessThanOrEqual(
      (environmentBox?.y ?? 0) + (environmentBox?.height ?? 0) + 0.5,
    );
    expect((sideRailBox?.x ?? 0) + (sideRailBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width + 0.5,
    );
    expect(visibleRailLabels.length).toBeGreaterThan(0);
    for (const labelBox of visibleRailLabels) {
      expect(labelBox.x).toBeGreaterThanOrEqual(-0.5);
      expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(
        labelBox.x >= (environmentBox?.x ?? 0) + (environmentBox?.width ?? 0) - 0.5
        || labelBox.y + labelBox.height <= (environmentBox?.y ?? 0) + 0.5,
      ).toBe(true);
    }
    expect((previousBox?.x ?? 0) + (previousBox?.width ?? 0)).toBeLessThanOrEqual(
      nextBox?.x ?? 0,
    );
    expect((nextBox?.x ?? 0) + (nextBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width + 0.5,
    );
    expect((cycleLabelBox?.x ?? 0) + (cycleLabelBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width + 0.5,
    );
    expect(graphState.transform).not.toBe("none");
    expect(graphState.filter).toContain("blur");
    expect(
      Math.max(
        Math.abs((before?.x ?? 0) - (after?.x ?? 0)),
        Math.abs((before?.y ?? 0) - (after?.y ?? 0)),
      ),
    ).toBeGreaterThan(1);

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
    await page.getByRole("button", { name: "Input Source" }).click();
    await page.getByRole("textbox", { name: "Clip link" }).fill(`https://youtu.be/${longVideoId}`);
    await page.keyboard.press("Enter");
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
  await page.getByRole("button", { name: "Input Source" }).click();
  await page.getByRole("textbox", { name: "Clip link" }).fill("https://youtu.be/dQw4w9WgXcQ");
  await page.keyboard.press("Enter");

  const capsule = page.locator(".top-mid");
  const label = capsule.locator(".source-display-url");
  await expect(label).toHaveAttribute("data-overflow", "false");
  const shortWidth = await capsule.evaluate((element) => element.getBoundingClientRect().width);
  expect(shortWidth).toBeLessThan(360);

  await page.goto("/studio/");
  await page.getByRole("button", { name: "Input Source" }).click();
  await page
    .getByRole("textbox", { name: "Clip link" })
    .fill(`https://youtu.be/${"deliberately-long-source-id-".repeat(12)}`);
  await page.keyboard.press("Enter");

  await expect(label).toHaveAttribute("data-overflow", "true");
  const longWidth = await capsule.evaluate((element) => element.getBoundingClientRect().width);
  expect(longWidth).toBeGreaterThan(shortWidth + 30);
  expect(longWidth).toBeLessThanOrEqual(480.5);
});

test("the recorded run uses its receipted source identity", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Run Demo" }).click();
  await page.getByRole("button", { name: "Replay recorded analysis" }).click();

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

test("keyboard opens agent focus and the segment environment scrubs recorded media", async ({ page }) => {
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
  await expect(segmentFocus.getByRole("heading", { name: "Recorded media" })).toBeVisible();
  await expect(segmentFocus.getByLabel("Recorded source video")).toBeVisible();
  const seek = segmentFocus.getByRole("slider", { name: "Inspect recorded clip" });
  await seek.focus();
  const seekBefore = Number(await seek.inputValue());
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(seekBefore);
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
  await page.getByRole("button", { name: "Input Source" }).click();
  await page.getByRole("textbox", { name: "Clip link" }).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Launch investigation" }).click();
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
  await page.getByRole("button", { name: "Input Source" }).click();
  await page.getByRole("button", { name: "Run Demo" }).click();

  const speech = page.getByTestId("speech-activity-evidence");
  await expect(speech).toBeVisible();
  await expect(speech).toContainText(/\d+(?:\.\d+)?s speech · \d+\.\d% of decoded samples · \d+ speech windows?/);
  await expect(speech).toContainText(/\d+(?:\.\d+)?s–\d+(?:\.\d+)?s/);
  await expect(speech).toContainText("silero-vad 6.2.1");

  const languages = page.getByTestId("language-range-evidence");
  await expect(languages).toBeVisible();
  await expect(languages).toContainText("21 receipted speech-range results");
  await expect(languages).toContainText("whisper-language-id 1.0.0");
  await expect(languages).toContainText("uncalibrated model softmax scores");
  await expect(page.getByTestId("language-range").first()).toContainText(
    "0.002s–1.982s · ko classified · model probability 98.4% · model score margin 97.7%",
  );
  await expect(page.locator('[data-language-status="classified"]')).toHaveCount(10);
  await expect(page.locator('[data-language-status="unknown"]')).toHaveCount(4);
  await expect(page.locator('[data-language-status="withheld"]')).toHaveCount(7);
  await expect(page.locator('[data-language-status="unknown"]').first()).toContainText("Unknown · below probability");
  await expect(page.locator('[data-language-status="withheld"]').first()).toContainText(
    "Withheld · insufficient samples",
  );

  await expect(page.getByText(/recorded in run\.clip\.lang · not detector output/)).toBeVisible();
  await expect(page.getByText(/selected for the recorded job · not detector output/)).toBeVisible();
  await expect(
    page.getByLabel(/Measured language ranges · preflight evidence only; no replayable detected-language subrange/),
  ).toBeDisabled();

  await page.getByText("Producer coverage").click();
  for (const withheld of [
    "Music and noise classifier",
    "Preflight speaker and overlap estimator",
    "Measured range recommender",
  ]) {
    await expect(page.getByText(withheld, { exact: true })).toBeVisible();
  }
});
