export interface ResearchProviderResult {
  url: string;
  title: string;
  snippet: string;
}

/**
 * Narrow replaceable search seam. The host owns bounding, receipts, and egress; a provider
 * only maps a query to ordered candidate results and must never fetch documents itself.
 */
export interface ResearchSearchProvider {
  readonly id: string;
  readonly version: string;
  search(query: string, options: { maxResults: number; deadlineAtMs: number }): Promise<ResearchProviderResult[]>;
}

/** Deterministic offline provider for tests and replay. Unknown queries return no results. */
export class FixtureResearchProvider implements ResearchSearchProvider {
  readonly id: string;
  readonly version: string;
  private readonly fixtures: Record<string, ResearchProviderResult[]>;

  constructor(
    fixtures: Record<string, ResearchProviderResult[]>,
    options: { id?: string; version?: string } = {},
  ) {
    this.fixtures = structuredClone(fixtures);
    this.id = options.id ?? "fixture-research-provider";
    this.version = options.version ?? "1";
  }

  async search(query: string, options: { maxResults: number }): Promise<ResearchProviderResult[]> {
    return structuredClone(this.fixtures[query] ?? []).slice(0, Math.max(0, options.maxResults));
  }
}
