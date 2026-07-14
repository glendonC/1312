import type {
  LanguageRangesReceipt,
  PreflightBundleV1,
  PreflightBundleV2,
  PreflightBundleV3,
  PreflightSourceBinding,
  SpeechActivityReceipt,
} from "./contracts";
import {
  SPEECH_BINDING_POLICY_FIXTURE,
  SPEECH_RECEIPT_POLICY_FIXTURE,
} from "./checkSpeechReceiptPolicies";
import {
  LANGUAGE_RECEIPT_POLICY_FIXTURE,
  LANGUAGE_SPEECH_POLICY_FIXTURE,
} from "./checkLanguageReceiptPolicies";
import { assertPreflightBundle } from "./preflightBundleValidation";

const RAW_DIGEST = "a".repeat(64);
const SOURCE_DIGEST = "b".repeat(64);
const PROBE_DIGEST = "c".repeat(64);
const NORMALIZED_DIGEST = "d".repeat(64);
const SPEECH_DIGEST = "e".repeat(64);
const V3_NORMALIZED_DIGEST = "6".repeat(64);
const V3_SPEECH_DIGEST = "7".repeat(64);
const LANGUAGE_DIGEST = "8".repeat(64);
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

const BUNDLE_V1: PreflightBundleV1 = {
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

const SPEECH_RECEIPT: SpeechActivityReceipt = {
  ...structuredClone(SPEECH_RECEIPT_POLICY_FIXTURE),
  input: {
    ...structuredClone(SPEECH_RECEIPT_POLICY_FIXTURE.input),
    content_id: RAW_ID,
    bytes: BINDING.raw.bytes,
    media: BINDING.raw.path,
  },
  normalization: {
    ...structuredClone(SPEECH_RECEIPT_POLICY_FIXTURE.normalization),
    artifact: {
      path: "speech-input.pcm",
      content: {
        id: `sha256:${NORMALIZED_DIGEST}`,
        hash: { algorithm: "sha256", digest: NORMALIZED_DIGEST },
        bytes: 2048,
      },
    },
  },
};

const BUNDLE_V2: PreflightBundleV2 = {
  schema: "studio.preflight-bundle.v2",
  producer: "scripts/seal-speech-preflight.mjs",
  preflight_id: `preflight:${RAW_ID}:speech-v1`,
  source: structuredClone(BUNDLE_V1.source),
  artifacts: [
    ...structuredClone(BUNDLE_V1.artifacts),
    {
      artifact_id: "speech-detector-audio",
      kind: "detector_audio",
      class: "derived",
      path: SPEECH_RECEIPT.normalization.artifact.path,
      content: structuredClone(SPEECH_RECEIPT.normalization.artifact.content),
      producer: SPEECH_RECEIPT.producer.implementation,
      source_content_ids: [RAW_ID],
    },
    {
      artifact_id: "speech-activity",
      kind: "speech_activity_receipt",
      class: "receipt",
      path: "speech-activity.json",
      content: {
        id: `sha256:${SPEECH_DIGEST}`,
        hash: { algorithm: "sha256", digest: SPEECH_DIGEST },
        bytes: 8192,
      },
      producer: SPEECH_RECEIPT.producer.implementation,
      source_content_ids: [
        RAW_ID,
        `sha256:${NORMALIZED_DIGEST}`,
        SPEECH_RECEIPT.producer.model.content.id,
      ],
    },
  ],
  findings: {
    container_tracks: "container-probe",
    speech_activity: "speech-activity",
    language_ranges: null,
    acoustic_ranges: null,
    speaker_overlap: null,
    complexity: null,
  },
  note: "Exact content-bound speech preflight fixture; unsupported findings remain withheld.",
};

const SPEECH_RECEIPT_V3: SpeechActivityReceipt = {
  ...structuredClone(LANGUAGE_SPEECH_POLICY_FIXTURE),
  input: {
    ...structuredClone(LANGUAGE_SPEECH_POLICY_FIXTURE.input),
    content_id: RAW_ID,
    bytes: BINDING.raw.bytes,
    media: BINDING.raw.path,
  },
  normalization: {
    ...structuredClone(LANGUAGE_SPEECH_POLICY_FIXTURE.normalization),
    artifact: {
      path: "speech-input.pcm",
      content: {
        id: `sha256:${V3_NORMALIZED_DIGEST}`,
        hash: { algorithm: "sha256", digest: V3_NORMALIZED_DIGEST },
        bytes: 40_000,
      },
    },
  },
};

const LANGUAGE_RECEIPT: LanguageRangesReceipt = {
  ...structuredClone(LANGUAGE_RECEIPT_POLICY_FIXTURE),
  run: SPEECH_RECEIPT_V3.run,
  input: {
    ...structuredClone(LANGUAGE_RECEIPT_POLICY_FIXTURE.input),
    speech_activity: {
      path: "speech-activity.json",
      content: {
        id: `sha256:${V3_SPEECH_DIGEST}`,
        hash: { algorithm: "sha256", digest: V3_SPEECH_DIGEST },
        bytes: 8192,
      },
    },
    normalized_audio: {
      path: "speech-input.pcm",
      content: structuredClone(SPEECH_RECEIPT_V3.normalization.artifact.content),
    },
  },
};

const BUNDLE_V3: PreflightBundleV3 = {
  schema: "studio.preflight-bundle.v3",
  producer: "scripts/seal-language-preflight.mjs",
  preflight_id: `preflight:${RAW_ID}:speech-v1:language-v1`,
  source: structuredClone(BUNDLE_V1.source),
  artifacts: [
    ...structuredClone(BUNDLE_V1.artifacts),
    {
      artifact_id: "speech-detector-audio",
      kind: "detector_audio",
      class: "derived",
      path: "speech-input.pcm",
      content: structuredClone(SPEECH_RECEIPT_V3.normalization.artifact.content),
      producer: SPEECH_RECEIPT_V3.producer.implementation,
      source_content_ids: [RAW_ID],
    },
    {
      artifact_id: "speech-activity",
      kind: "speech_activity_receipt",
      class: "receipt",
      path: "speech-activity.json",
      content: structuredClone(LANGUAGE_RECEIPT.input.speech_activity.content),
      producer: SPEECH_RECEIPT_V3.producer.implementation,
      source_content_ids: [
        RAW_ID,
        `sha256:${V3_NORMALIZED_DIGEST}`,
        SPEECH_RECEIPT_V3.producer.model.content.id,
      ],
    },
    {
      artifact_id: "language-ranges",
      kind: "language_ranges_receipt",
      class: "receipt",
      path: "language-ranges.json",
      content: {
        id: `sha256:${LANGUAGE_DIGEST}`,
        hash: { algorithm: "sha256", digest: LANGUAGE_DIGEST },
        bytes: 65_536,
      },
      producer: LANGUAGE_RECEIPT.producer.implementation,
      source_content_ids: [
        RAW_ID,
        `sha256:${V3_SPEECH_DIGEST}`,
        `sha256:${V3_NORMALIZED_DIGEST}`,
        ...LANGUAGE_RECEIPT.producer.model.files.slice(0, 5).map((file) => file.content.id),
      ],
    },
  ],
  findings: {
    container_tracks: "container-probe",
    speech_activity: "speech-activity",
    language_ranges: "language-ranges",
    acoustic_ranges: null,
    speaker_overlap: null,
    complexity: null,
  },
  note: "Exact language preflight fixture; unsupported detector findings remain unavailable.",
};

type MutableV1 = PreflightBundleV1 & { findings: PreflightBundleV1["findings"] & Record<string, unknown> };
type MutableV2 = PreflightBundleV2 & { findings: PreflightBundleV2["findings"] & Record<string, unknown> };
type MutableV3 = PreflightBundleV3 & { findings: PreflightBundleV3["findings"] & Record<string, unknown> };

function expectFailure(label: string, expected: string, operation: () => void): void {
  let message: string | null = null;
  try {
    operation();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!message?.includes(expected)) {
    throw new Error(`Preflight bundle ${label}: expected ${expected}, received ${message ?? "acceptance"}`);
  }
}

/** Prove every bundle generation rejects unreceipted evidence and broken ordered lineage. */
export function checkPreflightBundlePolicies(): void {
  assertPreflightBundle(BUNDLE_V1, BINDING, "Preflight bundle v1 reference");
  assertPreflightBundle(BUNDLE_V2, BINDING, "Preflight bundle v2 reference", SPEECH_RECEIPT);
  assertPreflightBundle(
    BUNDLE_V3,
    BINDING,
    "Preflight bundle v3 reference",
    SPEECH_RECEIPT_V3,
    LANGUAGE_RECEIPT,
  );

  const v1Cases: Array<{
    label: string;
    expected: string;
    mutate: (bundle: MutableV1) => void;
  }> = [
    {
      label: "v1 unstable identity",
      expected: "bundle.preflight_id must equal",
      mutate: (bundle) => {
        bundle.preflight_id = `preflight:sha256:${"d".repeat(64)}`;
      },
    },
    {
      label: "v1 receipt mismatch",
      expected: "bundle.source.receipt_id must equal",
      mutate: (bundle) => {
        bundle.source.receipt_id = "owned-local:other";
      },
    },
    {
      label: "v1 path traversal",
      expected: "bundle.artifacts[2].path must stay inside the preflight directory",
      mutate: (bundle) => {
        bundle.artifacts[2].path = "../media-probe.json";
      },
    },
    {
      label: "v1 artifact digest mismatch",
      expected: "bundle.artifacts[1].content.id does not match its digest",
      mutate: (bundle) => {
        bundle.artifacts[1].content.id = `sha256:${"d".repeat(64)}`;
      },
    },
    {
      label: "v1 raw source mismatch",
      expected: "bundle.source.raw_artifact_id does not match the receipted raw content",
      mutate: (bundle) => {
        bundle.artifacts[0].content.bytes = 4097;
      },
    },
    {
      label: "v1 missing probe lineage",
      expected: "bundle.findings.container_tracks.source_content_ids must contain exactly",
      mutate: (bundle) => {
        bundle.artifacts[2].source_content_ids = [];
      },
    },
    {
      label: "v1 unregistered language claim",
      expected: "bundle.findings.language_ranges has no registered deterministic producer",
      mutate: (bundle) => {
        (bundle.findings as unknown as Record<string, unknown>).language_ranges = "invented-language-receipt";
      },
    },
    {
      label: "v1 extra finding field",
      expected: "bundle.findings must contain exactly",
      mutate: (bundle) => {
        bundle.findings.music = null;
      },
    },
  ];

  for (const test of v1Cases) {
    const bundle = structuredClone(BUNDLE_V1) as MutableV1;
    test.mutate(bundle);
    expectFailure(test.label, test.expected, () => assertPreflightBundle(bundle, BINDING, `Preflight bundle ${test.label}`));
  }

  expectFailure("v2 missing receipt", "speechActivity is required", () =>
    assertPreflightBundle(BUNDLE_V2, BINDING, "Preflight bundle v2 missing receipt"),
  );

  const v2Cases: Array<{
    label: string;
    expected: string;
    mutate: (bundle: MutableV2, receipt: SpeechActivityReceipt) => void;
  }> = [
    {
      label: "v2 unknown root key",
      expected: "bundle must contain exactly",
      mutate: (bundle) => {
        (bundle as unknown as Record<string, unknown>).estimate = 0;
      },
    },
    {
      label: "v2 missing finding key",
      expected: "bundle.findings must contain exactly",
      mutate: (bundle) => {
        delete (bundle.findings as unknown as Record<string, unknown>).complexity;
      },
    },
    {
      label: "v2 wrong producer",
      expected: "bundle.producer must equal scripts/seal-speech-preflight.mjs",
      mutate: (bundle) => {
        bundle.producer = "scripts/preflight-owned-media.mjs" as "scripts/seal-speech-preflight.mjs";
      },
    },
    {
      label: "v2 missing artifact",
      expected: "must contain the exact raw, source, media-probe, detector-audio, and speech-activity artifacts",
      mutate: (bundle) => {
        bundle.artifacts.pop();
      },
    },
    {
      label: "v2 invalid detector class",
      expected: "must equal derived for artifact kind detector_audio",
      mutate: (bundle) => {
        bundle.artifacts[3].class = "receipt";
      },
    },
    {
      label: "v2 normalized content mismatch",
      expected: "does not match the normalized detector audio receipt",
      mutate: (bundle) => {
        const digest = "f".repeat(64);
        bundle.artifacts[3].content.id = `sha256:${digest}`;
        bundle.artifacts[3].content.hash.digest = digest;
      },
    },
    {
      label: "v2 normalized producer mismatch",
      expected: "does not match the normalized detector audio receipt",
      mutate: (bundle) => {
        bundle.artifacts[3].producer = "ffmpeg";
      },
    },
    {
      label: "v2 normalized lineage mismatch",
      expected: "bundle.artifacts.speech-detector-audio.source_content_ids must contain exactly",
      mutate: (bundle) => {
        bundle.artifacts[3].source_content_ids = [];
      },
    },
    {
      label: "v2 receipt producer mismatch",
      expected: "does not match the registered speech-activity receipt artifact",
      mutate: (bundle) => {
        bundle.artifacts[4].producer = "silero-vad";
      },
    },
    {
      label: "v2 receipt lineage order",
      expected: "bundle.findings.speech_activity.source_content_ids must contain exactly",
      mutate: (bundle) => {
        bundle.artifacts[4].source_content_ids.reverse();
      },
    },
    {
      label: "v2 receipt model lineage mismatch",
      expected: "bundle.findings.speech_activity.source_content_ids must contain exactly",
      mutate: (bundle) => {
        bundle.artifacts[4].source_content_ids[2] = `sha256:${"f".repeat(64)}`;
      },
    },
    {
      label: "v2 finding reference mismatch",
      expected: "bundle.findings.speech_activity must equal speech-activity",
      mutate: (bundle) => {
        bundle.findings.speech_activity = "speech-detector-audio";
      },
    },
    {
      label: "v2 unsupported language",
      expected: "bundle.findings.language_ranges has no registered deterministic producer",
      mutate: (bundle) => {
        (bundle.findings as unknown as Record<string, unknown>).language_ranges = "language";
      },
    },
    {
      label: "v2 receipt raw mismatch",
      expected: "speechActivity.input does not match the receipted raw media",
      mutate: (_bundle, receipt) => {
        receipt.input.bytes += 1;
      },
    },
  ];

  for (const test of v2Cases) {
    const bundle = structuredClone(BUNDLE_V2) as MutableV2;
    const receipt = structuredClone(SPEECH_RECEIPT);
    test.mutate(bundle, receipt);
    expectFailure(test.label, test.expected, () =>
      assertPreflightBundle(bundle, BINDING, `Preflight bundle ${test.label}`, receipt),
    );
  }

  expectFailure("v1 detector pairing", "detectorReceipts require studio.preflight-bundle.v2 or v3", () =>
    assertPreflightBundle(BUNDLE_V1, BINDING, "Preflight bundle v1 language receipt", undefined, LANGUAGE_RECEIPT),
  );
  expectFailure("v2 language pairing", "languageRanges requires studio.preflight-bundle.v3", () =>
    assertPreflightBundle(BUNDLE_V2, BINDING, "Preflight bundle v2 language receipt", SPEECH_RECEIPT, LANGUAGE_RECEIPT),
  );
  expectFailure("v3 missing speech receipt", "speechActivity is required", () =>
    assertPreflightBundle(BUNDLE_V3, BINDING, "Preflight bundle v3 missing speech", undefined, LANGUAGE_RECEIPT),
  );
  expectFailure("v3 missing language receipt", "languageRanges is required", () =>
    assertPreflightBundle(BUNDLE_V3, BINDING, "Preflight bundle v3 missing language", SPEECH_RECEIPT_V3),
  );

  const v3Cases: Array<{
    label: string;
    expected: string;
    mutate: (bundle: MutableV3, speech: SpeechActivityReceipt, language: LanguageRangesReceipt) => void;
  }> = [
    {
      label: "v3 wrong producer",
      expected: "bundle.producer must equal scripts/seal-language-preflight.mjs",
      mutate: (bundle) => { bundle.producer = "scripts/seal-speech-preflight.mjs" as "scripts/seal-language-preflight.mjs"; },
    },
    {
      label: "v3 unstable identity",
      expected: "bundle.preflight_id must equal",
      mutate: (bundle) => { bundle.preflight_id = `preflight:${RAW_ID}:language-v1`; },
    },
    {
      label: "v3 missing artifact",
      expected: "must contain the exact raw, source, media-probe, detector-audio, speech-activity, and language-ranges artifacts",
      mutate: (bundle) => { bundle.artifacts.pop(); },
    },
    {
      label: "v3 language kind",
      expected: "bundle.findings.language_ranges must reference a language_ranges_receipt artifact",
      mutate: (bundle) => { bundle.artifacts[5].kind = "speech_activity_receipt"; },
    },
    {
      label: "v3 artifact order",
      expected: "must use the exact ordered v3 artifact ids",
      mutate: (bundle) => { [bundle.artifacts[4], bundle.artifacts[5]] = [bundle.artifacts[5], bundle.artifacts[4]]; },
    },
    {
      label: "v3 language producer",
      expected: "does not match the registered language-ranges receipt artifact",
      mutate: (bundle) => { bundle.artifacts[5].producer = "whisper-language-id"; },
    },
    {
      label: "v3 language finding",
      expected: "bundle.findings.language_ranges must equal language-ranges",
      mutate: (bundle) => { bundle.findings.language_ranges = "speech-activity"; },
    },
    {
      label: "v3 speech receipt hash binding",
      expected: "languageRanges.input does not match the indexed speech receipt and normalized audio",
      mutate: (_bundle, _speech, language) => { language.input.speech_activity.content.bytes += 1; },
    },
    {
      label: "v3 normalized audio binding",
      expected: "languageRanges.input does not match the indexed speech receipt and normalized audio",
      mutate: (_bundle, _speech, language) => { language.input.normalized_audio.content.bytes += 2; },
    },
    {
      label: "v3 receipt lineage order",
      expected: "bundle.findings.language_ranges.source_content_ids must contain exactly",
      mutate: (bundle) => { bundle.artifacts[5].source_content_ids.reverse(); },
    },
    {
      label: "v3 receipt model lineage",
      expected: "bundle.findings.language_ranges.source_content_ids must contain exactly",
      mutate: (bundle) => { bundle.artifacts[5].source_content_ids[3] = `sha256:${"9".repeat(64)}`; },
    },
    {
      label: "v3 unsupported acoustic finding",
      expected: "bundle.findings.acoustic_ranges has no registered deterministic producer",
      mutate: (bundle) => { (bundle.findings as Record<string, unknown>).acoustic_ranges = "invented"; },
    },
    {
      label: "v3 receipt identity",
      expected: "languageRanges.producer is not the registered language-ranges receipt",
      mutate: (_bundle, _speech, language) => { language.producer.version = "latest" as "1.0.0"; },
    },
  ];

  for (const test of v3Cases) {
    const bundle = structuredClone(BUNDLE_V3) as MutableV3;
    const speech = structuredClone(SPEECH_RECEIPT_V3);
    const language = structuredClone(LANGUAGE_RECEIPT);
    test.mutate(bundle, speech, language);
    expectFailure(test.label, test.expected, () =>
      assertPreflightBundle(bundle, BINDING, `Preflight bundle ${test.label}`, speech, language),
    );
  }

  // Keep the exported speech fixture independently bound to the same raw content as this policy.
  if (SPEECH_BINDING_POLICY_FIXTURE.raw.contentId !== BINDING.raw.contentId) {
    throw new Error("Speech and preflight policy fixtures must retain the same raw content identity");
  }
}
