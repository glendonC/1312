# RFC 0001 — The Miss-to-Gold Conveyor

Status: **scaffold implemented** (2026-07-14, same day as proposal). The contracts, tools, and
guards below are code: `bench/schemas/gold.schema.json` + `adjudication.schema.json`,
`scripts/lib/bench-gold.mjs`, `scripts/mine-gold-candidates.mjs`, `scripts/freeze-pack.mjs`,
`scripts/score-run.mjs`, the extended `scripts/check-bench.mjs` (discovery, contamination and
routing guards, score-everything, fail-closed drills), the content-bound drafting prompt at
`bench/prompts/gold-drafter-v1/`, its fail-closed materializer, the human worksheet at
`bench/ADJUDICATION.md`, and the ablation-bound rule gate in
`scripts/lib/memory-review.mjs` (invariant 6 — the skeleton key is closed). run-006 is mined and
routed gold (13 candidates). The only candidate-shaped draft is explicitly a non-authoritative
example produced without direct audio audition; no real gold is drafted or adjudicated, and
nothing is frozen or scored. The remaining constraints are an audio-grounded Korean draft, a
second Korean-fluent blinded reviewer, and at least two independently sourced control clips.
Scope: `bench/` contracts, `scripts/` producers, `docs/`. No contact with `src/studio/preflight/*`
(language-detection workstream), `src/features/*`, or `src/pages/*` (UI workstream).
Deliverable of: the 1321 technical north-star review (six repo evidence readers, seven bet
champions, three judges, three adversarial skeptics; judges voted 3–0 for this bet).

## One line

Build the conveyor that turns each run's own misses into **agent-drafted, human-adjudicated,
receipt-frozen gold**, and the scorer/comparator over it — because every learning bet in this
repo (correction pairs, rules, routers, policies) is currently deadlocked on gold that does not
exist, while the fail-closed slots that will receive it are already built and waiting.

## The deadlock this resolves

Verified in-repo on 2026-07-14:

- `scripts/lib/memory-review.mjs:371-388` — an accepted **rule** requires a scored, frozen
  benchmark receipt. `bench/` is `protocol_draft`: no packs, no gold, no scored report has ever
  existed. The most powerful memory kind is structurally unreachable.
- `public/demo/runs/run-006/score.json` — `per_line: []`, `trail: []`, `delta_vs_cold: null`,
  status `unscored`, with the note "this run cannot mark its own homework." The slots are
  deliberately reserved for exactly this artifact.
- `bench/scores/` exists and is empty. `bench/runs/run-006/capture.json` is already pinned
  ("so a later run has something to be compared against"). `bench/schemas/capture.schema.json`
  keys units by **time** and pins `unit.gold` to JSON type `null` so a capture can never carry
  its own answer key.
- One real run (run-006) yields the raw candidates on disk today: 4 `asr_agreement` withholds
  with machine-readable gate `{id, reason}`, 3 uncorroborated commits (`agreement: null`),
  5 ko-v3 phenomenon-flagged hard lines, and 15 inline cold-vs-prepped contrastive pairs.
  Nothing conveys them into `bench/packs/`.

Everything downstream — Run-1→N curves, rule promotion, correction-pair training labels,
router/bandit reward, hard-audio capability deltas — is a promissory note only frozen
adjudicated gold can cash.

## The conveyor

```text
run artifacts (withholds, uncorroborated commits, phenomenon hits, cold/prepped pairs)
  -> mine        scripts/mine-gold-candidates.mjs   derive-only; emits a candidate manifest
  -> route       every mined miss goes to EXACTLY ONE pool: gold-candidate OR training
  -> draft       Codex/GPT-5.6 agents draft korean_gold + critical units as PROPOSALS
  -> adjudicate  two blinded human reviewers; content-bound decision receipts
  -> freeze      scripts/freeze-pack.mjs advances clip status; pack becomes immutable
  -> score       scripts/score-run.mjs fills per_line/trail/delta_vs_cold + score receipt
  -> compare     report-series comparator: Run 1 -> N on the SAME frozen pack
```

Agents draft; humans decide; code freezes; nothing scores itself. This is the same
proposal→decision→materialization separation the memory ledger already enforces, applied to
test data.

## Contracts (all content-addressed, all append-only)

The schemas live in `bench/schemas/` (`gold.schema.json`, `adjudication.schema.json`); the
candidates manifest, pack, freeze, output-labels, and score contracts are enforced by the hand
validators in `scripts/lib/bench-gold.mjs`. The stub directory this RFC originally shipped with
has been retired in favour of the real files.

### `studio.bench.gold.v1` (per clip)

- `pack_id`, `clip_id`, `source` (same provenance shape as `ingest-clip.mjs` receipts)
- `units[]`, keyed by `t_start`/`t_end` **time** (survives diarizer nondeterminism; run-006
  reruns produce 11–15 segments for the same clip)
- per unit: `korean_gold`, `english_guidance`, `critical_units[]` typed by ko-v3 phenomenon id,
  with human-checkable `facts[]` and `catastrophic_if[]` statements for reviewers grading output
  (v1 grading is human-only; nothing evaluates these mechanically)
- `status`: pinned const `candidate` — a gold file can never self-promote. Frozenness is
  established only by the external freeze receipt binding the exact gold bytes plus two blinded
  accept receipts; clip-level frozen state lives in the pack manifest

### `studio.bench.review.v1` (adjudication receipt)

Mirrors `studio.memory.decision.v1`: `reviewer` ≠ drafter, decision content-bound to the exact
candidate bytes (a `candidate` file receipt), reason required, **two receipts from two named,
verifiably distinct humans** to freeze a unit. Reviewer identity must be anchored in more than a
string-inequality check — separate git identities committing the review artifacts, so freeze
ancestry is checkable from commit history rather than self-reported JSON timestamps. (v1
enforces distinct declared name+git identity and reviewer≠drafter; mechanical commit-ancestry
verification is still future work and is documented as such in bench/README.md.)

### `studio.bench.candidates.v1` (mining manifest)

Derive-only output binding each candidate to its run, cue window, gate reading, and the
**routing decision** (`gold` vs `training`) made at mine time. Routing is per whole clip, not
per candidate — the contamination guard operates at clip level, so a split within one clip
would leak — and it is recorded immutably *before* adjudication begins (pre-registered, not
chosen after seeing results). `check-bench` additionally refuses a working tree from which a
historically routed manifest has been deleted.

### `studio.bench.score.v1` (score receipt)

Emitted by `score-run.mjs` into `bench/scores/`: byte bindings to the frozen gold, the freeze
receipt, the pinned capture, and the human output labels; per-unit four-way outcomes
(correct / wrong / withheld / missing, where withheld and missing are mechanical and
correct/wrong exist only as human labels); catastrophic count with the emitted-content
denominator; and `judge` **pinned null** — no model grades anything in v1. If an LLM judge is
ever added it must arrive as a visible schema change carrying a pinned different-family model
and prompt hash plus a sampled human audit receipt, not as a default. `check-bench` re-derives
every score receipt from its bound bytes with the same pure scorer; a receipt that does not
re-derive fails the build.

## Honesty invariants (each mechanical, each fail-closed)

1. **Pre-registration.** Scoring refuses a capture dated on or before the pack's freeze day
   (same-day ordering is unprovable, so same-day fails). `frozen_at` is stamped by
   `freeze-pack.mjs`, never operator-supplied, and cannot predate the adjudication receipts
   that authorize it. Anchoring the freeze date in git commit ancestry so it cannot be forged
   by editing history remains future work — until then, the freeze receipt should be committed
   in the same change that creates it.
2. **Contamination guard — clip/episode level, not byte level.** Byte-level `content_id`
   matching misses knowledge leaks: a glossary entry mined from a *committed* line of clip X
   legally carries the entity a gold unit from a *withheld* line of clip X tests. The guard must
   resolve every memory-proposal evidence artifact to its run and thence to its **source clip or
   episode**, and fail closed if that clip contributes any frozen gold unit.
3. **Exclusive routing.** A clip that contributes gold contributes nothing to glossary, rules,
   correction pairs, or any future training export — ever. This deliberately amends the
   PRODUCT.md core-loop wording ("misses → bench + glossary + …"): one miss feeds **either**
   the bench **or** the learning stream, never both. That is the price of an honest curve.
4. **Score-everything.** Every capture pinned into `bench/runs/` after a pack freeze must have a
   score receipt or `check-bench` fails. Best-of-K rerun cherry-picking becomes structurally
   visible instead of procedurally forbidden.
5. **Variance floor.** Type `diagnostics.run_variance`; measure rerun spread (≥3 reruns of one
   clip); refuse to headline any Run-1→N delta smaller than that spread. At the initial pack
   size (~40–60 units) only step-changes ≥ ~0.25 are resolvable; incremental Run-N vs Run-N+1
   claims wait for ~200+ units.
6. **Ablation-bound rule promotion** — fixes a live gap found during this review:
   `memory-review.mjs` currently accepts a rule given *any* scored frozen report with matching
   `pack_id`. One scored report is a skeleton key for unlimited rules. The gate must instead
   require a **pair** of scored reports on the same frozen pack whose subject configs are
   content-addressed and provably include/exclude the proposed rule (rule `content_id` stamped
   into `result.config`), with the delta recorded in the decision receipt.
7. **Control clips and pack versioning.** Every pack carries ≥2 independently sourced clips not
   mined from own misses (bounds teach-to-the-test drift, since all four real run-006 withholds
   are the same `asr_agreement` failure mode). Rules promoted against pack v_k must also score
   against a later-frozen unseen v_{k+1} before any generalization claim.
8. **Headline stays a dyad.** `critical_meaning.rate` is never shown without catastrophic
   count/denominator and all four outcome counts including withheld — already enforced by
   `check-bench` arithmetic; the comparator must preserve it. No composite score, coverage never
   stands alone, zero-denominator rates stay `null`.

## Boundaries

- **Frozen gold** — immutable test data; never enters prompts, glossary, rules, or training.
- **Proposal memory** — glossary/corrections/rules; run-scoped until a reviewed decision; may
  condition future runs after acceptance.
- **Model weights** — none in year 1. DPO/LoRA on correction pairs is deferred until the
  adjudicated pair count clears ~1k (current yield: ~5 correction rows per run — the flywheel
  spins at tens per month, not thousands). Retrieval-conditioning the repair slot from the
  *accepted* correction ledger needs no training volume and is in-bounds immediately.
- **Offline vs online** — all learning is offline over journaled receipts. Nothing learns
  inside a run. A learned policy, when it exists, deploys as a versioned, content-addressed
  policy artifact behind the same proposal→decision gate as a rule.

## Build Week scaffold (implemented 2026-07-14)

1. ✅ `bench/schemas/gold.schema.json` + `adjudication.schema.json`.
2. ✅ `scripts/mine-gold-candidates.mjs` — derive-only; run-006 mined with `--route gold`
   (4 withheld, 3 uncorroborated, 5 phenomenon, 9 contrast signals over 13 candidates).
   ✅ The missing agent drafting step is now built: content-addressed prompt/evidence bindings at
   `bench/prompts/gold-drafter-v1/`, immutable fail-closed materialization through
   `scripts/draft-gold-from-candidates.mjs`, and the blinded human handoff at
   `bench/ADJUDICATION.md` + `scripts/write-adjudication-receipt.mjs`. The produced run-006 file
   at `bench/examples/gold-drafts/Ux-TMWnmntM.gold.json` is deliberately a non-authoritative
   dry-run fixture, not real gold, because this implementation interface could not audition the
   audio. `status` remains `candidate`; no review or pack state is implied.
3. ✅ `scripts/score-run.mjs` — frozen gold + capture + human output labels → per-line four-way
   outcomes + headline + `delta_vs_cold` in an immutable score receipt under `bench/scores/`.
   Human-labels only; `judge` is pinned null.
4. ✅ `check-bench` extensions — report discovery, gold/adjudication/pack/freeze/score
   validation, pre-registration, clip-level contamination, exclusive routing, score-everything,
   plus fail-closed drills that prove every guard fires on every check.
5. ✅ `scripts/freeze-pack.mjs` — the only mutation tool; `init → source → gold-ready → freeze`,
   freezing only against two distinct blinded human accept receipts binding exact gold bytes.
6. ✅ Invariant 6 — ablation-bound rule promotion in `scripts/lib/memory-review.mjs`, with
   `check-memory` proofs: a single scored report, a mismatched pack, a non-ablation pair, and a
   self-control report all fail; only the honest pair accepts, and the delta is recorded on the
   decision receipt.

Post-week: have a Korean-fluent drafter/reviewer audition and correct the real run-006 candidate,
recruit the second Korean-fluent blinded reviewer (a contractor is fine — without a real second
human, gold is receipt theater), source at least two independent controls, then complete and
freeze `hard-ko-v1` (5 clips). Only after that: first scored report, first ablation-bound rule
acceptance, report-series comparator, pack v2.

## Failure modes

| Mode | Guard |
|---|---|
| Self-graded gold (drafter == judge) | agents draft candidates only; two blinded human receipts freeze; candidates structurally unscoreable |
| Knowledge-level contamination | clip/episode-level guard + exclusive routing (invariants 2–3) |
| Best-of-K curve mining | score-everything (invariant 4) |
| Noise sold as progress | variance floor; step-change-only claims at n≈50 (invariant 5) |
| Skeleton-key rule promotion | ablation-bound acceptance (invariant 6) |
| Teach-to-the-test pack drift | control clips + pack versioning (invariant 7) |
| Withhold-everything / commit-everything gaming | four-way outcome dyad headline (invariant 8) |
| One human wearing two reviewer strings | named distinct identities, separate accounts, git-anchored freeze ancestry |
| LLM judge grading its own family | different-family judge, pinned prompt+model in score receipt, sampled human audit |

## What this bet is and is not

It is the keystone, not the castle: G makes capability provable but does not translate a line
better. The moat is not the conveyor (a competent team replicates the machinery in days) and not
raw gold volume (money buys annotation faster than a solo pipeline mines it). The moat is the
**compound certified exhaust**: N months of scored reports, ablation-promoted rules, and
provenance-clean correction pairs that a copycat cannot backfill — plus the trust artifact
itself, since purchased annotation ships no pre-registration, no contamination proof, and no
click-through from a headline number to two blinded human receipts.
