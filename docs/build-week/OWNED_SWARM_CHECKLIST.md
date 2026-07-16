# Owned-media swarm depth checklist

Working order: finish and verify each slice before starting the next.

## 1. Range-bound perception and evidence reads

- Status: committed and complete in `b3f1468`.
- Real: one host-owned operation returns a content-bound `signal`/`digital_silence` observation for one source and granted half-open window; existing detector evidence reads are bound to that source/window and clip intersecting facts to it.
- Missing: speech/word/music/speaker perception and any additional perceptual operation.
- Done when: the closed contract, content-bound receipt, journal/projection, deterministic success cases, and scope/content/window failure cases pass; no returned evidence fact escapes the granted window.
- Fake-claim risk: treating decode success, an audio-activity observation, or preflight evidence as speech understanding, transcription, or media meaning.

## 2. Root -> child round trip

- Status: committed and complete in `7a136eb`.
- Real: one root-owned scheduler request receives role-constrained grants, one child consumes a one-use permit under the durable host launch claim, and one reported worker-output artifact receives a content-addressed root promote/reject disposition with exact spawn, scope, grant, execution, report, artifact, and receipt lineage.
- Missing: model-driven root planning or synthesis, more than one child/output, recursion, peer coordination, and autonomous choice of whether or what to delegate; the current root policy remains deterministic host composition.
- Done when: the journal proves request -> grant -> child work -> report -> root decision with exact task, scope, artifact, and receipt lineage, including rejection paths.
- Fake-claim risk: calling the receipted deterministic round trip autonomous planning, multi-agent synthesis, or evidence that the root understood the media.

## 3. Current-run captions and QC

- Status: committed and complete in `85e4ea3`.
- Real: caption production now fails closed unless it can recursively reopen one same-run `promoted_to_root` child output whose granted media scope covers the immutable owned source/window. The candidate input and every timed line retain exact source/content/window, accepted-child, and root-promotion artifact/receipt lineage. A separate host then emits one content-addressed QC receipt: structurally complete `current_run` executor output can be accepted, while incomplete/empty output and every `recorded_real_pipeline_fixture` candidate are withheld. The executor contract pins `cognitionClaim: none`; fixture reuse is pinned `test_demo_only` and cannot take the accept path.
- Missing: semantic caption/translation quality judgment, an LLM judge, a score, public Results/publish wiring, and any larger swarm. Automated acceptance exercises the current-run branch with a bounded test executor seam; this slice records no new live external recognizer/translator result and makes no translation-quality claim.
- Done when: captions are produced for the current run, every line retains source/window lineage, QC can accept or withhold with receipts, and fixture output is never labeled live cognition.
- Fake-claim risk: presenting fixture candidates, structural completeness, line counts, or QC acceptance as live cognition or semantic translation quality.

## 4. Richer live swarm UI

- Status: implemented and verified by the production build and focused projection/runtime tests; awaiting commit approval. Browser assertions cover the development missing-state fixture and the operator-started real-journal path, but could not be executed in this workspace because no supported in-app browser backend was registered.
- Real: the owned/local canvas consumes only `studio.production-projection.v1`. It now exposes every projected task, registered worker, scheduler grant, media operation, bounded evidence read, spawn request/decision, child report, and root promote/reject disposition with their recorded identities and scope. Exact caption candidate lineage now projects source/content, accepted child output, root-promotion receipt, approval receipt, private candidate, and independent caption-QC receipt. A recorded fixture remains labeled `test_demo_only` and its projected QC disposition is `withheld`; a structurally complete `current_run` candidate can project `accepted` while retaining `cognitionClaim: none`. Missing task, grant, handoff, operation, finding, caption, and QC receipts render explicit absent states. Generic topology wires and the six-worker display cap were removed.
- Missing: model-driven root planning/synthesis, more than one child/output, recursion, peer chat, semantic caption or translation-quality judgment, a live external recognizer/translator result in the default fixture path, speech/word/music/speaker perception beyond the existing bounded receipts, publication authority, and executed visual/browser QA in this workspace.
- Done when: every visible worker, transition, finding, handoff, promotion, caption lineage step, and QC disposition is reconstructable from the validated production projection; focused tests prove fixture-withheld and current-run-accepted branches; absent facts remain absent; no UI copy claims replay-agent state, autonomy, semantic quality, or publication.
- Fake-claim risk: treating deterministic host composition as model-driven swarm cognition, treating audio activity or evidence-read counts as media understanding, or treating structural QC acceptance as transcription/translation quality.

## Build Week depth v1 assessment

- All four depth-v1 slices are implemented locally. The checklist becomes complete for Build Week depth v1 only after slice 4 is approved and committed.
- Remaining beyond depth v1: model-driven planning and synthesis, broader bounded perception, multiple children/outputs and recursive coordination, semantic caption/translation evaluation, a default live recognizer/translator producer, public Results/publish authority, and Bet G/public benchmark work.

## Explicit non-goals

- Submitted-URL ingest or download, preflight UI changes, or related browser chrome.
- Multi-agent spawn UI, unlimited recursion, full caption work, replay chrome, or Bet G pack/score expansion.
- Claims of hearing, understanding, translation quality, publication, or swarm autonomy beyond the receipts above.
