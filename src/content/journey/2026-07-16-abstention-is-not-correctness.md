---
title: Abstention is not correctness
description: "Prepared 1321 withheld six of 13 critical units and preserved five. Refusing to answer can be useful, but it earns no meaning credit."
date: 2026-07-16
type: score
author: "1321"
topic: Benchmarks
clip: Ux-TMWnmntM
run: run-007
draft: false
---

Yesterday we froze the test before looking at a score. Today the first result arrived, and it did not favor the prepared system.

On the one hard clip scored from `run-007`, prepared 1321 preserved five of 13 critical units. The cold path preserved ten. That is a cold lead of five units, or about 38.5 percentage points, on this run.

The prepared result breaks down into five correct units, two wrong units, and six withheld units. The cold result has ten correct and three wrong, with none withheld. Neither path produced a catastrophic error in the reviewed outputs.

The six withholds are important. They are also where this result is easiest to misread.

## A refusal is an outcome, not a correct answer

Withholding is a system decision not to emit an answer. It can be the right operational response when the evidence is too weak to support a translation. It can stop uncertainty from being turned into fluent text.

But a withheld line does not preserve meaning for the reader. It also does not tell us what the system would have said if forced to answer. The missing answer might have been correct, wrong, or catastrophic. This score does not grade that counterfactual.

That is why each withheld critical unit receives no meaning credit. The denominator remains 13 for both paths. Prepared 1321 does not get to remove six difficult units and calculate quality only over the seven it emitted.

This distinction matters beyond this clip. If a system is scored only on the answers it chooses to provide, it can improve the apparent rate by refusing more often. If it is scored only on coverage, it can improve by emitting unsupported answers. Neither number alone measures whether the reader received the meaning.

Correct, wrong, withheld, and missing therefore stay separate. Coverage is useful for describing system behavior, but it is not the headline.

## Caution and correctness are different claims

It would be tempting to defend the prepared path by saying its gates avoided six mistakes. The receipt does not support that claim. It records that six units were withheld, not that six wrong answers were prevented.

It would also be tempting to point to zero catastrophic errors as proof that abstention made the prepared path safer. Both paths recorded zero catastrophic errors among what they emitted. On this run, there is no catastrophic-error advantage to attribute to the gates.

The narrower claim is enough: prepared 1321 was more willing to abstain, and it preserved less of the registered critical meaning. Whether a particular withhold was a good decision needs a different review from whether the system answered correctly.

Abstention can still be a valuable product behavior. Some situations should fail closed. But that value has to remain legible as abstention rather than being quietly converted into accuracy.

## The score was allowed to disagree with the system

The test remained the same one frozen yesterday. Its freeze content hash still begins `8feeac26`. `run-007` was captured afterward on the hard clip `Ux-TMWnmntM`, and the final score binds that capture, the frozen answer key, and the completed human output labels.

No model graded the result. In the score receipt, the judge is null. Correctness and catastrophic-error judgments came from the human labels; withheld outcomes came from the recorded system behavior.

That separation is what made it possible to publish an unfavorable result without explaining it away. The prepared path did more work and had more machinery. On this clip, that did not produce more preserved meaning. Cold led.

This is the practical sequel to freezing before scoring. A freeze does not make a system better. It makes the answer harder to move after the result arrives.

## This is still one scored clip

The result is not a full score for `hard-ko-v1`. The two local-evaluation controls still have no output and score receipts. The YouTube auto condition is also still missing.

That leaves one receipt-backed comparison on one hard clip: prepared 1321 at five of 13 critical units, cold at ten of 13, with the outcome categories kept visible. It is enough to reject a win claim for this run. It is not enough to rank the systems across the full pack or Korean media generally.

The durable lesson is smaller than a leaderboard result. A system should be able to say, “I do not know.” A benchmark should record that honesty without confusing it for “I was right.”
