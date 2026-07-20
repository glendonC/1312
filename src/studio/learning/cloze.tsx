import { useEffect, useState } from "react";

import type { ClozeAmount } from "./viewerSession";

/**
 * Listen practice is cloze deletion, not a haze: a chosen share of the caption's words is blanked
 * out (XXX ____ YYY) so the ear supplies them, and each blank reveals on tap or hover. Which words
 * blank is a pure function of the line identity and the amount, so the on-video caption and the
 * transcript always blank the same words and re-renders never reshuffle them.
 */
const CLOZE_SHARE: Record<ClozeAmount, number> = { 1: 0.25, 2: 0.5, 3: 0.75 };

/** Deterministic 32-bit hash (FNV-1a) of a string; the only randomness cloze selection has. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface ClozeToken {
  text: string;
  blank: boolean;
}

/**
 * Split a caption into whitespace-preserving tokens and mark the blanked words. Only tokens with
 * letters or digits are candidates; punctuation-only tokens always stay. At least one word blanks
 * whenever any candidate exists, so Listen is never silently a no-op on short lines.
 */
export function clozeTokens(text: string, seed: string, amount: ClozeAmount): ClozeToken[] {
  const parts = text.split(/(\s+)/).filter((part) => part.length > 0);
  const candidates: number[] = [];
  parts.forEach((part, index) => {
    if (/[\p{L}\p{N}]/u.test(part)) candidates.push(index);
  });
  if (candidates.length === 0) return parts.map((part) => ({ text: part, blank: false }));
  const count = Math.max(1, Math.round(candidates.length * CLOZE_SHARE[amount]));
  const ranked = [...candidates].sort(
    (left, right) => hash32(`${seed}:${left}`) - hash32(`${seed}:${right}`),
  );
  const blanked = new Set(ranked.slice(0, count));
  return parts.map((part, index) => ({ text: part, blank: blanked.has(index) }));
}

/**
 * The caption line with its blanks. A blank keeps the real word in the DOM and masks it visually,
 * so tapping or hovering reveals the exact recorded text and nothing is ever substituted. Revealed
 * blanks reset when the line, the amount, or the mode changes, so every replay is a fresh exercise.
 */
export function ClozeText({
  text,
  seed,
  amount,
  lang,
}: {
  text: string;
  seed: string;
  amount: ClozeAmount;
  lang: string;
}) {
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    setRevealed(new Set());
  }, [text, seed, amount]);

  const tokens = clozeTokens(text, seed, amount);
  return (
    <span className="cloze-line" lang={lang}>
      {tokens.map((token, index) =>
        token.blank ? (
          <button
            key={index}
            type="button"
            className="cloze-word"
            data-revealed={revealed.has(index) ? "true" : undefined}
            aria-pressed={revealed.has(index)}
            title={revealed.has(index) ? undefined : "Reveal this word"}
            onClick={(event) => {
              // A blank is part of the caption, never a playback control beneath it.
              event.stopPropagation();
              setRevealed((current) => {
                const next = new Set(current);
                if (next.has(index)) next.delete(index);
                else next.add(index);
                return next;
              });
            }}
          >
            {token.text}
          </button>
        ) : (
          <span key={index}>{token.text}</span>
        ),
      )}
    </span>
  );
}
