type FingerprintPeak = {
  timeIndex: number;
  binIndex: number;
  magnitude: number;
};

export type AudioFingerprint = {
  signature: string;
  hashCount: number;
  peakCount: number;
  quality: number;
};

const FFT_SIZE = 2048;
const HOP_SIZE = 512;
const MAX_HASHES = 160;
const PEAK_BANDS_HZ: Array<[number, number]> = [
  [50, 120],
  [120, 220],
  [220, 350],
  [350, 550],
  [550, 800],
  [800, 1200],
  [1200, 1800],
  [1800, 2700],
  [2700, 3800],
  [3800, 5200],
];

const hannWindow = new Float32Array(FFT_SIZE);
const FFT_BITS = Math.log2(FFT_SIZE);
const bitReversedIndices = new Uint16Array(FFT_SIZE);

for (let index = 0; index < FFT_SIZE; index += 1) {
  hannWindow[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1));

  let value = index;
  let reversed = 0;

  for (let bit = 0; bit < FFT_BITS; bit += 1) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }

  bitReversedIndices[index] = reversed;
}

function fftMagnitude(input: Float32Array) {
  const real = new Float32Array(FFT_SIZE);
  const imag = new Float32Array(FFT_SIZE);

  for (let index = 0; index < FFT_SIZE; index += 1) {
    real[bitReversedIndices[index]] = input[index] * hannWindow[index];
  }

  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const angle = (-2 * Math.PI) / size;

    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let offset = 0; offset < half; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + half;
        const twiddle = angle * offset;
        const cos = Math.cos(twiddle);
        const sin = Math.sin(twiddle);
        const tr = real[oddIndex] * cos - imag[oddIndex] * sin;
        const ti = real[oddIndex] * sin + imag[oddIndex] * cos;

        real[oddIndex] = real[evenIndex] - tr;
        imag[oddIndex] = imag[evenIndex] - ti;
        real[evenIndex] += tr;
        imag[evenIndex] += ti;
      }
    }
  }

  const magnitudes = new Float32Array(FFT_SIZE / 2);

  for (let index = 0; index < magnitudes.length; index += 1) {
    magnitudes[index] = Math.sqrt(real[index] * real[index] + imag[index] * imag[index]);
  }

  return magnitudes;
}

function collectPeaks(frameMagnitudes: Float32Array, sampleRate: number, frameIndex: number) {
  const nyquist = sampleRate / 2;
  const peaks: FingerprintPeak[] = [];
  let frameMax = 0;

  for (let index = 0; index < frameMagnitudes.length; index += 1) {
    if (frameMagnitudes[index] > frameMax) {
      frameMax = frameMagnitudes[index];
    }
  }

  if (frameMax <= 0) {
    return peaks;
  }

  const peakFloor = frameMax * 0.33;

  for (const [lowHz, highHz] of PEAK_BANDS_HZ) {
    const startBin = Math.max(
      1,
      Math.floor((Math.min(lowHz, nyquist) / nyquist) * (frameMagnitudes.length - 1)),
    );
    const endBin = Math.min(
      frameMagnitudes.length - 1,
      Math.ceil((Math.min(highHz, nyquist) / nyquist) * (frameMagnitudes.length - 1)),
    );

    if (endBin <= startBin) {
      continue;
    }

    let bestBin = startBin;
    let bestMag = 0;

    for (let bin = startBin; bin <= endBin; bin += 1) {
      const magnitude = frameMagnitudes[bin];

      if (magnitude > bestMag) {
        bestMag = magnitude;
        bestBin = bin;
      }
    }

    if (bestMag >= peakFloor) {
      peaks.push({
        timeIndex: frameIndex,
        binIndex: bestBin,
        magnitude: bestMag,
      });
    }
  }

  return peaks;
}

function buildLandmarkHashes(peaks: FingerprintPeak[]) {
  const hashes: number[] = [];
  const fanout = 6;
  const minDeltaFrames = 1;
  const maxDeltaFrames = 28;

  for (let anchorIndex = 0; anchorIndex < peaks.length; anchorIndex += 1) {
    const anchor = peaks[anchorIndex];

    for (
      let targetIndex = anchorIndex + 1;
      targetIndex < peaks.length && targetIndex <= anchorIndex + fanout;
      targetIndex += 1
    ) {
      const target = peaks[targetIndex];
      const delta = target.timeIndex - anchor.timeIndex;

      if (delta < minDeltaFrames || delta > maxDeltaFrames) {
        continue;
      }

      const packed =
        ((anchor.binIndex & 0x3ff) << 20) |
        ((target.binIndex & 0x3ff) << 10) |
        (delta & 0x3ff);
      hashes.push(packed >>> 0);
    }
  }

  return hashes;
}

function signatureFromHashes(hashes: number[]) {
  const counts = new Map<number, number>();

  for (const hash of hashes) {
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, MAX_HASHES)
    .map(([hash]) => hash.toString(36))
    .join(".");
}

export function createAudioFingerprint(chunk: Float32Array, sampleRate: number): AudioFingerprint {
  if (chunk.length < FFT_SIZE + HOP_SIZE) {
    return {
      signature: "",
      hashCount: 0,
      peakCount: 0,
      quality: 0,
    };
  }

  const frameCount = Math.floor((chunk.length - FFT_SIZE) / HOP_SIZE) + 1;
  const frameBuffer = new Float32Array(FFT_SIZE);
  const peaks: FingerprintPeak[] = [];

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const offset = frameIndex * HOP_SIZE;

    for (let sampleIndex = 0; sampleIndex < FFT_SIZE; sampleIndex += 1) {
      frameBuffer[sampleIndex] = chunk[offset + sampleIndex];
    }

    const frameMagnitudes = fftMagnitude(frameBuffer);
    peaks.push(...collectPeaks(frameMagnitudes, sampleRate, frameIndex));
  }

  const hashes = buildLandmarkHashes(peaks);
  const signature = signatureFromHashes(hashes);
  const hashCount = hashes.length;
  const peakCount = peaks.length;
  const quality = Number(
    Math.min(1, Math.min(hashCount / 120, 1) * 0.7 + Math.min(peakCount / 180, 1) * 0.3).toFixed(2),
  );

  return {
    signature,
    hashCount,
    peakCount,
    quality,
  };
}
