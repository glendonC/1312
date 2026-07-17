# U7 local separation runtime source

The runtime uses `speechbrain/sepformer-wsj02mix` at immutable Hugging Face revision
`3a2826343a10e2d2e8a75f79aeab5ff3a2473531`. Model weights are deliberately not stored in Git:
`masknet.ckpt` is about 108 MB and the complete isolated Python environment is about 735 MB.

The model card declares Apache-2.0 and identifies WSJ0-2Mix as the training domain. The model
repository does not contain a separate license file, so bootstrap requires an explicit
`--accept-model-card-license` acknowledgement. This acknowledgement does not expand media rights
or justify quality, semantic, English-domain-transfer, identity, or publication claims.

Executable files authenticated before HyperPyYAML is parsed:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `hyperparams.yaml` | 1,515 | `939c86a8d36c52ae148859de34a3e7b984f4b576213957bdba09462cc88168bf` |
| `encoder.ckpt` | 17,267 | `3139bb880b29ea77ae8a168b8f2ad6e8eb5c2c0904289676c223d0e93cd2a35d` |
| `decoder.ckpt` | 17,202 | `abea1a2d41151331b4c36071d1b3205aed940a189721f008b12a703e9c63e7e4` |
| `masknet.ckpt` | 113,108,458 | `57dd5f49bf21c5a2101bb4e46648d05d34d517a59e26f0b06646d0bebe8214c7` |

Qualified runtime: macOS arm64, Python 3.14, CPU only, SpeechBrain 1.1.0, Torch 2.11.0,
torchaudio 2.11.0. Production inference sets Hugging Face/Transformers offline flags and executes
under a macOS sandbox profile that denies network access. Missing or changed files fail closed.
