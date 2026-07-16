import type {
  RuntimeHostAssessmentAuditResponse,
  RuntimeHostDecisionReceiptResponse,
} from "../../runtime/production/runtimeHost/model.ts";
import {
  contentId,
  exact,
  fail,
  identity,
  integer,
  object,
  string,
} from "./responseGuards.ts";

export function assessmentAuditResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostAssessmentAuditResponse {
  const context = "Runtime host assessment audit";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "audits"], context);
  if (item.schema !== "studio.local-runtime-assessment-audits.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.audits)) fail(`${context}.audits`, "must be an array.");
  const operationIds = new Set<string>();
  const audits = item.audits.map((candidate, auditIndex) => {
    const auditContext = `${context}.audits[${auditIndex}]`;
    const audit = object(candidate, auditContext);
    exact(audit, [
      "operationId",
      "artifactId",
      "receiptId",
      "receiptContentId",
      "taskId",
      "agentId",
      "integrity",
      "claims",
    ], auditContext);
    const operationId = identity(audit.operationId, `${auditContext}.operationId`);
    if (operationIds.has(operationId)) fail(`${auditContext}.operationId`, "is duplicated.");
    operationIds.add(operationId);
    if (audit.integrity !== "stored_receipt_and_citations_verified") {
      fail(`${auditContext}.integrity`, "does not carry the closed audit result.");
    }
    if (!Array.isArray(audit.claims) || audit.claims.length === 0) {
      fail(`${auditContext}.claims`, "must contain audited claims.");
    }
    const claims = audit.claims.map((claimValue, claimIndex) => {
      const claimContext = `${auditContext}.claims[${claimIndex}]`;
      const claim = object(claimValue, claimContext);
      exact(claim, ["claimIndex", "kind", "value", "range", "states", "citations"], claimContext);
      if (integer(claim.claimIndex, `${claimContext}.claimIndex`) !== claimIndex) {
        fail(`${claimContext}.claimIndex`, "must match claim order.");
      }
      if (claim.kind !== "speech_activity" && claim.kind !== "language_identity") {
        fail(`${claimContext}.kind`, "is unsupported.");
      }
      if (claim.kind === "speech_activity") {
        if (claim.value !== "speech" && claim.value !== "non_speech") {
          fail(`${claimContext}.value`, "is not a closed speech-activity value.");
        }
      } else if (claim.value !== null) {
        string(claim.value, `${claimContext}.value`);
      }
      const range = object(claim.range, `${claimContext}.range`);
      exact(range, ["startMs", "endMs"], `${claimContext}.range`);
      const startMs = integer(range.startMs, `${claimContext}.range.startMs`);
      const endMs = integer(range.endMs, `${claimContext}.range.endMs`, 1);
      if (endMs <= startMs) fail(`${claimContext}.range`, "must be a non-empty half-open range.");
      if (!Array.isArray(claim.states) || claim.states.length === 0) {
        fail(`${claimContext}.states`, "must preserve at least one state.");
      }
      const states = claim.states.map((state, stateIndex) => {
        if (!["supported", "unknown", "withheld", "truncated"].includes(state as string)) {
          fail(`${claimContext}.states[${stateIndex}]`, "is unsupported.");
        }
        return state as "supported" | "unknown" | "withheld" | "truncated";
      });
      if (new Set(states).size !== states.length || (states.includes("supported") && states.length !== 1)) {
        fail(`${claimContext}.states`, "must be unique and cannot combine supported with a gap state.");
      }
      if (!Array.isArray(claim.citations) || claim.citations.length === 0) {
        fail(`${claimContext}.citations`, "must contain closed read-receipt citations.");
      }
      const citationKeys = new Set<string>();
      const citations = claim.citations.map((citationValue, citationIndex) => {
        const citationContext = `${claimContext}.citations[${citationIndex}]`;
        const citation = object(citationValue, citationContext);
        exact(citation, [
          "readOperationId",
          "receiptId",
          "receiptContentId",
          "evidenceArtifactId",
          "factIndexes",
        ], citationContext);
        const receiptId = identity(citation.receiptId, `${citationContext}.receiptId`);
        const receiptContentId = contentId(citation.receiptContentId, `${citationContext}.receiptContentId`);
        const citationKey = `${receiptId}\u0000${receiptContentId}`;
        if (citationKeys.has(citationKey)) fail(citationContext, "duplicates a read-receipt citation.");
        citationKeys.add(citationKey);
        if (!Array.isArray(citation.factIndexes) || citation.factIndexes.length === 0) {
          fail(`${citationContext}.factIndexes`, "must contain returned-fact indexes.");
        }
        const factIndexes = citation.factIndexes.map((factIndex, index) =>
          integer(factIndex, `${citationContext}.factIndexes[${index}]`));
        if (new Set(factIndexes).size !== factIndexes.length) {
          fail(`${citationContext}.factIndexes`, "must not repeat an index.");
        }
        return {
          readOperationId: identity(citation.readOperationId, `${citationContext}.readOperationId`),
          receiptId,
          receiptContentId,
          evidenceArtifactId: identity(citation.evidenceArtifactId, `${citationContext}.evidenceArtifactId`),
          factIndexes,
        };
      });
      return {
        claimIndex,
        kind: claim.kind as "speech_activity" | "language_identity",
        value: claim.value as "speech" | "non_speech" | string | null,
        range: { startMs, endMs },
        states,
        citations,
      };
    });
    return {
      operationId,
      artifactId: identity(audit.artifactId, `${auditContext}.artifactId`),
      receiptId: identity(audit.receiptId, `${auditContext}.receiptId`),
      receiptContentId: contentId(audit.receiptContentId, `${auditContext}.receiptContentId`),
      taskId: identity(audit.taskId, `${auditContext}.taskId`),
      agentId: identity(audit.agentId, `${auditContext}.agentId`),
      integrity: "stored_receipt_and_citations_verified" as const,
      claims,
    };
  });
  return {
    schema: "studio.local-runtime-assessment-audits.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    audits,
  };
}

export function decisionReceiptResponse(
  value: unknown,
  expectedRuntimeId: string,
): RuntimeHostDecisionReceiptResponse {
  const context = "Runtime host decision receipts";
  const item = object(value, context);
  exact(item, ["schema", "commandId", "runtimeId", "journalHead", "decisions"], context);
  if (item.schema !== "studio.local-runtime-decision-receipts.v1") fail(context, "schema is unsupported.");
  const runtimeId = identity(item.runtimeId, `${context}.runtimeId`);
  if (runtimeId !== expectedRuntimeId) fail(context, "runtime identity changed.");
  if (!Array.isArray(item.decisions)) fail(`${context}.decisions`, "must be an array.");
  const operationIds = new Set<string>();
  const decisions = item.decisions.map((candidate, decisionIndex) => {
    const decisionContext = `${context}.decisions[${decisionIndex}]`;
    const decision = object(candidate, decisionContext);
    exact(decision, [
      "operationId",
      "artifactId",
      "receiptId",
      "receiptContentId",
      "taskId",
      "agentId",
      "integrity",
      "producer",
      "inputs",
      "outcome",
      "reasonCodes",
      "auditedAssessmentCount",
      "auditedClaimCount",
    ], decisionContext);
    const operationId = identity(decision.operationId, `${decisionContext}.operationId`);
    if (operationIds.has(operationId)) fail(`${decisionContext}.operationId`, "is duplicated.");
    operationIds.add(operationId);
    if (decision.integrity !== "stored_decision_and_audited_inputs_verified") {
      fail(`${decisionContext}.integrity`, "does not carry the closed decision verification result.");
    }
    if (decision.producer !== "deterministic_audit_state_gate_v1") {
      fail(`${decisionContext}.producer`, "is unsupported.");
    }
    if (!Array.isArray(decision.inputs) || decision.inputs.length === 0 || decision.inputs.length > 4) {
      fail(`${decisionContext}.inputs`, "must contain bounded audited assessment identities.");
    }
    const inputOperations = new Set<string>();
    const inputs = decision.inputs.map((candidateInput, inputIndex) => {
      const inputContext = `${decisionContext}.inputs[${inputIndex}]`;
      const input = object(candidateInput, inputContext);
      exact(input, ["operationId", "artifactId", "receiptId", "receiptContentId"], inputContext);
      const inputOperationId = identity(input.operationId, `${inputContext}.operationId`);
      if (inputOperations.has(inputOperationId)) fail(`${inputContext}.operationId`, "is duplicated.");
      inputOperations.add(inputOperationId);
      return {
        operationId: inputOperationId,
        artifactId: identity(input.artifactId, `${inputContext}.artifactId`),
        receiptId: identity(input.receiptId, `${inputContext}.receiptId`),
        receiptContentId: contentId(input.receiptContentId, `${inputContext}.receiptContentId`),
      };
    });
    const outcome = decision.outcome;
    if (outcome !== "withheld" && outcome !== "proceed_to_publish_review") {
      fail(`${decisionContext}.outcome`, "is unsupported.");
    }
    if (!Array.isArray(decision.reasonCodes) || decision.reasonCodes.length === 0) {
      fail(`${decisionContext}.reasonCodes`, "must contain closed reason codes.");
    }
    const reasonOrder = [
      "audited_claim_withheld",
      "audited_claim_unknown",
      "audited_claim_truncated",
      "all_audited_claims_supported",
    ] as const;
    const reasonCodes = decision.reasonCodes.map((reason, reasonIndex) => {
      if (!reasonOrder.includes(reason as (typeof reasonOrder)[number])) {
        fail(`${decisionContext}.reasonCodes[${reasonIndex}]`, "is unsupported.");
      }
      return reason as (typeof reasonOrder)[number];
    });
    if (
      new Set(reasonCodes).size !== reasonCodes.length ||
      JSON.stringify(reasonCodes) !== JSON.stringify(reasonOrder.filter((reason) => reasonCodes.includes(reason))) ||
      (outcome === "proceed_to_publish_review" &&
        (reasonCodes.length !== 1 || reasonCodes[0] !== "all_audited_claims_supported")) ||
      (outcome === "withheld" && reasonCodes.includes("all_audited_claims_supported"))
    ) fail(`${decisionContext}.reasonCodes`, "do not agree with the outcome or canonical order.");
    const auditedAssessmentCount = integer(
      decision.auditedAssessmentCount,
      `${decisionContext}.auditedAssessmentCount`,
      1,
    );
    if (auditedAssessmentCount !== inputs.length) {
      fail(`${decisionContext}.auditedAssessmentCount`, "must equal the input count.");
    }
    return {
      operationId,
      artifactId: identity(decision.artifactId, `${decisionContext}.artifactId`),
      receiptId: identity(decision.receiptId, `${decisionContext}.receiptId`),
      receiptContentId: contentId(decision.receiptContentId, `${decisionContext}.receiptContentId`),
      taskId: identity(decision.taskId, `${decisionContext}.taskId`),
      agentId: identity(decision.agentId, `${decisionContext}.agentId`),
      integrity: "stored_decision_and_audited_inputs_verified" as const,
      producer: "deterministic_audit_state_gate_v1" as const,
      inputs,
      outcome: outcome as "withheld" | "proceed_to_publish_review",
      reasonCodes,
      auditedAssessmentCount,
      auditedClaimCount: integer(decision.auditedClaimCount, `${decisionContext}.auditedClaimCount`, 1),
    };
  });
  return {
    schema: "studio.local-runtime-decision-receipts.v1",
    commandId: identity(item.commandId, `${context}.commandId`),
    runtimeId,
    journalHead: integer(item.journalHead, `${context}.journalHead`),
    decisions,
  };
}
