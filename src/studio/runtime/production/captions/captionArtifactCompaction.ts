import type {
  CaptionProductionArtifact,
  CaptionProductionArtifactV5,
  CaptionProductionLine,
  CaptionProductionSharedLineageV5,
  SemanticEvidenceCitationInput,
  StudyPlanningReportInput,
} from "../model.ts";

type SharedAuthorityV5 = Omit<CaptionProductionSharedLineageV5, "evidence">;

function same(left: unknown, right: unknown): boolean {
  return canonicalStructure(left) === canonicalStructure(right);
}

function canonicalStructure(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStructure).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStructure(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function evidencePool<Item>(values: readonly Item[]): { values: Item[]; indexByCanonical: Map<string, number> } {
  const byCanonical = new Map<string, Item>();
  for (const value of values) {
    byCanonical.set(canonicalStructure(value), structuredClone(value));
  }
  const entries = [...byCanonical.entries()].sort(([left], [right]) => left.localeCompare(right));
  return {
    values: entries.map(([, value]) => value),
    indexByCanonical: new Map(entries.map(([canonical], index) => [canonical, index])),
  };
}

/** Build the additive compact representation without discarding any line-level causal identity. */
export function compactCaptionProductionArtifactV5(input: {
  jobId: string;
  runId: string;
  input: CaptionProductionArtifact["input"];
  executor: CaptionProductionArtifact["executor"];
  lines: readonly CaptionProductionLine[];
  result: CaptionProductionArtifact["result"];
  sharedLineage: SharedAuthorityV5;
}): CaptionProductionArtifactV5 {
  const semanticPool = evidencePool<SemanticEvidenceCitationInput>(
    input.lines.flatMap((line) => line.lineage.study.semanticCitations),
  );
  const reportPool = evidencePool<StudyPlanningReportInput>(
    input.lines.flatMap((line) => line.lineage.study.childReports),
  );

  const lines = input.lines.map((line) => {
    const causality = line.lineage.generalizedCausality;
    if (!causality || causality.schema !== "studio.caption-line-causality.v4") {
      throw new Error("Caption v5 requires one exact restudied v4 causality closure per line");
    }
    if (
      line.lineage.derivation !== input.sharedLineage.derivation ||
      line.lineage.source.artifactId !== input.sharedLineage.source.artifactId ||
      line.lineage.source.contentId !== input.sharedLineage.source.contentId ||
      !same({
        studyId: line.lineage.study.studyId,
        artifactId: line.lineage.study.artifactId,
        contentId: line.lineage.study.contentId,
        executorReceiptId: line.lineage.study.executorReceiptId,
        executorReceiptContentId: line.lineage.study.executorReceiptContentId,
      }, input.sharedLineage.study) ||
      !same(line.lineage.readiness, input.sharedLineage.readiness) ||
      !same(line.lineage.approval, input.sharedLineage.approval) ||
      !same(line.lineage.captionExecutor, input.sharedLineage.captionExecutor) ||
      !same(causality.lineage.study, input.sharedLineage.generalizedCausality.study) ||
      !same(causality.lineage.readiness, input.sharedLineage.generalizedCausality.readiness)
    ) {
      throw new Error("Caption v5 cannot compact line causality that changes shared authority");
    }
    return {
      id: line.id,
      startMs: line.startMs,
      endMs: line.endMs,
      lineage: {
        study: {
          coverage: structuredClone(line.lineage.study.coverage),
          claimIds: [...line.lineage.study.claimIds],
          semanticCitationIndexes: line.lineage.study.semanticCitations.map((citation) => semanticPool.indexByCanonical.get(canonicalStructure(citation))!),
          childReportIndexes: line.lineage.study.childReports.map((report) => reportPool.indexByCanonical.get(canonicalStructure(report))!),
        },
        generalizedCausality: {
          trackId: causality.range.trackId,
          coverageId: causality.lineage.coverageId,
          coverageState: causality.lineage.coverageState,
          preservedStates: [...causality.lineage.preservedStates],
          claimIds: [...causality.lineage.claimIds],
          citationIds: [...causality.lineage.citationIds],
          passIds: [...causality.lineage.passIds],
        },
      },
      source: structuredClone(line.source),
      target: structuredClone(line.target),
    };
  });

  return {
    schema: "studio.caption-production.artifact.v5",
    jobId: input.jobId,
    runId: input.runId,
    input: structuredClone(input.input),
    executor: structuredClone(input.executor),
    sharedLineage: {
      ...structuredClone(input.sharedLineage),
      evidence: { semanticCitations: semanticPool.values, childReports: reportPool.values },
    },
    lines,
    result: structuredClone(input.result),
  };
}

function resolveReferences<Item>(
  indexes: readonly number[],
  pool: readonly Item[],
  used: Set<number>,
  label: string,
): Item[] {
  if (new Set(indexes).size !== indexes.length) throw new Error(`Caption v5 line repeats one ${label} reference`);
  return indexes.map((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= pool.length) {
      throw new Error(`Caption v5 line cites a missing shared ${label} identity`);
    }
    const value = pool[index];
    used.add(index);
    return structuredClone(value);
  });
}

/** Materialize the full logical line closure only after the compact artifact has validated. */
export function materializeCaptionProductionLines(artifact: CaptionProductionArtifact): CaptionProductionLine[] {
  if (artifact.schema !== "studio.caption-production.artifact.v5") return structuredClone(artifact.lines);
  const shared = artifact.sharedLineage;
  const usedSemantic = new Set<number>();
  const usedReports = new Set<number>();
  const lines = artifact.lines.map((line): CaptionProductionLine => ({
    id: line.id,
    startMs: line.startMs,
    endMs: line.endMs,
    lineage: {
      derivation: shared.derivation,
      source: {
        ...structuredClone(shared.source),
        window: { startMs: line.startMs, endMs: line.endMs },
      },
      study: {
        ...structuredClone(shared.study),
        coverage: structuredClone(line.lineage.study.coverage),
        claimIds: [...line.lineage.study.claimIds],
        semanticCitations: resolveReferences(
          line.lineage.study.semanticCitationIndexes,
          shared.evidence.semanticCitations,
          usedSemantic,
          "semantic-citation",
        ),
        childReports: resolveReferences(
          line.lineage.study.childReportIndexes,
          shared.evidence.childReports,
          usedReports,
          "child-report",
        ),
      },
      readiness: structuredClone(shared.readiness),
      approval: structuredClone(shared.approval),
      captionExecutor: structuredClone(shared.captionExecutor),
      generalizedCausality: {
        schema: shared.generalizedCausality.schema,
        range: {
          artifactId: shared.source.artifactId,
          trackId: line.lineage.generalizedCausality.trackId,
          startMs: line.startMs,
          endMs: line.endMs,
        },
        source: structuredClone(line.source),
        target: structuredClone(line.target),
        lineage: {
          study: structuredClone(shared.generalizedCausality.study),
          readiness: structuredClone(shared.generalizedCausality.readiness),
          coverageId: line.lineage.generalizedCausality.coverageId,
          coverageState: line.lineage.generalizedCausality.coverageState,
          preservedStates: [...line.lineage.generalizedCausality.preservedStates],
          claimIds: [...line.lineage.generalizedCausality.claimIds],
          citationIds: [...line.lineage.generalizedCausality.citationIds],
          passIds: [...line.lineage.generalizedCausality.passIds],
        },
      },
    },
    source: structuredClone(line.source),
    target: structuredClone(line.target),
  }));
  if (
    usedSemantic.size !== shared.evidence.semanticCitations.length ||
    usedReports.size !== shared.evidence.childReports.length
  ) throw new Error("Caption v5 contains unreferenced shared causal evidence");
  return lines;
}
