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
