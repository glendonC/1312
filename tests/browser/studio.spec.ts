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
