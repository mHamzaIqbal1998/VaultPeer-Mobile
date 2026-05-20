/**
 * Database Parser
 *
 * Transforms kdbxweb's internal tree structure into the VaultPeer
 * type system (VaultEntry, VaultGroup, VaultMeta).
 *
 * This decouples the UI from kdbxweb internals so the rendering
 * layer never imports the crypto library directly.
 */

import type { Kdbx, KdbxEntry, KdbxGroup } from "kdbxweb";
import type { VaultEntry, VaultGroup, VaultMeta } from "@/src/types/kdbx";

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function toISOString(date: Date | undefined | null): string {
  if (!date) return new Date(0).toISOString();
  return date.toISOString();
}

function getFieldValue(entry: KdbxEntry, field: string): string {
  const val = entry.fields.get(field);
  if (!val) return "";
  // ProtectedValue has a getText() method; plain strings are returned as-is
  if (typeof val === "string") return val;
  if (typeof val === "object" && "getText" in val) {
    return (val as { getText(): string }).getText();
  }
  return String(val);
}

function uuidToString(uuid: { id: string } | string | undefined): string {
  if (!uuid) return "";
  if (typeof uuid === "string") return uuid;
  return uuid.id ?? "";
}

// ────────────────────────────────────────────
// Entry Parsing
// ────────────────────────────────────────────

/**
 * Convert a kdbxweb KdbxEntry into a VaultEntry.
 */
export function parseEntry(
  entry: KdbxEntry,
  parentGroupUuid: string
): VaultEntry {
  // Collect custom fields (exclude standard KeePass fields)
  const standardFields = new Set([
    "Title",
    "UserName",
    "Password",
    "URL",
    "Notes",
  ]);
  const fields: Record<string, string> = {};
  entry.fields.forEach((value, key) => {
    if (!standardFields.has(key)) {
      fields[key] =
        typeof value === "string"
          ? value
          : typeof value === "object" && "getText" in value
            ? (value as { getText(): string }).getText()
            : String(value);
    }
  });

  return {
    uuid: uuidToString(entry.uuid),
    title: getFieldValue(entry, "Title"),
    username: getFieldValue(entry, "UserName"),
    password: getFieldValue(entry, "Password"),
    url: getFieldValue(entry, "URL"),
    notes: getFieldValue(entry, "Notes"),
    iconId: entry.icon ?? 0,
    customIconUuid: entry.customIcon
      ? uuidToString(entry.customIcon)
      : undefined,
    createdAt: toISOString(entry.times?.creationTime),
    modifiedAt: toISOString(entry.times?.lastModTime),
    fields,
    tags: entry.tags ?? [],
    parentGroupUuid,
  };
}

// ────────────────────────────────────────────
// Group Parsing (Recursive)
// ────────────────────────────────────────────

/**
 * Recursively convert a kdbxweb KdbxGroup tree into VaultGroups.
 */
export function parseGroup(
  group: KdbxGroup,
  parentGroupUuid: string | null
): VaultGroup {
  const groupUuid = uuidToString(group.uuid);

  return {
    uuid: groupUuid,
    name: group.name ?? "Untitled",
    iconId: group.icon ?? 0,
    customIconUuid: group.customIcon
      ? uuidToString(group.customIcon)
      : undefined,
    entries: (group.entries ?? []).map((e) => parseEntry(e, groupUuid)),
    groups: (group.groups ?? []).map((g) => parseGroup(g, groupUuid)),
    parentGroupUuid,
  };
}

// ────────────────────────────────────────────
// Metadata Extraction
// ────────────────────────────────────────────

function countEntries(group: VaultGroup): number {
  return (
    group.entries.length +
    group.groups.reduce((sum, g) => sum + countEntries(g), 0)
  );
}

/**
 * Extract high-level metadata from an unlocked Kdbx database.
 */
export function parseMeta(db: Kdbx): VaultMeta {
  const root = db.getDefaultGroup();
  const parsedRoot = parseGroup(root, null);

  return {
    name: db.meta?.name ?? "Untitled Vault",
    description: db.meta?.desc ?? "",
    version: (db.header as unknown as { version?: number })?.version ?? 4,
    kdfName: getKdfName(db),
    lastModified: toISOString(db.meta?.settingsChanged ?? new Date()),
    entryCount: countEntries(parsedRoot),
    groupCount: parsedRoot.groups.length,
  };
}

/**
 * Derive a human-readable KDF name from the database header.
 */
function getKdfName(db: Kdbx): string {
  try {
    const kdfParams = (
      db.header as unknown as { kdfParameters?: Map<string, unknown> }
    )?.kdfParameters;
    if (!kdfParams) return "Unknown";

    const uuid = kdfParams.get("$UUID");
    if (!uuid) return "Unknown";

    // Standard KeePass KDF UUIDs
    const uuidStr = String(uuid);
    if (uuidStr.includes("ef636ddf")) return "Argon2d";
    if (uuidStr.includes("9e298b19")) return "Argon2id";
    if (uuidStr.includes("c9d9f39a")) return "AES-KDF";

    return "Custom KDF";
  } catch {
    return "Unknown";
  }
}

/**
 * Parse an entire database into the VaultPeer type system.
 */
export function parseDatabase(db: Kdbx): {
  meta: VaultMeta;
  rootGroup: VaultGroup;
} {
  const root = db.getDefaultGroup();
  const rootGroup = parseGroup(root, null);
  const meta = parseMeta(db);

  return { meta, rootGroup };
}
