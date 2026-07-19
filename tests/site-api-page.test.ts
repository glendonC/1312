import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  API_ENDPOINT_GROUPS,
  API_PAGES,
  ERROR_SCHEMA,
  PLAYBACK_GRANT_EXAMPLE,
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
    await readHostSource("../model/review.ts"),
    await readHostSource("../model/captions.ts"),
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
  assert.ok(requests.length >= 6, "request panels cover the surface");
  assert.ok(responses.length >= 8, "response panels cover the surface");
  for (const panel of requests) {
    assert.ok(panel.body.startsWith("curl"), `request panel "${panel.title}" is an executable curl`);
  }
  for (const panel of responses) {
    const parsed = JSON.parse(panel.body) as { schema?: unknown };
    assert.equal(typeof parsed.schema, "string", `response panel "${panel.title}" carries a schema tag`);
    assert.ok(
      documented.has(parsed.schema as string),
      `response panel schema "${String(parsed.schema)}" is documented`,
    );
  }
});

test("documented example shapes stay bound to the contract they claim", () => {
  assert.equal(PLAYBACK_GRANT_EXAMPLE.schema, "studio.private-playback-grant.v1");
  assert.equal(PLAYBACK_GRANT_EXAMPLE.timestampOrigin.kind, "source_media_zero");
  assert.equal(START_REQUEST_EXAMPLE.requestedSourceLanguage.mode, "declared");
  assert.ok(START_REQUEST_EXAMPLE.range.endMs > START_REQUEST_EXAMPLE.range.startMs);
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
