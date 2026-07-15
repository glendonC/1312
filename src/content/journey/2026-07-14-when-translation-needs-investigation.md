---
title: When translation needs investigation
description: "Localization workflows move media through a configured route. 1321 is testing whether difficult media needs investigation before conversion."
date: 2026-07-14
type: note
author: "1321"
topic: System design
draft: false
---

From the outside, 1321 can look like a familiar video localization tool. Its intended input and output look familiar too: a video goes in, and Korean captions and checked English should come out.

That comparison is reasonable. It is also useful, because it forces us to say what 1321 is actually trying to prove.

## Conversion begins with a known job

A localization workflow starts with a defined transformation. The source language, target language, desired outputs, and processing stages are chosen, then the system moves the media through that route.

pyVideoTrans is a useful concrete example. It is an open-source video translation and dubbing tool built around speech recognition, subtitle translation, speech synthesis, synchronization, and video assembly. It supports different model providers, speaker diarization, multi-role dubbing, voice cloning, manual review, and several ways to run the system.

Its [official project description](https://github.com/jianchang512/pyvideotrans) presents a complete media conversion workflow. Its [published architecture](https://github.com/jianchang512/pyvideotrans/blob/main/docs/architecture.md) is modular and stage-based, with different modes able to include or skip parts of the process.

That is a real product category with difficult engineering inside it. It would be inaccurate to describe pyVideoTrans as primitive, context-free, or little more than a script. 1321 also depends on many of the same underlying capabilities: speech recognition, translation models, speaker separation, timing, and audio processing.

The distinction cannot be that we put agents around familiar steps.

## Investigation begins with uncertainty

1321 is testing a different control problem: what if the route is not fully known until the source has been inspected?

A clean line may only need transcription, translation, and timing. A difficult line may need something else:

1. overlapping voices may require separation or a different segment boundary;
2. a possible name may need speaker context, a glossary check, or comparison with another mention;
3. visible text may require a frame inspection and text recognition;
4. a joke or reference may require cultural context or an outside source;
5. conflicting readings may need an independent pass before anything is accepted.

The intended role of the orchestrator is to notice those conditions, open the smallest useful investigation, collect structured reports, and stop work that is no longer adding evidence. Easy segments should not receive the same treatment as uncertain ones.

This is the architecture we are trying to build. It is not evidence that the architecture already works.

## What not to confuse this with

1321 is not trying to replace every subtitle editor, dubbing workflow, or localization pipeline. Those tools begin with a known conversion job. 1321 only has a reason to exist where the source itself is uncertain enough that the route needs to change.

It is also not live translation. Live translation has to answer while the speaker is still talking, which forces a tradeoff between waiting for context and replying on time. 1321 is testing whether studying the video before answering can recover meaning that a cold, one-pass system misses.

It is not a model ensemble where value comes from asking the same question several times and taking a vote. More workers are only useful if they inspect different evidence, expose a disagreement, or change what the final answer can support.

And it is not a claim that every clip deserves a large investigation. If a line is clear, the system should take the short route. Extra work has to earn its cost on the difficult parts.

## An agent has to change the decision

Each investigation should leave behind a readable record: the source window it examined, the action it took, the possible answer it produced, the evidence it used, and the uncertainty that remains. The orchestrator should reconcile those reports rather than flatten them into a confident sentence. If the reports disagree, the disagreement should stay visible. If the evidence is insufficient, the line should be withheld or marked for review.

This record is not an attempt to explain every internal operation of a model. It should let a reviewer see what the system inspected, what it concluded, and why that conclusion was allowed into the output.

## Korean to English is the first proof, not the boundary

If the source can be studied well enough, the resulting record could support more than an English subtitle. The goal is for it to support timed Korean, explanations for difficult lines, and reviewed material that helps a learner or, when kept separate from the benchmark clips, improves a later run.

Korean-to-English video is the first proof case because it makes the problem concrete. Fast speech, omitted subjects, honorifics, overlapping voices, visible text, and cultural context can all change what an English answer should say. The larger question is whether a system can investigate real media when meaning is spread across sound, frames, speakers, context, and outside facts.

That is a direction, not a capability claim. First we have to prove it on short Korean clips.

## Investigation has to earn its complexity

An adaptive system can be slower, more expensive, and less predictable than a defined workflow. Autonomy is not valuable by itself. To test it honestly, we need to compare a cold baseline and an investigation-enabled run on the same fixed clips while holding the underlying models and settings constant. Then we can ask concrete questions:

- Did investigation recover more of the difficult lines the baseline missed?
- Did the system recognize when its answer was weak?
- Can a reviewer find the source of a decision without reconstructing the whole run?
- On separate learning material, did a reviewed correction prevent a repeated error?
- Was the improvement worth the added time and cost?

The long-term hypothesis is that the system can learn which investigations are useful for which kinds of difficulty. For now, improvement should mean a specific, inspectable change and a later result that survives a fixed test. It should not be a vague claim that the system learns every time it runs.

pyVideoTrans gives us one useful example of efficient, configurable media localization. The broader boundary is conversion versus investigation. 1321 is testing whether some media needs the second before it can safely become the first.

If the extra investigation does not recover missed meaning, keep uncertainty visible, and reduce repeated errors without contaminating the test, then it is only extra machinery. That is the standard this Journey should hold us to.
