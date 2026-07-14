import { useMemo } from "react";

import { useBundle, useStudio } from "../store";
import type { MediaProbeTrack } from "../types";
import ConfirmationForm, { AdvancedFields } from "./ConfirmationForm";
import { assessRecordedRequest, formatSeconds, type PreflightSession } from "./model";

import "./preflight.css";

export default function Preflight() {
  const bundle = useBundle();
  const session = useStudio((state) => state.preflight);
  const update = useStudio((state) => state.updatePreflightRequest);
  const dismiss = useStudio((state) => state.dismissPreflight);
  const cancel = useStudio((state) => state.cancelPreflight);
  const confirm = useStudio((state) => state.confirmPreflight);
  const useRecorded = useStudio((state) => state.openRecordedPreflight);

  const assessment = useMemo(
    () => (bundle ? assessRecordedRequest(session, bundle, import.meta.env.DEV) : null),
    [bundle, session],
  );

  if (session.status === "idle") return null;

  if (session.status !== "ready" || !session.facts || !bundle) {
    const fixture = session.provenance.kind === "contract_fixture";
    return (
      <section className="preflight" aria-labelledby="preflight-title">
        <header className="preflight-head">
          <span className="preflight-kicker">Source preflight</span>
          <h1 id="preflight-title">{session.title}</h1>
          <p>{session.message}</p>
        </header>

        {fixture && (
          <p className="preflight-fixture" role="note">
            Development contract fixture only. No source measurement or worker event was produced.
          </p>
        )}

        <Provenance session={session} />
        <AdvancedFields request={session.request} update={update} relevance={session.relevance} />

        <div className="preflight-actions">
          <button type="button" className="ghost" onClick={dismiss}>
            {session.status === "cancelled" ? "Close" : "Try another source"}
          </button>
          {session.status !== "loading_source" && session.status !== "probing" && (
            <button type="button" className="cta" onClick={useRecorded}>
              Use recorded source
            </button>
          )}
        </div>
      </section>
    );
  }

  const { facts } = session;

  return (
    <section className="preflight" aria-labelledby="preflight-title">
      <header className="preflight-head">
        <span className="preflight-kicker">Confirm recorded source</span>
        <h1 id="preflight-title">{facts.title}</h1>
        <p>{session.message}</p>
      </header>

      <dl className="preflight-facts">
        <div>
          <dt>Access receipt</dt>
          <dd>Successfully ingested when recorded</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{facts.creator ?? "Creator not recorded"}</dd>
        </div>
        <div>
          <dt>Licence</dt>
          <dd>{facts.rights.label}</dd>
        </div>
        <div>
          <dt>Selected window</dt>
          <dd>
            {facts.selection.sourceStart}–{facts.selection.sourceEnd} · {formatSeconds(facts.selection.duration)}
          </dd>
        </div>
        <div>
          <dt>Recorded media</dt>
          <dd>
            {facts.playableMedia ? "Playable artifact" : "No playable artifact"} · {facts.waveformSamples} waveform samples
          </dd>
        </div>
        {facts.mediaProbe && (
          <div>
            <dt>Tracks</dt>
            <dd>{mediaSummary(facts.mediaProbe.container, facts.mediaProbe.tracks)}</dd>
          </div>
        )}
        <div>
          <dt>Language</dt>
          <dd>{facts.declaredLanguage} declared for the job · not detector output</dd>
        </div>
      </dl>

      <ConfirmationForm
        bundle={bundle}
        session={session}
        facts={facts}
        assessment={assessment}
        update={update}
        cancel={cancel}
        confirm={confirm}
      />
    </section>
  );
}

function mediaSummary(containers: string[], tracks: MediaProbeTrack[]): string {
  const preferred = containers.find((container) => container === "mp4") ?? containers[0] ?? "container unknown";
  const descriptions = tracks.map((track) => {
    if (track.type === "video") return `${track.codec} ${track.width}×${track.height}`;
    if (track.type === "audio") return `${track.codec} ${track.sample_rate}Hz ${track.channels}ch`;
    return `${track.type} ${track.codec}`;
  });
  return [preferred, ...descriptions].join(" · ");
}

function Provenance({ session }: { session: PreflightSession }) {
  return (
    <div className="preflight-provenance">
      <span>Producer</span>
      <b>{session.provenance.producer ?? "none"}</b>
      <p>{session.provenance.note}</p>
      {session.missing.map((gap) => (
        <p key={gap.id}>{gap.label}: {gap.consequence}</p>
      ))}
    </div>
  );
}
