# Architecture (verified direction — UI-first week)

Status: **decided for Build Week**; implement agents after UI scaffold is solid.  
Last updated: 2026-07-14

## Goals

- Maximize **Codex / GPT-5.6** (computer use, multi-agent, measurable loop).
- Ship a **complete product experience** (ingest → swarm UI → captions/study → scores).
- Keep long-term path open for fine-tune + better ASR **without** throwing away schemas.

## Recommended stack (UI now → agents next)

| Layer | Choice | Why |
|-------|--------|-----|
| Marketing + Studio UI | **Astro static** + light CSS (this repo) | Fast, matches Sori site pattern |
| Studio interactivity | **React island** inside the static Astro route | Event-sourced product state without turning the public site into an SPA |
| Agent runtime | **Codex app / `codex exec`** + orchestrator scripts (Yolodex-like skills) | Contest-native; parallel worktrees/workspaces |
| Media ingest | Source adapter → rights receipt → content-addressed workspace media | YouTube and owned/local producers exist; hosted upload remains unimplemented |
| ASR (v1) | Whisper-family or cloud ASR behind a seam | Swappable; not the brand |
| Translation / repair | GPT-5.6 specialists + QC gates | Model does language work; code enforces honesty |
| Persistence | Local workspace folders + **JSON/SQLite** | Accountless compounding on one machine |
| Eval | Fixed clips + `score.json` | Yolodex-style iterate-until-target |
| Hosting demo | Vercel / Cloudflare Pages / `*.pages.dev` | Skip expensive `1321.ai` for now |

## Frontend boundaries

The public site follows four explicit layers so new surfaces do not grow back into route-level god files:

```text
src/
  pages/        route composition and document metadata only
  features/     domain UI, view models, client behavior, and feature-owned styles
  components/   genuinely shared visual and loading primitives
  layouts/      document shells shared across unrelated features
  styles/       global tokens, reset, navigation, buttons, and transitions only
  studio/       isolated product application
```

- A route should assemble a feature, not contain its implementation.
- Feature data derivation belongs in a typed model rather than an Astro frontmatter block.
- Client enhancement code lives beside its feature and binds once across Astro transitions.
- Responsive rules stay with the feature they change.
- Studio CSS is loaded only by `/studio/`; public pages must not inherit the product application's surface styles.
- Shared components expose only implemented variants. Future states are added when their behavior and visuals exist.

## Source ingest boundary

Provider wire data does not enter the Studio session model directly. Each real ingest producer owns
a strict receipt and a matching adapter normalizes it into provider-neutral preflight facts:

```text
provider input
  -> provider-specific ingest producer
  -> provider-specific rights and range receipt
  -> source adapter
  -> normalized preflight facts
```

`scripts/ingest-clip.mjs` produces the YouTube receipt. Its `channel` and `video_id` fields stop at
the YouTube adapter. `scripts/ingest-owned-media.mjs` is the owned/local producer. It requires an
explicit operator label, rights holder, processing scope, and attestation; identifies the exact raw
bytes with SHA-256; defaults to the ignored `.studio/runs/` workspace; and refuses a public
destination unless redistribution was explicitly authorized. The original basename is retained as
provenance only. It cannot supply a title, owner, creator, identity, language, or acoustic claim.

The owned/local receipt records the byte-identical raw artifact and a hash of each derived receipt.
The media probe in turn records the raw content id and byte count it actually inspected. Runtime
loading checks the closed receipt shapes and cross-receipt identities; the production build hashes
the artifacts on disk and rejects a mismatch. Provider-specific fields are not optionalized into a
shared bag, and scripts that consume `source.json` normalize it through a source adapter first.

`scripts/preflight-owned-media.mjs` composes those two existing producers into an immutable,
standalone `studio.preflight-bundle.v1` index. The index contains only the normalized raw artifact,
source receipt, and ffprobe receipt. It remains immutable and continues to withhold every detector
finding.

The first detector-backed extension is a separate `studio.preflight-bundle.v2`; it does not rewrite
the V1 index or the source receipt. `scripts/detect-speech.mjs` normalizes one explicitly selected
audio track to preserved 16 kHz mono signed 16-bit PCM with a hashed ffmpeg binary, then runs the
vendored Silero VAD 6.2.1 ONNX model through pinned `onnxruntime-node` 1.27.0 CPU inference. The
receipt retains the exact model, runtime, and normalization identities, every 512-sample frame
probability, and an exact speech/non-speech sample partition. `scripts/seal-speech-preflight.mjs`
re-hashes that evidence and writes `preflight-v2.json` without replacing `preflight.json`.

`run-005` is a checked production-validator fixture over project-owned bytes, not a production
worker run. Its V1 and V2 indexes are both retained. A third immutable extension is produced by
`scripts/detect-language.mjs`, which reads only the normalized PCM sample ranges in the validated
speech receipt and its V2 lineage. The local producer uses the pinned `Xenova/whisper-tiny` q8 ONNX
export at revision `5332fcc35e32a33b86612b9a57a89be7906102b1`, Transformers.js 4.2.0, and its
nested ONNX Runtime 1.24.3 CPU engine. It receipts the seven model/licence evidence files, runtime
package and binary identities, platform, execution mode, thread counts, graph optimization, exact
99-language token set, logits, and restricted softmax scores.

Each receipted speech window is partitioned into at most 30-second chunks. Chunks shorter than one
second are withheld; measured chunks are classified only when the top model probability is at least
0.5 and the top-two margin is at least 0.15, otherwise the decision is first-class unknown. The
scores are explicitly uncalibrated. `scripts/seal-language-preflight.mjs` re-hashes the complete
evidence unit and writes `preflight-v3.json` without replacing V1 or V2. The build re-hashes every
artifact named by all three indexes. The Studio projects validated language ranges separately from
`run.clip.lang`, the translation target, and the selected language pack; detector output changes
none of those declarations and does not create a replayable recommended range.

The local production test proves byte equality across repeated executions inside the recorded
model/runtime/execution-provider/configuration envelope. Arbitrary cross-platform floating-point
equality has not been established, so the runtime platform and binary are part of the receipt.

Language detection, acoustic classification, overlap estimation, and range recommendation are
separate producers. A source adapter cannot infer any of those facts from a provider or filename.

| Preflight fact | Current producer | Receipt / status |
|---|---|---|
| Source URL, creator, redistribution licence, selected range | `scripts/ingest-clip.mjs` | `YouTubeIngestReceipt` in `source.json` |
| Owned local bytes, SHA-256 identity, explicit rights scope, full-file selection, raw/derived lineage | `scripts/ingest-owned-media.mjs` | `OwnedLocalIngestReceipt` in `source.json` |
| Container, codecs, track durations, sample rate, channels, dimensions | `scripts/probe-media.mjs` using `ffprobe` | content-bound `studio.media-probe.v1` in `media-probe.json` |
| Speech and non-speech windows | `scripts/detect-speech.mjs` using pinned Silero VAD and ONNX Runtime CPU | `studio.speech-activity.v1`, normalized PCM, raw frame scores, and immutable V2 preflight lineage for content-addressed owned media |
| Time-ranged language distribution over receipted speech windows | `scripts/detect-language.mjs` using pinned Xenova Whisper q8, Transformers.js, and ONNX Runtime CPU | `studio.language-ranges.v1`, all 99 language scores, classified/unknown/withheld decisions, and immutable V3 lineage for content-addressed V2 speech evidence |
| Music, noise, speakers, and overlap | None | Withheld |
| Suggested range and processing class | None | Withheld |

## Production runtime boundary

The proposal fixtures in `src/studio/runtime/contracts.ts` remain fixture-only and production-inert.
Production work lives under `src/studio/runtime/production/` and does not import those shapes.

The production runtime provides a versioned event protocol, append-only journal, pure projection,
bounded scheduler, dynamic registry, content-addressed artifact store, centralized authorization,
one real ffmpeg audio-range extraction operation, structured child report-up, and a bounded local
`codex exec` launcher.
Media scopes use exact track ids and half-open integer-millisecond ranges. The scheduler derives
task identity, depth, parentage, ownership, grants, and reservations; callers cannot submit desired
state. The media host re-hashes its source before execution, accepts no caller output path or
arbitrary executable arguments, and records the tool version, input and output identities, grant,
range, receipt, and lineage.

The launcher consumes a scheduler-issued one-use permit, registers the assigned worker, and invokes
the installed Codex CLI with fixed arguments in an isolated temporary directory: ephemeral session,
read-only sandbox, no host environment inherited by model-generated shell commands, JSONL events,
and a closed output schema. The
child currently receives only the structured task contract and can use only `report.submit`; media
capabilities are rejected because no child-process tool bridge exists. Validated output becomes a
private content-addressed worker artifact and is submitted through the existing handoff host.

Executor events receipt monotonic active duration and the CLI version. The launcher consumes the
documented `turn.completed.usage` object rather than logs or budgets, stores the exact raw usage event
by content address, and journals normalized input, cached-input, output, and reasoning-output token
counts. A CLI-default model is not named by that event, so model identity remains null unless the
launcher explicitly requested one; provider units and billing remain null.

This remains a local runtime and exact smoke-tested path, not a hosted service. The legacy
`LiveTransport` still accepts only validated legacy traces for predeclared agents. A separate
production adapter folds `studio.runtime.event.v1` directly and `/studio/runtime/` projects an
operator-selected local journal; neither creates a `RunBundle` nor inserts local activity into a
recorded demo. Seek, step, loop, mark, track selection, frames, live control acknowledgement, and
detector/model tool calls remain unavailable capabilities rather than UI claims.

### Explicitly deferred

- User accounts / sync
- Fine-tuning weights (consume correction pairs later)
- Private Sori overlay integration (seam only)
- Always-on screen capture as primary ingest

## Swarm model (mitosis)

```
Orchestrator (1)
  ├─ inspect job (length, hardness, gaps)
  ├─ spawn Segment / Context / Translate+QC as needed
  ├─ each worker: own live workspace (squircle)
  └─ workers report UP structured results → merge → QC → outputs
```

- **Not** a fixed N-browser farm.
- **Not** all-to-all debate.
- User can open a worker **during/after** to see seeks, drafts, corrections, handoff.

## Artifacts (learning export — not MD-as-brain)

Per run:

```text
runs/<video_id>/
  captions.json       # timed ko / en
  corrections.json    # raw → final + error_type
  glossary.json       # terms / entities
  score.json          # metrics
  traces/             # per-agent action logs
  evidence.json       # deterministic post-run byte and terminal-decision index
```

Shared across runs:

```text
memory/
  glossary/           # legacy unreviewed inputs; never silently promoted
  review/
    proposals/        # immutable, evidence-bound proposed values
    decisions/        # separate reviewer decisions and revocations
    materializations/ # accepted heads plus complete receipt provenance
  rules/              # code-enforced playbooks after a scored promotion gate
bench/
  clips/ + expectations + scorer
```

### How this helps “other models”

1. **Inject** glossary/corrections/rules into the next prompt/tool context.  
2. **Grade** any model on the bench.  
3. **Fine-tune later** a small cleanup/gist model on correction pairs.

MD is optional human receipt only.

### Memory promotion boundary

Future runs write run-scoped glossary output and immutable proposal receipts. They do not write
accepted cross-run memory. A different actor must record an accept, reject, or revoke decision with
a reason; accepted materializations retain proposal, decision, and evidence hashes. Replacement is
an explicit supersession edge and revocation restores the preceding accepted head. The existing
`memory/glossary/ko.json` is preserved byte-for-byte behind a `legacy_unreviewed` snapshot and is not
treated as reviewed memory. Behavioral rules additionally require a matching fully frozen, scored
benchmark receipt; the current protocol draft therefore fails closed.

## Stable correction schema (anti-debt)

```json
{
  "source_video": "id",
  "t_start": 12.4,
  "t_end": 16.1,
  "raw": "…",
  "final": "…",
  "error_type": "homophone|boundary|hallucination|music|other",
  "lang": "ko|en"
}
```

This row shape is future fine-tune data.

## Benchmarks to wire

| Metric | Meaning |
|--------|---------|
| Pack / prep score | Quality after agents finish |
| Δ vs cold | Same clip naive vs prepped |
| Run 1 → N | After memory/rules update |
| vs YouTube auto | Public foil on same minute |
| Coverage | % timed ko+en |
| Time-to-usable | Prep latency |

## Security / product discipline

- User-armed ingest; no silent always-on capture in v1.
- Fail closed / withhold when confidence is junk.
- Only registered source adapters may ingest. Owned files default to the ignored local workspace;
  moving one under `public/` requires both an explicit public flag and redistribution scope.
- Filenames and UI state are not evidence of language, music, identity, overlap, or ownership.
- Don’t log secrets into traces.

## Implementation order

1. ✅ Marketing pages scaffold (`/`, `/method/`, `/journey/`, `/benchmarks/`)
2. ✅ Event-sourced Studio replay shell and development lab
3. ✅ Recorded run schema, build validation, and bench protocol
4. ✅ Provider-separated ingest, owned/local rights receipt, and real ffprobe slice
5. ✅ Standalone preflight index with unsupported detector findings withheld
6. ✅ Local bounded runtime foundation and one scoped media operation
7. ✅ Proposal-first memory gate and retrospective evidence index
8. ✅ Pinned VAD, speech-window language producer, bounded Codex launcher, executor/usage receipts, and separate production-journal Studio projection
9. 🔄 Add the next individually authorized media operation, then build the immutable observability index from real launcher journals
10. ⏳ Acoustic/overlap/separation producers and study export

## Open questions (do not block UI)

- Exact computer-use host for squircles (Codex CUA vs embedded browser/player).  
- Which local service should stream production journals and acknowledged controls to the separate adapter; the static Studio remains an inspector, not the worker host.
- Public GitHub visibility when Devpost rules require it.
