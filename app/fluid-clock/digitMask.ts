// Digit rasteriser: creates a small offscreen canvas, draws a bold glyph,
// and returns the set of pixel coordinates (normalized 0..1) where the
// glyph has alpha > 128. Results are cached so we never rasterise a glyph
// more than once — this keeps the RAF loop free of expensive work.
const CACHE = new Map<string, { x: number; y: number }[]>();

export function getDigitPixels(char: string): { x: number; y: number }[] {
  const key = String(char);
  const cached = CACHE.get(key);
  if (cached) return cached;

  // Size chosen to provide reasonable target density and aspect ratio.
  const W = 60;
  const H = 90;

  // OffscreenCanvas is preferred when available; otherwise fall back to
  // a regular canvas element. Using OffscreenCanvas avoids touching DOM.
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(W, H)
      : (globalThis.document?.createElement('canvas') as HTMLCanvasElement);

  canvas.width = W;
  canvas.height = H;

  const ctx = (canvas as any).getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) {
    CACHE.set(key, []);
    return [];
  }

  // Clear and draw glyph in white on transparent background.
  ctx.clearRect(0, 0, W, H);
  // Font size chosen to fill the canvas nicely; use bold for solid shapes.
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Use a fallback sans-serif font; weight bold to make shapes dense.
  ctx.font = 'bold 72px sans-serif';
  // Draw the glyph centred. A tiny vertical nudge improves visual centering.
  ctx.fillText(key, W / 2, H / 2 + 2);

  // Extract image data and collect pixels with alpha > 128
  const img = ctx.getImageData(0, 0, W, H).data;
  const pixels: { x: number; y: number }[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4 + 3; // alpha channel
      const a = img[idx];
      if (a > 128) {
        // Normalize to 0..1 so caller can scale into world coords.
        pixels.push({ x: x / (W - 1), y: y / (H - 1) });
      }
    }
  }

  CACHE.set(key, pixels);
  return pixels;
}
