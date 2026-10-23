export const MAX_PHOTO_BYTES = 150 * 1024;
export const CROP_VIEW = 280;
export const CROP_CIRCLE = 220;

export type CropDraft = {
  src: string;
  imgW: number;
  imgH: number;
  scale: number;
  panX: number;
  panY: number;
};

export function fitCrop(src: string, imgW: number, imgH: number): CropDraft {
  const w = Math.max(1, imgW);
  const h = Math.max(1, imgH);
  const scale = Math.max(CROP_CIRCLE / Math.min(w, h), (CROP_CIRCLE / Math.max(w, h)) * 0.9);
  const draft: CropDraft = { src, imgW: w, imgH: h, scale, panX: 0, panY: 0 };
  return clampCrop(centerCrop(draft));
}

export function centerCrop(draft: CropDraft): CropDraft {
  const w = draft.imgW * draft.scale;
  const h = draft.imgH * draft.scale;
  return { ...draft, panX: (CROP_VIEW - w) / 2, panY: (CROP_VIEW - h) / 2 };
}

export function clampCrop(draft: CropDraft): CropDraft {
  const minScale = CROP_CIRCLE / Math.max(1, Math.min(draft.imgW, draft.imgH));
  const scale = Math.min(minScale * 6, Math.max(minScale * 0.85, draft.scale));
  const w = draft.imgW * scale;
  const h = draft.imgH * scale;
  const inset = (CROP_VIEW - CROP_CIRCLE) / 2;
  let panX = draft.panX;
  let panY = draft.panY;
  if (w <= CROP_CIRCLE) panX = (CROP_VIEW - w) / 2;
  else {
    const minX = inset + CROP_CIRCLE - w;
    const maxX = inset;
    panX = Math.min(Math.max(panX, Math.min(minX, maxX)), Math.max(minX, maxX));
  }
  if (h <= CROP_CIRCLE) panY = (CROP_VIEW - h) / 2;
  else {
    const minY = inset + CROP_CIRCLE - h;
    const maxY = inset;
    panY = Math.min(Math.max(panY, Math.min(minY, maxY)), Math.max(minY, maxY));
  }
  return { ...draft, scale, panX, panY };
}

export async function fileToCrop(file: File): Promise<CropDraft> {
  if (file.size > 20 * 1024 * 1024) throw new Error("Photo trop lourde.");
  let src = URL.createObjectURL(file);
  let imgW = 0;
  let imgH = 0;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    URL.revokeObjectURL(src);
    src = canvas.toDataURL("image/jpeg", 0.92);
    imgW = canvas.width;
    imgH = canvas.height;
  } catch {
    const img = await loadImage(src);
    imgW = img.naturalWidth;
    imgH = img.naturalHeight;
  }
  return fitCrop(src, imgW, imgH);
}

export async function urlToJpegDataUrl(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const src = URL.createObjectURL(blob);
    try {
      const img = await loadImage(src);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, img.naturalWidth);
      canvas.height = Math.max(1, img.naturalHeight);
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      return canvas.toDataURL("image/jpeg", 0.92);
    } finally {
      URL.revokeObjectURL(src);
    }
  } catch {
    return;
  }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image illisible."));
    img.src = src;
  });
}

export async function cropToJpeg(draft: CropDraft): Promise<string> {
  const img = await loadImage(draft.src);
  const inset = (CROP_VIEW - CROP_CIRCLE) / 2;
  const size = 512;
  const k = size / CROP_CIRCLE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const dw = draft.imgW * draft.scale * k;
  const dh = draft.imgH * draft.scale * k;
  ctx.drawImage(img, (draft.panX - inset) * k, (draft.panY - inset) * k, dw, dh);
  let quality = 0.86;
  let data = canvas.toDataURL("image/jpeg", quality);
  while (data.length * 0.75 > MAX_PHOTO_BYTES && quality > 0.4) {
    quality -= 0.08;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  if (data.length * 0.75 > MAX_PHOTO_BYTES) {
    const smallSize = 160;
    const sk = smallSize / CROP_CIRCLE;
    canvas.width = smallSize;
    canvas.height = smallSize;
    const small = canvas.getContext("2d");
    if (!small) throw new Error("Canvas indisponible.");
    small.beginPath();
    small.arc(smallSize / 2, smallSize / 2, smallSize / 2, 0, Math.PI * 2);
    small.closePath();
    small.clip();
    small.drawImage(
      img,
      (draft.panX - inset) * sk,
      (draft.panY - inset) * sk,
      draft.imgW * draft.scale * sk,
      draft.imgH * draft.scale * sk,
    );
    data = canvas.toDataURL("image/jpeg", 0.72);
  }
  return data;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const body = dataUrl.split(",")[1] ?? "";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToJpegDataUrl(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

export async function urlToBytes(src: string): Promise<Uint8Array | undefined> {
  try {
    const response = await fetch(src);
    if (!response.ok) return;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return;
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, body] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(header)?.[1] ?? "image/jpeg";
  const bytes = atob(body);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function urlToDataUrl(src: string): Promise<string | undefined> {
  try {
    const response = await fetch(src);
    if (!response.ok) return;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return;
  }
}
