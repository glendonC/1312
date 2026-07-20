# Architecture

<!--
Document type: Architecture reference
Lifecycle: Stable
Authority: Module boundaries, dependency direction, and durable system shape
Last verified: 2026-07-20
Update when: A stable boundary changes
-->

Start with [How the system fits together](#how-the-system-fits-together). Read further only if you
are changing code boundaries.

Product identity: [`PRODUCT.md`](./PRODUCT.md). Current milestones:
[`build-week/STATUS.md`](./build-week/STATUS.md). Runtime contract detail:
[`RUNTIME_CONTRACTS.md`](./RUNTIME_CONTRACTS.md). This file owns **how the code is shaped**,
not the product pitch and not the milestone diary.

## How the system fits together

```text
Public site (Astro)          Studio product app (React)
  /, /method/, /journey/  →    /studio/
                                     │
              source adapters ───────┤──► receipts (withheld if unsupported)
                                     │
              local runtime ─────────┤──► grants, journal, artifacts
                                     │
              caged Codex child ─────┘──► private outputs
                                              │
                         bench/ + gated memory/ (offline compounding)
```

1. The marketing site and Studio are separate. Studio is the product UI.
2. Media enters only through adapters that emit rights and identity receipts.
3. Detectors and agents do not invent facts. Unsupported states stay unavailable, unknown, or
   withheld.
4. Runtime authority is grants, an append-only journal, and content-addressed artifacts. Detail:
   [`RUNTIME_CONTRACTS.md`](./RUNTIME_CONTRACTS.md).
5. Captions and learning are Apply uses of checked understanding, not the category. See
   [`PRODUCT.md`](./PRODUCT.md).

With the local runtime host, Studio paste / Process locally runs real ingest. **Explore a
recording** is the recorded run-006 demo. Recorded replay is not live execution. Hosted cloud
ingest on the public site is not available yet.

## Stack (short)

| Layer | Choice |
|---|---|
| Public site + Studio shell | Astro static site; Studio as an isolated React island |
| Agent runtime | Sandboxed `codex exec` behind a host cage ([`CODEX.md`](./CODEX.md)) |
| Media ingest | Source adapter → rights receipt → content-addressed workspace media |
| Language work | Models behind seams; code enforces honesty gates |
| Persistence | Local workspace folders + JSON/SQLite (accountless on one machine) |
| Evaluation | Fixed clips + content-addressed scores in `bench/` |
| Public hosting | Static host optional; not a product dependency |

ASR, translation, and detector models are swappable. They are not the brand.

## Frontend boundaries

```text
src/
  pages/        route composition and document metadata only
  features/     domain UI, view models, client behavior, feature-owned styles
  components/   shared visual and loading primitives
  layouts/      document shells
  styles/       global tokens, reset, navigation, buttons, transitions
  studio/       isolated product application
```

- A route assembles a feature; it does not contain the feature implementation.
- Studio CSS loads only on `/studio/`. Public pages must not inherit Studio surface styles.
- Shared components expose only implemented variants.

## Swarm model

```text
Orchestrator (1)
  ├─ inspect job (length, hardness, gaps)
  ├─ spawn Segment / Context / Translate+QC as needed
  ├─ each worker: own live workspace
  └─ workers report UP structured results → merge → QC → outputs
```

- Not a fixed N-browser farm.
- Not all-to-all debate.
- A user can open a worker during or after a run to see seeks, drafts, corrections, and handoff.
- A role or spawn without a granted producer and tool is not capability.

## Source ingest boundary

Provider wire data does not enter the Studio session model directly. Each real ingest producer owns
a strict receipt; an adapter normalizes it into provider-neutral preflight facts:

```text
provider input
  -> provider-specific ingest producer
  -> provider-specific rights and range receipt
  -> source adapter
  -> normalized preflight facts
```

Language detection, acoustic classification, overlap estimation, and range recommendation are
separate producers. A source adapter cannot infer those facts from a provider name or filename.

| Preflight fact | Current producer | Status |
|---|---|---|
| Source URL, creator, licence, selected range | `scripts/ingest-clip.mjs` | Receipted (`source.json`) |
| Owned local bytes, SHA-256, rights scope | `scripts/ingest-owned-media.mjs` | Receipted (`source.json`) |
| Container, codecs, durations, tracks | `scripts/probe-media.mjs` | Receipted (`media-probe.json`) |
| Speech / non-speech windows | `scripts/detect-speech.mjs` | Receipted (V2 lineage) |
| Language ranges over speech windows | `scripts/detect-language.mjs` | Receipted (V3 lineage) |
| Music, noise, speakers, overlap | None | Withheld |
| Suggested range / processing class | None | Withheld |

Pin revisions, ONNX versions, and producer script detail live in
[Appendix: preflight producers](#appendix-preflight-producers).

## Production runtime boundary

Proposal fixtures in `src/studio/runtime/contracts.ts` are fixture-only and production-inert.
Production code lives under `src/studio/runtime/production/`.

**Authority spine (summary):**

- Versioned event protocol, append-only journal, pure projection
- Bounded scheduler (task identity, depth, grants, reservations)
- Content-addressed artifact store and centralized authorization
- Host-owned media, evidence, assessment, decision, review, caption, and QC boundaries
- Bounded local `codex exec` launcher with task-private MCP tools only when granted

**Standing shape (not a capability list):**

- Local runtime and smoke-tested paths, not a hosted cloud ingest service
- Private captions are not upload, CDN, or public publication
- Structural QC / coverage is not semantic quality
- Detector output is not transcription, understanding, or translation
- Replay and Studio animation are not live swarm execution

Full contract inventory: [`RUNTIME_CONTRACTS.md`](./RUNTIME_CONTRACTS.md). Product-launched Codex
cage: [`CODEX.md`](./CODEX.md). Studio UI meaning and unavailable states:
[`STUDIO_PRODUCT_CONTRACT.md`](./STUDIO_PRODUCT_CONTRACT.md).

### Explicitly deferred

- User accounts / sync
- Fine-tuning weights (consume correction pairs later)
- Private Sori overlay integration (seam only)
- Always-on screen capture as primary ingest

## Artifacts and memory

Per run (shape):

```text
runs/<video_id>/
  captions.json
  corrections.json
  glossary.json
  score.json
  traces/
  evidence.json
```

Shared across runs:

```text
memory/
  glossary/           # legacy unreviewed inputs; never silently promoted
  review/
    proposals/
    decisions/
    materializations/
  rules/              # code-enforced playbooks after a scored promotion gate
bench/
  packs/ + scores/ + receipts
```

**How this compounds for other models**

1. Inject glossary / corrections / rules into the next prompt or tool context.
2. Grade any model on the bench.
3. Fine-tune later on correction pairs.

Markdown is optional human receipt only.

**Memory promotion:** future runs write run-scoped output and immutable proposals. They do not write
accepted cross-run memory without a separate accept / reject / revoke decision. Legacy
`memory/glossary/ko.json` stays `legacy_unreviewed` and is not treated as reviewed memory.

## Stable correction schema

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

## Security / product discipline

- User-armed ingest; no silent always-on capture in v1.
- Fail closed / withhold when confidence is junk.
- Only registered source adapters may ingest. Owned files default to the ignored local workspace;
  moving one under `public/` requires both an explicit public flag and redistribution scope.
- Filenames and UI state are not evidence of language, music, identity, overlap, or ownership.
- Do not log secrets into traces.

## Open questions (do not block UI)

- Exact computer-use host for worker workspaces (Codex CUA vs embedded browser/player).
- Which local service should stream production journals to the separate Studio adapter; the static
  Studio remains an inspector, not the worker host.
- Public GitHub visibility when submission rules require it.

Roadmap checklists and “what is Done” live in [`build-week/STATUS.md`](./build-week/STATUS.md),
not here.

---

## Appendix: preflight producers

Detail for operators changing ingest or detector pins. General readers can stop above.

`scripts/ingest-clip.mjs` produces the YouTube receipt. Its `channel` and `video_id` fields stop at
the YouTube adapter. `scripts/ingest-owned-media.mjs` is the owned/local producer. It requires an
explicit operator label, rights holder, processing scope, and attestation; identifies the exact raw
bytes with SHA-256; defaults to the ignored `.studio/runs/` workspace; and refuses a public
destination unless redistribution was explicitly authorized. The original basename is retained as
provenance only. It cannot supply a title, owner, creator, identity, language, or acoustic claim.

The owned/local receipt records the byte-identical raw artifact and a hash of each derived receipt.
The media probe records the raw content id and byte count it inspected. Runtime loading checks
closed receipt shapes and cross-receipt identities; the production build hashes artifacts on disk
and rejects a mismatch. Provider-specific fields are not optionalized into a shared bag.

`scripts/preflight-owned-media.mjs` composes those producers into an immutable
`studio.preflight-bundle.v1` index (normalized raw artifact, source receipt, ffprobe receipt). It
withholds every detector finding.

`studio.preflight-bundle.v2` is a separate extension. `scripts/detect-speech.mjs` normalizes one
selected audio track to preserved 16 kHz mono signed 16-bit PCM with a hashed ffmpeg binary, then
runs vendored Silero VAD 6.2.1 ONNX through pinned `onnxruntime-node` 1.27.0 CPU inference. The
receipt retains model, runtime, normalization identities, every 512-sample frame probability, and
an exact speech/non-speech sample partition. `scripts/seal-speech-preflight.mjs` re-hashes that
evidence and writes `preflight-v2.json` without replacing `preflight.json`.

`run-005` is a checked production-validator fixture over project-owned bytes, not a production
worker run. `scripts/detect-language.mjs` reads only normalized PCM ranges in the validated speech
receipt and V2 lineage. The local producer uses pinned `Xenova/whisper-tiny` q8 ONNX at revision
`5332fcc35e32a33b86612b9a57a89be7906102b1`, Transformers.js 4.2.0, and nested ONNX Runtime 1.24.3.
It receipts model/licence evidence files, runtime identities, platform, execution mode, thread
counts, graph optimization, the 99-language token set, logits, and restricted softmax scores.

Each receipted speech window is partitioned into at most 30-second chunks. Chunks shorter than one
second are withheld; measured chunks are classified only when the top model probability is at least
0.5 and the top-two margin is at least 0.15, otherwise the decision is first-class unknown. Scores
are explicitly uncalibrated. `scripts/seal-language-preflight.mjs` writes `preflight-v3.json`
without replacing V1 or V2. Studio projects validated language ranges separately from
`run.clip.lang`, the translation target, and the selected language pack.

The local production test proves byte equality across repeated executions inside the recorded
model/runtime/execution-provider/configuration envelope. Arbitrary cross-platform floating-point
equality has not been established, so the runtime platform and binary are part of the receipt.
