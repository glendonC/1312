/**
 * Provider/source-specific wire fields stop here. Pipeline scripts consume only this normalized
 * view and never reach into YouTube or owned-local receipt variants directly.
 */
export function normalizeSourceReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") throw new Error("source receipt must be an object");

  if (receipt.kind === "youtube") {
    const label = requiredText(receipt.label, "youtube.label");
    const channel = requiredText(receipt.channel, "youtube.channel");
    const videoId = requiredText(receipt.video_id, "youtube.video_id");
    const url = requiredText(receipt.url, "youtube.url");
    const licence = requiredText(receipt.licence, "youtube.licence");
    if (!/creative commons/i.test(licence)) {
      throw new Error(
        "youtube.licence is not redistributable; Standard YouTube media must use the bench-only local_eval_youtube adapter",
      );
    }
    const attribution = requiredText(receipt.attribution, "youtube.attribution");
    const duration = positive(receipt.duration, "youtube.duration");
    return {
      kind: "youtube",
      title: label,
      creator: channel,
      sourceId: videoId,
      locator: { url },
      rights: {
        basis: "redistribution_licence",
        label: licence,
        attribution,
        scope: "redistribution",
      },
      selection: {
        start: requiredText(receipt.window?.start, "youtube.window.start"),
        end: requiredText(receipt.window?.end, "youtube.window.end"),
        duration,
      },
      contentId: null,
      note: requiredText(receipt.note, "youtube.note"),
    };
  }

  if (receipt.kind === "owned_local") {
    exact(receipt.schema, "studio.ingest.owned-local.v1", "owned_local.schema");
    exact(receipt.producer, "scripts/ingest-owned-media.mjs", "owned_local.producer");
    const label = requiredText(receipt.label, "owned_local.label");
    const digest = requiredText(receipt.content?.hash?.digest, "owned_local.content.hash.digest");
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("owned_local.content.hash.digest must be lowercase SHA-256");
    exact(receipt.content?.hash?.algorithm, "sha256", "owned_local.content.hash.algorithm");
    const contentId = `sha256:${digest}`;
    exact(receipt.content?.id, contentId, "owned_local.content.id");
    exact(receipt.receipt_id, `owned-local:${digest}`, "owned_local.receipt_id");
    positive(receipt.content?.bytes, "owned_local.content.bytes");
    exact(receipt.rights?.basis, "ownership_attestation", "owned_local.rights.basis");
    const assertedBy = requiredText(receipt.rights?.asserted_by, "owned_local.rights.asserted_by");
    const statement = requiredText(receipt.rights?.statement, "owned_local.rights.statement");
    if (!statement.includes(assertedBy) || !statement.includes("owns or controls")) {
      throw new Error("owned_local.rights.statement must carry the explicit ownership attestation");
    }
    const scope = receipt.rights?.scope;
    if (scope !== "local_processing" && scope !== "redistribution") {
      throw new Error("owned_local.rights.scope is not registered");
    }
    const duration = positive(receipt.selection?.duration, "owned_local.selection.duration");
    const end = positive(receipt.selection?.end, "owned_local.selection.end");
    if (receipt.selection?.start !== 0 || Math.abs(end - duration) > 0.001) {
      throw new Error("owned_local.selection must cover the exact full file");
    }
    exact(receipt.raw_media?.content_id, contentId, "owned_local.raw_media.content_id");
    if (!Array.isArray(receipt.derived_artifacts) || receipt.derived_artifacts.length === 0) {
      throw new Error("owned_local.derived_artifacts must receipt every derived artifact");
    }
    return {
      kind: "owned_local",
      title: label,
      // Rights ownership is not evidence of authorship or on-screen identity.
      creator: null,
      sourceId: contentId,
      locator: { url: null },
      rights: {
        basis: "ownership_attestation",
        label: `Owned media · ${scope === "redistribution" ? "redistribution authorized" : "local processing only"}`,
        attribution: null,
        scope,
        assertedBy,
      },
      selection: {
        start: 0,
        end: duration,
        duration,
      },
      contentId,
      note: requiredText(receipt.note, "owned_local.note"),
    };
  }

  throw new Error(`source receipt kind ${String(receipt.kind)} has no registered adapter`);
}

/**
 * Bench-only provenance adapter for Standard YouTube Licence media that is held as a local
 * evaluation copy. It is intentionally separate from normalizeSourceReceipt: runtime and demo
 * producers must never interpret this receipt as authority to copy media into a public path.
 */
export function normalizeBenchSourceReceipt(receipt) {
  if (receipt?.kind !== "local_eval_youtube") return normalizeSourceReceipt(receipt);

  exact(receipt.schema, "studio.bench.source.local-eval-youtube.v1", "local_eval_youtube.schema");
  const label = requiredText(receipt.label, "local_eval_youtube.label");
  const channel = requiredText(receipt.channel, "local_eval_youtube.channel");
  const videoId = requiredText(receipt.video_id, "local_eval_youtube.video_id");
  const url = requiredText(receipt.url, "local_eval_youtube.url");
  const parsedUrl = youtubeUrl(url, "local_eval_youtube.url");
  if (youtubeVideoId(parsedUrl) !== videoId) {
    throw new Error("local_eval_youtube.video_id does not match local_eval_youtube.url");
  }
  exact(
    receipt.licence,
    "Standard YouTube licence — local evaluation copy only; NOT redistributable",
    "local_eval_youtube.licence",
  );
  const attribution = requiredText(receipt.attribution, "local_eval_youtube.attribution");
  if (!attribution.includes(channel)) {
    throw new Error("local_eval_youtube.attribution must name local_eval_youtube.channel");
  }
  const duration = positive(receipt.duration, "local_eval_youtube.duration");
  const localPath = scratchPath(receipt.local_copy?.path, "local_eval_youtube.local_copy.path");
  const contentId = requiredText(receipt.local_copy?.content_id, "local_eval_youtube.local_copy.content_id");
  if (!/^sha256:[a-f0-9]{64}$/.test(contentId)) {
    throw new Error("local_eval_youtube.local_copy.content_id must be a SHA-256 content id");
  }
  if (!Number.isSafeInteger(receipt.local_copy?.bytes) || receipt.local_copy.bytes <= 0) {
    throw new Error("local_eval_youtube.local_copy.bytes must be a positive integer");
  }
  exact(receipt.redistribution?.allowed, false, "local_eval_youtube.redistribution.allowed");
  exact(receipt.redistribution?.public_path, null, "local_eval_youtube.redistribution.public_path");
  const note = requiredText(receipt.note, "local_eval_youtube.note");
  if (!/not published with the repo/i.test(note)) {
    throw new Error("local_eval_youtube.note must state that the screen-capture is not published with the repo");
  }

  return {
    kind: "local_eval_youtube",
    title: label,
    creator: channel,
    sourceId: videoId,
    locator: { url },
    rights: {
      basis: "standard_youtube_local_evaluation",
      label: receipt.licence,
      attribution,
      scope: "local_processing",
    },
    selection: {
      start: requiredText(receipt.window?.start, "local_eval_youtube.window.start"),
      end: requiredText(receipt.window?.end, "local_eval_youtube.window.end"),
      duration,
    },
    contentId,
    localPath,
    redistribution: { allowed: false, publicPath: null },
    note,
  };
}

function requiredText(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function positive(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be a positive finite number`);
  }
  return value;
}

function exact(value, expected, path) {
  if (value !== expected) throw new Error(`${path} must equal ${expected}`);
}

function youtubeUrl(value, path) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${path} must be a valid URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    !new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]).has(parsed.hostname)
  ) {
    throw new Error(`${path} must be an HTTPS YouTube URL`);
  }
  return parsed;
}

function youtubeVideoId(url) {
  return url.hostname === "youtu.be" ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v");
}

function scratchPath(value, path) {
  const text = requiredText(value, path).replaceAll("\\", "/");
  if (!text.startsWith(".studio/scratch/") || text.split("/").includes("..")) {
    throw new Error(`${path} must stay under .studio/scratch/`);
  }
  return text;
}
