import { ContentAddressedArtifactStore } from "../artifactStore.ts";
import type { RuntimeLedger } from "../journal.ts";
import type { OwnedMediaStudyRecordV3, StudyReadinessRecordV4 } from "../model.ts";
import type { PendingRuntimeEvent } from "../protocol.ts";
import { BoundedRuntimeScheduler } from "../scheduler.ts";
import { admittedReportsFromProjection } from "./generalizedStudyRuntime.ts";
import { RangePassHost } from "./rangePassHost.ts";
import { RestudiedStudyReadinessHost, type RestudiedReadinessV4Result, type RestudiedReadinessV4Reference } from "./restudiedStudyReadinessHost.ts";
import { RestudiedStudySynthesisHost, type RestudiedStudySynthesisRequest, type RestudiedStudySynthesisResult, type RestudiedStudyV3Reference } from "./restudiedStudySynthesisHost.ts";

export async function inspectRestudiedStudy(
  ledger: RuntimeLedger,
  scheduler: BoundedRuntimeScheduler,
  artifacts: ContentAddressedArtifactStore,
  parentTaskId: string,
) {
  const admitted = admittedReportsFromProjection(ledger, parentTaskId);
  const host = new RestudiedStudySynthesisHost(ledger.state(), artifacts, new RangePassHost(ledger, artifacts, scheduler));
  return { admitted, inspected: await host.inspect(admitted) };
}

export async function recordRestudiedStudy(input: {
  ledger: RuntimeLedger;
  scheduler: BoundedRuntimeScheduler;
  artifacts: ContentAddressedArtifactStore;
  parentTaskId: string;
  request: RestudiedStudySynthesisRequest;
}): Promise<RestudiedStudySynthesisResult> {
  const admitted = admittedReportsFromProjection(input.ledger, input.parentTaskId);
  const host = new RestudiedStudySynthesisHost(input.ledger.state(), input.artifacts, new RangePassHost(input.ledger, input.artifacts, input.scheduler));
  const result = await host.synthesize(admitted, input.request);
  const [storedStudy, storedReceipt] = await Promise.all([
    input.artifacts.storeJson(result.envelope),
    input.artifacts.storeJson(result.executorReceipt),
  ]);
  const artifact = input.artifacts.buildOwnedMediaStudyArtifactV3({
    runId: input.ledger.runId,
    envelope: result.envelope,
    receipt: result.executorReceipt,
    receiptContentId: storedReceipt.content.contentId,
    storedStudy,
  });
  await input.artifacts.record(input.ledger, artifact, result.study.studyId);
  await input.ledger.transact(
    { producer: { kind: "study_synthesis_host", id: "restudied-study-synthesis-host" }, causationId: result.envelope.root.executionId },
    () => ({
      pending: [{ type: "study.restudied_synthesis_completed", data: {
        studyId: result.study.studyId,
        outputArtifactId: artifact.id,
        outputContentId: artifact.content.contentId,
        executorReceiptContentId: storedReceipt.content.contentId,
        executorReceipt: result.executorReceipt,
        projection: {
          reports: structuredClone(result.envelope.reports),
          passes: structuredClone(result.envelope.passes),
          coverage: structuredClone(result.envelope.coverage),
          claims: structuredClone(result.envelope.claims),
          evidenceCitations: structuredClone(result.envelope.evidenceCitations),
        },
      } }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  return result;
}

export function restudiedStudyReference(record: OwnedMediaStudyRecordV3): RestudiedStudyV3Reference {
  return {
    study: {
      studyId: record.id,
      artifactId: record.artifactId,
      contentId: record.contentId,
      bytes: record.bytes,
      schema: "studio.owned-media-study.v3",
    },
    executorReceiptId: record.executorReceiptId,
    executorReceiptContentId: record.executorReceiptContentId,
  };
}

export async function recordRestudiedReadiness(input: {
  ledger: RuntimeLedger;
  artifacts: ContentAddressedArtifactStore;
  study: OwnedMediaStudyRecordV3;
}): Promise<RestudiedReadinessV4Result & { artifactId: string }> {
  const reference = restudiedStudyReference(input.study);
  const result = await new RestudiedStudyReadinessHost(input.ledger, input.artifacts).audit(reference);
  const storedReceipt = await input.artifacts.storeJson(result.receipt);
  const artifact = input.artifacts.buildStudyReadinessArtifactV4({ runId: input.ledger.runId, receipt: result.receipt, storedReceipt });
  await input.artifacts.record(input.ledger, artifact, result.readinessId);
  await input.ledger.transact(
    { producer: { kind: "study_audit_host", id: "restudied-study-readiness-host" }, causationId: input.study.id },
    () => ({
      pending: [{ type: "study.restudied_readiness_audited", data: {
        studyId: input.study.id,
        outputArtifactId: artifact.id,
        receiptContentId: storedReceipt.content.contentId,
        receipt: result.receipt,
        study: structuredClone(reference),
      } }] satisfies PendingRuntimeEvent[],
      result: undefined,
    }),
  );
  return { ...result, artifactId: artifact.id };
}

export function restudiedReadinessReference(record: StudyReadinessRecordV4): RestudiedReadinessV4Reference {
  return {
    readinessId: record.id,
    receiptId: record.receiptId,
    receiptContentId: record.receiptContentId,
    study: structuredClone(record.study),
  };
}

export async function reopenRestudiedReadiness(
  ledger: RuntimeLedger,
  artifacts: ContentAddressedArtifactStore,
  readinessId: string,
): Promise<RestudiedReadinessV4Result> {
  const record = ledger.state().generalizedStudyReadiness[readinessId];
  if (!record || record.schema !== "studio.study-readiness.receipt.v4") throw new Error("Restudied readiness identity is not recorded in this runtime");
  return new RestudiedStudyReadinessHost(ledger, artifacts).reopen(restudiedReadinessReference(record));
}
