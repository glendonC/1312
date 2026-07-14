---
title: When translation needs investigation
description: "Traditional localization tools follow a configured route. 1321 lets the evidence decide which agents, tools, and investigations are needed next."
date: 2026-07-14
type: note
author: "1321"
topic: System design
draft: false
---

From the outside, 1321 can look like a familiar video localization tool. A video goes in. Captions and English come out.

That comparison is reasonable. It is also useful, because it forces us to say what 1321 is actually trying to prove.

## A localization pipeline solves a real job

pyVideoTrans is a useful reference point. It is an open-source video translation and dubbing tool built around speech recognition, subtitle translation, speech synthesis, synchronization, and video assembly. It supports different model providers, speaker diarization, multi-role dubbing, voice cloning, manual review, and several ways to run the system.

Its [official project description](https://github.com/jianchang512/pyvideotrans) presents a complete media conversion workflow. Its [published architecture](https://github.com/jianchang512/pyvideotrans/blob/main/docs/architecture.md) is modular and stage-based, with different modes able to include or skip parts of the process.

That is a real product category with difficult engineering inside it. It would be inaccurate to describe pyVideoTrans as primitive, context-free, or little more than a script. It also makes the comparison more useful. 1321 relies on many of the same underlying capabilities: speech recognition, translation models, diarization, timing, and audio processing.

The distinction cannot be that we put agents around familiar steps.

## The route should depend on the evidence

A stage-based localization workflow starts with a defined transformation. The source language, target language, desired outputs, and processing stages are configured, then the system carries the media through that route.

1321 is testing a different control problem: what if the route is not fully known until the source has been inspected?

A clean line may only need transcription, translation, and timing. A difficult line may need something else:

1. overlapping voices may require separation or a different segment boundary;
2. a possible name may need speaker context, a glossary check, or comparison with another mention;
3. visible text may require a frame inspection and OCR;
4. a joke or reference may require cultural context or an external source;
5. conflicting readings may need an independent pass before anything is accepted.

The intended role of the orchestrator is to notice those conditions, open the smallest useful investigation, collect structured reports, and stop work that is no longer adding evidence. Easy segments should not receive the same treatment as uncertain ones.

This is the architecture we are trying to build. It is not evidence that the architecture already works.

## An agent has to change the decision

Running several models in parallel is not enough. A specialist is only useful if its work changes what the system can support.

Each investigation should leave behind inspectable artifacts: the source window it examined, the action it took, the candidate it produced, the evidence it used, and the uncertainty that remains. The orchestrator should reconcile those reports rather than flatten them into a confident sentence. If the reports disagree, the disagreement should stay visible. If the evidence is insufficient, the line should be withheld or marked for review.

The trace is not an attempt to explain every internal operation of a model. It is a record of what the system inspected, what it concluded, and why that conclusion was allowed into the output.

## Translation is one output of the investigation

Once the source has been studied, the same checked record can support more than an English subtitle. It can produce timed Korean, explanations for difficult lines, glossary entries, learning material, correction pairs, and benchmark cases.

That does not mean 1321 needs to become every kind of media tool. A translated dub and a packaged video may be useful outputs later, but they are not the current proof bar. The current question is narrower: can adaptive investigation improve our understanding of short, difficult Korean-to-English clips, and can it show the evidence behind that improvement?

## More machinery is not automatically more intelligence

An adaptive system can be slower, more expensive, and less predictable than a defined workflow. Autonomy is not valuable by itself. We need to compare both approaches on the same frozen clips and ask concrete questions:

- Did investigation recover more hard lines than the baseline?
- Did the system recognize when its answer was weak?
- Can a reviewer find the source of a decision without reconstructing the whole run?
- Do corrections become glossary entries, routing rules, or regression cases that prevent repeated mistakes?
- Was the improvement worth the added time and cost?

The long-term hypothesis is that the system can learn which investigations are useful for which kinds of difficulty. For now, improvement should mean explicit changes we can inspect: a corrected pair, a new glossary entry, a routing rule, a benchmark case, or a regression caught on the next run. It should not be a vague claim that the system learns every time it runs.

pyVideoTrans gives us a useful boundary: efficient, configurable media localization. 1321 is testing whether some media needs investigation before conversion.

If the extra investigation does not improve the hard lines, make uncertainty inspectable, and reduce repeated errors, then it is only extra machinery. That is the standard this Journey should hold us to.
