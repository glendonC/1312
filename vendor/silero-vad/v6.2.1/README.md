# Silero VAD production pin

This directory contains the exact model used by `scripts/detect-speech.mjs`.

- Upstream: https://github.com/snakers4/silero-vad
- Release: `v6.2.1`
- Revision: `7e30209a3e901f9842f81b225f3e93d8199902b1`
- Model: `src/silero_vad/data/silero_vad_16k_op15.onnx`
- Model SHA-256: `7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49`
- License: MIT; the upstream license text is preserved in `LICENSE`.

The producer verifies the model hash before inference. It uses only fixed 16 kHz mono signed
16-bit PCM, ONNX Runtime's CPU execution provider, sequential execution, and one inter-op and
one intra-op thread. The model is never downloaded at runtime.
