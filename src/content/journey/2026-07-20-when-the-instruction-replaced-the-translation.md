---
title: When the instruction replaced the translation
description: "We added one note meant to prevent a Korean family-relationship mistake. On two test clips, the translator repeated the note instead of the speech."
date: 2026-07-20
type: failure
author: "1321"
topic: Benchmarks
draft: false
---

Tonight we tried to fix a real translation trap in Korean.

Some Korean words can name an actual older sister or brother, but people also use them socially. Translating every one as a family relationship can invent a relative who is not there. We gave the translator one extra instruction: only describe a family relationship when the surrounding conversation makes it clear that the people are actually family.

On two of our three test videos, the instruction backfired. Instead of translating what people were saying, the system repeated our instruction as the answer.

## The note replaced the video

This was not a subtle quality drop. The note meant to prevent one specific mistake drowned out the video itself. One of the affected clips was not even about family relationships, but the same instruction replaced its translation too.

Across the six comparisons we could complete, the version with the note preserved less meaning and introduced more serious errors. On one clip, it preserved about 67 percentage points less of the required meaning. On the other, it preserved about 38 points less. Serious errors increased on both.

The important distinction is what those numbers diagnose. We did not learn that the language rule is universally bad. We learned that this way of applying it is broken.

The rule had been added to the extra text sent with an audio-translation request. We expected that text to guide the translation. On these clips, it became the translation. A sensible instruction in the wrong part of a system can be worse than no instruction at all.

## A successful request can still be unusable

The third video did not produce a complete comparison. The version without the note returned timestamps that continued past the end of the clip. The provider returned HTTP 200, but the output did not fit the source, so our validator rejected it.

We had committed to one attempt for every test slot, with no retries. Those failed calls therefore stayed failed. We did not run them again just to make the grid look complete. Retrying only after seeing a bad result would let us replace an inconvenient sample with a friendlier one.

That left six of the nine planned comparisons. We created the labels ourselves during Build Week, so they were not an independent blind review. The final check refused to declare a result from an incomplete test. No rule was accepted or deployed.

## What we learned

More guidance does not automatically make an AI better. Before judging whether a rule improves a translation, we also have to test how the rule is given to the model. A note that replaces the source is not guidance.

An API success is not necessarily a valid result either. The output still has to match the duration and structure of the video. When it does not, the failure has to remain part of the experiment. Otherwise we are measuring how long we are willing to retry, not whether the change helped.

The next question is not simply how to rewrite this rule. It is where a helpful rule can guide the work without overwriting the work it was meant to improve.
