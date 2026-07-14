import type { MediaProbeReceipt } from "../types";
import type {
  LanguageRangeDecision,
  LanguageRangeScore,
  LanguageRangesReceipt,
  PreflightSourceBinding,
  Sha256Content,
  SpeechActivityReceipt,
} from "./contracts";
import {
  SPEECH_BINDING_POLICY_FIXTURE,
  SPEECH_MEDIA_PROBE_POLICY_FIXTURE,
  SPEECH_RECEIPT_POLICY_FIXTURE,
} from "./checkSpeechReceiptPolicies";
import { assertLanguageRangesReceipt, LANGUAGE_MODEL_ROOT } from "./languageReceiptValidation";

const MODEL_FILE_PINS = [
  ["encoder", "encoder_model_quantized.onnx", "fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e", 10_124_910],
  ["decoder", "decoder_model_merged_quantized.onnx", "6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0", 30_727_765],
  ["model_config", "config.json", "2b2e4e519084e0ea028b19b153f95202735a971870d6844aa26e559edd292e94", 2_248],
  ["generation_config", "generation_config.json", "68ac791fcb4999461a313472125042934656240ba1cba7d1c2627fcbb19ac24c", 3_716],
  ["preprocessor_config", "preprocessor_config.json", "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d", 339],
  ["license_evidence", "MODEL_CARD.md", "cdd395427d195f122aee69c00e34183f2fadd8bc217aef35ca7c43395b96d29d", 1_160],
  ["upstream_license", "LICENSE.openai-whisper", "b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d", 1_063],
] as const;
const LANGUAGE_CODES = "en,zh,de,es,ru,ko,fr,ja,pt,tr,pl,ca,nl,ar,sv,it,id,hi,fi,vi,he,uk,el,ms,cs,ro,da,hu,ta,no,th,ur,hr,bg,lt,la,mi,ml,cy,sk,te,fa,lv,bn,sr,az,sl,kn,et,mk,br,eu,is,hy,ne,mn,bs,kk,sq,sw,gl,mr,pa,si,km,sn,yo,so,af,oc,ka,be,tg,sd,gu,am,yi,lo,uz,fo,ht,ps,tk,nn,mt,sa,lb,my,bo,tl,mg,as,tt,haw,ln,ha,ba,jw,su".split(",");

function identity(digest: string, bytes: number): Sha256Content {
  return { id: `sha256:${digest}`, hash: { algorithm: "sha256", digest }, bytes };
}

function scoresWithTop(topIndex: number | null): LanguageRangeScore[] {
  const logits = LANGUAGE_CODES.map((_code, index) => topIndex === index ? 5 : 0);
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const denominator = exponentials.reduce((sum, value) => sum + value, 0);
  return LANGUAGE_CODES.map((code, index) => ({
    code,
    token_id: 50_259 + index,
    logit: logits[index],
    probability: Number((exponentials[index] / denominator).toFixed(8)),
  }));
}

function expectedDecision(scores: LanguageRangeScore[]): LanguageRangeDecision {
  const ranked = [...scores].sort(
    (left, right) => right.probability - left.probability || left.token_id - right.token_id,
  );
  const probability = ranked[0].probability;
  const margin = Number((probability - ranked[1].probability).toFixed(8));
  if (probability >= 0.5 && margin >= 0.15) {
    return {
      status: "classified",
      code: ranked[0].code,
      token_id: ranked[0].token_id,
      probability,
      margin,
      reason: null,
    };
  }
  return {
    status: "unknown",
    code: null,
    token_id: null,
    probability,
    margin,
    reason: probability < 0.5 && margin < 0.15
      ? "below_probability_and_margin"
      : probability < 0.5
        ? "below_probability"
        : "below_margin",
  };
}

function measuredSpeechFixture(sampleCount: number): SpeechActivityReceipt {
  const speech = structuredClone(SPEECH_RECEIPT_POLICY_FIXTURE);
  speech.normalization.sample_count = sampleCount;
  speech.normalization.artifact.content = identity("b".repeat(64), sampleCount * 2);
  speech.frames = Array.from({ length: Math.ceil(sampleCount / 512) }, (_unused, index) => ({
    start_sample: index * 512,
    end_sample: Math.min((index + 1) * 512, sampleCount),
    probability: 0.9,
  }));
  speech.speech_windows = [{ start_sample: 0, end_sample: sampleCount }];
  speech.non_speech_windows = [];
  speech.note = "Deterministic all-speech policy fixture.";
  return speech;
}

function probeFixture(sampleCount: number): MediaProbeReceipt {
  const probe = structuredClone(SPEECH_MEDIA_PROBE_POLICY_FIXTURE);
  const duration = sampleCount / 16_000;
  probe.duration = duration;
  probe.tracks[0].duration = duration;
  return probe;
}

function receiptFixture(
  speech: SpeechActivityReceipt,
  topIndex: number | null,
): LanguageRangesReceipt {
  const ranges = speech.speech_windows.flatMap((window, speechWindowIndex) => {
    const chunks = [];
    let start = window.start_sample;
    let chunkIndex = 0;
    while (start < window.end_sample) {
      const end = Math.min(start + 480_000, window.end_sample);
      const scores = end - start < 16_000 ? [] : scoresWithTop(topIndex);
      const decision: LanguageRangeDecision = scores.length === 0
        ? {
            status: "withheld",
            code: null,
            token_id: null,
            probability: null,
            margin: null,
            reason: "insufficient_samples",
          }
        : expectedDecision(scores);
      chunks.push({
        speech_window_index: speechWindowIndex,
        chunk_index: chunkIndex,
        start_sample: start,
        end_sample: end,
        scores,
        decision,
      });
      start = end;
      chunkIndex += 1;
    }
    return chunks;
  });
  return {
    schema: "studio.language-ranges.v1",
    producer: {
      id: "whisper-language-id",
      version: "1.0.0",
      implementation: "scripts/detect-language.mjs",
      model: {
        id: "Xenova/whisper-tiny",
        revision: "5332fcc35e32a33b86612b9a57a89be7906102b1",
        base_model: "openai/whisper-tiny",
        quantization: "q8",
        license: "Apache-2.0",
        upstream_license: "MIT",
        files: MODEL_FILE_PINS.map(([role, filename, digest, bytes]) => ({
          role,
          path: `${LANGUAGE_MODEL_ROOT}${filename}`,
          content: identity(digest, bytes),
        })),
      },
      runtime: {
        id: "@huggingface/transformers",
        version: "4.2.0",
        revision: "54652ba3366ccd1e3b64e689a96504309e6fb53b",
        license: "Apache-2.0",
        package: {
          manifest: {
            path: "node_modules/@huggingface/transformers/package.json",
            content: identity("9cf12901d934e5a0628c6f163484abade392ab2d3b369d458ed3dfdeaa7f9a39", 2_673),
          },
          entry: {
            path: "node_modules/@huggingface/transformers/dist/transformers.node.mjs",
            content: identity("4932ec78a6b136d97d09a12093afb476530d9aa099dbaf1f9822ad56bfe2bc3d", 1_256_499),
          },
          license: {
            path: `${LANGUAGE_MODEL_ROOT}LICENSE.transformers-js`,
            content: identity("cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30", 11_358),
          },
        },
        engine: {
          id: "onnxruntime-node",
          version: "1.24.3",
          execution_provider: "cpu",
          execution_mode: "sequential",
          graph_optimization_level: "all",
          intra_op_threads: 1,
          inter_op_threads: 1,
          binary: {
            path: "node_modules/@huggingface/transformers/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node",
            content: identity("d".repeat(64), 1024),
          },
        },
        platform: { os: "darwin", arch: "arm64", node: "v24.0.0" },
      },
    },
    run: speech.run,
    input: {
      speech_activity: { path: "speech-activity.json", content: identity("f".repeat(64), 8192) },
      normalized_audio: {
        path: "speech-input.pcm",
        content: structuredClone(speech.normalization.artifact.content),
      },
      sample_rate_hz: 16_000,
      sample_count: speech.normalization.sample_count,
    },
    configuration: {
      max_chunk_samples: 480_000,
      min_chunk_samples: 16_000,
      min_probability: 0.5,
      min_margin: 0.15,
      rounding_digits: 8,
      tie_break: "lowest_token_id",
      window_source: "speech_windows",
    },
    languages: LANGUAGE_CODES.map((code, index) => ({ code, token_id: 50_259 + index })),
    ranges,
    note: "Policy fixture with complete receipted language scores or an explicit withheld decision.",
  };
}

export const LANGUAGE_BINDING_POLICY_FIXTURE: PreflightSourceBinding = structuredClone(SPEECH_BINDING_POLICY_FIXTURE);
export const LANGUAGE_SPEECH_POLICY_FIXTURE = measuredSpeechFixture(20_000);
export const LANGUAGE_MEDIA_PROBE_POLICY_FIXTURE = probeFixture(20_000);
export const LANGUAGE_RECEIPT_POLICY_FIXTURE = receiptFixture(LANGUAGE_SPEECH_POLICY_FIXTURE, 5);

type MutableReceipt = LanguageRangesReceipt & Record<string, unknown>;

function expectFailure(label: string, expected: string, operation: () => void): void {
  let message: string | null = null;
  try {
    operation();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!message?.includes(expected)) {
    throw new Error(`Language receipt ${label}: expected ${expected}, received ${message ?? "acceptance"}`);
  }
}

/** Prove language evidence is pinned, fully scored, range-bound, and never guessed when unavailable. */
export function checkLanguageReceiptPolicies(): void {
  assertLanguageRangesReceipt(
    LANGUAGE_RECEIPT_POLICY_FIXTURE,
    LANGUAGE_BINDING_POLICY_FIXTURE,
    LANGUAGE_MEDIA_PROBE_POLICY_FIXTURE,
    LANGUAGE_SPEECH_POLICY_FIXTURE,
    "Language receipt classified reference",
  );

  const unknown = receiptFixture(LANGUAGE_SPEECH_POLICY_FIXTURE, null);
  assertLanguageRangesReceipt(
    unknown,
    LANGUAGE_BINDING_POLICY_FIXTURE,
    LANGUAGE_MEDIA_PROBE_POLICY_FIXTURE,
    LANGUAGE_SPEECH_POLICY_FIXTURE,
    "Language receipt unknown reference",
  );

  const shortSpeech = measuredSpeechFixture(10_000);
  const shortProbe = probeFixture(10_000);
  const withheld = receiptFixture(shortSpeech, null);
  assertLanguageRangesReceipt(
    withheld,
    LANGUAGE_BINDING_POLICY_FIXTURE,
    shortProbe,
    shortSpeech,
    "Language receipt withheld reference",
  );

  const splitSpeech = measuredSpeechFixture(490_000);
  const splitProbe = probeFixture(490_000);
  const split = receiptFixture(splitSpeech, 5);
  assertLanguageRangesReceipt(
    split,
    LANGUAGE_BINDING_POLICY_FIXTURE,
    splitProbe,
    splitSpeech,
    "Language receipt maximum-chunk reference",
  );

  const cases: Array<{
    label: string;
    expected: string;
    mutate: (receipt: MutableReceipt, speech: SpeechActivityReceipt, probe: MediaProbeReceipt) => void;
  }> = [
    {
      label: "unknown root key",
      expected: "receipt must contain exactly",
      mutate: (receipt) => { receipt.confidence = 1; },
    },
    {
      label: "invalid producer",
      expected: "receipt.producer.id must equal whisper-language-id",
      mutate: (receipt) => { receipt.producer.id = "guessed-language" as "whisper-language-id"; },
    },
    {
      label: "model file order",
      expected: "receipt.producer.model.files[0].role must equal encoder",
      mutate: (receipt) => { receipt.producer.model.files.reverse(); },
    },
    {
      label: "model file hash",
      expected: "does not match the pinned producer file identity",
      mutate: (receipt) => {
        const digest = "0".repeat(64);
        receipt.producer.model.files[0].content = identity(digest, 10_124_910);
      },
    },
    {
      label: "runtime version",
      expected: "receipt.producer.runtime.version must equal 4.2.0",
      mutate: (receipt) => { receipt.producer.runtime.version = "latest" as "4.2.0"; },
    },
    {
      label: "runtime graph optimization",
      expected: "receipt.producer.runtime.engine.graph_optimization_level must equal all",
      mutate: (receipt) => {
        receipt.producer.runtime.engine.graph_optimization_level = "disabled" as "all";
      },
    },
    {
      label: "runtime binary path",
      expected: "receipt.producer.runtime.engine.binary.path must equal",
      mutate: (receipt) => { receipt.producer.runtime.engine.binary.path = "runtime.node"; },
    },
    {
      label: "probe raw mismatch",
      expected: "mediaProbe does not match the receipted raw media",
      mutate: (_receipt, _speech, probe) => { probe.input.bytes += 1; },
    },
    {
      label: "speech raw mismatch",
      expected: "speechActivity.input does not match the receipted raw media",
      mutate: (_receipt, speech) => { speech.input.bytes += 1; },
    },
    {
      label: "normalized audio mismatch",
      expected: "does not match the speech detector PCM",
      mutate: (receipt) => { receipt.input.normalized_audio.content.bytes += 2; },
    },
    {
      label: "configuration drift",
      expected: "receipt.configuration.max_chunk_samples must equal 480000",
      mutate: (receipt) => { receipt.configuration.max_chunk_samples = 30_000 as 480000; },
    },
    {
      label: "missing language token",
      expected: "must contain the exact ordered 99-language token set",
      mutate: (receipt) => { receipt.languages.pop(); },
    },
    {
      label: "language token order",
      expected: "receipt.languages[0].code must equal en",
      mutate: (receipt) => { receipt.languages.reverse(); },
    },
    {
      label: "missing range",
      expected: "must exactly partition every receipted speech window",
      mutate: (receipt) => { receipt.ranges = []; },
    },
    {
      label: "range boundary drift",
      expected: "receipt.ranges[0].end_sample must equal 20000",
      mutate: (receipt) => { receipt.ranges[0].end_sample -= 1; },
    },
    {
      label: "score order",
      expected: "receipt.ranges[0].scores[0].code must equal en",
      mutate: (receipt) => { receipt.ranges[0].scores.reverse(); },
    },
    {
      label: "probability not derived from logit",
      expected: "must equal the 8-decimal softmax probability",
      mutate: (receipt) => { receipt.ranges[0].scores[0].probability += 0.00000001; },
    },
    {
      label: "decision drift",
      expected: "receipt.ranges[0].decision.code must equal ko",
      mutate: (receipt) => { receipt.ranges[0].decision.code = "en"; },
    },
  ];

  for (const test of cases) {
    const receipt = structuredClone(LANGUAGE_RECEIPT_POLICY_FIXTURE) as MutableReceipt;
    const speech = structuredClone(LANGUAGE_SPEECH_POLICY_FIXTURE);
    const probe = structuredClone(LANGUAGE_MEDIA_PROBE_POLICY_FIXTURE);
    test.mutate(receipt, speech, probe);
    expectFailure(test.label, test.expected, () =>
      assertLanguageRangesReceipt(receipt, LANGUAGE_BINDING_POLICY_FIXTURE, probe, speech, `Language receipt ${test.label}`),
    );
  }

  const inventedShortScores = structuredClone(withheld);
  inventedShortScores.ranges[0].scores = scoresWithTop(5);
  expectFailure("short chunk scores", "must be empty for a withheld short chunk", () =>
    assertLanguageRangesReceipt(inventedShortScores, LANGUAGE_BINDING_POLICY_FIXTURE, shortProbe, shortSpeech),
  );

  const hiddenMeasuredScores = structuredClone(LANGUAGE_RECEIPT_POLICY_FIXTURE);
  hiddenMeasuredScores.ranges[0].scores = [];
  expectFailure("measured chunk withheld scores", "must contain all 99 ordered language scores", () =>
    assertLanguageRangesReceipt(
      hiddenMeasuredScores,
      LANGUAGE_BINDING_POLICY_FIXTURE,
      LANGUAGE_MEDIA_PROBE_POLICY_FIXTURE,
      LANGUAGE_SPEECH_POLICY_FIXTURE,
    ),
  );
}
