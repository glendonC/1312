---
title: Freeze the test before you score it
description: "We locked three test clips and a human-reviewed answer key. Only a new run made after that lock can produce the first score."
date: 2026-07-15
type: note
author: "1321"
topic: Benchmarks
draft: false
---

Today we locked the test we will use to measure 1321: three video excerpts, the Korean spoken in each one, the meaning an English answer must preserve, and the serious mistakes it must avoid.

There is still no score.

Those two facts belong together. Now that the test is fixed, the first result that can count has to come from a new run. A number produced before this point might be useful while building, but it cannot tell us how a system performed against a test that was already settled.

This is slower than filling the Benchmarks page tonight. It is also the difference between measuring progress and choosing a story after seeing the answer.

## Lock the question before seeing the answer

A benchmark is not just a folder of difficult clips. It is a question asked in a particular order.

First, decide which parts of which videos count. For each excerpt, write down the Korean, the meaning an English answer must keep, and the errors that would materially reverse or damage that meaning. Have two people review that answer key without seeing a system score. Lock the exact files. Only then capture fresh system outputs and compare them with the answer key.

If that order is reversed, there are many quiet ways to make a result look better. A hard line can be reworded after the system misses it. A generous interpretation can replace a strict one. An awkward clip can disappear. None of this requires deliberate fraud. It only requires letting knowledge of the result influence the test.

This is the same problem preregistration tries to address in research. Brian Nosek and colleagues describe the basic distinction as generating hypotheses from existing observations, then testing them with new observations. Their point is not that exploration is bad. It is that exploration and confirmation answer different questions, and readers need to know which one they are seeing. [Their paper on preregistration](https://pubmed.ncbi.nlm.nih.gov/29531091/) gives us a useful standard for a much smaller engineering experiment: state the test before the evidence that will judge it exists.

For 1321, locking the clips and answer key is that line.

## What we locked today

The test contains three short excerpts. Two are private local evaluation clips. We do not own them, we have no permission to redistribute them, and they will not be published as if we did. The third is a difficult conversational clip that can be redistributed under its Creative Commons licence.

That difficult clip came from an earlier exploratory run. Its misses helped us identify what the answer key needed to test. The earlier run helped generate the question, so it cannot also count as the answer. Only a fresh run made after the clips and answer key were locked can produce the first score.

Two people separately reviewed the answer key for each excerpt. The repository records the exact versions they accepted so later edits cannot silently change what counts as correct. Inside the codebase, this small test is called `hard-ko-v1`. That name is useful for tracing files. It is not the result.

The test is also small. Its two private controls are excerpts from the same source, not evidence of broad coverage. One difficult conversation does not represent Korean media. Human review can improve an answer key, but two reviewers do not make it infallible.

What we can say today is narrow: these are the clips and judgments the next outputs must face, and they can no longer move to accommodate those outputs.

That is progress, but it is not proof that 1321 understood them.

## Why the scoreboard stays empty today

We locked the test on July 15. Our scoring code rejects any system output recorded on July 15 or earlier.

That rule is intentionally blunt. The lock has a precise timestamp, but the current run record stores only a calendar date. We cannot prove which came first within the day, so same-day scoring is rejected. The earliest valid path begins July 16 with a new output captured after the test was fixed.

That new output will still not be a score by itself. People must compare it with the locked answer key. For each important piece of meaning, they must record whether the system got it right, got it wrong, withheld an answer, or missed it entirely. Serious errors are counted separately. A language model does not get to decide whether another model understood the line.

We could run the system today, inspect the output, and write down a percentage. That percentage would not qualify as benchmark evidence. The date rule exists so our impatience cannot quietly lower the proof bar.

## The same test gets weaker every time we learn from it

Locking the test solves one problem and creates another. Every result we see can influence what we build next.

That is the intended improvement loop. Find a miss, understand why it happened, make a specific change, and see whether the next run is better. But once a team has seen the answers from a test, future decisions are no longer independent of that test. A system can gradually become good at these three excerpts without becoming better at Korean video in general.

Research on adaptive data analysis has shown why ordinary holdout assumptions weaken when later analyses are chosen using earlier results. Cynthia Dwork and colleagues developed the reusable holdout around this problem: how to preserve validity when the same test data is consulted repeatedly and each result can shape the next question. [Their paper](https://pubmed.ncbi.nlm.nih.gov/26250683/) is a reminder that separating a test set once is not the end of the problem.

Our safeguards do not solve the full statistical problem. They give us practical boundaries we can audit. The current guard bars a test clip from accepted training material, active glossary entries, correction examples, or new rules.

That guard arrived after the exploratory run. The run had already written nine unreviewed glossary entries from the hard clip. Those entries are quarantined and cannot be used, but the earlier leak remains on the record. Every run formally recorded against the locked test must remain visible, not just the best rerun. Any later claim that a change works beyond these clips will need another unseen test.

Even a new test needs care. Researchers who recreated the CIFAR-10 and ImageNet test sets found performance gaps, but their analysis suggested the replacement examples were subtly harder rather than supporting a simple story of benchmark overfitting. [The replication study](https://proceedings.mlr.press/v97/recht19a.html) is useful because it resists the easy conclusion. New examples can test whether an improvement transfers, but differences in sourcing and difficulty still have to be understood.

The aim is not to build an elaborate ritual around three clips. It is to establish the order and boundaries before the test grows and before there is a flattering number to defend.

## What the first score must earn

On July 16 or later, a new system output can begin the first honest comparison. People will need to label it against the answer key, and the resulting score must point back to the exact locked files so someone else can recalculate it. July 16 is the earliest valid path, not a promise that a score will appear that day.

Only after that can we start a run-by-run improvement curve: find misses, make a specific change, rerun against the same fixed question, and keep every attempt visible. If the change is smaller than the system's ordinary variation between runs, there is no hard-line gain to claim. If it helps only on these clips and not on later unseen material, there is no general improvement to claim either.

Yesterday we said that extra investigation must improve the hard lines or it is only extra machinery. Today we fixed the conditions under which that sentence can be tested.

We have not proved that 1321 studies a video better yet. We have stopped ourselves from changing the test after the answer arrives.
