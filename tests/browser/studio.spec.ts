import { expect, test, type Page } from "@playwright/test";

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
  await expect(page.getByRole("complementary", { name: "Studio trace lab" })).toHaveCount(0);

  await openLab(page);
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
  await page.waitForTimeout(350);
  const heldFrame = await hubMesh.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(400);
  await expect
    .poll(() => hubMesh.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()))
    .toBe(heldFrame);
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

test("keyboard opens a worker and seeks recorded media", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("withheld");

  const orchestrator = page.getByRole("button", { name: /^orchestrator,/ });
  await orchestrator.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".drawer")).toBeVisible();
  await page.getByRole("button", { name: "Collapse trace lab" }).click();
  await page.getByRole("button", { name: "Close" }).click({ force: true });

  await page.getByRole("button", { name: "Expand trace lab" }).click();
  await scenario(page).selectOption("unscored-complete");
  const seek = page.getByRole("slider", { name: "Seek through clip" });
  await seek.focus();
  const before = Number(await seek.inputValue());
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(before);
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
