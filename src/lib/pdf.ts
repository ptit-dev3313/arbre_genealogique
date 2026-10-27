import { zlibSync } from "fflate";
import {
  COUPLE_LINE_STROKE,
  COUPLE_SYMBOL_RADIUS,
  HEART_SIZE,
  MARRIED_CIRCLE_DX,
  STATUS_CROSS,
  STATUS_STROKE,
  WIRE_STROKE,
  buildLayout,
  heartPath,
  type TreeLayout,
} from "./layout";
import { clampPhotoSize, type FamilyDoc } from "./model";
import { personLifeDates } from "./lifeDates";

const MARGIN = 28;
const PHOTO_TOP = 12;
const CARD_RADIUS = 10;
const MAX_PAGE_PT = 14400;
const KAPPA = 0.5522847498;

type Rgb = [number, number, number];

function parseRgb(color: string): Rgb {
  const hex = color.trim().replace("#", "");
  if (hex.length === 6) {
    const n = Number.parseInt(hex, 16);
    if (Number.isFinite(n)) return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  return [0.51, 0.565, 0.6];
}

function rgbOp(rgb: Rgb, fill: boolean) {
  return `${fmt(rgb[0])} ${fmt(rgb[1])} ${fmt(rgb[2])} ${fill ? "rg" : "RG"}`;
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

function contentBox(layout: TreeLayout, photoSize: number, showPhotos: boolean) {
  const rects = Object.values(layout.personRects);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (showPhotos) minY -= Math.max(0, photoSize - PHOTO_TOP);
  const pad = 16;
  return { minX: minX - pad, minY: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

function loadImage(src: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const fromUrl = (url: string, cors: boolean) => {
      const img = new Image();
      if (cors) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(undefined);
      img.src = url;
    };
    if (src.startsWith("data:")) {
      fromUrl(src, false);
      return;
    }
    void fetch(src)
      .then((res) => (res.ok ? res.blob() : Promise.reject()))
      .then((blob) => fromUrl(URL.createObjectURL(blob), false))
      .catch(() => fromUrl(src, true));
  });
}

async function imageJpeg(img: HTMLImageElement, size: number): Promise<Uint8Array | undefined> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) return;
  return new Uint8Array(await blob.arrayBuffer());
}

const WINANSI: Record<string, number> = {
  "€": 128,
  "‚": 130,
  ƒ: 131,
  "„": 132,
  "…": 133,
  "†": 134,
  "‡": 135,
  ˆ: 136,
  "‰": 137,
  Š: 138,
  "‹": 139,
  Œ: 140,
  Ž: 142,
  "‘": 145,
  "’": 146,
  "“": 147,
  "”": 148,
  "•": 149,
  "–": 150,
  "—": 151,
  "˜": 152,
  "™": 153,
  š: 154,
  "›": 155,
  œ: 156,
  ž: 158,
  Ÿ: 159,
};

function winAnsiByte(ch: string): number {
  const u = ch.codePointAt(0) ?? 63;
  if (u < 128) return u;
  if (WINANSI[ch] != null) return WINANSI[ch];
  if (u >= 160 && u <= 255) return u;
  return 63;
}

function pdfLiteral(text: string): string {
  let out = "(";
  for (const ch of text) {
    const b = winAnsiByte(ch);
    if (b === 92 || b === 40 || b === 41) out += `\\${String.fromCharCode(b)}`;
    else if (b < 32 || b > 126) out += `\\${b.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(b);
  }
  return `${out})`;
}

function fitSize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, bold: boolean) {
  let next = size;
  const apply = () => {
    ctx.font = `${bold ? "bold " : ""}${next}px Helvetica, Arial, sans-serif`;
  };
  apply();
  while (next > 7 && ctx.measureText(text).width > maxWidth) {
    next -= 0.35;
    apply();
  }
  return next;
}

class PdfDoc {
  private objects: (string | { dict: string; stream: Uint8Array })[] = [];

  add(body: string) {
    this.objects.push(body);
    return this.objects.length;
  }

  addStream(dict: string, stream: Uint8Array) {
    this.objects.push({ dict, stream });
    return this.objects.length;
  }

  replace(id: number, body: string) {
    this.objects[id - 1] = body;
  }

  bytes(): Uint8Array {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const push = (text: string, bin?: Uint8Array) => {
      chunks.push(encoder.encode(text));
      if (bin) chunks.push(bin);
    };
    push("%PDF-1.4\n%\x80\x80\x80\x80\n");
    const offsets = [0];
    let cursor = chunks[0].length;
    for (let i = 0; i < this.objects.length; i++) {
      offsets[i + 1] = cursor;
      const obj = this.objects[i];
      const id = i + 1;
      if (typeof obj === "string") {
        const block = encoder.encode(`${id} 0 obj\n${obj}\nendobj\n`);
        chunks.push(block);
        cursor += block.length;
      } else {
        const head = encoder.encode(`${id} 0 obj\n${obj.dict}\nstream\n`);
        const tail = encoder.encode("\nendstream\nendobj\n");
        chunks.push(head, obj.stream, tail);
        cursor += head.length + obj.stream.length + tail.length;
      }
    }
    const xrefAt = cursor;
    let xref = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= this.objects.length; i++) {
      xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    push(xref);
    push(`trailer\n<< /Size ${this.objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const chunk of chunks) {
      out.set(chunk, o);
      o += chunk.length;
    }
    return out;
  }
}

export async function downloadSchematicPdf(
  family: FamilyDoc,
  showPhotos: boolean,
  photoUrls: Record<string, string>,
) {
  const layout = buildLayout(family);
  const rects = Object.values(layout.personRects);
  if (!rects.length) throw new Error("empty");
  const photoSize = clampPhotoSize(family.photo_size);
  const box = contentBox(layout, photoSize, showPhotos);
  const cssW = box.width + MARGIN * 2;
  const cssH = box.height + MARGIN * 2;
  const k = Math.min(72 / 96, MAX_PAGE_PT / Math.max(cssW, 1), MAX_PAGE_PT / Math.max(cssH, 1));
  const pageW = cssW * k;
  const pageH = cssH * k;
  const px = (x: number) => (x - box.minX + MARGIN) * k;
  const py = (y: number) => pageH - (y - box.minY + MARGIN) * k;
  const p = (x: number, y: number) => `${fmt(px(x))} ${fmt(py(y))}`;
  const sw = (w: number) => fmt(w * k);

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("canvas");
  const textCtx = measure;

  const raster = Math.max(128, Math.round(photoSize * 4));
  const photos = new Map<string, Uint8Array>();
  if (showPhotos) {
    await Promise.all(
      rects.map(async (rect) => {
        const person = family.persons[rect.personId];
        const src = person?.photo?.data ?? (person?.photo?.path ? photoUrls[person.photo.path] : undefined);
        if (!src) return;
        const img = await loadImage(src);
        if (!img) return;
        const jpeg = await imageJpeg(img, raster);
        if (jpeg) photos.set(rect.personId, jpeg);
      }),
    );
  }

  const pdf = new PdfDoc();
  pdf.add("<< /Type /Catalog /Pages 2 0 R >>");
  pdf.add("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  const pageId = pdf.add("<< >>");
  const fontReg = pdf.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBold = pdf.add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  const photoEntries = [...photos.entries()];
  const xobjects: string[] = [];
  photoEntries.forEach(([, jpeg], i) => {
    const obj = pdf.addStream(
      `<< /Type /XObject /Subtype /Image /Width ${raster} /Height ${raster} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
      jpeg,
    );
    xobjects.push(`/Im${i} ${obj} 0 R`);
  });
  const photoIndex = new Map(photoEntries.map(([id], i) => [id, i]));

  const ops: string[] = ["1 J 1 j", rgbOp(parseRgb("#f6f9fb"), true), `0 0 ${fmt(pageW)} ${fmt(pageH)} re f`];

  function polyline(points: [number, number][], width: number, color: string) {
    if (points.length < 2) return;
    ops.push(rgbOp(parseRgb(color), false), `${sw(width)} w`, `${p(points[0][0], points[0][1])} m`);
    for (let i = 1; i < points.length; i++) ops.push(`${p(points[i][0], points[i][1])} l`);
    ops.push("S");
  }

  function circlePath(cx: number, cy: number, r: number) {
    const ox = r * KAPPA;
    ops.push(`${p(cx + r, cy)} m`);
    ops.push(`${p(cx + r, cy - ox)} ${p(cx + ox, cy - r)} ${p(cx, cy - r)} c`);
    ops.push(`${p(cx - ox, cy - r)} ${p(cx - r, cy - ox)} ${p(cx - r, cy)} c`);
    ops.push(`${p(cx - r, cy + ox)} ${p(cx - ox, cy + r)} ${p(cx, cy + r)} c`);
    ops.push(`${p(cx + ox, cy + r)} ${p(cx + r, cy + ox)} ${p(cx + r, cy)} c`);
    ops.push("h");
  }

  function roundedRect(x: number, y: number, w: number, h: number, r: number) {
    const radius = Math.min(r, w / 2, h / 2);
    const ox = radius * KAPPA;
    ops.push(`${p(x + radius, y)} m`);
    ops.push(`${p(x + w - radius, y)} l`);
    ops.push(`${p(x + w - radius + ox, y)} ${p(x + w, y + radius - ox)} ${p(x + w, y + radius)} c`);
    ops.push(`${p(x + w, y + h - radius)} l`);
    ops.push(`${p(x + w, y + h - radius + ox)} ${p(x + w - radius + ox, y + h)} ${p(x + w - radius, y + h)} c`);
    ops.push(`${p(x + radius, y + h)} l`);
    ops.push(`${p(x + radius - ox, y + h)} ${p(x, y + h - radius + ox)} ${p(x, y + h - radius)} c`);
    ops.push(`${p(x, y + radius)} l`);
    ops.push(`${p(x, y + radius - ox)} ${p(x + radius - ox, y)} ${p(x + radius, y)} c`);
    ops.push("h B");
  }

  function drawHeart(cx0: number, cy0: number, s: number) {
    const nums = heartPath(cx0, cy0, s).match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
    if (nums.length < 8) return;
    ops.push(`${p(nums[0], nums[1])} m`);
    for (let i = 2; i + 5 < nums.length; i += 6) {
      ops.push(`${p(nums[i], nums[i + 1])} ${p(nums[i + 2], nums[i + 3])} ${p(nums[i + 4], nums[i + 5])} c`);
    }
    ops.push("h f");
  }

  function textLine(label: string, x: number, y: number, size: number, bold: boolean) {
    if (!label) return;
    const width = textCtx.measureText(label).width * k;
    ops.push("BT");
    ops.push(`/${bold ? "F2" : "F1"} ${fmt(size * k)} Tf`);
    ops.push(`${fmt(x - width / 2)} ${fmt(y)} Td`);
    ops.push(`${pdfLiteral(label)} Tj`);
    ops.push("ET");
  }

  for (const connector of layout.connectors) polyline(connector.points, WIRE_STROKE, connector.color);
  for (const couple of layout.coupleLines) {
    polyline(couple.points, COUPLE_LINE_STROKE, couple.color);
    const color = parseRgb(couple.color);
    ops.push(rgbOp(color, false), rgbOp(color, true), `${sw(STATUS_STROKE)} w`);
    if (couple.status === "Marié") {
      circlePath(couple.markX - MARRIED_CIRCLE_DX, couple.markY, COUPLE_SYMBOL_RADIUS);
      ops.push("S");
      circlePath(couple.markX + MARRIED_CIRCLE_DX, couple.markY, COUPLE_SYMBOL_RADIUS);
      ops.push("S");
    } else if (couple.status === "Engagé") {
      drawHeart(couple.markX, couple.markY, HEART_SIZE);
    } else {
      ops.push(`${p(couple.markX - STATUS_CROSS, couple.markY - STATUS_CROSS)} m`);
      ops.push(`${p(couple.markX + STATUS_CROSS, couple.markY + STATUS_CROSS)} l S`);
      if (couple.status !== "Séparé") {
        ops.push(`${p(couple.markX + STATUS_CROSS, couple.markY - STATUS_CROSS)} m`);
        ops.push(`${p(couple.markX - STATUS_CROSS, couple.markY + STATUS_CROSS)} l S`);
      }
    }
  }

  const cardFill = parseRgb("#fffdf8");
  const cardStroke = parseRgb("#5a7e94");
  const ink = parseRgb("#26374a");
  const photoRing = parseRgb("#47758f");

  for (const rect of rects) {
    const person = family.persons[rect.personId];
    ops.push(rgbOp(cardFill, true), rgbOp(cardStroke, false), `${sw(1.4)} w`);
    roundedRect(rect.x, rect.y, rect.width, rect.height, CARD_RADIUS);

    const photoI = photoIndex.get(rect.personId);
    if (photoI != null) {
      const d = photoSize;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + PHOTO_TOP - d / 2;
      const r = d / 2;
      ops.push("q");
      circlePath(cx, cy, r);
      ops.push("W n");
      ops.push(`${fmt(d * k)} 0 0 ${fmt(d * k)} ${fmt(px(cx - r))} ${fmt(py(cy + r))} cm`);
      ops.push(`/Im${photoI} Do`);
      ops.push("Q");
      ops.push(rgbOp(photoRing, false), `${sw(1.2)} w`);
      circlePath(cx, cy, r);
      ops.push("S");
    }

    const maxW = rect.width - 12;
    const given = person?.name ?? "";
    const familyName = person?.family_name ?? "";
    ops.push(rgbOp(ink, true));
    const dates = person ? personLifeDates(person) : [];
    const lines = [given, familyName, ...dates];
    const gap = Math.min(16, (rect.height - 16) / lines.length);
    const startY = rect.y + rect.height / 2 - ((lines.length - 1) * gap) / 2 + 4;
    lines.forEach((line, index) => {
      const size = fitSize(textCtx, line, maxW, Math.min(index < 2 ? 13 : 9, gap), index === 0);
      textLine(line, px(rect.x + rect.width / 2), py(startY + index * gap), size, index === 0);
    });
  }

  const compressed = zlibSync(new TextEncoder().encode(ops.join("\n")), { level: 6 });
  const contentId = pdf.addStream(`<< /Filter /FlateDecode /Length ${compressed.length} >>`, compressed);
  const xobjDict = xobjects.length ? ` /XObject << ${xobjects.join(" ")} >>` : "";
  pdf.replace(
    pageId,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageW)} ${fmt(pageH)}] /Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >>${xobjDict} >> /Contents ${contentId} 0 R >>`,
  );

  const pdfBytes = pdf.bytes();
  const copy = new ArrayBuffer(pdfBytes.byteLength);
  new Uint8Array(copy).set(pdfBytes);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([copy], { type: "application/pdf" }));
  a.download = `${family.name || "arbre"}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}
