#!/usr/bin/env python3
"""Pinned, local-only U7 SepFormer adapter. It emits metadata or two PCM16 mono WAV estimates."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
import wave
from pathlib import Path

MODEL_HASHES = {
    "hyperparams.yaml": "939c86a8d36c52ae148859de34a3e7b984f4b576213957bdba09462cc88168bf",
    "encoder.ckpt": "3139bb880b29ea77ae8a168b8f2ad6e8eb5c2c0904289676c223d0e93cd2a35d",
    "decoder.ckpt": "abea1a2d41151331b4c36071d1b3205aed940a189721f008b12a703e9c63e7e4",
    "masknet.ckpt": "57dd5f49bf21c5a2101bb4e46648d05d34d517a59e26f0b06646d0bebe8214c7",
}


def describe() -> dict[str, object]:
    import speechbrain
    import torch
    import torchaudio

    return {
        "python": {"version": f"{sys.version_info.major}.{sys.version_info.minor}", "platform": sys.platform, "arch": platform.machine()},
        "packages": {"speechbrain": speechbrain.__version__, "torch": torch.__version__.split("+")[0], "torchaudio": torchaudio.__version__.split("+")[0]},
        "runtimeFiles": [
            {"name": "python", "path": os.path.realpath(sys.executable)},
            {"name": "speechbrain/__init__.py", "path": speechbrain.__file__},
            {"name": "torch/__init__.py", "path": torch.__file__},
            {"name": "torchaudio/__init__.py", "path": torchaudio.__file__},
        ],
    }


def verify_model(model_dir: Path) -> None:
    for name, expected in MODEL_HASHES.items():
        path = model_dir / name
        measured = hashlib.sha256(path.read_bytes()).hexdigest()
        if measured != expected:
            raise RuntimeError(f"pinned model file changed: {name}")


def separate(model_dir: Path, input_path: Path, runtime_dir: Path, outputs: list[Path], expected_samples: int) -> dict[str, object]:
    verify_model(model_dir)  # Authenticate executable HyperPyYAML/checkpoints before parsing.
    import numpy as np
    import soundfile as sf
    import torch
    from speechbrain.inference.separation import SepformerSeparation
    from speechbrain.utils.fetching import FetchConfig, LocalStrategy

    torch.set_num_threads(1)
    with wave.open(str(input_path), "rb") as source:
        if source.getnchannels() != 1 or source.getframerate() != 8000 or source.getsampwidth() != 2 or source.getnframes() != expected_samples:
            raise RuntimeError("input WAV changed the pinned normalization or exact sample count")
    model = SepformerSeparation.from_hparams(
        source=str(model_dir),
        savedir=str(runtime_dir),
        local_strategy=LocalStrategy.NO_LINK,
        fetch_config=FetchConfig(allow_network=False),
        run_opts={"device": "cpu"},
    )
    estimated = model.separate_file(path=str(input_path)).detach().cpu().numpy()
    if estimated.shape != (1, expected_samples, 2) or not np.isfinite(estimated).all():
        raise RuntimeError(f"separator returned invalid shape or values: {estimated.shape}")
    for index, output in enumerate(outputs):
        output.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(output), np.clip(estimated[0, :, index], -1.0, 1.0), 8000, subtype="PCM_16", format="WAV")
    return {"sampleCount": expected_samples}


def main() -> None:
    if sys.argv[1:] == ["--describe"]:
        print(json.dumps(describe(), separators=(",", ":")))
        return
    if len(sys.argv) == 8 and sys.argv[1] == "--separate":
        print(json.dumps(separate(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), [Path(sys.argv[5]), Path(sys.argv[6])], int(sys.argv[7])), separators=(",", ":")))
        return
    raise SystemExit("usage: --describe | --separate MODEL INPUT STEM1 STEM2 EXPECTED_SAMPLES")


if __name__ == "__main__":
    main()
