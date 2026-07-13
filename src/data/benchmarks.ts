export type MetricPriority = "headline" | "diagnostic" | "research-only" | "omit";
export type EvaluationMode = "automated" | "human" | "hybrid";
export type SupportState = "missing" | "planned" | "sample-only" | "ready";

export interface ReferenceLink {
  label: string;
  url: string;
}

export interface MetricDefinition {
  id: string;
  label: string;
  priority: MetricPriority;
  question: string;
  layer: string;
  evaluation: EvaluationMode;
  requiredData: string;
  support: SupportState;
  field: string;
  limitation: string;
  reference?: ReferenceLink;
}

export interface AnnotationRequirement {
  id: string;
  label: string;
  purpose: string;
  requiredFields: string;
  futurePath: string;
  status: "missing" | "partial-demo";
}

export const benchmarkCopy = {
  name: "Hard-KO Clip Pack v1",
  hypothesis:
    "On the same frozen Korean media, a prepared 1321 workflow should preserve more critical meaning than the same stack run cold and a dated YouTube auto-translation capture.",
  evidenceBoundary:
    "This page currently describes the protocol and data contract. It does not contain benchmark results.",
  demoBoundary:
    "The scored Studio replay is a synthetic, planted-error interface fixture. It is not a clip, run, or score in this pack.",
  publicationRule:
    "No ranks, deltas, or performance claims until real clips, frozen gold, raw system outputs, and reviewer labels exist.",
} as const;

export const supportLabels: Record<SupportState, string> = {
  missing: "Missing",
  planned: "Planned",
  "sample-only": "Sample shape",
  ready: "Ready",
};

export const evaluationLabels: Record<EvaluationMode, string> = {
  automated: "Automated",
  human: "Human",
  hybrid: "Hybrid",
};

export const priorityLabels: Record<MetricPriority, string> = {
  headline: "Headline",
  diagnostic: "Diagnostic",
  "research-only": "Research only",
  omit: "Omit",
};

const headlineMetrics: MetricDefinition[] = [
  {
    id: "critical-meaning",
    label: "Critical meaning preserved",
    priority: "headline",
    question: "Did the English preserve the pre-registered meaning that matters?",
    layer: "End to end",
    evaluation: "human",
    requiredData: "Frozen critical units, context, independent blinded ratings, adjudication",
    support: "planned",
    field: "results[].headline.critical_meaning",
    limitation: "Binary labels simplify nuance; publish passes and denominator per clip.",
  },
  {
    id: "critical-outcomes",
    label: "Safe usable coverage",
    priority: "headline",
    question: "For every critical unit, was it correct, wrong, withheld, or missing?",
    layer: "Output honesty",
    evaluation: "hybrid",
    requiredData: "Gold critical units, emitted output, gate decision, human correctness label",
    support: "sample-only",
    field: "results[].headline.critical_outcomes",
    limitation: "The four states must stay separate; one combined score would hide the tradeoff.",
  },
  {
    id: "catastrophic-errors",
    label: "Catastrophic emitted errors",
    priority: "headline",
    question: "How often did the system emit inverted meaning, a wrong person or number, or fabricated content?",
    layer: "Output honesty",
    evaluation: "human",
    requiredData: "Frozen severity taxonomy, reviewer labels, emitted-content denominator",
    support: "planned",
    field: "results[].headline.catastrophic",
    limitation: "A low count is meaningless without the corresponding coverage and raw examples.",
  },
  {
    id: "latency",
    label: "Time to usable / complete",
    priority: "headline",
    question: "How long after ingest until captions are watchable and the full pack is complete?",
    layer: "Runtime",
    evaluation: "automated",
    requiredData: "Instrumented start, first-usable and complete events plus environment metadata",
    support: "planned",
    field: "results[].headline.latency",
    limitation: "The usability gate, hardware, model versions, network and cache state must be pinned.",
  },
];

const diagnosticMetrics: MetricDefinition[] = [
  {
    id: "ko-cer",
    label: "Korean syllable CER",
    priority: "diagnostic",
    question: "How much of the Korean transcript surface form is wrong?",
    layer: "Korean ASR",
    evaluation: "automated",
    requiredData: "Normalized Korean reference and separate system transcript",
    support: "planned",
    field: "results[].diagnostics.ko_cer",
    limitation: "Characters are weighted equally and the score does not measure meaning.",
    reference: {
      label: "KsponSpeech",
      url: "https://ksp.etri.re.kr/ksp/article/file/62525.pdf",
    },
  },
  {
    id: "ko-swer",
    label: "Korean space-normalized WER",
    priority: "diagnostic",
    question: "How accurate is recognition without flexible Korean spacing dominating the result?",
    layer: "Korean ASR",
    evaluation: "automated",
    requiredData: "Gold Korean, fixed spacing normalizer and system transcript",
    support: "planned",
    field: "results[].diagnostics.ko_swer",
    limitation: "Normalization must be documented and frozen before comparison.",
    reference: {
      label: "KsponSpeech",
      url: "https://ksp.etri.re.kr/ksp/article/file/62525.pdf",
    },
  },
  {
    id: "critical-entities",
    label: "Critical entity / term accuracy",
    priority: "diagnostic",
    question: "Were names, titles, numbers and domain terms correct at the right mention?",
    layer: "ASR + translation",
    evaluation: "hybrid",
    requiredData: "Mention spans, canonical IDs, accepted aliases and romanizations",
    support: "planned",
    field: "results[].diagnostics.critical_entities",
    limitation: "Set-level glossary F1 is insufficient because it can reward a term in the wrong context.",
    reference: {
      label: "IWSLT named-entity test suite",
      url: "https://aclanthology.org/2024.iwslt-1.35/",
    },
  },
  {
    id: "critical-facts",
    label: "Critical fact preservation",
    priority: "diagnostic",
    question: "Were people, numbers, polarity, modality and relationships preserved?",
    layer: "Translation",
    evaluation: "hybrid",
    requiredData: "Typed fact tuples, accepted variants and reviewer adjudication",
    support: "planned",
    field: "results[].diagnostics.critical_facts",
    limitation: "Paraphrases and differing severity still need human judgment.",
  },
  {
    id: "critical-speaker",
    label: "Critical-turn speaker accuracy",
    priority: "diagnostic",
    question: "Did the product assign plot-critical speech to the right person?",
    layer: "Speaker attribution",
    evaluation: "hybrid",
    requiredData: "Speaker-attributed gold, system attribution and overlap flag",
    support: "planned",
    field: "results[].diagnostics.critical_speaker",
    limitation: "Report overlap separately; global diarization can hide a critical speaker flip.",
  },
  {
    id: "non-speech-false-caption",
    label: "Non-speech false captions",
    priority: "diagnostic",
    question: "Did the system invent dialogue over silence, music or effects?",
    layer: "VAD + ASR",
    evaluation: "hybrid",
    requiredData: "Gold non-speech windows and emitted cue timing",
    support: "sample-only",
    field: "results[].diagnostics.non_speech_false_captions",
    limitation: "Plot-relevant sound labels must not be counted as invented dialogue.",
  },
  {
    id: "cue-timing",
    label: "Cue timing error",
    priority: "diagnostic",
    question: "Do captions appear with the speech they belong to?",
    layer: "Subtitle timing",
    evaluation: "automated",
    requiredData: "Independent gold and hypothesis cue boundaries plus a declared tolerance",
    support: "planned",
    field: "results[].diagnostics.cue_timing",
    limitation: "Multiple timings can be valid; show signed errors and raw outliers.",
  },
  {
    id: "subtitle-compliance",
    label: "CPS / CPL / block compliance",
    priority: "diagnostic",
    question: "Can the English be read under the declared subtitle style target?",
    layer: "Subtitle presentation",
    evaluation: "automated",
    requiredData: "Final timed cues and a declared characters-per-second / line policy",
    support: "sample-only",
    field: "results[].diagnostics.subtitle_compliance",
    limitation: "Delivery rules are not universal comprehension measures.",
    reference: {
      label: "Netflix English timed text guide",
      url: "https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide",
    },
  },
  {
    id: "mqm-errors",
    label: "Adapted MQM error profile",
    priority: "diagnostic",
    question: "What kinds and severities of translation errors occur?",
    layer: "Translation",
    evaluation: "human",
    requiredData: "Contextual outputs, adapted rubric, trained raters and adjudication",
    support: "planned",
    field: "results[].diagnostics.mqm_errors",
    limitation: "An adaptation must not be presented as a standard MQM score.",
    reference: {
      label: "MQM scoring model",
      url: "https://themqm.org/error-types-2/the-mqm-scoring-models/",
    },
  },
  {
    id: "chrf",
    label: "chrF",
    priority: "diagnostic",
    question: "How much character-level English overlaps a reference translation?",
    layer: "Translation",
    evaluation: "automated",
    requiredData: "Aligned hypothesis and one or more English references",
    support: "planned",
    field: "results[].diagnostics.chrf",
    limitation: "Reference and segmentation dependent; semantic errors may still score well.",
    reference: { label: "chrF", url: "https://aclanthology.org/W15-3049/" },
  },
  {
    id: "comet",
    label: "COMET",
    priority: "diagnostic",
    question: "How does a pinned learned evaluator rate semantic translation quality?",
    layer: "Translation",
    evaluation: "automated",
    requiredData: "Source, hypothesis, reference and exact metric checkpoint",
    support: "planned",
    field: "results[].diagnostics.comet",
    limitation: "Model and domain dependent; it does not evaluate timing or speaker attribution.",
    reference: { label: "COMET", url: "https://aclanthology.org/2020.emnlp-main.213/" },
  },
  {
    id: "suber",
    label: "SubER",
    priority: "diagnostic",
    question: "How much text, segmentation and timing editing is required?",
    layer: "Subtitle integration",
    evaluation: "automated",
    requiredData: "Timed reference and hypothesis subtitle files",
    support: "planned",
    field: "results[].diagnostics.suber",
    limitation: "The composite must be accompanied by text, timing and break diagnostics.",
    reference: { label: "SubER", url: "https://aclanthology.org/2022.iwslt-1.1/" },
  },
  {
    id: "risk-coverage",
    label: "Risk–coverage / gate errors",
    priority: "diagnostic",
    question: "As the system withholds more, do errors among emitted lines actually fall?",
    layer: "Uncertainty + abstention",
    evaluation: "hybrid",
    requiredData: "Pre-gate candidate, confidence, gate result and human correctness",
    support: "planned",
    field: "results[].diagnostics.risk_coverage",
    limitation: "Needs more labeled data than Build Week may provide and a declared error-cost policy.",
    reference: {
      label: "SelectiveNet",
      url: "https://proceedings.mlr.press/v97/geifman19a.html",
    },
  },
  {
    id: "correction-effort",
    label: "Correction effort",
    priority: "diagnostic",
    question: "How much human work reaches an acceptable caption?",
    layer: "Correction workflow",
    evaluation: "hybrid",
    requiredData: "Initial output, accepted edit, time, actions and seeks",
    support: "planned",
    field: "results[].diagnostics.correction_effort",
    limitation: "Editor skill and interface quality strongly affect the result.",
  },
  {
    id: "same-clip-retention",
    label: "Same-clip correction retention",
    priority: "diagnostic",
    question: "Does a corrected line remain fixed on the next identical run?",
    layer: "Correction workflow",
    evaluation: "hybrid",
    requiredData: "Versioned correction and complete before/after run artifacts",
    support: "sample-only",
    field: "results[].diagnostics.same_clip_retention",
    limitation: "This measures retention or memorization, not generalization.",
  },
  {
    id: "held-out-transfer",
    label: "Held-out transfer / regression",
    priority: "diagnostic",
    question: "Do corrections help unseen related clips without breaking other lines?",
    layer: "Learning loop",
    evaluation: "hybrid",
    requiredData: "Separate development and untouched test clips plus versioned rules",
    support: "missing",
    field: "results[].diagnostics.held_out_transfer",
    limitation: "Test gold must never feed the next run.",
  },
  {
    id: "run-variance",
    label: "Repeated-run variance",
    priority: "diagnostic",
    question: "Does an identical pinned condition produce materially different outputs?",
    layer: "Output stability",
    evaluation: "hybrid",
    requiredData: "Multiple identical runs, pinned versions/settings and aligned outputs",
    support: "missing",
    field: "results[].diagnostics.run_variance",
    limitation: "Text differences are not always meaning differences.",
  },
];

const researchMetrics: MetricDefinition[] = [
  {
    id: "si-sdr",
    label: "SI-SDR",
    priority: "research-only",
    question: "Did source separation recover a cleaner target waveform?",
    layer: "Source separation",
    evaluation: "automated",
    requiredData: "Isolated clean stems, mixture and separated output",
    support: "missing",
    field: "research.separation.si_sdr",
    limitation: "Ordinary real video has no clean stems, and signal fidelity does not prove usefulness.",
    reference: { label: "SI-SDR", url: "https://arxiv.org/abs/1811.02508" },
  },
  {
    id: "der-jer",
    label: "DER / JER",
    priority: "research-only",
    question: "How much speaker time is missed, false-alarmed or assigned incorrectly?",
    layer: "Diarization",
    evaluation: "automated",
    requiredData: "Dense speaker intervals, overlap labels, collar and scoring policy",
    support: "missing",
    field: "research.diarization",
    limitation: "Annotation is expensive and the metrics still do not answer who said what.",
    reference: {
      label: "DIHARD III evaluation plan",
      url: "https://dihardchallenge.github.io/dihard3/docs/third_dihard_eval_plan_v1.2.pdf",
    },
  },
  {
    id: "calibration",
    label: "Confidence calibration",
    priority: "research-only",
    question: "Do stated probabilities match empirical correctness?",
    layer: "Uncertainty",
    evaluation: "hybrid",
    requiredData: "Large held-out labeled set and probabilistic segment outputs",
    support: "missing",
    field: "research.calibration",
    limitation: "ECE is bin- and sample-sensitive; the scripted demo confidences cannot be calibrated.",
    reference: {
      label: "On Calibration of Modern Neural Networks",
      url: "https://proceedings.mlr.press/v70/guo17a",
    },
  },
  {
    id: "laal",
    label: "LAAL quality–latency curve",
    priority: "research-only",
    question: "How far does streaming translation lag behind speech?",
    layer: "Simultaneous translation",
    evaluation: "automated",
    requiredData: "Unsegmented timestamped source/output stream and references",
    support: "missing",
    field: "research.streaming.laal",
    limitation: "Prepared captions are the Build Week job; this is a different product promise.",
    reference: { label: "LAAL", url: "https://aclanthology.org/2022.autosimtrans-1.2/" },
  },
  {
    id: "erasure",
    label: "Normalized erasure / stable lag",
    priority: "research-only",
    question: "How much already displayed translation changes before settling?",
    layer: "Streaming stability",
    evaluation: "automated",
    requiredData: "Every incremental displayed hypothesis with timestamps",
    support: "missing",
    field: "research.streaming.erasure",
    limitation: "Stability can be improved dishonestly by delaying output; quality and lag must accompany it.",
    reference: {
      label: "Retranslation stability",
      url: "https://research.google/pubs/re-translation-strategies-for-long-form-simultaneous-spoken-language-translation/",
    },
  },
  {
    id: "comprehension",
    label: "Viewer comprehension / study retention",
    priority: "research-only",
    question: "Can target users understand the clip and retain useful learning?",
    layer: "Product outcome",
    evaluation: "human",
    requiredData: "Pre-registered tasks, target users, control conditions and delayed testing",
    support: "missing",
    field: "research.user_study",
    limitation: "Small pilots are descriptive and must not be reported as general lift.",
  },
];

const omittedMetrics: MetricDefinition[] = [
  {
    id: "bleu-headline",
    label: "BLEU as headline",
    priority: "omit",
    question: "Can corpus n-gram overlap stand in for product quality?",
    layer: "Translation",
    evaluation: "automated",
    requiredData: "Corpus references and pinned tokenizer",
    support: "missing",
    field: "omitted.bleu",
    limitation: "A few short clips and critical semantic failures make it a poor product headline.",
  },
  {
    id: "coverage-headline",
    label: "Raw coverage as headline",
    priority: "omit",
    question: "Did the system emit something for most expected speech?",
    layer: "Output",
    evaluation: "automated",
    requiredData: "Explicit cue/time/language denominator",
    support: "sample-only",
    field: "omitted.raw_coverage",
    limitation: "It rewards guessing and even captioning silence unless paired with correctness.",
  },
  {
    id: "composite-pack-score",
    label: "Single composite pack score",
    priority: "omit",
    question: "Can quality, coverage, timing and latency be reduced to one rank?",
    layer: "Cross-pipeline",
    evaluation: "hybrid",
    requiredData: "Product-selected weights for unlike outcomes",
    support: "missing",
    field: "omitted.composite",
    limitation: "Weights hide tradeoffs and can bury catastrophic failures.",
  },
];

export const metricGroups = [
  {
    id: "headline",
    label: "Headline outcomes",
    note: "The small set that can support product comparisons after gold freezes.",
    metrics: headlineMetrics,
  },
  {
    id: "diagnostic",
    label: "Diagnostic metrics",
    note: "Explain where the pipeline succeeds or fails; do not turn these into the marketing claim.",
    metrics: diagnosticMetrics,
  },
  {
    id: "research-only",
    label: "Research-only methods",
    note: "Valid methods whose annotation or product assumptions are outside the Build Week minimum.",
    metrics: researchMetrics,
  },
  {
    id: "omit",
    label: "Explicitly omitted",
    note: "Tempting numbers that would make the page less honest or less interpretable.",
    metrics: omittedMetrics,
  },
] as const;

export const outcomeStates = [
  {
    id: "correct",
    label: "Correctly emitted",
    definition: "A target line was emitted and the critical meaning passed human review.",
  },
  {
    id: "wrong",
    label: "Wrongly emitted",
    definition: "A target line was emitted but the critical meaning failed human review.",
  },
  {
    id: "withheld",
    label: "Withheld",
    definition: "The system explicitly refused to publish a target line because evidence was insufficient.",
  },
  {
    id: "missing",
    label: "Missing",
    definition: "No usable target line exists and no explicit gate decision explains the gap.",
  },
] as const;

export const annotationRequirements: AnnotationRequirement[] = [
  {
    id: "source",
    label: "Source provenance",
    purpose: "Identify exactly what media was evaluated and whether evidence may be redistributed.",
    requiredFields: "URL or media hash, video ID, timestamps, capture date, license/rights, attribution",
    futurePath: "bench/packs/hard-ko-v1/clips/<clip-id>/source.json",
    status: "missing",
  },
  {
    id: "speech",
    label: "Speech and non-speech timing",
    purpose: "Score VAD misses, false captions, music and silence honestly.",
    requiredFields: "Speech intervals, non-speech intervals, music/effects, overlap flag",
    futurePath: "bench/packs/hard-ko-v1/clips/<clip-id>/activity.json",
    status: "partial-demo",
  },
  {
    id: "speakers",
    label: "Speaker attribution",
    purpose: "Verify who said each critical turn, especially during overlap.",
    requiredFields: "Speaker roster, cue speaker IDs, overlap intervals, unknown-speaker policy",
    futurePath: "bench/packs/hard-ko-v1/clips/<clip-id>/speakers.json",
    status: "partial-demo",
  },
  {
    id: "korean",
    label: "Timed Korean gold",
    purpose: "Support Korean CER/sWER and human inspection of the source meaning.",
    requiredFields: "Cue IDs, start/end, speaker, verbatim Korean, normalized Korean",
    futurePath: "bench/packs/hard-ko-v1/clips/<clip-id>/gold.ko.json",
    status: "partial-demo",
  },
  {
    id: "english",
    label: "English meaning guidance",
    purpose: "Describe acceptable meaning without pretending there is only one valid subtitle.",
    requiredFields: "Primary reference, accepted variants, context note, register note",
    futurePath: "bench/packs/hard-ko-v1/clips/<clip-id>/gold.en.json",
    status: "partial-demo",
  },
  {
    id: "critical-units",
    label: "Pre-registered critical units",
    purpose: "Define the exact meaning each headline judgment will test before runs are inspected.",
    requiredFields: "Unit ID, cue range, semantic criterion, failure examples, phenomenon tags",
    futurePath: "bench/packs/hard-ko-v1/clips/<clip-id>/critical.json",
    status: "partial-demo",
  },
  {
    id: "entities",
    label: "Entities and critical facts",
    purpose: "Score names, romanizations, numbers, polarity, modality and relationships.",
    requiredFields: "Mention span, canonical ID, type, accepted forms, criticality, expected relation",
    futurePath: "bench/packs/hard-ko-v1/clips/<clip-id>/facts.json",
    status: "partial-demo",
  },
  {
    id: "subtitles",
    label: "Subtitle reference",
    purpose: "Evaluate timing, segmentation and readability separately from translation meaning.",
    requiredFields: "Cue boundaries, line breaks, speaker treatment, style target",
    futurePath: "bench/packs/hard-ko-v1/clips/<clip-id>/gold.vtt",
    status: "missing",
  },
  {
    id: "review",
    label: "Human review receipt",
    purpose: "Make every meaning and severity judgment auditable.",
    requiredFields: "Blinded system ID, reviewer, label, confidence, note, adjudicated label",
    futurePath: "bench/reviews/<pack-id>/<run-id>.json",
    status: "missing",
  },
  {
    id: "runtime",
    label: "Runtime receipt",
    purpose: "Make latency and cost comparable across runs.",
    requiredFields: "Start/usable/complete timestamps, hardware, model IDs, versions, cache/network state",
    futurePath: "bench/runs/<run-id>/runtime.json",
    status: "missing",
  },
];

export const artifactContract = [
  {
    path: "bench/schemas/report.schema.json",
    role: "Machine-readable contract for pack, systems, results and evidence links",
    state: "ready" as const,
  },
  {
    path: "bench/examples/unscored-report.json",
    role: "Honest sample instance rendered by this page",
    state: "ready" as const,
  },
  {
    path: "bench/packs/hard-ko-v1/manifest.json",
    role: "Frozen clip manifest and protocol decisions",
    state: "missing" as const,
  },
  {
    path: "bench/packs/hard-ko-v1/clips/",
    role: "Per-clip source, activity, speakers, KO/EN gold, facts and critical units",
    state: "missing" as const,
  },
  {
    path: "bench/foils/<system>/<clip-id>/",
    role: "Raw date-stamped external outputs and capture metadata",
    state: "missing" as const,
  },
  {
    path: "bench/runs/<run-id>/",
    role: "Pinned 1321 output, configuration, runtime and score receipt",
    state: "missing" as const,
  },
  {
    path: "bench/reviews/<pack-id>/",
    role: "Independent blinded labels and adjudication",
    state: "missing" as const,
  },
] as const;

export function displayNumber(value: number | null, options?: Intl.NumberFormatOptions): string {
  if (value === null) return "Not measured";
  return new Intl.NumberFormat("en-US", options).format(value);
}

export function displayRate(value: number | null): string {
  if (value === null) return "Not measured";
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
}
