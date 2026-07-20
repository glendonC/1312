# RFC 0001: The Miss-to-Gold Conveyor

- Document type: Decision record
- Lifecycle: Accepted
- Authority: Miss routing, gold isolation, scoring invariants, and rationale
- Last verified: 2026-07-20
- Update when: The decision or its invariants change

For a short eval overview, see [`bench/README.md`](../../bench/README.md). Stop after
[One line](#one-line) unless you need conveyor invariants.

This RFC owns conveyor invariants and rationale. It does not own current pack counts, score counts,
or runtime status. Current evaluation facts live in `bench/packs/`, `bench/scores/`, their bound
receipts, and the summary in [`bench/README.md`](../../bench/README.md). Rung labels such as U7
(conditional separation) are defined in
[`../build-week/CAPABILITY_LADDER.md`](../build-week/CAPABILITY_LADDER.md).

Historical acceptance context: the conveyor contracts and guards below are implemented in code. The
first ablation registration plans raw audio versus eligible anonymous separation stems. Scope for
this decision remains `bench/` contracts, `scripts/` producers, and `docs/`. It does not own
`src/studio/preflight/*`, `src/features/*`, or `src/pages/*`.

## One line

Build the conveyor that turns each run's own misses into **agent-drafted, human-adjudicated,
receipt-frozen gold**, then pre-register, score, and compare exact changes against it. Frozen gold,
the per-clip comparator, and the result-free behavioral-rule evaluation contracts now exist. No
behavioral-rule campaign result, later-run consumption proof, or later pack exists.

## The deadlock this resolves

At proposal time on 2026-07-14, the repository had these blockers:

- accepted behavioral rules required scored frozen benchmark evidence, but no frozen pack or score
  receipt existed;
- `public/demo/runs/run-006/score.json` had `per_line: []`, `trail: []`, `delta_vs_cold: null`,
  status `unscored`, with the note "this run cannot mark its own homework." The slots are
  deliberately reserved for exactly this artifact;
- `bench/scores/` was empty, while `bench/runs/run-006/capture.json` was already pinned
  ("so a later run has something to be compared against"). `bench/schemas/capture.schema.json`
  keys units by **time** and pins `unit.gold` to JSON type `null` so a capture can never carry
  its own answer key;
- one real run, run-006, yielded raw candidates: 4 `asr_agreement` withholds
  with machine-readable gate `{id, reason}`, 3 uncorroborated commits (`agreement: null`),
  5 ko-v3 phenomenon-flagged hard lines, and 15 inline cold-vs-prepped contrastive pairs.
  Nothing conveyed them into `bench/packs/`.

The frozen pack and run-007 score resolve the first evidence deadlock. They do not resolve
Run-1-to-N curves, variance, later-pack replication, raw-versus-stem outcomes, or the comparator.

## The conveyor

```text
run artifacts (withholds, uncorroborated commits, phenomenon hits, cold/prepped pairs)
  -> mine        scripts/mine-gold-candidates.mjs   derive-only; emits a candidate manifest
  -> route       every mined miss goes to EXACTLY ONE pool: gold-candidate OR training
  -> draft       Codex/GPT-5.6 agents draft korean_gold + critical units as PROPOSALS
  -> adjudicate  two blinded human reviewers; content-bound decision receipts
  -> freeze      scripts/freeze-pack.mjs advances clip status; pack becomes immutable
  -> register    scripts/register-ablation.mjs binds one exact result-free config delta
  -> package     scripts/package-u7-ablation.mjs cold-audits one U7 operation; emits both stems
  -> score       scripts/score-run.mjs fills per_line/trail/delta_vs_cold + score receipt
  -> compare     scripts/compare-scores.mjs rederives one without/with clip pair
  -> register    scripts/register-rule-change.mjs freezes one rule and the complete run grid
  -> certify     scripts/certify-rule-change-release.mjs freezes exact path-free host context
  -> execute     scripts/run-rule-change-attempt.mjs commits one charge, invokes closed adapter, binds capture
  -> evaluate    scripts/qualify-rule-change.mjs measures or refuses the complete grid
```

Agents draft; humans decide; code freezes; nothing scores itself. This is the same
proposal→decision→materialization separation the memory ledger already enforces, applied to
test data.

## Contracts (all content-addressed, all append-only)

The schemas live in `bench/schemas/` (`gold.schema.json`, `adjudication.schema.json`,
`ablation.schema.json`, `paired-score-v2.schema.json`, `rule-change-registration.schema.json`,
`rule-change-registration-v2.schema.json`, `rule-change-campaign-approval.schema.json`,
`rule-change-campaign-draft.schema.json`,
`rule-change-result.schema.json`, `rule-change-result-v2.schema.json`,
`certified-release.schema.json`, both capture-executor schemas, the execution receipt schemas, and
`u7-ablation-inputs.schema.json`). Candidate, pack, freeze,
output-label, score, ablation, rule-change, and U7 packaging invariants are enforced by
`scripts/lib/bench-gold.mjs`, `scripts/lib/bench-ablation.mjs`,
`scripts/lib/bench-rule-change.mjs`, `scripts/lib/bench-u7-ablation.mjs`, and `check-bench`. The
stub directory this RFC originally shipped with has been retired in favour of the real files.

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

### `studio.bench.ablation.v1` (result-free registration)

Emitted immutably by `register-ablation.mjs` under `bench/ablations/<slug>/registration.json`.
The tool stamps registration time and derives pack, freeze, configuration, and registration ids.
The validator requires a currently frozen pack, registration strictly after freeze, exactly one
scalar leaf difference between same-shaped configs, at least three paired repetitions per clip,
score-everything, all declared stems without best-stem selection, and `results: null`. The semantic
lane remains human-label-only `studio.bench.score.v1` with `judge: null`; structural eligibility,
availability, lineage, and
capture-completeness diagnostics are explicitly non-semantic. A registration is a plan, not a
result or quality claim.

### `studio.bench.u7-ablation-inputs.v1` and `studio.bench.u7-capture-binding.v1`

The immutable input registry binds every frozen clip to exact source bytes before capture. Control
clips bind their pack-local receipts; the hard clip binds the exact media named by the scored
run-007 capture and score receipt. `scripts/package-u7-ablation.mjs` accepts an explicit runtime
directory, run, operation, clip, and repetition, then cold-audits the journal and artifact store. It
materializes exactly two existing capture-schema drafts, one for each ordered anonymous stem
against raw audio, with the registered configs copied exactly. No best-stem selection exists.

Recognizer availability has a closed structural mapping. Usable available text is emitted; empty
or textless available output is missing; unavailable, unknown, and truncated output is withheld.
Partial text from a truncated result is never emitted. The capture binding keeps labels, score,
judge, and preference null. If captures enter `bench/runs/`, score-everything deliberately keeps the
repository red until blinded human labels and a score receipt exist for each capture.

### Rule-change registration, certified execution, and result contracts

The registration is a result-free plan for one behavioral rule proposal. It cold-binds the exact
proposal and rule bytes, a training-routed candidates manifest, a validated redistributable YouTube
identity, exact recorded media bytes, one frozen pack, the fixed
`/reviewed_memory/rule_content_id` null-to-rule change,
and deterministic run ids for every clip and repetition. The contamination guard runs during
registration. Capture is dated strictly after the registration day because the capture contract
cannot prove ordering within one day. Repository validation also requires git ancestry to order
registration before capture, capture before labels, labels before score, score before pair, and pair
before a committed result.

The result accepts only the complete preregistered run grid. It reopens each paired receipt, score,
and capture, checks exact baseline and variant configs, rejects score reuse and unplanned matching
captures, and rederives aggregate four-way outcomes. The variance floor is the maximum repeated-run
rate range observed within either condition for any clip. Qualification requires a preregistered
minimum effect of at least 0.25, an effect strictly greater than that floor, no increase in total
catastrophic errors, and no newly catastrophic critical unit. V1 cannot establish that only one
attempt ran or that the declared configuration produced the capture bytes. Those checks are pinned
false, so every V1 result is `refused` and `ineligible` even when the measured effect clears the
preregistered floor and variance. V1 remains immutable historical refusal evidence.

`studio.bench.certified-release.v1` cold-reopens the registration and candidate proposal, then
compiles the selected side into `studio.bench.certified-host-context.v1`. The compiler accepts one
closed `{ instruction }` rule value, removes evidence paths, rejects filesystem authority in the
host context, and content-addresses the exact config and rule bytes. The release also resolves the
exact evaluation media from each frozen-pack clip. A hard-pack source requires a canonical prompt
authority committed before the freeze, and that authority must bind the media named by the exact
candidates-bound run receipt. V1 certified releases are only for rule-change qualification and pin
`runtime_deployable` false.

The bench-owned single-attempt host writes `studio.bench.execution-input.v1`, then charges the
canonical preregistered slot with `studio.bench.single-attempt-charge.v1`. Its journal binds the
charge and current `HEAD`, then the host commits the exact input, charge, and journal files before
invoking the adapter. Committed charge history makes a deleted attempt remain spent. The host
accepts no media path from the caller. It resolves the frozen media from the certified release and
hashes the exact in-memory buffer before passing immutable base64 bytes with the path-free host
context. Cold verification reopens the coordinator and adapter from the journal's precharge commit,
so a later host version cannot reinterpret an older proof.

`studio.bench.capture-executor.v1` binds the exact single-attempt coordinator and one closed
deterministic fixture adapter. Additive `studio.bench.capture-executor.v2` binds the same host to the
closed OpenAI audio-translation adapter. The host does not load caller-supplied code. The provider
adapter accepts one exact certified media buffer and path-free host context, builds one deterministic
multipart request, invokes one transport, and performs no retry or output selection. Live execution
requires an explicit CLI flag, live environment value, API key, and a certified `whisper-1` config
before the slot is charged. Injected transports are test-only and cannot verify as live execution.
The provider receipt binds requested provider and model identity, media, prompt, exact request bytes,
available response bytes, provider request id, status, closed failure code, and zero retries. Empty
responses retain their canonical zero-byte SHA-256 identity. Failed receipts are cold-audited against
the charged input, certified source, prompt, rule, executor, and immutable outcome commit. None of
this grants product-runtime authority.

On success, the host records additive `studio.bench.execution-attribution.v2` with the provider-call
receipt and capture in one outcome commit. A provider failure commits its exact available response
identity and failure receipt without capture or attribution, and the slot remains charged. Retry,
overwrite, deleted charge, duplicate identity, source substitution, host substitution, adapter
substitution, caller-supplied live timestamps, and pre-commit capture replacement fail closed.
Repository checks require the charge commit after release and executor certification, and the
outcome commit after the charge.

`studio.bench.rule-change-result.v2` optionally binds those attribution receipts per side and run.
Missing any proof keeps `single_attempt_proven` and `execution_attribution_proven` false. Complete
proofs are cold-reopened through release, input, charge, source, and score-bound capture bytes. Only
then can the existing mechanical checks yield `eligible_for_human_review`. V2 does not accept a
memory proposal, deploy a production rule, grade its own outputs, prove a real score win, or prove
improvement on a later pack. The existing memory ledger acceptance path is not yet dependent on
this result, and runtime deployment has no certified-release injection proof. The provider seam can
carry a future authorized capture into this proof chain, but no live provider-backed campaign or
score exists.

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
   score receipt or `check-bench` fails. Behavioral-rule V1 pins `single_attempt_proven` false. V2
   accepts only the bench-owned host receipt chain. Before invoking a closed host-owned adapter, the
   host charges one canonical slot and commits the exact charge evidence. Fixture adapters produce
   one deterministic output or fail once. The provider adapter makes one bounded transport call and
   records its exact outcome. The host never retries and treats a failed or locally deleted slot as
   spent.
5. **Variance floor.** Behavioral-rule registration requires at least three repetitions per clip.
   Qualification refuses an effect that does not strictly exceed the maximum within-condition clip
   range. At the initial pack size (~40–60 units), a preregistered minimum such as 0.25 is a
   step-change screen, not a general confidence interval. Incremental claims wait for larger packs.
6. **Ablation-bound rule promotion** closes a live gap found during the original review. The old
   gate accepted a rule given any scored frozen report with matching `pack_id`, so one report was
   a skeleton key for unlimited rules. The implemented gate instead requires a **pair** of scored
   reports on the same frozen pack whose subject configs are
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
7. ✅ Result-free behavioral-rule registration and fail-closed mechanical evaluation in
   `scripts/lib/bench-rule-change.mjs`. The new contract freezes exact run identities and config
   bytes before capture, rederives the complete paired grid, measures repeated-run spread, and
   refuses eligibility because single-attempt and execution attribution are not yet provable. No
   committed campaign result exists.
8. ✅ IL-02-eligibility certified execution in `scripts/lib/bench-certified-release.mjs` and
   `scripts/lib/bench-single-attempt.mjs`. Additive V2 results cold-reopen exact qualification-only
   release, frozen source, closed host and adapter, input, charge journal, outcome commit,
   attribution, and capture bytes. Missing proofs remain refused. Deterministic tests prove retry,
   overwrite, deleted or duplicate attempt id, caller executable rejection, stale config, source
   substitution, and pre-commit capture replacement refusal. No real campaign result or runtime
   deployment authority was created.
9. ✅ IL-03 provider campaign foundation adds the host-owned one-call OpenAI audio-translation
   adapter, provider call receipts, test-only injected transport, hostile failure tests, and
   owned-local rule-change registration V2. The result-free
   `bench/rule-changes/ko-kinship-address-context/campaign-draft.json` binds a training-routed miss,
   exact owned media, frozen `hard-ko-v1`, certified provider executor, closed config delta, and the
   full 18-call grid. Owned-local registration V2 also requires a content-addressed human approval
   receipt for the exact proposal bytes. It rejects an agent actor, proposal-drafter self-approval,
   and approval at or before proposal creation, and it always withholds live capture authority.
   The declared human name and Git identity are review metadata, not authenticated identity.
   It remains a draft because no such approval or canonical human-reviewed rule proposal exists.
   Two local-evaluation control clips do not authorize provider egress, so adapter preflight blocks
   12 of the 18 planned calls before charge and the frozen grid is not live-ready. No live call,
   capture, label, score, qualification, accepted memory, or product runtime deployment exists.

Post-week update: `hard-ko-v1` is frozen at three clips and run-007 is scored from human labels with
`judge: null`. One raw-versus-eligible-stem experiment is pre-registered, its frozen inputs are
content-bound, and its cold-audit packager is implemented with no captures or results. The
paired-score comparator and behavioral-rule evaluation spine are implemented. They preserve
four-way outcome deltas, cold-rederive stored receipts, preregister exact repeated-run grids, and
refuse effects below observed spread or with catastrophic increase. The bench now has certified
qualification releases and a journaled closed-adapter capture host. No committed behavioral-rule
registration, provider-backed capture, with-side score, or eligible result exists. The runtime has
no accepted certified-release injection proof. Next are exact-byte human review of the drafted
training-routed rule, a separately frozen provider-authorized pack and newly bound campaign package,
result-free registration and releases, separately authorized captures, and blinded human labels,
then a later independently frozen pack before any generalization claim.

## Failure modes

| Mode | Guard |
|---|---|
| Self-graded gold (drafter == judge) | agents draft candidates only; two blinded human receipts freeze; candidates structurally unscoreable |
| Knowledge-level contamination | clip/episode-level guard + exclusive routing (invariants 2–3) |
| Best-of-K curve mining | V1 refuses eligibility; V2 commits one charge per slot and admits only closed host adapters with one deterministic output (invariant 4) |
| Noise sold as progress | preregistered minimum effect plus observed repeated-run floor (invariant 5) |
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
