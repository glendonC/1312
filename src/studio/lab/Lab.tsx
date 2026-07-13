import { useMemo, useState } from "react";

import { clock } from "../format";
import { phaseOf } from "../replay";
import { replayTransport, useStudio } from "../store";
import { deriveCheckpoints } from "./checkpoints";
import { inspectCursor } from "./inspect";
import { resolveScenarioCursor, SCENARIOS } from "./scenarios";

import "./lab.css";

export default function Lab({ defaultRunId }: { defaultRunId: string }) {
  const bundle = useStudio((state) => state.bundle);
  const stage = useStudio((state) => state.stage);
  const state = useStudio((current) => current.state);
  const paused = useStudio((current) => current.paused);
  const speed = useStudio((current) => current.speed);
  const pause = useStudio((current) => current.pause);
  const resume = useStudio((current) => current.resume);
  const seekCursor = useStudio((current) => current.seekCursor);
  const stepTrace = useStudio((current) => current.stepTrace);
  const reset = useStudio((current) => current.reset);
  const setSpeed = useStudio((current) => current.setSpeed);

  const [scenarioId, setScenarioId] = useState("current-run");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const total = bundle?.traces.length ?? 0;
  const cursor = stage === "run" ? state.cursor : 0;
  const phase = stage === "run" ? phaseOf(state, bundle?.captions.cues.length ?? 0) : "Ready";
  const checkpoints = useMemo(() => (bundle ? deriveCheckpoints(bundle) : []), [bundle]);
  const inspection = useMemo(
    () => (bundle && stage === "run" ? inspectCursor(bundle, cursor) : null),
    [bundle, cursor, stage],
  );

  async function chooseScenario(nextId: string): Promise<void> {
    const scenario = SCENARIOS.find((candidate) => candidate.id === nextId);
    if (!scenario) return;
    setScenarioId(nextId);
    setBusy(true);
    try {
      if (useStudio.getState().bundle?.run.id !== scenario.runId) {
        await useStudio.getState().boot(replayTransport(scenario.runId));
      }
      const nextBundle = useStudio.getState().bundle;
      if (!nextBundle) return;
      const nextCursor = resolveScenarioCursor(nextBundle, scenario);
      useStudio.getState().seekCursor(nextCursor);
    } finally {
      setBusy(false);
    }
  }

  function jump(phaseName: string, checkpointCursor: number | null): void {
    if (phaseName === "Ready") reset();
    else if (checkpointCursor !== null) seekCursor(checkpointCursor);
  }

  return (
    <aside className="studio-lab" data-collapsed={collapsed} aria-label="Studio trace lab">
      <header className="lab-head">
        <span>
          <b>Trace lab</b>
          <small>development only</small>
        </span>
        <button
          type="button"
          className="lab-collapse"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand trace lab" : "Collapse trace lab"}
        >
          {collapsed ? "+" : "−"}
        </button>
      </header>

      {!collapsed && (
        <div className="lab-body">
          <label className="lab-field">
            <span>Exact scenario</span>
            <select
              value={scenarioId}
              disabled={busy}
              onChange={(event) => void chooseScenario(event.currentTarget.value)}
            >
              {SCENARIOS.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.label}
                </option>
              ))}
            </select>
          </label>

          <p className="lab-note">
            {SCENARIOS.find((scenario) => scenario.id === scenarioId)?.note ??
              `Current recorded run: ${defaultRunId}`}
          </p>

          <div className="lab-readout" aria-live="polite">
            <span>{phase}</span>
            <b>
              {cursor} / {total}
            </b>
            {inspection?.trace && <small>{clock(inspection.trace.t, true)} wall</small>}
          </div>

          <div className="lab-actions">
            <button
              type="button"
              onClick={paused ? resume : pause}
              disabled={stage !== "run" || state.status === "complete"}
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={stepTrace}
              disabled={!bundle || state.status === "complete"}
            >
              Step one
            </button>
            <button type="button" onClick={() => void chooseScenario(scenarioId)} disabled={busy}>
              Restart scenario
            </button>
          </div>

          <label className="lab-field">
            <span>Trace cursor</span>
            <input
              type="range"
              min={0}
              max={total}
              step={1}
              value={cursor}
              disabled={!bundle}
              onChange={(event) => seekCursor(event.currentTarget.valueAsNumber)}
              aria-valuetext={`${cursor} of ${total} traces`}
            />
          </label>

          <label className="lab-field lab-speed">
            <span>Playback speed</span>
            <select value={speed} onChange={(event) => setSpeed(Number(event.currentTarget.value))}>
              {[0.5, 1, 2, 4, 6, 12, 24].map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>

          <div className="lab-checkpoints" role="group" aria-label="Reducer checkpoints">
            {checkpoints.map((checkpoint) => (
              <button
                type="button"
                key={checkpoint.phase}
                onClick={() => jump(checkpoint.phase, checkpoint.cursor)}
                disabled={checkpoint.phase !== "Ready" && checkpoint.cursor === null}
                aria-pressed={phase === checkpoint.phase}
              >
                {checkpoint.phase}
              </button>
            ))}
          </div>

          <details className="lab-inspector" open>
            <summary>Current trace and support</summary>
            {inspection?.trace ? (
              <>
                <dl>
                  <div>
                    <dt>Producer</dt>
                    <dd>{inspection.trace.agent}</dd>
                  </div>
                  <div>
                    <dt>Task</dt>
                    <dd>{inspection.task}</dd>
                  </div>
                  <div>
                    <dt>Media</dt>
                    <dd>
                      {inspection.media?.clipTime == null ? "No media time" : clock(inspection.media.clipTime, true)}
                    </dd>
                  </div>
                </dl>
                <pre>{JSON.stringify(inspection, null, 2)}</pre>
              </>
            ) : (
              <p>No trace has been folded yet.</p>
            )}
          </details>
        </div>
      )}
    </aside>
  );
}
