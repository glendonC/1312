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
          <dt>Source receipt</dt>
          <dd>{facts.rights.basis === "ownership_attestation" ? "Owned local bytes receipted" : "Remote source ingested when recorded"}</dd>
        </div>
        <div>
          <dt>{facts.creator ? "Source" : "Creator"}</dt>
          <dd>{facts.creator ?? "Not inferred from ownership or filename"}</dd>
        </div>
        <div>
          <dt>Rights</dt>
          <dd>
            {facts.rights.label}
            {facts.rights.assertedBy ? ` · attested by ${facts.rights.assertedBy}` : ""}
          </dd>
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
        {facts.content && (
          <div>
            <dt>Raw provenance</dt>
            <dd>
              SHA-256 {facts.content.hash.slice(0, 12)}… · {formatBytes(facts.content.bytes)} · {facts.content.preservation.replaceAll("_", " ")}
            </dd>
          </div>
        )}
        {facts.speechActivity && (
          <div data-testid="speech-activity-evidence">
            <dt>Detector-measured speech</dt>
            <dd>
              {formatDetectorSeconds(facts.speechActivity.speechDuration)} speech ·{" "}
              {(facts.speechActivity.coverage * 100).toFixed(1)}% of decoded samples ·{" "}
              {facts.speechActivity.windows.length} speech {facts.speechActivity.windows.length === 1 ? "window" : "windows"}
              <br />
              {facts.speechActivity.windows.length > 0
                ? facts.speechActivity.windows
                    .map(
                      (window) =>
                        `${formatDetectorSeconds(window.startSeconds)}–${formatDetectorSeconds(window.endSeconds)}`,
                    )
                    .join(" · ")
                : "The detector produced no speech windows."}
              <br />
              {facts.speechActivity.producer.id} {facts.speechActivity.producer.version} · model revision{" "}
              {facts.speechActivity.producer.modelRevision.slice(0, 12)}…
            </dd>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDetectorSeconds(seconds: number): string {
  return `${seconds.toFixed(3).replace(/\.?(?:0+)$/, "")}s`;
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
