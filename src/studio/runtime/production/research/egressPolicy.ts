import { lookup as dnsLookup } from "node:dns/promises";
import { performance } from "node:perf_hooks";

import { canonicalSha256 } from "../canonicalIdentity.ts";
import {
  RESEARCH_ALLOWED_MIME_TYPES,
  RESEARCH_LIMITS,
  type ResearchAllowedMimeType,
  type ResearchFailureReason,
  type ResearchRedirectHop,
} from "../model/research.ts";

export class ResearchEgressError extends Error {
  readonly reason: ResearchFailureReason;

  constructor(reason: ResearchFailureReason, message: string) {
    super(message);
    this.name = "ResearchEgressError";
    this.reason = reason;
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type ResearchDnsLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export type ResearchFetcher = (url: string, init: RequestInit) => Promise<Response>;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".in-addr.arpa", ".ip6.arpa"];
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 192 && b === 88) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a === 203 && b === 0) return true;
  return a >= 224;
}

function isPrivateIpv6(rawAddress: string): boolean {
  const address = rawAddress.toLowerCase().split("%")[0];
  if (address === "::" || address === "::1") return true;
  const mapped = address.match(/^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  // NAT64 well-known prefix and 6to4 both tunnel an embedded IPv4; never a research destination.
  if (address.startsWith("64:ff9b:")) return true;
  const groups = address.split(":");
  const head = groups[0];
  if (head === "2002") {
    const embedded = groups.slice(1, 3).filter((group) => group.length > 0);
    if (embedded.length === 2) {
      const high = Number.parseInt(embedded[0].padStart(4, "0"), 16);
      const low = Number.parseInt(embedded[1].padStart(4, "0"), 16);
      if (Number.isInteger(high) && Number.isInteger(low)) {
        return isPrivateIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
      }
    }
    return true;
  }
  if (head.startsWith("fc") || head.startsWith("fd")) return true;
  if (["fe8", "fe9", "fea", "feb", "fec", "fed", "fee", "fef"].some((prefix) => head.startsWith(prefix))) return true;
  if (head.startsWith("ff")) return true;
  if (address.startsWith("2001:db8")) return true;
  return head === "" || head === "0";
}

export function assertPublicAddress(resolved: ResolvedAddress): void {
  const isPrivate = resolved.family === 4
    ? isPrivateIpv4(resolved.address)
    : resolved.family === 6
      ? isPrivateIpv6(resolved.address)
      : true;
  if (isPrivate) {
    throw new ResearchEgressError("private_destination", `Research egress resolved a private or reserved address ${resolved.address}`);
  }
}

const defaultLookup: ResearchDnsLookup = async (hostname) => {
  const entries = await dnsLookup(hostname, { all: true });
  return entries.map((entry) => ({ address: entry.address, family: entry.family }));
};

/**
 * Fail-closed URL policy: exact https on the granted hostname allowlist, default port, no
 * userinfo, no IP literals, no loopback or internal name suffixes.
 */
export function validateResearchUrl(rawUrl: string, allowedDomains: readonly string[]): URL {
  if (rawUrl.length > RESEARCH_LIMITS.maxUrlChars) {
    throw new ResearchEgressError("url_too_long", "Research egress URL exceeds its closed length");
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ResearchEgressError("fetch_failed", "Research egress URL does not parse");
  }
  if (url.protocol !== "https:") {
    throw new ResearchEgressError("scheme_not_allowed", `Research egress rejects the ${url.protocol} scheme`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new ResearchEgressError("credentials_in_url", "Research egress rejects URLs carrying credentials");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new ResearchEgressError("port_not_allowed", "Research egress allows only the default https port");
  }
  // No trailing-dot stripping: the receipt validator compares the raw URL hostname, so an
  // absolute FQDN like example.com. must be rejected here rather than fetched and then failing
  // receipt validation after the network call.
  const hostname = url.hostname.toLowerCase();
  if (hostname.length === 0 || hostname.startsWith("[") || IPV4_PATTERN.test(hostname) || hostname.includes(":")) {
    throw new ResearchEgressError("destination_not_allowed", "Research egress rejects IP-literal destinations");
  }
  if (hostname === "localhost" || BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new ResearchEgressError("destination_not_allowed", "Research egress rejects local and internal destinations");
  }
  if (!allowedDomains.includes(hostname)) {
    throw new ResearchEgressError("destination_not_allowed", `Research egress destination ${hostname} is outside the granted allowlist`);
  }
  return url;
}

export async function assertPublicDestination(hostname: string, lookup: ResearchDnsLookup): Promise<void> {
  let resolved: ResolvedAddress[];
  try {
    resolved = await lookup(hostname);
  } catch {
    throw new ResearchEgressError("fetch_failed", `Research egress could not resolve ${hostname}`);
  }
  if (resolved.length === 0) {
    throw new ResearchEgressError("fetch_failed", `Research egress resolved no addresses for ${hostname}`);
  }
  for (const entry of resolved) assertPublicAddress(entry);
}

export interface FetchedResearchDocument {
  bytes: Buffer;
  finalUrl: string;
  redirectChain: ResearchRedirectHop[];
  status: 200;
  mimeType: ResearchAllowedMimeType;
  declaredContentLength: number | null;
  headersDigest: string;
}

function parseMimeType(contentType: string | null): ResearchAllowedMimeType {
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!(RESEARCH_ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new ResearchEgressError("mime_not_allowed", `Research egress rejects the ${mime || "missing"} media type`);
  }
  return mime as ResearchAllowedMimeType;
}

async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    throw new ResearchEgressError("fetch_failed", "Research egress received a response without a readable body");
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new ResearchEgressError("wall_timeout", "Research egress exhausted its wall-time grant while streaming the body");
        }
        throw new ResearchEgressError("fetch_failed", "Research egress failed while streaming the response body");
      }
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      total += chunk.length;
      if (total > maxBytes) {
        throw new ResearchEgressError("byte_limit_exceeded", "Research egress aborted a response beyond its byte grant");
      }
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

/**
 * Host-owned bounded fetch. Every hop revalidates scheme, allowlist, and resolved addresses;
 * redirects are followed manually and receipted; cookies are never sent and never stored.
 * The DNS check runs before each fetch without pinning the socket address, so a nameserver
 * rotating answers inside that window is a stated residual risk, not a covered one.
 */
export async function fetchResearchDocument(
  initialUrl: string,
  options: {
    allowedDomains: readonly string[];
    deadlineAtMs: number;
    fetcher?: ResearchFetcher;
    lookup?: ResearchDnsLookup;
  },
): Promise<FetchedResearchDocument> {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const lookup = options.lookup ?? defaultLookup;
  const redirectChain: ResearchRedirectHop[] = [];
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= RESEARCH_LIMITS.maxRedirects; hop += 1) {
    const url = validateResearchUrl(currentUrl, options.allowedDomains);
    await assertPublicDestination(url.hostname.toLowerCase(), lookup);
    const remainingMs = Math.floor(options.deadlineAtMs - performance.now());
    if (remainingMs <= 0) {
      throw new ResearchEgressError("wall_timeout", "Research egress exhausted its wall-time grant");
    }
    let response: Response;
    try {
      response = await fetcher(url.href, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: {
          accept: RESEARCH_ALLOWED_MIME_TYPES.join(", "),
          "user-agent": "studio-research-host/1",
        },
        signal: AbortSignal.timeout(remainingMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ResearchEgressError("wall_timeout", "Research egress exhausted its wall-time grant");
      }
      throw new ResearchEgressError("fetch_failed", "Research egress transport failed");
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      if (!location) {
        throw new ResearchEgressError("fetch_failed", "Research egress received a redirect without a location");
      }
      if (redirectChain.length >= RESEARCH_LIMITS.maxRedirects) {
        throw new ResearchEgressError("redirect_limit_exceeded", "Research egress exceeded its redirect grant");
      }
      let nextUrl: string;
      try {
        nextUrl = new URL(location, url).href;
      } catch {
        throw new ResearchEgressError("fetch_failed", "Research egress received an unparseable redirect location");
      }
      redirectChain.push({ url: url.href, status: response.status, location: nextUrl });
      currentUrl = nextUrl;
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new ResearchEgressError("fetch_failed", `Research egress received terminal status ${response.status}`);
    }
    const mimeType = parseMimeType(response.headers.get("content-type"));
    const declaredRaw = response.headers.get("content-length");
    const declaredContentLength = declaredRaw === null ? null : Number(declaredRaw);
    if (declaredContentLength !== null && (!Number.isSafeInteger(declaredContentLength) || declaredContentLength < 0)) {
      throw new ResearchEgressError("fetch_failed", "Research egress received an invalid content-length");
    }
    if (declaredContentLength !== null && declaredContentLength > RESEARCH_LIMITS.maxDocumentBytes) {
      throw new ResearchEgressError("byte_limit_exceeded", "Research egress declared response exceeds its byte grant");
    }
    const bytes = await readBounded(response, RESEARCH_LIMITS.maxDocumentBytes);
    if (bytes.length === 0) {
      throw new ResearchEgressError("fetch_failed", "Research egress received an empty document");
    }
    const headersDigest = `sha256:${canonicalSha256({
      contentType: response.headers.get("content-type"),
      contentLength: declaredRaw,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    })}`;
    return {
      bytes,
      finalUrl: url.href,
      redirectChain,
      status: 200,
      mimeType,
      declaredContentLength,
      headersDigest,
    };
  }
  throw new ResearchEgressError("redirect_limit_exceeded", "Research egress exceeded its redirect grant");
}
