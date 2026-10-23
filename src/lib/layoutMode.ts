/** One layout for every screen: pixels + aspect ratio, not two apps. */
export type LayoutMode = {
  compact: boolean;
  portrait: boolean;
};

export function layoutFromViewport(width: number, height: number): LayoutMode {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const ratio = w / h;
  const portrait = ratio <= 1;
  const shortSide = Math.min(w, h);
  const compact =
    shortSide < 700 ||
    w < 960 ||
    h < 620 ||
    (portrait && w < 1200);
  return { compact, portrait };
}
