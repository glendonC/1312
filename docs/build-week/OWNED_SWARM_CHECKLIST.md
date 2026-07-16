# Owned-media swarm depth checklist

Working order: finish and verify each slice before starting the next.

## 1. Range-bound perception and evidence reads

- Status: complete for Slice 1; awaiting commit approval.
- Real: one host-owned operation returns a content-bound `signal`/`digital_silence` observation for one source and granted half-open window; existing detector evidence reads are bound to that source/window and clip intersecting facts to it.
- Missing: speech/word/music/speaker perception and any additional perceptual operation.
- Done when: the closed contract, content-bound receipt, journal/projection, deterministic success cases, and scope/content/window failure cases pass; no returned evidence fact escapes the granted window.
- Fake-claim risk: treating decode success, an audio-activity observation, or preflight evidence as speech understanding, transcription, or media meaning.

## 2. Root -> child round trip

- Status: pending.
- Real: scheduler, one child launch, and report-up primitives exist, but the production proof is host-scripted.
- Missing: a receipt-backed root decision to spawn one bounded child, consume its report, and promote or reject its output.
- Done when: the journal proves request -> grant -> child work -> report -> root decision with exact task, scope, artifact, and receipt lineage, including rejection paths.
- Fake-claim risk: calling a predetermined host sequence agent delegation or synthesis.

## 3. Current-run captions and QC

- Status: pending.
- Real: approval-gated caption production exists; its default executor may be `recorded_real_pipeline_fixture`.
- Missing: current-run caption causality from owned media through child evidence into caption output, followed by an independent QC decision.
- Done when: captions are produced for the current run, every line retains source/window lineage, QC can accept or withhold with receipts, and fixture output is never labeled live cognition.
- Fake-claim risk: presenting recorded captions, coverage counts, or approval as current-run translation quality.

## 4. Richer live swarm UI

- Status: pending.
- Real: production journal projections expose tasks, workers, grants, operations, artifacts, and reports.
- Missing: richer receipt-backed live coordination views.
- Done when: every visible worker, transition, finding, handoff, and promotion is reconstructable from production receipts and absent facts remain absent.
- Fake-claim risk: thought bubbles, inferred activity, or animated coordination without producer evidence.

## Explicit non-goals

- Submitted-URL ingest or download, preflight UI changes, or related browser chrome.
- Multi-agent spawn UI, unlimited recursion, full caption work, replay chrome, or Bet G pack/score expansion.
- Claims of hearing, understanding, translation quality, publication, or swarm autonomy beyond the receipts above.
