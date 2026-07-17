# Vendored Tesseract language data

- Upstream: `tesseract-ocr/tessdata_fast`
- Release: `4.1.0`
- Commit: `65727574dfcd264acbb0c3e07860e4e9e9b22185`
- License: Apache-2.0 (`LICENSE` in this directory)
- Files:
  - `eng.traineddata`: `sha256:7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`
  - `kor.traineddata`: `sha256:6b85e11d9bbf07863b97b3523b1b112844c43e713df8b66418a081fd1060b3b2`

These are the official fast integer LSTM models. They are loaded from this directory with network
fetching and trained-data caching disabled. Their presence and content identities are runtime
inputs, not evidence that an OCR hypothesis is correct.
