import { expect, test, type Page } from "@playwright/test";

async function openCompletedRun006(page: Page): Promise<void> {
  await page.goto("/studio/?lab=1");
  await expect(page.getByRole("complementary", { name: "Studio trace lab" })).toBeVisible();
  await page.getByLabel("Exact scenario").selectOption("unscored-complete");
  await page.locator(".studio-lab").evaluate((element) => {
    (element as HTMLElement).style.display = "none";
  });
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Language learning workspace" })).toBeVisible();
}

test("prepared language stays pinned, saves explicitly, and closes unsupported states", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop interaction and pinned-state coverage");
  await openCompletedRun006(page);

  const workspace = page.getByRole("region", { name: "Language learning workspace" });
  const preparedWord = workspace.getByRole("button", { name: "Explain 몇 분 at 0:00.0" });
  const seek = page.getByRole("slider", { name: "Seek through clip" });
  const timeBeforeSelection = await seek.inputValue();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(preparedWord).toBeVisible();
  await preparedWord.click();

  const panel = workspace.getByRole("complementary", { name: "Pinned language explanation" });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-pinned-line-id", "c01");
  await expect(panel).toHaveAttribute("data-learning-state", "prototype");
  await expect(panel.getByText("Prepared prototype")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "몇 분" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Meaning in this scene" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Word meaning" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Why this is difficult to hear" })).toHaveCount(0);
  await expect(panel.getByText("Follow-up questions")).toHaveCount(0);
  await expect(panel.getByText("Checked practice")).toHaveCount(0);
  await expect(panel.getByText("Export", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("About this explanation")).toBeVisible();
  await expect(seek).toHaveValue(timeBeforeSelection);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  await seek.fill("20");
  await expect(panel).toHaveAttribute("data-pinned-line-id", "c01");
  await expect(panel.getByRole("heading", { name: "몇 분" })).toBeVisible();
  await expect(workspace.locator('[data-learning-line-id="c01"]')).toHaveAttribute("data-learning-pinned", "true");
  await expect(workspace.locator('[data-learning-line-id="c01"]')).not.toHaveClass(/is-active/);

  await panel.getByRole("button", { name: "Keep in My Set" }).click();
  await expect(workspace.getByRole("button", { name: "My Set (1)" })).toBeVisible();
  await workspace.getByRole("button", { name: "My Set (1)" }).click();
  const mySet = workspace.getByRole("region", { name: "My Set" });
  await expect(mySet).toContainText("This session only");
  await expect(mySet).toContainText("Nothing is saved after this result session ends.");
  await expect(mySet).toContainText("몇 분");
  await expect(mySet).toContainText("I know a few people.");
  await expect(mySet.getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(mySet.getByText("Checked practice")).toHaveCount(0);
  await expect(mySet.getByText("Export", { exact: true })).toHaveCount(0);
  await mySet.getByRole("button", { name: "Remove" }).click();
  await expect(workspace.getByRole("button", { name: "My Set (0)" })).toBeVisible();
  await expect(mySet).not.toContainText("I know a few people.");

  await workspace.getByRole("button", { name: "Captions" }).click();
  const c01 = workspace.locator('[data-learning-line-id="c01"]');
  await c01.getByRole("button", { name: "Explain Korean sentence at 0:00.0" }).click();
  await expect(panel.getByRole("heading", { name: "분들이 몇 분 계신데" })).toBeVisible();
  await expect(panel.locator(".learning-insights h4")).toHaveText([
    "Meaning in this scene",
    "Sentence structure",
    "Why the English fits",
  ]);
  await expect(panel.locator(".learning-unavailable-facets")).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: "Cultural context" })).not.toBeVisible();

  const c07 = workspace.locator('[data-learning-line-id="c07"]');
  await panel.getByRole("button", { name: "Close explanation" }).click();
  await expect(c07).toContainText("withheld");
  await expect(c07.getByRole("button", { name: /Explain|View unavailable explanation/ })).toHaveCount(0);

  await preparedWord.focus();
  await preparedWord.press("Enter");
  await expect(panel).toBeFocused();
  await panel.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(preparedWord).toBeFocused();

  await openCompletedRun006(page);
  await expect(page.getByRole("region", { name: "Language learning workspace" })
    .getByRole("button", { name: "My Set (0)" })).toBeVisible();
});

test("a source without the bound fixture fails closed without repeated explanation actions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop failed-state coverage");
  await page.goto("/studio/?lab=1");
  await page.getByLabel("Exact scenario").selectOption("provisional-measured-complete");
  await page.locator(".studio-lab").evaluate((element) => {
    (element as HTMLElement).style.display = "none";
  });
  const workspace = page.getByRole("region", { name: "Language learning workspace" });
  await expect(workspace).toContainText("Prepared explanation unavailable");
  await expect(workspace).toContainText("invalid_source_binding");
  await expect(workspace.getByRole("button", { name: /Explain Korean sentence|View unavailable explanation/ })).toHaveCount(0);
});

test("viewer modes keep a borderless learning shell and use the browser full screen boundary", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop viewer-mode coverage");
  await page.addInitScript(() => {
    let activeFullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => activeFullscreenElement,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: async function requestFullscreen() {
        activeFullscreenElement = this;
        document.dispatchEvent(new Event("fullscreenchange"));
      },
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: async () => {
        activeFullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      },
    });
  });
  await openCompletedRun006(page);

  const viewer = page.getByRole("region", { name: "Learning viewer" });
  const study = viewer.getByRole("button", { name: "Study" });
  const theater = viewer.getByRole("button", { name: "Theater" });
  const fullScreen = viewer.getByRole("button", { name: "Full screen" });
  await expect(viewer).toHaveAttribute("data-view-mode", "study");
  await expect(study).toHaveAttribute("aria-pressed", "true");
  await expect(fullScreen).toBeEnabled();
  await expect(viewer.getByRole("slider", { name: "Volume" })).toHaveValue("0.8");
  const speed = viewer.getByRole("combobox", { name: "Playback speed" });
  await speed.selectOption("0.75");
  await expect(speed).toHaveValue("0.75");
  await expect.poll(() => viewer.locator(".player").evaluate((element) => getComputedStyle(element).borderTopWidth))
    .toBe("0px");
  await expect.poll(() => viewer.locator(".screen").evaluate((element) => getComputedStyle(element).borderRadius))
    .toBe("18px");

  await theater.click();
  await expect(viewer).toHaveAttribute("data-view-mode", "theater");
  await expect(theater).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByRole("region", { name: "Language learning workspace" })).toBeVisible();

  await fullScreen.click();
  await expect(viewer).toHaveAttribute("data-view-mode", "fullscreen");
  await expect(viewer.getByRole("button", { name: "Exit full screen" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByRole("region", { name: "Language learning workspace" })).toBeVisible();

  await study.click();
  await expect(viewer).toHaveAttribute("data-view-mode", "study");
  await expect(study).toHaveAttribute("aria-pressed", "true");
});

test("a completed run exposes one active media player without legacy workbench chrome", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop completed-viewer coverage");
  await openCompletedRun006(page);

  const results = page.getByRole("region", { name: "Result" });
  const resultsPlayer = results.locator('.player[data-player-surface="results"]');
  await expect(resultsPlayer).toHaveCount(1);
  await expect(page.locator('.player[data-player-surface="workbench"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Results" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run again", exact: true })).toHaveCount(0);
  await expect(page.locator(".dock-well")).toHaveCount(0);
  // The repeated title/credit below the video is gone; attribution lives in the Details panel instead.
  await expect(resultsPlayer.locator(".credit")).toHaveCount(0);
  await expect.poll(() => resultsPlayer.evaluate((element) => ({
    border: getComputedStyle(element).borderTopWidth,
    radius: getComputedStyle(element.querySelector(".screen") as Element).borderRadius,
  }))).toEqual({ border: "0px", radius: "18px" });

  await resultsPlayer.getByRole("slider", { name: "Seek through clip" }).fill("12.4");
  await resultsPlayer.locator(".pvol").hover();
  await resultsPlayer.getByRole("slider", { name: "Volume" }).fill("0.35");
  await resultsPlayer.getByRole("combobox", { name: "Playback speed" }).selectOption("1.5");
  await expect(resultsPlayer.getByRole("slider", { name: "Seek through clip" })).toHaveValue("12.4");
  await expect(resultsPlayer.getByRole("slider", { name: "Volume" })).toHaveValue("0.35");
  await expect(resultsPlayer.getByRole("combobox", { name: "Playback speed" })).toHaveValue("1.5");

  await resultsPlayer.getByRole("button", { name: "Play" }).click();
  await expect(resultsPlayer).toHaveAttribute("data-playback-owner", "true");
  await expect(resultsPlayer.getByRole("button", { name: "Pause" })).toBeVisible();
  await resultsPlayer.getByRole("button", { name: "Pause" }).click();
});

test("results chrome: header title truncates, Details and Run details open on demand", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop results-chrome coverage");
  await openCompletedRun006(page);

  // The title lives in a header squircle whose full text stays reachable via its title attribute.
  const titleChip = page.locator(".result-title-chip");
  const titleText = page.locator(".result-title-text");
  await expect(titleChip).toBeVisible();
  const fullTitle = (await titleText.textContent())?.trim() ?? "";
  expect(fullTitle.length).toBeGreaterThan(0);
  await expect(titleChip).toHaveAttribute("title", fullTitle);

  // A deliberately long title truncates to one ellipsised line without forcing horizontal page scroll.
  const clamp = await titleText.evaluate((element) => {
    element.textContent = "아주 긴 제목 ".repeat(60) + "END";
    const style = getComputedStyle(element);
    return {
      whiteSpace: style.whiteSpace,
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      truncated: element.scrollWidth > element.clientWidth + 1,
    };
  });
  expect(clamp.whiteSpace).toBe("nowrap");
  expect(clamp.overflow).toBe("hidden");
  expect(clamp.textOverflow).toBe("ellipsis");
  expect(clamp.truncated).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Details: run identity and attribution, on demand. It carries the source and licence links so
  // removing the below-video credit does not drop the required attribution, and states the evidence
  // class in full — the recorded-vs-live distinction is not softened.
  const details = page.getByRole("button", { name: "Details", exact: true });
  await expect(details).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Run details and attribution" })).toHaveCount(0);
  await details.click();
  const detailsPanel = page.getByRole("dialog", { name: "Run details and attribution" });
  await expect(detailsPanel).toBeVisible();
  await expect(detailsPanel).toContainText("KO → EN");
  await expect(detailsPanel).toContainText("Time range");
  await expect(detailsPanel.getByRole("link", { name: /Creative Commons/ })).toBeVisible();
  await expect(detailsPanel).toContainText("Honest demo replay, not a live run.");
  await detailsPanel.press("Escape");
  await expect(detailsPanel).toHaveCount(0);
  await expect(details).toBeFocused();

  // Run details: the second header control, with the per-line accounting.
  const runDetails = page.getByRole("button", { name: "Run details" });
  await expect(runDetails).toBeVisible();
  await runDetails.click();
  const runPanel = page.getByRole("dialog", { name: "Per-line run accounting" });
  await expect(runPanel).toBeVisible();
  await expect(runPanel).toContainText("captioned");
  await expect(runPanel).toContainText("Coverage");
  await runPanel.press("Escape");
  await expect(runPanel).toHaveCount(0);

  // The viewing modes ride on the video's control bar, and the provenance bug stays legible there.
  const viewer = page.getByRole("region", { name: "Learning viewer" });
  const modes = viewer.getByRole("group", { name: "Viewing mode" });
  await expect(modes.getByRole("button", { name: "Study" })).toBeVisible();
  await expect(modes.getByRole("button", { name: "Theater" })).toBeVisible();
  await expect(modes.getByRole("button", { name: "Full screen" })).toBeVisible();
  await expect(viewer.locator(".player-provenance")).toHaveText("recorded");
});

test("mobile selection and tap open a bounded explanation sheet and return focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile interaction coverage");
  await openCompletedRun006(page);

  const workspace = page.getByRole("region", { name: "Language learning workspace" });
  const c01 = workspace.locator('[data-learning-line-id="c01"]');
  const sourceCaption = c01.locator(".cue-src");
  const seek = page.getByRole("slider", { name: "Seek through clip" });
  const timeBeforeSelection = await seek.inputValue();
  await sourceCaption.evaluate((element) => {
    const textNode = Array.from(element.childNodes).find((node) =>
      node.nodeType === Node.TEXT_NODE && node.textContent?.includes("분들이"));
    if (!textNode) throw new Error("Expected the opening caption text node");
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
  });
  const panel = workspace.getByRole("complementary", { name: "Pinned language explanation" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "분들이" })).toBeVisible();
  await expect(panel).toHaveAttribute("data-learning-state", "unavailable");
  await expect(panel).toHaveAttribute("data-selected-start", "0");
  await expect(panel).toHaveAttribute("data-selected-end", "3");
  await expect(seek).toHaveValue(timeBeforeSelection);
  await expect.poll(() => panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      position: style.position,
      withinWidth: bounds.left >= 0 && bounds.right <= window.innerWidth,
      withinHeight: bounds.top >= 0 && bounds.bottom <= window.innerHeight,
    };
  })).toEqual({ position: "fixed", withinWidth: true, withinHeight: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await panel.getByRole("button", { name: "Close explanation" }).click();
  await expect(panel).toHaveCount(0);
  await expect(sourceCaption).toBeFocused();

  const preparedWord = workspace.getByRole("button", { name: "Explain 몇 분 at 0:00.0" });
  await preparedWord.click();
  await expect(panel.getByRole("heading", { name: "몇 분" })).toBeVisible();
  await expect(panel).toHaveAttribute("data-learning-state", "prototype");
  await panel.getByRole("button", { name: "Close explanation" }).click();
  await expect(panel).toHaveCount(0);
  await expect(preparedWord).toBeFocused();
});
