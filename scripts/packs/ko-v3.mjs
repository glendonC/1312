/**
 * The executable half of the ko-v3 language pack.
 *
 * public/demo/packs/ko-v3.json is the DECLARATIVE half: ids, scopes, prose rules, the
 * things the Studio renders. This file is the CODE half — the "rules/ code-enforced
 * playbooks" of docs/ARCHITECTURE.md — and it is the only place in the pipeline that is
 * allowed to know a single Korean character.
 *
 * The core (src/studio/*, scripts/run-clip.mjs) stays language-neutral: it asks the pack
 * "does this line carry a known-hard phenomenon?" and "does this target line invent a
 * family?" and gets back ids that already exist in the JSON pack. Swap the pack, swap the
 * language, and not one line of the orchestrator changes.
 *
 * Every predicate here is a LEXICAL DETECTION, not a judgement about correctness. Marking a
 * cue hard means "this line contains something ko-v3 knows breaks recognisers", which the
 * run can genuinely determine. It never means "this line is wrong" — that needs gold, and
 * gold lives in bench/.
 */

/** Kinship terms that are inherently a family relation: they are not address forms. */
const KIN_CONFIRMED = ["친누나", "친형", "친동생", "매형", "형수", "제수", "처남", "장인", "장모"];

/** Address forms. Literalising one of these invents a family. ko.kinship_address. */
const ADDRESS_FORMS = ["누나", "오빠", "형", "언니", "삼촌", "이모", "고모"];

/** English kinship the translator can reach for. Used to catch an invented family. */
const EN_KINSHIP =
  /\b(sister|brother|sister-in-law|brother-in-law|aunt|uncle|cousin|mother|father|mom|dad)\b/i;

/**
 * Bound counters. 분 is the trap: honorific person-counter AND "minute".
 *
 * A counter only counts when a NUMERAL is bound to it. Matching the counter alone is what a
 * first draft of this file did, and it fired ko.numeral_boundary on 어떤 분은 — "some people" —
 * where 분 is a plain honorific noun and there is no numeral within reach. A detector that
 * cries wolf on ordinary speech is worse than no detector: it inflates the hard-line count
 * with lines nothing is actually hard about, and every number downstream inherits the lie.
 */
const NUMERAL = "(?:몇|[0-9]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|스물|일|이|삼|사|오|육|칠|팔|구|십)";
const COUNTERS = ["분", "명", "달", "개", "번", "살", "권", "마리", "시간", "잔", "가지"];

/** 몇 + 분 is genuinely ambiguous between "how many people" and "how many minutes". */
const COUNTER_HOMOPHONE = /몇\s*분/;

/**
 * Phenomena this pack can DETECT in a source line, in priority order.
 * Each id must exist in public/demo/packs/ko-v3.json → phenomena[].
 */
export function detectPhenomena(sourceText) {
  const hits = [];

  if (COUNTER_HOMOPHONE.test(sourceText)) {
    hits.push({
      id: "ko.counter_homophone",
      error_type: "homophone",
      label: "몇 분 · honorific person-counter or minutes",
    });
  }

  const kinConfirmed = KIN_CONFIRMED.filter((k) => sourceText.includes(k));
  const bareAddress = ADDRESS_FORMS.filter(
    (a) => sourceText.includes(a) && !KIN_CONFIRMED.some((k) => k.includes(a) && sourceText.includes(k)),
  );

  if (kinConfirmed.length > 0 || bareAddress.length > 0) {
    hits.push({
      id: "ko.kinship_address",
      error_type: "other",
      label: [...kinConfirmed, ...bareAddress].join(" · ") + " · address form or kinship",
    });
  }

  const counters = COUNTERS.filter((c) => new RegExp(`${NUMERAL}\\s*${c}`).test(sourceText));
  if (counters.length > 0 && !hits.some((h) => h.id === "ko.counter_homophone")) {
    hits.push({
      id: "ko.numeral_boundary",
      error_type: "boundary",
      label: `counter ${counters.join(" · ")} · a lost pause eats the numeral`,
    });
  }

  return hits;
}

/**
 * ko.address_form gate (pack scope).
 *
 * "Address forms are not kinship unless the glossary confirms the family relation."
 * So: an English kinship word in the target is only allowed if the source line carries a
 * kinship-confirming token (친누나, 매형 …) or the glossary confirms the relation. Otherwise
 * the translator has invented a family and the line goes back.
 *
 * Returns a GateReading in the shape TraceView.gate wants: value/limit are 0..1 so the bar
 * on the qc card means something. value = 1 when every kinship word in the target is
 * supported, 0 when one is not.
 */
export function addressGate(cue, glossary) {
  const target = cue.draft ?? "";
  const claims = target.match(EN_KINSHIP) ?? [];

  if (claims.length === 0) return null; // nothing to check; the gate does not fire.

  const spoken = cue.source.text;
  const confirmedInSource = KIN_CONFIRMED.some((k) => spoken.includes(k));
  const confirmedInGlossary = glossary.some(
    (g) => g.kind === "address_form" && spoken.includes(g.term) && /kinship|family|sister|brother/i.test(g.gloss),
  );
  const supported = confirmedInSource || confirmedInGlossary;

  return {
    name: "address",
    scope: "pack",
    gate_id: "ko.address_form",
    value: supported ? 1 : 0,
    limit: 1,
    fail: !supported,
    repairable: true,
    reason: supported
      ? `"${claims[0]}" is confirmed by a kinship token in the source`
      : `"${claims[0]}" has no kinship token in the source: 누나/오빠/형/언니 are address forms`,
  };
}

/**
 * ko.entity_support gate (pack scope).
 *
 * "Every proper noun in the target must trace to a glossary entry or to the source."
 *
 * This is the sibling of ko.cast_closed, for the case where there is no cast. A scripted show
 * has a known cast list and a name outside it can be demoted on sight. An unscripted podcast
 * names nobody, so there is no list to be outside of — but an invented name is still invented,
 * and that is what this checks. Firing ko.cast_closed on a run whose glossary declares
 * cast_closed: false would be arming a rule against an empty list, and every proper noun in
 * the English — Thailand, Chiang Mai — would come back as a fabrication.
 *
 * Every capitalised token in the target has to trace back to a glossary entry, or it was
 * invented. Sentence-initial words and a small function-word list are exempt because
 * capitalisation there carries no claim.
 */
const CAP_EXEMPT = new Set([
  "I", "I'm", "I've", "I'd", "I'll", "A", "An", "The", "It", "It's", "He", "She", "They",
  "We", "You", "Yeah", "Yes", "No", "So", "But", "And", "Oh", "Ah", "Well", "That", "This",
  "There", "Then", "When", "What", "Why", "How", "My", "His", "Her", "Their", "Our", "At",
  "In", "On", "For", "To", "Back", "Just", "Right", "Actually", "Anyway", "Before", "After",
  "Because", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
]);

export function entityGate(cue, glossary) {
  const target = cue.draft ?? "";
  const words = target.split(/\s+/);

  const supported = new Set();
  for (const g of glossary) {
    // The English side of a gloss: "Thailand · country" → "Thailand".
    for (const token of g.gloss.split(/[^A-Za-z'-]+/)) {
      if (token.length > 1) supported.add(token.toLowerCase());
    }
  }

  const invented = [];
  words.forEach((raw, i) => {
    const w = raw.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, "");
    if (w.length < 2 || !/^[A-Z]/.test(w)) return;
    if (i === 0 || /[.!?]$/.test(words[i - 1] ?? "")) return; // sentence-initial: no claim.
    if (CAP_EXEMPT.has(w)) return;
    if (supported.has(w.toLowerCase())) return;
    invented.push(w);
  });

  const total = words.filter((w) => /^[A-Z]/.test(w)).length;
  if (total === 0) return null;

  return {
    name: "entity",
    scope: "pack",
    gate_id: "ko.entity_support",
    value: invented.length === 0 ? 1 : 0,
    limit: 1,
    fail: invented.length > 0,
    repairable: true,
    invented,
    reason:
      invented.length === 0
        ? "every proper noun in the target traces to a glossary entry"
        : `${invented.join(", ")} — not in the closed cast and not in the glossary`,
  };
}

export const PACK_GATES = [addressGate, entityGate];
