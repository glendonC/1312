import { expect, test, type Page } from "@playwright/test";

async function openLab(page: Page): Promise<void> {
  await page.goto("/studio/?lab=1");
  await expect(page.getByRole("button", { name: "Add a source" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Studio trace lab" })).toBeVisible();
}

function scenario(page: Page) {
  return page.getByLabel("Exact scenario");
}

function readout(page: Page) {
  return page.locator(".lab-readout b");
}

test("the lab is opt-in during development", async ({ page }) => {
  await page.goto("/studio/");
  await expect(page.getByRole("button", { name: "Add a source" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Studio trace lab" })).toHaveCount(0);

  await openLab(page);
});

test("a submitted source launches the recorded interface preview", async ({ page }) => {
  await page.goto("/studio/");
  await page.getByRole("button", { name: "Add a source" }).click();
  await page.getByRole("textbox", { name: "Clip link" }).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.keyboard.press("Enter");

  await expect(page.locator('.studio[data-stage="run"]')).toBeVisible();
  await expect(
    page.getByRole("note", {
      name: "Recorded interface preview for YouTube video link dQw4w9WgXcQ. The submitted source was not processed.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Hosted source probe unavailable")).toHaveCount(0);
});

test("the submitted preview fits every supported viewport", async ({ page }, testInfo) => {
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
    await page.getByRole("button", { name: "Add a source" }).click();
    await page.getByRole("textbox", { name: "Clip link" }).fill("https://youtu.be/dQw4w9WgXcQ");
    await page.keyboard.press("Enter");
    await expect(page.locator('.studio[data-stage="run"]')).toBeVisible();

    for (const locator of [page.locator(".top-mid"), page.locator(".dock")]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 0.5);
    }
  }
});

test("pause freezes the replay cursor and step advances exactly once", async ({ page }) => {
  await openLab(page);
  await scenario(page).selectOption("current-run");
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect.poll(async () => Number((await readout(page).textContent())?.split("/")[0].trim())).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();

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
  await page.getByRole("button", { name: "Close" }).click();

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
  await page.getByRole("button", { name: "Add a source" }).click();
  await page.getByRole("button", { name: "Demo clip" }).click();

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
