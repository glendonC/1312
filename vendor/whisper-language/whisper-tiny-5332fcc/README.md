# Pinned Whisper language-identification assets

This directory vendors the exact local assets used by `scripts/detect-language.mjs`.
The producer uses only the first decoder-token logits from the multilingual
`Xenova/whisper-tiny` q8 ONNX export and normalizes probability across its exact
99 language tokens. It performs no transcription and makes no language claim for
audio outside receipted speech windows.

- Model repository: `Xenova/whisper-tiny`
- Model revision: `5332fcc35e32a33b86612b9a57a89be7906102b1`
- Base model: `openai/whisper-tiny`
- Export license: Apache-2.0
- Upstream OpenAI Whisper license: MIT
- OpenAI license source revision: `04f449b8a437f1bbd3dba5c9f826aca972e7709a`

The executable and configuration identities are pinned in the receipt validator.
The ONNX files intentionally live at this directory root; the producer passes an
empty model subfolder to the pinned Transformers.js loader rather than relying on
the loader's default `onnx/` layout.

The stored probability is a reproducible model softmax score, not calibrated
confidence. A range is classified only when the top probability is at least 0.5
and its margin over the runner-up is at least 0.15. Otherwise it remains unknown.
Chunks shorter than one second at 16 kHz are withheld.
