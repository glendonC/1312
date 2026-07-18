import {
  canonicalJson,
  canonicalSha256,
  sha256Hex,
} from "../../canonicalIdentity.ts";

export { canonicalJson, canonicalSha256, sha256Hex };

/** Browser-safe identity for the canonical JSON line stored by the runtime artifact store. */
export function canonicalJsonContentId(value: unknown): string {
  return `sha256:${sha256Hex(`${canonicalJson(value)}\n`)}`;
}
