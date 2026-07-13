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

export interface RunTransport {
  load(): Promise<RunBundle>;
  /** Begin emitting agent events. Returns a stop function. */
  stream(options: StreamOptions): () => void;
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

  stream({ speed, onEvent, onEnd }: StreamOptions): () => void {
    let raf = 0;
    let cursor = 0;
    let elapsed = 0;
    let last = performance.now();
    let stopped = false;

    const tick = (now: number): void => {
      if (stopped) return;

      elapsed += ((now - last) / 1000) * speed;
      last = now;

      while (cursor < this.traces.length && this.traces[cursor].t <= elapsed) {
        onEvent(this.traces[cursor]);
        cursor += 1;
      }

      if (cursor >= this.traces.length) {
        onEnd();
        return;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
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

  stream({ onEvent, onEnd }: StreamOptions): () => void {
    const socket = new WebSocket(this.endpoint);

    socket.addEventListener("message", (e: MessageEvent<string>) => {
      const trace = JSON.parse(e.data) as Trace;
      if (trace.action === "done") onEnd();
      else onEvent(trace);
    });

    socket.addEventListener("close", onEnd);

    return () => socket.close();
  }
}
