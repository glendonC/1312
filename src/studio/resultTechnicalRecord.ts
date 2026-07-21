import type { RunBundle } from "./transport";
import type { GlossaryFile, IngestReceipt, MediaProbeTrack } from "./types";

/** Gate activity read from the recorded trace log: every check the run's gates actually made. */
export interface GateRecord {
  /** Distinct recorded gate names, sorted. */
  names: string[];
  checks: number;
  failed: number;
}

/** Cross-recogniser agreement over the lines the run committed. */
export interface CorroborationRecord {
  /** Distinct checking recognisers, sorted. Empty when no committed line carries one. */
  checkers: string[];
  /** Committed lines whose checker produced words to compare. */
  measured: number;
  /** Committed lines whose checker heard nothing: an absence of evidence, not a disagreement. */
  unmeasurable: number;
  /** Committed lines recorded without any corroboration field at all. */
  unchecked: number;
}

/** Content identity and measured facts of the exact media the run processed. */
export interface MediaIdentityRecord {
  contentId: string;
  bytes: number;
  durationS: number;
  tracks: MediaProbeTrack[];
}

/** The window of the original source this clip was cut from, in the receipt's own units. */
export type SourceWindowRecord =
  | { kind: "provider_timestamps"; start: string; end: string }
  | { kind: "seconds"; startS: number; endS: number };

/** The run's scoring state, read from the score artifact without interpretation. */
export interface ProofRecord {
  status: string;
  /** null = never compared: without gold there is no delta and no parity claim. */
  deltaVsCold: number | null;
  timeToUsableS: number | null;
  timeToCompleteS: number | null;
}

export type GlossaryDisposition = "promoted" | "pending_review" | "bench_only" | "run_scoped";

/** What the run feeds back into cross-run memory, and on what terms. */
export interface ConveyorRecord {
  pack: string;
  glossaryTerms: number;
  glossaryDisposition: GlossaryDisposition;
  correctionRows: number;
}

export interface TechnicalRecord {
  /** Wall-clock seconds the recorded run actually took. */
  wallS: number;
  /** Workers the run manifest declares. Replay animates them; it does not re-run them. */
  recordedWorkers: number;
  gates: GateRecord;
  corroboration: CorroborationRecord;
  /** null = no probe receipt was recorded for this run. */
  media: MediaIdentityRecord | null;
  /** null = no ingest receipt was recorded for this run. */
  sourceWindow: SourceWindowRecord | null;
  proof: ProofRecord;
  conveyor: ConveyorRecord;
}

/**
 * The one technical accounting of how a completed run processed its media: measured process
 * facts, content identity, honest scoring state, and the conveyor rows it feeds back. Every
 * value is read from typed bundle fields — never parsed out of prose notes — so the Method
 * disclosure cannot claim anything the recorded artifacts do not.
 */
export function projectTechnicalRecord(bundle: RunBundle): TechnicalRecord {
  const { run, captions, traces, score, glossary, corrections } = bundle;

  const gateNames = new Set<string>();
  let checks = 0;
  let failed = 0;
  for (const trace of traces) {
    const gate = trace.view?.gate;
    if (!gate) continue;
    checks += 1;
    if (gate.fail) failed += 1;
    gateNames.add(gate.name);
  }

  // Committed = the same rule projectResultAccounting counts as "captioned": a target line with
  // text that no gate withheld. Withheld and silent lines carry no corroboration claim here.
  const checkers = new Set<string>();
  let measured = 0;
  let unmeasurable = 0;
  let unchecked = 0;
  for (const cue of captions.cues) {
    if (cue.silence) continue;
    const target = cue.targets.find((candidate) => candidate.lang === run.pair.target);
    if (!target?.text || target.withheld) continue;
    if (!cue.corroboration) {
      unchecked += 1;
      continue;
    }
    checkers.add(cue.corroboration.by);
    if (cue.corroboration.agreement === null) unmeasurable += 1;
    else measured += 1;
  }

  const path = score.paths[run.id];
  const probe = bundle.mediaProbe;

  return {
    wallS: run.wall_s,
    recordedWorkers: run.agents.length,
    gates: { names: [...gateNames].sort(), checks, failed },
    corroboration: { checkers: [...checkers].sort(), measured, unmeasurable, unchecked },
    media: probe
      ? {
          contentId: probe.input.content_id,
          bytes: probe.input.bytes,
          durationS: probe.duration,
          tracks: probe.tracks,
        }
      : null,
    sourceWindow: projectSourceWindow(bundle.ingestReceipt ?? null),
    proof: {
      status: score.status,
      deltaVsCold: score.delta_vs_cold,
      timeToUsableS: path?.time_to_usable_s ?? null,
      timeToCompleteS: path?.time_to_complete_s ?? null,
    },
    conveyor: {
      pack: run.pack,
      glossaryTerms: glossary.entries.length,
      glossaryDisposition: glossaryDisposition(glossary),
      correctionRows: corrections.rows.length,
    },
  };
}

function projectSourceWindow(receipt: IngestReceipt | null): SourceWindowRecord | null {
  if (!receipt) return null;
  switch (receipt.kind) {
    case "youtube":
      return { kind: "provider_timestamps", start: receipt.window.start, end: receipt.window.end };
    case "owned_local":
      return { kind: "seconds", startS: receipt.selection.start, endS: receipt.selection.end };
    case "youtube_local":
      return {
        kind: "seconds",
        startS: receipt.selection.provider_start_ms / 1000,
        endS: receipt.selection.provider_end_ms / 1000,
      };
  }
}

function glossaryDisposition(glossary: GlossaryFile): GlossaryDisposition {
  if (glossary.promotion) return "pending_review";
  if (glossary.routing) return "bench_only";
  if (glossary.promoted_to !== null) return "promoted";
  return "run_scoped";
}
