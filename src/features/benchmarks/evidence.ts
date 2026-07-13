import type { AnnotationRequirement } from "./types";

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
