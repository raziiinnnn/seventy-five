/**
 * In-memory OCR runner using Tesseract.js.
 *
 * Privacy rule: screenshot File objects are processed strictly in memory.
 * URL.createObjectURL → HTMLCanvasElement preprocessing → URL.revokeObjectURL
 * (always in `finally`). Zero image data is stored in IndexedDB or localStorage.
 *
 * Layout reconstruction:
 * ETLAB mobile screenshots use a 2-column card layout (course code/name on the
 * left, % and attended/total pill on the right). Tesseract's default page
 * segmentation often dumps the entire left column before the right column.
 * We ask Tesseract for `blocks: true`, extract every recognized word's bounding
 * box, group words sharing a horizontal row (`|yCenter - rowY| <= threshold`),
 * sort left-to-right by `bbox.x0`, and reconstruct reading order top-to-bottom.
 */

import { createWorker } from "tesseract.js";
import type { Block } from "tesseract.js";
import { mergeAndValidateOcrExtracts } from "@/engine/ocrParser";
import type { MultiOcrParseResult } from "@/engine/ocrParser";

export interface OcrProgress {
  imageIndex: number; // 1-based
  totalImages: number;
  progress: number;   // 0.0–1.0
  status: string;     // human-readable status phrase
}

interface PositionedWord {
  text: string;
  yCenter: number;
  x0: number;
}

// ---------------------------------------------------------------------------
// Image preprocessing (in-memory canvas, zero persistence)
// ---------------------------------------------------------------------------

/**
 * Loads an image File via an object URL, upscales 2x when width < 1000px,
 * and applies gentle grayscale + slight contrast stretch (NO hard binary
 * thresholding so light gray subtext and colored pills remain crisp).
 */
async function preprocessImageToCanvas(
  file: File
): Promise<{ canvas: HTMLCanvasElement; yThreshold: number }> {
  const url = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error(`Could not decode screenshot "${file.name}".`));
      el.src = url;
    });
  } finally {
    // Immediately revoke object URL as soon as image pixels are loaded or on failure
    URL.revokeObjectURL(url);
  }

  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;
  if (srcWidth === 0 || srcHeight === 0) {
    throw new Error(`Screenshot "${file.name}" has zero dimensions.`);
  }

  const scale = srcWidth < 1000 ? 2 : 1;
  const targetWidth = Math.round(srcWidth * scale);
  const targetHeight = Math.round(srcHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Could not acquire 2D canvas context for OCR.");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imageData.data;

  // Quick subsampled mean luminance to adapt pivot for light vs dark mode UI
  let sampleSum = 0;
  let sampleCount = 0;
  for (let i = 0; i < data.length; i += 64) {
    const r = data[i] ?? 255;
    const g = data[i + 1] ?? 255;
    const b = data[i + 2] ?? 255;
    sampleSum += 0.299 * r + 0.587 * g + 0.114 * b;
    sampleCount++;
  }
  const meanLum = sampleCount > 0 ? sampleSum / sampleCount : 200;
  const pivot = meanLum > 128 ? 172 : 85;
  const contrastFactor = 1.28;

  // Gentle grayscale + soft linear contrast stretch (preserves anti-aliasing)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const stretched = Math.max(
      0,
      Math.min(255, Math.round((lum - pivot) * contrastFactor + pivot))
    );
    data[i] = stretched;
    data[i + 1] = stretched;
    data[i + 2] = stretched;
  }

  ctx.putImageData(imageData, 0, 0);

  // Scaled ~20px vertical tolerance (adapted around ~1080px working width)
  const yThreshold = Math.max(16, Math.min(26, Math.round(20 * (targetWidth / 1080))));
  return { canvas, yThreshold };
}

// ---------------------------------------------------------------------------
// Horizontal row reconstruction from Tesseract word bounding boxes
// ---------------------------------------------------------------------------

/**
 * Flattens Tesseract `blocks -> paragraphs -> lines -> words`, groups words
 * whose vertical centers `(y0 + y1) / 2` lie within `yThreshold` pixels,
 * sorts each row left-to-right by `bbox.x0`, and joins rows top-to-bottom.
 */
function reconstructHorizontalLines(
  blocks: Block[] | null | undefined,
  yThreshold: number
): string | null {
  if (!blocks || blocks.length === 0) return null;

  const words: PositionedWord[] = [];
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const lineWords = line.words ?? [];
        if (lineWords.length > 0) {
          for (const word of lineWords) {
            const text = word.text?.trim();
            if (!text || !word.bbox) continue;
            words.push({
              text,
              yCenter: (word.bbox.y0 + word.bbox.y1) / 2,
              x0: word.bbox.x0,
            });
          }
        } else if (line.text?.trim() && line.bbox) {
          words.push({
            text: line.text.trim(),
            yCenter: (line.bbox.y0 + line.bbox.y1) / 2,
            x0: line.bbox.x0,
          });
        }
      }
    }
  }

  if (words.length === 0) return null;

  // Sort strictly top-to-bottom first so close baselines cluster reliably
  words.sort((a, b) => a.yCenter - b.yCenter || a.x0 - b.x0);

  const rows: Array<{ avgY: number; words: PositionedWord[] }> = [];

  for (const word of words) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(word.yCenter - lastRow.avgY) <= yThreshold) {
      lastRow.words.push(word);
      const count = lastRow.words.length;
      lastRow.avgY = (lastRow.avgY * (count - 1) + word.yCenter) / count;
    } else {
      rows.push({ avgY: word.yCenter, words: [word] });
    }
  }

  rows.sort((a, b) => a.avgY - b.avgY);

  const reconstructed = rows
    .map((row) =>
      row.words
        .slice()
        .sort((a, b) => a.x0 - b.x0)
        .map((w) => w.text)
        .join(" ")
    )
    .join("\n")
    .trim();

  return reconstructed.length > 0 ? reconstructed : null;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Runs Tesseract OCR on 1–4 screenshot File objects in sequence, reconstructing
 * horizontal 2-column reading lines from word bounding boxes, then merges and
 * validates all extracted texts via the pure engine parser.
 *
 * Images are never stored in IndexedDB or localStorage.
 */
export async function runMultiImageOcr(
  files: File[],
  onProgress?: (info: OcrProgress) => void
): Promise<MultiOcrParseResult> {
  if (files.length < 1 || files.length > 4) {
    throw new Error("Please select 1 to 4 screenshots.");
  }

  const rawTexts: string[] = [];
  let activeImageIdx = 0;

  // Single worker reused across the batch so English traineddata loads once
  const worker = await createWorker("eng", 1, {
    logger: (msg) => {
      if (msg.status === "recognizing text") {
        const fileProgress = Math.max(0, Math.min(1, msg.progress));
        onProgress?.({
          imageIndex: activeImageIdx + 1,
          totalImages: files.length,
          progress: (activeImageIdx + fileProgress) / files.length,
          status: `Scanning screenshot ${activeImageIdx + 1} of ${files.length}…`,
        });
      }
    },
  });

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      activeImageIdx = i;
      onProgress?.({
        imageIndex: i + 1,
        totalImages: files.length,
        progress: i / files.length,
        status: `Preprocessing screenshot ${i + 1} of ${files.length}…`,
      });

      const { canvas, yThreshold } = await preprocessImageToCanvas(file);

      onProgress?.({
        imageIndex: i + 1,
        totalImages: files.length,
        progress: i / files.length,
        status: `Scanning screenshot ${i + 1} of ${files.length}…`,
      });

      // Tesseract.js v7 defaults `blocks` to false — enable explicitly for bboxes
      const { data } = await worker.recognize(
        canvas,
        {},
        { text: true, blocks: true }
      );

      const reconstructed = reconstructHorizontalLines(data.blocks, yThreshold);
      rawTexts.push(reconstructed ?? data.text);

      onProgress?.({
        imageIndex: i + 1,
        totalImages: files.length,
        progress: (i + 1) / files.length,
        status:
          i + 1 === files.length
            ? "Parsing results…"
            : `Scanning screenshot ${i + 2} of ${files.length}…`,
      });
    }
  } finally {
    await worker.terminate();
  }

  return mergeAndValidateOcrExtracts(rawTexts);
}
