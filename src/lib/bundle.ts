import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { remapFamilyIds, workspaceFromFile, workspaceToFile, type FamilyDoc } from "./model";
import { bytesToJpegDataUrl, dataUrlToBytes, urlToBytes } from "./photo";

async function photoBytes(
  data: string | undefined,
  path: string | undefined,
  urls: Record<string, string>,
): Promise<Uint8Array | undefined> {
  if (data?.startsWith("data:")) return dataUrlToBytes(data);
  const src = path ? urls[path] : undefined;
  if (!src) return;
  if (src.startsWith("data:")) return dataUrlToBytes(src);
  return urlToBytes(src);
}

export async function exportFamilyZip(family: FamilyDoc, photoUrls: Record<string, string>): Promise<Blob> {
  const source = structuredClone(family);
  for (const person of Object.values(source.persons)) {
    if (!person.photo) continue;
    const bytes = await photoBytes(person.photo.data, person.photo.path, photoUrls);
    person.photo = bytes ? { data: bytesToJpegDataUrl(bytes), rev: String(Date.now()) } : undefined;
  }
  const exported = remapFamilyIds(source);
  const files: Record<string, Uint8Array> = {};
  for (const [personId, person] of Object.entries(exported.persons)) {
    const data = person.photo?.data;
    if (!data) {
      person.photo = undefined;
      continue;
    }
    const name = `photos/${exported.id}/${personId}.jpg`;
    files[name] = dataUrlToBytes(data);
    person.photo = { path: name, rev: person.photo?.rev ?? String(Date.now()) };
  }
  files["arbres.json"] = strToU8(workspaceToFile([exported], exported.id));
  return new Blob([zipSync(files)], { type: "application/zip" });
}

function attachZipPhotos(root: Record<string, unknown>, files: Record<string, Uint8Array>) {
  const byPerson = new Map<string, Uint8Array>();
  const byFamilyPerson = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) {
    const path = name.replaceAll("\\", "/");
    if (!path.endsWith(".jpg") && !path.endsWith(".jpeg")) continue;
    const parts = path.split("/").filter(Boolean);
    const file = parts[parts.length - 1] ?? "";
    const personId = file.replace(/\.jpe?g$/i, "");
    byPerson.set(personId, data);
    if (parts.length >= 2) byFamilyPerson.set(`${parts[parts.length - 2]}/${personId}`, data);
  }
  const families = Array.isArray(root.families) ? root.families : [root];
  for (const family of families) {
    if (!family || typeof family !== "object") continue;
    const rec = family as Record<string, unknown>;
    const familyId = typeof rec.id === "string" ? rec.id : "";
    const persons = rec.persons;
    if (!persons || typeof persons !== "object") continue;
    for (const [personId, person] of Object.entries(persons as Record<string, unknown>)) {
      if (!person || typeof person !== "object") continue;
      const bytes = byFamilyPerson.get(`${familyId}/${personId}`) ?? byPerson.get(personId);
      if (!bytes) continue;
      const target = person as Record<string, unknown>;
      const photo = target.photo && typeof target.photo === "object" ? { ...(target.photo as object) } : {};
      target.photo = { ...photo, data: bytesToJpegDataUrl(bytes) };
    }
  }
}

export function importFamilyBytes(name: string, bytes: Uint8Array) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const files = unzipSync(bytes);
    const jsonName = Object.keys(files).find((item) => item.replaceAll("\\", "/").endsWith(".json"));
    if (!jsonName || !files[jsonName]) throw new Error("ZIP sans fichier JSON.");
    const parsed = JSON.parse(strFromU8(files[jsonName])) as Record<string, unknown>;
    attachZipPhotos(parsed, files);
    return workspaceFromFile(JSON.stringify(parsed));
  }
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  return workspaceFromFile(text);
}
