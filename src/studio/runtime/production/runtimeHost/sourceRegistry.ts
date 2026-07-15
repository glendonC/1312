import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  loadOwnedSourceSession,
  type LoadedOwnedSourceSession,
} from "../runStart/sourceSessionLoader.ts";
import type { RuntimeHostSourceSummary } from "./model.ts";
import { RuntimeHostError } from "./errors.ts";

interface RegisteredEntry {
  directory: string;
  loaded: LoadedOwnedSourceSession;
}

export interface RuntimeSourceRegistryOptions {
  sourceDirectories: string[];
  sourceRoot?: string;
}

function contained(root: string, candidate: string): boolean {
  const inside = relative(root, candidate);
  return inside.length > 0 && !inside.startsWith("..") && !isAbsolute(inside);
}

/** Host-owned mapping from stable source identities to revalidated local preflight directories. */
export class RuntimeSourceRegistry {
  private readonly entries = new Map<string, RegisteredEntry>();

  static async open(options: RuntimeSourceRegistryOptions): Promise<RuntimeSourceRegistry> {
    if (options.sourceDirectories.length === 0) {
      throw new RuntimeHostError("no_registered_sources", "At least one owned source directory must be registered.");
    }
    const registry = new RuntimeSourceRegistry();
    const sourceRoot = options.sourceRoot ? await realpath(resolve(options.sourceRoot)) : null;
    for (const input of options.sourceDirectories) {
      const directory = await realpath(resolve(input));
      if (sourceRoot && !contained(sourceRoot, directory)) {
        throw new RuntimeHostError(
          "source_outside_root",
          "A registered source directory is outside the configured source root.",
        );
      }
      const loaded = await loadOwnedSourceSession(directory);
      const existing = registry.entries.get(loaded.session.sessionId);
      if (existing && existing.loaded.session.revisionId !== loaded.session.revisionId) {
        throw new RuntimeHostError(
          "ambiguous_source_session",
          "Two registered directories resolve to one source session with different revisions.",
        );
      }
      registry.entries.set(loaded.session.sessionId, { directory, loaded });
    }
    return registry;
  }

  list(): RuntimeHostSourceSummary[] {
    return [...this.entries.values()]
      .map(({ loaded }) => ({
        sourceSessionId: loaded.session.sessionId,
        sourceRevisionId: loaded.session.revisionId,
        sourceContentId: loaded.session.source.contentId,
        label: loaded.operator.label,
        rightsScope: loaded.operator.rightsScope,
        durationMs: loaded.session.source.durationMs,
        trackCount: loaded.descriptor.tracks.length,
        preflightSchema: loaded.session.preflight.schema,
        detectedLanguageEvidenceAvailable:
          loaded.session.detectedLanguageEvidenceContentIds.length > 0,
      }))
      .sort((left, right) => left.sourceSessionId.localeCompare(right.sourceSessionId));
  }

  async resolve(sourceSessionId: string, expectedRevisionId: string): Promise<LoadedOwnedSourceSession> {
    const entry = this.entries.get(sourceSessionId);
    if (!entry) {
      throw new RuntimeHostError("unknown_source_session", "The source session is not registered.", 404);
    }
    let loaded: LoadedOwnedSourceSession;
    try {
      loaded = await loadOwnedSourceSession(entry.directory);
    } catch (error) {
      throw new RuntimeHostError(
        "source_revalidation_failed",
        "The registered source no longer passes owned-source and sealed-preflight validation.",
        409,
        { cause: error },
      );
    }
    if (loaded.session.sessionId !== sourceSessionId || loaded.session.revisionId !== expectedRevisionId) {
      throw new RuntimeHostError(
        "stale_source_revision",
        "The requested source revision is stale or no longer registered.",
        409,
      );
    }
    this.entries.set(sourceSessionId, { directory: entry.directory, loaded });
    return loaded;
  }
}
