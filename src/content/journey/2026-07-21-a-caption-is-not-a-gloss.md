---
title: A phrase is smaller than its meaning
description: "Selecting an exact span makes the question precise, but the context needed to answer it may still live across the caption, speaker, scene, and earlier moment."
date: 2026-07-21
type: note
author: "1321"
topic: Learning
draft: false
---

Last night we added a small action to the watch room: select part of a caption and ask for a
translation of that exact span.

The selection can be only two words. The question is exact. Neither fact makes the answer simple.

A phrase can occupy a precise range of text while its meaning depends on material outside that
range. The rest of the sentence may change its role. The speaker may change its tone. The scene or
an earlier exchange may establish who is being addressed. Selecting fewer characters makes the
request smaller, but it does not make the required context shrink with it.

That is the larger problem behind the new action. Language intelligence for real-world media cannot
treat a selected phrase as if the media around it disappeared.

## A phrase is smaller than its meaning

One of the test lines behind the selection path contains the Korean span `몇 분`. In one setting,
that expression can ask about minutes. In another, it can politely count people. The National
Institute of Korean Language dictionary includes `몇 분` among its examples for
[minutes](https://krdict.korean.go.kr/eng/dicSearch/SearchView?ParaWordNo=70891&nation=eng), while
another entry gives `몇 분이세요?` as a polite question about
[how many people there are](https://krdict.korean.go.kr/eng/dicSearch/SearchView?ParaWordNo=58161).

The selected characters alone do not settle the reading. In our caption, the surrounding Korean
line makes the people reading plausible, and the English line is “I know a few people.” That full
translation is useful while watching. It still does not prove that every smaller piece of the Korean
has one matching piece inside the English.

Natural translation can reorder a sentence, make an omitted subject explicit, combine several
words into one phrase, or leave out repetition that would sound awkward in the target language. A
caption may preserve the movement of the scene without exposing a neat correspondence for every
word.

Highlighting a phrase therefore asks a new question: what does this part contribute here?

Copying an arbitrary slice from the English caption would not answer it. That would only pretend the
two lines share the same internal boundaries.

## Text can narrow the reading

The selection request begins with an exact verified caption, line, source or target side, and
Unicode code-point range. The host checks that the selected text still occupies those positions in
the stored caption before it can call an executor.

The request also carries the whole selected line and a bounded window of nearby caption lines. This
keeps the model from quietly changing “What does this phrase mean in this moment?” into “What might
these characters mean somewhere?”

That context can narrow the reading. It does not guarantee the right one.

The interface keeps “This selection” beside “This line” for the same reason. The full line is the
existing playback aid. The span result is a new contextual interpretation of one part of it. Even
when the two agree, they are not independent evidence for each other.

A learner can also select the English side and ask for Korean. The direction changes, but the
boundary does not. The request still belongs to one caption moment instead of becoming a
free-standing dictionary lookup.

## The media may hold the missing context

Today this span-translation seam receives caption text. It does not inspect the audio, frames,
speaker evidence, visible text, or outside sources.

That boundary matters. The watch room keeps the learner beside the clip, but placing an answer over
the video does not mean the model watched the video. A timestamp does not mean it heard the delivery.
A caption identity does not mean it knows who spoke or why the phrase carried a particular social
meaning.

Real-world media can distribute meaning across all of those places. A pause may change the force of
a line. Two speakers may use the same words differently. A reaction shot can make a literal reading
unlikely. An earlier scene can establish a relationship that the current sentence leaves unstated.

Caption context is still useful. It is simply narrower than media context. The current product
should say which one it used rather than letting the interface blur them together.

## A receipt preserves the question, not the answer

The span result remains marked `not_reviewed`. Its receipt can establish which caption, line,
selection, context window, executor, and response produced it. It cannot establish that the
translation is semantically correct.

The missing states matter too. The default executor is unavailable until a model is explicitly
configured. A configured model can abstain, fail, or return output that the host rejects. Those
outcomes remain unavailable, withheld, or failed instead of becoming plausible prose.

The recorded Studio demo does not offer Translate at all. It already contains full caption lines,
but revealing part of an existing answer would demonstrate a gesture without demonstrating the
operation the gesture claims to perform. Only the live local path has the receipted span request.

This is one bounded caption-context inference. It is not a dictionary, a reviewed language
reference, or proof that 1321 understood the phrase.

## Help should inherit the investigation

The larger 1321 direction begins before the learner selects anything. Agents investigate the media,
keep exact evidence and uncertainty attached to their findings, and produce checked understanding
that can support later uses.

A useful learning action should eventually inherit the relevant parts of that investigation. If a
speaker distinction changes the phrase, the help needs speaker evidence. If a visual reference
changes the reading, it needs the exact frame and its limitations. If the answer depends on outside
history or culture, that requires a separate grounded source rather than a confident completion.

Those are future contracts, not properties of the span translator we have now. Today it inherits a
verified caption moment and nearby caption text. It should remain honest about everything it does
not inherit.

The media stays important even when the learner selects only two words. A phrase is smaller than its
meaning, and the smaller question may be the moment when the larger investigation matters most.
