import type { ResearchAllowedMimeType, ResearchExtractionMethod } from "../model/research.ts";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const BLOCK_TAG = /<\/?(?:p|div|section|article|header|footer|main|aside|nav|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|blockquote|pre|figure|figcaption|br|hr)\b[^>]*>/gi;

function extractHtmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Strip to the closing tag, or to end-of-input when the tag is never closed, so an
      // unclosed <script>/<style> never leaks its raw body into citable extraction text.
      .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, " ")
      .replace(BLOCK_TAG, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractPlainText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function researchExtractionMethodFor(mimeType: ResearchAllowedMimeType): ResearchExtractionMethod {
  return mimeType === "text/html" ? "html_text_v1" : "plain_text_v1";
}

/**
 * Deterministic pinned extraction: the same document bytes always yield the same text, so a
 * cold audit can re-run the method and fail closed on any drift. No network, no models.
 */
export function extractResearchText(documentBytes: Buffer, method: ResearchExtractionMethod): string {
  const decoded = documentBytes.toString("utf8");
  return method === "html_text_v1" ? extractHtmlText(decoded) : extractPlainText(decoded);
}
