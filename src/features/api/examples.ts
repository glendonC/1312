// Captured verbatim from a live local runtime host.
// 2026-07-19 Option B continuous family (temp --runtime-root, run-005 preload,
// --executor deterministic, --caption-executor deterministic-test
// --allow-deterministic-caption-test-seam): source-sessions, plan, start, status,
// events (honest limit=2 truncated page from that journal), honest-empty
// audits/receipts/review/captions/language, publish-review intakes + decision 201,
// caption 201/results/QC list + standalone QC 409, and private-playback grant
// mint 201 + revoke 200 for the SAME grantId.
// Separate families kept as earlier Captured panels (not part of that journal):
// owned-media ingest (temp --owned-ingest-root without --source-directory),
// youtube registered (yt-dlp AUTHORIZE), publish-review revocation 201,
// default-host caption 409 (recorded executor), and language 201
// (--language-explanation-executor openai --allow-real-language-explanation
// --language-explanation-model gpt-4o-mini after a prior caption seam).
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
    "acceptedAt": "2026-07-19T17:34:54.886Z",
    "lastTransitionAt": "2026-07-19T17:34:54.912Z",
    "reason": null,
    "sourceSessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
    "sourceRevisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
    "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
    "forecast": {
        "forecastId": "forecast:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "contentId": "sha256:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "frozenForecastId": "forecast-freeze:ba62c3ef0e235e45e9a7af981729e42935938e514efa9b78978160a7a6bf49f2",
        "baselineStatus": "floor_only"
    },
    "runStartReceipt": {
        "contentId": "sha256:286d60e3925dab156f2e734c1eccee6ce1afdbc0c6cd4599f6aa7daf2d7e1a45",
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
                "freezeId": "forecast-freeze:ba62c3ef0e235e45e9a7af981729e42935938e514efa9b78978160a7a6bf49f2",
                "content": {
                    "algorithm": "sha256",
                    "digest": "ba62c3ef0e235e45e9a7af981729e42935938e514efa9b78978160a7a6bf49f2",
                    "contentId": "sha256:ba62c3ef0e235e45e9a7af981729e42935938e514efa9b78978160a7a6bf49f2",
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
                    "runStartAt": "2026-07-19T17:34:54.886Z"
                },
                "immutability": {
                    "forecast": "referenced_by_content_id",
                    "actuals": "not_embedded",
                    "evaluation": "separate_artifact"
                }
            },
            "startedAt": "2026-07-19T17:34:54.886Z"
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
    "acceptedAt": "2026-07-19T17:34:54.886Z",
    "lastTransitionAt": "2026-07-19T17:34:55.334Z",
    "reason": null,
    "sourceSessionId": "source-session:50e48113837e62499233f29f53ab91f5ed591d39bda98879effb02364e2a03a2",
    "sourceRevisionId": "source-revision:6800f536f61f5d73dc474443cf0469c823ae94a984a209192940fc28b94afa09",
    "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
    "forecast": {
        "forecastId": "forecast:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "contentId": "sha256:93afa3f4de14110d351f40e0108f41eacd62b3afb9adc6a7b327addee002fd09",
        "frozenForecastId": "forecast-freeze:ba62c3ef0e235e45e9a7af981729e42935938e514efa9b78978160a7a6bf49f2",
        "baselineStatus": "floor_only"
    },
    "runStartReceipt": {
        "contentId": "sha256:286d60e3925dab156f2e734c1eccee6ce1afdbc0c6cd4599f6aa7daf2d7e1a45",
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
                "freezeId": "forecast-freeze:ba62c3ef0e235e45e9a7af981729e42935938e514efa9b78978160a7a6bf49f2",
                "content": {
                    "algorithm": "sha256",
                    "digest": "ba62c3ef0e235e45e9a7af981729e42935938e514efa9b78978160a7a6bf49f2",
                    "contentId": "sha256:ba62c3ef0e235e45e9a7af981729e42935938e514efa9b78978160a7a6bf49f2",
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
                    "runStartAt": "2026-07-19T17:34:54.886Z"
                },
                "immutability": {
                    "forecast": "referenced_by_content_id",
                    "actuals": "not_embedded",
                    "evaluation": "separate_artifact"
                }
            },
            "startedAt": "2026-07-19T17:34:54.886Z"
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
    "journalHead": 76,
    "events": [
        {
            "schema": "studio.runtime.event.v1",
            "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
            "seq": 1,
            "eventId": "event:runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a:1",
            "recordedAt": "2026-07-19T17:34:54.923Z",
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
            "recordedAt": "2026-07-19T17:34:54.929Z",
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
    "grantId": "private-playback-grant:0e9a0834-f015-46b0-ae05-93fa90bfb552",
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
    "mediaPath": "/v1/private-source-media/private-playback-grant%3A0e9a0834-f015-46b0-ae05-93fa90bfb552/xr6AgAu9GibmNzP_HIja1P8p9475Gqw6ZPAdZ4l2Z_w",
    "issuedAt": "2026-07-19T17:35:07.401Z",
    "expiresAt": "2026-07-19T17:45:07.401Z"
}`;

export const PRIVATE_PLAYBACK_REVOKE_200 = `{
    "schema": "studio.private-playback-grant-revoked.v1",
    "grantId": "private-playback-grant:0e9a0834-f015-46b0-ae05-93fa90bfb552",
    "runtimeId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
    "state": "revoked",
    "revokedAt": "2026-07-19T17:35:07.403Z"
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
            "intakeId": "publish-review-intake:d8f36771fe30d61e378fbe67afa75b6780b8869b2004bc42831dc561beba69a2",
            "artifactId": "artifact:2c1e7488a5b5edcda2459cacd963fddbf78e4585eff8bb0313f986febc7aa01d",
            "receiptId": "publish-review-intake-receipt:4ef807398c8f53dc5b6678edafc2fdf98040b198ede06e478a746d06a7341e6d",
            "receiptContentId": "sha256:d9f80a2f3b2b6d4928aad9e7afd831c306e901359278462b1aea5f2e3edf4f84",
            "integrity": "stored_intake_and_verified_study_readiness",
            "producer": "host_publish_review_intake_v1",
            "readiness": {
                "artifactId": "artifact:6982a2f5fc6185e0794bb026a822e48020df548bb52c802850a149fa931139b5",
                "readinessId": "study-readiness-v4:83579e2238b386afed33434577c1d731f0501d862b280d93afaa393fd3faad9a",
                "receiptContentId": "sha256:ee0ed2eb4ca439f837ab1dfbc88d54075fff95d58d39e02ab63e4480d42dbacd",
                "receiptId": "study-readiness-receipt-v4:1edc8846d8e086110bb28f0b2bfb22b3a2f54191e3cba7a25f1ae98cd5bdeea8"
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
            "reviewId": "publish-review:19adbd8e569a53432830eeaa486a1e36bc9319e208851bca1234564c55e6956e",
            "artifactId": "artifact:83938d4759c1b26a818cb5391202842229d466517f26b43e5d5087d6f0c49b21",
            "receiptId": "publish-review-decision-receipt:538ba71d19c1a12dcf25f8bb46a04c119142e57c96c9773d3f91f823a9f3cb7a",
            "receiptContentId": "sha256:0b69e0bade67cfd0b1f6c2d43ae000276fe2e48d980087ddeaecfece107129a3",
            "integrity": "stored_review_and_verified_queued_intake",
            "producer": "host_publish_review_v1",
            "intake": {
                "artifactId": "artifact:2c1e7488a5b5edcda2459cacd963fddbf78e4585eff8bb0313f986febc7aa01d",
                "intakeId": "publish-review-intake:d8f36771fe30d61e378fbe67afa75b6780b8869b2004bc42831dc561beba69a2",
                "receiptContentId": "sha256:d9f80a2f3b2b6d4928aad9e7afd831c306e901359278462b1aea5f2e3edf4f84",
                "receiptId": "publish-review-intake-receipt:4ef807398c8f53dc5b6678edafc2fdf98040b198ede06e478a746d06a7341e6d"
            },
            "readiness": {
                "artifactId": "artifact:6982a2f5fc6185e0794bb026a822e48020df548bb52c802850a149fa931139b5",
                "readinessId": "study-readiness-v4:83579e2238b386afed33434577c1d731f0501d862b280d93afaa393fd3faad9a",
                "receiptContentId": "sha256:ee0ed2eb4ca439f837ab1dfbc88d54075fff95d58d39e02ab63e4480d42dbacd",
                "receiptId": "study-readiness-receipt-v4:1edc8846d8e086110bb28f0b2bfb22b3a2f54191e3cba7a25f1ae98cd5bdeea8"
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
            "jobId": "caption-production:278a43dfbc1ba6357e093189be709656e9480ef7f642b9411646adfdb0071ef6",
            "approval": {
                "reviewId": "publish-review:19adbd8e569a53432830eeaa486a1e36bc9319e208851bca1234564c55e6956e",
                "artifactId": "artifact:83938d4759c1b26a818cb5391202842229d466517f26b43e5d5087d6f0c49b21",
                "receiptId": "publish-review-decision-receipt:538ba71d19c1a12dcf25f8bb46a04c119142e57c96c9773d3f91f823a9f3cb7a",
                "receiptContentId": "sha256:0b69e0bade67cfd0b1f6c2d43ae000276fe2e48d980087ddeaecfece107129a3"
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
                "studyId": "owned-media-study-v3:74b8cfead67ea945140531cbaf90010e79aefa23e30b5afb37e6a2fbeca3939d",
                "artifactId": "artifact:cf05a1e47759b57d09a067afb50a90c7f20d6811c7bc4788079599c175088e0e",
                "contentId": "sha256:9c7b96089590738d6935b3169ac713fba987d20acf8ce07867f57b7352d586eb",
                "executorReceiptId": "owned-media-study-executor-receipt-v3:f7463a8bc0eb6e6f4c654a1a0c4b00656f05ffd86f0b3b1ce48847c333b851d7",
                "executorReceiptContentId": "sha256:591555491ab338b4abb03bd5bbf343337d6491f3bcc425d6a9cadb8ef1e60b4b"
            },
            "readiness": {
                "artifactId": "artifact:6982a2f5fc6185e0794bb026a822e48020df548bb52c802850a149fa931139b5",
                "readinessId": "study-readiness-v4:83579e2238b386afed33434577c1d731f0501d862b280d93afaa393fd3faad9a",
                "receiptContentId": "sha256:ee0ed2eb4ca439f837ab1dfbc88d54075fff95d58d39e02ab63e4480d42dbacd",
                "receiptId": "study-readiness-receipt-v4:1edc8846d8e086110bb28f0b2bfb22b3a2f54191e3cba7a25f1ae98cd5bdeea8"
            },
            "reopened": {
                "sourceArtifactIds": [
                    "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70"
                ],
                "semanticEvidenceArtifactIds": [
                    "artifact:67f9f08aef916147aab4d0c27cba79e34fb48fc7071974cc0823fe8747bae9ae",
                    "artifact:6c4778d69e905d50fc438b9a45e510c1c236c610a128bd210f5db55d1f3c7536"
                ],
                "reportArtifactIds": [
                    "artifact:b3cd7a67b0f789ade93776d95908210152c0ecb3963f153c1dd8d23ff92c2d5f",
                    "artifact:ca9902a80765024f6f35e0f9ed397bb83990a4ab0132e471477bfee70b63b3b0"
                ],
                "admissionIds": [
                    "parent-admission:839f19ded5da998ad0022ddf0942e26a4f31f4a3b2c3565226984eec65767439",
                    "parent-admission:f6f2204f8ef9fbbc71ea98ed58746fb65d010a336e67e86ec7d7874571841582"
                ],
                "planningDecisionIds": [],
                "executorIds": [
                    "execution:deterministic-root:7b34856631df43fff3592666e29c13a797c6136e0e4b6bc95131fadc2aecdc98"
                ]
            },
            "authorityState": "unrevoked",
            "integrity": "stored_caption_and_receipt_with_verified_study_readiness_approval",
            "captionArtifactId": "artifact:a87ffabb03c94f62762cee20d5b18e19f9fc5f32af39c57c5e17a816d57a32a7",
            "captionContentId": "sha256:0e27beec77fd1b60edcaee2e4fbf6a05e8018b31b058b663a212d45911c6cba8",
            "receiptArtifactId": "artifact:d10c1f7ca17e4b21519d1fab19e0857cb76b308e7d785f00c9d4864f06dded30",
            "receiptId": "caption-production-receipt:a1a00adb31a15e20296758888f4f612bf8085e1058bf05dc7b6f7e0ee0a99539",
            "receiptContentId": "sha256:6f9d53f6498439471c243f7433afde7791629819d51d2c31c5745fb753a67e8a",
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
                "jobId": "caption-production:278a43dfbc1ba6357e093189be709656e9480ef7f642b9411646adfdb0071ef6",
                "approval": {
                    "reviewId": "publish-review:19adbd8e569a53432830eeaa486a1e36bc9319e208851bca1234564c55e6956e",
                    "artifactId": "artifact:83938d4759c1b26a818cb5391202842229d466517f26b43e5d5087d6f0c49b21",
                    "receiptId": "publish-review-decision-receipt:538ba71d19c1a12dcf25f8bb46a04c119142e57c96c9773d3f91f823a9f3cb7a",
                    "receiptContentId": "sha256:0b69e0bade67cfd0b1f6c2d43ae000276fe2e48d980087ddeaecfece107129a3"
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
                    "studyId": "owned-media-study-v3:74b8cfead67ea945140531cbaf90010e79aefa23e30b5afb37e6a2fbeca3939d",
                    "artifactId": "artifact:cf05a1e47759b57d09a067afb50a90c7f20d6811c7bc4788079599c175088e0e",
                    "contentId": "sha256:9c7b96089590738d6935b3169ac713fba987d20acf8ce07867f57b7352d586eb",
                    "executorReceiptId": "owned-media-study-executor-receipt-v3:f7463a8bc0eb6e6f4c654a1a0c4b00656f05ffd86f0b3b1ce48847c333b851d7",
                    "executorReceiptContentId": "sha256:591555491ab338b4abb03bd5bbf343337d6491f3bcc425d6a9cadb8ef1e60b4b"
                },
                "readiness": {
                    "artifactId": "artifact:6982a2f5fc6185e0794bb026a822e48020df548bb52c802850a149fa931139b5",
                    "readinessId": "study-readiness-v4:83579e2238b386afed33434577c1d731f0501d862b280d93afaa393fd3faad9a",
                    "receiptContentId": "sha256:ee0ed2eb4ca439f837ab1dfbc88d54075fff95d58d39e02ab63e4480d42dbacd",
                    "receiptId": "study-readiness-receipt-v4:1edc8846d8e086110bb28f0b2bfb22b3a2f54191e3cba7a25f1ae98cd5bdeea8"
                },
                "reopened": {
                    "sourceArtifactIds": [
                        "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70"
                    ],
                    "semanticEvidenceArtifactIds": [
                        "artifact:67f9f08aef916147aab4d0c27cba79e34fb48fc7071974cc0823fe8747bae9ae",
                        "artifact:6c4778d69e905d50fc438b9a45e510c1c236c610a128bd210f5db55d1f3c7536"
                    ],
                    "reportArtifactIds": [
                        "artifact:b3cd7a67b0f789ade93776d95908210152c0ecb3963f153c1dd8d23ff92c2d5f",
                        "artifact:ca9902a80765024f6f35e0f9ed397bb83990a4ab0132e471477bfee70b63b3b0"
                    ],
                    "admissionIds": [
                        "parent-admission:839f19ded5da998ad0022ddf0942e26a4f31f4a3b2c3565226984eec65767439",
                        "parent-admission:f6f2204f8ef9fbbc71ea98ed58746fb65d010a336e67e86ec7d7874571841582"
                    ],
                    "planningDecisionIds": [],
                    "executorIds": [
                        "execution:deterministic-root:7b34856631df43fff3592666e29c13a797c6136e0e4b6bc95131fadc2aecdc98"
                    ]
                },
                "authorityState": "unrevoked",
                "integrity": "stored_caption_and_receipt_with_verified_study_readiness_approval",
                "captionArtifactId": "artifact:a87ffabb03c94f62762cee20d5b18e19f9fc5f32af39c57c5e17a816d57a32a7",
                "captionContentId": "sha256:0e27beec77fd1b60edcaee2e4fbf6a05e8018b31b058b663a212d45911c6cba8",
                "receiptArtifactId": "artifact:d10c1f7ca17e4b21519d1fab19e0857cb76b308e7d785f00c9d4864f06dded30",
                "receiptId": "caption-production-receipt:a1a00adb31a15e20296758888f4f612bf8085e1058bf05dc7b6f7e0ee0a99539",
                "receiptContentId": "sha256:6f9d53f6498439471c243f7433afde7791629819d51d2c31c5745fb753a67e8a",
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
                "jobId": "caption-production:278a43dfbc1ba6357e093189be709656e9480ef7f642b9411646adfdb0071ef6",
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
                        "studyId": "owned-media-study-v3:74b8cfead67ea945140531cbaf90010e79aefa23e30b5afb37e6a2fbeca3939d",
                        "artifactId": "artifact:cf05a1e47759b57d09a067afb50a90c7f20d6811c7bc4788079599c175088e0e",
                        "contentId": "sha256:9c7b96089590738d6935b3169ac713fba987d20acf8ce07867f57b7352d586eb",
                        "executorReceiptId": "owned-media-study-executor-receipt-v3:f7463a8bc0eb6e6f4c654a1a0c4b00656f05ffd86f0b3b1ce48847c333b851d7",
                        "executorReceiptContentId": "sha256:591555491ab338b4abb03bd5bbf343337d6491f3bcc425d6a9cadb8ef1e60b4b"
                    },
                    "readiness": {
                        "readinessId": "study-readiness-v4:83579e2238b386afed33434577c1d731f0501d862b280d93afaa393fd3faad9a",
                        "artifactId": "artifact:6982a2f5fc6185e0794bb026a822e48020df548bb52c802850a149fa931139b5",
                        "receiptId": "study-readiness-receipt-v4:1edc8846d8e086110bb28f0b2bfb22b3a2f54191e3cba7a25f1ae98cd5bdeea8",
                        "receiptContentId": "sha256:ee0ed2eb4ca439f837ab1dfbc88d54075fff95d58d39e02ab63e4480d42dbacd"
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
                        "studyId": "owned-media-study-v3:74b8cfead67ea945140531cbaf90010e79aefa23e30b5afb37e6a2fbeca3939d",
                        "artifactId": "artifact:cf05a1e47759b57d09a067afb50a90c7f20d6811c7bc4788079599c175088e0e",
                        "contentId": "sha256:9c7b96089590738d6935b3169ac713fba987d20acf8ce07867f57b7352d586eb",
                        "executorReceiptId": "owned-media-study-executor-receipt-v3:f7463a8bc0eb6e6f4c654a1a0c4b00656f05ffd86f0b3b1ce48847c333b851d7",
                        "executorReceiptContentId": "sha256:591555491ab338b4abb03bd5bbf343337d6491f3bcc425d6a9cadb8ef1e60b4b"
                    },
                    "readiness": {
                        "readinessId": "study-readiness-v4:83579e2238b386afed33434577c1d731f0501d862b280d93afaa393fd3faad9a",
                        "artifactId": "artifact:6982a2f5fc6185e0794bb026a822e48020df548bb52c802850a149fa931139b5",
                        "receiptId": "study-readiness-receipt-v4:1edc8846d8e086110bb28f0b2bfb22b3a2f54191e3cba7a25f1ae98cd5bdeea8",
                        "receiptContentId": "sha256:ee0ed2eb4ca439f837ab1dfbc88d54075fff95d58d39e02ab63e4480d42dbacd"
                    },
                    "approval": {
                        "reviewId": "publish-review:19adbd8e569a53432830eeaa486a1e36bc9319e208851bca1234564c55e6956e",
                        "artifactId": "artifact:83938d4759c1b26a818cb5391202842229d466517f26b43e5d5087d6f0c49b21",
                        "receiptId": "publish-review-decision-receipt:538ba71d19c1a12dcf25f8bb46a04c119142e57c96c9773d3f91f823a9f3cb7a",
                        "receiptContentId": "sha256:0b69e0bade67cfd0b1f6c2d43ae000276fe2e48d980087ddeaecfece107129a3"
                    },
                    "captionExecutor": {
                        "jobId": "caption-production:278a43dfbc1ba6357e093189be709656e9480ef7f642b9411646adfdb0071ef6",
                        "id": "studio.deterministic-current-run-caption-test-seam",
                        "version": "1",
                        "executionScope": "current_run",
                        "cognitionClaim": "none"
                    },
                    "generalizedCausality": {
                        "schema": "studio.caption-line-causality.v4",
                        "study": {
                            "studyId": "owned-media-study-v3:74b8cfead67ea945140531cbaf90010e79aefa23e30b5afb37e6a2fbeca3939d",
                            "artifactId": "artifact:cf05a1e47759b57d09a067afb50a90c7f20d6811c7bc4788079599c175088e0e",
                            "contentId": "sha256:9c7b96089590738d6935b3169ac713fba987d20acf8ce07867f57b7352d586eb",
                            "bytes": 9180,
                            "schema": "studio.owned-media-study.v3"
                        },
                        "readiness": {
                            "readinessId": "study-readiness-v4:83579e2238b386afed33434577c1d731f0501d862b280d93afaa393fd3faad9a",
                            "receiptId": "study-readiness-receipt-v4:1edc8846d8e086110bb28f0b2bfb22b3a2f54191e3cba7a25f1ae98cd5bdeea8",
                            "receiptContentId": "sha256:ee0ed2eb4ca439f837ab1dfbc88d54075fff95d58d39e02ab63e4480d42dbacd"
                        }
                    },
                    "evidence": {
                        "semanticCitations": [
                            {
                                "operationId": "operation:deterministic-semantic:1b4d904d61a1686a8ca67af80d917b22c8cf7a81f1d4e4a3009c5a7b9762e44c",
                                "artifactId": "artifact:67f9f08aef916147aab4d0c27cba79e34fb48fc7071974cc0823fe8747bae9ae",
                                "contentId": "sha256:e0dd25f51cf7606a07fa9e7dab603d44616e38eb1a83b16ae371cfe54a8dbf87",
                                "receiptId": "receipt:2e24aa05aa31babced8fe371d520baa98a680881c5020eb0f295d214f43fff4d",
                                "receiptContentId": "sha256:68b232072b3123e3724711e1eb48093df93412a896d70a335ab3671375e71bca",
                                "observations": [
                                    {
                                        "observationId": "observation:b07a4d989d03e7ba74cbd322430d527abf3b6d5afc96bc5af1e08361f0463285",
                                        "startMs": 0,
                                        "endMs": 23600
                                    }
                                ]
                            },
                            {
                                "operationId": "operation:deterministic-semantic:c0f615164cf0cb8b9dce42b71644eac5c58c2c8bf71bbb61c31de59e8b9bafa2",
                                "artifactId": "artifact:6c4778d69e905d50fc438b9a45e510c1c236c610a128bd210f5db55d1f3c7536",
                                "contentId": "sha256:dc8d11e9645fa626c47e4c38f32bdf4491debc223ce55207e0f5135b096ddba7",
                                "receiptId": "receipt:948804fef07f33542e8319fd965bcf25d81b1e6f7f156cc596f5e145daaccd16",
                                "receiptContentId": "sha256:60be392e206d751a20b65935e6d85549cf4690e88f941f91600de5e537487441",
                                "observations": [
                                    {
                                        "observationId": "observation:37da1ef4537f9acb67c66db2d523e298691d9de6a9be072507055dc64f816eda",
                                        "startMs": 23600,
                                        "endMs": 47200
                                    }
                                ]
                            }
                        ],
                        "childReports": [
                            {
                                "reportId": "report:d1f9a336-fc58-4140-93b1-8286d2d64a70",
                                "childTaskId": "task:7a4b5a93-f3cd-4eb8-b75a-bf56c7e922a1",
                                "childAgentId": "agent:8a86b65d-1b9b-4b02-89e6-12d7f0286c46",
                                "artifactId": "artifact:b3cd7a67b0f789ade93776d95908210152c0ecb3963f153c1dd8d23ff92c2d5f",
                                "contentId": "sha256:f3dc28ebed5b581d5472d244cc49505869024a81c903789254930fd92c88c28a",
                                "dispositionId": "parent-admission:839f19ded5da998ad0022ddf0942e26a4f31f4a3b2c3565226984eec65767439",
                                "dispositionReceiptId": "parent-admission-receipt:7be2e7d64f596a212558e6178e36d18e6afb20cb99e6727086beba685368549f",
                                "dispositionReceiptContentId": "sha256:993548f8960f25f52056031d783870f61c42670bffa3fff170929ad009506327",
                                "admissionId": "parent-admission:839f19ded5da998ad0022ddf0942e26a4f31f4a3b2c3565226984eec65767439",
                                "admissionReceiptId": "parent-admission-receipt:7be2e7d64f596a212558e6178e36d18e6afb20cb99e6727086beba685368549f",
                                "admissionReceiptContentId": "sha256:993548f8960f25f52056031d783870f61c42670bffa3fff170929ad009506327",
                                "readOperationId": "operation:generalized-parent-artifact-read:2a9ed493e8c729203330c8d1b59a45e037ab74edf8f6faa3e3e46cda48f8e29c",
                                "readReceiptId": "parent-artifact-read-receipt:542d165d88760034431d72604b5bf0ddd20b67b6d916edb09fa6a829d46c9120"
                            },
                            {
                                "reportId": "report:17e382b6-c449-46c7-8b36-2074fd8667f9",
                                "childTaskId": "task:780b56a5-8e37-48d5-b416-fa10a29ad1b9",
                                "childAgentId": "agent:43dcf291-1c0f-4892-9b57-2385546e82a7",
                                "artifactId": "artifact:ca9902a80765024f6f35e0f9ed397bb83990a4ab0132e471477bfee70b63b3b0",
                                "contentId": "sha256:0ff43c7149620a2c043e142243d73315e643734ec54d26fd2f4b6a97769eb46f",
                                "dispositionId": "parent-admission:f6f2204f8ef9fbbc71ea98ed58746fb65d010a336e67e86ec7d7874571841582",
                                "dispositionReceiptId": "parent-admission-receipt:7d7c732d9b41de9c84a6b42aee9b126be82c6a7bcfdcb92c5946334009b172ce",
                                "dispositionReceiptContentId": "sha256:4163e1a1583a144eb34cf7a1abf28ffb25f9d31b383af0b2715435dcaba9d613",
                                "admissionId": "parent-admission:f6f2204f8ef9fbbc71ea98ed58746fb65d010a336e67e86ec7d7874571841582",
                                "admissionReceiptId": "parent-admission-receipt:7d7c732d9b41de9c84a6b42aee9b126be82c6a7bcfdcb92c5946334009b172ce",
                                "admissionReceiptContentId": "sha256:4163e1a1583a144eb34cf7a1abf28ffb25f9d31b383af0b2715435dcaba9d613",
                                "readOperationId": "operation:generalized-parent-artifact-read:34c94b28ae7aa10b4b29289d7ff9d62b019a29707fa57f4eb4feac0093e2cf03",
                                "readReceiptId": "parent-artifact-read-receipt:274b11cd235781a04c54c567c27ab3a47faa5e637e811d34ba272f99dc9f4896"
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
                                    "coverageId": "study-coverage-v3:2517494a445a0da6ddf69ae5d1f3f1d44dc78046c5ebff9c3827e06e82ba7052",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:ee27ac8d0f758cf6b1395b3230694702f084b611555be56d8710c28e7237b602"
                                ],
                                "semanticCitationIndexes": [
                                    0
                                ],
                                "childReportIndexes": [
                                    0
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:2517494a445a0da6ddf69ae5d1f3f1d44dc78046c5ebff9c3827e06e82ba7052",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:ee27ac8d0f758cf6b1395b3230694702f084b611555be56d8710c28e7237b602"
                                ],
                                "citationIds": [
                                    "evidence-citation:8822f5ede5817a2cf439ea54187f6f38e5a6abd5e3b6dae57dc6d7771a64d6b9"
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
                                    "coverageId": "study-coverage-v3:2517494a445a0da6ddf69ae5d1f3f1d44dc78046c5ebff9c3827e06e82ba7052",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:ee27ac8d0f758cf6b1395b3230694702f084b611555be56d8710c28e7237b602"
                                ],
                                "semanticCitationIndexes": [
                                    0
                                ],
                                "childReportIndexes": [
                                    0
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:2517494a445a0da6ddf69ae5d1f3f1d44dc78046c5ebff9c3827e06e82ba7052",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:ee27ac8d0f758cf6b1395b3230694702f084b611555be56d8710c28e7237b602"
                                ],
                                "citationIds": [
                                    "evidence-citation:8822f5ede5817a2cf439ea54187f6f38e5a6abd5e3b6dae57dc6d7771a64d6b9"
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
                                    "coverageId": "study-coverage-v3:2517494a445a0da6ddf69ae5d1f3f1d44dc78046c5ebff9c3827e06e82ba7052",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:ee27ac8d0f758cf6b1395b3230694702f084b611555be56d8710c28e7237b602"
                                ],
                                "semanticCitationIndexes": [
                                    0
                                ],
                                "childReportIndexes": [
                                    0
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:2517494a445a0da6ddf69ae5d1f3f1d44dc78046c5ebff9c3827e06e82ba7052",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:ee27ac8d0f758cf6b1395b3230694702f084b611555be56d8710c28e7237b602"
                                ],
                                "citationIds": [
                                    "evidence-citation:8822f5ede5817a2cf439ea54187f6f38e5a6abd5e3b6dae57dc6d7771a64d6b9"
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
                                    "coverageId": "study-coverage-v3:f2e69f13ecf7a25d5913acc9aea58aebd99943a0f3af5fe02596aa8c14f5c86b",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:3f53380d93fe21780f52ef15ba8e1f509a6a370132f22f64787d4d72df42014d"
                                ],
                                "semanticCitationIndexes": [
                                    1
                                ],
                                "childReportIndexes": [
                                    1
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:f2e69f13ecf7a25d5913acc9aea58aebd99943a0f3af5fe02596aa8c14f5c86b",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:3f53380d93fe21780f52ef15ba8e1f509a6a370132f22f64787d4d72df42014d"
                                ],
                                "citationIds": [
                                    "evidence-citation:af47df1d36105068cc16f207f83173236329043587bef4e73cf80bb513ec5c6a"
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
                                    "coverageId": "study-coverage-v3:f2e69f13ecf7a25d5913acc9aea58aebd99943a0f3af5fe02596aa8c14f5c86b",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:3f53380d93fe21780f52ef15ba8e1f509a6a370132f22f64787d4d72df42014d"
                                ],
                                "semanticCitationIndexes": [
                                    1
                                ],
                                "childReportIndexes": [
                                    1
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:f2e69f13ecf7a25d5913acc9aea58aebd99943a0f3af5fe02596aa8c14f5c86b",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:3f53380d93fe21780f52ef15ba8e1f509a6a370132f22f64787d4d72df42014d"
                                ],
                                "citationIds": [
                                    "evidence-citation:af47df1d36105068cc16f207f83173236329043587bef4e73cf80bb513ec5c6a"
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
                                    "coverageId": "study-coverage-v3:f2e69f13ecf7a25d5913acc9aea58aebd99943a0f3af5fe02596aa8c14f5c86b",
                                    "state": "supported",
                                    "reasonCode": null
                                },
                                "claimIds": [
                                    "study-claim:3f53380d93fe21780f52ef15ba8e1f509a6a370132f22f64787d4d72df42014d"
                                ],
                                "semanticCitationIndexes": [
                                    1
                                ],
                                "childReportIndexes": [
                                    1
                                ]
                            },
                            "generalizedCausality": {
                                "trackId": "stream:0",
                                "coverageId": "study-coverage-v3:f2e69f13ecf7a25d5913acc9aea58aebd99943a0f3af5fe02596aa8c14f5c86b",
                                "coverageState": "supported",
                                "preservedStates": [
                                    "supported"
                                ],
                                "claimIds": [
                                    "study-claim:3f53380d93fe21780f52ef15ba8e1f509a6a370132f22f64787d4d72df42014d"
                                ],
                                "citationIds": [
                                    "evidence-citation:af47df1d36105068cc16f207f83173236329043587bef4e73cf80bb513ec5c6a"
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
            "qcId": "caption-quality-control:a593921b2994b97af289160bd34ef9b3358dff4d2304f36def33e882f1c0fc5d",
            "jobId": "caption-production:278a43dfbc1ba6357e093189be709656e9480ef7f642b9411646adfdb0071ef6",
            "captionArtifactId": "artifact:a87ffabb03c94f62762cee20d5b18e19f9fc5f32af39c57c5e17a816d57a32a7",
            "captionContentId": "sha256:0e27beec77fd1b60edcaee2e4fbf6a05e8018b31b058b663a212d45911c6cba8",
            "outputArtifactId": "artifact:09ac44abc028b24fcddb6cbf71defc7e282151954bd331051489590754bcc6d4",
            "receiptId": "caption-quality-control-receipt:42a0175822c69b4608fbd86db37fa7e90b2f807ed3fa322bd1841aae5400b18f",
            "receiptContentId": "sha256:0db6880b9176a933c259d4202c35a1545772e6922da553407ad9febf81dd9339",
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
                "jobId": "caption-production:278a43dfbc1ba6357e093189be709656e9480ef7f642b9411646adfdb0071ef6",
                "approval": {
                    "reviewId": "publish-review:19adbd8e569a53432830eeaa486a1e36bc9319e208851bca1234564c55e6956e",
                    "artifactId": "artifact:83938d4759c1b26a818cb5391202842229d466517f26b43e5d5087d6f0c49b21",
                    "receiptId": "publish-review-decision-receipt:538ba71d19c1a12dcf25f8bb46a04c119142e57c96c9773d3f91f823a9f3cb7a",
                    "receiptContentId": "sha256:0b69e0bade67cfd0b1f6c2d43ae000276fe2e48d980087ddeaecfece107129a3"
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
                    "studyId": "owned-media-study-v3:74b8cfead67ea945140531cbaf90010e79aefa23e30b5afb37e6a2fbeca3939d",
                    "artifactId": "artifact:cf05a1e47759b57d09a067afb50a90c7f20d6811c7bc4788079599c175088e0e",
                    "contentId": "sha256:9c7b96089590738d6935b3169ac713fba987d20acf8ce07867f57b7352d586eb",
                    "executorReceiptId": "owned-media-study-executor-receipt-v3:f7463a8bc0eb6e6f4c654a1a0c4b00656f05ffd86f0b3b1ce48847c333b851d7",
                    "executorReceiptContentId": "sha256:591555491ab338b4abb03bd5bbf343337d6491f3bcc425d6a9cadb8ef1e60b4b"
                },
                "readiness": {
                    "artifactId": "artifact:6982a2f5fc6185e0794bb026a822e48020df548bb52c802850a149fa931139b5",
                    "readinessId": "study-readiness-v4:83579e2238b386afed33434577c1d731f0501d862b280d93afaa393fd3faad9a",
                    "receiptContentId": "sha256:ee0ed2eb4ca439f837ab1dfbc88d54075fff95d58d39e02ab63e4480d42dbacd",
                    "receiptId": "study-readiness-receipt-v4:1edc8846d8e086110bb28f0b2bfb22b3a2f54191e3cba7a25f1ae98cd5bdeea8"
                },
                "reopened": {
                    "sourceArtifactIds": [
                        "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70"
                    ],
                    "semanticEvidenceArtifactIds": [
                        "artifact:67f9f08aef916147aab4d0c27cba79e34fb48fc7071974cc0823fe8747bae9ae",
                        "artifact:6c4778d69e905d50fc438b9a45e510c1c236c610a128bd210f5db55d1f3c7536"
                    ],
                    "reportArtifactIds": [
                        "artifact:b3cd7a67b0f789ade93776d95908210152c0ecb3963f153c1dd8d23ff92c2d5f",
                        "artifact:ca9902a80765024f6f35e0f9ed397bb83990a4ab0132e471477bfee70b63b3b0"
                    ],
                    "admissionIds": [
                        "parent-admission:839f19ded5da998ad0022ddf0942e26a4f31f4a3b2c3565226984eec65767439",
                        "parent-admission:f6f2204f8ef9fbbc71ea98ed58746fb65d010a336e67e86ec7d7874571841582"
                    ],
                    "planningDecisionIds": [],
                    "executorIds": [
                        "execution:deterministic-root:7b34856631df43fff3592666e29c13a797c6136e0e4b6bc95131fadc2aecdc98"
                    ]
                },
                "authorityState": "unrevoked",
                "integrity": "stored_caption_and_receipt_with_verified_study_readiness_approval",
                "captionArtifactId": "artifact:a87ffabb03c94f62762cee20d5b18e19f9fc5f32af39c57c5e17a816d57a32a7",
                "captionContentId": "sha256:0e27beec77fd1b60edcaee2e4fbf6a05e8018b31b058b663a212d45911c6cba8",
                "receiptArtifactId": "artifact:d10c1f7ca17e4b21519d1fab19e0857cb76b308e7d785f00c9d4864f06dded30",
                "receiptId": "caption-production-receipt:a1a00adb31a15e20296758888f4f612bf8085e1058bf05dc7b6f7e0ee0a99539",
                "receiptContentId": "sha256:6f9d53f6498439471c243f7433afde7791629819d51d2c31c5745fb753a67e8a",
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
            "jobId": "language-explanation:e894542fe368742c8a729fa4dc8989889b531398ff8662b205c60bc5d1e49e89",
            "attempt": 0,
            "caption": {
                "jobId": "caption-production:f64f8415a4223364b11b024c41f65425b98f707f6ec760c338f43888a7e13049",
                "artifactId": "artifact:0fa7219f41e248d8fe9f429993c2c6624ce2df3509202660a88441f092c0f5ce",
                "contentId": "sha256:7ec6826cd3119981fa97adeffda0c3c48acec22c76cf0aded5cfb4b1f4ff600e",
                "receiptArtifactId": "artifact:5faf42ea281f71e6e8bc26e53f38f58be08766af55338ebb6a6815ecc9b8537b",
                "receiptId": "caption-production-receipt:2148790b3453c6f684cb30c7eaa33ac357f7a925088e2247f59ff27ee13b7458",
                "receiptContentId": "sha256:3ee3d6ef242507082e0740eb99c756fe80454c5b703458aa4012df4280b1bef5"
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
                "jobId": "language-explanation:e894542fe368742c8a729fa4dc8989889b531398ff8662b205c60bc5d1e49e89",
                "artifactId": "artifact:9157950af0aa30cd6ed56ed0621b780dbeae57ca6cd1de542c13e1e5dd580b80",
                "contentId": "sha256:e90fd277076a73a8f0b96908f60c9b8073b70dba3472243c8ad375a846de69ea",
                "receiptArtifactId": "artifact:7f76bcdad18d0828540aa54f54930a40edff53ddde6bc29c470714d605e6b30d",
                "receiptId": "language-explanation-receipt:a2a2e2f036269d135c41d9e77580e91dd5252e2a64187a2b791348f8cba46851",
                "receiptContentId": "sha256:8706459e8a68544fa2ab98846369c5366fbf8c283abd2932c9e60cc71c2b55cd",
                "caption": {
                    "jobId": "caption-production:f64f8415a4223364b11b024c41f65425b98f707f6ec760c338f43888a7e13049",
                    "artifactId": "artifact:0fa7219f41e248d8fe9f429993c2c6624ce2df3509202660a88441f092c0f5ce",
                    "contentId": "sha256:7ec6826cd3119981fa97adeffda0c3c48acec22c76cf0aded5cfb4b1f4ff600e",
                    "receiptArtifactId": "artifact:5faf42ea281f71e6e8bc26e53f38f58be08766af55338ebb6a6815ecc9b8537b",
                    "receiptId": "caption-production-receipt:2148790b3453c6f684cb30c7eaa33ac357f7a925088e2247f59ff27ee13b7458",
                    "receiptContentId": "sha256:3ee3d6ef242507082e0740eb99c756fe80454c5b703458aa4012df4280b1bef5"
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
                "jobId": "language-explanation:e894542fe368742c8a729fa4dc8989889b531398ff8662b205c60bc5d1e49e89",
                "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
                "input": {
                    "source": {
                        "artifactId": "artifact:9f49fcb0eb07542cf19ca6e6e70d4d8aab491ff85abe2bd09658666ae5e4ae70",
                        "contentId": "sha256:e141cd9d0a693f70d7e069deb4bf2b300af64a1a89b0b8e806e7aae6be1c924e",
                        "analysisRequestId": "analysis-request:431b63bd657b18e37f3c36da8d512006338cfbe674bb77cb21e1818bbb982b83",
                        "rightsScope": "redistribution"
                    },
                    "study": {
                        "studyId": "owned-media-study-v3:5172dc00d86051b2d58d4ad2bcfd2e401b61f9f25d5c733ebb93d9a1d6a98e49",
                        "artifactId": "artifact:0d227e4250200a447b85520dae13c5055bbfaaf1a2ff9c0598b18539830c13fb",
                        "contentId": "sha256:9051e7a6ee522ebc6f3f9636a931aeef55d3e2f16d0a77f6f4a001b4ebd8d04b"
                    },
                    "readiness": {
                        "readinessId": "study-readiness-v4:5eb55d2602882b51c620cdb56fe0dc86c93d418b1cd718a342d84ee56f8ef5df",
                        "artifactId": "artifact:b5f908e32fb8a646f6f179808b7f508a5b313c50ccb441f89ec0602b2b106465",
                        "receiptId": "study-readiness-receipt-v4:823946fbce1137f4652e21a3f4ed34e0806fb395a6481041ff3ae8abf4abcd03",
                        "receiptContentId": "sha256:5d22c992ee96e65de8af89ea2acbb831989621e44739656505f0e366569f5597"
                    },
                    "approval": {
                        "reviewId": "publish-review:61affae4d1c3764f6c043ba849ee49129be0e9d486271f958ea75c72685c37bf",
                        "artifactId": "artifact:51b7bbdbb4ef4a4825cf6c9861adc74b73414cf9c3021b8845ffe30f34a6631c",
                        "receiptId": "publish-review-decision-receipt:6933698b1d1e0db821da55f4796d7bde2f600a89d7ab97144fc8cbf6e71e612b",
                        "receiptContentId": "sha256:3d096b840c33b972c7b3ad1868d2d1e5ca623ea1ef188ef4a665b89f634fc0cb"
                    },
                    "caption": {
                        "jobId": "caption-production:f64f8415a4223364b11b024c41f65425b98f707f6ec760c338f43888a7e13049",
                        "artifactId": "artifact:0fa7219f41e248d8fe9f429993c2c6624ce2df3509202660a88441f092c0f5ce",
                        "contentId": "sha256:7ec6826cd3119981fa97adeffda0c3c48acec22c76cf0aded5cfb4b1f4ff600e",
                        "receiptArtifactId": "artifact:5faf42ea281f71e6e8bc26e53f38f58be08766af55338ebb6a6815ecc9b8537b",
                        "receiptId": "caption-production-receipt:2148790b3453c6f684cb30c7eaa33ac357f7a925088e2247f59ff27ee13b7458",
                        "receiptContentId": "sha256:3ee3d6ef242507082e0740eb99c756fe80454c5b703458aa4012df4280b1bef5"
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
                            "study-claim:46d3880b49ed0f074c65dd4fdfcc50d2fab28fc2d27bca06f604a5bd05b4c8b3"
                        ],
                        "citationIds": [
                            "operation:deterministic-semantic:9f5c2c99508975683c9c8c2d0c187768d2c2f06efe0bd4314d9f834749585a0f"
                        ],
                        "semanticEvidenceArtifactIds": [
                            "artifact:bcf90efe1342211e569e172dd04534db4aa8f15ca867dccbd8f5f6d4a7b71b95"
                        ],
                        "semanticEvidenceReceiptIds": [
                            "receipt:c703fdfdd13c385366b4388119232d2bfae027f3c56404e2f005a9781fb65f75"
                        ]
                    }
                },
                "grant": {
                    "schema": "studio.language-explanation.grant.v1",
                    "grantId": "language-explanation-grant:e894542fe368742c8a729fa4dc8989889b531398ff8662b205c60bc5d1e49e89",
                    "attempt": 0,
                    "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
                    "requestFingerprint": "language-explanation-request:acb7d2036a1a27f525d7e79f0ecab9464644bce9b3cfeae542b1167372e852ef",
                    "caption": {
                        "jobId": "caption-production:f64f8415a4223364b11b024c41f65425b98f707f6ec760c338f43888a7e13049",
                        "artifactId": "artifact:0fa7219f41e248d8fe9f429993c2c6624ce2df3509202660a88441f092c0f5ce",
                        "contentId": "sha256:7ec6826cd3119981fa97adeffda0c3c48acec22c76cf0aded5cfb4b1f4ff600e",
                        "receiptArtifactId": "artifact:5faf42ea281f71e6e8bc26e53f38f58be08766af55338ebb6a6815ecc9b8537b",
                        "receiptId": "caption-production-receipt:2148790b3453c6f684cb30c7eaa33ac357f7a925088e2247f59ff27ee13b7458",
                        "receiptContentId": "sha256:3ee3d6ef242507082e0740eb99c756fe80454c5b703458aa4012df4280b1bef5"
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
                            "sceneMeaning": "The phrase refers to a specific segment or section designated for testing."
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
                            "sense": "part of '테스트' (test)",
                            "role": "root of the word '테스트' which means 'test'."
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
                "receiptId": "language-explanation-receipt:a2a2e2f036269d135c41d9e77580e91dd5252e2a64187a2b791348f8cba46851",
                "jobId": "language-explanation:e894542fe368742c8a729fa4dc8989889b531398ff8662b205c60bc5d1e49e89",
                "grant": {
                    "schema": "studio.language-explanation.grant.v1",
                    "grantId": "language-explanation-grant:e894542fe368742c8a729fa4dc8989889b531398ff8662b205c60bc5d1e49e89",
                    "attempt": 0,
                    "runId": "runtime:da4ff907-4240-42c7-8f14-deb6e2ce236a",
                    "requestFingerprint": "language-explanation-request:acb7d2036a1a27f525d7e79f0ecab9464644bce9b3cfeae542b1167372e852ef",
                    "caption": {
                        "jobId": "caption-production:f64f8415a4223364b11b024c41f65425b98f707f6ec760c338f43888a7e13049",
                        "artifactId": "artifact:0fa7219f41e248d8fe9f429993c2c6624ce2df3509202660a88441f092c0f5ce",
                        "contentId": "sha256:7ec6826cd3119981fa97adeffda0c3c48acec22c76cf0aded5cfb4b1f4ff600e",
                        "receiptArtifactId": "artifact:5faf42ea281f71e6e8bc26e53f38f58be08766af55338ebb6a6815ecc9b8537b",
                        "receiptId": "caption-production-receipt:2148790b3453c6f684cb30c7eaa33ac357f7a925088e2247f59ff27ee13b7458",
                        "receiptContentId": "sha256:3ee3d6ef242507082e0740eb99c756fe80454c5b703458aa4012df4280b1bef5"
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
                        "studyId": "owned-media-study-v3:5172dc00d86051b2d58d4ad2bcfd2e401b61f9f25d5c733ebb93d9a1d6a98e49",
                        "artifactId": "artifact:0d227e4250200a447b85520dae13c5055bbfaaf1a2ff9c0598b18539830c13fb",
                        "contentId": "sha256:9051e7a6ee522ebc6f3f9636a931aeef55d3e2f16d0a77f6f4a001b4ebd8d04b"
                    },
                    "readiness": {
                        "readinessId": "study-readiness-v4:5eb55d2602882b51c620cdb56fe0dc86c93d418b1cd718a342d84ee56f8ef5df",
                        "artifactId": "artifact:b5f908e32fb8a646f6f179808b7f508a5b313c50ccb441f89ec0602b2b106465",
                        "receiptId": "study-readiness-receipt-v4:823946fbce1137f4652e21a3f4ed34e0806fb395a6481041ff3ae8abf4abcd03",
                        "receiptContentId": "sha256:5d22c992ee96e65de8af89ea2acbb831989621e44739656505f0e366569f5597"
                    },
                    "approval": {
                        "reviewId": "publish-review:61affae4d1c3764f6c043ba849ee49129be0e9d486271f958ea75c72685c37bf",
                        "artifactId": "artifact:51b7bbdbb4ef4a4825cf6c9861adc74b73414cf9c3021b8845ffe30f34a6631c",
                        "receiptId": "publish-review-decision-receipt:6933698b1d1e0db821da55f4796d7bde2f600a89d7ab97144fc8cbf6e71e612b",
                        "receiptContentId": "sha256:3d096b840c33b972c7b3ad1868d2d1e5ca623ea1ef188ef4a665b89f634fc0cb"
                    },
                    "caption": {
                        "jobId": "caption-production:f64f8415a4223364b11b024c41f65425b98f707f6ec760c338f43888a7e13049",
                        "artifactId": "artifact:0fa7219f41e248d8fe9f429993c2c6624ce2df3509202660a88441f092c0f5ce",
                        "contentId": "sha256:7ec6826cd3119981fa97adeffda0c3c48acec22c76cf0aded5cfb4b1f4ff600e",
                        "receiptArtifactId": "artifact:5faf42ea281f71e6e8bc26e53f38f58be08766af55338ebb6a6815ecc9b8537b",
                        "receiptId": "caption-production-receipt:2148790b3453c6f684cb30c7eaa33ac357f7a925088e2247f59ff27ee13b7458",
                        "receiptContentId": "sha256:3ee3d6ef242507082e0740eb99c756fe80454c5b703458aa4012df4280b1bef5"
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
                            "study-claim:46d3880b49ed0f074c65dd4fdfcc50d2fab28fc2d27bca06f604a5bd05b4c8b3"
                        ],
                        "citationIds": [
                            "operation:deterministic-semantic:9f5c2c99508975683c9c8c2d0c187768d2c2f06efe0bd4314d9f834749585a0f"
                        ],
                        "semanticEvidenceArtifactIds": [
                            "artifact:bcf90efe1342211e569e172dd04534db4aa8f15ca867dccbd8f5f6d4a7b71b95"
                        ],
                        "semanticEvidenceReceiptIds": [
                            "receipt:c703fdfdd13c385366b4388119232d2bfae027f3c56404e2f005a9781fb65f75"
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
                    "providerResponseId": "resp_065309c6e931f7be016a5d07c7aeb48192ad076ced3cfe8d45",
                    "inputTokens": 990,
                    "outputTokens": 89
                },
                "result": {
                    "status": "completed",
                    "requestedFacetCount": 2,
                    "availableFacetCount": 2,
                    "withheldFacetCount": 0,
                    "unavailableFacetCount": 0,
                    "artifactId": "artifact:9157950af0aa30cd6ed56ed0621b780dbeae57ca6cd1de542c13e1e5dd580b80",
                    "contentId": "sha256:e90fd277076a73a8f0b96908f60c9b8073b70dba3472243c8ad375a846de69ea",
                    "bytes": 7580,
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
