import type { MediaProbeReceipt, OwnedLocalIngestReceipt } from "../types";
import { assertSourceReceipts, type SourceReceiptContext } from "./receiptValidation";

const RAW_DIGEST = "a".repeat(64);
const RAW_ID = `sha256:${RAW_DIGEST}`;

const SOURCE: SourceReceiptContext = {
  runId: "owned-local-fixture",
  duration: 12.5,
  media: "raw-fixture.mov",
  source: { kind: "owned_local", label: "Owned local fixture", note: "Exact validation fixture." },
};

const PROBE: MediaProbeReceipt = {
  schema: "studio.media-probe.v1",
  producer: "scripts/probe-media.mjs",
  run: SOURCE.runId,
  media: SOURCE.media as string,
  input: {
    content_id: RAW_ID,
    hash: { algorithm: "sha256", digest: RAW_DIGEST },
    bytes: 4096,
  },
  duration: SOURCE.duration,
  container: ["mov", "mp4"],
  container_long_name: "QuickTime / MOV",
  bit_rate: 2621,
  tracks: [{ index: 0, type: "audio", codec: "aac", duration: 12.5, sample_rate: 16000, channels: 1 }],
};

const RECEIPT: OwnedLocalIngestReceipt = {
  schema: "studio.ingest.owned-local.v1",
  kind: "owned_local",
  producer: "scripts/ingest-owned-media.mjs",
  receipt_id: `owned-local:${RAW_DIGEST}`,
  label: "Explicit fixture label",
  origin: { kind: "local_file", filename: "misleading-name-ko-music-person.mov", path_disclosure: "basename_only" },
  content: {
    id: RAW_ID,
    hash: { algorithm: "sha256", digest: RAW_DIGEST },
    bytes: 4096,
  },
  rights: {
    basis: "ownership_attestation",
    asserted_by: "Fixture owner",
    asserted_at: "2026-07-13T00:00:00.000Z",
    scope: "local_processing",
    statement: "Fixture owner attests that it owns or controls the media rights and authorizes local processing of this copy.",
  },
  selection: { start: 0, end: 12.5, duration: 12.5 },
  raw_media: {
    path: "raw-fixture.mov",
    content_id: RAW_ID,
    bytes: 4096,
    preservation: "byte_identical_copy",
  },
  derived_artifacts: [
    {
      kind: "media_probe",
      path: "media-probe.json",
      schema: "studio.media-probe.v1",
      producer: "scripts/probe-media.mjs",
      source_content_ids: [RAW_ID],
      content_hash: `sha256:${"b".repeat(64)}`,
    },
  ],
  note: "Exact producer-backed fixture; the filename supplies no measured or asserted fact.",
};

/** Prove the owned/local receipt boundary rejects each missing or contradictory producer fact. */
export function checkSourceReceiptPolicies(): void {
  assertSourceReceipts(RECEIPT, PROBE, SOURCE, "Owned local receipt reference");

  try {
    assertSourceReceipts({ kind: "local_file" }, PROBE, SOURCE, "Unregistered source receipt");
    throw new Error("unregistered receipt was accepted");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("ingestReceipt.kind has no registered producer for local_file")) {
      throw new Error(`Unregistered source receipt returned an unexpected failure: ${message}`);
    }
  }

  const cases: Array<{
    label: string;
    expected: string;
    mutate: (receipt: OwnedLocalIngestReceipt, probe: MediaProbeReceipt | null) => MediaProbeReceipt | null;
  }> = [
    {
      label: "missing ownership attestation",
      expected: "ingestReceipt.rights.statement must carry the explicit ownership attestation",
      mutate: (receipt, probe) => {
        receipt.rights.statement = "Permission assumed.";
        return probe;
      },
    },
    {
      label: "unstable content identity",
      expected: "ingestReceipt.content.id does not match its digest",
      mutate: (receipt, probe) => {
        receipt.content.id = `sha256:${"c".repeat(64)}`;
        return probe;
      },
    },
    {
      label: "raw provenance mismatch",
      expected: "ingestReceipt.raw_media.content_id does not match the source content id",
      mutate: (receipt, probe) => {
        receipt.raw_media.content_id = `sha256:${"c".repeat(64)}`;
        return probe;
      },
    },
    {
      label: "missing deterministic media probe",
      expected: "mediaProbe is required for owned local media",
      mutate: (_receipt, _probe) => null,
    },
    {
      label: "probe bound to other bytes",
      expected: "mediaProbe.input does not match the owned raw media receipt",
      mutate: (_receipt, probe) => {
        if (!probe) throw new Error("reference probe missing");
        const digest = "c".repeat(64);
        probe.input.content_id = `sha256:${digest}`;
        probe.input.hash.digest = digest;
        return probe;
      },
    },
    {
      label: "derived artifact without raw lineage",
      expected: "ingestReceipt.derived_artifacts[0].source_content_ids must name only the raw source content id",
      mutate: (receipt, probe) => {
        receipt.derived_artifacts[0].source_content_ids = [];
        return probe;
      },
    },
  ];

  for (const test of cases) {
    const receipt = structuredClone(RECEIPT);
    const probe = test.mutate(receipt, structuredClone(PROBE));
    let message: string | null = null;
    try {
      assertSourceReceipts(receipt, probe, SOURCE, `Owned local receipt ${test.label}`);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message?.includes(test.expected)) {
      throw new Error(`Owned local receipt policy ${test.label}: expected ${test.expected}, received ${message ?? "acceptance"}`);
    }
  }
}
