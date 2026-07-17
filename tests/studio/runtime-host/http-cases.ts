import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRuntimeHostBindAddress,
  createRuntimeHostHttpServer,
  listenRuntimeHost,
} from "../../../src/studio/runtime/production/runtimeHost/index.ts";
import { cleanup, FIXTURE, hostHarness, waitForLifecycle } from "./harness.ts";

test("HTTP adapter enforces loopback, token, origin, content, shape, and path-redaction boundaries", async () => {
  assert.throws(() => assertRuntimeHostBindAddress("0.0.0.0"), /unsafe-development/);
  assert.doesNotThrow(() => assertRuntimeHostBindAddress("0.0.0.0", true));

  const runtime = await hostHarness();
  const token = "t".repeat(64);
  const origin = "http://127.0.0.1:4321";
  assert.throws(
    () => createRuntimeHostHttpServer({ service: runtime.service, token, allowedOrigins: ["*"] }),
    /Wildcard Studio origins/,
  );
  const server = createRuntimeHostHttpServer({
    service: runtime.service,
    token,
    allowedOrigins: [origin],
    maximumBodyBytes: 2_048,
  });
  try {
    const address = await listenRuntimeHost(server, { port: 0 });
    const base = `http://${address.host}:${address.port}`;
    const authorized = { Authorization: `Bearer ${token}`, Origin: origin };
    const missingToken = await fetch(`${base}/v1/source-sessions`, { headers: { Origin: origin } });
    assert.equal(missingToken.status, 401);
    const badToken = await fetch(`${base}/v1/source-sessions`, { headers: { Authorization: "Bearer bad", Origin: origin } });
    assert.equal(badToken.status, 401);
    const badOrigin = await fetch(`${base}/v1/source-sessions`, { headers: { Authorization: `Bearer ${token}`, Origin: "http://evil.invalid" } });
    assert.equal(badOrigin.status, 403);
    assert.equal(badOrigin.headers.get("access-control-allow-origin"), null);

    const preflight = await fetch(`${base}/v1/source-sessions`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("content-length"), null);
    assert.equal(await preflight.text(), "");
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);

    const listed = await fetch(`${base}/v1/source-sessions`, { headers: authorized });
    assert.equal(listed.status, 200);
    assert.equal(listed.headers.get("access-control-allow-origin"), origin);
    const listedBody = await listed.json() as { sourceSessions: unknown[] };
    assert.equal(listedBody.sourceSessions.length, 1);
    assert.equal(JSON.stringify(listedBody).includes(FIXTURE), false);
    const unknownCommand = await fetch(`${base}/v1/runtime-starts/${encodeURIComponent(`runtime-start:${"f".repeat(64)}`)}`, { headers: authorized });
    assert.equal(unknownCommand.status, 404);

    const unsupported = await fetch(`${base}/v1/runtime-starts`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify(runtime.request),
    });
    assert.equal(unsupported.status, 415);
    const pathField = await fetch(`${base}/v1/runtime-starts`, {
      method: "POST",
      headers: { ...authorized, "Content-Type": "application/json" },
      body: JSON.stringify({ ...runtime.request, journalPath: "/tmp/client.ndjson" }),
    });
    assert.equal(pathField.status, 400);
    assert.equal((await pathField.json() as { error: { code: string } }).error.code, "invalid_start_request");
    const oversized = await fetch(`${base}/v1/runtime-starts`, {
      method: "POST",
      headers: { ...authorized, "Content-Type": "application/json" },
      body: JSON.stringify({ ...runtime.request, padding: "x".repeat(3_000) }),
    });
    assert.equal(oversized.status, 413);

    const planned = await fetch(`${base}/v1/runtime-plans`, {
      method: "POST",
      headers: { ...authorized, "Content-Type": "application/json" },
      body: JSON.stringify(runtime.request),
    });
    assert.equal(planned.status, 200);
    const planBody = await planned.json() as {
      commandId: string;
      runtimeId: string;
      forecast: { content: { contentId: string } };
      acceptance: { status: string; frozenForecastId: null };
    };
    assert.equal(planBody.acceptance.status, "not_started");
    assert.equal(planBody.acceptance.frozenForecastId, null);
    assert.equal((await runtime.store.list()).length, 0);

    const started = await fetch(`${base}/v1/runtime-starts`, {
      method: "POST",
      headers: { ...authorized, "Content-Type": "application/json" },
      body: JSON.stringify(runtime.request),
    });
    assert.equal(started.status, 202);
    const ack = await started.json() as {
      commandId: string;
      runtimeId: string;
      forecast: { contentId: string };
    };
    assert.equal(ack.commandId, planBody.commandId);
    assert.equal(ack.runtimeId, planBody.runtimeId);
    assert.equal(ack.forecast.contentId, planBody.forecast.content.contentId);
    const status = await fetch(`${base}/v1/runtime-starts/${encodeURIComponent(ack.commandId)}`, { headers: authorized });
    assert.equal(status.status, 200);
    const events = await fetch(`${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/events?after=0&limit=2`, { headers: authorized });
    assert.equal(events.status, 200);
    const publicBodies = JSON.stringify([planBody, ack, await status.json(), await events.json()]);
    assert.equal(publicBodies.includes(runtime.directory), false);
    assert.equal(publicBodies.includes(FIXTURE), false);

    const negative = await fetch(`${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/events?after=-1`, { headers: authorized });
    assert.equal(negative.status, 400);
    const unknownField = await fetch(`${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/events?path=/tmp/x`, { headers: authorized });
    assert.equal(unknownField.status, 400);
    const method = await fetch(`${base}/v1/source-sessions`, { method: "POST", headers: authorized });
    assert.equal(method.status, 405);
    await waitForLifecycle(runtime.service, ack.commandId, "terminal");
    const audits = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/assessment-audits`,
      { headers: authorized },
    );
    assert.equal(audits.status, 200);
    const auditBody = await audits.json() as { schema: string; audits: unknown[] };
    assert.equal(auditBody.schema, "studio.local-runtime-assessment-audits.v1");
    assert.equal(auditBody.audits.length, 0);
    assert.equal(JSON.stringify(auditBody).includes(runtime.directory), false);
    assert.equal(JSON.stringify(auditBody).includes(FIXTURE), false);
    const decisions = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/decision-receipts`,
      { headers: authorized },
    );
    assert.equal(decisions.status, 200);
    const decisionBody = await decisions.json() as {
      schema: string;
      decisions: Array<{ integrity: string; outcome: string; producer: string }>;
    };
    assert.equal(decisionBody.schema, "studio.local-runtime-decision-receipts.v1");
    assert.equal(decisionBody.decisions.length, 0);
    assert.equal(JSON.stringify(decisionBody).includes(runtime.directory), false);
    assert.equal(JSON.stringify(decisionBody).includes(FIXTURE), false);
    const intakes = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/publish-review-intakes`,
      { headers: authorized },
    );
    assert.equal(intakes.status, 200);
    const intakeBody = await intakes.json() as {
      schema: string;
      intakes: Array<{
        intakeId: string;
        artifactId: string;
        receiptId: string;
        receiptContentId: string;
        integrity: string;
        outcome: string;
        producer: string;
        reasonCodes: string[];
      }>;
    };
    assert.equal(intakeBody.schema, "studio.local-runtime-publish-review-intakes.v1");
    assert.equal(intakeBody.intakes.length, 1);
    assert.equal(intakeBody.intakes[0].integrity, "stored_intake_and_verified_study_readiness");
    assert.equal(intakeBody.intakes[0].producer, "host_publish_review_intake_v1");
    assert.equal(intakeBody.intakes[0].outcome, "queued");
    assert.deepEqual(intakeBody.intakes[0].reasonCodes, []);
    assert.equal(JSON.stringify(intakeBody).includes(runtime.directory), false);
    assert.equal(JSON.stringify(intakeBody).includes(FIXTURE), false);
    const reviewAuthorityResponse = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/publish-review-decisions`,
      { headers: authorized },
    );
    assert.equal(reviewAuthorityResponse.status, 200);
    const reviewAuthority = await reviewAuthorityResponse.json() as {
      reviewer: { id: string; decisionAttestation: string; revocationAttestation: string };
      reviews: unknown[];
    };
    assert.deepEqual(reviewAuthority.reviews, []);
    const emptyCaptions = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/caption-productions`,
      { headers: authorized },
    );
    assert.equal(emptyCaptions.status, 200);
    assert.deepEqual((await emptyCaptions.json() as { captions: unknown[] }).captions, []);
    const createReview = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/publish-review-decisions`,
      {
        method: "POST",
        headers: { ...authorized, "Content-Type": "application/json" },
        body: JSON.stringify({
          intake: {
            intakeId: intakeBody.intakes[0].intakeId,
            artifactId: intakeBody.intakes[0].artifactId,
            receiptId: intakeBody.intakes[0].receiptId,
            receiptContentId: intakeBody.intakes[0].receiptContentId,
          },
          reviewer: {
            id: reviewAuthority.reviewer.id,
            attestation: reviewAuthority.reviewer.decisionAttestation,
          },
          decision: {
            outcome: "approve_for_caption_production",
            reasonCodes: ["reviewer_attested_caption_production_may_proceed"],
            note: null,
          },
        }),
      },
    );
    assert.equal(createReview.status, 201);
    const reviewBody = await createReview.json() as {
      reviews: Array<{
        reviewId: string;
        artifactId: string;
        receiptId: string;
        receiptContentId: string;
        state: string;
      }>;
    };
    assert.equal(reviewBody.reviews[0].state, "approved_for_caption_production");
    const createCaptions = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/caption-productions`,
      {
        method: "POST",
        headers: { ...authorized, "Content-Type": "application/json" },
        body: JSON.stringify({
          approval: {
            reviewId: reviewBody.reviews[0].reviewId,
            artifactId: reviewBody.reviews[0].artifactId,
            receiptId: reviewBody.reviews[0].receiptId,
            receiptContentId: reviewBody.reviews[0].receiptContentId,
          },
        }),
      },
    );
    assert.equal(createCaptions.status, 409);
    assert.match(
      JSON.stringify(await createCaptions.json()),
      /Recorded caption fixtures cannot consume current-run study authority and are refused for production/,
    );
    assert.deepEqual(
      (await (await fetch(
        `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/caption-productions`,
        { headers: authorized },
      )).json() as { captions: unknown[] }).captions,
      [],
    );
    const revokeReview = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/publish-review-revocations`,
      {
        method: "POST",
        headers: { ...authorized, "Content-Type": "application/json" },
        body: JSON.stringify({
          approval: {
            reviewId: reviewBody.reviews[0].reviewId,
            artifactId: reviewBody.reviews[0].artifactId,
            receiptId: reviewBody.reviews[0].receiptId,
            receiptContentId: reviewBody.reviews[0].receiptContentId,
          },
          reviewer: {
            id: reviewAuthority.reviewer.id,
            attestation: reviewAuthority.reviewer.revocationAttestation,
          },
          revocation: { reasonCodes: ["new_review_required"], note: null },
        }),
      },
    );
    assert.equal(revokeReview.status, 201);
    assert.equal((await revokeReview.json() as { reviews: Array<{ state: string }> }).reviews[0].state, "approval_revoked");
    const retainedCaptions = await fetch(
      `${base}/v1/runtimes/${encodeURIComponent(ack.runtimeId)}/caption-productions`,
      { headers: authorized },
    );
    assert.deepEqual((await retainedCaptions.json() as { captions: unknown[] }).captions, []);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await cleanup(runtime);
  }
});
