import { expect, test, type Locator, type Page } from "@playwright/test";

function productStudioUrl(): string {
  const runtimeHost = process.env.STUDIO_RUNTIME_HOST_URL;
  return runtimeHost ? `/studio/?runtimeHost=${encodeURIComponent(runtimeHost)}` : "/studio/";
}

async function openCompletedDeterministicProjection(page: Page): Promise<Locator> {
  const token = process.env.STUDIO_RUNTIME_HOST_TOKEN ?? "";
  await page.goto(productStudioUrl());
  await page.getByRole("button", { name: "Use owned local source" }).click();

  const productRuntime = page.getByRole("region", { name: "Owned local source" });
  await productRuntime.getByLabel("Paste-once bearer token").fill(token);
  await productRuntime.getByRole("button", { name: "Connect to local host" }).click();
  await expect(productRuntime.getByLabel("Registered owned source")).toBeVisible();
  await productRuntime.getByLabel("Declared source language").fill("ko");
  await productRuntime.getByLabel("Language-pack identity (optional)").fill("ko-v3");
  await productRuntime.getByRole("button", { name: "Review local plan" }).click();
  await productRuntime
    .getByRole("region", { name: "Local runtime plan" })
    .getByRole("button", { name: "Accept forecast and start local runtime" })
    .click();

  const status = productRuntime.getByRole("region", { name: "Local runtime status" });
  await expect(status.getByText(/Terminal/)).toBeVisible({ timeout: 10_000 });
  return status.getByRole("region", { name: "Production task and handoff facts" });
}

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
  await expect(claims.locator('[data-claim-kind="speech_activity"]')).toHaveCount(1);
  await expect(claims.locator('[data-claim-kind="language_identity"]')).toHaveCount(1);
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
