import { expect, test, type Page } from "@playwright/test";

async function openCompletedRun006(page: Page): Promise<void> {
  await page.goto("/studio/?lab=1");
  await expect(page.getByRole("complementary", { name: "Studio trace lab" })).toBeVisible();
  await page.getByLabel("Exact scenario").selectOption("unscored-complete");
  await page.locator(".studio-lab").evaluate((element) => {
    (element as HTMLElement).style.display = "none";
  });
  // Completion lands on the arrival statement; the watch face opens as a normal video with the
  // panel closed, so the transcript is a reveal from the command bar, never an ambient sidebar.
  await page.getByRole("button", { name: "View result" }).click();
  await page.getByRole("button", { name: "Watch the clip" }).click();
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Language learning workspace" })).toBeHidden();
  await page.getByRole("navigation", { name: "Watch commands" })
    .getByRole("button", { name: "Transcript" }).click();
  await expect(page.getByRole("region", { name: "Language learning workspace" })).toBeVisible();
}

test("the dev skip-to-results shortcut lands straight on the recorded learning viewer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop dev-shortcut coverage");
  // The shortcut is gated by import.meta.env.DEV, which the dev server used for these tests satisfies.
  await page.goto("/studio/");
  const dev = page.getByRole("group", { name: "Developer shortcuts" });
  await expect(dev).toBeVisible();
  await dev.getByRole("button", { name: "Skip to results" }).click();
  await page.getByRole("button", { name: "View result" }).click();
  await page.getByRole("button", { name: "Watch the clip" }).click();
  await expect(page.getByRole("region", { name: "Result" })).toBeVisible();
  // The room opens immersive; the transcript docks on command.
  await page.getByRole("navigation", { name: "Watch commands" })
    .getByRole("button", { name: "Transcript" }).click();
  await expect(page.getByRole("region", { name: "Language learning workspace" })).toBeVisible();
});

test("recorded results expose the learning-notes face behind Notes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop shared-result composition coverage");
  await openCompletedRun006(page);

  // The prep engine lives behind Notes as the depth wheel; its prepared output surfaces as
  // tappable marks on transcript lines, never as an auto-popping overlay. This covers that face.
  const results = page.getByRole("region", { name: "Result" });
  // The watch command bar's Notes option opens the depth-wheel prep face.
  await page.getByRole("navigation", { name: "Watch commands" })
    .getByRole("button", { name: "Notes", exact: true }).click();
  const face = results.getByRole("region", { name: "Learning notes" });
  await expect(face).toHaveAttribute("data-learning-prep-authority", "recorded_fixture");
  await expect(face).toHaveAttribute("data-learning-prep-state", "ready");
  await expect(face.locator("[data-prep-fixture-id]")).toHaveAttribute(
    "data-prep-fixture-id",
    "learning-prototype:run-006:c01",
  );
  await expect(face).toContainText("not production output");

  // Turning the depth wheel down re-arms the lens ramp, so the current prep is no longer valid.
  await face.locator('.learning-depth-stop:not([data-active="true"])').first().click();
  await expect(face).toHaveAttribute("data-learning-prep-state", "not_requested");
});

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

  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Saved (1)" }).click();
  // Saved docks as one mode of the watch room's single side panel, beside the transcript rather
  // than inside it, so it is scoped to the room and not to the reading workspace.
  const savedDrawer = page.getByRole("region", { name: "Saved" });
  // The session-only truth is now one compact honesty badge, not a paragraph: the pill reads
  // "Session only" and still carries the whole disclosure for a screen reader and on hover.
  const scope = savedDrawer.locator(".learning-saved-scope-pill");
  await expect(scope).toContainText("Session only");
  await expect(scope).toContainText("Nothing is saved after this result session ends.");
  await expect(scope).toHaveAttribute("title", "Nothing is saved after this result session ends.");
  await expect(savedDrawer).toContainText("몇 분");
  await expect(savedDrawer).toContainText("I know a few people.");
  await expect(savedDrawer.getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(savedDrawer.getByText("Checked practice")).toHaveCount(0);
  await expect(savedDrawer.getByText("Export", { exact: true })).toHaveCount(0);
  await savedDrawer.getByRole("button", { name: "Remove" }).click();
  await expect(savedDrawer).not.toContainText("I know a few people.");
  await savedDrawer.getByRole("button", { name: "Close saved" }).click();
  // Closing any docked mode empties the panel back to the bare video; the bar option now shows no
  // count because the set is empty again, and the transcript is a fresh reveal.
  await expect(savedDrawer).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Watch commands" })
    .getByRole("button", { name: "Transcript" }).click();
  await expect(workspace).toBeVisible();

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
  // The Saved option lives on the watch room's command bar; with nothing kept it carries no count.
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
});

test("the process view stills playback and keeps the result session for the return", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop Result/Process round-trip coverage");
  await openCompletedRun006(page);

  const results = page.getByRole("region", { name: "Result" });
  const viewer = results.getByRole("region", { name: "Learning viewer" });
  const workspace = page.getByRole("region", { name: "Language learning workspace" });
  // CSS locator, not a role query: the hidden result subtree keeps its DOM but drops its roles.
  const player = page.locator("#studio-recorded-results .player");
  const commands = page.getByRole("navigation", { name: "Result commands" });

  // Arrange a session worth keeping: a pinned explanation, one save, live playback.
  await workspace.getByRole("button", { name: "Explain 몇 분 at 0:00.0" }).click();
  const panel = workspace.getByRole("complementary", { name: "Pinned language explanation" });
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved (1)" })).toBeVisible();
  await viewer.getByRole("button", { name: "Play", exact: true }).click();
  await expect(player).toHaveAttribute("data-playing", "true");

  // Step back to the report, then close to the graph.
  await page.getByRole("button", { name: "Back to the result report" }).click();
  await commands.getByRole("button", { name: /^Close the result/ }).click();
  await expect(results).toBeHidden();
  await expect(page.locator(".stage-complete")).toBeVisible();
  // Closing stilled the clip: nothing keeps sounding behind the graph.
  await expect(player).toHaveAttribute("data-playing", "false");

  // The golden Result node is the way back in; the watch room's session survives the trip.
  await page.locator(".stage-complete").getByRole("button", { name: /^Result,/ }).click();
  await expect(results).toBeVisible();
  // The canvas is not gone — it persists under the reopened workspace; one world, two views.
  await expect(page.locator(".stage-complete")).toHaveCount(1);
  await page.getByRole("button", { name: "Watch the clip" }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "몇 분" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Saved (1)" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("a source without the bound fixture fails closed without repeated explanation actions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop failed-state coverage");
  await page.goto("/studio/?lab=1");
  await page.getByLabel("Exact scenario").selectOption("provisional-measured-complete");
  await page.locator(".studio-lab").evaluate((element) => {
    (element as HTMLElement).style.display = "none";
  });
  await page.getByRole("button", { name: "View result" }).click();
  await page.getByRole("button", { name: "Watch the clip" }).click();
  await page.getByRole("navigation", { name: "Watch commands" })
    .getByRole("button", { name: "Transcript" }).click();
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
  const fullScreen = viewer.getByRole("button", { name: "Full screen" });
  // The workbench viewer has no Split/Cinema choice — the watch face is the stage — so the one
  // mode control left is the browser full screen boundary.
  await expect(viewer.locator(".pm-view")).toHaveCount(0);
  await expect(viewer).toHaveAttribute("data-view-mode", "split");
  await expect(fullScreen).toBeEnabled();
  await expect(viewer.getByRole("slider", { name: "Volume" })).toHaveValue("0.8");
  const speed = viewer.getByRole("combobox", { name: "Playback speed" });
  await speed.selectOption("0.75");
  await expect(speed).toHaveValue("0.75");
  await expect.poll(() => viewer.locator(".player").evaluate((element) => getComputedStyle(element).borderTopWidth))
    .toBe("0px");
  await expect.poll(() => viewer.locator(".screen").evaluate((element) => getComputedStyle(element).borderRadius))
    .toBe("18px");

  // The room sizes its own reading rail; there is deliberately no panel width control anywhere.
  await expect(viewer.getByRole("group", { name: "Panel width" })).toHaveCount(0);

  // Full screen: the placement pair rides the settings pill. Docked is the default; Float keeps
  // the Learning panel usable floating over the video. The choice is sticky.
  await fullScreen.click();
  await expect(viewer).toHaveAttribute("data-view-mode", "fullscreen");
  await expect(fullScreen).toHaveAttribute("aria-pressed", "true");
  await expect(viewer).toHaveAttribute("data-fs-panel", "docked");
  await expect(viewer.getByRole("region", { name: "Language learning workspace" })).toBeVisible();
  const placement = viewer.getByRole("group", { name: "Panel placement" });
  await expect(placement.getByRole("button", { name: "Docked" })).toHaveAttribute("aria-pressed", "true");
  await placement.getByRole("button", { name: "Float" }).click();
  await expect(viewer).toHaveAttribute("data-fs-panel", "float");
  await expect(viewer.getByRole("region", { name: "Language learning workspace" })).toBeVisible();

  // Selecting the on-video caption in full screen raises the floating bar INSIDE the fullscreen
  // subtree: the browser paints nothing outside the fullscreen element, so a body-portalled bar
  // would exist yet stay invisible there.
  await viewer.locator('.burn-src[data-caption-line-id="c01"]').evaluate((element) => {
    const textNode = Array.from(element.childNodes).find((node) =>
      node.nodeType === Node.TEXT_NODE && node.textContent?.includes("분들이"));
    if (!textNode) throw new Error("Expected the burned caption text node");
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  const fullscreenSelectionBar = page.getByRole("toolbar", { name: "Selection actions" });
  await expect(fullscreenSelectionBar).toBeVisible();
  expect(await page.evaluate(() =>
    document.fullscreenElement?.contains(document.querySelector(".selection-bar")) ?? false,
  )).toBe(true);
  await page.keyboard.press("Escape");
  await expect(fullscreenSelectionBar).toHaveCount(0);

  // Leaving full screen restores the watch composition; re-entering keeps the sticky Float placement.
  await fullScreen.click();
  await expect(viewer).toHaveAttribute("data-view-mode", "split");
  await expect(viewer).not.toHaveAttribute("data-fs-panel", "float");
  await fullScreen.click();
  await expect(viewer).toHaveAttribute("data-view-mode", "fullscreen");
  await expect(viewer).toHaveAttribute("data-fs-panel", "float");
});

test("the caption pill resizes and hides the burned-in caption", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop caption-pill coverage");
  await openCompletedRun006(page);

  const results = page.getByRole("region", { name: "Result" });
  const player = results.locator('.player[data-player-surface="results"]');
  const screen = player.locator(".screen");
  await player.getByRole("slider", { name: "Seek through clip" }).fill("0.3");
  await player.hover();

  const caption = screen.locator('.burn[data-path="prepped"]');
  await expect(caption).toBeVisible();
  await expect(screen).toHaveAttribute("data-caption-scale", "md");

  const pill = player.getByRole("group", { name: "Caption display" });
  await pill.getByRole("button", { name: "Larger captions" }).click();
  await expect(screen).toHaveAttribute("data-caption-scale", "lg");
  await expect(pill.getByRole("button", { name: "Larger captions" })).toBeDisabled();
  await pill.getByRole("button", { name: "Smaller captions" }).click();
  await pill.getByRole("button", { name: "Smaller captions" }).click();
  await expect(screen).toHaveAttribute("data-caption-scale", "sm");

  await pill.getByRole("button", { name: "Hide captions" }).click();
  await expect(caption).toHaveCount(0);
  await expect(pill.getByRole("button", { name: "Smaller captions" })).toBeDisabled();
  await pill.getByRole("button", { name: "Show captions" }).click();
  await expect(screen.locator('.burn[data-path="prepped"]')).toBeVisible();
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

  // Details: what this run is and how much of it got captioned, folded into one plain-language read
  // in the room's voice — source identity, attribution and licence link, coverage, and the evidence
  // class stated in full, so the recorded-vs-live distinction is never softened. It is one mode of
  // the watch room's docked panel: the bar option docks the content, Escape closes it and returns
  // focus to the option that opened it.
  const details = page.getByRole("button", { name: "Details", exact: true });
  await expect(details).toBeVisible();
  await expect(page.getByRole("region", { name: "Details" })).toHaveCount(0);
  await details.click();
  const detailsPanel = page.getByRole("region", { name: "Details" });
  await expect(detailsPanel).toBeVisible();
  await expect(detailsPanel).toContainText("0:00–0:40");
  await expect(detailsPanel).toContainText("Korean");
  await expect(detailsPanel).toContainText("have captions");
  await expect(detailsPanel.getByRole("link", { name: /Creative Commons/ })).toBeVisible();
  await expect(detailsPanel).toContainText("honest demo replay, not a live run");
  await page.keyboard.press("Escape");
  await expect(detailsPanel).toHaveCount(0);
  await expect(details).toBeFocused();

  // Full screen rides on the video's control bar; the workbench viewer carries no Split/Cinema
  // choice. Recorded-vs-live provenance lives in the Source panel (Evidence and run files), not
  // burned onto the picture.
  const viewer = page.getByRole("region", { name: "Learning viewer" });
  const modes = viewer.getByRole("group", { name: "Viewing mode" });
  await expect(modes.getByRole("button", { name: "Full screen" })).toBeVisible();
  await expect(viewer.locator(".pm-view")).toHaveCount(0);
  await expect(viewer.locator(".player-provenance")).toHaveCount(0);
});

test("the recorded selection bar offers no Translate and never claims a span translation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop selection-bar honesty coverage");
  await openCompletedRun006(page);

  const workspace = page.getByRole("region", { name: "Language learning workspace" });
  const sourceCaption = workspace.locator('[data-learning-line-id="c01"]').locator(".cue-src");
  const translationRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/span-translations")) translationRequests.push(request.url());
  });
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
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });

  // Translation exists only where it is real: the recorded bar carries Explain and Save alone,
  // shows no translation rows of any kind, and never calls a model.
  const selectionBar = page.getByRole("toolbar", { name: "Selection actions" });
  await expect(selectionBar).toBeVisible();
  await expect(selectionBar.getByRole("button", { name: "Explain" })).toBeVisible();
  await expect(selectionBar.getByRole("button", { name: "Save" })).toBeVisible();
  await expect(selectionBar.getByRole("button", { name: "Translate" })).toHaveCount(0);
  await expect(selectionBar.locator(".selection-bar-translation-kind")).toHaveCount(0);
  await expect(selectionBar.locator("[data-span-translation-state]")).toHaveCount(0);
  expect(translationRequests).toEqual([]);
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
  // Selecting caption text raises the floating action bar; Explain opens the bounded sheet.
  const selectionBar = page.getByRole("toolbar", { name: "Selection actions" });
  await expect(selectionBar).toBeVisible();
  await selectionBar.getByRole("button", { name: "Explain" }).click();
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

test("the watch room hides its chrome after stillness while playing and wakes on activity", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop idle-chrome coverage");
  await openCompletedRun006(page);

  const room = page.locator(".result-workspace");
  const viewer = page.getByRole("region", { name: "Learning viewer" });
  const modeBar = viewer.locator(".watch-caption-controls");
  const transport = viewer.locator(".player-controls");

  // Playing is the precondition; the room opens paused, so start it, then hold the pointer still.
  await viewer.getByRole("button", { name: "Play", exact: true }).click();
  await page.mouse.move(700, 430);

  // Past the idle timeout the chrome fades together and the cursor hides — even with the pointer
  // resting over the picture, so it is inactivity that hides it, not leaving the frame.
  await expect(room).toHaveAttribute("data-chrome-idle", "true");
  await expect(modeBar).toHaveCSS("opacity", "0");
  await expect(transport).toHaveCSS("opacity", "0");
  await expect(room).toHaveCSS("cursor", "none");

  // Any movement wakes everything back.
  await page.mouse.move(720, 450);
  await page.mouse.move(770, 480);
  await expect(room).not.toHaveAttribute("data-chrome-idle", "true");
  await expect(modeBar).toHaveCSS("opacity", "1");
  await expect(transport).toHaveCSS("opacity", "1");

  // Paused, the chrome stays regardless of stillness — idle-hide is only for active playback.
  await viewer.getByRole("button", { name: "Pause", exact: true }).click();
  await page.mouse.move(700, 430);
  await expect(room).not.toHaveAttribute("data-chrome-idle", "true");
  await expect(modeBar).toHaveCSS("opacity", "1");
});
