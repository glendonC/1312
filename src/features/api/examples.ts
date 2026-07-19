// Captured verbatim from a live local runtime host on 2026-07-18: deterministic
// executor over the recorded run-005 workspace, one real plan/start/poll/review
// cycle. Values are real receipts, not fabricated placeholders. The drift test
// re-parses each capture and checks its schema tag against the documented surface.

export const SOURCE_SESSIONS_200 = `{
    "schema": "studio.local-source-session-list.v1",
    "sourceSessions": [
        {
            "sourceSessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
            "sourceRevisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
            "sourceContentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
            "sourceKind": "owned_local",
            "label": "Project-generated Korean conversation fixture",
            "rightsScope": "redistribution",
            "durationMs": 47200,
            "trackCount": 1,
            "preflightSchema": "studio.preflight-bundle.v3",
            "detectedLanguageEvidenceAvailable": true
        },
        {
            "sourceSessionId": "source-session:993e4ef19cfbba39652cd1ea9486524cfa0febf310f0f1136465028c127ca189",
            "sourceRevisionId": "source-revision:1106abf319a7e241fea77847afeedd51b8b9b2a735ea435cddf3f01387b80605",
            "sourceContentId": "sha256:734d28184ea69374d58b7785c7ecdf226c25405b295534f9db08cd2a56357c29",
            "sourceKind": "owned_local",
            "label": "Browser-owned WAV",
            "rightsScope": "local_processing",
            "durationMs": 1000,
            "trackCount": 1,
            "preflightSchema": "studio.preflight-bundle.v1",
            "detectedLanguageEvidenceAvailable": false
        },
        {
            "sourceSessionId": "source-session:bf08edbaef1621c697c7c7f1a7e77cc0bd1cbee74bcd759f62f7cabefd21832c",
            "sourceRevisionId": "source-revision:eb3379fa9d2730cd3ef6d1db8a9c2beed8f3003bad6446021389b05f0d9baa09",
            "sourceContentId": "sha256:3210f53e4d064c188df8d7ccef6b288a2248b6afa158633f9891bf7c7d510603",
            "sourceKind": "owned_local",
            "label": "Browser-owned WAV",
            "rightsScope": "local_processing",
            "durationMs": 1000,
            "trackCount": 1,
            "preflightSchema": "studio.preflight-bundle.v1",
            "detectedLanguageEvidenceAvailable": false
        }
    ]
}`;

export const RUNTIME_EVENTS_200 = `{
    "schema": "studio.local-runtime-events.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "lifecycle": "terminal",
    "requestedCursor": 0,
    "nextCursor": 2,
    "journalHead": 67,
    "events": [
        {
            "schema": "studio.runtime.event.v1",
            "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
            "seq": 1,
            "eventId": "event:runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a:1",
            "recordedAt": "2026-07-19T00:59:25.662Z",
            "producer": {
                "kind": "artifact_store",
                "id": "content-addressed-artifact-store"
            },
            "causationId": null,
            "correlationId": null,
            "type": "artifact.recorded",
            "data": {
                "artifact": {
                    "schema": "studio.runtime.artifact.v1",
                    "id": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                    "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
                    "kind": "source-media",
                    "mediaClass": "raw",
                    "publication": "public",
                    "content": {
                        "algorithm": "sha256",
                        "digest": "e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                        "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                        "bytes": 329662
                    },
                    "storageKey": "objects/sha256/e1/e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                    "durationMs": 47200,
                    "tracks": [
                        {
                            "id": "stream:0",
                            "index": 0,
                            "kind": "audio",
                            "codec": "aac",
                            "durationMs": 47200
                        }
                    ],
                    "sourceArtifactIds": [],
                    "producerTaskId": null,
                    "producerAgentId": null,
                    "origin": {
                        "kind": "ingest",
                        "adapterId": "owned-local-source-adapter.v1",
                        "sourceReceiptRef": "owned-local:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e"
                    }
                }
            }
        },
        {
            "schema": "studio.runtime.event.v1",
            "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
            "seq": 2,
            "eventId": "event:runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a:2",
            "recordedAt": "2026-07-19T00:59:25.668Z",
            "producer": {
                "kind": "artifact_store",
                "id": "content-addressed-artifact-store"
            },
            "causationId": null,
            "correlationId": null,
            "type": "artifact.recorded",
            "data": {
                "artifact": {
                    "schema": "studio.runtime.artifact.v1",
                    "id": "artifact:153d59ce6d40dae1fbb383c10ebfa53a5a132a59a581d5ced83f404e69a22ee2",
                    "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
                    "kind": "speech-activity-receipt",
                    "mediaClass": "non_media",
                    "publication": "private",
                    "content": {
                        "algorithm": "sha256",
                        "digest": "b9ed72412af50f1ec6996fac1f49c4a651a3f42cc094e6712b1e3b2f6f732730",
                        "contentId": "sha256:b9ed72412af50f1ec6996fac1f49c4a651a3f42cc094e6712b1e3b2f6f732730",
                        "bytes": 157766
                    },
                    "storageKey": "objects/sha256/b9/b9ed72412af50f1ec6996fac1f49c4a651a3f42cc094e6712b1e3b2f6f732730",
                    "durationMs": null,
                    "tracks": [],
                    "sourceArtifactIds": [
                        "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70"
                    ],
                    "producerTaskId": null,
                    "producerAgentId": null,
                    "origin": {
                        "kind": "preflight_evidence",
                        "evidenceKind": "speech_activity",
                        "receiptSchema": "studio.speech-activity.v1",
                        "producerId": "silero-vad",
                        "preflightId": "preflight:sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e:speech-v1:language-v1",
                        "preflightContentId": "sha256:0aa3f0023a4ce1500195e5051004644a63ee2060f5e92ebf8ee8f61afb7eb5aa"
                    }
                }
            }
        }
    ],
    "reachedHead": false,
    "terminal": true,
    "reason": null
}`;

export const ASSESSMENT_AUDITS_200 = `{
    "schema": "studio.local-runtime-assessment-audits.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 67,
    "audits": []
}`;

export const PUBLISH_REVIEW_INTAKES_200 = `{
    "schema": "studio.local-runtime-publish-review-intakes.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 67,
    "intakes": [
        {
            "intakeId": "publish-review-intake:d5de1955c1403139502d5740a8d04b4e8c1e1d9a7437f12c265bef2fbe0425ae",
            "artifactId": "artifact:99cceac7181985f69eeca33b15895fc0e860a0c8615399798eb90173788bf0f8",
            "receiptId": "publish-review-intake-receipt:1c0b759f9f240367ca898422dddbd00836d7e5d0d5c45c2b476832bac453cb35",
            "receiptContentId": "sha256:30d25055c5754fc51bab6fc9a235e15a20cb9fc4553fe2581beecfd03cdf31e0",
            "integrity": "stored_intake_and_verified_study_readiness",
            "producer": "host_publish_review_intake_v1",
            "readiness": {
                "artifactId": "artifact:2c018d17daef6860529aacff365ea51ee239ed7489e9ff81b5e87dca3f67ff92",
                "readinessId": "study-readiness-v4:d28910b3b1aae133d5adf22b8dbc4aac01daa37e9d8eea644d3595158e8b3b0b",
                "receiptContentId": "sha256:38a1710898b22047a5ad3f5c9231ffc5ab96ef3590b28ce7473489e70236ada7",
                "receiptId": "study-readiness-receipt-v4:dcb1ad3531866f70c2b2a3272394232d1056df68dd8dd0cc21073ab24654415d"
            },
            "outcome": "queued",
            "reasonCodes": []
        }
    ]
}`;

export const PUBLISH_REVIEW_DECISION_201 = `{
    "schema": "studio.local-runtime-publish-review-decisions.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 70,
    "reviewer": {
        "id": "reviewer:local-operator",
        "label": "Local review operator",
        "decisionAttestation": "I attest that I am the named reviewer and made this review decision.",
        "revocationAttestation": "I attest that I am the named reviewer and made this revocation decision."
    },
    "reviews": [
        {
            "reviewId": "publish-review:034269a4d347a017e3571f4adfd46d31854c7d2905e42fe414440dd606284489",
            "artifactId": "artifact:36935fe16b283c526d0698a4ea65eee82d8047b2b891ecb9df1020d0a69183f9",
            "receiptId": "publish-review-decision-receipt:b3808b2e9a083769ec640e93d276abb2976d4aaac988be922d0d9d56af920e79",
            "receiptContentId": "sha256:63b79ac0b5991444ca9da036a1324548ad0fc655b0cf057edb094dfb8ec15129",
            "integrity": "stored_review_and_verified_queued_intake",
            "producer": "host_publish_review_v1",
            "intake": {
                "artifactId": "artifact:99cceac7181985f69eeca33b15895fc0e860a0c8615399798eb90173788bf0f8",
                "intakeId": "publish-review-intake:d5de1955c1403139502d5740a8d04b4e8c1e1d9a7437f12c265bef2fbe0425ae",
                "receiptContentId": "sha256:30d25055c5754fc51bab6fc9a235e15a20cb9fc4553fe2581beecfd03cdf31e0",
                "receiptId": "publish-review-intake-receipt:1c0b759f9f240367ca898422dddbd00836d7e5d0d5c45c2b476832bac453cb35"
            },
            "readiness": {
                "artifactId": "artifact:2c018d17daef6860529aacff365ea51ee239ed7489e9ff81b5e87dca3f67ff92",
                "readinessId": "study-readiness-v4:d28910b3b1aae133d5adf22b8dbc4aac01daa37e9d8eea644d3595158e8b3b0b",
                "receiptContentId": "sha256:38a1710898b22047a5ad3f5c9231ffc5ab96ef3590b28ce7473489e70236ada7",
                "receiptId": "study-readiness-receipt-v4:dcb1ad3531866f70c2b2a3272394232d1056df68dd8dd0cc21073ab24654415d"
            },
            "reviewer": {
                "id": "reviewer:local-operator",
                "label": "Local review operator",
                "attestation": "I attest that I am the named reviewer and made this review decision."
            },
            "outcome": "approve_for_caption_production",
            "reasonCodes": [
                "reviewer_attested_caption_production_may_proceed"
            ],
            "note": null,
            "state": "approved_for_caption_production",
            "revocation": null
        }
    ]
}`;

export const CAPTION_PRODUCTION_409 = `{
    "schema": "studio.local-runtime-error.v1",
    "error": {
        "code": "caption_current_run_causality_required",
        "message": "Recorded caption fixtures cannot consume current-run study authority and are refused for production"
    }
}`;

export const LANGUAGE_EXPLANATIONS_200 = `{
    "schema": "studio.local-runtime-language-explanations.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 67,
    "attempts": [],
    "results": []
}`;

export const UNKNOWN_QUERY_400 = `{
    "schema": "studio.local-runtime-error.v1",
    "error": {
        "code": "unknown_query",
        "message": "Query field bogus is not allowed."
    }
}`;
