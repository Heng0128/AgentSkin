// SPDX-License-Identifier: MPL-2.0
/**
 * OKLCH Perceptual Color Extraction Engine
 *
 * Decodes a 24/32-bit uncompressed BMP image in pure JS (no external deps),
 * converts pixels to OKLCH color space, performs perceptual hue/lightness
 * histograms, and emits a 14-token theme manifest.
 *
 * 14-token list (from task spec):
 *   accent, accent-hover, accent-muted,
 *   bg, bg-elevated, bg-overlay,
 *   border, border-strong,
 *   text, text-muted, text-inverse,
 *   focus-ring, selection, code-bg
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const D65_X = 0.95047;
const D65_Y = 1.0;
const D65_Z = 1.08883;
const OKLAB_L_COEF = [0.2104542553, 0.793617785, -0.0040720468];
const OKLAB_A_COEF = [1.9779984951, -2.428592205, 0.4505937099];
const OKLAB_B_COEF = [0.0259040371, 0.7827717662, -0.808675766];

const HUE_BINS = 12; // 30° each

// ---------------------------------------------------------------------------
// BMP decoder — 24-bit / 32-bit uncompressed, BITMAPINFOHEADER
// ---------------------------------------------------------------------------

/**
 * Decode a BMP file to an { width, height, pixels: Uint8Array RGBA }.
 * Supports 24-bit and 32-bit uncompressed BITMAPINFOHEADER.
 * @param {Buffer} buf
 * @returns {{ width: number, height: number, pixels: Buffer }}
 */
export function decodeBmp(buf) {
  if (buf.length < 54) throw new Error('BMP too small');
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error('Not a BMP file');

  const dataOffset = buf.readUInt32LE(10);
  const headerSize = buf.readUInt32LE(14);
  if (headerSize < 40) throw new Error('Unsupported DIB header');

  const width = buf.readInt32LE(18);
  const heightRaw = buf.readInt32LE(22);
  const height = Math.abs(heightRaw);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);

  if (bpp !== 24 && bpp !== 32) throw new Error(`Unsupported bpp: ${bpp}`);
  if (compression !== 0) throw new Error('Compressed BMP not supported');

  const topDown = heightRaw < 0;
  const bytesPerPixel = bpp / 8;
  const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;

  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    const rowStart = dataOffset + srcRow * rowSize;
    for (let x = 0; x < width; x++) {
      const src = rowStart + x * bytesPerPixel;
      const dst = (y * width + x) * 4;
      pixels[dst] = buf[src + 2]; // R
      pixels[dst + 1] = buf[src + 1]; // G
      pixels[dst + 2] = buf[src]; // B
      pixels[dst + 3] = bytesPerPixel === 4 ? buf[src + 3] : 255; // A
    }
  }

  return { width, height, pixels };
}

// ---------------------------------------------------------------------------
// Color conversion (sRGB → OKLCH, inline for performance)
// ---------------------------------------------------------------------------

function srgbToLinearByte(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbFloat(c) {
  return (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255;
}

/**
 * Convert sRGB byte triple to OKLCH. Returns [L (0-1), C (0-0.4), H (0-360)].
 */
export function rgbToOklch(r, g, b) {
  const lr = srgbToLinearByte(r);
  const lg = srgbToLinearByte(g);
  const lb = srgbToLinearByte(b);

  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = 0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb;

  const l_ = Math.cbrt(x / D65_X);
  const m_ = Math.cbrt(y / D65_Y);
  const s_ = Math.cbrt(z / D65_Z);

  const l = OKLAB_L_COEF[0] * l_ + OKLAB_L_COEF[1] * m_ + OKLAB_L_COEF[2] * s_;
  const a = OKLAB_A_COEF[0] * l_ + OKLAB_A_COEF[1] * m_ + OKLAB_A_COEF[2] * s_;
  const b_ = OKLAB_B_COEF[0] * l_ + OKLAB_B_COEF[1] * m_ + OKLAB_B_COEF[2] * s_;

  const c = Math.sqrt(a * a + b_ * b_);
  let h = Math.atan2(b_, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  return [l, c, h];
}

/**
 * Convert OKLCH to sRGB hex string "#rrggbb".
 */
export function oklchToHex(l, c, h) {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const x = D65_X * l_ * l_ * l_;
  const y = D65_Y * m_ * m_ * m_;
  const z = D65_Z * s_ * s_ * s_;

  let lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  let lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  let lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  // Gamut clip
  lr = Math.max(0, Math.min(1, lr));
  lg = Math.max(0, Math.min(1, lg));
  lb = Math.max(0, Math.min(1, lb));

  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    clamp(linearToSrgbFloat(lr)).toString(16).padStart(2, '0') +
    clamp(linearToSrgbFloat(lg)).toString(16).padStart(2, '0') +
    clamp(linearToSrgbFloat(lb)).toString(16).padStart(2, '0')
  );
}

// ---------------------------------------------------------------------------
// WCAG relative luminance & contrast
// ---------------------------------------------------------------------------

export function relLuminance(r, g, b) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function contrastRatioRgb(r1, g1, b1, r2, g2, b2) {
  const l1 = relLuminance(r1, g1, b1);
  const l2 = relLuminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Dominant color extraction
// ---------------------------------------------------------------------------

/**
 * Compute perceptual histogram & aggregate stats from RGBA pixel buffer.
 * @param {Buffer} pixels RGBA
 * @param {number} width
 * @param {number} height
 * @param {object} [opts]
 * @param {number} [opts.maxSamples=8000]
 */
export function computeHistogram(pixels, width, height, opts = {}) {
  const { maxSamples = 8000 } = opts;
  const totalPx = width * height;
  const stride = Math.max(1, Math.floor(Math.sqrt(totalPx / maxSamples)));

  // Per-bin accumulators: { sumL, sumC, sumH, count }
  const bins = Array.from({ length: HUE_BINS }, () => ({
    sumL: 0,
    sumC: 0,
    sumHx: 0,
    sumHy: 0,
    count: 0,
  }));

  let globalMinL = Infinity;
  let globalMaxL = -Infinity;
  let globalSumL = 0;
  let globalCount = 0;
  let chromaSum = 0;
  let chromaCount = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      // Skip fully transparent
      if (pixels[i + 3] === 0) continue;

      const [l, c, h] = rgbToOklch(r, g, b);

      if (l < globalMinL) globalMinL = l;
      if (l > globalMaxL) globalMaxL = l;
      globalSumL += l;
      globalCount++;

      if (c > 0.02) {
        const hRad = (h * Math.PI) / 180;
        const bin = Math.floor(h / (360 / HUE_BINS)) % HUE_BINS;
        bins[bin].sumL += l;
        bins[bin].sumC += c;
        bins[bin].sumHx += Math.cos(hRad);
        bins[bin].sumHy += Math.sin(hRad);
        bins[bin].count++;
        chromaSum += c;
        chromaCount++;
      }
    }
  }

  // Compute per-bin averages
  const binAvgs = bins.map((b, idx) => {
    if (b.count === 0) {
      return { bin: idx, avgL: 0, avgC: 0, avgH: 0, count: 0 };
    }
    const avgL = b.sumL / b.count;
    const avgC = b.sumC / b.count;
    let avgH = (Math.atan2(b.sumHy / b.count, b.sumHx / b.count) * 180) / Math.PI;
    if (avgH < 0) avgH += 360;
    return { bin: idx, avgL, avgC, avgH, count: b.count };
  });

  const sortedBins = [...binAvgs].sort((a, b) => b.count - a.count);

  return {
    avgL: globalCount > 0 ? globalSumL / globalCount : 0.5,
    minL: globalMinL === Infinity ? 0 : globalMinL,
    maxL: globalMaxL === -Infinity ? 1 : globalMaxL,
    avgChroma: chromaCount > 0 ? chromaSum / chromaCount : 0,
    bins: binAvgs,
    topBins: sortedBins,
    totalSampled: globalCount,
  };
}

/**
 * Pick two dominant hue bins that are well-separated.
 * Returns [primaryBin, secondaryBin] (primary has more pixels).
 */
export function pickPrimarySecondary(bins) {
  const active = bins.filter((b) => b.count > 0);
  if (active.length === 0) {
    return [
      { avgL: 0.6, avgC: 0.15, avgH: 260 },
      { avgL: 0.5, avgC: 0.12, avgH: 200 },
    ];
  }
  if (active.length === 1) {
    const p = active[0];
    // Secondary: shift hue by 30-60° based on chroma
    const sH = (p.avgH + 45) % 360;
    return [p, { avgL: p.avgL * 0.9, avgC: p.avgC * 0.7, avgH: sH }];
  }

  const primary = active[0];
  // Find the most populated bin that is at least 60° away in hue
  let secondary = null;
  for (let i = 1; i < active.length; i++) {
    const hueDist = Math.abs(((active[i].avgH - primary.avgH + 540) % 360) - 180);
    if (hueDist >= 60) {
      secondary = active[i];
      break;
    }
  }
  if (!secondary) {
    secondary = active[1];
  }
  return [primary, secondary];
}

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

/**
 * Determine dark/light mode from median OKLCH luminance.
 * Returns 'dark' if avgL < 0.5, else 'light'.
 */
export function detectMode(avgL) {
  return avgL < 0.5 ? 'dark' : 'light';
}

// ---------------------------------------------------------------------------
// 14-token manifest assembly
// ---------------------------------------------------------------------------

/**
 * Given extracted color data and mode, produce the 14-token manifest.
 * @param {object} hist  from computeHistogram
 * @param {[object, object]} dominant  [primary, secondary] bins
 * @param {'dark'|'light'} mode
 * @returns {object} 14-token key/value map
 */
export function assembleTokens(hist, dominant, mode) {
  const dark = mode === 'dark';
  const [primary, secondary] = dominant;

  // --- Background ---
  // For dark mode, background is a slightly-lifted minL with low chroma tinted by primary hue.
  // For light mode, background is a high L near 0.96.
  const bgL = dark ? Math.min(0.18, hist.minL * 0.5 + 0.04) : 0.96;
  const bgC = dark ? Math.max(0.015, primary.avgC * 0.2) : 0.02;
  const bgHex = oklchToHex(bgL, bgC, primary.avgH);
  const [bgR, bgG, bgB] = hexToRgb(bgHex);

  // --- Accent ---
  // Primary dominant color, at mid-high lightness for good contrast on bg
  const accentC = Math.max(0.12, primary.avgC * 0.8);
  const accentL = dark
    ? Math.min(0.72, Math.max(0.5, primary.avgL + 0.1))
    : Math.max(0.4, Math.min(0.55, primary.avgL));
  const accentHex = oklchToHex(accentL, accentC, primary.avgH);

  // --- Text ---
  // Near-white (dark) or near-black (light)
  const textL = dark ? 0.92 : 0.12;
  const textC = dark ? 0.02 : 0.03;
  const textH = primary.avgH;
  let textHex = oklchToHex(textL, textC, textH);
  const [textR, textG, textB] = hexToRgb(textHex);

  // WCAG: ensure text/bg ≥ 4.5
  const crText = contrastRatioRgb(textR, textG, textB, bgR, bgG, bgB);
  if (crText < 4.5) {
    const adjustedL = dark ? Math.min(0.98, textL + 0.08) : Math.max(0.04, textL - 0.08);
    textHex = oklchToHex(adjustedL, textC, textH);
  }

  // --- Accent-hover ---
  const accentHoverL = dark ? accentL + 0.08 : accentL - 0.06;
  const accentHoverHex = oklchToHex(
    Math.max(0, Math.min(1, accentHoverL)),
    accentC * 1.1,
    primary.avgH,
  );

  // --- Accent-muted ---
  const accentMutedHex = oklchToHex(accentL, accentC * 0.5, primary.avgH);

  // --- bg-elevated, bg-overlay ---
  const bgElevatedL = dark ? bgL + 0.06 : bgL - 0.05;
  const bgOverlayL = dark ? bgL + 0.1 : bgL - 0.08;
  const bgElevatedHex = oklchToHex(Math.max(0, Math.min(1, bgElevatedL)), bgC, primary.avgH);
  const bgOverlayHex = oklchToHex(Math.max(0, Math.min(1, bgOverlayL)), bgC * 1.2, primary.avgH);

  // --- Border ---
  // Accent + alpha
  const borderR = hexToRgb(accentHex)[0];
  const borderG = hexToRgb(accentHex)[1];
  const borderB = hexToRgb(accentHex)[2];
  const borderAlpha = '26'; // ~15% alpha hex
  const borderHex = `#${borderR.toString(16).padStart(2, '0')}${borderG.toString(16).padStart(2, '0')}${borderB.toString(16).padStart(2, '0')}${borderAlpha}`;

  const borderStrongAlpha = '59'; // ~35% alpha hex
  const borderStrongHex = `#${borderR.toString(16).padStart(2, '0')}${borderG.toString(16).padStart(2, '0')}${borderB.toString(16).padStart(2, '0')}${borderStrongAlpha}`;

  // --- Text-muted ---
  const textMutedL = dark ? 0.6 : 0.45;
  const textMutedHex = oklchToHex(textMutedL, textC, primary.avgH);

  // --- Text-inverse ---
  const textInverseHex = dark
    ? oklchToHex(0.1, 0.02, primary.avgH)
    : oklchToHex(0.95, 0.02, primary.avgH);

  // --- Focus-ring ---
  const focusRingHex = oklchToHex(accentL, accentC * 1.1, primary.avgH);

  // --- Selection ---
  const selectionR = hexToRgb(accentHex)[0];
  const selectionG = hexToRgb(accentHex)[1];
  const selectionB = hexToRgb(accentHex)[2];
  const selectionHex = `#${selectionR.toString(16).padStart(2, '0')}${selectionG.toString(16).padStart(2, '0')}${selectionB.toString(16).padStart(2, '0')}52`; // ~32% alpha

  // --- Code-bg ---
  const codeBgL = dark ? bgL - 0.02 : bgL + 0.02;
  const codeBgHex = oklchToHex(Math.max(0, Math.min(1, codeBgL)), bgC * 1.5, primary.avgH);

  return {
    accent: accentHex,
    'accent-hover': accentHoverHex,
    'accent-muted': accentMutedHex,
    bg: bgHex,
    'bg-elevated': bgElevatedHex,
    'bg-overlay': bgOverlayHex,
    border: borderHex,
    'border-strong': borderStrongHex,
    text: textHex,
    'text-muted': textMutedHex,
    'text-inverse': textInverseHex,
    'focus-ring': focusRingHex,
    selection: selectionHex,
    'code-bg': codeBgHex,
  };
}

/**
 * WCAG contrast safety pass: iterate tokens and nudge L until ratios pass.
 */
export function enforceWcag(tokens, mode) {
  const dark = mode === 'dark';
  const [bgR, bgG, bgB] = hexToRgb(tokens.bg);
  const [accentR, accentG, accentB] = hexToRgb(tokens.accent);

  // Text / bg ≥ 4.5
  const [textR, textG, textB] = hexToRgb(tokens.text);
  if (contrastRatioRgb(textR, textG, textB, bgR, bgG, bgB) < 4.5) {
    tokens.text = dark ? '#ffffff' : '#000000';
  }

  // Accent / bg ≥ 3.0 (for large text / UI components)
  if (contrastRatioRgb(accentR, accentG, accentB, bgR, bgG, bgB) < 3.0) {
    const accentL = dark ? 0.7 : 0.45;
    const [, c, h] = rgbToOklch(accentR, accentG, accentB);
    tokens.accent = oklchToHex(accentL, Math.max(0.1, c), h);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// BMP file writer (used by tests for synthetic test images)
// ---------------------------------------------------------------------------

/**
 * Create a 24-bit uncompressed BMP buffer from a flat RGB array.
 * @param {number} width
 * @param {number} height
 * @param {(i: number) => [number, number, number]} pixelFn — returns [r,g,b] for pixel index i
 * @returns {Buffer}
 */
export function createTestBmp(width, height, pixelFn) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const dataOffset = 54;
  const dataSize = rowSize * height;
  const fileSize = dataOffset + dataSize;
  const buf = Buffer.alloc(fileSize);

  // File header
  buf[0] = 0x42; // 'B'
  buf[1] = 0x4d; // 'M'
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6); // reserved
  buf.writeUInt32LE(dataOffset, 10);

  // DIB header (BITMAPINFOHEADER)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26); // planes
  buf.writeUInt16LE(24, 28); // bpp
  buf.writeUInt32LE(0, 30); // compression
  buf.writeUInt32LE(dataSize, 34);
  buf.writeInt32LE(2835, 38); // h res (72 DPI)
  buf.writeInt32LE(2835, 42); // v res

  // Pixel data (bottom-up)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcY = height - 1 - y; // bottom-up storage
      const i = srcY * width + x;
      const [r, g, b] = pixelFn(i, x, srcY);
      const dst = dataOffset + y * rowSize + x * 3;
      buf[dst] = b;
      buf[dst + 1] = g;
      buf[dst + 2] = r;
    }
  }

  return buf;
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

/**
 * Extract a 14-token theme manifest from a BMP file buffer.
 * @param {Buffer} bmpBuffer
 * @param {object} [opts]
 * @param {number} [opts.maxSamples]
 * @returns {{ mode: string, tokens: Record<string,string>, meta: object }}
 */
export function extractTheme(bmpBuffer, opts = {}) {
  const { width, height, pixels } = decodeBmp(bmpBuffer);
  const hist = computeHistogram(pixels, width, height, opts);
  const dominant = pickPrimarySecondary(hist.bins);
  const mode = detectMode(hist.avgL);
  let tokens = assembleTokens(hist, dominant, mode);
  tokens = enforceWcag(tokens, mode);

  return {
    mode,
    tokens,
    meta: {
      width,
      height,
      avgL: Number(hist.avgL.toFixed(4)),
      avgChroma: Number(hist.avgChroma.toFixed(4)),
      dominantHue: Number(dominant[0].avgH.toFixed(1)),
      paletteColorCount: hist.bins.filter((b) => b.count > 0).length,
    },
  };
}
