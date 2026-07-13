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
   * Where the clip came from, and what lets us republish it.
   *
   * These are not metadata. A Creative Commons licence is the only reason this demo may host
   * somebody else's video, and it is granted on the condition that the work is credited — so
   * the credit is a term of the licence, not a courtesy, and the UI prints it wherever the clip
   * plays. A run whose media has no `licence` here has no business being shipped.
   */
  url?: string;
  licence?: string;
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
  /** Run-scoped delta. Promoted into cross-run memory after the run. */
  scope: string;
  promoted_to: string;
  cast_closed: boolean;
  entries: GlossaryEntry[];
}

/* -------------------------------------------------------------- score.json */

export interface PathScore {
  label: string;
  points: number | null;
  hard_line: number | null;
  coverage: number | null;
  time_to_usable_s: number | null;
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
