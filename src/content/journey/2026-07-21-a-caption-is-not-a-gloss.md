---
title: A caption is not a gloss
description: "A full caption helps someone keep watching. A selected phrase asks a smaller contextual question, and the answer should not pretend translation divides word for word."
date: 2026-07-21
type: note
author: "1321"
topic: Learning
draft: false
---

Last night we added a small action to the watch room: select part of a caption and ask for a
translation of that exact span.

That can sound redundant. The video already has a timed Korean line and an English translation. Why
translate something that has already been translated?

Because the full caption and the selected phrase answer different questions.

A caption helps someone follow the video. A selected phrase becomes interesting when the full
caption is not enough, or when the learner wants to understand how one part contributed to the
whole. Treating those as the same translation problem creates a tempting fiction: that every piece
of the source has one matching piece on the other side.

Translation does not usually divide that cleanly.

## Captions serve the flow of watching

A caption has to arrive with the scene, fit on the screen, and remain readable before the next line
replaces it. Its job is not to display a complete linguistic analysis.

Natural translation can reorder a sentence, make an omitted subject explicit, combine several words
into one English phrase, or leave out repetition that would sound awkward in the target language. A
good caption may preserve what the speaker meant without exposing a neat correspondence for every
word.

One of the test lines behind the new selection path contains the Korean span `몇 분`. In one
setting, that expression can ask about minutes. In another, it can politely count people. The
National Institute of Korean Language dictionary includes `몇 분` among its examples for
[minutes](https://krdict.korean.go.kr/eng/dicSearch/SearchView?ParaWordNo=70891&nation=eng), while
another entry gives `몇 분이세요?` as a polite question about
[how many people there are](https://krdict.korean.go.kr/eng/dicSearch/SearchView?ParaWordNo=58161).

The surrounding line determines which reading makes sense. In our caption context, the English line
is “I know a few people.” That is useful while watching. But highlighting two Korean words inside
the source asks something the full English line does not answer by itself: what does this smaller
span mean here?

Copying an arbitrary slice from the English caption would not answer that question. It would only
pretend the two lines share the same internal boundaries.

## A selected phrase asks a different question

The selection action begins with an exact caption line, an exact side of that line, and exact Unicode
code-point positions. The host checks that the selected text still occupies those positions in the
stored caption before doing anything else.

The translation request also carries the whole selected line and a bounded window of nearby caption
context. The smaller the visible selection becomes, the more important that surrounding context can
be.

This is not because context guarantees the right answer. It does not. It prevents the system from
quietly changing the question from “What does this phrase mean in this moment?” to “What might these
characters mean somewhere?”

The interface keeps the two units visible beside each other: “This selection” and “This line.” That
distinction matters more than it first appears. The line translation is the existing playback aid.
The span translation is a new, explicit interpretation of one part of it. Agreement may be
reassuring, but the two outputs are not independent evidence for each other.

A learner can also select the English side and ask for Korean. The direction changes, but the
contract does not. The request still belongs to one verified caption moment rather than becoming a
free-standing dictionary lookup.

## Translation does not divide cleanly by word

Language-learning tools often make word-level interaction feel obvious. Tap a word, receive its
meaning.

That interaction is useful when the unit really behaves like a word with a stable local definition.
It becomes misleading when meaning is carried by grammar, politeness, omitted material, an idiom, or
the relationship between several words.

A span can therefore receive a contextual gloss without becoming proof of word-for-word alignment.
The answer may explain what the selection contributes to this line. It does not establish that the
same English phrase should replace it in every sentence, or that the caption can be reconstructed by
joining a set of isolated glosses.

This is why the new result remains marked `not_reviewed`. The receipt can establish which caption,
line, selection, context, executor, and response produced it. It cannot establish that the
translation is semantically correct.

Caption context is input to the answer. It is not evidence that the answer deserves to be trusted.

## Missing help is better than a false equivalence

The default span-translation executor is unavailable until a model is explicitly configured. A
configured model can still decline to answer, fail, or produce an output that the host rejects.

Those states remain separate. An unavailable executor does not become an empty translation. An
abstention does not become a guess. A failed request can be retried only through the bounded retry
path.

The recorded Studio demo goes further: it does not offer Translate at all.

The recording already contains full caption lines, so it would have been easy to make selection look
interactive by revealing part of an existing answer. That would demonstrate a gesture without
demonstrating the operation the gesture claims to perform. The live path now has a real, receipted
span request. The recorded path does not borrow it.

This is a narrow capability. It is not a dictionary, a reviewed language reference, or evidence that
the system understood the phrase correctly. It is one contextual attempt over one exact selection,
with the option to remain unavailable.

## Answer the question, then return to the video

The larger learning direction remains watch first.

A viewer encounters a line, notices something worth understanding, and selects it without leaving
the moment behind. The help appears beside the caption. When the question is answered, the video is
still there.

That is different from converting the clip into a sequence of vocabulary items or treating every
caption as an assignment. The media supplies the voices, timing, situation, and reason the phrase
mattered. The learning action should preserve those things instead of extracting the phrase into a
context-free lesson.

A caption tells the viewer enough to stay with the scene. A gloss helps investigate the part that
made them pause.

The smaller question does not need less context. It needs a more exact boundary around the question,
and enough of the video around it to keep the answer honest.
