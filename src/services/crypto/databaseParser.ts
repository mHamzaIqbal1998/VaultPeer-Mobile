/**
 * Database Parser
 *
 * Transforms kdbxweb's internal tree structure into the VaultPeer
 * type system (VaultEntry, VaultGroup, VaultMeta).
 *
 * This decouples the UI from kdbxweb internals so the rendering
 * layer never imports the crypto library directly.
 */

import { KdbxUuid, ProtectedValue } from "kdbxweb";
import type {
  Kdbx,
  KdbxEntry,
  KdbxGroup,
  KdbxBinary,
  KdbxBinaryWithHash,
} from "kdbxweb";
import type {
  VaultEntry,
  VaultGroup,
  VaultMeta,
  VaultAttachment,
} from "@/src/types/kdbx";

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
    "otp",
    "TimeOtp",
    "totp",
  ]);
  const fields: Record<string, string> = {};
  const secureFields: string[] = [];
  entry.fields.forEach((value, key) => {
    if (!standardFields.has(key)) {
      const isSecure =
        typeof value === "object" && value !== null && "getText" in value;
      if (isSecure) {
        secureFields.push(key);
      }
      fields[key] =
        typeof value === "string"
          ? value
          : typeof value === "object" && "getText" in value
            ? (value as { getText(): string }).getText()
            : String(value);
    }
  });

  const attachments: VaultAttachment[] = [];
  if (entry.binaries) {
    entry.binaries.forEach((binVal, key) => {
      let rawBin: KdbxBinary;
      if (binVal && typeof binVal === "object" && "value" in binVal) {
        rawBin = (binVal as KdbxBinaryWithHash).value;
      } else {
        rawBin = binVal as KdbxBinary;
      }

      if (rawBin) {
        let size = 0;
        const anyBin = rawBin as any;
        if (
          anyBin instanceof ProtectedValue ||
          (typeof anyBin === "object" && "toBase64" in anyBin)
        ) {
          size = anyBin.byteLength ?? 0;
        } else if (anyBin instanceof ArrayBuffer) {
          size = anyBin.byteLength;
        } else if (anyBin instanceof Uint8Array) {
          size = anyBin.byteLength;
        }

        attachments.push({
          id: key,
          name: key,
          size,
          data: "", // Avoid loading base64 data upfront to prevent UI blocking
        });
      }
    });
  }

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
    secureFields,
    attachments,
    expires: !!entry.times?.expires,
    expiryTime: entry.times?.expiryTime
      ? toISOString(entry.times.expiryTime)
      : undefined,
    tags: entry.tags ?? [],
    otp:
      getFieldValue(entry, "otp") ||
      getFieldValue(entry, "TimeOtp") ||
      getFieldValue(entry, "totp") ||
      undefined,
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

function base64ToHex(b64: string): string {
  try {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
      lookup[chars.charCodeAt(i)] = i;
    }
    const bufferLength = b64.length * 0.75;
    const len = b64.length;
    let p = 0;
    const bytes = new Uint8Array(bufferLength);
    for (let i = 0; i < len; i += 4) {
      const encoded1 = lookup[b64.charCodeAt(i)];
      const encoded2 = lookup[b64.charCodeAt(i + 1)];
      const encoded3 = lookup[b64.charCodeAt(i + 2)];
      const encoded4 = lookup[b64.charCodeAt(i + 3)];
      bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
    let hex = "";
    for (let i = 0; i < p; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex.slice(0, 32);
  } catch {
    return "";
  }
}

function uuidToHex(uuid: any): string {
  if (!uuid) return "";
  if (typeof uuid === "string") {
    if (uuid.endsWith("==") || uuid.length === 24) {
      const decoded = base64ToHex(uuid);
      if (decoded) return decoded;
    }
    return uuid;
  }
  let bytes: ArrayBuffer | Uint8Array;
  if (uuid instanceof KdbxUuid) {
    bytes = uuid.toBytes();
  } else if (uuid.bytes instanceof ArrayBuffer) {
    bytes = uuid.bytes;
  } else if (typeof uuid.toBytes === "function") {
    bytes = uuid.toBytes();
  } else if (uuid instanceof ArrayBuffer || uuid instanceof Uint8Array) {
    bytes = uuid;
  } else if (typeof uuid === "object" && uuid !== null) {
    if (uuid.id && typeof uuid.id === "string") {
      const idStr = uuid.id;
      if (idStr.endsWith("==") || idStr.length === 24) {
        const decoded = base64ToHex(idStr);
        if (decoded) return decoded;
      }
      return idStr;
    }
    bytes = new Uint8Array(Object.values(uuid) as number[]);
  } else {
    return String(uuid);
  }

  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = "";
  for (let i = 0; i < uint8.length; i++) {
    hex += uint8[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Derive a human-readable encryption cipher name from the database header.
 */
function getCipherName(db: Kdbx): string {
  try {
    const cipherUuid = (db.header as unknown as { dataCipherUuid?: unknown })
      ?.dataCipherUuid;
    if (!cipherUuid) return "AES-256";

    const hex = uuidToHex(cipherUuid);
    if (hex.includes("31c1f2e6") || hex === "McHy5r9xQ1C+WAUhavxa/w==")
      return "AES-256";
    if (hex.includes("d6038a2b") || hex === "1gOKK4tvTLWlJDOaMdu1mg==")
      return "ChaCha20";

    return "Custom Cipher";
  } catch {
    return "AES-256";
  }
}

/**
 * Extract high-level metadata from an unlocked Kdbx database.
 */
export function parseMeta(db: Kdbx, rootGroup?: VaultGroup): VaultMeta {
  const parsedRoot = rootGroup || parseGroup(db.getDefaultGroup(), null);
  const comp = (db.header as any)?.compression;
  const compression = comp === 0 ? "None" : "GZip";

  return {
    name: db.meta?.name ?? "Untitled Vault",
    description: db.meta?.desc ?? "",
    version: (db.header as unknown as { version?: number })?.version ?? 4,
    kdfName: getKdfName(db),
    cipherName: getCipherName(db),
    lastModified: toISOString(db.meta?.settingsChanged ?? new Date()),
    entryCount: countEntries(parsedRoot),
    groupCount: parsedRoot.groups.length,
    compression,
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
    const uuidStr = uuidToHex(uuid);
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
  const meta = parseMeta(db, rootGroup);

  return { meta, rootGroup };
}
