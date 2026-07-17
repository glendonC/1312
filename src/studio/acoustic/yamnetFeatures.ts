const SAMPLE_RATE = 16_000;
const WINDOW_SAMPLES = 400;
const HOP_SAMPLES = 160;
const FFT_SAMPLES = 512;
const MEL_BANDS = 64;
const PATCH_FRAMES = 96;

function reflected(samples: Float32Array, index: number): number {
  if (samples.length === 1) return samples[0] ?? 0;
  let current = index;
  while (current < 0 || current >= samples.length) {
    current = current < 0 ? -current : 2 * samples.length - 2 - current;
  }
  return samples[current] ?? 0;
}

function fftMagnitudes(frame: Float64Array): Float64Array {
  const real = new Float64Array(frame);
  const imaginary = new Float64Array(FFT_SAMPLES);
  for (let i = 1, j = 0; i < FFT_SAMPLES; i += 1) {
    let bit = FFT_SAMPLES >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      const swap = real[i] ?? 0; real[i] = real[j] ?? 0; real[j] = swap;
    }
  }
  for (let length = 2; length <= FFT_SAMPLES; length <<= 1) {
    const angle = -2 * Math.PI / length;
    for (let offset = 0; offset < FFT_SAMPLES; offset += length) {
      for (let k = 0; k < length / 2; k += 1) {
        const cosine = Math.cos(angle * k); const sine = Math.sin(angle * k);
        const right = offset + k + length / 2; const left = offset + k;
        const rightReal = real[right] ?? 0; const rightImaginary = imaginary[right] ?? 0;
        const tr = cosine * rightReal - sine * rightImaginary;
        const ti = cosine * rightImaginary + sine * rightReal;
        const ur = real[left] ?? 0; const ui = imaginary[left] ?? 0;
        real[left] = ur + tr; imaginary[left] = ui + ti;
        real[right] = ur - tr; imaginary[right] = ui - ti;
      }
    }
  }
  const output = new Float64Array(FFT_SAMPLES / 2 + 1);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.hypot(real[index] ?? 0, imaginary[index] ?? 0);
  }
  return output;
}

function hzToMel(frequency: number): number { return 2595 * Math.log10(1 + frequency / 700); }
function melToHz(mel: number): number { return 700 * (10 ** (mel / 2595) - 1); }

function melFilters(): Float64Array[] {
  const minimum = hzToMel(125); const maximum = hzToMel(7500);
  const points = Array.from({ length: MEL_BANDS + 2 }, (_, index) =>
    melToHz(minimum + (maximum - minimum) * index / (MEL_BANDS + 1)));
  const frequencies = Array.from({ length: FFT_SAMPLES / 2 + 1 }, (_, index) => index * SAMPLE_RATE / FFT_SAMPLES);
  return Array.from({ length: MEL_BANDS }, (_, band) => {
    const lower = points[band] ?? 0; const center = points[band + 1] ?? 0; const upper = points[band + 2] ?? 0;
    return Float64Array.from(frequencies, (frequency) => Math.max(0, Math.min(
      (frequency - lower) / (center - lower),
      (upper - frequency) / (upper - center),
    )));
  });
}

const FILTERS = melFilters();

/** Exact YAMNet-compatible 96x64 VGGish log-mel input for one 960 ms mono 16 kHz patch. */
export function yamnetLogMel(patch: Float32Array): Float32Array {
  if (patch.length !== 15_360) throw new Error("YAMNet feature extraction requires exactly 15,360 samples");
  const output = new Float32Array(PATCH_FRAMES * MEL_BANDS);
  for (let frameIndex = 0; frameIndex < PATCH_FRAMES; frameIndex += 1) {
    const frame = new Float64Array(FFT_SAMPLES);
    const center = frameIndex * HOP_SAMPLES;
    for (let sampleIndex = 0; sampleIndex < WINDOW_SAMPLES; sampleIndex += 1) {
      // torch.stft centers the 400-sample Hann window inside the 512-sample FFT frame.
      const fftIndex = (FFT_SAMPLES - WINDOW_SAMPLES) / 2 + sampleIndex;
      const sourceIndex = center - WINDOW_SAMPLES / 2 + sampleIndex;
      const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * sampleIndex / WINDOW_SAMPLES);
      frame[fftIndex] = reflected(patch, sourceIndex) * hann;
    }
    const magnitude = fftMagnitudes(frame);
    for (let band = 0; band < MEL_BANDS; band += 1) {
      const filter = FILTERS[band] ?? new Float64Array();
      let mel = 0;
      for (let bin = 0; bin < magnitude.length; bin += 1) mel += (magnitude[bin] ?? 0) * (filter[bin] ?? 0);
      output[frameIndex * MEL_BANDS + band] = Math.log(mel + 0.001);
    }
  }
  return output;
}

export function pcm16Patch(buffer: Buffer, startSample: number, endSample: number): { patch: Float32Array; availableSamples: number } {
  if (!Number.isSafeInteger(startSample) || !Number.isSafeInteger(endSample) || startSample < 0 || endSample <= startSample || endSample * 2 > buffer.byteLength) {
    throw new Error("PCM patch range is outside the sealed audio bytes");
  }
  const patch = new Float32Array(15_360);
  const availableSamples = Math.min(15_360, endSample - startSample);
  for (let index = 0; index < availableSamples; index += 1) patch[index] = buffer.readInt16LE((startSample + index) * 2) / 32768;
  return { patch, availableSamples };
}
