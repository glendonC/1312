import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  RUNTIME_PLAN_200,
  RUNTIME_START_ACK_202,
  RUNTIME_STATUS_200,
} from "../src/features/api/examples.ts";
import {
  API_ENDPOINT_GROUPS,
  API_PAGES,
  API_SUCCESSFUL_PATH,
  ERROR_SCHEMA,
  PLAYBACK_GRANT_EXAMPLE,
  SMOKE_TO_TERMINAL_DISPLAY,
  START_REQUEST_EXAMPLE,
  WORKER_TOOLS,
} from "../src/features/api/model.ts";

const RUNTIME_HOST_DIR = new URL("../src/studio/runtime/production/runtimeHost/", import.meta.url);
const EXECUTOR_DIR = new URL("../src/studio/runtime/production/executor/", import.meta.url);

const readHostSource = async (file: string): Promise<string> =>
  readFile(new URL(file, RUNTIME_HOST_DIR), "utf8");

test("every documented endpoint path is present in the runtime host router source", async () => {
  const routerSource = await readHostSource("httpServer.ts");
  const endpoints = API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints);
  assert.ok(endpoints.length >= 20, "the documented surface covers the full router");
  for (const endpoint of endpoints) {
    assert.ok(endpoint.path.startsWith("/v1/"), `${endpoint.path} is versioned under /v1`);
    const staticSegments = endpoint.path
      .split("/")
      .filter((segment) => segment !== "" && segment !== "v1" && !segment.startsWith(":"));
    assert.ok(staticSegments.length > 0, `${endpoint.path} names at least one static segment`);
    for (const segment of staticSegments) {
      assert.ok(
        routerSource.includes(segment),
        `router source names the "${segment}" segment of ${endpoint.path}`,
      );
    }
    for (const method of endpoint.methods) {
      assert.ok(
        ["GET", "HEAD", "POST", "PUT"].includes(method),
        `${endpoint.path} documents a served method, got "${method}"`,
      );
    }
  }
});

test("every documented response schema is declared by the runtime host source", async () => {
  const contractSource = [
    await readHostSource("model.ts"),
    await readHostSource("service.ts"),
    await readHostSource("httpServer.ts"),
  ].join("\n");
  const schemas = new Set<string>([ERROR_SCHEMA]);
  for (const group of API_ENDPOINT_GROUPS) {
    for (const endpoint of group.endpoints) {
      if (endpoint.responseSchema !== null) schemas.add(endpoint.responseSchema);
    }
  }
  for (const schema of schemas) {
    assert.ok(
      contractSource.includes(`"${schema}"`),
      `runtime host source declares the "${schema}" schema tag`,
    );
  }
});

test("every documented field name exists in the runtime host contract source", async () => {
  const contractSource = [
    await readHostSource("model.ts"),
    await readHostSource("journalPolling.ts"),
    await readHostSource("../model/review.ts"),
    await readHostSource("../model/captions.ts"),
    await readHostSource("../model/languageExplanations.ts"),
  ].join("\n");
  const fields = API_ENDPOINT_GROUPS.flatMap((group) =>
    group.endpoints.flatMap((endpoint) => endpoint.fieldTables.flatMap((table) => table.fields)),
  );
  assert.ok(fields.length >= 30, "the field reference documents the core contract shapes");
  for (const field of fields) {
    const namePattern = new RegExp(`\\b${field.name}\\b`);
    assert.ok(
      namePattern.test(contractSource),
      `runtime host model declares the documented field "${field.name}"`,
    );
  }
});

test("every documented worker tool name exists in the executor bridge sources", async () => {
  const entries = await readdir(EXECUTOR_DIR);
  const sources = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".ts"))
      .map((entry) => readFile(new URL(entry, EXECUTOR_DIR), "utf8")),
  );
  const executorSource = sources.join("\n");
  for (const tool of WORKER_TOOLS) {
    assert.ok(
      executorSource.includes(`"${tool}"`),
      `executor sources declare the "${tool}" worker tool`,
    );
  }
});

test("code panels are executable requests or parseable captured responses", () => {
  const documented = new Set<string>([ERROR_SCHEMA]);
  for (const group of API_ENDPOINT_GROUPS) {
    for (const endpoint of group.endpoints) {
      if (endpoint.responseSchema !== null) documented.add(endpoint.responseSchema);
    }
  }
  const panels = API_ENDPOINT_GROUPS.flatMap((group) =>
    group.endpoints.flatMap((endpoint) => endpoint.panels),
  );
  const requests = panels.filter((panel) => panel.kind === "request");
  const responses = panels.filter((panel) => panel.kind === "response");
  assert.ok(requests.length >= 18, "request panels cover the surface");
  assert.ok(responses.length >= 8, "response panels cover the surface");
  for (const endpoint of API_ENDPOINT_GROUPS.flatMap((group) => group.endpoints)) {
    assert.ok(
      endpoint.panels.length > 0 || endpoint.fieldTables.length > 0,
      `${endpoint.methods.join("|")} ${endpoint.path} documents fields or an example panel`,
    );
  }
  for (const panel of requests) {
    assert.ok(panel.body.startsWith("curl"), `request panel "${panel.title}" is an executable curl`);
  }
  for (const panel of responses) {
    assert.ok(
      /\bCaptured\b/.test(panel.title) || /\bIllustrative\b/.test(panel.title),
      `response panel "${panel.title}" labels Captured or Illustrative authority`,
    );
    const parsed = JSON.parse(panel.body) as { schema?: unknown };
    assert.equal(typeof parsed.schema, "string", `response panel "${panel.title}" carries a schema tag`);
    assert.ok(
      documented.has(parsed.schema as string),
      `response panel schema "${String(parsed.schema)}" is documented`,
    );
  }
});

test("successful path matches host authority order and smoke stays local", () => {
  const hrefs = API_SUCCESSFUL_PATH.map((step) => step.href);
  assert.deepEqual(hrefs, [
    "/api/sources/",
    "/api/runtime/",
    "/api/audits/",
    "/api/review/",
    "/api/captions/",
    "/api/playback/",
    "/api/language/",
  ]);
  assert.ok(!hrefs.includes("/api/improve/"), "Improve is not a Successful Path /v1 step");
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("/v1/source-sessions"));
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("/v1/runtime-plans"));
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("/v1/runtime-starts"));
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("/v1/runtimes/$RUNTIME_ID/events"));
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("no SaaS"));
  assert.ok(SMOKE_TO_TERMINAL_DISPLAY.includes("Publish Review"));

  const improvePage = API_PAGES.find((page) => page.slug === "improve");
  assert.ok(improvePage?.description.includes("not a /v1"), "Improve page meta denies host surface");
});

test("documented example shapes stay bound to the contract they claim", () => {
  assert.equal(PLAYBACK_GRANT_EXAMPLE.schema, "studio.private-playback-grant.v1");
  assert.equal(PLAYBACK_GRANT_EXAMPLE.timestampOrigin.kind, "source_media_zero");
  assert.equal(START_REQUEST_EXAMPLE.requestedSourceLanguage.mode, "declared");
  assert.ok(START_REQUEST_EXAMPLE.range.endMs > START_REQUEST_EXAMPLE.range.startMs);

  const plan = JSON.parse(RUNTIME_PLAN_200) as { schema?: string; acceptance?: { status?: string } };
  const start = JSON.parse(RUNTIME_START_ACK_202) as {
    schema?: string;
    lifecycle?: string;
    terminal?: boolean;
    commandId?: string;
    runtimeId?: string;
  };
  const status = JSON.parse(RUNTIME_STATUS_200) as {
    schema?: string;
    lifecycle?: string;
    terminal?: boolean;
    commandId?: string;
    runtimeId?: string;
  };
  assert.equal(plan.schema, "studio.local-runtime-plan.v1");
  assert.equal(plan.acceptance?.status, "not_started");
  assert.equal(start.schema, "studio.local-runtime-start-ack.v1");
  assert.equal(start.lifecycle, "initializing");
  assert.equal(start.terminal, false);
  assert.equal(status.schema, "studio.local-runtime-status.v1");
  assert.equal(status.lifecycle, "terminal");
  assert.equal(status.terminal, true);
  assert.equal(start.commandId, status.commandId);
  assert.equal(start.runtimeId, status.runtimeId);
});

test("every reference page has a unique slug and every endpoint group has a page", () => {
  const slugs = API_PAGES.map((page) => page.slug);
  assert.equal(new Set(slugs).size, slugs.length, "page slugs are unique");
  assert.ok(slugs.includes(""), "the overview page exists");
  for (const page of API_PAGES) {
    assert.ok(page.title.length > 0, `page "${page.slug}" has a title`);
    assert.ok(page.description.length > 0, `page "${page.slug}" has a meta description`);
  }
  for (const group of API_ENDPOINT_GROUPS) {
    const page = API_PAGES.find((candidate) => candidate.slug === group.id);
    assert.ok(page, `endpoint group "${group.id}" has a reference page`);
    assert.equal(page?.group, "Endpoints", `page "${group.id}" sits in the Endpoints nav group`);
  }
});

test("the API routes compose the feature and stay in the public navigation", async () => {
  const indexSource = await readFile(
    new URL("../src/pages/api/index.astro", import.meta.url),
    "utf8",
  );
  const slugSource = await readFile(
    new URL("../src/pages/api/[slug].astro", import.meta.url),
    "utf8",
  );
  for (const [name, source] of [
    ["index", indexSource],
    ["[slug]", slugSource],
  ]) {
    assert.ok(source.includes("SiteLayout"), `the ${name} route uses the shared site layout`);
    assert.ok(source.includes("ApiDocsShell"), `the ${name} route renders the docs shell`);
  }
  assert.ok(slugSource.includes("getStaticPaths"), "the [slug] route builds from the page registry");
  const navSource = await readFile(
    new URL("../src/components/GlassNav.astro", import.meta.url),
    "utf8",
  );
  assert.ok(navSource.includes('href: "/api/"'), "the site navigation links /api/");
});
