/**
 * Wire shapes for a recorded run under /demo/runs/<id>/.
 *
 * Design rule: the CORE is language-neutral and stable. Anything specific to a
 * language lives in a language pack under /demo/packs/<lang>.json and is
 * referenced by id, never hard-coded here. Korean is the first pack, not the
 * schema. See docs/ARCHITECTURE.md "Language packs".
 *
 * The correction row is future fine-tune data, so its shape is append-only:
 * new languages add pack-namespaced refinements, they never widen the core enum.
 */

/* ---------------------------------------------------------------- language */

/** BCP-47. "ko", "en", "ja", "zh-Hans". */
export type LangCode = string;

export interface LangPair {
  source: LangCode;
  target: LangCode;
}

/**
 * Stable core error taxonomy, shared by every language pack and frozen in
 * docs/ARCHITECTURE.md. A pack refines a row with `error_subtype` instead of
 * adding a member here, so old correction rows never need migrating.
 */
export type ErrorType = "homophone" | "boundary" | "hallucination" | "music" | "other";

/** Pack-namespaced refinement, e.g. "ko.kinship_address", "ja.counter". */
export type ErrorSubtype = string;

/** Where a rule comes from. Universal rules survive a language swap; pack rules do not. */
export type GateScope = "universal" | "pack";

export interface Phenomenon {
  id: string;
  label: string;
  /** How this pack-specific phenomenon folds into the stable core enum. */
  error_type: ErrorType;
  note: string;
}

export interface Gate {
  id: string;
  scope: GateScope;
  label: string;
  rule: string;
  /** Run id where this rule landed. */
  since: string;
}

export interface LanguagePack {
  id: string;
  lang: LangCode;
  label: string;
  script: string;
  status: string;
  phenomena: Phenomenon[];
  gates: Gate[];
  entity_kinds: string[];
  note: string;
}

export interface PackRegistry {
  packs: {
    lang: LangCode;
    label: string;
    pack: string | null;
    status: string;
  }[];
}

/* ---------------------------------------------------------------- run.json */

export type Role = "orchestrator" | "segment" | "context" | "translate" | "qc";

export type AgentStatus =
  | "idle"
  | "spawning"
  | "working"
  | "reporting"
  | "gating"
  | "retired"
  | "done";

export type View = "prepped" | "baseline" | "diff";

export interface SpeakerRef {
  id: string;
  label: string;
}

export interface ClipSource {
  kind: string;
  label: string;
  note: string;
  /**
   * Provider-facing credit for sources licensed for redistribution.
   *
   * These are not generic rights metadata. A Creative Commons provider source must carry and
   * display its licence and credit here. Owned media instead carries a closed ownership and scope
   * receipt in source.json; it must not pretend an attestation is a provider licence.
   */
  url?: string;
  licence?: string;
}

/**
 * Receipt written by scripts/ingest-clip.mjs after it has fetched source metadata,
 * enforced the redistribution licence, cut the selected window, and measured that cut.
 * It is not a language, music, speaker, or complexity probe.
 */
export interface YouTubeIngestReceipt {
  kind: "youtube";
  label: string;
  channel: string;
  url: string;
  video_id: string;
  licence: string;
  window: { start: string; end: string };
  duration: number;
  attribution: string;
  note: string;
}

export interface Sha256Hash {
  algorithm: "sha256";
  digest: string;
}

export interface OwnedLocalDerivedArtifactReceipt {
  kind: "media_probe";
  path: "media-probe.json";
  schema: "studio.media-probe.v1";
  producer: "scripts/probe-media.mjs";
  source_content_ids: string[];
  content_hash: string;
}

/**
 * Receipt written only after an operator explicitly attests the rights to a local file.
 * The original filename is provenance, never a producer of title, ownership, identity,
 * language, or acoustic facts.
 */
export interface OwnedLocalIngestReceipt {
  schema: "studio.ingest.owned-local.v1";
  kind: "owned_local";
  producer: "scripts/ingest-owned-media.mjs";
  receipt_id: string;
  label: string;
  origin: {
    kind: "local_file";
    filename: string;
    path_disclosure: "basename_only";
  };
  content: {
    id: string;
    hash: Sha256Hash;
    bytes: number;
  };
  rights: {
    basis: "ownership_attestation";
    asserted_by: string;
    asserted_at: string;
    scope: "local_processing" | "redistribution";
    statement: string;
  };
  selection: { start: number; end: number; duration: number };
  raw_media: {
    path: string;
    content_id: string;
    bytes: number;
    preservation: "byte_identical_copy" | "adopted_existing_bytes";
  };
  derived_artifacts: OwnedLocalDerivedArtifactReceipt[];
  note: string;
}

export interface YouTubeLocalDerivedArtifactReceipt {
  kind: "media_probe";
  path: "media-probe.json";
  schema: "studio.media-probe.v1";
  producer: "scripts/probe-media.mjs";
  source_content_ids: string[];
  content_hash: string;
}

/**
 * Private local-processing receipt for an operator-confirmed bounded YouTube download. This is
 * deliberately distinct from the redistributable recorded-demo receipt above: its bytes may be
 * consumed only by the local runtime and may never be copied into public/demo.
 */
export interface YouTubeLocalIngestReceipt {
  schema: "studio.ingest.youtube-local.v1";
  kind: "youtube_local";
  producer: "studio.youtube-local-ingest-host.v1";
  receipt_id: string;
  label: string;
  origin: {
    kind: "youtube";
    canonical_url: string;
    external_id: string;
    creator: string | null;
  };
  resolution: {
    schema: "studio.remote-source-resolution.v1";
    resolution_id: string;
    content_id: string;
    producer: "studio.youtube-metadata-resolver";
    tool: { id: "yt-dlp"; version: string };
  };
  content: {
    id: string;
    hash: Sha256Hash;
    bytes: number;
  };
  rights: {
    basis: "operator_local_processing_confirmation";
    asserted_at: string;
    scope: "local_processing";
    redistribution_allowed: false;
    statement: string;
  };
  selection: {
    provider_start_ms: number;
    provider_end_ms: number;
    local_start: 0;
    local_end: number;
    duration: number;
  };
  raw_media: {
    path: "raw/youtube-local.mp4";
    content_id: string;
    bytes: number;
    preservation: "provider_bounded_download";
  };
  derived_artifacts: YouTubeLocalDerivedArtifactReceipt[];
  note: string;
}

/**
 * Closed over producers that actually exist. Add another receipt variant only with the
 * corresponding ingest producer and runtime assertion; do not make provider fields optional.
 */
export type IngestReceipt = YouTubeIngestReceipt | OwnedLocalIngestReceipt | YouTubeLocalIngestReceipt;

/** Exact local media facts written by scripts/probe-media.mjs from ffprobe output. */
export interface MediaProbeTrack {
  index: number;
  type: string;
  codec: string;
  duration?: number;
  width?: number;
  height?: number;
  sample_rate?: number;
  channels?: number;
}

export interface MediaProbeReceipt {
  schema: "studio.media-probe.v1";
  producer: "scripts/probe-media.mjs";
  run: string;
  media: string;
  input: {
    content_id: string;
    hash: Sha256Hash;
    bytes: number;
  };
  duration: number;
  container: string[];
  container_long_name: string;
  bit_rate: number | null;
  tracks: MediaProbeTrack[];
}

export interface Clip {
  id: string;
  title: string;
  title_target: string;
  lang: LangCode;
  duration: number;
  speakers: SpeakerRef[];
  /** [start, end] windows carrying music under speech. */
  music: [number, number][];
  /** [start, end] windows with no speech at all. */
  silence: [number, number][];
  source: ClipSource;
  /** Real media file, or null when none is bundled and the transport is virtual. */
  media: string | null;
}

export interface AgentSpec {
  id: string;
  role: Role;
  label: string;
  parent: string | null;
  /** Set when this worker was created by dividing an existing worker. */
  divided_from?: string;
  window?: [number, number];
}

export interface RunManifest {
  id: string;
  pair: LangPair;
  /** Language pack this run was prepped with. */
  pack: string;
  clip: Clip;
  /** Wall-clock seconds the recorded run actually took. */
  wall_s: number;
  recorded: string;
  agents: AgentSpec[];
  artifacts: string[];
  note: string;
}

/* ----------------------------------------------------------- captions.json */

export interface Withheld {
  gate: string;
  reason: string;
}

export interface Line {
  lang: LangCode;
  text: string | null;
}

export interface TargetLine extends Line {
  /** Present when the QC gate refused to stand behind a line. Fail closed. */
  withheld?: Withheld;
}

/** The same window on a comparison path, e.g. cold one-shot or a public foil. */
export interface Baseline {
  path: string;
  source: Line;
  target: Line;
}

/**
 * What a second, independent recogniser heard in this window.
 *
 * A recogniser cannot tell you how sure it is — the models we run return no logprobs, and a
 * model's own estimate of its correctness is a self-report, which is the exact failure this
 * product exists to catch. So the confidence a gate reads is not asked of anyone: it is the
 * AGREEMENT between two systems that heard the same audio, which is a measurement.
 *
 * `agreement` is null when the second recogniser produced no words in the window at all.
 * Whisper drops backchannels, so a bare "네" comes back with no token against it and there is
 * nothing to compare. That is an ABSENCE OF EVIDENCE, and it must not be stored as a zero:
 * zero means "the two of them heard different things", which is a finding, and this is the
 * absence of one. A line with a null agreement is committed on one recogniser's word and says
 * so; it is never withheld for a silence that belongs to our tooling rather than to the clip.
 */
export interface Corroboration {
  /** 0..1 character agreement between two independent recognisers. null = not measurable. */
  agreement: number | null;
  /** The recogniser that did the checking. */
  by: string;
  /** What it wrote for this window. Empty = it wrote nothing here. */
  heard: string;
}

export interface Cue {
  id: string;
  t_start: number;
  t_end: number;
  /** Speaker ids from clip.speakers. Empty = no speech. Two or more = overlap. */
  speakers: string[];
  source: Line;
  /** One entry per target language. Today: one. */
  targets: TargetLine[];
  /** Absent on a run that had only one recogniser. */
  corroboration?: Corroboration;
  baseline?: Baseline;
  silence?: boolean;
  hard?: boolean;
  error_type?: ErrorType;
  error_subtype?: ErrorSubtype;
  /** This run got a hard line wrong that an earlier run got right. Shown, never hidden. */
  regression?: string;
  /** The swarm recovered a line the baseline path failed. */
  recovered?: string;
  owner: string;
}

export interface CaptionsFile {
  run: string;
  clip: string;
  pair: LangPair;
  cues: Cue[];
}

/* -------------------------------------------------------- corrections.json */

/** The fine-tune row. Core fields are frozen; packs refine via error_subtype. */
export interface Correction {
  source_video: string;
  t_start: number;
  t_end: number;
  raw: string;
  final: string | null;
  error_type: ErrorType;
  error_subtype?: ErrorSubtype;
  lang: LangCode;
  withhold: boolean;
  run: string;
  pack: string;
}

export interface CorrectionsFile {
  run: string;
  clip: string;
  pack: string;
  rows: Correction[];
}

/* ----------------------------------------------------------- glossary.json */

export interface GlossaryEntry {
  term: string;
  lang: LangCode;
  /** The English the translator should USE. A surface form, not a dictionary note. */
  gloss: string;
  kind: string;
  /**
   * Only for an address form (누나, 오빠, 선배 …), and only when something OUTSIDE the word
   * itself establishes that the speakers really are family: a kinship-only token in the audio,
   * or curated knowledge of the cast.
   *
   * It is a field and not a sentence on purpose. The gate that reads it used to look for
   * kinship words in the gloss prose instead, and was defeated by every glossary it was given,
   * because the gloss of 누나 is "older sister" — that is what the word means, and a dictionary
   * entry is not evidence that these two people are related.
   */
  confirms_relation?: boolean;
  source: string;
}

export interface GlossaryFile {
  run: string;
  clip: string;
  pack: string;
  /** Run-scoped delta. Historical runs may name the legacy file they mutated. */
  scope: string;
  promoted_to: string | null;
  /** Present on proposal-first runs, which cannot promote their own model output. */
  promotion?: {
    status: "pending_review";
    proposal_kind: "glossary";
    proposal_manifest: string;
    note: string;
  };
  /** Present on frozen-benchmark runs that must not feed the cross-run memory conveyor. */
  routing?: {
    status: "bench_only";
    pack_id: string;
    note: string;
  };
  cast_closed: boolean;
  entries: GlossaryEntry[];
}

/* -------------------------------------------------------------- score.json */

export interface PathScore {
  label: string;
  points: number | null;
  hard_line: number | null;
  coverage: number | null;
  /**
   * When the first line this path will stand behind arrived, and when the last one did.
   *
   * They are two different claims and they used to share one field: the run assigned "usable"
   * on every commit, so it held the time of the LAST one. Reporting completion under a name
   * that says usable flatters nobody here — it made the run look slower — but a metric whose
   * label does not describe it is a metric nobody can check, which is the failure this whole
   * repo is about.
   */
  time_to_usable_s: number | null;
  time_to_complete_s?: number | null;
  withheld: number | null;
  hallucinated: number | null;
  regressions?: number;
  status?: string;
  note?: string;
}

/** entity / meaning / honesty. Universal: no language owns these. */
export interface LineScore {
  e: number;
  m: number;
  h: number;
}

export interface PerLine {
  cue: string;
  error_type: ErrorType;
  error_subtype?: ErrorSubtype;
  label: string;
  scores: Record<string, LineScore>;
}

export interface ScoreFile {
  run: string;
  clip: string;
  pair: LangPair;
  pack: string;
  status: string;
  rubric: {
    hard_lines: number;
    criteria: string[];
    points_max: number;
    note: string;
  };
  paths: Record<string, PathScore>;
  trail: { run: string; hard_line: number }[];
  /**
   * null when there is no gold for the clip. A run with nothing to be right against cannot
   * have beaten the cold path by zero — it has not been compared to it at all, and writing 0
   * would render as "+0.00 vs cold", a claim of parity we did not earn.
   */
  delta_vs_cold: number | null;
  per_line: PerLine[];
}

/* ------------------------------------------------------------- traces.json */

export type TraceLevel = "info" | "warn" | "gate" | "error";

/** A trace can paint into its own agent's workspace. Keeps the engine generic. */
export interface TraceView {
  playhead?: number;
  mark?: { label: string; hard?: boolean };
  gloss?: { term: string; gloss: string };
  /** `conf` is cross-recogniser agreement, never a model's opinion of itself. null = not measurable. */
  draft?: { source: string; target: string; conf: number | null };
  gate?: { name: string; scope: GateScope; value: number; limit: number; fail?: boolean };
  stamp?: { kind: "withheld" | "corrected" | "dropped"; text: string };
}

export type CueState = "pending" | "drafted" | "committed" | "withheld" | "dropped";

export type Effect =
  | { type: "agent"; id: string; status: AgentStatus }
  | { type: "cue"; id: string; state: CueState }
  | { type: "cues"; state: CueState }
  | { type: "score"; hard_line?: number; coverage?: number; fabrications?: number };

export interface Trace {
  /** Seconds from run start, on the recorded wall clock. */
  t: number;
  agent: string;
  action: string;
  target: string;
  detail: string;
  level: TraceLevel;
  /** Media time this action is about. Makes every trace scrub-linked. */
  clip_t?: number;
  view?: TraceView;
  effects?: Effect[];
}

export interface TracesFile {
  run: string;
  clip: string;
  wall_s: number;
  traces: Trace[];
}

/* ----------------------------------------------------------- waveform.json */

export interface WaveFile {
  clip: string;
  duration: number;
  /** Normalised 0..1 peaks, evenly spaced across the clip. */
  peaks: number[];
}
