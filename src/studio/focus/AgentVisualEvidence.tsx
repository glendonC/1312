import { clock } from "../format";
import type { AgentView } from "../replay";
import { useStudio } from "../store";
import type { Trace } from "../types";
import type { RunBundle } from "../transport";
import { RecordedMedia } from "../Workspace";

function mediaPercent(value: number, duration: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(100, (value / duration) * 100));
}

export default function AgentVisualEvidence({
  title,
  bundle,
  agent,
  log,
}: {
  title: string;
  bundle: RunBundle;
  agent: AgentView | null;
  log: Trace[];
}) {
  const clipT = useStudio((state) => state.clipT);
  const duration = bundle.run.clip.duration;
  const assignedRange = agent?.window ?? null;
  const agentPlayhead = agent?.playhead ?? null;
  const latestMediaReference = [...log]
    .reverse()
    .find((trace) => typeof trace.clip_t === "number")?.clip_t ?? null;
  const peakStep = Math.max(1, Math.ceil(bundle.wave.peaks.length / 84));
  const peaks = bundle.wave.peaks.filter((_, index) => index % peakStep === 0);
  const scopeLabel = assignedRange
    ? `Assigned ${clock(assignedRange[0])}–${clock(assignedRange[1])}`
    : "No per-agent range recorded";

  return (
    <section className="agent-focus-visual-evidence" aria-labelledby="agent-focus-visual-title">
      <header className="agent-focus-visual-head">
        <div>
          <span>Visual evidence</span>
          <h4 id="agent-focus-visual-title">{bundle.run.clip.title}</h4>
        </div>
        <div className="agent-focus-visual-badges" aria-label="Recorded source context">
          <span>{bundle.run.clip.source.label}</span>
          <span>{scopeLabel}</span>
        </div>
      </header>

      <RecordedMedia bundle={bundle} agentPlayhead={agentPlayhead} />

      <div
        className="agent-focus-evidence-map"
        role="img"
        aria-label={`${title} media evidence. ${scopeLabel}. Human inspection cursor ${clock(clipT)}. ${
          agentPlayhead === null
            ? "No recorded agent playhead."
            : `Recorded agent playhead ${clock(agentPlayhead)}.`
        } ${
          latestMediaReference === null
            ? "No media-linked action recorded."
            : `Latest media-linked action ${clock(latestMediaReference)}.`
        }`}
      >
        <svg
          className="agent-focus-evidence-wave"
          viewBox={`0 0 ${Math.max(1, peaks.length) * 3} 32`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {peaks.map((peak, index) => {
            const height = Math.max(2, peak * 26);
            return (
              <rect
                key={index}
                x={index * 3}
                y={(32 - height) / 2}
                width={1.7}
                height={height}
                rx={0.7}
              />
            );
          })}
        </svg>
        {assignedRange && (
          <span
            className="agent-focus-evidence-range"
            style={{
              left: `${mediaPercent(assignedRange[0], duration)}%`,
              width: `${Math.max(
                0,
                mediaPercent(assignedRange[1], duration)
                - mediaPercent(assignedRange[0], duration),
              )}%`,
            }}
            aria-hidden="true"
          />
        )}
        <span
          className="agent-focus-evidence-marker"
          data-marker="human"
          style={{ left: `${mediaPercent(clipT, duration)}%` }}
          aria-hidden="true"
        />
        {agentPlayhead !== null && (
          <span
            className="agent-focus-evidence-marker"
            data-marker="agent"
            style={{ left: `${mediaPercent(agentPlayhead, duration)}%` }}
            aria-hidden="true"
          />
        )}
        {latestMediaReference !== null && (
          <span
            className="agent-focus-evidence-marker"
            data-marker="reference"
            style={{ left: `${mediaPercent(latestMediaReference, duration)}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      <dl className="agent-focus-evidence-legend">
        <div data-marker="human">
          <dt>Human cursor</dt>
          <dd>{clock(clipT)}</dd>
        </div>
        <div data-marker="agent">
          <dt>Agent playhead</dt>
          <dd>{agentPlayhead === null ? "Not recorded" : clock(agentPlayhead)}</dd>
        </div>
        <div data-marker="reference">
          <dt>Latest media action</dt>
          <dd>{latestMediaReference === null ? "Not recorded" : clock(latestMediaReference)}</dd>
        </div>
      </dl>

      <p className="agent-focus-evidence-boundary">
        Playback is your inspection cursor. Agent markers come only from recorded events.
      </p>
    </section>
  );
}
