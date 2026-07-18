import assert from "node:assert/strict";
import test from "node:test";

import type { LearningViewingSource } from "../src/studio/learning/model.ts";
import type { PrivatePlaybackExpectation, PrivatePlaybackHandle } from "../src/studio/localRuntime/client.ts";
import {
  ProductionPlaybackController,
  type ProductionPlaybackClient,
  type ProductionPlaybackInput,
} from "../src/studio/localRuntime/productionPlaybackController.ts";

type ProductionSource = Extract<
  LearningViewingSource,
  { context: { origin: "verified_production_caption" } }
>;

const SOURCE_CONTENT_ID = `sha256:${"a".repeat(64)}`;
const CAPTION_CONTENT_ID = `sha256:${"b".repeat(64)}`;

function productionSource(): ProductionSource {
  return {
    context: {
      origin: "verified_production_caption",
      authorityState: "unrevoked",
      timeline: {
        analysisRange: { startMs: 2_000, endMs: 12_000 },
        timestampOrigin: { kind: "source_media_zero", offsetMs: 0 },
      },
      identities: {
        runId: "runtime-1",
        sourceArtifactId: "artifact-source-1",
        sourceContentId: SOURCE_CONTENT_ID,
        analysisRequestId: "analysis-1",
        studyId: "study-1",
        studyArtifactId: "study-artifact-1",
        studyContentId: `sha256:${"c".repeat(64)}`,
        readinessId: "readiness-1",
        readinessArtifactId: "readiness-artifact-1",
        readinessReceiptId: "readiness-receipt-1",
        readinessReceiptContentId: `sha256:${"d".repeat(64)}`,
        approvalReviewId: "review-1",
        approvalArtifactId: "review-artifact-1",
        approvalReceiptId: "review-receipt-1",
        approvalReceiptContentId: `sha256:${"e".repeat(64)}`,
        captionJobId: "caption-job-1",
        captionArtifactId: "caption-artifact-1",
        captionContentId: CAPTION_CONTENT_ID,
        captionReceiptArtifactId: "caption-receipt-artifact-1",
        captionReceiptId: "caption-receipt-1",
        captionReceiptContentId: `sha256:${"f".repeat(64)}`,
        lineIds: ["line-1"],
      },
      rights: {
        basis: "production_private_source_policy",
        licence: null,
        attribution: null,
        mediaExport: { state: "unavailable", reasonCode: "media_export_excluded_from_p0" },
        textExport: { state: "unavailable", reasonCode: "export_adapter_missing" },
      },
      nonClaims: [
        "semantic_correctness_not_assessed",
        "translation_quality_not_assessed",
        "publication_not_authorized",
      ],
    },
    moments: [{
      lineId: "line-1",
      startMs: 2_000,
      endMs: 3_000,
      sourceLanguage: "ko",
      targetLanguage: "en",
      source: {
        state: "available",
        text: "현재 실행",
        reasonCode: null,
        upstreamReasonCode: null,
        detail: null,
      },
      target: {
        state: "available",
        text: "Current run",
        reasonCode: null,
        upstreamReasonCode: null,
        detail: null,
      },
      support: {
        state: "none",
        claimIds: [],
        citationIds: [],
        semanticEvidenceArtifactIds: [],
        semanticEvidenceReceiptIds: [],
      },
    }],
  };
}

function input(source = productionSource()): ProductionPlaybackInput {
  return {
    runtimeId: "runtime-1",
    sourceRevisionId: "source-revision-1",
    source,
    caption: {
      jobId: "caption-job-1",
      artifactId: "caption-artifact-1",
      contentId: CAPTION_CONTENT_ID,
    },
  };
}

class TestHandle implements PrivatePlaybackHandle {
  readonly schema = "studio.private-playback-handle.v1" as const;
  readonly grantId: string;
  readonly runtimeId: string;
  readonly source;
  readonly mimeType = "audio/mp4" as const;
  readonly timestampOrigin = { kind: "source_media_zero", offsetMs: 0 } as const;
  readonly issuedAt = "2026-07-18T16:00:00.000Z";
  readonly expiresAt: string;
  private mediaSource: string | null;
  disposeCount = 0;

  constructor(overrides: {
    grantId?: string;
    runtimeId?: string;
    revisionId?: string;
    artifactId?: string;
    contentId?: string;
    durationMs?: number;
    expiresAt?: string;
    src?: string | null;
  } = {}) {
    this.grantId = overrides.grantId ?? "private-playback-grant-1";
    this.runtimeId = overrides.runtimeId ?? "runtime-1";
    this.source = {
      sessionId: "source-session-1",
      revisionId: overrides.revisionId ?? "source-revision-1",
      artifactId: overrides.artifactId ?? "artifact-source-1",
      contentId: overrides.contentId ?? SOURCE_CONTENT_ID,
      bytes: 1_024,
      durationMs: overrides.durationMs ?? 15_000,
    };
    this.expiresAt = overrides.expiresAt ?? "2026-07-18T16:10:00.000Z";
    this.mediaSource = overrides.src === undefined
      ? "http://127.0.0.1:4312/v1/private-source-media/grant/secret"
      : overrides.src;
  }

  get src(): string | null {
    return this.mediaSource;
  }

  get disposed(): boolean {
    return this.mediaSource === null;
  }

  async dispose(): Promise<void> {
    if (this.mediaSource === null) return;
    this.disposeCount += 1;
    this.mediaSource = null;
  }
}

function clientFor(handle: PrivatePlaybackHandle): ProductionPlaybackClient & { expected: PrivatePlaybackExpectation[] } {
  const expected: PrivatePlaybackExpectation[] = [];
  return {
    expected,
    async createPrivatePlaybackHandle(value) {
      expected.push(structuredClone(value));
      return handle;
    },
  };
}

const NOW = () => new Date("2026-07-18T16:01:00.000Z");

test("production playback closes exact runtime, source, caption, and source-zero identities", async () => {
  const handle = new TestHandle();
  const client = clientFor(handle);
  const controller = new ProductionPlaybackController({ now: NOW });
  const result = await controller.load(input(), client);

  assert.equal(result.state, "available");
  if (result.state !== "available") return;
  assert.deepEqual(client.expected, [{
    runtimeId: "runtime-1",
    sourceRevisionId: "source-revision-1",
    sourceArtifactId: "artifact-source-1",
    sourceContentId: SOURCE_CONTENT_ID,
  }]);
  assert.equal(result.binding.captionJobId, "caption-job-1");
  assert.equal(result.binding.captionArtifactId, "caption-artifact-1");
  assert.equal(result.binding.captionContentId, CAPTION_CONTENT_ID);
  assert.deepEqual(result.binding.analysisRange, { startMs: 2_000, endMs: 12_000 });
  assert.deepEqual(result.binding.timestampOrigin, { kind: "source_media_zero", offsetMs: 0 });
  assert.equal(handle.disposeCount, 0);
});

test("production playback rejects wrong active runtime or caption before minting", async () => {
  for (const mutate of [
    (value: ProductionPlaybackInput) => { value.runtimeId = "runtime-2"; },
    (value: ProductionPlaybackInput) => { value.sourceRevisionId = " bad-revision"; },
    (value: ProductionPlaybackInput) => { value.caption.jobId = "caption-job-2"; },
    (value: ProductionPlaybackInput) => { value.caption.artifactId = "caption-artifact-2"; },
    (value: ProductionPlaybackInput) => { value.caption.contentId = `sha256:${"0".repeat(64)}`; },
    (value: ProductionPlaybackInput) => { value.source.context.authorityState = "revoked_after_completion"; },
  ]) {
    const value = input();
    mutate(value);
    const handle = new TestHandle();
    const client = clientFor(handle);
    const result = await new ProductionPlaybackController({ now: NOW }).load(value, client);
    assert.equal(result.state, "unavailable");
    assert.equal(result.state === "unavailable" && result.reasonCode, "invalid_playback_binding");
    assert.equal(client.expected.length, 0);
    assert.equal(handle.disposeCount, 0);
  }
});

test("production playback rejects and disposes mismatched, short, expired, or empty handles", async () => {
  const wrongTimestampOrigin = new TestHandle();
  (wrongTimestampOrigin as unknown as { timestampOrigin: unknown }).timestampOrigin = {
    kind: "analysis_range_zero",
    offsetMs: 2_000,
  };
  for (const handle of [
    new TestHandle({ runtimeId: "runtime-2" }),
    new TestHandle({ revisionId: "source-revision-2" }),
    new TestHandle({ artifactId: "artifact-source-2" }),
    new TestHandle({ contentId: `sha256:${"0".repeat(64)}` }),
    new TestHandle({ durationMs: 11_999 }),
    new TestHandle({ expiresAt: "2026-07-18T16:01:00.000Z" }),
    new TestHandle({ src: null }),
    wrongTimestampOrigin,
  ]) {
    const initiallyDisposed = handle.disposed;
    const result = await new ProductionPlaybackController({ now: NOW }).load(input(), clientFor(handle));
    assert.equal(result.state, "unavailable");
    assert.equal(result.state === "unavailable" && result.reasonCode, "invalid_playback_binding");
    assert.equal(handle.disposeCount, initiallyDisposed ? 0 : 1);
    assert.equal(handle.disposed, true);
  }
});

test("replacement and invalidation dispose each active handle once", async () => {
  const first = new TestHandle({ grantId: "private-playback-grant-1" });
  const second = new TestHandle({ grantId: "private-playback-grant-2" });
  const handles = [first, second];
  const client: ProductionPlaybackClient = {
    async createPrivatePlaybackHandle() {
      const handle = handles.shift();
      assert.ok(handle);
      return handle;
    },
  };
  const controller = new ProductionPlaybackController({ now: NOW });
  assert.equal((await controller.load(input(), client)).state, "available");
  assert.equal((await controller.load(input(), client)).state, "available");
  assert.equal(first.disposeCount, 1);
  assert.equal(second.disposeCount, 0);
  controller.invalidate();
  controller.invalidate();
  assert.equal(first.disposeCount, 1);
  assert.equal(second.disposeCount, 1);
});

test("a stale asynchronous grant is disposed without replacing the current binding", async () => {
  const stale = new TestHandle({ grantId: "private-playback-grant-stale" });
  const current = new TestHandle({ grantId: "private-playback-grant-current" });
  let releaseStale: ((handle: PrivatePlaybackHandle) => void) | undefined;
  const stalePromise = new Promise<PrivatePlaybackHandle>((resolve) => { releaseStale = resolve; });
  let call = 0;
  const client: ProductionPlaybackClient = {
    async createPrivatePlaybackHandle() {
      call += 1;
      return call === 1 ? stalePromise : current;
    },
  };
  const controller = new ProductionPlaybackController({ now: NOW });
  const firstLoad = controller.load(input(), client);
  const secondLoad = await controller.load(input(), client);
  assert.equal(secondLoad.state, "available");
  releaseStale?.(stale);
  assert.deepEqual(await firstLoad, { state: "invalidated" });
  assert.equal(stale.disposeCount, 1);
  assert.equal(current.disposeCount, 0);
  controller.invalidate();
  assert.equal(current.disposeCount, 1);
});
