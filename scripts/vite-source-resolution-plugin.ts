import type { IncomingMessage, ServerResponse } from "node:http";

import {
  SourceResolutionError,
  resolveYouTubeSource,
} from "./lib/resolve-youtube-source.ts";

const ROUTE = "/api/studio/source-resolutions";
const MAXIMUM_BODY_BYTES = 4 * 1024;

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAXIMUM_BODY_BYTES) {
      throw new SourceResolutionError("invalid_source", "The source request is too large.", 413);
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    throw new SourceResolutionError("invalid_source", "The source request is not valid JSON.", 400, error);
  }
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

export function studioSourceResolutionPlugin() {
  return {
    name: "studio-local-source-resolution",
    apply: "serve" as const,
    configureServer(server: {
      middlewares: {
        use: (handler: (
          request: IncomingMessage,
          response: ServerResponse,
          next: () => void,
        ) => void) => void;
      };
    }) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://studio.local");
        if (url.pathname !== ROUTE) {
          next();
          return;
        }
        void (async () => {
          if (request.method !== "POST") {
            throw new SourceResolutionError("invalid_source", "Only POST is supported for source resolution.", 405);
          }
          if (url.search) {
            throw new SourceResolutionError("invalid_source", "Source resolution accepts no query parameters.", 400);
          }
          if ((request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
            throw new SourceResolutionError("invalid_source", "Source resolution requires JSON.", 415);
          }
          const body = await readBody(request);
          if (body === null || typeof body !== "object" || Array.isArray(body)) {
            throw new SourceResolutionError("invalid_source", "Source resolution requires one URL.", 400);
          }
          const item = body as Record<string, unknown>;
          if (Object.keys(item).length !== 1 || !("url" in item) || typeof item.url !== "string") {
            throw new SourceResolutionError("invalid_source", "Source resolution requires one URL.", 400);
          }
          send(response, 200, await resolveYouTubeSource(item.url));
        })().catch((error: unknown) => {
          const known = error instanceof SourceResolutionError
            ? error
            : new SourceResolutionError("source_inaccessible", "Source metadata resolution failed.", 500, error);
          send(response, known.httpStatus, { error: { code: known.code, message: known.message } });
        });
      });
    },
  };
}
