#!/usr/bin/env python3
"""Install the ignored, pinned U7 runtime. Network is used only by this explicit bootstrap."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import venv
from pathlib import Path

REVISION = "3a2826343a10e2d2e8a75f79aeab5ff3a2473531"
MODEL_HASHES = {
    "hyperparams.yaml": (1515, "939c86a8d36c52ae148859de34a3e7b984f4b576213957bdba09462cc88168bf"),
    "encoder.ckpt": (17267, "3139bb880b29ea77ae8a168b8f2ad6e8eb5c2c0904289676c223d0e93cd2a35d"),
    "decoder.ckpt": (17202, "abea1a2d41151331b4c36071d1b3205aed940a189721f008b12a703e9c63e7e4"),
    "masknet.ckpt": (113108458, "57dd5f49bf21c5a2101bb4e46648d05d34d517a59e26f0b06646d0bebe8214c7"),
}


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def verify(model: Path) -> dict[str, dict[str, object]]:
    result: dict[str, dict[str, object]] = {}
    for name, (expected_bytes, expected_hash) in MODEL_HASHES.items():
        path = model / name
        payload = path.read_bytes()
        measured = hashlib.sha256(payload).hexdigest()
        if len(payload) != expected_bytes or measured != expected_hash:
            raise RuntimeError(f"pinned model identity mismatch: {name}")
        result[name] = {"bytes": len(payload), "sha256": measured}
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--accept-model-card-license", action="store_true")
    args = parser.parse_args()
    if not args.accept_model_card_license:
        raise SystemExit("Bootstrap requires --accept-model-card-license; read vendor/speech-separation/speechbrain-sepformer-wsj02mix/SOURCE.md")
    if sys.platform != "darwin" or platform.machine() != "arm64" or sys.version_info[:2] != (3, 14):
        raise SystemExit("U7 runtime is qualified only for macOS arm64 with Python 3.14")
    repository = Path(__file__).resolve().parents[1]
    runtime = repository / ".studio" / "separation-runtime"
    environment = runtime / "venv"
    model = runtime / "model"
    requirements = repository / "vendor" / "speech-separation" / "speechbrain-sepformer-wsj02mix" / "requirements.lock.txt"
    runtime.mkdir(parents=True, exist_ok=True)
    if not environment.exists():
        venv.EnvBuilder(with_pip=True).create(environment)
    python = environment / "bin" / "python"
    run(str(python), "-m", "pip", "install", "--only-binary=:all:", "-r", str(requirements))
    model.mkdir(parents=True, exist_ok=True)
    downloader = (
        "from huggingface_hub import snapshot_download; "
        f"snapshot_download(repo_id='speechbrain/sepformer-wsj02mix', revision='{REVISION}', "
        f"local_dir={str(model)!r}, allow_patterns=['hyperparams.yaml','encoder.ckpt','decoder.ckpt','masknet.ckpt','README.md'])"
    )
    run(str(python), "-c", downloader)
    files = verify(model)
    receipt = {
        "schema": "studio.u7-separation-local-install.v1",
        "model": {"id": "speechbrain/sepformer-wsj02mix", "revision": REVISION, "files": files},
        "runtime": {"python": "3.14", "platform": "darwin", "arch": "arm64", "speechbrain": "1.1.0", "torch": "2.11.0", "torchaudio": "2.11.0"},
        "licenseAcknowledgement": "Apache-2.0-model-card-declaration-reviewed",
    }
    (runtime / "install.json").write_text(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(runtime)


if __name__ == "__main__":
    main()
