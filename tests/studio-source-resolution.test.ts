import assert from "node:assert/strict";
import test from "node:test";

import {
  SourceResolutionError,
  resolveYouTubeSource,
  type SourceResolutionCommand,
} from "../scripts/lib/resolve-youtube-source.ts";
import {
  SourceResolutionClientError,
  resolveRemoteSource,
  validateRemoteSourceResolution,
} from "../src/studio/sourceResolution.ts";
import {
  createSubmittedSourcePreparationRequest,
  type SubmittedPreparationInput,
  SubmittedPreparationRequestError,
  validateSubmittedSourcePreparationRequest,
} from "../src/studio/submittedPreparation.ts";

const URL = "https://www.youtube.com/watch?v=XauBqFepc-s";

function fixtureCommand(calls: Array<{ executable: string; args: string[] }>): SourceResolutionCommand {
  return async (executable, args) => {
    calls.push({ executable, args });
    if (args[0] === "--version") return { stdout: "2026.07.04\n", stderr: "" };
    return {
      stdout: JSON.stringify({
        id: "XauBqFepc-s",
        title: "Resolved fixture video",
        channel: "Fixture producer",
        duration: 203,
        webpage_url: URL,
      }),
      stderr: "",
    };
  };
}

function preparationInput(overrides: Partial<SubmittedPreparationInput> = {}): SubmittedPreparationInput {
  return {
    start: 0,
    end: 60,
    targetLanguage: "en",
    outputDepth: "evidence",
    speechScope: "foreground",
    includeLyrics: false,
    speaker: null,
    honorifics: "preserve",
    translationStyle: "natural",
    captionDensity: "balanced",
    slowAnalysis: false,
    ...overrides,
  };
}

test("metadata-only YouTube resolution returns a content-identified real duration receipt", async () => {
  const calls: Array<{ executable: string; args: string[] }> = [];
  const receipt = await resolveYouTubeSource(URL, {
    command: fixtureCommand(calls),
    now: () => new Date("2026-07-16T12:00:00.000Z"),
  });

  assert.equal(receipt.source.durationMs, 203_000);
  assert.equal(receipt.source.durationMeasurement.kind, "provider_metadata");
  assert.equal(receipt.source.durationMeasurement.producer, "yt-dlp");
  assert.equal(receipt.source.canonicalUrl, URL);
  assert.equal(receipt.content.contentId, `sha256:${receipt.content.digest}`);
  assert.equal(receipt.resolutionId, `source-resolution:${receipt.content.digest}`);
  assert.deepEqual(calls, [
    { executable: "yt-dlp", args: ["--version"] },
    {
      executable: "yt-dlp",
      args: ["--dump-single-json", "--skip-download", "--no-playlist", "--no-warnings", URL],
    },
  ]);
  assert.deepEqual(await validateRemoteSourceResolution(receipt), receipt);
});

test("resolver rejects non-YouTube input before invoking any process", async () => {
  let invoked = false;
  await assert.rejects(
    resolveYouTubeSource("https://example.com/video", {
      command: async () => {
        invoked = true;
        return { stdout: "", stderr: "" };
      },
    }),
    (error: unknown) => error instanceof SourceResolutionError && error.code === "unsupported_source",
  );
  assert.equal(invoked, false);
});

test("browser validation rejects duration tampering and parses exact resolver errors", async () => {
  const receipt = await resolveYouTubeSource(URL, {
    command: fixtureCommand([]),
    now: () => new Date("2026-07-16T12:00:00.000Z"),
  });
  const tampered = structuredClone(receipt);
  tampered.source.durationMs += 1;
  await assert.rejects(
    validateRemoteSourceResolution(tampered),
    (error: unknown) => error instanceof SourceResolutionClientError && error.code === "invalid_resolution_receipt",
  );

  await assert.rejects(
    resolveRemoteSource(URL, async () => new Response(JSON.stringify({
      error: { code: "source_inaccessible", message: "Video is private." },
    }), { status: 422, headers: { "Content-Type": "application/json" } })),
    (error: unknown) => error instanceof SourceResolutionClientError
      && error.code === "source_inaccessible"
      && error.httpStatus === 422
      && error.message === "Video is private.",
  );
});

test("submitted preparation request binds the receipt and has no runtime-start semantics", async () => {
  const receipt = await resolveYouTubeSource(URL, {
    command: fixtureCommand([]),
    now: () => new Date("2026-07-16T12:00:00.000Z"),
  });
  const request = preparationInput();
  const preparation = await createSubmittedSourcePreparationRequest(
    receipt,
    request,
    { mode: "automatic", language: null },
  );

  assert.equal(preparation.schema, "studio.submitted-source-preparation-request.v1");
  assert.equal(preparation.purpose, "configure_recorded_interface_preview");
  assert.equal(preparation.resolution.resolutionId, receipt.resolutionId);
  assert.equal(preparation.resolution.contentId, receipt.content.contentId);
  assert.deepEqual(preparation.range, { startMs: 0, endMs: 60_000 });
  assert.deepEqual(preparation.language.source, { mode: "automatic", language: null });
  assert.equal("runtimeId" in preparation, false);
  assert.equal("commandId" in preparation, false);
  assert.deepEqual(await validateSubmittedSourcePreparationRequest(preparation, receipt), preparation);
});

test("submitted preparation identity changes with range, language intent, and target", async () => {
  const receipt = await resolveYouTubeSource(URL, {
    command: fixtureCommand([]),
    now: () => new Date("2026-07-16T12:00:00.000Z"),
  });
  const base = preparationInput();
  const first = await createSubmittedSourcePreparationRequest(
    receipt,
    base,
    { mode: "automatic", language: null },
  );
  const same = await createSubmittedSourcePreparationRequest(
    receipt,
    base,
    { mode: "automatic", language: null },
  );
  const changedRange = await createSubmittedSourcePreparationRequest(
    receipt,
    { ...base, end: 45 },
    { mode: "automatic", language: null },
  );
  const changedLanguage = await createSubmittedSourcePreparationRequest(
    receipt,
    base,
    { mode: "declared", language: "ko" },
  );
  const changedTarget = await createSubmittedSourcePreparationRequest(
    receipt,
    { ...base, targetLanguage: "ja" },
    { mode: "automatic", language: null },
  );

  assert.equal(first.requestId, same.requestId);
  assert.notEqual(first.requestId, changedRange.requestId);
  assert.notEqual(first.requestId, changedLanguage.requestId);
  assert.notEqual(first.requestId, changedTarget.requestId);
});

test("submitted preparation rejects over-policy, out-of-bounds, and tampered requests", async () => {
  const receipt = await resolveYouTubeSource(URL, {
    command: fixtureCommand([]),
    now: () => new Date("2026-07-16T12:00:00.000Z"),
  });
  await assert.rejects(
    createSubmittedSourcePreparationRequest(
      receipt,
      preparationInput({ end: 121 }),
      { mode: "automatic", language: null },
    ),
    (error: unknown) => error instanceof SubmittedPreparationRequestError
      && error.message.includes("120-second"),
  );
  await assert.rejects(
    createSubmittedSourcePreparationRequest(
      receipt,
      preparationInput({ end: 204 }),
      { mode: "automatic", language: null },
    ),
    (error: unknown) => error instanceof SubmittedPreparationRequestError
      && error.message.includes("resolved video duration"),
  );

  const valid = await createSubmittedSourcePreparationRequest(
    receipt,
    preparationInput(),
    { mode: "declared", language: "ko" },
  );
  const tampered = structuredClone(valid);
  tampered.language.target = "ja";
  await assert.rejects(
    validateSubmittedSourcePreparationRequest(tampered, receipt),
    (error: unknown) => error instanceof SubmittedPreparationRequestError
      && error.message.includes("content identity"),
  );
});
