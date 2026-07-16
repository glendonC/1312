import type { ReactNode } from "react";

import type { ProductionStudioGrantView } from "../../runtime/production/studioProjection";

type ProductionIdentityKind = "task" | "worker" | "operation" | "execution" | "artifact" | "receipt" | "report";

export function productionIdentityTarget(kind: ProductionIdentityKind, identity: string): string {
  return `product-production-${kind}-${identity}`;
}

export function ProductionIdentityLink({
  kind,
  identity,
  children,
}: {
  kind: ProductionIdentityKind;
  identity: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={`#${productionIdentityTarget(kind, identity)}`}
      data-production-navigation={kind}
      data-production-target-id={identity}
    >
      {children ?? identity}
    </a>
  );
}

export function ProductionArtifactReference({
  identity,
  renderedArtifactIds,
}: {
  identity: string;
  renderedArtifactIds: ReadonlySet<string>;
}) {
  return renderedArtifactIds.has(identity)
    ? <ProductionIdentityLink kind="artifact" identity={identity} />
    : <>{identity}</>;
}

export function ProductionArtifactList({
  identities,
  renderedArtifactIds,
  empty,
}: {
  identities: readonly string[];
  renderedArtifactIds: ReadonlySet<string>;
  empty: string;
}) {
  if (identities.length === 0) return <>{empty}</>;
  return identities.map((identity, index) => (
    <span key={identity}>
      {index > 0 ? ", " : null}
      <ProductionArtifactReference identity={identity} renderedArtifactIds={renderedArtifactIds} />
    </span>
  ));
}

export function ProductionScopeSummary({
  scopes,
  renderedArtifactIds,
}: {
  scopes: ProductionStudioGrantView["mediaScope"];
  renderedArtifactIds: ReadonlySet<string>;
}) {
  if (scopes.length === 0) return <>No media scope granted</>;
  return scopes.map((scope, index) => (
    <span key={`${scope.artifactId}:${scope.trackId}:${scope.startMs}:${scope.endMs}`}>
      {index > 0 ? "; " : null}
      <ProductionArtifactReference identity={scope.artifactId} renderedArtifactIds={renderedArtifactIds} />
      {` · ${scope.trackId} [${scope.startMs}, ${scope.endMs}) ms`}
    </span>
  ));
}

export function ProductionEvidenceScopeSummary({
  scopes,
  renderedArtifactIds,
}: {
  scopes: ProductionStudioGrantView["evidenceScope"];
  renderedArtifactIds: ReadonlySet<string>;
}) {
  if (scopes.length === 0) return <>No evidence scope granted</>;
  return scopes.map((scope, index) => (
    <span key={`${scope.artifactId}:${scope.evidenceKind}`}>
      {index > 0 ? "; " : null}
      <ProductionArtifactReference identity={scope.artifactId} renderedArtifactIds={renderedArtifactIds} />
      {` · ${scope.evidenceKind} · ${scope.maxItems} items / ${scope.maxBytes} bytes`}
    </span>
  ));
}

export function ProductionAssessmentScopeSummary({
  scope,
  renderedArtifactIds,
}: {
  scope: ProductionStudioGrantView["assessmentScope"];
  renderedArtifactIds: ReadonlySet<string>;
}) {
  if (!scope) return <>No assessment scope granted</>;
  return (
    <>
      <ProductionArtifactList
        identities={scope.evidenceArtifactIds}
        renderedArtifactIds={renderedArtifactIds}
        empty="No evidence artifacts"
      />
      {` · ${scope.maxAssessments} assessment / ${scope.maxReadReceipts} read receipts / ${scope.maxClaims} claims / ${scope.maxCitations} cited indexes / ${scope.maxTokens} structured tokens`}
    </>
  );
}

export function ProductionDecisionScopeSummary({
  scope,
}: {
  scope: ProductionStudioGrantView["decisionScope"];
}) {
  if (!scope) return <>No decision scope granted</>;
  return <>{scope.maxDecisions} decision / {scope.maxAuditedAssessments} audited assessments</>;
}
