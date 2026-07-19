// Captured verbatim from a live local runtime host.
// 2026-07-19 AUTHORIZE continuous family (temp --runtime-root, run-005 preload,
// --executor deterministic, --caption-executor deterministic-test
// --allow-deterministic-caption-test-seam, --language-explanation-executor openai
// --allow-real-language-explanation --language-explanation-model gpt-4o-mini,
// OpenAI budget <=$10, 1 language call): source-sessions, plan, start, status,
// events (limit=2 truncated page), honest-empty audits/receipts/review/captions/language,
// publish-review intakes + decision 201, caption 201/results/QC list + QC 409,
// language 201 bound to that caption job, and private-playback grant mint 201 +
// revoke 200 for the SAME grantId.
// Separate families kept as earlier Captured panels (not part of that journal):
// owned-media ingest (temp --owned-ingest-root without --source-directory),
// youtube registered (yt-dlp AUTHORIZE), publish-review revocation 201, and
// default-host caption 409 (recorded executor).
// Shared deterministic runtimeId/commandId across families is not proof of one
// continuous journal; child ids and timestamps are. Values are real receipts.
// The drift test re-parses each JSON capture and checks its schema tag.

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
    "acceptedAt": "2026-07-19T17:39:49.100Z",
    "lastTransitionAt": "2026-07-19T17:39:49.124Z",
    "reason": null,
    "sourceSessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
    "sourceRevisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
    "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
    "forecast": {
        "forecastId": "forecast:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "contentId": "sha256:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "frozenForecastId": "forecast-freeze:ee115de42d15292c1091ab1b4ba3297f809bdd788211ee7460a072c54b3f7d08",
        "baselineStatus": "floor_only"
    },
    "runStartReceipt": {
        "contentId": "sha256:d163a4ca998d18d17a0c0b6cd4ef7c1e3ca7cd4894055c479ade726f9aaa67fa",
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
                "freezeId": "forecast-freeze:ee115de42d15292c1091ab1b4ba3297f809bdd788211ee7460a072c54b3f7d08",
                "content": {
                    "algorithm": "sha256",
                    "digest": "ee115de42d15292c1091ab1b4ba3297f809bdd788211ee7460a072c54b3f7d08",
                    "contentId": "sha256:ee115de42d15292c1091ab1b4ba3297f809bdd788211ee7460a072c54b3f7d08",
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
                    "runStartAt": "2026-07-19T17:39:49.100Z"
                },
                "immutability": {
                    "forecast": "referenced_by_content_id",
                    "actuals": "not_embedded",
                    "evaluation": "separate_artifact"
                }
            },
            "startedAt": "2026-07-19T17:39:49.100Z"
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
    "acceptedAt": "2026-07-19T17:39:49.100Z",
    "lastTransitionAt": "2026-07-19T17:39:49.558Z",
    "reason": null,
    "sourceSessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
    "sourceRevisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
    "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
    "forecast": {
        "forecastId": "forecast:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "contentId": "sha256:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "frozenForecastId": "forecast-freeze:ee115de42d15292c1091ab1b4ba3297f809bdd788211ee7460a072c54b3f7d08",
        "baselineStatus": "floor_only"
    },
    "runStartReceipt": {
        "contentId": "sha256:d163a4ca998d18d17a0c0b6cd4ef7c1e3ca7cd4894055c479ade726f9aaa67fa",
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
                "freezeId": "forecast-freeze:ee115de42d15292c1091ab1b4ba3297f809bdd788211ee7460a072c54b3f7d08",
                "content": {
                    "algorithm": "sha256",
                    "digest": "ee115de42d15292c1091ab1b4ba3297f809bdd788211ee7460a072c54b3f7d08",
                    "contentId": "sha256:ee115de42d15292c1091ab1b4ba3297f809bdd788211ee7460a072c54b3f7d08",
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
                    "runStartAt": "2026-07-19T17:39:49.100Z"
                },
                "immutability": {
                    "forecast": "referenced_by_content_id",
                    "actuals": "not_embedded",
                    "evaluation": "separate_artifact"
                }
            },
            "startedAt": "2026-07-19T17:39:49.100Z"
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
            "recordedAt": "2026-07-19T17:39:49.133Z",
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
            "recordedAt": "2026-07-19T17:39:49.139Z",
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

export const DECISION_RECEIPTS_200 = `{
    "schema": "studio.local-runtime-decision-receipts.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 67,
    "decisions": []
}`;

export const PRIVATE_PLAYBACK_GRANT_201 = `{
    "schema": "studio.private-playback-grant.v1",
    "grantId": "private-playback-grant:2461c035-c98b-4a83-af69-8425e6327cc2",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "source": {
        "sessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
        "revisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
        "artifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
        "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
        "bytes": 329662,
        "durationMs": 47200
    },
    "mimeType": "audio/mp4",
    "timestampOrigin": {
        "kind": "source_media_zero",
        "offsetMs": 0
    },
    "mediaPath": "/v1/private-source-media/private-playback-grant%3A2461c035-c98b-4a83-af69-8425e6327cc2/C8-YHWaCCQbC5Sv99XeK4i8jLDAFUo5wjHATeyJ8i48",
    "issuedAt": "2026-07-19T17:39:56.085Z",
    "expiresAt": "2026-07-19T17:49:56.085Z"
}`;

export const PRIVATE_PLAYBACK_REVOKE_200 = `{
    "schema": "studio.private-playback-grant-revoked.v1",
    "grantId": "private-playback-grant:2461c035-c98b-4a83-af69-8425e6327cc2",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "state": "revoked",
    "revokedAt": "2026-07-19T17:39:56.087Z"
}`;

export const OWNED_MEDIA_INGEST_POST_202 = `{
    "schema": "studio.owned-media-ingest.v1",
    "ingestId": "owned-ingest:2e21dfc3-8a93-4528-b2de-d01652a03d48",
    "status": "queued",
    "updatedAt": "2026-07-19T17:14:11.933Z",
    "source": null,
    "failure": null
}`;

export const OWNED_MEDIA_INGEST_PUT_202 = `{
    "schema": "studio.owned-media-ingest.v1",
    "ingestId": "owned-ingest:2e21dfc3-8a93-4528-b2de-d01652a03d48",
    "status": "queued",
    "updatedAt": "2026-07-19T17:14:12.063Z",
    "source": null,
    "failure": null
}`;

export const OWNED_MEDIA_INGEST_GET_200 = `{
    "schema": "studio.owned-media-ingest.v1",
    "ingestId": "owned-ingest:2e21dfc3-8a93-4528-b2de-d01652a03d48",
    "status": "registered",
    "updatedAt": "2026-07-19T17:14:12.330Z",
    "source": {
        "sourceSessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
        "sourceRevisionId": "source-revision:f6b47a3ecc4da9e2463b2d7afcdf517dcaec4e5bf13953af0849d74a27110f4b",
        "sourceContentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
        "sourceKind": "owned_local",
        "label": "Project-generated Korean conversation fixture",
        "rightsScope": "local_processing",
        "durationMs": 47200,
        "trackCount": 1,
        "preflightSchema": "studio.preflight-bundle.v1",
        "detectedLanguageEvidenceAvailable": false
    },
    "failure": null
}`;

export const PUBLISH_REVIEW_INTAKES_200 = `{
    "schema": "studio.local-runtime-publish-review-intakes.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 67,
    "intakes": [
        {
            "intakeId": "publish-review-intake:d2e6ca337389d34b267c563a523eccede7e26960a50ac140a25cd8ba4ebac588",
            "artifactId": "artifact:af9c320c97bd32daaa8a09cd4bc94b0305efa6891361fc566f63a5a188c9ecda",
            "receiptId": "publish-review-intake-receipt:20cad736985710c6a9beb195a38a602bf57f8ae58bd63033df248d28f5932504",
            "receiptContentId": "sha256:0befb1c0a44ac9726e4bccfb8a8ddaa542806e9f99fe6fb5d23389fca3fd5498",
            "integrity": "stored_intake_and_verified_study_readiness",
            "producer": "host_publish_review_intake_v1",
            "readiness": {
                "artifactId": "artifact:c964be13cb908aa2131abdb9277ab09d8ec81a3434c07f8e7364c6024d2ad734",
                "readinessId": "study-readiness-v4:765321c1bdd126182fd2aa3be49ad556686089771d486c0febb25d0abf6f5261",
                "receiptContentId": "sha256:4915eb74796dabdb3784df4f6ccf06c7cbc24599560ff88f1c9e1673ba16004c",
                "receiptId": "study-readiness-receipt-v4:3e8500b787ea6bb5f1d1acf049ef5486d8ad7e433762c23cfb946eb8d2bccc28"
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
            "reviewId": "publish-review:55cb99708b008092cb1b8e9675468eb869016ad859cefb9397457e98c0d5cf08",
            "artifactId": "artifact:e986d94e686a223f7c269d49d68188b45b8cba746f38f293189fa55803872e54",
            "receiptId": "publish-review-decision-receipt:088b53b0a71ff278d4a5c5d349645f3c7d470f8c61f94151b3aa6ccb8cb8f1ee",
            "receiptContentId": "sha256:85ad2898c419684dd4e49600b5ce8565e4c18bccc6e748e36fcd5e4ffe1205b3",
            "integrity": "stored_review_and_verified_queued_intake",
            "producer": "host_publish_review_v1",
            "intake": {
                "artifactId": "artifact:af9c320c97bd32daaa8a09cd4bc94b0305efa6891361fc566f63a5a188c9ecda",
                "intakeId": "publish-review-intake:d2e6ca337389d34b267c563a523eccede7e26960a50ac140a25cd8ba4ebac588",
                "receiptContentId": "sha256:0befb1c0a44ac9726e4bccfb8a8ddaa542806e9f99fe6fb5d23389fca3fd5498",
                "receiptId": "publish-review-intake-receipt:20cad736985710c6a9beb195a38a602bf57f8ae58bd63033df248d28f5932504"
            },
            "readiness": {
                "artifactId": "artifact:c964be13cb908aa2131abdb9277ab09d8ec81a3434c07f8e7364c6024d2ad734",
                "readinessId": "study-readiness-v4:765321c1bdd126182fd2aa3be49ad556686089771d486c0febb25d0abf6f5261",
                "receiptContentId": "sha256:4915eb74796dabdb3784df4f6ccf06c7cbc24599560ff88f1c9e1673ba16004c",
                "receiptId": "study-readiness-receipt-v4:3e8500b787ea6bb5f1d1acf049ef5486d8ad7e433762c23cfb946eb8d2bccc28"
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

export const PUBLISH_REVIEW_DECISIONS_200 = `{
    "schema": "studio.local-runtime-publish-review-decisions.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 67,
    "reviewer": {
        "id": "reviewer:local-operator",
        "label": "Local review operator",
        "decisionAttestation": "I attest that I am the named reviewer and made this review decision.",
        "revocationAttestation": "I attest that I am the named reviewer and made this revocation decision."
    },
    "reviews": []
}`;

export const PUBLISH_REVIEW_REVOCATION_201 = `{
    "schema": "studio.local-runtime-publish-review-decisions.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 73,
    "reviewer": {
        "id": "reviewer:local-operator",
        "label": "Local review operator",
        "decisionAttestation": "I attest that I am the named reviewer and made this review decision.",
        "revocationAttestation": "I attest that I am the named reviewer and made this revocation decision."
    },
    "reviews": [
        {
            "reviewId": "publish-review:fd270635f13ca8a82f9ab9858ffdf2d5e8e3fabbbfbdff196f589a4aeb992713",
            "artifactId": "artifact:d3f53f5a25444737836e416ca86683594d1f0ea460facda6d52e60c1c3c01eca",
            "receiptId": "publish-review-decision-receipt:436d61ef564f9b2897bb8a08813c619ffa4cd5cf1af905e2040ad42e8186dd1b",
            "receiptContentId": "sha256:fc69cc44bb855d751f372be4af19a24195e50e0836659ef6747358944f8f5d39",
            "integrity": "stored_review_and_verified_queued_intake",
            "producer": "host_publish_review_v1",
            "intake": {
                "artifactId": "artifact:ed94b3fe33b96cc861a933ef063609b05a591674b3c34b9e32dae01e6282148c",
                "intakeId": "publish-review-intake:5b4881c24982242235ebae936fa52e67cb7cffaf85608f7ca8cb977ad5eb9a34",
                "receiptContentId": "sha256:b7c06fdfb579970f103f25c69bb9af3126c0afc33799b41c06fabc2d82794d8a",
                "receiptId": "publish-review-intake-receipt:317b9772f3690d88a00989fb6a4e11ef9b27e503864548913e502d4fb96b8a9f"
            },
            "readiness": {
                "artifactId": "artifact:baa2174b4f5ea3c0b18a9803cb92d7f25c52c620c80f97e0b7de21a73adff24b",
                "readinessId": "study-readiness-v4:a28785c58ccf5aaae1c4a106ef8600abbd8e190d4ad69616ecaa43d4162f9f25",
                "receiptContentId": "sha256:5b201a2eb6abd2c2c2f919c835de58eaa67cddb061ac3b9a5d82fdbd05d532ce",
                "receiptId": "study-readiness-receipt-v4:2f6f3a01671990f33a0bf3038d078c3242ed5a6352190fa1d6752f93b81425bd"
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
            "state": "approval_revoked",
            "revocation": {
                "revocationId": "publish-review-revocation:5fca0cc20ac2fdf9b02f626b1cafd561921a4906d635010a566999cb5ed84444",
                "artifactId": "artifact:bbd81bfd3e9572e56606312806a66c91d8d26fe0a109fe3fc43305daa1899825",
                "receiptId": "publish-review-revocation-receipt:812d53639b5b8fa3f632070a35d265311d0025c77e88f4e9276bab6c84f2b172",
                "receiptContentId": "sha256:b06ad71ea7d10a32d20fe0ac3c79263c464918b60c46a470d00b814232f1bf91",
                "integrity": "stored_revocation_and_verified_approval",
                "producer": "host_publish_review_v1",
                "reviewer": {
                    "id": "reviewer:local-operator",
                    "label": "Local review operator",
                    "attestation": "I attest that I am the named reviewer and made this revocation decision."
                },
                "reasonCodes": [
                    "approval_entered_in_error"
                ],
                "note": null
            }
        }
    ]
}`;

export const YOUTUBE_INGEST_202 = `{
    "schema": "studio.youtube-local-ingest.v1",
    "ingestId": "youtube-ingest:6d6c5f19-d1ea-4908-8b19-fe3e319dd192",
    "status": "queued",
    "updatedAt": "2026-07-19T17:21:06.351Z",
    "source": null,
    "failure": null
}`;

export const YOUTUBE_INGEST_GET_200 = `{
    "schema": "studio.youtube-local-ingest.v1",
    "ingestId": "youtube-ingest:6d6c5f19-d1ea-4908-8b19-fe3e319dd192",
    "status": "registered",
    "updatedAt": "2026-07-19T17:21:30.763Z",
    "source": {
        "sourceSessionId": "source-session:d3dc44dbe87db3457a0c43ccb213371d1e4775340b437201ac8e2d92bd822d36",
        "sourceRevisionId": "source-revision:153f159f77f54093d8707f6d94d220b95a494a6e3428d7c4126c12111794a301",
        "sourceContentId": "sha256:4a6f299950234797d790981eb1901acab91e215636df92dba0a2f702055cec2a",
        "sourceKind": "youtube_local",
        "label": "Natural Korean Conversation with 태웅쌤 | 이렇게 귀하신 분이 ①",
        "rightsScope": "local_processing",
        "durationMs": 30030,
        "trackCount": 2,
        "preflightSchema": "studio.preflight-bundle.v1",
        "detectedLanguageEvidenceAvailable": false
    },
    "failure": null
}`;

export const CAPTION_PRODUCTION_409 = `{
    "schema": "studio.local-runtime-error.v1",
    "error": {
        "code": "caption_current_run_causality_required",
        "message": "Recorded caption fixtures cannot consume current-run study authority and are refused for production"
    }
}`;

export const CAPTION_PRODUCTIONS_200 = `{
    "schema": "studio.local-runtime-caption-productions.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 67,
    "captions": []
}`;

export const CAPTION_PRODUCTION_201 = `{
    "schema": "studio.local-runtime-caption-productions.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 76,
    "captions": [
        {
            "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
            "approval": {
                "reviewId": "publish-review:55cb99708b008092cb1b8e9675468eb869016ad859cefb9397457e98c0d5cf08",
                "artifactId": "artifact:e986d94e686a223f7c269d49d68188b45b8cba746f38f293189fa55803872e54",
                "receiptId": "publish-review-decision-receipt:088b53b0a71ff278d4a5c5d349645f3c7d470f8c61f94151b3aa6ccb8cb8f1ee",
                "receiptContentId": "sha256:85ad2898c419684dd4e49600b5ce8565e4c18bccc6e748e36fcd5e4ffe1205b3"
            },
            "source": {
                "artifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
                "range": {
                    "startMs": 0,
                    "endMs": 47200
                }
            },
            "study": {
                "studyId": "owned-media-study-v3:9d0b614b2f41af61bea808d106f844d60be5364d83ac2f54e9c0d5d6feb4a419",
                "artifactId": "artifact:a499e61c6744991907a268653e7b78d6bccb0697c2d1ff06601713ad963edc85",
                "contentId": "sha256:5fb0cc5f8ec25d54109e1c8f1f009484be4a26750ebb88c67d764d734e0fa59b",
                "executorReceiptId": "owned-media-study-executor-receipt-v3:b6e07ecac9ba8e975753690db20bc06ef929b089015742ed4a63287610f5bbed",
                "executorReceiptContentId": "sha256:979b7646c6f0c27c2d345dd21e882e85233cbf0d38ad3fa667c2a13df1df4ad1"
            },
            "readiness": {
                "artifactId": "artifact:c964be13cb908aa2131abdb9277ab09d8ec81a3434c07f8e7364c6024d2ad734",
                "readinessId": "study-readiness-v4:765321c1bdd126182fd2aa3be49ad556686089771d486c0febb25d0abf6f5261",
                "receiptContentId": "sha256:4915eb74796dabdb3784df4f6ccf06c7cbc24599560ff88f1c9e1673ba16004c",
                "receiptId": "study-readiness-receipt-v4:3e8500b787ea6bb5f1d1acf049ef5486d8ad7e433762c23cfb946eb8d2bccc28"
            },
            "reopened": {
                "sourceArtifactIds": [
                    "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70"
                ],
                "semanticEvidenceArtifactIds": [
                    "artifact:55dc7de98fcf66e927cdaf085a6c0008fb98d3889784bef3a094e665e25b556e",
                    "artifact:ca8c5e65c4c4a15473d996c6c1a19fb640ea00a648d6e50148eac2ccdbf0887d"
                ],
                "reportArtifactIds": [
                    "artifact:4040d711ae6935f9e0881f32ebd0cc6eeade8d0681dc585453d4ccdd1f0cf7d6",
                    "artifact:9b66aa68c5c4365905ba28a7ae4003dabcab065e5389ba43b34ca000c134beb9"
                ],
                "admissionIds": [
                    "parent-admission:21ad050a7fc7dfe8beb00f99fb42af020744dec43d7e9ab2c58ecfec0cd440d1",
                    "parent-admission:8bb09f8cdbecff0bd4eec880637572fc0a52537b90b380b149e0db6e2f22a0d6"
                ],
                "planningDecisionIds": [],
                "executorIds": [
                    "execution:deterministic-root:0b4ca42a86b5eba95289aa0a5177030a61b47b56d00e4da60972d6881d72bdce"
                ]
            },
            "authorityState": "unrevoked",
            "integrity": "stored_caption_and_receipt_with_verified_study_readiness_approval",
            "captionArtifactId": "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
            "captionContentId": "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
            "receiptArtifactId": "artifact:68027e372b84749660fa0265ff2df40ed7e7ae191756baa09584a2469adaa614",
            "receiptId": "caption-production-receipt:87aa6ac8e34b725ab1fc618e5b8b0392f6b7263a55731af07d61789d98399af8",
            "receiptContentId": "sha256:d1dabde385d17b44c07c16ee65795004bbac94b1f12c387705718d19150f7d66",
            "executor": {
                "id": "studio.deterministic-current-run-caption-test-seam",
                "version": "1",
                "classification": "deterministic_current_run_test_seam",
                "executionScope": "current_run",
                "cognitionClaim": "none",
                "recognizer": "deterministic-numbered-interval-test-seam",
                "translator": "deterministic-numbered-interval-test-seam",
                "sourceCaptionContentId": null
            },
            "result": {
                "status": "completed",
                "lineCount": 6,
                "sourceAvailableCount": 6,
                "targetAvailableCount": 6,
                "withheldCount": 0,
                "unavailableCount": 0
            }
        }
    ]
}`;

export const CAPTION_PRODUCTION_RESULTS_TEST_SEAM_200 = `{
    "schema": "studio.local-runtime-caption-production-results.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 76,
    "results": [
        {
            "verification": {
                "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
                "approval": {
                    "reviewId": "publish-review:55cb99708b008092cb1b8e9675468eb869016ad859cefb9397457e98c0d5cf08",
                    "artifactId": "artifact:e986d94e686a223f7c269d49d68188b45b8cba746f38f293189fa55803872e54",
                    "receiptId": "publish-review-decision-receipt:088b53b0a71ff278d4a5c5d349645f3c7d470f8c61f94151b3aa6ccb8cb8f1ee",
                    "receiptContentId": "sha256:85ad2898c419684dd4e49600b5ce8565e4c18bccc6e748e36fcd5e4ffe1205b3"
                },
                "source": {
                    "artifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                    "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                    "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
                    "range": {
                        "startMs": 0,
                        "endMs": 47200
                    }
                },
                "study": {
                    "studyId": "owned-media-study-v3:9d0b614b2f41af61bea808d106f844d60be5364d83ac2f54e9c0d5d6feb4a419",
                    "artifactId": "artifact:a499e61c6744991907a268653e7b78d6bccb0697c2d1ff06601713ad963edc85",
                    "contentId": "sha256:5fb0cc5f8ec25d54109e1c8f1f009484be4a26750ebb88c67d764d734e0fa59b",
                    "executorReceiptId": "owned-media-study-executor-receipt-v3:b6e07ecac9ba8e975753690db20bc06ef929b089015742ed4a63287610f5bbed",
                    "executorReceiptContentId": "sha256:979b7646c6f0c27c2d345dd21e882e85233cbf0d38ad3fa667c2a13df1df4ad1"
                },
                "readiness": {
                    "artifactId": "artifact:c964be13cb908aa2131abdb9277ab09d8ec81a3434c07f8e7364c6024d2ad734",
                    "readinessId": "study-readiness-v4:765321c1bdd126182fd2aa3be49ad556686089771d486c0febb25d0abf6f5261",
                    "receiptContentId": "sha256:4915eb74796dabdb3784df4f6ccf06c7cbc24599560ff88f1c9e1673ba16004c",
                    "receiptId": "study-readiness-receipt-v4:3e8500b787ea6bb5f1d1acf049ef5486d8ad7e433762c23cfb946eb8d2bccc28"
                },
                "reopened": {
                    "sourceArtifactIds": [
                        "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70"
                    ],
                    "semanticEvidenceArtifactIds": [
                        "artifact:55dc7de98fcf66e927cdaf085a6c0008fb98d3889784bef3a094e665e25b556e",
                        "artifact:ca8c5e65c4c4a15473d996c6c1a19fb640ea00a648d6e50148eac2ccdbf0887d"
                    ],
                    "reportArtifactIds": [
                        "artifact:4040d711ae6935f9e0881f32ebd0cc6eeade8d0681dc585453d4ccdd1f0cf7d6",
                        "artifact:9b66aa68c5c4365905ba28a7ae4003dabcab065e5389ba43b34ca000c134beb9"
                    ],
                    "admissionIds": [
                        "parent-admission:21ad050a7fc7dfe8beb00f99fb42af020744dec43d7e9ab2c58ecfec0cd440d1",
                        "parent-admission:8bb09f8cdbecff0bd4eec880637572fc0a52537b90b380b149e0db6e2f22a0d6"
                    ],
                    "planningDecisionIds": [],
                    "executorIds": [
                        "execution:deterministic-root:0b4ca42a86b5eba95289aa0a5177030a61b47b56d00e4da60972d6881d72bdce"
                    ]
                },
                "authorityState": "unrevoked",
                "integrity": "stored_caption_and_receipt_with_verified_study_readiness_approval",
                "captionArtifactId": "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
                "captionContentId": "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
                "receiptArtifactId": "artifact:68027e372b84749660fa0265ff2df40ed7e7ae191756baa09584a2469adaa614",
                "receiptId": "caption-production-receipt:87aa6ac8e34b725ab1fc618e5b8b0392f6b7263a55731af07d61789d98399af8",
                "receiptContentId": "sha256:d1dabde385d17b44c07c16ee65795004bbac94b1f12c387705718d19150f7d66",
                "executor": {
                    "id": "studio.deterministic-current-run-caption-test-seam",
                    "version": "1",
                    "classification": "deterministic_current_run_test_seam",
                    "executionScope": "current_run",
                    "cognitionClaim": "none",
                    "recognizer": "deterministic-numbered-interval-test-seam",
                    "translator": "deterministic-numbered-interval-test-seam",
                    "sourceCaptionContentId": null
                },
                "result": {
                    "status": "completed",
                    "lineCount": 6,
                    "sourceAvailableCount": 6,
                    "targetAvailableCount": 6,
                    "withheldCount": 0,
                    "unavailableCount": 0
                }
            },
            "artifact": {
                "schema": "studio.caption-production.artifact.v5",
                "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
                "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
                "input": {
                    "sourceArtifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                    "sourceContentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                    "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
                    "range": {
                        "startMs": 0,
                        "endMs": 47200
                    },
                    "sourceLanguage": "ko",
                    "targetLanguage": "en",
                    "study": {
                        "studyId": "owned-media-study-v3:9d0b614b2f41af61bea808d106f844d60be5364d83ac2f54e9c0d5d6feb4a419",
                        "artifactId": "artifact:a499e61c6744991907a268653e7b78d6bccb0697c2d1ff06601713ad963edc85",
                        "contentId": "sha256:5fb0cc5f8ec25d54109e1c8f1f009484be4a26750ebb88c67d764d734e0fa59b",
                        "executorReceiptId": "owned-media-study-executor-receipt-v3:b6e07ecac9ba8e975753690db20bc06ef929b089015742ed4a63287610f5bbed",
                        "executorReceiptContentId": "sha256:979b7646c6f0c27c2d345dd21e882e85233cbf0d38ad3fa667c2a13df1df4ad1"
                    },
                    "readiness": {
                        "readinessId": "study-readiness-v4:765321c1bdd126182fd2aa3be49ad556686089771d486c0febb25d0abf6f5261",
                        "artifactId": "artifact:c964be13cb908aa2131abdb9277ab09d8ec81a3434c07f8e7364c6024d2ad734",
                        "receiptId": "study-readiness-receipt-v4:3e8500b787ea6bb5f1d1acf049ef5486d8ad7e433762c23cfb946eb8d2bccc28",
                        "receiptContentId": "sha256:4915eb74796dabdb3784df4f6ccf06c7cbc24599560ff88f1c9e1673ba16004c"
                    }
                },
                "executor": {
                    "id": "studio.deterministic-current-run-caption-test-seam",
                    "version": "1",
                    "classification": "deterministic_current_run_test_seam",
                    "executionScope": "current_run",
                    "cognitionClaim": "none",
                    "recognizer": "deterministic-numbered-interval-test-seam",
                    "translator": "deterministic-numbered-interval-test-seam",
                    "sourceCaptionContentId": null
                },
                "sharedLineage": {
                    "derivation": "current_run_source_execution",
                    "source": {
                        "artifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                        "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e"
                    },
                    "study": {
                        "studyId": "owned-media-study-v3:9d0b614b2f41af61bea808d106f844d60be5364d83ac2f54e9c0d5d6feb4a419",
                        "artifactId": "artifact:a499e61c6744991907a268653e7b78d6bccb0697c2d1ff06601713ad963edc85",
                        "contentId": "sha256:5fb0cc5f8ec25d54109e1c8f1f009484be4a26750ebb88c67d764d734e0fa59b",
                        "executorReceiptId": "owned-media-study-executor-receipt-v3:b6e07ecac9ba8e975753690db20bc06ef929b089015742ed4a63287610f5bbed",
                        "executorReceiptContentId": "sha256:979b7646c6f0c27c2d345dd21e882e85233cbf0d38ad3fa667c2a13df1df4ad1"
                    },
                    "readiness": {
                        "readinessId": "study-readiness-v4:765321c1bdd126182fd2aa3be49ad556686089771d486c0febb25d0abf6f5261",
                        "artifactId": "artifact:c964be13cb908aa2131abdb9277ab09d8ec81a3434c07f8e7364c6024d2ad734",
                        "receiptId": "study-readiness-receipt-v4:3e8500b787ea6bb5f1d1acf049ef5486d8ad7e433762c23cfb946eb8d2bccc28",
                        "receiptContentId": "sha256:4915eb74796dabdb3784df4f6ccf06c7cbc24599560ff88f1c9e1673ba16004c"
                    },
                    "approval": {
                        "reviewId": "publish-review:55cb99708b008092cb1b8e9675468eb869016ad859cefb9397457e98c0d5cf08",
                        "artifactId": "artifact:e986d94e686a223f7c269d49d68188b45b8cba746f38f293189fa55803872e54",
                        "receiptId": "publish-review-decision-receipt:088b53b0a71ff278d4a5c5d349645f3c7d470f8c61f94151b3aa6ccb8cb8f1ee",
                        "receiptContentId": "sha256:85ad2898c419684dd4e49600b5ce8565e4c18bccc6e748e36fcd5e4ffe1205b3"
                    },
                    "captionExecutor": {
                        "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
                        "id": "studio.deterministic-current-run-caption-test-seam",
                        "version": "1",
                        "executionScope": "current_run",
                        "cognitionClaim": "none"
                    },
                    "generalizedCausality": {
                        "schema": "studio.caption-line-causality.v4",
                        "study": {
                            "studyId": "owned-media-study-v3:9d0b614b2f41af61bea808d106f844d60be5364d83ac2f54e9c0d5d6feb4a419",
                            "artifactId": "artifact:a499e61c6744991907a268653e7b78d6bccb0697c2d1ff06601713ad963edc85",
                            "contentId": "sha256:5fb0cc5f8ec25d54109e1c8f1f009484be4a26750ebb88c67d764d734e0fa59b",
                            "bytes": 9180,
                            "schema": "studio.owned-media-study.v3"
                        },
                        "readiness": {
                            "readinessId": "study-readiness-v4:765321c1bdd126182fd2aa3be49ad556686089771d486c0febb25d0abf6f5261",
                            "receiptId": "study-readiness-receipt-v4:3e8500b787ea6bb5f1d1acf049ef5486d8ad7e433762c23cfb946eb8d2bccc28",
                            "receiptContentId": "sha256:4915eb74796dabdb3784df4f6ccf06c7cbc24599560ff88f1c9e1673ba16004c"
                        }
                    },
                    "evidence": {
                        "semanticCitations": [
                            {
                                "operationId": "operation:deterministic-semantic:9218d602c8527dab809a8067c2b26e1ee34d3f0ea7a0e0db094f5fa3bde9e728",
                                "artifactId": "artifact:55dc7de98fcf66e927cdaf085a6c0008fb98d3889784bef3a094e665e25b556e",
                                "contentId": "sha256:55dd8a287f99094da2ebb8ce0e052f12096be8e48d1ca65ae470b0a413a71235",
                                "receiptId": "receipt:9a83ae6470cffd738742e4342af0553405af2c8cd0e1f8d92aafe3590db3cbcb",
                                "receiptContentId": "sha256:f961f28ff4b364fbd626c9ace65179ba52a419d42dab64c824bb3712ec608a83",
                                "observations": [
                                    {
                                        "observationId": "observation:c8a38f025508c48cbd3886fd3ec5ee3735c9b7e0df7d21fa0eeda429a9a07e37",
                                        "startMs": 23600,
                                        "endMs": 47200
                                    }
                                ]
                            },
                            {
                                "operationId": "operation:deterministic-semantic:62bb8ace860adca059ef2bb86bda8777810308770cc42721d8071e0187585c75",
                                "artifactId": "artifact:ca8c5e65c4c4a15473d996c6c1a19fb640ea00a648d6e50148eac2ccdbf0887d",
                                "contentId": "sha256:38d6f47b9779c5a0aa86a0278ae5340ddc2c7acfb7886fa16d8c85acf69d3b39",
                                "receiptId": "receipt:b5bdb36f9077027dfa2ecb9958f383eb9c7a4c64ac9231ba36b375869a2f5e9d",
                                "receiptContentId": "sha256:de068dcae589fbf97c9d552b894aa541a212177e8d934e30ec0d80623dfaa380",
                                "observations": [
                                    {
                                        "observationId": "observation:dce5e58f5c8ae2e7d6747a270b85c202e359d81171764410215ba28a8f4f2d09",
                                        "startMs": 0,
                                        "endMs": 23600
                                    }
                                ]
                            }
                        ],
                        "childReports": [
                            {
                                "reportId": "report:b38741b2-6a5b-49a8-acb4-5fd433b005f1",
                                "childTaskId": "task:04680977-5ce6-445d-b479-5b66844f7843",
                                "childAgentId": "agent:f9ea9d91-2844-46cf-b60b-2e9e28ad97cf",
                                "artifactId": "artifact:4040d711ae6935f9e0881f32ebd0cc6eeade8d0681dc585453d4ccdd1f0cf7d6",
                                "contentId": "sha256:60ee5ec294202bdc0757d7f7aa2fb3e62fc1042ec535698ee7c361cfa7adfc48",
                                "dispositionId": "parent-admission:21ad050a7fc7dfe8beb00f99fb42af020744dec43d7e9ab2c58ecfec0cd440d1",
                                "dispositionReceiptId": "parent-admission-receipt:9fc31398ab5cf45b1564da1388edf88b36cb7f5d09626153aa42a51af3eda656",
                                "dispositionReceiptContentId": "sha256:9642863f65b68505fa8451a71880b87b886b9b70b4f25905693a75288e89c753",
                                "admissionId": "parent-admission:21ad050a7fc7dfe8beb00f99fb42af020744dec43d7e9ab2c58ecfec0cd440d1",
                                "admissionReceiptId": "parent-admission-receipt:9fc31398ab5cf45b1564da1388edf88b36cb7f5d09626153aa42a51af3eda656",
                                "admissionReceiptContentId": "sha256:9642863f65b68505fa8451a71880b87b886b9b70b4f25905693a75288e89c753",
                                "readOperationId": "operation:generalized-parent-artifact-read:c8e5d2c4d2cb4321845635743d4282ecac28d671ce5f73bb3f7b4bc242a3199b",
                                "readReceiptId": "parent-artifact-read-receipt:6804d7c2750cbb4007c4cca84a9bc86e037fc1431dbad1a65c84f1b9d537bab3"
                            },
                            {
                                "reportId": "report:6b876950-702b-4b70-9fcc-e65b28110c7b",
                                "childTaskId": "task:80a9a132-e77d-44d0-b1e9-5926573e8a80",
                                "childAgentId": "agent:a194e3e4-f8d2-46c6-95ab-d8a2b77bc469",
                                "artifactId": "artifact:9b66aa68c5c4365905ba28a7ae4003dabcab065e5389ba43b34ca000c134beb9",
                                "contentId": "sha256:c806c860b0cd51e2bf4d76f46bde33ae34008b5454a66d6b80038e21c78ed527",
                                "dispositionId": "parent-admission:8bb09f8cdbecff0bd4eec880637572fc0a52537b90b380b149e0db6e2f22a0d6",
                                "dispositionReceiptId": "parent-admission-receipt:d24f3aad45e73dbeb1e15a6e31b6bc762b6f7c8270f389c22450d528e82752b5",
                                "dispositionReceiptContentId": "sha256:2011a4b87757803913ccfd3f3fc3e8b07cba9e16d258491b327fee89ec025ed5",
                                "admissionId": "parent-admission:8bb09f8cdbecff0bd4eec880637572fc0a52537b90b380b149e0db6e2f22a0d6",
                                "admissionReceiptId": "parent-admission-receipt:d24f3aad45e73dbeb1e15a6e31b6bc762b6f7c8270f389c22450d528e82752b5",
                                "admissionReceiptContentId": "sha256:2011a4b87757803913ccfd3f3fc3e8b07cba9e16d258491b327fee89ec025ed5",
                                "readOperationId": "operation:generalized-parent-artifact-read:cba746edf410a34f4364752d12a1c77411693a097b71af0f8eb3b529074d74a6",
                                "readReceiptId": "parent-artifact-read-receipt:2e59e8845854aac97e6c8e16e00e14c6f85f3530f16995dfff6553825b381ce7"
                            }
                        ]
                    }
                },
                "lines": [
                    {
                        "id": "deterministic-current-run-line-001",
                        "startMs": 0,
                        "endMs": 7866,
                        "lineage": {
                            "study": {
                                "coverage": {
                                    "coverageId": "study-coverage-v3:acf9b830ab99680a8f5aa51aec22c2f2fc5e58c499f581e594418a83ab74b3a1",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:3977e19bbd29ecf5b425b5c0958cd0f3ea7614a0bfcdb6e938bfa9254f7b1c9b"
                                ],
                                "semanticCitationIndexes": [
                                    1
                                ],
                                "childReportIndexes": [
                                    0
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:acf9b830ab99680a8f5aa51aec22c2f2fc5e58c499f581e594418a83ab74b3a1",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:3977e19bbd29ecf5b425b5c0958cd0f3ea7614a0bfcdb6e938bfa9254f7b1c9b"
                                ],
                                "citationIds": [
                                    "evidence-citation:2723bb11068c31d83ed092fadf205be7540ef1f633c05d3fe7ef80eff2e6ce8c"
                                ],
                                "passIds": []
                            }
                        },
                        "source": {
                            "language": "ko",
                            "state": "available",
                            "text": "테스트 구간 1",
                            "reasonCode": null
                        },
                        "target": {
                            "language": "en",
                            "state": "available",
                            "text": "Test interval 1",
                            "reasonCode": null
                        }
                    },
                    {
                        "id": "deterministic-current-run-line-002",
                        "startMs": 7866,
                        "endMs": 15733,
                        "lineage": {
                            "study": {
                                "coverage": {
                                    "coverageId": "study-coverage-v3:acf9b830ab99680a8f5aa51aec22c2f2fc5e58c499f581e594418a83ab74b3a1",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:3977e19bbd29ecf5b425b5c0958cd0f3ea7614a0bfcdb6e938bfa9254f7b1c9b"
                                ],
                                "semanticCitationIndexes": [
                                    1
                                ],
                                "childReportIndexes": [
                                    0
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:acf9b830ab99680a8f5aa51aec22c2f2fc5e58c499f581e594418a83ab74b3a1",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:3977e19bbd29ecf5b425b5c0958cd0f3ea7614a0bfcdb6e938bfa9254f7b1c9b"
                                ],
                                "citationIds": [
                                    "evidence-citation:2723bb11068c31d83ed092fadf205be7540ef1f633c05d3fe7ef80eff2e6ce8c"
                                ],
                                "passIds": []
                            }
                        },
                        "source": {
                            "language": "ko",
                            "state": "available",
                            "text": "테스트 구간 2",
                            "reasonCode": null
                        },
                        "target": {
                            "language": "en",
                            "state": "available",
                            "text": "Test interval 2",
                            "reasonCode": null
                        }
                    },
                    {
                        "id": "deterministic-current-run-line-003",
                        "startMs": 15733,
                        "endMs": 23600,
                        "lineage": {
                            "study": {
                                "coverage": {
                                    "coverageId": "study-coverage-v3:acf9b830ab99680a8f5aa51aec22c2f2fc5e58c499f581e594418a83ab74b3a1",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:3977e19bbd29ecf5b425b5c0958cd0f3ea7614a0bfcdb6e938bfa9254f7b1c9b"
                                ],
                                "semanticCitationIndexes": [
                                    1
                                ],
                                "childReportIndexes": [
                                    0
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:acf9b830ab99680a8f5aa51aec22c2f2fc5e58c499f581e594418a83ab74b3a1",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:3977e19bbd29ecf5b425b5c0958cd0f3ea7614a0bfcdb6e938bfa9254f7b1c9b"
                                ],
                                "citationIds": [
                                    "evidence-citation:2723bb11068c31d83ed092fadf205be7540ef1f633c05d3fe7ef80eff2e6ce8c"
                                ],
                                "passIds": []
                            }
                        },
                        "source": {
                            "language": "ko",
                            "state": "available",
                            "text": "테스트 구간 3",
                            "reasonCode": null
                        },
                        "target": {
                            "language": "en",
                            "state": "available",
                            "text": "Test interval 3",
                            "reasonCode": null
                        }
                    },
                    {
                        "id": "deterministic-current-run-line-004",
                        "startMs": 23600,
                        "endMs": 31466,
                        "lineage": {
                            "study": {
                                "coverage": {
                                    "coverageId": "study-coverage-v3:f141b61f6db94e94edec7b8b1f2c2a4bff142fbfe74978154033167f3c0fad90",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:66a4f3d8acb4d155df044ee158cb98e44516f2d8bfbf293295d52baa9862ab2c"
                                ],
                                "semanticCitationIndexes": [
                                    0
                                ],
                                "childReportIndexes": [
                                    1
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:f141b61f6db94e94edec7b8b1f2c2a4bff142fbfe74978154033167f3c0fad90",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:66a4f3d8acb4d155df044ee158cb98e44516f2d8bfbf293295d52baa9862ab2c"
                                ],
                                "citationIds": [
                                    "evidence-citation:117a39b5e4963dc2c9a08d118df4d74e8a314ab27f7093b2ece44a938b65e078"
                                ],
                                "passIds": []
                            }
                        },
                        "source": {
                            "language": "ko",
                            "state": "available",
                            "text": "테스트 구간 4",
                            "reasonCode": null
                        },
                        "target": {
                            "language": "en",
                            "state": "available",
                            "text": "Test interval 4",
                            "reasonCode": null
                        }
                    },
                    {
                        "id": "deterministic-current-run-line-005",
                        "startMs": 31466,
                        "endMs": 39333,
                        "lineage": {
                            "study": {
                                "coverage": {
                                    "coverageId": "study-coverage-v3:f141b61f6db94e94edec7b8b1f2c2a4bff142fbfe74978154033167f3c0fad90",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:66a4f3d8acb4d155df044ee158cb98e44516f2d8bfbf293295d52baa9862ab2c"
                                ],
                                "semanticCitationIndexes": [
                                    0
                                ],
                                "childReportIndexes": [
                                    1
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:f141b61f6db94e94edec7b8b1f2c2a4bff142fbfe74978154033167f3c0fad90",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:66a4f3d8acb4d155df044ee158cb98e44516f2d8bfbf293295d52baa9862ab2c"
                                ],
                                "citationIds": [
                                    "evidence-citation:117a39b5e4963dc2c9a08d118df4d74e8a314ab27f7093b2ece44a938b65e078"
                                ],
                                "passIds": []
                            }
                        },
                        "source": {
                            "language": "ko",
                            "state": "available",
                            "text": "테스트 구간 5",
                            "reasonCode": null
                        },
                        "target": {
                            "language": "en",
                            "state": "available",
                            "text": "Test interval 5",
                            "reasonCode": null
                        }
                    },
                    {
                        "id": "deterministic-current-run-line-006",
                        "startMs": 39333,
                        "endMs": 47200,
                        "lineage": {
                            "study": {
                                "coverage": {
                                    "coverageId": "study-coverage-v3:f141b61f6db94e94edec7b8b1f2c2a4bff142fbfe74978154033167f3c0fad90",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:66a4f3d8acb4d155df044ee158cb98e44516f2d8bfbf293295d52baa9862ab2c"
                                ],
                                "semanticCitationIndexes": [
                                    0
                                ],
                                "childReportIndexes": [
                                    1
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:f141b61f6db94e94edec7b8b1f2c2a4bff142fbfe74978154033167f3c0fad90",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:66a4f3d8acb4d155df044ee158cb98e44516f2d8bfbf293295d52baa9862ab2c"
                                ],
                                "citationIds": [
                                    "evidence-citation:117a39b5e4963dc2c9a08d118df4d74e8a314ab27f7093b2ece44a938b65e078"
                                ],
                                "passIds": []
                            }
                        },
                        "source": {
                            "language": "ko",
                            "state": "available",
                            "text": "테스트 구간 6",
                            "reasonCode": null
                        },
                        "target": {
                            "language": "en",
                            "state": "available",
                            "text": "Test interval 6",
                            "reasonCode": null
                        }
                    }
                ],
                "result": {
                    "status": "completed",
                    "lineCount": 6,
                    "sourceAvailableCount": 6,
                    "targetAvailableCount": 6,
                    "withheldCount": 0,
                    "unavailableCount": 0
                }
            }
        }
    ]
}`;

export const CAPTION_QUALITY_CONTROLS_TEST_SEAM_200 = `{
    "schema": "studio.local-runtime-caption-quality-controls.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 76,
    "qualityControls": [
        {
            "qcId": "caption-quality-control:bfe92f11accdcc54a485505cd528f940d375bb19fa04916348954fe5a8b0ac9e",
            "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
            "captionArtifactId": "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
            "captionContentId": "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
            "outputArtifactId": "artifact:56d5bac79902b8ca7d7710d9bd26eb65b88b6d740ce5c00a9f33833967a1996d",
            "receiptId": "caption-quality-control-receipt:5563e089a2990593b907596dd8a340e28ba54db3f379440345a602d2c1f3f1f8",
            "receiptContentId": "sha256:13044b16ff2060eff20bad429bab3c88d651e7a044798543505d412e5ceaff7d",
            "integrity": "stored_independent_qc_with_verified_current_run_candidate",
            "policy": "structural_current_run_gate_without_semantic_quality_score",
            "outcome": "accepted",
            "reasonCodes": [
                "current_run_candidate_structurally_complete"
            ],
            "acceptedLineIds": [
                "deterministic-current-run-line-001",
                "deterministic-current-run-line-002",
                "deterministic-current-run-line-003",
                "deterministic-current-run-line-004",
                "deterministic-current-run-line-005",
                "deterministic-current-run-line-006"
            ],
            "withheldLineIds": [],
            "candidate": {
                "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
                "approval": {
                    "reviewId": "publish-review:55cb99708b008092cb1b8e9675468eb869016ad859cefb9397457e98c0d5cf08",
                    "artifactId": "artifact:e986d94e686a223f7c269d49d68188b45b8cba746f38f293189fa55803872e54",
                    "receiptId": "publish-review-decision-receipt:088b53b0a71ff278d4a5c5d349645f3c7d470f8c61f94151b3aa6ccb8cb8f1ee",
                    "receiptContentId": "sha256:85ad2898c419684dd4e49600b5ce8565e4c18bccc6e748e36fcd5e4ffe1205b3"
                },
                "source": {
                    "artifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                    "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                    "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
                    "range": {
                        "startMs": 0,
                        "endMs": 47200
                    }
                },
                "study": {
                    "studyId": "owned-media-study-v3:9d0b614b2f41af61bea808d106f844d60be5364d83ac2f54e9c0d5d6feb4a419",
                    "artifactId": "artifact:a499e61c6744991907a268653e7b78d6bccb0697c2d1ff06601713ad963edc85",
                    "contentId": "sha256:5fb0cc5f8ec25d54109e1c8f1f009484be4a26750ebb88c67d764d734e0fa59b",
                    "executorReceiptId": "owned-media-study-executor-receipt-v3:b6e07ecac9ba8e975753690db20bc06ef929b089015742ed4a63287610f5bbed",
                    "executorReceiptContentId": "sha256:979b7646c6f0c27c2d345dd21e882e85233cbf0d38ad3fa667c2a13df1df4ad1"
                },
                "readiness": {
                    "artifactId": "artifact:c964be13cb908aa2131abdb9277ab09d8ec81a3434c07f8e7364c6024d2ad734",
                    "readinessId": "study-readiness-v4:765321c1bdd126182fd2aa3be49ad556686089771d486c0febb25d0abf6f5261",
                    "receiptContentId": "sha256:4915eb74796dabdb3784df4f6ccf06c7cbc24599560ff88f1c9e1673ba16004c",
                    "receiptId": "study-readiness-receipt-v4:3e8500b787ea6bb5f1d1acf049ef5486d8ad7e433762c23cfb946eb8d2bccc28"
                },
                "reopened": {
                    "sourceArtifactIds": [
                        "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70"
                    ],
                    "semanticEvidenceArtifactIds": [
                        "artifact:55dc7de98fcf66e927cdaf085a6c0008fb98d3889784bef3a094e665e25b556e",
                        "artifact:ca8c5e65c4c4a15473d996c6c1a19fb640ea00a648d6e50148eac2ccdbf0887d"
                    ],
                    "reportArtifactIds": [
                        "artifact:4040d711ae6935f9e0881f32ebd0cc6eeade8d0681dc585453d4ccdd1f0cf7d6",
                        "artifact:9b66aa68c5c4365905ba28a7ae4003dabcab065e5389ba43b34ca000c134beb9"
                    ],
                    "admissionIds": [
                        "parent-admission:21ad050a7fc7dfe8beb00f99fb42af020744dec43d7e9ab2c58ecfec0cd440d1",
                        "parent-admission:8bb09f8cdbecff0bd4eec880637572fc0a52537b90b380b149e0db6e2f22a0d6"
                    ],
                    "planningDecisionIds": [],
                    "executorIds": [
                        "execution:deterministic-root:0b4ca42a86b5eba95289aa0a5177030a61b47b56d00e4da60972d6881d72bdce"
                    ]
                },
                "authorityState": "unrevoked",
                "integrity": "stored_caption_and_receipt_with_verified_study_readiness_approval",
                "captionArtifactId": "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
                "captionContentId": "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
                "receiptArtifactId": "artifact:68027e372b84749660fa0265ff2df40ed7e7ae191756baa09584a2469adaa614",
                "receiptId": "caption-production-receipt:87aa6ac8e34b725ab1fc618e5b8b0392f6b7263a55731af07d61789d98399af8",
                "receiptContentId": "sha256:d1dabde385d17b44c07c16ee65795004bbac94b1f12c387705718d19150f7d66",
                "executor": {
                    "id": "studio.deterministic-current-run-caption-test-seam",
                    "version": "1",
                    "classification": "deterministic_current_run_test_seam",
                    "executionScope": "current_run",
                    "cognitionClaim": "none",
                    "recognizer": "deterministic-numbered-interval-test-seam",
                    "translator": "deterministic-numbered-interval-test-seam",
                    "sourceCaptionContentId": null
                },
                "result": {
                    "status": "completed",
                    "lineCount": 6,
                    "sourceAvailableCount": 6,
                    "targetAvailableCount": 6,
                    "withheldCount": 0,
                    "unavailableCount": 0
                }
            }
        }
    ]
}`;

export const CAPTION_QC_409 = `{
    "schema": "studio.local-runtime-error.v1",
    "error": {
        "code": "illegal_caption_qc_transition",
        "message": "The caption candidate already has one immutable independent QC decision"
    }
}`;


export const CAPTION_PRODUCTION_RESULTS_200 = `{
    "schema": "studio.local-runtime-caption-production-results.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 67,
    "results": []
}`;

export const CAPTION_QUALITY_CONTROLS_200 = `{
    "schema": "studio.local-runtime-caption-quality-controls.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 67,
    "qualityControls": []
}`;

export const LANGUAGE_EXPLANATIONS_201 = `{
    "schema": "studio.local-runtime-language-explanations.v1",
    "commandId": "runtime-start:87a88ad697c53b8134783135c64c45c8c362bf9f682e121a720eb7867b2fcd2e",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "journalHead": 80,
    "attempts": [
        {
            "jobId": "language-explanation:2e32eb73039f83d937a01e69fb2f745f832ea9d9342ff4823327956d22f47b27",
            "attempt": 0,
            "caption": {
                "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
                "artifactId": "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
                "contentId": "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
                "receiptArtifactId": "artifact:68027e372b84749660fa0265ff2df40ed7e7ae191756baa09584a2469adaa614",
                "receiptId": "caption-production-receipt:87aa6ac8e34b725ab1fc618e5b8b0392f6b7263a55731af07d61789d98399af8",
                "receiptContentId": "sha256:d1dabde385d17b44c07c16ee65795004bbac94b1f12c387705718d19150f7d66"
            },
            "lineId": "deterministic-current-run-line-001",
            "selection": {
                "side": "source",
                "unit": "unicode_code_point",
                "start": 0,
                "end": 2,
                "text": "테스"
            },
            "facetKinds": [
                "meaning",
                "word"
            ],
            "status": "completed",
            "failure": null
        }
    ],
    "results": [
        {
            "verification": {
                "integrity": "stored_explanation_and_receipt_with_verified_current_caption",
                "jobId": "language-explanation:2e32eb73039f83d937a01e69fb2f745f832ea9d9342ff4823327956d22f47b27",
                "artifactId": "artifact:d80e892ca09bdd03fd17ac8bd74cd2c8e2585f659afe231180e793db98c2b037",
                "contentId": "sha256:1e2ca3b092fc183deaf66bf26ac099a78119aaaa580f1a6aba3f0471ff210387",
                "receiptArtifactId": "artifact:d40c1698808959f236836e41bf4bbb0dff66b13a252ddd622b7de729b15b938c",
                "receiptId": "language-explanation-receipt:c7b53df852cc2b47025ed1d85d75458bfb3dcf52d12d7df734be4ba42183fb69",
                "receiptContentId": "sha256:36bb81e50d8c685f35c20c7dc9e319c6e3a66ceaca3087387276ffbeffd67b77",
                "caption": {
                    "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
                    "artifactId": "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
                    "contentId": "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
                    "receiptArtifactId": "artifact:68027e372b84749660fa0265ff2df40ed7e7ae191756baa09584a2469adaa614",
                    "receiptId": "caption-production-receipt:87aa6ac8e34b725ab1fc618e5b8b0392f6b7263a55731af07d61789d98399af8",
                    "receiptContentId": "sha256:d1dabde385d17b44c07c16ee65795004bbac94b1f12c387705718d19150f7d66"
                },
                "lineId": "deterministic-current-run-line-001",
                "selection": {
                    "side": "source",
                    "unit": "unicode_code_point",
                    "start": 0,
                    "end": 2,
                    "text": "테스"
                },
                "executor": {
                    "id": "studio.openai-language-explanation-generator",
                    "version": "1",
                    "classification": "real_model",
                    "executionScope": "current_run",
                    "model": "gpt-4o-mini",
                    "promptContractContentId": "sha256:fc0cd23ad7e8d54db7ca0a80f3ee838942d9b7ee007f1989c6b59840fae1c7ce",
                    "configurationContentId": "sha256:64abd6c225ca3fa315fc96c65b5f35fef2970fa44e94ba9d71c48d65ef0ca15b"
                },
                "result": {
                    "status": "completed",
                    "requestedFacetCount": 2,
                    "availableFacetCount": 2,
                    "withheldFacetCount": 0,
                    "unavailableFacetCount": 0
                }
            },
            "artifact": {
                "schema": "studio.language-explanation.artifact.v1",
                "jobId": "language-explanation:2e32eb73039f83d937a01e69fb2f745f832ea9d9342ff4823327956d22f47b27",
                "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
                "input": {
                    "source": {
                        "artifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                        "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                        "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
                        "rightsScope": "redistribution"
                    },
                    "study": {
                        "studyId": "owned-media-study-v3:9d0b614b2f41af61bea808d106f844d60be5364d83ac2f54e9c0d5d6feb4a419",
                        "artifactId": "artifact:a499e61c6744991907a268653e7b78d6bccb0697c2d1ff06601713ad963edc85",
                        "contentId": "sha256:5fb0cc5f8ec25d54109e1c8f1f009484be4a26750ebb88c67d764d734e0fa59b"
                    },
                    "readiness": {
                        "readinessId": "study-readiness-v4:765321c1bdd126182fd2aa3be49ad556686089771d486c0febb25d0abf6f5261",
                        "artifactId": "artifact:c964be13cb908aa2131abdb9277ab09d8ec81a3434c07f8e7364c6024d2ad734",
                        "receiptId": "study-readiness-receipt-v4:3e8500b787ea6bb5f1d1acf049ef5486d8ad7e433762c23cfb946eb8d2bccc28",
                        "receiptContentId": "sha256:4915eb74796dabdb3784df4f6ccf06c7cbc24599560ff88f1c9e1673ba16004c"
                    },
                    "approval": {
                        "reviewId": "publish-review:55cb99708b008092cb1b8e9675468eb869016ad859cefb9397457e98c0d5cf08",
                        "artifactId": "artifact:e986d94e686a223f7c269d49d68188b45b8cba746f38f293189fa55803872e54",
                        "receiptId": "publish-review-decision-receipt:088b53b0a71ff278d4a5c5d349645f3c7d470f8c61f94151b3aa6ccb8cb8f1ee",
                        "receiptContentId": "sha256:85ad2898c419684dd4e49600b5ce8565e4c18bccc6e748e36fcd5e4ffe1205b3"
                    },
                    "caption": {
                        "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
                        "artifactId": "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
                        "contentId": "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
                        "receiptArtifactId": "artifact:68027e372b84749660fa0265ff2df40ed7e7ae191756baa09584a2469adaa614",
                        "receiptId": "caption-production-receipt:87aa6ac8e34b725ab1fc618e5b8b0392f6b7263a55731af07d61789d98399af8",
                        "receiptContentId": "sha256:d1dabde385d17b44c07c16ee65795004bbac94b1f12c387705718d19150f7d66"
                    },
                    "line": {
                        "lineId": "deterministic-current-run-line-001",
                        "startMs": 0,
                        "endMs": 7866,
                        "source": {
                            "language": "ko",
                            "state": "available",
                            "text": "테스트 구간 1",
                            "reasonCode": null
                        },
                        "target": {
                            "language": "en",
                            "state": "available",
                            "text": "Test interval 1",
                            "reasonCode": null
                        }
                    },
                    "contextLines": [
                        {
                            "lineId": "deterministic-current-run-line-001",
                            "startMs": 0,
                            "endMs": 7866,
                            "source": {
                                "language": "ko",
                                "state": "available",
                                "text": "테스트 구간 1",
                                "reasonCode": null
                            },
                            "target": {
                                "language": "en",
                                "state": "available",
                                "text": "Test interval 1",
                                "reasonCode": null
                            }
                        },
                        {
                            "lineId": "deterministic-current-run-line-002",
                            "startMs": 7866,
                            "endMs": 15733,
                            "source": {
                                "language": "ko",
                                "state": "available",
                                "text": "테스트 구간 2",
                                "reasonCode": null
                            },
                            "target": {
                                "language": "en",
                                "state": "available",
                                "text": "Test interval 2",
                                "reasonCode": null
                            }
                        },
                        {
                            "lineId": "deterministic-current-run-line-003",
                            "startMs": 15733,
                            "endMs": 23600,
                            "source": {
                                "language": "ko",
                                "state": "available",
                                "text": "테스트 구간 3",
                                "reasonCode": null
                            },
                            "target": {
                                "language": "en",
                                "state": "available",
                                "text": "Test interval 3",
                                "reasonCode": null
                            }
                        },
                        {
                            "lineId": "deterministic-current-run-line-004",
                            "startMs": 23600,
                            "endMs": 31466,
                            "source": {
                                "language": "ko",
                                "state": "available",
                                "text": "테스트 구간 4",
                                "reasonCode": null
                            },
                            "target": {
                                "language": "en",
                                "state": "available",
                                "text": "Test interval 4",
                                "reasonCode": null
                            }
                        },
                        {
                            "lineId": "deterministic-current-run-line-005",
                            "startMs": 31466,
                            "endMs": 39333,
                            "source": {
                                "language": "ko",
                                "state": "available",
                                "text": "테스트 구간 5",
                                "reasonCode": null
                            },
                            "target": {
                                "language": "en",
                                "state": "available",
                                "text": "Test interval 5",
                                "reasonCode": null
                            }
                        }
                    ],
                    "selection": {
                        "side": "source",
                        "unit": "unicode_code_point",
                        "start": 0,
                        "end": 2,
                        "text": "테스"
                    },
                    "inputContextLineage": {
                        "claimIds": [
                            "study-claim:3977e19bbd29ecf5b425b5c0958cd0f3ea7614a0bfcdb6e938bfa9254f7b1c9b"
                        ],
                        "citationIds": [
                            "operation:deterministic-semantic:62bb8ace860adca059ef2bb86bda8777810308770cc42721d8071e0187585c75"
                        ],
                        "semanticEvidenceArtifactIds": [
                            "artifact:ca8c5e65c4c4a15473d996c6c1a19fb640ea00a648d6e50148eac2ccdbf0887d"
                        ],
                        "semanticEvidenceReceiptIds": [
                            "receipt:b5bdb36f9077027dfa2ecb9958f383eb9c7a4c64ac9231ba36b375869a2f5e9d"
                        ]
                    }
                },
                "grant": {
                    "schema": "studio.language-explanation.grant.v1",
                    "grantId": "language-explanation-grant:2e32eb73039f83d937a01e69fb2f745f832ea9d9342ff4823327956d22f47b27",
                    "attempt": 0,
                    "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
                    "requestFingerprint": "language-explanation-request:99b476a830b412d45f69121fe575ebf50d6794e355bafa4d07918ed09103fc08",
                    "caption": {
                        "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
                        "artifactId": "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
                        "contentId": "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
                        "receiptArtifactId": "artifact:68027e372b84749660fa0265ff2df40ed7e7ae191756baa09584a2469adaa614",
                        "receiptId": "caption-production-receipt:87aa6ac8e34b725ab1fc618e5b8b0392f6b7263a55731af07d61789d98399af8",
                        "receiptContentId": "sha256:d1dabde385d17b44c07c16ee65795004bbac94b1f12c387705718d19150f7d66"
                    },
                    "lineId": "deterministic-current-run-line-001",
                    "selection": {
                        "side": "source",
                        "unit": "unicode_code_point",
                        "start": 0,
                        "end": 2,
                        "text": "테스"
                    },
                    "facetKinds": [
                        "meaning",
                        "word"
                    ],
                    "rightsScope": "redistribution",
                    "disposition": "private_apply_output",
                    "executor": {
                        "id": "studio.openai-language-explanation-generator",
                        "version": "1",
                        "classification": "real_model",
                        "executionScope": "current_run",
                        "model": "gpt-4o-mini",
                        "promptContractContentId": "sha256:fc0cd23ad7e8d54db7ca0a80f3ee838942d9b7ee007f1989c6b59840fae1c7ce",
                        "configurationContentId": "sha256:64abd6c225ca3fa315fc96c65b5f35fef2970fa44e94ba9d71c48d65ef0ca15b"
                    },
                    "limits": {
                        "maxContextLines": 5,
                        "maxRequestedFacets": 5,
                        "maxAttemptsPerRequest": 3,
                        "maxSelectionCodePoints": 256,
                        "maxCaptionTextBytes": 32768,
                        "maxFacetTextBytes": 8192,
                        "maxOutputBytes": 65536,
                        "maxProviderResponseBytes": 131072,
                        "maxArtifactBytes": 131072,
                        "maxCompletionTokens": 4000,
                        "maxWallMs": 60000
                    }
                },
                "executor": {
                    "id": "studio.openai-language-explanation-generator",
                    "version": "1",
                    "classification": "real_model",
                    "executionScope": "current_run",
                    "model": "gpt-4o-mini",
                    "promptContractContentId": "sha256:fc0cd23ad7e8d54db7ca0a80f3ee838942d9b7ee007f1989c6b59840fae1c7ce",
                    "configurationContentId": "sha256:64abd6c225ca3fa315fc96c65b5f35fef2970fa44e94ba9d71c48d65ef0ca15b"
                },
                "facets": [
                    {
                        "kind": "meaning",
                        "availability": "available",
                        "reasonCode": null,
                        "content": {
                            "sceneMeaning": "This phrase refers to a specific period or segment designated for testing."
                        },
                        "executionAuthority": "host_receipted",
                        "semanticReview": "not_reviewed",
                        "grounding": "caption_context_inference",
                        "externalCitationIds": []
                    },
                    {
                        "kind": "word",
                        "availability": "available",
                        "reasonCode": null,
                        "content": {
                            "form": "테스",
                            "sense": "related to testing or examination",
                            "role": "prefix"
                        },
                        "executionAuthority": "host_receipted",
                        "semanticReview": "not_reviewed",
                        "grounding": "caption_context_inference",
                        "externalCitationIds": []
                    }
                ],
                "result": {
                    "status": "completed",
                    "requestedFacetCount": 2,
                    "availableFacetCount": 2,
                    "withheldFacetCount": 0,
                    "unavailableFacetCount": 0
                },
                "semanticReview": {
                    "state": "not_reviewed",
                    "receiptId": null
                },
                "rights": {
                    "sourceScope": "redistribution",
                    "publication": "private",
                    "exportEligibility": "unavailable"
                },
                "nonClaims": [
                    "explanation_semantic_correctness_not_assessed",
                    "caption_context_not_explanation_evidence",
                    "publication_not_authorized",
                    "learner_selection_not_runtime_evidence"
                ]
            },
            "receipt": {
                "schema": "studio.language-explanation.receipt.v1",
                "receiptId": "language-explanation-receipt:c7b53df852cc2b47025ed1d85d75458bfb3dcf52d12d7df734be4ba42183fb69",
                "jobId": "language-explanation:2e32eb73039f83d937a01e69fb2f745f832ea9d9342ff4823327956d22f47b27",
                "grant": {
                    "schema": "studio.language-explanation.grant.v1",
                    "grantId": "language-explanation-grant:2e32eb73039f83d937a01e69fb2f745f832ea9d9342ff4823327956d22f47b27",
                    "attempt": 0,
                    "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
                    "requestFingerprint": "language-explanation-request:99b476a830b412d45f69121fe575ebf50d6794e355bafa4d07918ed09103fc08",
                    "caption": {
                        "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
                        "artifactId": "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
                        "contentId": "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
                        "receiptArtifactId": "artifact:68027e372b84749660fa0265ff2df40ed7e7ae191756baa09584a2469adaa614",
                        "receiptId": "caption-production-receipt:87aa6ac8e34b725ab1fc618e5b8b0392f6b7263a55731af07d61789d98399af8",
                        "receiptContentId": "sha256:d1dabde385d17b44c07c16ee65795004bbac94b1f12c387705718d19150f7d66"
                    },
                    "lineId": "deterministic-current-run-line-001",
                    "selection": {
                        "side": "source",
                        "unit": "unicode_code_point",
                        "start": 0,
                        "end": 2,
                        "text": "테스"
                    },
                    "facetKinds": [
                        "meaning",
                        "word"
                    ],
                    "rightsScope": "redistribution",
                    "disposition": "private_apply_output",
                    "executor": {
                        "id": "studio.openai-language-explanation-generator",
                        "version": "1",
                        "classification": "real_model",
                        "executionScope": "current_run",
                        "model": "gpt-4o-mini",
                        "promptContractContentId": "sha256:fc0cd23ad7e8d54db7ca0a80f3ee838942d9b7ee007f1989c6b59840fae1c7ce",
                        "configurationContentId": "sha256:64abd6c225ca3fa315fc96c65b5f35fef2970fa44e94ba9d71c48d65ef0ca15b"
                    },
                    "limits": {
                        "maxContextLines": 5,
                        "maxRequestedFacets": 5,
                        "maxAttemptsPerRequest": 3,
                        "maxSelectionCodePoints": 256,
                        "maxCaptionTextBytes": 32768,
                        "maxFacetTextBytes": 8192,
                        "maxOutputBytes": 65536,
                        "maxProviderResponseBytes": 131072,
                        "maxArtifactBytes": 131072,
                        "maxCompletionTokens": 4000,
                        "maxWallMs": 60000
                    }
                },
                "input": {
                    "source": {
                        "artifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                        "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                        "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
                        "rightsScope": "redistribution"
                    },
                    "study": {
                        "studyId": "owned-media-study-v3:9d0b614b2f41af61bea808d106f844d60be5364d83ac2f54e9c0d5d6feb4a419",
                        "artifactId": "artifact:a499e61c6744991907a268653e7b78d6bccb0697c2d1ff06601713ad963edc85",
                        "contentId": "sha256:5fb0cc5f8ec25d54109e1c8f1f009484be4a26750ebb88c67d764d734e0fa59b"
                    },
                    "readiness": {
                        "readinessId": "study-readiness-v4:765321c1bdd126182fd2aa3be49ad556686089771d486c0febb25d0abf6f5261",
                        "artifactId": "artifact:c964be13cb908aa2131abdb9277ab09d8ec81a3434c07f8e7364c6024d2ad734",
                        "receiptId": "study-readiness-receipt-v4:3e8500b787ea6bb5f1d1acf049ef5486d8ad7e433762c23cfb946eb8d2bccc28",
                        "receiptContentId": "sha256:4915eb74796dabdb3784df4f6ccf06c7cbc24599560ff88f1c9e1673ba16004c"
                    },
                    "approval": {
                        "reviewId": "publish-review:55cb99708b008092cb1b8e9675468eb869016ad859cefb9397457e98c0d5cf08",
                        "artifactId": "artifact:e986d94e686a223f7c269d49d68188b45b8cba746f38f293189fa55803872e54",
                        "receiptId": "publish-review-decision-receipt:088b53b0a71ff278d4a5c5d349645f3c7d470f8c61f94151b3aa6ccb8cb8f1ee",
                        "receiptContentId": "sha256:85ad2898c419684dd4e49600b5ce8565e4c18bccc6e748e36fcd5e4ffe1205b3"
                    },
                    "caption": {
                        "jobId": "caption-production:8632c0316e227114cb8eecc6f32c261800393099f491f0a30e3a6c583e87541d",
                        "artifactId": "artifact:ed7d787901b289b943809ac89c8cba823c63e09a19f4f1d4e7fe01661a997ba1",
                        "contentId": "sha256:f2690f4986365e18bb28bbafad81a84931f8155ee9d66060c39eba719382db01",
                        "receiptArtifactId": "artifact:68027e372b84749660fa0265ff2df40ed7e7ae191756baa09584a2469adaa614",
                        "receiptId": "caption-production-receipt:87aa6ac8e34b725ab1fc618e5b8b0392f6b7263a55731af07d61789d98399af8",
                        "receiptContentId": "sha256:d1dabde385d17b44c07c16ee65795004bbac94b1f12c387705718d19150f7d66"
                    },
                    "line": {
                        "lineId": "deterministic-current-run-line-001",
                        "startMs": 0,
                        "endMs": 7866,
                        "source": {
                            "language": "ko",
                            "state": "available",
                            "text": "테스트 구간 1",
                            "reasonCode": null
                        },
                        "target": {
                            "language": "en",
                            "state": "available",
                            "text": "Test interval 1",
                            "reasonCode": null
                        }
                    },
                    "contextLines": [
                        {
                            "lineId": "deterministic-current-run-line-001",
                            "startMs": 0,
                            "endMs": 7866,
                            "source": {
                                "language": "ko",
                                "state": "available",
                                "text": "테스트 구간 1",
                                "reasonCode": null
                            },
                            "target": {
                                "language": "en",
                                "state": "available",
                                "text": "Test interval 1",
                                "reasonCode": null
                            }
                        },
                        {
                            "lineId": "deterministic-current-run-line-002",
                            "startMs": 7866,
                            "endMs": 15733,
                            "source": {
                                "language": "ko",
                                "state": "available",
                                "text": "테스트 구간 2",
                                "reasonCode": null
                            },
                            "target": {
                                "language": "en",
                                "state": "available",
                                "text": "Test interval 2",
                                "reasonCode": null
                            }
                        },
                        {
                            "lineId": "deterministic-current-run-line-003",
                            "startMs": 15733,
                            "endMs": 23600,
                            "source": {
                                "language": "ko",
                                "state": "available",
                                "text": "테스트 구간 3",
                                "reasonCode": null
                            },
                            "target": {
                                "language": "en",
                                "state": "available",
                                "text": "Test interval 3",
                                "reasonCode": null
                            }
                        },
                        {
                            "lineId": "deterministic-current-run-line-004",
                            "startMs": 23600,
                            "endMs": 31466,
                            "source": {
                                "language": "ko",
                                "state": "available",
                                "text": "테스트 구간 4",
                                "reasonCode": null
                            },
                            "target": {
                                "language": "en",
                                "state": "available",
                                "text": "Test interval 4",
                                "reasonCode": null
                            }
                        },
                        {
                            "lineId": "deterministic-current-run-line-005",
                            "startMs": 31466,
                            "endMs": 39333,
                            "source": {
                                "language": "ko",
                                "state": "available",
                                "text": "테스트 구간 5",
                                "reasonCode": null
                            },
                            "target": {
                                "language": "en",
                                "state": "available",
                                "text": "Test interval 5",
                                "reasonCode": null
                            }
                        }
                    ],
                    "selection": {
                        "side": "source",
                        "unit": "unicode_code_point",
                        "start": 0,
                        "end": 2,
                        "text": "테스"
                    },
                    "inputContextLineage": {
                        "claimIds": [
                            "study-claim:3977e19bbd29ecf5b425b5c0958cd0f3ea7614a0bfcdb6e938bfa9254f7b1c9b"
                        ],
                        "citationIds": [
                            "operation:deterministic-semantic:62bb8ace860adca059ef2bb86bda8777810308770cc42721d8071e0187585c75"
                        ],
                        "semanticEvidenceArtifactIds": [
                            "artifact:ca8c5e65c4c4a15473d996c6c1a19fb640ea00a648d6e50148eac2ccdbf0887d"
                        ],
                        "semanticEvidenceReceiptIds": [
                            "receipt:b5bdb36f9077027dfa2ecb9958f383eb9c7a4c64ac9231ba36b375869a2f5e9d"
                        ]
                    }
                },
                "producer": {
                    "id": "studio.host-language-explanation",
                    "version": "1",
                    "policy": "verified_current_caption_private_apply_only",
                    "executor": {
                        "id": "studio.openai-language-explanation-generator",
                        "version": "1",
                        "classification": "real_model",
                        "executionScope": "current_run",
                        "model": "gpt-4o-mini",
                        "promptContractContentId": "sha256:fc0cd23ad7e8d54db7ca0a80f3ee838942d9b7ee007f1989c6b59840fae1c7ce",
                        "configurationContentId": "sha256:64abd6c225ca3fa315fc96c65b5f35fef2970fa44e94ba9d71c48d65ef0ca15b"
                    }
                },
                "limits": {
                    "maxContextLines": 5,
                    "maxRequestedFacets": 5,
                    "maxAttemptsPerRequest": 3,
                    "maxSelectionCodePoints": 256,
                    "maxCaptionTextBytes": 32768,
                    "maxFacetTextBytes": 8192,
                    "maxOutputBytes": 65536,
                    "maxProviderResponseBytes": 131072,
                    "maxArtifactBytes": 131072,
                    "maxCompletionTokens": 4000,
                    "maxWallMs": 60000
                },
                "execution": {
                    "providerResponseId": "resp_0e58f482a2c9aa07016a5d0be76e28819f872a418a1ec3ae1b",
                    "inputTokens": 990,
                    "outputTokens": 72
                },
                "result": {
                    "status": "completed",
                    "requestedFacetCount": 2,
                    "availableFacetCount": 2,
                    "withheldFacetCount": 0,
                    "unavailableFacetCount": 0,
                    "artifactId": "artifact:d80e892ca09bdd03fd17ac8bd74cd2c8e2585f659afe231180e793db98c2b037",
                    "contentId": "sha256:1e2ca3b092fc183deaf66bf26ac099a78119aaaa580f1a6aba3f0471ff210387",
                    "bytes": 7545,
                    "facets": [
                        {
                            "kind": "meaning",
                            "availability": "available",
                            "reasonCode": null
                        },
                        {
                            "kind": "word",
                            "availability": "available",
                            "reasonCode": null
                        }
                    ]
                },
                "nonClaims": [
                    "explanation_semantic_correctness_not_assessed",
                    "caption_context_not_explanation_evidence",
                    "publication_not_authorized",
                    "learner_selection_not_runtime_evidence"
                ]
            }
        }
    ]
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
