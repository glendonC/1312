# Korean kinship address context campaign draft

Status: draft only. This directory contains no registered campaign, capture, human label, score,
qualification, promotion, or product runtime authority.

The candidate rule says that bare Korean address forms such as `누나`, `오빠`, `형`, and `언니`
do not by themselves prove a family relationship. Explicit context such as `친누나` or `매형`
can support a kinship translation. The draft originates from training-routed `run-005` and is
evaluated only on frozen `hard-ko-v1` clips.

The closed draft grid has three clips, three repetitions, and two conditions. It plans exactly 18
`whisper-1` audio translation calls over 606.078 media seconds, but it is not live-ready. The two
`local-eval-ko-control-*` clips permit local evaluation only and do not authorize provider egress.
The adapter preflight therefore refuses their 12 planned calls before charging a slot. The six
Creative Commons clip calls do not form the complete preregistered grid and must not be run alone.

Wall time and spend remain unset. Before any live authorization, replace this package with a newly
bound campaign against a separately frozen provider-authorized pack. The current adapter accepts
only the exact Creative Commons source contract. A future owned-media path would need a typed,
content-bound provider-egress authority contract before it could pass this gate. Do not mutate
`hard-ko-v1` or reinterpret its existing rights receipts. The provider executor receipt is bound in
`campaign-draft.json`, but no certified release can exist before registration.

## Human proposal and registration gate

1. Review `proposal-draft.json` as a proposal, not as accepted memory.
2. If a human approves its exact bytes for result-free registration, run
   `scripts/approve-rule-change-campaign.mjs` with the proposal-draft path, human name, Git identity,
   and review notes after the proposal creation time. The approver must differ from the agent
   drafter. The content-addressed receipt always records `live_capture_authorized: false`.
3. Create the byte-identical canonical proposal at the `canonical_proposal_path` recorded in
   `campaign-draft.json` through the memory review flow, then run `npm run memory:check`.
4. Materialize `registration.json` from `registration-input.json` with the approval path printed by
   step 2:

   ```sh
   node scripts/register-rule-change.mjs \
     --draft bench/rule-changes/ko-kinship-address-context/registration-input.json \
     --out bench/rule-changes/ko-kinship-address-context/registration.json \
     --campaign-approval bench/reviews/rule-change-campaign/<approval-digest>.json
   ```

5. Run `npm run bench:check`, then commit the result-free registration before any capture.
6. Certify both `without` and `with` releases from that committed registration.

Do not copy the proposal draft into reviewed memory or create a registration without the human
decision. The receipt records a declared human name and Git identity; it does not authenticate that
identity, so the operator still owns the decision. Registration does not authorize live provider
spend.

## Live capture gate

The current package cannot pass the provider-media gate, even if the operator supplies the live
authorization phrase. After a new provider-authorized package, registration, and both releases
exist, live execution still requires the operator phrase and exact grid authorization described in
the task handoff. The authorized run must use the newly bound executor and run ids exactly once.
A charged timeout, rate limit, provider error, or invalid response remains a spent slot and must not
be retried.

## Blinded labeling gate

After a complete live capture grid exists, prepare one human-owned file per run at
`bench/reviews/labels/<run>.json`. Do not fill semantic judgments automatically.

For every label file, the operator must verify:

- `schema` is `studio.bench.output-labels.v1`.
- `capture` binds the exact `bench/runs/<run>/capture.json` bytes.
- `blinded` is `true`, with at least two distinct human reviewers and Git identities.
- Every emitted unit for the subject system has one label with exact `t_start` and `t_end`.
- `meaning_preserved`, critical-unit `correct`, and `catastrophic` values are human judgments.
- No label exists for a withheld or missing output.
- `labels_id` is recomputed from the completed receipt before it is committed.

Then run `scripts/score-run.mjs` for all 18 captures, create the nine paired-score receipts with
`scripts/compare-scores.mjs`, and run `scripts/qualify-rule-change.mjs` with all nine pairs and all
18 execution attribution paths. A mechanically eligible result is only eligible for human review.
It is not a deployed rule, accepted memory, or measured product win.
