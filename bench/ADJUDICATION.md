# Hard-KO human adjudication worksheet

<!--
Document type: Evaluation runbook
Lifecycle: Active
Authority: Human gold-review procedure for frozen pack candidates
Last verified: 2026-07-19
Update when: The blinded review or freeze handoff procedure changes
-->

This is the human decision step between an agent-drafted gold candidate and
`scripts/freeze-pack.mjs`. Agents draft; humans decide; code freezes; nothing scores itself. Bench
layout and current pack facts live in [`README.md`](./README.md).

## Stop conditions

Do not review `bench/examples/gold-drafts/Ux-TMWnmntM.gold.json`. It is explicitly a
non-authoritative dry-run fixture produced without direct audio audition. A review receipt over
that file would only content-bind a demonstration, not create gold.

For a real review, the operator must first materialize an audio-grounded candidate under
`bench/packs/hard-ko-v1/`, normally:

```sh
node scripts/draft-gold-from-candidates.mjs \
  --draft <audio-grounded-agent-output.json> \
  --out bench/packs/hard-ko-v1/Ux-TMWnmntM.gold.json
```

The command validates and writes a `status: "candidate"` proposal. It does not freeze or score.
If it says the immutable path already holds different bytes, do not overwrite it. Write a new
versioned candidate filename and obtain new reviews over those exact bytes.

## 1. Prepare a genuinely blinded reviewer

The reviewer may see only:

- `public/demo/runs/run-006/clip.mp4` (source media);
- the exact candidate gold file being reviewed, including its Korean proposal,
  `english_guidance`, critical units, and source provenance;
- this procedure and a blank worksheet.

When `blinded: true`, the reviewer must not see any system caption, output, gate, score,
comparison, or run-derived judgment for these windows. In particular, do not open or send:

- `bench/candidates/run-006/candidates.json` (its `mined_from.path` is visible in the candidate,
  but the manifest itself contains 1321-prepped and 1321-cold outputs);
- `public/demo/runs/run-006/captions.json`, `corrections.json`, `score.json`, `evidence.json`, or
  the demo UI;
- captures, traces, cold/prepped comparisons, or any prior reviewer's receipt.

The drafting agent was allowed to see system outputs as context. That does not determine human
blindness. Set `blinded: true` only if this human did not see system outputs. If they saw any,
record `blinded: false` honestly; the receipt remains an audit artifact but cannot authorize a
freeze.

Each reviewer works in their own checkout or worktree with their own Git identity:

```sh
git config user.name
git config user.email
```

The worksheet's `reviewer.git_identity` must be exactly
`Git User Name <git-email@example.org>`, for example `Reviewer Name <reviewer@example.org>`. The receipt
helper verifies this checkout identity. Do not change one person's Git configuration to simulate
a second person.

## 2. Listen to every exact time window

Times in gold are seconds from the start of the local 40-second clip. The local clip corresponds
to 00:05:10–00:05:50 in the source receipt. For example, review the 12.70–13.60 window with:

```sh
ffplay -v warning -autoexit -ss 12.7 -t 0.9 public/demo/runs/run-006/clip.mp4
```

List a command for every candidate unit without opening any run output:

```sh
jq -r '.units[] | "ffplay -v warning -autoexit -ss \(.t_start) -t \(.t_end - .t_start) public/demo/runs/run-006/clip.mp4"' \
  bench/packs/hard-ko-v1/Ux-TMWnmntM.gold.json
```

Replay short or ambiguous windows. It is acceptable to listen to adjacent source-media context
to resolve a boundary, speaker turn, or incomplete phrase; the decision must still address the
candidate's exact `t_start`/`t_end`. Check Korean transcription, non-canonical English guidance,
every critical-unit fact, phenomenon id, and each proposed catastrophic condition.

## 3. Fill one worksheet, unit for unit

Create a temporary worksheet outside `bench/reviews/`; it is input, not a receipt. Copy every
gold unit's exact times once, never cue ids:

```json
{
  "reviewer": {
    "name": "REAL HUMAN NAME",
    "git_identity": "Git User Name <reviewer@example.org>"
  },
  "blinded": true,
  "action": "accept",
  "reason": "Audio-grounded reason for the overall decision.",
  "unit_decisions": [
    {
      "t_start": 0,
      "t_end": 1.55,
      "action": "accept",
      "note": null
    }
  ],
  "minutes_spent": null,
  "created_at": "2026-07-14T20:00:00.000Z"
}
```

- `accept`: the Korean, guidance, and critical units are acceptable as written. An overall
  accept requires every unit to accept.
- `amend`: identify the exact correction in `note`; overall amend needs at least one amended
  unit and cannot contain a rejected unit. The candidate remains unaccepted. Materialize
  corrected gold at a new immutable path and review the new bytes from scratch.
- `reject`: explain the material failure in `note`; overall reject needs at least one rejected
  unit.
- `minutes_spent`: record the measured elapsed review time when available, otherwise `null`.
  Never estimate a favorable number or manufacture a cost-savings claim.
- `created_at`: record the actual completion time as an ISO-8601 UTC timestamp; do not backdate.

Do not use placeholder identities in a real worksheet. The reviewer must be Korean-fluent and
must make the decisions themselves.

## 4. Emit the content-bound receipt

From the reviewer's own checkout and Git identity:

```sh
node scripts/write-adjudication-receipt.mjs \
  --candidate bench/packs/hard-ko-v1/Ux-TMWnmntM.gold.json \
  --worksheet /absolute/path/to/completed-review.json
```

The helper:

- revalidates the gold candidate;
- hashes the exact candidate file into `candidate.path/content_id/bytes`;
- requires one decision for every exact gold time window;
- copies the candidate's drafter id and verifies reviewer ≠ drafter;
- derives `review_id` with the existing bench helper: the canonical JSON body (everything except
  `review_id` and optional `$schema`) is SHA-256 hashed and prefixed `bench-review:`;
- validates `studio.bench.review.v1` and immutably writes
  `bench/reviews/<clip>.<full-review-hash>.review.json`.

It does not create a commit. Inspect the receipt, stage only the review artifact, and have that
same reviewer commit it:

```sh
git add bench/reviews/Ux-TMWnmntM.*.review.json
git commit -m "Adjudicate hard-ko-v1 Ux-TMWnmntM"
```

Repeat the entire blinded process with a second Korean-fluent human in their own checkout. The
two freezing reviewers must have distinct `reviewer.name` and distinct
`reviewer.git_identity`; neither may equal `agent:gold-drafter-v1`. Each person commits their own
receipt under their own Git identity. String inequality in JSON is not proof of two humans, so
one person using two names is prohibited even if the mechanical check would accept the strings.

## 5. Pack state and freeze sequence

`hard-ko-v1` is designed as two independently sourced control slots plus three hard slots. The
run-006 clip fills only one hard slot. A complete end-to-end pack sequence is:

```sh
# Once only: creates 2 control + 3 hard planned slots.
node scripts/freeze-pack.mjs init \
  --pack hard-ko-v1 \
  --label "Hard-KO Clip Pack v1" \
  --controls 2 \
  --hard 3

# The mined run-006 hard clip.
node scripts/freeze-pack.mjs source \
  --pack hard-ko-v1 \
  --slot slot-hard-01 \
  --clip Ux-TMWnmntM \
  --source-json public/demo/runs/run-006/source.json
node scripts/freeze-pack.mjs gold-ready \
  --pack hard-ko-v1 \
  --slot slot-hard-01 \
  --gold Ux-TMWnmntM.gold.json

# Independently sourced control 1: its gold must have mined_from: null.
node scripts/freeze-pack.mjs source \
  --pack hard-ko-v1 \
  --slot slot-control-01 \
  --clip <control-clip-1-id> \
  --source-json <control-clip-1-source-receipt.json>
node scripts/freeze-pack.mjs gold-ready \
  --pack hard-ko-v1 \
  --slot slot-control-01 \
  --gold <control-clip-1-id>.gold.json

# Independently sourced control 2: its gold must have mined_from: null.
node scripts/freeze-pack.mjs source \
  --pack hard-ko-v1 \
  --slot slot-control-02 \
  --clip <control-clip-2-id> \
  --source-json <control-clip-2-source-receipt.json>
node scripts/freeze-pack.mjs gold-ready \
  --pack hard-ko-v1 \
  --slot slot-control-02 \
  --gold <control-clip-2-id>.gold.json

# The remaining hard clips follow the same source -> gold-ready transition.
node scripts/freeze-pack.mjs source --pack hard-ko-v1 --slot slot-hard-02 \
  --clip <hard-clip-2-id> --source-json <hard-clip-2-source-receipt.json>
node scripts/freeze-pack.mjs gold-ready --pack hard-ko-v1 --slot slot-hard-02 \
  --gold <hard-clip-2-id>.gold.json
node scripts/freeze-pack.mjs source --pack hard-ko-v1 --slot slot-hard-03 \
  --clip <hard-clip-3-id> --source-json <hard-clip-3-source-receipt.json>
node scripts/freeze-pack.mjs gold-ready --pack hard-ko-v1 --slot slot-hard-03 \
  --gold <hard-clip-3-id>.gold.json

npm run bench:check
node scripts/freeze-pack.mjs freeze --pack hard-ko-v1
npm run bench:check
```

Before `freeze`, every one of all five clips—not merely run-006—must be `gold_ready`, and every
clip's current gold bytes need two distinct blinded human accept receipts. The two control clips
must be independently sourced, not mined from this system's misses. `freeze` re-hashes the gold,
candidate manifests, and reviews; stale or amended bytes fail closed. Commit the generated
freeze receipt in the same change that records the frozen pack state. Do not run a score command
as part of adjudication.

## Current human blocker — stop before freeze

As of this protocol-draft handoff, a second real Korean-fluent reviewer has not been recruited,
and the two independent control clips have not been sourced and adjudicated. Stop before
`freeze-pack.mjs freeze`. Do not create substitute identities, reuse run-006 as a control, or
weaken the pack. The next dependency is human/source acquisition: recruit the second reviewer
and source the two controls.
