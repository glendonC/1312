/**
 * The transport seam.
 *
 * Everything above this file consumes an ordered stream of typed agent events and
 * a static bundle of run artifacts. It does not know or care where they came from.
 *
 *   ReplayTransport  reads a recorded run from /demo/runs/<id>/  (what ships today)
 *   LiveTransport    reads the same events off a socket from a real orchestrator
 *
 * Swapping one for the other is a one-line change in the store. No component, no
 * reducer, and no type changes. That is the entire reason the run is modelled as an
 * event log instead of a pile of component state.
 */

import type {
  CaptionsFile,
  CorrectionsFile,
  GlossaryFile,
  LanguagePack,
  MediaProbeReceipt,
  RunManifest,
  ScoreFile,
  IngestReceipt,
  Trace,
  WaveFile,
} from "./types";
import type { RecordedEvidenceIndex } from "./evidence/types";
import type { LanguageRangesReceipt, PreflightBundle, SpeechActivityReceipt } from "./preflight/contracts";
import { assertPreflightEvidence } from "./preflight/evidenceValidation";
import { assertRunBundle } from "./bundle";
import { assertTrace } from "./traceValidation";

export interface RunBundle {
  run: RunManifest;
  captions: CaptionsFile;
  score: ScoreFile;
  pack: LanguagePack;
  wave: WaveFile;
  traces: Trace[];
  glossary: GlossaryFile;
  corrections: CorrectionsFile;
  /** Optional ingest receipt. Older synthetic fixtures have no source producer. */
  ingestReceipt?: IngestReceipt | null;
  mediaProbe?: MediaProbeReceipt | null;
  /** Optional immutable preflight index. Detector-backed versions require their paired receipts. */
  preflightBundle?: PreflightBundle | null;
  /** Optional detector receipt validated against source identity, probe facts, and detector-backed preflight. */
  speechActivity?: SpeechActivityReceipt | null;
  /** Optional language detector receipt validated only over receipted speech windows. */
  languageRanges?: LanguageRangesReceipt | null;
  /** Optional deterministic post-run index. It is not original runtime provenance. */
  evidence?: RecordedEvidenceIndex | null;
}

export interface StreamOptions {
  /** Wall-clock multiplier. 1 = the run's real recorded pace. */
  speed: number;
  onEvent: (trace: Trace) => void;
  onEnd: () => void;
  /** Transport ended without evidence of completion. */
  onAbort?: (reason: string) => void;
}

export type ControlDisposition = "applied" | "requested" | "unavailable";

/**
 * A run in flight.
 *
 * Stopping and pausing are different promises, so they are different methods. `stop` is
 * destructive and final: the run is over. `pause` suspends it and is expected to be
 * resumed, and it has to be honest — the clock itself stops, so the fold stops, and
 * resuming picks up at the exact trace it left off. A pause that quietly kept the clock
 * running and then flushed a burst of catch-up traces on resume would be a lie about
 * what the swarm did while the user was not looking.
 */
export interface RunHandle {
  pause(): ControlDisposition;
  resume(): ControlDisposition;
  stop(): void;
  /** Present only on deterministic replay handles. */
  replay?: ReplayControls;
}

export interface ReplayControls {
  seek(cursor: number): number;
  step(): boolean;
  setSpeed(speed: number): void;
  cursor(): number;
}

export interface RunTransport {
  readonly mode: "replay" | "live";
  load(): Promise<RunBundle>;
  /** Begin emitting agent events. Returns the handle that controls the run. */
  stream(options: StreamOptions): RunHandle;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`studio: cannot load ${url} (${res.status})`);
  return (await res.json()) as T;
}

async function optionalJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`studio: cannot load ${url} (${res.status})`);
  return (await res.json()) as T;
}

/** Replays a run recorded to disk, on a clock. */
export class ReplayTransport implements RunTransport {
  readonly mode = "replay" as const;
  private traces: Trace[] = [];

  constructor(private readonly runId: string) {}

  async load(): Promise<RunBundle> {
    const base = `/demo/runs/${this.runId}`;

    const [
      run,
      captions,
      score,
      wave,
      traceFile,
      glossary,
      corrections,
      ingestReceipt,
      mediaProbe,
      preflightV3,
      preflightV2,
      preflightV1,
      speechActivity,
      languageRanges,
      evidence,
    ] = await Promise.all([
      json<RunManifest>(`${base}/run.json`),
      json<CaptionsFile>(`${base}/captions.json`),
      json<ScoreFile>(`${base}/score.json`),
      json<WaveFile>(`${base}/waveform.json`),
      json<{ traces: Trace[] }>(`${base}/traces.json`),
      json<GlossaryFile>(`${base}/glossary.json`),
      json<CorrectionsFile>(`${base}/corrections.json`),
      optionalJson<IngestReceipt>(`${base}/source.json`),
      optionalJson<MediaProbeReceipt>(`${base}/media-probe.json`),
      optionalJson<PreflightBundle>(`${base}/preflight-v3.json`),
      optionalJson<PreflightBundle>(`${base}/preflight-v2.json`),
      optionalJson<PreflightBundle>(`${base}/preflight.json`),
      optionalJson<SpeechActivityReceipt>(`${base}/speech-activity.json`),
      optionalJson<LanguageRangesReceipt>(`${base}/language-ranges.json`),
      optionalJson<RecordedEvidenceIndex>(`${base}/evidence.json`),
    ]);

    // The language pack is cross-run memory, so it lives outside the run folder.
    const pack = await json<LanguagePack>(`/demo/packs/${run.pack}.json`);

    this.traces = traceFile.traces;
    const bundle = {
      run,
      captions,
      score,
      pack,
      wave,
      traces: this.traces,
      glossary,
      corrections,
      ingestReceipt,
      mediaProbe,
      preflightBundle: preflightV3 ?? preflightV2 ?? preflightV1,
      speechActivity,
      languageRanges,
      evidence,
    };
    assertRunBundle(bundle, `Studio run ${this.runId}`);
    assertPreflightEvidence(bundle, `Studio run ${this.runId} preflight evidence`);
    return bundle;
  }

  stream({ speed, onEvent, onEnd }: StreamOptions): RunHandle {
    const traces = this.traces;
    let raf = 0;
    let cursor = 0;
    let elapsed = 0;
    let pace = Number.isFinite(speed) && speed > 0 ? speed : 1;
    let last = performance.now();
    let stopped = false;
    let paused = false;
    let ended = false;

    const tick = (now: number): void => {
      if (stopped || paused || ended) return;

      // The step is clamped to one 30fps frame. requestAnimationFrame does not fire in a
      // background tab, so an unclamped delta charges the whole away-time to the run at
      // once — come back after a minute and the entire trace file lands in a single frame,
      // which is not a replay of anything. Time the user did not watch is not time the run
      // gets to spend.
      elapsed += Math.min((now - last) / 1000, 1 / 30) * pace;
      last = now;

      while (cursor < traces.length && traces[cursor].t <= elapsed) {
        onEvent(traces[cursor]);
        cursor += 1;
      }

      if (cursor >= traces.length) {
        ended = true;
        onEnd();
        return;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    const control: RunHandle = {
      pause() {
        if (stopped || ended || paused) return "unavailable";
        paused = true;
        cancelAnimationFrame(raf);
        return "applied";
      },

      resume() {
        if (stopped || ended || !paused) return "unavailable";
        paused = false;

        // The clock is not paid for the time it spent held: `last` is re-anchored to now,
        // so `elapsed` resumes at exactly the value it stopped at. The cursor never moved,
        // so no trace is skipped and none arrives in a catch-up burst.
        last = performance.now();
        raf = requestAnimationFrame(tick);
        return "applied";
      },

      stop() {
        stopped = true;
        cancelAnimationFrame(raf);
      },
    };

    control.replay = {
      seek(nextCursor) {
        if (stopped) return cursor;
        cancelAnimationFrame(raf);
        const requested = Number.isFinite(nextCursor) ? Math.trunc(nextCursor) : cursor;
        cursor = Math.max(0, Math.min(traces.length, requested));
        elapsed = cursor === 0 ? 0 : traces[cursor - 1].t;
        ended = cursor >= traces.length;
        last = performance.now();
        if (!paused && !ended) raf = requestAnimationFrame(tick);
        return cursor;
      },
      step() {
        if (stopped || ended || !paused || cursor >= traces.length) return false;
        const next = traces[cursor];
        cursor += 1;
        elapsed = Math.max(elapsed, next.t);
        onEvent(next);
        if (cursor >= traces.length) {
          ended = true;
          onEnd();
        }
        return true;
      },
      setSpeed(nextSpeed) {
        if (Number.isFinite(nextSpeed) && nextSpeed > 0) pace = nextSpeed;
      },
      cursor() {
        return cursor;
      },
    };

    return control;
  }
}

/**
 * Reads the same event stream off a live orchestrator (`codex exec` over a socket).
 * Wired but not selected this week: the hosted demo has no orchestrator behind it,
 * and a button that pretends to spawn agents it cannot spawn is exactly the thing
 * this repo refuses to ship.
 */
export class LiveTransport implements RunTransport {
  readonly mode = "live" as const;
  private bundle: RunBundle | null = null;
  constructor(
    private readonly endpoint: string,
    private readonly bundleUrl: string,
  ) {}

  async load(): Promise<RunBundle> {
    const bundle = await json<RunBundle>(this.bundleUrl);
    assertRunBundle(bundle, `Live Studio bundle ${this.bundleUrl}`);
    assertPreflightEvidence(bundle, `Live Studio bundle ${this.bundleUrl} preflight evidence`);
    this.bundle = bundle;
    return bundle;
  }

  stream({ onEvent, onEnd, onAbort }: StreamOptions): RunHandle {
    const socket = new WebSocket(this.endpoint);
    const bundle = this.bundle;
    const scope = bundle
      ? {
          agents: new Set(["orchestrator", ...bundle.run.agents.map((agent) => agent.id)]),
          cues: new Set(bundle.captions.cues.map((cue) => cue.id)),
          duration: bundle.run.clip.duration,
        }
      : null;

    let ended = false;
    let previousT = -Infinity;
    /** stop() closes the socket, and closing fires "close". A cancelled run is not a finished one. */
    let dead = false;

    const deliver = (trace: Trace): void => {
      if (trace.action === "done") {
        onEvent(trace);
        ended = true;
        onEnd();
        return;
      }
      onEvent(trace);
    };

    /**
     * A live pause is a request, not a fact. The client asks the orchestrator to hold —
     * it owns the decision, and it may be mid-tool-call — and holds the stream on its own
     * side either way. Which of those actually happened is the orchestrator's to report,
     * and the UI must not claim the agents stopped when only the view did.
     */
    const ask = (type: "pause" | "resume"): void => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type }));
    };

    socket.addEventListener("message", (e: MessageEvent<string>) => {
      if (dead || ended) return;
      try {
        if (!scope) throw new Error("Live Studio transport must load and validate its bundle before streaming");
        const trace: unknown = JSON.parse(e.data);
        assertTrace(trace, "Live Studio event", scope, previousT);
        if (trace.action === "done" && trace.agent !== "orchestrator") {
          throw new Error("Live Studio event: only the orchestrator can acknowledge completion");
        }
        previousT = trace.t;
        deliver(trace);
      } catch (error) {
        dead = true;
        socket.close();
        onAbort?.(error instanceof Error ? error.message : "The live runtime emitted an invalid event.");
      }
    });

    socket.addEventListener("close", () => {
      // A run the user killed did not finish. Reporting it as finished would put a result
      // and a score on screen for a swarm that was cut off mid-sentence.
      if (dead || ended) return;
      onAbort?.("The live runtime disconnected before it acknowledged completion.");
    });

    return {
      pause() {
        if (dead || ended) return "unavailable";
        ask("pause");
        // There is no acknowledgement producer yet. The UI may say the request was sent,
        // but it must keep projecting the run as live until the runtime says otherwise.
        return socket.readyState === WebSocket.OPEN ? "requested" : "unavailable";
      },

      resume() {
        // A pause is never locally claimed, so there is no acknowledged held state to resume.
        return "unavailable";
      },

      stop() {
        if (dead) return;
        dead = true;
        // Stopping is destructive, and that is the entire difference from pausing.
        socket.close();
      },
    };
  }
}
