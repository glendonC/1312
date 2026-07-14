import type { PreflightBundle, PreflightSourceBinding } from "./contracts";
import { assertPreflightBundle } from "./preflightBundleValidation";

const RAW_DIGEST = "a".repeat(64);
const SOURCE_DIGEST = "b".repeat(64);
const PROBE_DIGEST = "c".repeat(64);
const RAW_ID = `sha256:${RAW_DIGEST}`;

const BINDING: PreflightSourceBinding = {
  receiptId: `owned-local:${RAW_DIGEST}`,
  receiptProducer: "scripts/ingest-owned-media.mjs",
  receiptPath: "source.json",
  raw: {
    path: "raw-fixture.mov",
    contentId: RAW_ID,
    bytes: 4096,
    producer: "scripts/ingest-owned-media.mjs",
  },
  mediaProbe: {
    path: "media-probe.json",
    contentId: `sha256:${PROBE_DIGEST}`,
    producer: "scripts/probe-media.mjs",
  },
};

const BUNDLE: PreflightBundle = {
  schema: "studio.preflight-bundle.v1",
  producer: "scripts/preflight-owned-media.mjs",
  preflight_id: `preflight:${RAW_ID}`,
  source: {
    receipt_id: BINDING.receiptId,
    receipt_artifact_id: "source-receipt",
    raw_artifact_id: "raw-media",
  },
  artifacts: [
    {
      artifact_id: "raw-media",
      kind: "raw_media",
      class: "raw",
      path: BINDING.raw.path,
      content: { id: RAW_ID, hash: { algorithm: "sha256", digest: RAW_DIGEST }, bytes: 4096 },
      producer: BINDING.raw.producer,
      source_content_ids: [],
    },
    {
      artifact_id: "source-receipt",
      kind: "source_receipt",
      class: "receipt",
      path: "source.json",
      content: {
        id: `sha256:${SOURCE_DIGEST}`,
        hash: { algorithm: "sha256", digest: SOURCE_DIGEST },
        bytes: 2048,
      },
      producer: BINDING.receiptProducer,
      source_content_ids: [RAW_ID],
    },
    {
      artifact_id: "container-probe",
      kind: "media_probe_receipt",
      class: "receipt",
      path: "media-probe.json",
      content: {
        id: `sha256:${PROBE_DIGEST}`,
        hash: { algorithm: "sha256", digest: PROBE_DIGEST },
        bytes: 1024,
      },
      producer: BINDING.mediaProbe.producer,
      source_content_ids: [RAW_ID],
    },
  ],
  findings: {
    container_tracks: "container-probe",
    speech_activity: null,
    language_ranges: null,
    acoustic_ranges: null,
    speaker_overlap: null,
    complexity: null,
  },
  note: "Exact content-bound standalone preflight fixture with detector findings withheld.",
};

interface MutableBundle extends Omit<PreflightBundle, "findings"> {
  findings: Record<string, unknown> & PreflightBundle["findings"];
}

/** Prove the standalone index rejects unreceipted artifacts and unsupported findings. */
export function checkPreflightBundlePolicies(): void {
  assertPreflightBundle(BUNDLE, BINDING, "Preflight bundle reference");

  const cases: Array<{
    label: string;
    expected: string;
    mutate: (bundle: MutableBundle) => void;
  }> = [
    {
      label: "unstable identity",
      expected: "bundle.preflight_id must equal",
      mutate: (bundle) => {
        bundle.preflight_id = `preflight:sha256:${"d".repeat(64)}`;
      },
    },
    {
      label: "receipt mismatch",
      expected: "bundle.source.receipt_id must equal",
      mutate: (bundle) => {
        bundle.source.receipt_id = "owned-local:other";
      },
    },
    {
      label: "path traversal",
      expected: "bundle.artifacts[2].path must stay inside the preflight directory",
      mutate: (bundle) => {
        bundle.artifacts[2].path = "../media-probe.json";
      },
    },
    {
      label: "artifact digest mismatch",
      expected: "bundle.artifacts[1].content.id does not match its digest",
      mutate: (bundle) => {
        bundle.artifacts[1].content.id = `sha256:${"d".repeat(64)}`;
      },
    },
    {
      label: "raw source mismatch",
      expected: "bundle.source.raw_artifact_id does not match the receipted raw content",
      mutate: (bundle) => {
        bundle.artifacts[0].content.bytes = 4097;
      },
    },
    {
      label: "missing probe lineage",
      expected: "bundle.findings.container_tracks.source_content_ids must contain exactly",
      mutate: (bundle) => {
        bundle.artifacts[2].source_content_ids = [];
      },
    },
    {
      label: "unregistered language claim",
      expected: "bundle.findings.language_ranges has no registered deterministic producer",
      mutate: (bundle) => {
        bundle.findings.language_ranges = "invented-language-receipt" as never;
      },
    },
    {
      label: "extra finding field",
      expected: "bundle.findings must contain exactly",
      mutate: (bundle) => {
        bundle.findings.music = null;
      },
    },
  ];

  for (const test of cases) {
    const bundle = structuredClone(BUNDLE) as MutableBundle;
    test.mutate(bundle);
    let message: string | null = null;
    try {
      assertPreflightBundle(bundle, BINDING, `Preflight bundle ${test.label}`);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (!message?.includes(test.expected)) {
      throw new Error(`Preflight bundle ${test.label}: expected ${test.expected}, received ${message ?? "acceptance"}`);
    }
  }
}
