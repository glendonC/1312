# Pinned offline anonymous-speaker producer assets

These files are private local-runtime inputs. They are not downloaded at runtime.

## Runtime

- Package: `sherpa-onnx-node` 1.13.4 from npm, with `sherpa-onnx-darwin-arm64` 1.13.4
- Repository: <https://github.com/k2-fsa/sherpa-onnx>
- npm package git revision: `142807252687d81b40d6315f23470a1512a00de3`
- wrapper npm integrity: `sha512-jHWWdY9f0dbvJpdsfR/C4WNhM57+jT9Os2RyC4/qUz8HKCtj2VYFmJ9s7tue9OCFRAmdoGBkgkqD6aBZ3I8BKw==`
- darwin-arm64 npm integrity: `sha512-QcYKzyrTzGSx6aKCD6hUODgRS1LetqfG57Z/+i5LCyfMlrgCvDc1lRcl9cdB+TozBsLha9QwLTlI0vmDcf5JKg==`
- License: Apache-2.0 (`LICENSE.sherpa-onnx`)
- `sherpa-onnx-node/sherpa-onnx.js` SHA-256: `cdfe88a1a55358dbee071f57aea874ae16a2862c83fbc720d2f2830343057185`
- `sherpa-onnx-darwin-arm64/sherpa-onnx.node` SHA-256: `62bcb019dd59696542bdfe74c7c0d5cb62a07cbcb26d67b7fdb0da38635638f3`
- `sherpa-onnx-darwin-arm64/libsherpa-onnx-c-api.dylib` SHA-256: `c41b2d450e3617425b16d24e23fa2679f0a017983c67807f338b0e6ee72c873b`
- `sherpa-onnx-darwin-arm64/libonnxruntime.dylib` SHA-256: `c6883a2e072261d55e5bca9791a564f058c8e31c167be6e66f4dd842da0cf43e`
- Runtime execution: native Node addon, CPU provider, one configured inference thread, no runtime network.

## Segmentation model

- File: `segmentation.onnx`
- Sherpa release asset: `speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`
- Download: <https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2>
- Upstream model: <https://huggingface.co/pyannote/segmentation-3.0>
- Release asset last-modified: 2024-10-08
- License: MIT (`LICENSE.pyannote`)
- SHA-256: `220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079`
- Bytes: `5992913`

## Speaker-embedding model

- File: `embedding.onnx`
- Sherpa release asset: `speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`
- Download: <https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx>
- Upstream project: <https://github.com/modelscope/3D-Speaker>
- Upstream license snapshot revision: `065629c313eaf1a01c65c640c46d77e61e9607b4`
- Release asset last-modified: 2024-10-14
- License: Apache-2.0 (`LICENSE.3d-speaker`)
- SHA-256: `1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b`
- Bytes: `39593761`

The runtime emits anonymous clustering hypotheses only. Neither model authorizes person identity,
biometric matching, cross-run linkage, transcription, translation, or correctness claims.
