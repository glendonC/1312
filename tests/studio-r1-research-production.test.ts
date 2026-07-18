import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test, { type TestContext } from "node:test";

import { ContentAddressedArtifactStore, identifyFile } from "../src/studio/runtime/production/artifactStore.ts";
import { canonicalJsonContentId } from "../src/studio/runtime/production/artifactStore/contentIdentity.ts";
import { buildOwnedMediaStudyArtifact } from "../src/studio/runtime/production/artifactStore/studyArtifacts.ts";
import {
  BoundedChildResearchBridge,
  callChildResearchBridge,
  CHILD_RESEARCH_SEARCH_TOOL_NAME,
  CHILD_RESEARCH_SNAPSHOT_TOOL_NAME,
  ChildResearchBridgeError,
  fetchChildResearchManifest,
  openChildResearchBridge,
} from "../src/studio/runtime/production/executor/childResearchBridge.ts";
import { auditEvidenceCitation } from "../src/studio/runtime/production/evidenceCitations/audit.ts";
import type {
  OwnedMediaStudyArtifact,
  OwnedMediaStudyExecutorReceipt,
  OwnedMediaStudyRecord,
  RuntimeProjection,
  SourceArtifactDescriptor,
} from "../src/studio/runtime/production/model.ts";
import { OWNED_MEDIA_STUDY_LIMITS } from "../src/studio/runtime/production/model.ts";
import {
  RESEARCH_LIMITS,
  type ResearchCapabilityGrant,
  type ResearchGapBinding,
  type ResearchGrantView,
} from "../src/studio/runtime/production/model/research.ts";
import { fetchResearchDocument, ResearchEgressError, type ResearchDnsLookup, type ResearchFetcher } from "../src/studio/runtime/production/research/egressPolicy.ts";
import { FixtureResearchProvider } from "../src/studio/runtime/production/research/provider.ts";
import { auditResearchSearch, auditResearchSnapshot } from "../src/studio/runtime/production/research/researchAudit.ts";
import {
  externalDocumentSpanCitation,
  reopenResearchCitationSource,
} from "../src/studio/runtime/production/research/researchCitation.ts";
import { BoundedResearchHost, withWallDeadline } from "../src/studio/runtime/production/research/researchHost.ts";
import { ResearchRequestHost } from "../src/studio/runtime/production/research/researchRequestHost.ts";
import { validateEvidenceCitationEnvelope, evidenceCitationId } from "../src/studio/runtime/production/validation/evidenceCitations.ts";
import { validateResearchRequestReceipt, validateResearchSearchReceipt } from "../src/studio/runtime/production/validation/research.ts";
import { runtimeTestJobContext } from "./runtime-test-job-context.ts";

const RUN_ID = "runtime:r1-research";
const TASK_ID = "task:research-root";
const AGENT_ID = "agent:research-root";
const GRANT_ID = "grant:research-1";
const FIXED_NOW = "2026-07-17T00:00:00.000Z";
const MEDIA_CONTENT_ID = `sha256:${"a".repeat(64)}`;
const SOURCE_FIXTURE = resolve("public/demo/runs/run-006/clip.mp4");
const SOURCE_DURATION_MS = 40_040;

const HTML_BODY = [
  "<html><head><title>Festival</title><style>.hide{display:none}</style>",
  "<script>var tracking = 1;</script></head>",
  "<body><h1>Harvest Festival</h1>",
  "<p>The autumn toast honors the &amp; harvest moon.</p></body></html>",
].join("");
const PLAIN_BODY = "Plain fixture text.\r\nSecond line about the festival.";

function testGap(): ResearchGapBinding {
  return {
    inputId: "research-request-input:test",
    triggerId: "research-trigger:test",
    hypothesis: "Which festival the overlapping toast references is unresolved.",
    media: { artifactId: "artifact:media", contentId: MEDIA_CONTENT_ID, trackId: "stream:1", startMs: 1_000, endMs: 4_000 },
  };
}

function testGrant(): ResearchCapabilityGrant {
  return {
    id: GRANT_ID,
    capability: "research.investigate",
    researchScope: {
      schema: "studio.research-grant.v1",
      limits: structuredClone(RESEARCH_LIMITS),
      allowedDomains: ["example.com", "docs.example.com"],
      gap: testGap(),
    },
  };
}

function testView(): ResearchGrantView {
  return { taskId: TASK_ID, agentId: AGENT_ID, grants: [testGrant()] };
}

function testProvider(): FixtureResearchProvider {
  return new FixtureResearchProvider({
    "harvest festival toast": [
      { url: "https://example.com/article", title: "Harvest Festival", snippet: "The autumn toast honors the harvest moon." },
      { url: "https://docs.example.com/direct", title: "Direct document", snippet: "A plain text festival reference." },
      { url: "https://evil.example.net/x", title: "Off allowlist", snippet: "This domain was never granted." },
    ],
    "second question": [
      { url: "https://docs.example.com/direct", title: "Direct document", snippet: "A plain text festival reference." },
    ],
    "third question": [
      { url: "https://docs.example.com/direct", title: "Direct document", snippet: "A plain text festival reference." },
    ],
    "bad destinations": [
      { url: "https://user:pass@example.com/a", title: "Credentialed", snippet: "URL with embedded credentials." },
      { url: "https://93.184.216.34/x", title: "IP literal", snippet: "Raw address destination." },
      { url: "https://localhost/x", title: "Loopback", snippet: "Local destination." },
      { url: "https://example.com/downgrade", title: "Downgrade", snippet: "Redirects to http." },
      { url: "https://example.com/loop", title: "Loop", snippet: "Redirects forever." },
      { url: "https://example.com/pdf", title: "PDF", snippet: "Disallowed media type." },
      { url: "https://example.com/huge-declared", title: "Huge declared", snippet: "Oversized content length." },
      { url: "https://example.com/huge-stream", title: "Huge stream", snippet: "Oversized streamed body." },
    ],
  });
}

function html(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 301, headers: { location } });
}

function testRoutes(): Record<string, () => Response> {
  return {
    "https://example.com/article": () => redirect("https://docs.example.com/landed"),
    "https://docs.example.com/landed": () => html(200, HTML_BODY),
    "https://docs.example.com/direct": () =>
      new Response(PLAIN_BODY, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "set-cookie": "session=1" } }),
    "https://example.com/downgrade": () => redirect("http://docs.example.com/insecure"),
    "https://example.com/loop": () => redirect("https://example.com/loop2"),
    "https://example.com/loop2": () => redirect("https://example.com/loop3"),
    "https://example.com/loop3": () => redirect("https://example.com/loop4"),
    "https://example.com/loop4": () => redirect("https://example.com/loop5"),
    "https://example.com/pdf": () => new Response("%PDF-1.4", { status: 200, headers: { "content-type": "application/pdf" } }),
    "https://example.com/huge-declared": () =>
      new Response("tiny", { status: 200, headers: { "content-type": "text/plain", "content-length": String(RESEARCH_LIMITS.maxDocumentBytes + 1) } }),
    "https://example.com/huge-stream": () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(700_000));
            controller.enqueue(new Uint8Array(700_000));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/plain" } },
      ),
  };
}

function fixtureFetcher(routes: Record<string, () => Response>, log: Array<{ url: string; init: RequestInit }> = []): ResearchFetcher {
  return async (url, init) => {
    log.push({ url, init });
    const factory = routes[url];
    if (!factory) return new Response("missing", { status: 404 });
    return factory();
  };
}

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const privateLookup = async () => [{ address: "10.0.0.5", family: 4 }];

async function makeStore(t: TestContext): Promise<{ store: ContentAddressedArtifactStore; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "studio-r1-research-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return { store: new ContentAddressedArtifactStore(root), root };
}

function makeHost(
  store: ContentAddressedArtifactStore,
  options: {
    view?: ResearchGrantView;
    routes?: Record<string, () => Response>;
    log?: Array<{ url: string; init: RequestInit }>;
    lookup?: ResearchDnsLookup;
  } = {},
): BoundedResearchHost {
  return new BoundedResearchHost(RUN_ID, options.view ?? testView(), store, {
    searchProvider: testProvider(),
    fetcher: fixtureFetcher(options.routes ?? testRoutes(), options.log),
    lookup: options.lookup ?? publicLookup,
    now: () => FIXED_NOW,
  });
}

function searchRequest(operationId: string, query: string, overrides: Record<string, unknown> = {}): unknown {
  return { operationId, taskId: TASK_ID, agentId: AGENT_ID, grantId: GRANT_ID, op: "search", query, ...overrides };
}

function snapshotRequest(operationId: string, searchOperationId: string, resultIndex: number, overrides: Record<string, unknown> = {}): unknown {
  return { operationId, taskId: TASK_ID, agentId: AGENT_ID, grantId: GRANT_ID, op: "document_snapshot", searchOperationId, resultIndex, ...overrides };
}

async function tamperStoredObject(root: string, contentId: string, replacement: string): Promise<void> {
  const digest = contentId.replace(/^sha256:/, "");
  await writeFile(join(root, "objects", "sha256", digest.slice(0, 2), digest), replacement, "utf8");
}

function egressReason(reason: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof ResearchEgressError, `expected ResearchEgressError, got ${String(error)}`);
    assert.equal(error.reason, reason);
    return true;
  };
}

test("granted search and snapshot produce content-addressed reopenable receipts that cold-audit", async (t) => {
  const { store } = await makeStore(t);
  const log: Array<{ url: string; init: RequestInit }> = [];
  const host = makeHost(store, { log });

  const search = await host.search(searchRequest("operation:search:1", "harvest festival toast"));
  assert.equal(search.receipt.state, "available");
  assert.equal(search.receipt.query, "harvest festival toast");
  assert.equal(search.receipt.retrievedAt, FIXED_NOW);
  assert.deepEqual(search.receipt.results.map((entry) => entry.index), [0, 1, 2]);
  assert.ok(search.receipt.results.every((entry) => entry.snippetRole === "routing_hint_not_citation"));
  assert.equal(canonicalJsonContentId(search.receipt), search.receiptContentId);

  const snapshot = await host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", 0));
  assert.equal(snapshot.receipt.request.url, "https://example.com/article");
  assert.deepEqual(snapshot.receipt.redirectChain, [
    { url: "https://example.com/article", status: 301, location: "https://docs.example.com/landed" },
  ]);
  assert.equal(snapshot.receipt.finalUrl, "https://docs.example.com/landed");
  assert.equal(snapshot.receipt.response.mimeType, "text/html");
  assert.equal(snapshot.receipt.extraction.method, "html_text_v1");
  assert.ok(snapshot.extraction.envelope.text.includes("Harvest Festival"));
  assert.ok(snapshot.extraction.envelope.text.includes("honors the & harvest moon"));
  assert.ok(!snapshot.extraction.envelope.text.includes("tracking"));
  assert.ok(!snapshot.extraction.envelope.text.includes("display:none"));

  await auditResearchSearch(store, RUN_ID, search.receiptContentId);
  const audited = await auditResearchSnapshot(store, RUN_ID, snapshot.receiptContentId);
  assert.equal(audited.extraction.envelope.text, snapshot.extraction.envelope.text);
  assert.equal(audited.search.receipt.receiptId, search.receipt.receiptId);

  assert.ok(log.length >= 2);
  for (const entry of log) {
    assert.equal(entry.init.credentials, "omit");
    const headers = entry.init.headers as Record<string, string>;
    assert.ok(!Object.keys(headers).some((key) => key.toLowerCase() === "cookie"));
  }
});

test("plain text snapshots back exact cite-only document span citations that survive the cold-audit dispatch", async (t) => {
  const { store, root } = await makeStore(t);
  const host = makeHost(store);
  await host.search(searchRequest("operation:search:1", "harvest festival toast"));
  const snapshot = await host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", 1));
  assert.equal(snapshot.receipt.extraction.method, "plain_text_v1");
  assert.equal(snapshot.extraction.envelope.text, "Plain fixture text.\nSecond line about the festival.");

  const verified = await reopenResearchCitationSource(store, RUN_ID, snapshot.receiptContentId);
  const gap = testGap();
  const target = {
    kind: "media_context" as const,
    qualifiesMedia: { artifactId: gap.media.artifactId, trackId: gap.media.trackId, startMs: gap.media.startMs, endMs: gap.media.endMs },
  };
  const citation = externalDocumentSpanCitation({ verified, target, spans: [{ start: 0, end: 19 }] });
  assert.equal(citation.use, "cite_only");
  assert.equal(citation.evidenceKind, "external_document_span");
  assert.equal(citation.observations[0].locator.kind, "document_span");

  const state = { runId: RUN_ID } as unknown as RuntimeProjection;
  const audited = await auditEvidenceCitation(state, store, citation);
  assert.deepEqual(audited, citation);

  assert.throws(
    () => externalDocumentSpanCitation({ verified, target, spans: [{ start: 0, end: verified.extraction.envelope.unitCount + 1 }] }),
    /span escapes the stored extraction/,
  );
  assert.throws(
    () => externalDocumentSpanCitation({
      verified,
      target: { kind: "media_context", qualifiesMedia: { ...target.qualifiesMedia, endMs: target.qualifiesMedia.endMs + 1 } },
      spans: [{ start: 0, end: 5 }],
    }),
    /escapes its granted research gap/,
  );

  const upgraded: Record<string, unknown> = structuredClone(citation) as unknown as Record<string, unknown>;
  upgraded.use = "claim_support";
  upgraded.target = { kind: "claim", claimId: "claim:fake", range: target.qualifiesMedia };
  const { schema: _schema, citationId: _citationId, ...upgradedBody } = upgraded;
  upgraded.citationId = evidenceCitationId(upgradedBody as unknown as Parameters<typeof evidenceCitationId>[0]);
  assert.throws(() => validateEvidenceCitationEnvelope(upgraded), /claim support requires available current-run speech/);

  const coverageUpgrade: Record<string, unknown> = structuredClone(citation) as unknown as Record<string, unknown>;
  coverageUpgrade.use = "coverage_qualification";
  coverageUpgrade.target = { kind: "coverage", range: target.qualifiesMedia };
  const { schema: _s2, citationId: _c2, ...coverageBody } = coverageUpgrade;
  coverageUpgrade.citationId = evidenceCitationId(coverageBody as unknown as Parameters<typeof evidenceCitationId>[0]);
  assert.throws(() => validateEvidenceCitationEnvelope(coverageUpgrade), /cite-only over explicit receipted document spans/);

  await tamperStoredObject(root, snapshot.extraction.contentId, `${JSON.stringify({ forged: true })}\n`);
  await assert.rejects(auditEvidenceCitation(state, store, citation));
});

test("tampering with stored document bytes or receipts fails the cold audit", async (t) => {
  const { store, root } = await makeStore(t);
  const host = makeHost(store);
  await host.search(searchRequest("operation:search:1", "harvest festival toast"));
  const snapshot = await host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", 1));
  await auditResearchSnapshot(store, RUN_ID, snapshot.receiptContentId);

  await tamperStoredObject(root, snapshot.document.contentId, "forged document bytes");
  await assert.rejects(auditResearchSnapshot(store, RUN_ID, snapshot.receiptContentId), /no longer match|not canonical/);
});

test("search receipt drift between search and snapshot fails closed", async (t) => {
  const { store, root } = await makeStore(t);
  const host = makeHost(store);
  const search = await host.search(searchRequest("operation:search:1", "harvest festival toast"));
  await tamperStoredObject(root, search.receiptContentId, `${JSON.stringify({ forged: true })}\n`);
  await assert.rejects(host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", 1)));
});

test("grant budgets, duplicate work, and call ceilings close the grant", async (t) => {
  const { store } = await makeStore(t);
  const host = makeHost(store);
  await host.search(searchRequest("operation:search:1", "harvest festival toast"));
  await host.search(searchRequest("operation:search:2", "second question"));
  await assert.rejects(host.search(searchRequest("operation:search:3", "third question")), /query budget is exhausted/);
  await assert.rejects(host.search(searchRequest("operation:search:4", "harvest festival toast")), /query budget is exhausted|duplicates already-charged work/);

  await host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", 1));
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:1b", "operation:search:1", 1)),
    /duplicates already-charged work/,
  );
  await host.snapshotDocument(snapshotRequest("operation:snapshot:2", "operation:search:2", 0));
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:3", "operation:search:1", 0)),
    /call budget is exhausted/,
  );
  await assert.rejects(host.search(searchRequest("operation:search:5", "harvest festival toast")), /call budget is exhausted/);
});

test("missing, wrong, and identity-escaping grants fail closed", async (t) => {
  const { store } = await makeStore(t);
  const host = makeHost(store);
  await assert.rejects(
    host.search(searchRequest("operation:search:1", "harvest festival toast", { grantId: "grant:other" })),
    /outside the task's authoritative capability grant/,
  );
  await assert.rejects(
    host.search(searchRequest("operation:search:1", "harvest festival toast", { taskId: "task:imposter" })),
    /identities escape the injected task view/,
  );
  const ungranted = makeHost(store, { view: { taskId: TASK_ID, agentId: AGENT_ID, grants: [] } });
  await assert.rejects(
    ungranted.search(searchRequest("operation:search:1", "harvest festival toast")),
    /outside the task's authoritative capability grant/,
  );
  const reusedOperation = makeHost(store);
  await reusedOperation.search(searchRequest("operation:search:1", "harvest festival toast"));
  await assert.rejects(
    reusedOperation.search(searchRequest("operation:search:1", "second question")),
    /already exists/,
  );
});

async function rejectSnapshot(
  t: TestContext,
  query: string,
  resultIndex: number,
  matcher: (error: unknown) => boolean,
  options: Parameters<typeof makeHost>[1] = {},
): Promise<Array<{ url: string; init: RequestInit }>> {
  const { store } = await makeStore(t);
  const log: Array<{ url: string; init: RequestInit }> = [];
  const host = makeHost(store, { ...options, log });
  await host.search(searchRequest("operation:search:1", query));
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", resultIndex)),
    matcher,
  );
  return log;
}

test("URL-policy-rejected destinations fail closed and never reach the fetcher", async (t) => {
  for (const [index, reason] of [[0, "credentials_in_url"], [1, "destination_not_allowed"], [2, "destination_not_allowed"]] as const) {
    const log = await rejectSnapshot(t, "bad destinations", index, egressReason(reason));
    assert.deepEqual(log, [], `result ${index} must never reach the fetcher`);
  }
});

test("scheme downgrade, redirect loop, and private DNS resolution are rejected at their hop", async (t) => {
  await rejectSnapshot(t, "bad destinations", 3, egressReason("scheme_not_allowed"));
  await rejectSnapshot(t, "bad destinations", 4, egressReason("redirect_limit_exceeded"));
  await rejectSnapshot(t, "harvest festival toast", 1, egressReason("private_destination"), { lookup: privateLookup });
});

test("an IPv6 private DNS answer is rejected", async (t) => {
  await rejectSnapshot(t, "harvest festival toast", 1, egressReason("private_destination"), {
    lookup: async () => [{ address: "fd00::1", family: 6 }],
  });
  await rejectSnapshot(t, "harvest festival toast", 1, egressReason("private_destination"), {
    lookup: async () => [{ address: "64:ff9b::a9fe:a9fe", family: 6 }],
  });
});

test("a redirect that lands on an allowlisted-but-private host is rejected before the body is read", async (t) => {
  const lookup = async (hostname: string) =>
    hostname === "docs.example.com"
      ? [{ address: "10.0.0.9", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }];
  const { store } = await makeStore(t);
  const host = makeHost(store, { lookup });
  await host.search(searchRequest("operation:search:1", "harvest festival toast"));
  // Result 0 first hops through the public example.com, then redirects onto the allowlisted
  // docs.example.com which resolves private; the per-hop check must reject at the second hop.
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", 0)),
    egressReason("private_destination"),
  );
});

test("a redirect off the domain allowlist is rejected", async (t) => {
  const routes = { ...testRoutes(), "https://docs.example.com/landed": () => redirect("https://evil.example.net/pwn") };
  const { store } = await makeStore(t);
  const host = makeHost(store, { routes });
  await host.search(searchRequest("operation:search:1", "harvest festival toast"));
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", 0)),
    egressReason("destination_not_allowed"),
  );
});

test("MIME and both declared and streamed byte ceilings abort disallowed responses", async (t) => {
  await rejectSnapshot(t, "bad destinations", 5, egressReason("mime_not_allowed"));
  await rejectSnapshot(t, "bad destinations", 6, egressReason("byte_limit_exceeded"));
  await rejectSnapshot(t, "bad destinations", 7, egressReason("byte_limit_exceeded"));
});

test("the shared wall-deadline helper and the egress hop check both fail closed as wall_timeout", async () => {
  await assert.rejects(withWallDeadline(new Promise(() => {}), performance.now() - 1), egressReason("wall_timeout"));
  assert.equal(await withWallDeadline(Promise.resolve(7), performance.now() + 1_000), 7);
  await assert.rejects(
    fetchResearchDocument("https://example.com/article", {
      allowedDomains: ["example.com"],
      deadlineAtMs: performance.now() - 1,
      fetcher: fixtureFetcher(testRoutes()),
      lookup: publicLookup,
    }),
    egressReason("wall_timeout"),
  );
});

test("a provider that throws or returns malformed entries fails closed as provider_result_invalid", async (t) => {
  const { store } = await makeStore(t);
  const throwing = new BoundedResearchHost(RUN_ID, testView(), store, {
    searchProvider: { id: "throwing", version: "1", search: async () => { throw new Error("provider exploded"); } },
    fetcher: fixtureFetcher(testRoutes()),
    lookup: publicLookup,
    now: () => FIXED_NOW,
  });
  await assert.rejects(
    throwing.search(searchRequest("operation:search:1", "harvest festival toast")),
    egressReason("provider_result_invalid"),
  );
  const malformed = new BoundedResearchHost(RUN_ID, testView(), store, {
    searchProvider: { id: "malformed", version: "1", search: async () => [{ url: "https://example.com/x", title: 5, snippet: null } as never] },
    fetcher: fixtureFetcher(testRoutes()),
    lookup: publicLookup,
    now: () => FIXED_NOW,
  });
  await assert.rejects(
    malformed.search(searchRequest("operation:search:2", "harvest festival toast")),
    egressReason("provider_result_invalid"),
  );
});

test("failed operations still charge the grant budget and cannot be retried into unbounded egress", async (t) => {
  const { store } = await makeStore(t);
  const log: Array<{ url: string; init: RequestInit }> = [];
  const host = makeHost(store, { log });
  await host.search(searchRequest("operation:search:1", "bad destinations"));
  // First MIME failure performs one real fetch and is charged.
  await assert.rejects(host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", 5)), egressReason("mime_not_allowed"));
  // The identical retry is rejected as duplicate work, never re-fetched.
  const fetchesAfterFirst = log.length;
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:1b", "operation:search:1", 5)),
    /duplicates already-charged work/,
  );
  assert.equal(log.length, fetchesAfterFirst, "a duplicate failing request must not re-fetch");
  // A second, different failing document exhausts the document budget; a third is refused before egress.
  await assert.rejects(host.snapshotDocument(snapshotRequest("operation:snapshot:2", "operation:search:1", 6)), egressReason("byte_limit_exceeded"));
  const fetchesAfterSecond = log.length;
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:3", "operation:search:1", 7)),
    /document budget is exhausted/,
  );
  assert.equal(log.length, fetchesAfterSecond, "an over-budget request must not reach the fetcher");
});

test("absolute FQDN trailing-dot destinations are rejected before the fetch", async (t) => {
  const { store } = await makeStore(t);
  const log: Array<{ url: string; init: RequestInit }> = [];
  const host = new BoundedResearchHost(RUN_ID, testView(), store, {
    searchProvider: new FixtureResearchProvider({
      "trailing dot": [{ url: "https://example.com./page", title: "Trailing dot", snippet: "Absolute FQDN form." }],
    }),
    fetcher: fixtureFetcher({ "https://example.com./page": () => html(200, HTML_BODY) }, log),
    lookup: publicLookup,
    now: () => FIXED_NOW,
  });
  await host.search(searchRequest("operation:search:1", "trailing dot"));
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", 0)),
    egressReason("destination_not_allowed"),
  );
  assert.deepEqual(log, [], "trailing-dot destinations must never reach the fetcher");
});

test("an unclosed script or style tag never leaks its body into extraction text", async (t) => {
  const { store } = await makeStore(t);
  const leaky = "<html><body><h1>Visible</h1><script>var secret = 'leaked-token';</script no-close <p>After.</p>";
  const host = new BoundedResearchHost(RUN_ID, testView(), store, {
    searchProvider: new FixtureResearchProvider({ "leaky": [{ url: "https://example.com/leaky", title: "Leaky", snippet: "Unclosed tag page." }] }),
    fetcher: fixtureFetcher({ "https://example.com/leaky": () => html(200, leaky) }),
    lookup: publicLookup,
    now: () => FIXED_NOW,
  });
  await host.search(searchRequest("operation:search:1", "leaky"));
  const snapshot = await host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", 0));
  assert.ok(snapshot.extraction.envelope.text.includes("Visible"));
  assert.ok(!snapshot.extraction.envelope.text.includes("leaked-token"));
});

test("extraction size ceiling aborts oversized output within the document byte grant", async (t) => {
  const { store } = await makeStore(t);
  // A ~280 KB text body stays under maxDocumentBytes (1 MiB) but its extraction exceeds the
  // 200 000-unit extraction ceiling, exercising the frozen limit rather than a tuned one.
  const oversized = `<html><body><p>${"festival ".repeat(31_000)}</p></body></html>`;
  const host = new BoundedResearchHost(RUN_ID, testView(), store, {
    searchProvider: new FixtureResearchProvider({ "oversize": [{ url: "https://example.com/big", title: "Big", snippet: "Large document." }] }),
    fetcher: fixtureFetcher({ "https://example.com/big": () => html(200, oversized) }),
    lookup: publicLookup,
    now: () => FIXED_NOW,
  });
  await host.search(searchRequest("operation:search:1", "oversize"));
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:1", 0)),
    egressReason("artifact_oversized"),
  );
});

test("snapshots can only name results recorded by a completed same-grant search", async (t) => {
  const { store } = await makeStore(t);
  const host = makeHost(store);
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:1", "operation:search:absent", 0)),
    /completed search under the same grant/,
  );
  await host.search(searchRequest("operation:search:solo", "second question"));
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:2", "operation:search:solo", 5)),
    /outside the recorded search receipt/,
  );
  await assert.rejects(
    host.snapshotDocument(snapshotRequest("operation:snapshot:3", "operation:search:solo", RESEARCH_LIMITS.maxResultsPerQuery)),
    /escapes the closed result window/,
  );
});

test("search receipts and snippets can never become citations", async (t) => {
  const { store } = await makeStore(t);
  const host = makeHost(store);
  const search = await host.search(searchRequest("operation:search:1", "harvest festival toast"));
  await assert.rejects(
    reopenResearchCitationSource(store, RUN_ID, search.receiptContentId),
    /Research snapshot receipt/,
  );
});

async function studyFixture(store: ContentAddressedArtifactStore): Promise<{
  view: { runId: string; ownedMediaStudies: Record<string, OwnedMediaStudyRecord>; artifacts: RuntimeProjection["artifacts"] };
  studyContentId: string;
  conflictDetail: string;
  sourceArtifactId: string;
  sourceContentId: string;
}> {
  const descriptor: SourceArtifactDescriptor = {
    schema: "studio.source-artifact.v1",
    adapterId: "owned-local-source-adapter.v1",
    sourceReceiptRef: "fixture:run-006:research-source",
    publication: "private",
    path: SOURCE_FIXTURE,
    content: await identifyFile(SOURCE_FIXTURE),
    durationMs: SOURCE_DURATION_MS,
    tracks: [
      { id: "stream:0", index: 0, kind: "video", codec: "h264", durationMs: SOURCE_DURATION_MS },
      { id: "stream:1", index: 1, kind: "audio", codec: "aac", durationMs: 40_000 },
    ],
  };
  const source = await store.registerSource(RUN_ID, descriptor);
  const conflictDetail = "Which festival the overlapping toast references is unresolved.";
  const envelope: OwnedMediaStudyArtifact = {
    schema: "studio.owned-media-study.v1",
    runId: RUN_ID,
    root: {
      taskId: "task:root",
      agentId: "agent:root",
      executionId: "execution:root",
      jobContext: runtimeTestJobContext({ source, range: { startMs: 0, endMs: 40_000 } }),
    },
    planning: {
      decisionId: "decision:planning:1",
      receiptId: "receipt:planning:1",
      receiptContentId: canonicalJsonContentId({ fixture: "planning" }),
      outcome: "synthesize_with_gaps",
      inputId: "input:planning:1",
    },
    reports: [],
    childDispositions: [],
    followUpHistory: [],
    coverage: [{
      coverageId: "coverage:1",
      artifactId: source.id,
      trackId: "stream:1",
      startMs: 1_000,
      endMs: 4_000,
      state: "withheld",
      claimIds: [],
      reason: { code: "unresolved_conflict", detail: conflictDetail },
    }],
    claims: [],
    conflicts: [{ conflictId: "conflict:1", coverageId: "coverage:1", status: "unresolved", detail: conflictDetail }],
    limitations: [],
    sourceArtifacts: [{ artifactId: source.id, contentId: source.content.contentId }],
    limits: OWNED_MEDIA_STUDY_LIMITS,
    nonClaims: {
      semanticCorrectness: "not_assessed",
      translationQuality: "not_assessed",
      truthArbitration: "not_performed",
      publication: "not_authorized",
    },
  };
  const prepared = await store.prepareOwnedMediaStudy(RUN_ID, envelope);
  const executorReceipt: OwnedMediaStudyExecutorReceipt = {
    schema: "studio.owned-media-study.executor-receipt.v1",
    receiptId: "receipt:study-executor:1",
    synthesisId: "synthesis:1",
    execution: { executionId: "execution:root", taskId: "task:root", agentId: "agent:root" },
    planning: {
      decisionId: envelope.planning.decisionId,
      receiptId: envelope.planning.receiptId,
      receiptContentId: envelope.planning.receiptContentId,
    },
    output: {
      artifactId: prepared.artifactId,
      contentId: prepared.content.contentId,
      bytes: prepared.content.bytes,
      schema: "studio.owned-media-study.v1",
    },
    producer: { id: "studio.model-root-study-synthesis", version: "1", authorship: "active_root_executor_tool_call" },
    outcome: "completed",
  };
  const storedReceipt = await store.storeJson(executorReceipt);
  const studyArtifact = buildOwnedMediaStudyArtifact({
    runId: RUN_ID,
    receipt: executorReceipt,
    receiptContentId: storedReceipt.content.contentId,
    prepared,
  });
  const record: OwnedMediaStudyRecord = {
    id: prepared.studyId,
    planningDecisionId: envelope.planning.decisionId,
    rootTaskId: "task:root",
    rootAgentId: "agent:root",
    executionId: "execution:root",
    artifactId: studyArtifact.id,
    contentId: prepared.content.contentId,
    executorReceiptId: executorReceipt.receiptId,
    executorReceiptContentId: storedReceipt.content.contentId,
    coverageIds: ["coverage:1"],
    conflictIds: ["conflict:1"],
    coverage: structuredClone(prepared.envelope.coverage),
    conflicts: structuredClone(prepared.envelope.conflicts),
  };
  return {
    view: {
      runId: RUN_ID,
      ownedMediaStudies: { [record.id]: record },
      artifacts: { [source.id]: source, [studyArtifact.id]: studyArtifact },
    },
    studyContentId: prepared.content.contentId,
    conflictDetail,
    sourceArtifactId: source.id,
    sourceContentId: source.content.contentId,
  };
}

test("research triggers derive only from reopened unresolved study conflicts and stay echo-exact", async (t) => {
  const { store, root } = await makeStore(t);
  const requestHost = new ResearchRequestHost(store);

  const empty = await requestHost.inspect({ runId: RUN_ID, ownedMediaStudies: {}, artifacts: {} });
  assert.deepEqual(empty.triggers, []);
  await assert.rejects(
    requestHost.request({ runId: RUN_ID, ownedMediaStudies: {}, artifacts: {} }, { inputId: empty.inputId, triggerId: "trigger:any" }),
    /one exact audited trigger/,
  );

  const fixture = await studyFixture(store);
  const inspected = await requestHost.inspect(fixture.view);
  assert.equal(inspected.triggers.length, 1);
  const trigger = inspected.triggers[0];
  assert.equal(trigger.gap.kind, "unresolved_study_conflict");
  assert.equal(trigger.gap.detail, fixture.conflictDetail);
  assert.deepEqual(trigger.source, {
    artifactId: fixture.sourceArtifactId,
    contentId: fixture.sourceContentId,
    trackId: "stream:1",
    startMs: 1_000,
    endMs: 4_000,
  });

  const verified = await requestHost.request(fixture.view, { inputId: inspected.inputId, triggerId: trigger.triggerId });
  assert.equal(verified.gap.hypothesis, fixture.conflictDetail);
  assert.deepEqual(verified.gap.media, trigger.source);
  const reopened = await store.receiptBytes(verified.receiptContentId);
  validateResearchRequestReceipt(JSON.parse(reopened.toString("utf8")));

  await assert.rejects(
    requestHost.request(fixture.view, { inputId: "research-request-input:stale", triggerId: trigger.triggerId }),
    /stale or forged host input/,
  );
  await assert.rejects(
    requestHost.request(fixture.view, { inputId: inspected.inputId, triggerId: "research-trigger:forged" }),
    /one exact audited trigger/,
  );

  await tamperStoredObject(root, fixture.studyContentId, "forged study bytes");
  await assert.rejects(requestHost.inspect(fixture.view), /no longer matches its registered content identity/);
});

test("the loopback child bridge stays path-free, grant-gated, and fail-closed", async (t) => {
  const { store } = await makeStore(t);
  const host = makeHost(store);
  const bridge = new BoundedChildResearchBridge(testView(), host, {
    nextOperationId: (() => {
      let value = 0;
      return () => `operation:child:research:${++value}`;
    })(),
  });
  const open = await openChildResearchBridge(bridge);
  t.after(async () => open.close());

  const manifest = await fetchChildResearchManifest(open.endpoint, open.token);
  assert.equal(manifest.gap.hypothesis, testGap().hypothesis);
  assert.deepEqual(manifest.allowedDomains, ["example.com", "docs.example.com"]);

  const searchResult = await callChildResearchBridge(open.endpoint, open.token, CHILD_RESEARCH_SEARCH_TOOL_NAME, {
    query: "harvest festival toast",
  });
  assert.equal(searchResult.op, "search");
  assert.equal(searchResult.receipt.authorization.taskId, TASK_ID);

  const snapshotResult = await callChildResearchBridge(open.endpoint, open.token, CHILD_RESEARCH_SNAPSHOT_TOOL_NAME, {
    searchOperationId: searchResult.operationId,
    resultIndex: 1,
  });
  assert.equal(snapshotResult.op, "document_snapshot");
  assert.ok(snapshotResult.op === "document_snapshot" && snapshotResult.extraction.text.includes("festival"));

  await assert.rejects(
    callChildResearchBridge(open.endpoint, open.token, CHILD_RESEARCH_SNAPSHOT_TOOL_NAME, {
      searchOperationId: searchResult.operationId,
      resultIndex: 2,
    }),
    ChildResearchBridgeError,
  );

  const response = await fetch(new URL("/call", open.endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${open.token}` },
    body: JSON.stringify({ name: "shell_exec", arguments: {} }),
  });
  assert.equal(response.status, 400);

  const unauthorized = await fetch(new URL("/manifest", open.endpoint));
  assert.equal(unauthorized.status, 401);

  const ungranted = new BoundedChildResearchBridge({ taskId: TASK_ID, agentId: AGENT_ID, grants: [] }, host);
  assert.throws(() => ungranted.manifest(), ChildResearchBridgeError);
  await assert.rejects(ungranted.call(CHILD_RESEARCH_SEARCH_TOOL_NAME, { query: "x" }), ChildResearchBridgeError);
});

test("host search receipts remain valid standalone contracts", async (t) => {
  const { store } = await makeStore(t);
  const host = makeHost(store);
  const search = await host.search(searchRequest("operation:search:1", "harvest festival toast"));
  const reopened = validateResearchSearchReceipt(JSON.parse((await store.receiptBytes(search.receiptContentId)).toString("utf8")));
  assert.deepEqual(reopened, search.receipt);
});
