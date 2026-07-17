import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { createWorker, OEM, PSM, type Worker } from "tesseract.js";

import { identifyFile } from "../artifactStore.ts";
import type { OcrProducerLineage, OcrRuntimeFileIdentity } from "../model.ts";
import type { VerifiedSampledFrame } from "../frameAudit.ts";
import {
  OcrRecognizerFailure,
  type OcrRecognizer,
  type OcrRecognizerCandidate,
  type OcrRecognizerResult,
} from "./recognizer.ts";

const require = createRequire(import.meta.url);
const DEFAULT_MODEL_DIRECTORY = fileURLToPath(new URL("../../../../../vendor/tesseract/4.1.0/", import.meta.url));

const TESSERACT_FILES = [
  "package.json",
  "src/index.js",
  "src/createWorker.js",
  "src/worker/node/defaultOptions.js",
  "src/worker/node/spawnWorker.js",
  "src/worker-script/index.js",
  "src/worker-script/node/index.js",
  "src/worker-script/node/getCore.js",
] as const;
const CORE_FILES = [
  "package.json",
  "index.js",
  "tesseract-core-lstm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-simd-lstm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-relaxedsimd-lstm.js",
  "tesseract-core-relaxedsimd-lstm.wasm",
] as const;
const FEATURE_FILES = ["package.json", "dist/cjs/index.cjs"] as const;

async function bounded<T>(
  promise: Promise<T>,
  deadlineAtMs: number,
  onTimeout?: () => void,
): Promise<T> {
  const remainingMs = Math.max(0, Math.floor(deadlineAtMs - performance.now()));
  if (remainingMs <= 0) throw new OcrRecognizerFailure("recognizer_timeout", "OCR exceeded its wall-time grant");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new OcrRecognizerFailure("recognizer_timeout", "OCR exceeded its wall-time grant"));
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function identifyFiles(root: string, names: readonly string[]): Promise<OcrRuntimeFileIdentity[]> {
  return Promise.all(names.map(async (name) => ({ name, content: await identifyFile(join(root, name)) })));
}

function packageRoot(specifier: string): string {
  const entry = require.resolve(specifier);
  if (specifier === "tesseract.js") return join(dirname(entry), "..");
  return dirname(entry);
}

function wordsFromBlocks(blocks: Tesseract.Block[] | null): OcrRecognizerCandidate[] {
  return (blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) =>
    paragraph.lines.flatMap((line) => line.words.map((word) => ({
      text: word.text,
      confidence: Math.max(0, Math.min(100, Math.round(word.confidence))),
      boundingBox: {
        x0: Math.round(word.bbox.x0),
        y0: Math.round(word.bbox.y0),
        x1: Math.round(word.bbox.x1),
        y1: Math.round(word.bbox.y1),
      },
    })))));
}

export class TesseractJsOcrRecognizer implements OcrRecognizer {
  private readonly modelDirectory: string;

  constructor(options: { modelDirectory?: string } = {}) {
    this.modelDirectory = options.modelDirectory ?? DEFAULT_MODEL_DIRECTORY;
  }

  async currentLineage(deadlineAtMs: number): Promise<OcrProducerLineage> {
    if (performance.now() >= deadlineAtMs) {
      throw new OcrRecognizerFailure("recognizer_timeout", "OCR lineage verification exceeded its wall-time grant");
    }
    try {
      const tesseractRoot = packageRoot("tesseract.js");
      const coreRoot = packageRoot("tesseract.js-core");
      const featurePackage = require.resolve("wasm-feature-detect/package.json");
      const featureRoot = dirname(featurePackage);
      const [runtimeFiles, coreFiles, featureFiles, kor, eng] = await Promise.all([
        identifyFiles(tesseractRoot, TESSERACT_FILES),
        identifyFiles(coreRoot, CORE_FILES),
        identifyFiles(featureRoot, FEATURE_FILES),
        identifyFile(join(this.modelDirectory, "kor.traineddata")),
        identifyFile(join(this.modelDirectory, "eng.traineddata")),
      ]);
      if (performance.now() >= deadlineAtMs) {
        throw new OcrRecognizerFailure("recognizer_timeout", "OCR lineage verification exceeded its wall-time grant");
      }
      return {
        schema: "studio.ocr-producer-lineage.v1",
        adapter: { id: "tesseract-js-ocr", version: "1" },
        runtime: {
          package: { name: "tesseract.js", version: "7.0.0", files: runtimeFiles },
          core: { name: "tesseract.js-core", version: "7.0.0", files: coreFiles },
          featureDetection: { name: "wasm-feature-detect", version: "1.8.0", files: featureFiles },
          node: { version: process.version, platform: process.platform, arch: process.arch },
        },
        models: [
          {
            language: "kor",
            release: "4.1.0",
            commit: "65727574dfcd264acbb0c3e07860e4e9e9b22185",
            repository: "https://github.com/tesseract-ocr/tessdata_fast",
            license: "Apache-2.0",
            content: kor,
          },
          {
            language: "eng",
            release: "4.1.0",
            commit: "65727574dfcd264acbb0c3e07860e4e9e9b22185",
            repository: "https://github.com/tesseract-ocr/tessdata_fast",
            license: "Apache-2.0",
            content: eng,
          },
        ],
        configuration: {
          languages: ["kor", "eng"],
          engineMode: "lstm_only",
          pageSegmentationMode: "auto",
          preserveInterwordSpaces: true,
          trainedDataCache: "disabled",
          networkFetch: "disabled",
          textNormalization: "unicode_nfc_whitespace_collapse",
        },
      };
    } catch (cause) {
      if (cause instanceof OcrRecognizerFailure) throw cause;
      throw new OcrRecognizerFailure("model_unavailable", "Pinned OCR runtime or model files are unavailable", { cause });
    }
  }

  async recognize(frames: readonly VerifiedSampledFrame[], deadlineAtMs: number): Promise<OcrRecognizerResult> {
    const lineage = await this.currentLineage(deadlineAtMs);
    let worker: Worker | null = null;
    const creation = createWorker(["kor", "eng"], OEM.LSTM_ONLY, {
      langPath: this.modelDirectory,
      gzip: false,
      cacheMethod: "none",
      logger: () => undefined,
      errorHandler: () => undefined,
    });
    try {
      worker = await bounded(creation, deadlineAtMs, () => {
        void creation.then((created) => created.terminate()).catch(() => undefined);
      });
      await bounded(worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "1",
      }), deadlineAtMs, () => { void worker?.terminate(); });
      const results = [];
      for (const frame of frames) {
        const recognized = await bounded(
          worker.recognize(frame.bytes, {}, { text: true, blocks: true }),
          deadlineAtMs,
          () => { void worker?.terminate(); },
        );
        results.push({ frameId: frame.identity.frameId, candidates: wordsFromBlocks(recognized.data.blocks) });
      }
      return { lineage, frames: results };
    } catch (cause) {
      if (cause instanceof OcrRecognizerFailure) throw cause;
      throw new OcrRecognizerFailure("recognizer_failed", "Pinned OCR recognition failed", { cause });
    } finally {
      if (worker) await worker.terminate().catch(() => undefined);
    }
  }
}
