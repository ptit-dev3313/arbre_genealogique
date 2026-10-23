import type { Json } from "./database.types";
import {
  familyFromRow,
  familyToPayload,
  preferEditableTree,
  restoreReadonlyDisplay,
  type CloudRole,
  type FamilyDoc,
} from "./model";
import { dataUrlToBlob } from "./photo";
import { supabase } from "./supabase";

export type FamilyShare = {
  username: string;
  role: string;
  tree_ids: string[];
  can_edit_gap: boolean;
  can_edit_colors: boolean;
  can_edit_card_size: boolean;
};

function asRecord(value: Json | null): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
}

function friendlyAuth(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("invalid_grant")) return "E-mail ou mot de passe incorrect.";
  if (lower.includes("already registered") || lower.includes("already been registered"))
    return "Un compte existe déjà avec cet e-mail.";
  if (lower.includes("email not confirmed") || lower.includes("not confirmed"))
    return "Confirmez d’abord votre e-mail (lien reçu).";
  if (lower.includes("password") && lower.includes("6")) return "Mot de passe trop court (6 caractères minimum).";
  if (lower.includes("rate limit")) return "Trop de tentatives. Attendez un peu avant de renvoyer un e-mail.";
  if (
    lower.includes("signup_not_allowed") ||
    lower.includes("database error saving new user") ||
    lower.includes("not allowed")
  ) {
    return "Cet e-mail n’est pas autorisé à créer un compte.";
  }
  return message;
}

export function authError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return friendlyAuth(message);
}

export async function restoreLegacySession() {
  const raw = localStorage.getItem("arbre.auth.v1");
  if (!raw) return;
  try {
    const session = JSON.parse(raw) as { access_token?: string; refresh_token?: string };
    if (session.access_token && session.refresh_token) {
      await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
    }
  } catch {
    /* ignore */
  }
  localStorage.removeItem("arbre.auth.v1");
}

type MemberInfo = { role: CloudRole; trees: string[]; gap: boolean; colors: boolean; cards: boolean };

const lastPayloads = new Map<string, Record<string, unknown>>();

function snapshotPayload(family: FamilyDoc) {
  return familyToPayload({ ...family, cloudRole: "owner", cloudEditableTrees: [] });
}

export function rememberFamilyPayload(family: FamilyDoc) {
  if (!family.cloudId) return;
  lastPayloads.set(family.cloudId, snapshotPayload(family));
}

async function loadMemberships(): Promise<Map<string, MemberInfo>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Map();
  const { data, error } = await supabase
    .from("family_members")
    .select("family_id, role, tree_ids, can_edit_gap, can_edit_colors, can_edit_card_size")
    .eq("user_id", user.id);
  if (error || !data) return new Map();
  const map = new Map<string, MemberInfo>();
  for (const row of data) {
    map.set(row.family_id, {
      role: row.role === "owner" ? "owner" : "editor",
      trees: row.tree_ids ?? [],
      gap: row.can_edit_gap,
      colors: row.can_edit_colors,
      cards: row.can_edit_card_size,
    });
  }
  return map;
}

export async function listCloudFamilies(): Promise<FamilyDoc[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.rpc("list_my_families");
  if (error) throw new Error(error.message);
  const members = await loadMemberships();
  return (data ?? []).flatMap((row) => {
    const member = members.get(row.id);
    const role: CloudRole =
      member?.role ?? (row.created_by === user.id ? "owner" : "editor");
    let family = familyFromRow(row.id, row.name, row.payload, role, row.updated_at);
    family.cloudEditableTrees = member?.trees ?? [];
    family.cloudCanEditGap = member?.gap || role === "owner";
    family.cloudCanEditColors = member?.colors || role === "owner";
    family.cloudCanEditCardSize = member?.cards || role === "owner";
    family.cloudUserId = user.id;
    family = preferEditableTree(family);
    rememberFamilyPayload(family);
    return [family];
  });
}

export async function publishFamily(family: FamilyDoc): Promise<FamilyDoc> {
  const payload = familyToPayload(family) as Json;
  const { data, error } = await supabase.rpc("publish_family", {
    p_name: family.name,
    p_payload: payload,
  });
  if (error || !data) throw new Error(error?.message ?? "Publication impossible.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: row } = await supabase.from("families").select("updated_at").eq("id", data).maybeSingle();
  const published = {
    ...family,
    id: data,
    cloudId: data,
    cloudRole: "owner" as const,
    cloudUserId: user?.id,
    cloudUpdatedAt: row?.updated_at,
    cloudEditableTrees: [],
  };
  rememberFamilyPayload(published);
  return published;
}

export async function saveFamily(family: FamilyDoc, lockToken?: string, retried = false): Promise<FamilyDoc> {
  if (!family.cloudId) return publishFamily(family);
  const prepared = restoreReadonlyDisplay(family, lastPayloads.get(family.cloudId));
  const payload = familyToPayload(prepared);
  const { data, error } = await supabase.rpc("save_family", {
    p_id: family.cloudId,
    p_name: prepared.name,
    p_payload: payload as Json,
    p_expected_updated_at: family.cloudUpdatedAt,
    p_lock_token: lockToken,
  });
  if (error) throw new Error(error.message);
  const result = asRecord(data);
  if (result?.kind === "conflict") {
    const remoteAt = typeof result.updated_at === "string" ? result.updated_at : undefined;
    if (!retried && remoteAt && remoteAt !== family.cloudUpdatedAt) {
      return saveFamily({ ...family, cloudUpdatedAt: remoteAt }, lockToken, true);
    }
    throw new Error("Version distante différente. Rechargez la famille.");
  }
  const updatedAt = typeof result?.updated_at === "string" ? result.updated_at : family.cloudUpdatedAt;
  lastPayloads.set(family.cloudId, snapshotPayload(prepared));
  return { ...family, cloudUpdatedAt: updatedAt };
}

export async function acquireLock(familyId: string): Promise<{ kind: "acquired"; token: string } | { kind: "busy"; username: string }> {
  const { data, error } = await supabase.rpc("acquire_family_lock", { p_id: familyId });
  if (error) throw new Error(error.message);
  const result = asRecord(data);
  if (result?.kind === "acquired" && typeof result.token === "string") {
    return { kind: "acquired", token: result.token };
  }
  return { kind: "busy", username: typeof result?.username === "string" ? result.username : "quelqu’un" };
}

export async function heartbeatLock(familyId: string, token: string): Promise<"ok" | "lost"> {
  const { data, error } = await supabase.rpc("heartbeat_family_lock", { p_id: familyId, p_token: token });
  if (error) throw new Error(error.message);
  const result = asRecord(data);
  return result?.kind === "lost" ? "lost" : "ok";
}

export async function releaseLock(familyId: string, token: string) {
  await supabase.rpc("release_family_lock", { p_id: familyId, p_token: token });
}

export async function deleteCloudFamily(cloudId: string) {
  const { error } = await supabase.from("families").delete().eq("id", cloudId);
  if (error) throw new Error(error.message);
}

export async function leaveCloudFamily(cloudId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from("family_members").delete().eq("family_id", cloudId).eq("user_id", user.id);
  if (error) throw new Error(error.message);
}

export async function inviteToFamily(
  familyId: string,
  email: string,
  treeIds: string[],
  canEditDisplay: boolean,
  canEditColors: boolean,
) {
  const { error } = await supabase.rpc("invite_to_family", {
    p_family_id: familyId,
    p_username: email.trim().toLowerCase(),
    p_tree_ids: treeIds,
    p_can_edit_display: canEditDisplay,
    p_can_edit_colors: canEditColors,
  });
  if (error) throw new Error(error.message);
}

export async function listShares(familyId: string): Promise<FamilyShare[]> {
  const { data, error } = await supabase.rpc("list_family_shares", { p_family_id: familyId });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  return rows.flatMap((row) => {
    const rec = asRecord(row as Json);
    if (!rec || typeof rec.username !== "string") return [];
    return [
      {
        username: rec.username,
        role: typeof rec.role === "string" ? rec.role : "editor",
        tree_ids: Array.isArray(rec.tree_ids) ? rec.tree_ids.filter((id): id is string => typeof id === "string") : [],
        can_edit_gap: rec.can_edit_display === true || rec.can_edit_gap === true || rec.can_edit_card_size === true,
        can_edit_colors: rec.can_edit_colors === true,
        can_edit_card_size: rec.can_edit_display === true || rec.can_edit_card_size === true,
      },
    ];
  });
}

export async function setMemberTrees(
  familyId: string,
  username: string,
  treeIds: string[],
  canEditGap: boolean,
  canEditColors: boolean,
  canEditCardSize: boolean,
) {
  const { error } = await supabase.rpc("set_member_trees", {
    p_family_id: familyId,
    p_username: username.trim().toLowerCase(),
    p_tree_ids: treeIds,
    p_can_edit_gap: canEditGap,
    p_can_edit_colors: canEditColors,
    p_can_edit_card_size: canEditCardSize,
  });
  if (error) throw new Error(error.message);
}

export async function revokeShare(familyId: string, username: string) {
  const { error } = await supabase.rpc("revoke_family_share", {
    p_family_id: familyId,
    p_username: username.trim().toLowerCase(),
  });
  if (error) throw new Error(error.message);
}

export async function uploadPersonPhoto(familyId: string, personId: string, dataUrl: string) {
  const path = `${familyId}/${personId}.jpg`;
  const { error } = await supabase.storage.from("person-photos").upload(path, dataUrlToBlob(dataUrl), {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function deletePersonPhoto(path: string) {
  if (!path) return;
  await supabase.storage.from("person-photos").remove([path]);
}

export async function signedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const out: Record<string, string> = {};
  for (let i = 0; i < unique.length; i += 80) {
    const batch = unique.slice(i, i + 80);
    const { data, error } = await supabase.storage.from("person-photos").createSignedUrls(batch, 60 * 60 * 24 * 7);
    if (error) continue;
    (data ?? []).forEach((item, index) => {
      const path = item.path || batch[index];
      if (item.signedUrl && path) out[path] = item.signedUrl;
    });
  }
  return out;
}
