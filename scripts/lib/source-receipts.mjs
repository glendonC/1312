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
