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
  LanguagePack,
  RunManifest,
  ScoreFile,
  Trace,
  WaveFile,
} from "./types";

export interface RunBundle {
  run: RunManifest;
  captions: CaptionsFile;
  score: ScoreFile;
  pack: LanguagePack;
  wave: WaveFile;
  traces: Trace[];
}

export interface StreamOptions {
  /** Wall-clock multiplier. 1 = the run's real recorded pace. */
  speed: number;
  onEvent: (trace: Trace) => void;
  onEnd: () => void;
}

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
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface RunTransport {
  load(): Promise<RunBundle>;
  /** Begin emitting agent events. Returns the handle that controls the run. */
  stream(options: StreamOptions): RunHandle;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`studio: cannot load ${url} (${res.status})`);
  return (await res.json()) as T;
}

/** Replays a run recorded to disk, on a clock. */
export class ReplayTransport implements RunTransport {
  private traces: Trace[] = [];

  constructor(private readonly runId: string) {}

  async load(): Promise<RunBundle> {
    const base = `/demo/runs/${this.runId}`;

    const [run, captions, score, wave, traceFile] = await Promise.all([
      json<RunManifest>(`${base}/run.json`),
      json<CaptionsFile>(`${base}/captions.json`),
      json<ScoreFile>(`${base}/score.json`),
      json<WaveFile>(`${base}/waveform.json`),
      json<{ traces: Trace[] }>(`${base}/traces.json`),
    ]);

    // The language pack is cross-run memory, so it lives outside the run folder.
    const pack = await json<LanguagePack>(`/demo/packs/${run.pack}.json`);

    this.traces = traceFile.traces;
    return { run, captions, score, pack, wave, traces: this.traces };
  }

  stream({ speed, onEvent, onEnd }: StreamOptions): RunHandle {
    let raf = 0;
    let cursor = 0;
    let elapsed = 0;
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
      elapsed += Math.min((now - last) / 1000, 1 / 30) * speed;
      last = now;

      while (cursor < this.traces.length && this.traces[cursor].t <= elapsed) {
        onEvent(this.traces[cursor]);
        cursor += 1;
      }

      if (cursor >= this.traces.length) {
        ended = true;
        onEnd();
        return;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return {
      pause() {
        if (stopped || ended || paused) return;
        paused = true;
        cancelAnimationFrame(raf);
      },

      resume() {
        if (stopped || ended || !paused) return;
        paused = false;

        // The clock is not paid for the time it spent held: `last` is re-anchored to now,
        // so `elapsed` resumes at exactly the value it stopped at. The cursor never moved,
        // so no trace is skipped and none arrives in a catch-up burst.
        last = performance.now();
        raf = requestAnimationFrame(tick);
      },

      stop() {
        stopped = true;
        cancelAnimationFrame(raf);
      },
    };
  }
}

/**
 * Reads the same event stream off a live orchestrator (`codex exec` over a socket).
 * Wired but not selected this week: the hosted demo has no orchestrator behind it,
 * and a button that pretends to spawn agents it cannot spawn is exactly the thing
 * this repo refuses to ship.
 */
export class LiveTransport implements RunTransport {
  constructor(
    private readonly endpoint: string,
    private readonly bundleUrl: string,
  ) {}

  async load(): Promise<RunBundle> {
    return json<RunBundle>(this.bundleUrl);
  }

  stream({ onEvent, onEnd }: StreamOptions): RunHandle {
    const socket = new WebSocket(this.endpoint);

    let paused = false;
    let ended = false;
    let closed = false;
    /** stop() closes the socket, and closing fires "close". A cancelled run is not a finished one. */
    let dead = false;

    /**
     * Traces that landed while the run was held. A live orchestrator is a real process:
     * it does not stop because the client looked away, and traces already in flight will
     * arrive no matter what the UI thinks. So they are kept, in arrival order, and folded
     * in on resume. Dropping them would silently rewrite what the swarm did.
     */
    const held: Trace[] = [];

    const deliver = (trace: Trace): void => {
      if (trace.action === "done") {
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
      const trace = JSON.parse(e.data) as Trace;
      if (paused) {
        held.push(trace);
        return;
      }
      deliver(trace);
    });

    socket.addEventListener("close", () => {
      closed = true;
      // A run the user killed did not finish. Reporting it as finished would put a result
      // and a score on screen for a swarm that was cut off mid-sentence.
      if (dead || ended || paused) return;
      onEnd();
    });

    return {
      pause() {
        if (dead || ended || paused) return;
        paused = true;
        ask("pause");
      },

      resume() {
        if (dead || ended || !paused) return;
        paused = false;
        ask("resume");

        // Everything that arrived while held, in the order it arrived. Nothing is skipped.
        while (held.length > 0 && !ended) deliver(held.shift() as Trace);
        if (closed && !ended) onEnd();
      },

      stop() {
        if (dead) return;
        dead = true;
        paused = false;
        // Stopping is destructive, and that is the entire difference from pausing.
        held.length = 0;
        socket.close();
      },
    };
  }
}
