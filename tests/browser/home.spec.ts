import { expect, test } from "@playwright/test";

test("the homepage story moves forward and back through its questions", async ({ page }) => {
  await page.goto("/");

  const foundation = page.locator('[data-story-panel="foundation"]');
  const education = page.locator('[data-story-panel="education"]');

  await expect(foundation).toHaveAttribute("data-active", "true");
  await expect(education).toHaveAttribute("aria-hidden", "true");

  const demo = page.getByRole("link", { name: "View demo" });
  const demoBefore = await demo.boundingBox();
  await page.getByRole("button", { name: "Then what?" }).click();
  await expect(education).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("button", { name: "What makes that possible?" })).toBeFocused();
  const demoAfter = await demo.boundingBox();
  const reverse = page.getByRole("button", { name: "What makes that possible?" });
  const reverseBox = await reverse.boundingBox();
  expect(demoBefore).not.toBeNull();
  expect(demoAfter).not.toBeNull();
  expect(reverseBox).not.toBeNull();
  expect(demoAfter?.x).toBe(demoBefore?.x);
  expect((reverseBox?.x ?? 0) + (reverseBox?.width ?? 0)).toBeLessThanOrEqual(demoAfter?.x ?? 0);

  await page.keyboard.press("Enter");
  await expect(foundation).toHaveAttribute("data-active", "true");
  await expect(page.getByRole("button", { name: "Then what?" })).toBeFocused();
});

test("the homepage story respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const transition = await page.locator('[data-story-panel="foundation"]').evaluate(
    (panel) => getComputedStyle(panel).transitionDuration,
  );
  expect(transition).toBe("0s");
});

test("the homepage story fits the supported widths", async ({ page }, testInfo) => {
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
    await page.goto("/");
    const actions = page.locator(".hero-story-actions");
    const aside = page.locator(".hero-aside");
    const openStudio = page.getByRole("link", { name: "Open Studio" });
    const foundation = page.locator('[data-story-panel="foundation"]');
    const foundationEdge = page.locator('[data-story-panel="foundation"] .hero-story-line').last();
    const [asideBox, openStudioBox, foundationBox, foundationEdgeBox] = await Promise.all([
      aside.boundingBox(),
      openStudio.boundingBox(),
      foundation.boundingBox(),
      foundationEdge.boundingBox(),
    ]);
    expect(asideBox).not.toBeNull();
    expect(openStudioBox).not.toBeNull();
    expect(Math.abs(
      (asideBox?.x ?? 0) + (asideBox?.width ?? 0) - ((openStudioBox?.x ?? 0) + (openStudioBox?.width ?? 0)),
    )).toBeLessThanOrEqual(1.5);
    if (viewport.width > 640) {
      expect(foundationBox).not.toBeNull();
      expect(foundationEdgeBox).not.toBeNull();
      expect(Math.abs(
        (foundationBox?.x ?? 0) + (foundationBox?.width ?? 0) - ((asideBox?.x ?? 0) + (asideBox?.width ?? 0)),
      )).toBeLessThanOrEqual(0.5);
      expect(Math.abs(
        (foundationEdgeBox?.x ?? 0) + (foundationEdgeBox?.width ?? 0) - ((foundationBox?.x ?? 0) + (foundationBox?.width ?? 0)),
      )).toBeLessThanOrEqual(0.5);
      expect(await foundation.evaluate((panel) => getComputedStyle(panel).justifySelf)).toBe("end");
    }

    await page.getByRole("button", { name: "Then what?" }).click();

    const education = page.locator('[data-story-panel="education"]');
    const [actionsBox, educationBox] = await Promise.all([actions.boundingBox(), education.boundingBox()]);
    expect(actionsBox).not.toBeNull();
    expect(educationBox).not.toBeNull();
    expect(actionsBox?.y ?? 0).toBeGreaterThanOrEqual((educationBox?.y ?? 0) + (educationBox?.height ?? 0));
    expect(await actions.evaluate((row) => getComputedStyle(row).justifyContent)).toBe("end");
    expect(
      await aside.evaluate((aside) => ({
        justifySelf: getComputedStyle(aside).justifySelf,
        textAlign: getComputedStyle(aside).textAlign,
      })),
    ).toEqual({ justifySelf: "end", textAlign: "left" });

    for (const locator of [page.locator(".hero-aside"), actions]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 0.5);
    }
  }
});
