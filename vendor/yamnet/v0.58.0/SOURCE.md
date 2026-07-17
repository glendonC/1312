# Vendored YAMNet execution files

These files are the pre-exported float ONNX release identified as `qualcomm/YamNet` v0.58.0:

- archive: `https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-models/models/yamnet/releases/v0.58.0/yamnet-onnx-float.zip`
- downloaded archive SHA-256: `6d1b0b8c5ce4fe4529a797ae22c256e4312541c67117cf0632e5063080a75013`
- `yamnet.onnx` SHA-256: `cdbe3856099aec4cb7b73d4c0571d40e5bd5c7ee6e534ec419a46554eff4dec2`
- `yamnet.data` SHA-256: `d4dc721c9f1161233aa19d14285cce1f5539593378a7e75b19c308ec13ba8aeb`
- AudioSet class map revision: TensorFlow Models `7ce2267bc31776d591fb054cb232494ac513480a`
- `yamnet_class_map.csv` SHA-256: `cdf24d193e196d9e95912a2667051ae203e92a2ba09449218ccb40ef787c6df2`

The Qualcomm model card identifies the original implementation as
`w-hc/torch_audioset`; U1 pins commit `e8852c5`. `LICENSE` is that implementation's MIT license.
Qualcomm AI Hub Models source code used to export/package the model is BSD-3-Clause. The original
Google YAMNet implementation is Apache-2.0. These notices do not establish ownership or licensing
of AudioSet source recordings, which are not vendored here.

The runtime receipts hash the two executable model files, the pinned model license, the exact class
map, and its Apache-2.0 license. `SOURCE.md`
is provenance documentation and is not an executable model input.
