// Captured verbatim from a live local runtime host.
// 2026-07-18: source-sessions, events, audits, review, caption 409, language empty, error.
// 2026-07-19: runtime plan, start ack, and terminal status (deterministic executor, run-005,
// fresh --runtime-root). Values are real receipts, not fabricated placeholders. The drift
// test re-parses each capture and checks its schema tag against the documented surface.

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

export const RUNTIME_PLAN_200 = `{
    "schema": "studio.local-runtime-plan.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "sourceSessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
    "sourceRevisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
    "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
    "forecast": {
        "schema": "studio.forecast.v1",
        "forecastId": "forecast:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "content": {
            "algorithm": "sha256",
            "digest": "93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
            "contentId": "sha256:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
            "bytes": 3413
        },
        "estimator": {
            "id": "studio.forecast.deterministic-floor",
            "version": "1"
        },
        "inputs": {
            "artifact": {
                "artifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                "measuredDurationMs": 47200,
                "durationMeasurement": {
                    "schema": "studio.media-probe.v1",
                    "producer": "scripts/probe-media.mjs",
                    "receiptContentId": "sha256:def1dcaeeabe4dbc24247279638d1ce666fdc397de3dfa557a924dd12cb8b0c2"
                }
            },
            "selectedRange": {
                "startMs": 0,
                "endMs": 47200,
                "durationMs": 47200
            },
            "workPlan": {
                "schema": "studio.forecast.work-plan.v1",
                "planId": "plan:bounded-media-seek:e7b3dbb7a086245f6d2b55bb00cd54d57bb6f72e1bca09ded7d4543b4c7b2a8a",
                "operations": [
                    {
                        "operationId": "operation:bounded-media-seek:3ea64c5620ca47571a78068ada97d5179c7fddf5e3282731089d400d412b60d6",
                        "kind": "media.seek",
                        "range": {
                            "startMs": 0,
                            "endMs": 47200
                        }
                    }
                ]
            }
        },
        "scenarios": {
            "baseline": {
                "label": "baseline",
                "status": "floor_only",
                "workload": {
                    "selectedMediaDurationMs": 47200,
                    "operationCount": 1,
                    "requestedOperationMediaDurationMs": 47200,
                    "operations": [
                        {
                            "operationId": "operation:bounded-media-seek:3ea64c5620ca47571a78068ada97d5179c7fddf5e3282731089d400d412b60d6",
                            "kind": "media.seek",
                            "requestedMediaDurationMs": 47200
                        }
                    ]
                },
                "elapsedDurationMs": null,
                "modelUsage": null,
                "apiCost": {
                    "amount": null,
                    "currency": null
                }
            },
            "expected": {
                "label": "expected",
                "status": "unavailable",
                "workload": null,
                "elapsedDurationMs": null,
                "modelUsage": null,
                "apiCost": {
                    "amount": null,
                    "currency": null
                }
            },
            "conservative": {
                "label": "conservative",
                "status": "unavailable",
                "workload": null,
                "elapsedDurationMs": null,
                "modelUsage": null,
                "apiCost": {
                    "amount": null,
                    "currency": null
                }
            }
        },
        "assumptions": [
            {
                "code": "measured_duration_envelope",
                "statement": "The selected range is bounded by the duration declared by the referenced studio.media-probe.v1 receipt."
            },
            {
                "code": "explicit_operation_ranges_only",
                "statement": "The floor sums each requested operation range once; retries, spawned work, and undeclared operations are excluded."
            },
            {
                "code": "workload_not_elapsed_time",
                "statement": "Requested media milliseconds are workload volume, not wall time, active execution time, usage, or billing."
            }
        ],
        "uncertainty": [
            {
                "code": "dynamic_work_unavailable",
                "affects": [
                    "scenarios.baseline.workload"
                ],
                "statement": "No producer establishes retries, child work, or reprocessing before the run."
            },
            {
                "code": "historical_calibration_unavailable",
                "affects": [
                    "scenarios.expected",
                    "scenarios.conservative"
                ],
                "statement": "No compatible historical calibration producer exists."
            },
            {
                "code": "elapsed_time_unavailable",
                "affects": [
                    "scenarios.baseline.elapsedDurationMs",
                    "scenarios.expected.elapsedDurationMs",
                    "scenarios.conservative.elapsedDurationMs"
                ],
                "statement": "Media duration and operation scopes do not establish concurrency or processing speed."
            },
            {
                "code": "model_usage_unavailable",
                "affects": [
                    "scenarios.baseline.modelUsage",
                    "scenarios.expected.modelUsage",
                    "scenarios.conservative.modelUsage"
                ],
                "statement": "No compatible pre-run model-usage estimator or calibrated history exists."
            },
            {
                "code": "pricing_unavailable",
                "affects": [
                    "scenarios.baseline.apiCost",
                    "scenarios.expected.apiCost",
                    "scenarios.conservative.apiCost"
                ],
                "statement": "No versioned price-book adapter or pricing snapshot exists."
            }
        ],
        "calibration": {
            "status": "unavailable",
            "evidence": null,
            "cohort": null
        },
        "pricing": {
            "status": "unavailable",
            "priceBookAdapter": null,
            "priceBookSnapshot": null,
            "currency": null
        }
    },
    "acceptance": {
        "status": "not_started",
        "frozenForecastId": null
    }
}`;

export const RUNTIME_START_ACK_202 = `{
    "schema": "studio.local-runtime-start-ack.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalId": "journal:runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "lifecycle": "initializing",
    "acceptedAt": "2026-07-19T16:14:06.771Z",
    "lastTransitionAt": "2026-07-19T16:14:06.798Z",
    "reason": null,
    "sourceSessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
    "sourceRevisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
    "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
    "forecast": {
        "forecastId": "forecast:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "contentId": "sha256:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "frozenForecastId": "forecast-freeze:ddc139aa2b7e61a7f32e0ea42a074655625a5475eef585cb44bbdf07491fe0bb",
        "baselineStatus": "floor_only"
    },
    "runStartReceipt": {
        "contentId": "sha256:bac814e3fa3f50c5cbc4c40cd3fe0c38896542a468cd4a2c9afedf79eb1efc2a",
        "record": {
            "schema": "studio.runtime-start.v1",
            "producer": {
                "id": "studio.local-runtime-start",
                "version": "1"
            },
            "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
            "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
            "journalId": "journal:runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
            "sourceSession": {
                "schema": "studio.source-session.v1",
                "sessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
                "revisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
                "adapterId": "owned-local-source-adapter.v1",
                "sourceReceipt": {
                    "schema": "studio.ingest.owned-local.v1",
                    "receiptId": "owned-local:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                    "contentId": "sha256:ced8e654d0bba45d118d73276d76c12d4fb45dae17a25a8a0cf9fb843dc96735",
                    "rightsScope": "redistribution"
                },
                "source": {
                    "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                    "bytes": 329662,
                    "durationMs": 47200
                },
                "mediaProbe": {
                    "schema": "studio.media-probe.v1",
                    "producer": "scripts/probe-media.mjs",
                    "contentId": "sha256:def1dcaeeabe4dbc24247279638d1ce666fdc397de3dfa557a924dd12cb8b0c2"
                },
                "preflight": {
                    "schema": "studio.preflight-bundle.v3",
                    "preflightId": "preflight:sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e:speech-v1:language-v1",
                    "contentId": "sha256:0aa3f0023a4ce1500195e5051004644a63ee2060f5e92ebf8ee8f61afb7eb5aa"
                },
                "detectedLanguageEvidenceContentIds": [
                    "sha256:a61f2157005daa7cb51419c01229993f5397fbbc48845e6668fdd37cbb24924d"
                ]
            },
            "sourceArtifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
            "analysisRequest": {
                "schema": "studio.analysis-request.v1",
                "requestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
                "sourceSessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
                "sourceRevisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
                "sourceContentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                "range": {
                    "startMs": 0,
                    "endMs": 47200
                },
                "language": {
                    "languagePair": {
                        "requestedSource": {
                            "mode": "declared",
                            "languages": [
                                "ko"
                            ],
                            "reason": null
                        },
                        "targetLanguage": "en"
                    },
                    "selectedLanguagePackId": "ko-v3",
                    "detectedLanguageEvidenceContentIds": [
                        "sha256:a61f2157005daa7cb51419c01229993f5397fbbc48845e6668fdd37cbb24924d"
                    ]
                },
                "outputDepth": "evidence",
                "options": {
                    "speechScope": "foreground",
                    "includeLyrics": false,
                    "speaker": null,
                    "honorifics": "preserve",
                    "translationStyle": "natural",
                    "captionDensity": "balanced",
                    "slowAnalysis": false
                }
            },
            "workPlan": {
                "schema": "studio.forecast.work-plan.v1",
                "planId": "plan:bounded-media-seek:e7b3dbb7a086245f6d2b55bb00cd54d57bb6f72e1bca09ded7d4543b4c7b2a8a",
                "operations": [
                    {
                        "operationId": "operation:bounded-media-seek:3ea64c5620ca47571a78068ada97d5179c7fddf5e3282731089d400d412b60d6",
                        "kind": "media.seek",
                        "range": {
                            "startMs": 0,
                            "endMs": 47200
                        }
                    }
                ]
            },
            "forecast": {
                "schema": "studio.forecast.v1",
                "forecastId": "forecast:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
                "content": {
                    "algorithm": "sha256",
                    "digest": "93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
                    "contentId": "sha256:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
                    "bytes": 3413
                },
                "estimator": {
                    "id": "studio.forecast.deterministic-floor",
                    "version": "1"
                },
                "inputs": {
                    "artifact": {
                        "artifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                        "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                        "measuredDurationMs": 47200,
                        "durationMeasurement": {
                            "schema": "studio.media-probe.v1",
                            "producer": "scripts/probe-media.mjs",
                            "receiptContentId": "sha256:def1dcaeeabe4dbc24247279638d1ce666fdc397de3dfa557a924dd12cb8b0c2"
                        }
                    },
                    "selectedRange": {
                        "startMs": 0,
                        "endMs": 47200,
                        "durationMs": 47200
                    },
                    "workPlan": {
                        "schema": "studio.forecast.work-plan.v1",
                        "planId": "plan:bounded-media-seek:e7b3dbb7a086245f6d2b55bb00cd54d57bb6f72e1bca09ded7d4543b4c7b2a8a",
                        "operations": [
                            {
                                "operationId": "operation:bounded-media-seek:3ea64c5620ca47571a78068ada97d5179c7fddf5e3282731089d400d412b60d6",
                                "kind": "media.seek",
                                "range": {
                                    "startMs": 0,
                                    "endMs": 47200
                                }
                            }
                        ]
                    }
                },
                "scenarios": {
                    "baseline": {
                        "label": "baseline",
                        "status": "floor_only",
                        "workload": {
                            "selectedMediaDurationMs": 47200,
                            "operationCount": 1,
                            "requestedOperationMediaDurationMs": 47200,
                            "operations": [
                                {
                                    "operationId": "operation:bounded-media-seek:3ea64c5620ca47571a78068ada97d5179c7fddf5e3282731089d400d412b60d6",
                                    "kind": "media.seek",
                                    "requestedMediaDurationMs": 47200
                                }
                            ]
                        },
                        "elapsedDurationMs": null,
                        "modelUsage": null,
                        "apiCost": {
                            "amount": null,
                            "currency": null
                        }
                    },
                    "expected": {
                        "label": "expected",
                        "status": "unavailable",
                        "workload": null,
                        "elapsedDurationMs": null,
                        "modelUsage": null,
                        "apiCost": {
                            "amount": null,
                            "currency": null
                        }
                    },
                    "conservative": {
                        "label": "conservative",
                        "status": "unavailable",
                        "workload": null,
                        "elapsedDurationMs": null,
                        "modelUsage": null,
                        "apiCost": {
                            "amount": null,
                            "currency": null
                        }
                    }
                },
                "assumptions": [
                    {
                        "code": "measured_duration_envelope",
                        "statement": "The selected range is bounded by the duration declared by the referenced studio.media-probe.v1 receipt."
                    },
                    {
                        "code": "explicit_operation_ranges_only",
                        "statement": "The floor sums each requested operation range once; retries, spawned work, and undeclared operations are excluded."
                    },
                    {
                        "code": "workload_not_elapsed_time",
                        "statement": "Requested media milliseconds are workload volume, not wall time, active execution time, usage, or billing."
                    }
                ],
                "uncertainty": [
                    {
                        "code": "dynamic_work_unavailable",
                        "affects": [
                            "scenarios.baseline.workload"
                        ],
                        "statement": "No producer establishes retries, child work, or reprocessing before the run."
                    },
                    {
                        "code": "historical_calibration_unavailable",
                        "affects": [
                            "scenarios.expected",
                            "scenarios.conservative"
                        ],
                        "statement": "No compatible historical calibration producer exists."
                    },
                    {
                        "code": "elapsed_time_unavailable",
                        "affects": [
                            "scenarios.baseline.elapsedDurationMs",
                            "scenarios.expected.elapsedDurationMs",
                            "scenarios.conservative.elapsedDurationMs"
                        ],
                        "statement": "Media duration and operation scopes do not establish concurrency or processing speed."
                    },
                    {
                        "code": "model_usage_unavailable",
                        "affects": [
                            "scenarios.baseline.modelUsage",
                            "scenarios.expected.modelUsage",
                            "scenarios.conservative.modelUsage"
                        ],
                        "statement": "No compatible pre-run model-usage estimator or calibrated history exists."
                    },
                    {
                        "code": "pricing_unavailable",
                        "affects": [
                            "scenarios.baseline.apiCost",
                            "scenarios.expected.apiCost",
                            "scenarios.conservative.apiCost"
                        ],
                        "statement": "No versioned price-book adapter or pricing snapshot exists."
                    }
                ],
                "calibration": {
                    "status": "unavailable",
                    "evidence": null,
                    "cohort": null
                },
                "pricing": {
                    "status": "unavailable",
                    "priceBookAdapter": null,
                    "priceBookSnapshot": null,
                    "currency": null
                }
            },
            "frozenForecast": {
                "schema": "studio.forecast-freeze.v1",
                "freezeId": "forecast-freeze:ddc139aa2b7e61a7f32e0ea42a074655625a5475eef585cb44bbdf07491fe0bb",
                "content": {
                    "algorithm": "sha256",
                    "digest": "ddc139aa2b7e61a7f32e0ea42a074655625a5475eef585cb44bbdf07491fe0bb",
                    "contentId": "sha256:ddc139aa2b7e61a7f32e0ea42a074655625a5475eef585cb44bbdf07491fe0bb",
                    "bytes": 580
                },
                "producer": {
                    "id": "studio.forecast.freeze",
                    "version": "1"
                },
                "forecast": {
                    "schema": "studio.forecast.v1",
                    "forecastId": "forecast:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
                    "contentId": "sha256:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09"
                },
                "acceptance": {
                    "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
                    "acceptedBy": "operator:local-runtime-host",
                    "runStartAt": "2026-07-19T16:14:06.771Z"
                },
                "immutability": {
                    "forecast": "referenced_by_content_id",
                    "actuals": "not_embedded",
                    "evaluation": "separate_artifact"
                }
            },
            "startedAt": "2026-07-19T16:14:06.771Z"
        }
    },
    "journalHead": 0,
    "terminal": false
}`;

export const RUNTIME_STATUS_200 = `{
    "schema": "studio.local-runtime-status.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalId": "journal:runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "lifecycle": "terminal",
    "acceptedAt": "2026-07-19T16:14:06.771Z",
    "lastTransitionAt": "2026-07-19T16:14:07.276Z",
    "reason": null,
    "sourceSessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
    "sourceRevisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
    "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
    "forecast": {
        "forecastId": "forecast:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "contentId": "sha256:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "frozenForecastId": "forecast-freeze:ddc139aa2b7e61a7f32e0ea42a074655625a5475eef585cb44bbdf07491fe0bb",
        "baselineStatus": "floor_only"
    },
    "runStartReceipt": {
        "contentId": "sha256:bac814e3fa3f50c5cbc4c40cd3fe0c38896542a468cd4a2c9afedf79eb1efc2a",
        "record": {
            "schema": "studio.runtime-start.v1",
            "producer": {
                "id": "studio.local-runtime-start",
                "version": "1"
            },
            "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
            "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
            "journalId": "journal:runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
            "sourceSession": {
                "schema": "studio.source-session.v1",
                "sessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
                "revisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
                "adapterId": "owned-local-source-adapter.v1",
                "sourceReceipt": {
                    "schema": "studio.ingest.owned-local.v1",
                    "receiptId": "owned-local:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                    "contentId": "sha256:ced8e654d0bba45d118d73276d76c12d4fb45dae17a25a8a0cf9fb843dc96735",
                    "rightsScope": "redistribution"
                },
                "source": {
                    "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                    "bytes": 329662,
                    "durationMs": 47200
                },
                "mediaProbe": {
                    "schema": "studio.media-probe.v1",
                    "producer": "scripts/probe-media.mjs",
                    "contentId": "sha256:def1dcaeeabe4dbc24247279638d1ce666fdc397de3dfa557a924dd12cb8b0c2"
                },
                "preflight": {
                    "schema": "studio.preflight-bundle.v3",
                    "preflightId": "preflight:sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e:speech-v1:language-v1",
                    "contentId": "sha256:0aa3f0023a4ce1500195e5051004644a63ee2060f5e92ebf8ee8f61afb7eb5aa"
                },
                "detectedLanguageEvidenceContentIds": [
                    "sha256:a61f2157005daa7cb51419c01229993f5397fbbc48845e6668fdd37cbb24924d"
                ]
            },
            "sourceArtifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
            "analysisRequest": {
                "schema": "studio.analysis-request.v1",
                "requestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
                "sourceSessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
                "sourceRevisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
                "sourceContentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                "range": {
                    "startMs": 0,
                    "endMs": 47200
                },
                "language": {
                    "languagePair": {
                        "requestedSource": {
                            "mode": "declared",
                            "languages": [
                                "ko"
                            ],
                            "reason": null
                        },
                        "targetLanguage": "en"
                    },
                    "selectedLanguagePackId": "ko-v3",
                    "detectedLanguageEvidenceContentIds": [
                        "sha256:a61f2157005daa7cb51419c01229993f5397fbbc48845e6668fdd37cbb24924d"
                    ]
                },
                "outputDepth": "evidence",
                "options": {
                    "speechScope": "foreground",
                    "includeLyrics": false,
                    "speaker": null,
                    "honorifics": "preserve",
                    "translationStyle": "natural",
                    "captionDensity": "balanced",
                    "slowAnalysis": false
                }
            },
            "workPlan": {
                "schema": "studio.forecast.work-plan.v1",
                "planId": "plan:bounded-media-seek:e7b3dbb7a086245f6d2b55bb00cd54d57bb6f72e1bca09ded7d4543b4c7b2a8a",
                "operations": [
                    {
                        "operationId": "operation:bounded-media-seek:3ea64c5620ca47571a78068ada97d5179c7fddf5e3282731089d400d412b60d6",
                        "kind": "media.seek",
                        "range": {
                            "startMs": 0,
                            "endMs": 47200
                        }
                    }
                ]
            },
            "forecast": {
                "schema": "studio.forecast.v1",
                "forecastId": "forecast:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
                "content": {
                    "algorithm": "sha256",
                    "digest": "93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
                    "contentId": "sha256:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
                    "bytes": 3413
                },
                "estimator": {
                    "id": "studio.forecast.deterministic-floor",
                    "version": "1"
                },
                "inputs": {
                    "artifact": {
                        "artifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                        "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                        "measuredDurationMs": 47200,
                        "durationMeasurement": {
                            "schema": "studio.media-probe.v1",
                            "producer": "scripts/probe-media.mjs",
                            "receiptContentId": "sha256:def1dcaeeabe4dbc24247279638d1ce666fdc397de3dfa557a924dd12cb8b0c2"
                        }
                    },
                    "selectedRange": {
                        "startMs": 0,
                        "endMs": 47200,
                        "durationMs": 47200
                    },
                    "workPlan": {
                        "schema": "studio.forecast.work-plan.v1",
                        "planId": "plan:bounded-media-seek:e7b3dbb7a086245f6d2b55bb00cd54d57bb6f72e1bca09ded7d4543b4c7b2a8a",
                        "operations": [
                            {
                                "operationId": "operation:bounded-media-seek:3ea64c5620ca47571a78068ada97d5179c7fddf5e3282731089d400d412b60d6",
                                "kind": "media.seek",
                                "range": {
                                    "startMs": 0,
                                    "endMs": 47200
                                }
                            }
                        ]
                    }
                },
                "scenarios": {
                    "baseline": {
                        "label": "baseline",
                        "status": "floor_only",
                        "workload": {
                            "selectedMediaDurationMs": 47200,
                            "operationCount": 1,
                            "requestedOperationMediaDurationMs": 47200,
                            "operations": [
                                {
                                    "operationId": "operation:bounded-media-seek:3ea64c5620ca47571a78068ada97d5179c7fddf5e3282731089d400d412b60d6",
                                    "kind": "media.seek",
                                    "requestedMediaDurationMs": 47200
                                }
                            ]
                        },
                        "elapsedDurationMs": null,
                        "modelUsage": null,
                        "apiCost": {
                            "amount": null,
                            "currency": null
                        }
                    },
                    "expected": {
                        "label": "expected",
                        "status": "unavailable",
                        "workload": null,
                        "elapsedDurationMs": null,
                        "modelUsage": null,
                        "apiCost": {
                            "amount": null,
                            "currency": null
                        }
                    },
                    "conservative": {
                        "label": "conservative",
                        "status": "unavailable",
                        "workload": null,
                        "elapsedDurationMs": null,
                        "modelUsage": null,
                        "apiCost": {
                            "amount": null,
                            "currency": null
                        }
                    }
                },
                "assumptions": [
                    {
                        "code": "measured_duration_envelope",
                        "statement": "The selected range is bounded by the duration declared by the referenced studio.media-probe.v1 receipt."
                    },
                    {
                        "code": "explicit_operation_ranges_only",
                        "statement": "The floor sums each requested operation range once; retries, spawned work, and undeclared operations are excluded."
                    },
                    {
                        "code": "workload_not_elapsed_time",
                        "statement": "Requested media milliseconds are workload volume, not wall time, active execution time, usage, or billing."
                    }
                ],
                "uncertainty": [
                    {
                        "code": "dynamic_work_unavailable",
                        "affects": [
                            "scenarios.baseline.workload"
                        ],
                        "statement": "No producer establishes retries, child work, or reprocessing before the run."
                    },
                    {
                        "code": "historical_calibration_unavailable",
                        "affects": [
                            "scenarios.expected",
                            "scenarios.conservative"
                        ],
                        "statement": "No compatible historical calibration producer exists."
                    },
                    {
                        "code": "elapsed_time_unavailable",
                        "affects": [
                            "scenarios.baseline.elapsedDurationMs",
                            "scenarios.expected.elapsedDurationMs",
                            "scenarios.conservative.elapsedDurationMs"
                        ],
                        "statement": "Media duration and operation scopes do not establish concurrency or processing speed."
                    },
                    {
                        "code": "model_usage_unavailable",
                        "affects": [
                            "scenarios.baseline.modelUsage",
                            "scenarios.expected.modelUsage",
                            "scenarios.conservative.modelUsage"
                        ],
                        "statement": "No compatible pre-run model-usage estimator or calibrated history exists."
                    },
                    {
                        "code": "pricing_unavailable",
                        "affects": [
                            "scenarios.baseline.apiCost",
                            "scenarios.expected.apiCost",
                            "scenarios.conservative.apiCost"
                        ],
                        "statement": "No versioned price-book adapter or pricing snapshot exists."
                    }
                ],
                "calibration": {
                    "status": "unavailable",
                    "evidence": null,
                    "cohort": null
                },
                "pricing": {
                    "status": "unavailable",
                    "priceBookAdapter": null,
                    "priceBookSnapshot": null,
                    "currency": null
                }
            },
            "frozenForecast": {
                "schema": "studio.forecast-freeze.v1",
                "freezeId": "forecast-freeze:ddc139aa2b7e61a7f32e0ea42a074655625a5475eef585cb44bbdf07491fe0bb",
                "content": {
                    "algorithm": "sha256",
                    "digest": "ddc139aa2b7e61a7f32e0ea42a074655625a5475eef585cb44bbdf07491fe0bb",
                    "contentId": "sha256:ddc139aa2b7e61a7f32e0ea42a074655625a5475eef585cb44bbdf07491fe0bb",
                    "bytes": 580
                },
                "producer": {
                    "id": "studio.forecast.freeze",
                    "version": "1"
                },
                "forecast": {
                    "schema": "studio.forecast.v1",
                    "forecastId": "forecast:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
                    "contentId": "sha256:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09"
                },
                "acceptance": {
                    "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
                    "acceptedBy": "operator:local-runtime-host",
                    "runStartAt": "2026-07-19T16:14:06.771Z"
                },
                "immutability": {
                    "forecast": "referenced_by_content_id",
                    "actuals": "not_embedded",
                    "evaluation": "separate_artifact"
                }
            },
            "startedAt": "2026-07-19T16:14:06.771Z"
        }
    },
    "journalHead": 67,
    "terminal": true
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
