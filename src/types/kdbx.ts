/**
 * TypeScript type definitions for VaultPeer's KeePass (.kdbx) data model.
 *
 * These types are intentionally decoupled from kdbxweb internals so that
 * the UI layer never imports the crypto engine directly.
 */

// ────────────────────────────────────────────
// Credential Types
// ────────────────────────────────────────────

/** Supported credential mechanisms for unlocking a vault */
export interface VaultCredentials {
  /** Master password (plaintext is only held in memory during unlock) */
  password?: string;
  /** Key file contents as raw bytes */
  keyFileData?: ArrayBuffer;
}

// ────────────────────────────────────────────
// Database Metadata
// ────────────────────────────────────────────

/** High-level information about the opened vault */
export interface VaultMeta {
  name: string;
  description: string;
  /** KDBX file format version (3 or 4) */
  version: number;
  /** Key derivation function identifier */
  kdfName: string;
  /** Encryption cipher name */
  cipherName: string;
  /** ISO-8601 timestamp of last database modification */
  lastModified: string;
  /** Number of total entries across all groups */
  entryCount: number;
  /** Number of top-level groups */
  groupCount: number;
}

// ────────────────────────────────────────────
// Entry / Group Model
// ────────────────────────────────────────────

export interface VaultAttachment {
  id: string;
  name: string;
  size: number;
  /** Base64 encoded binary data */
  data: string;
}

/** A single password entry */
export interface VaultEntry {
  uuid: string;
  title: string;
  username: string;
  /** Password is stored as a protected value — never log this */
  password: string;
  url: string;
  notes: string;
  /** Icon index from the KeePass built-in icon set */
  iconId: number;
  /** Custom icon UUID (if set) */
  customIconUuid?: string;
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last modification timestamp */
  modifiedAt: string;
  /** Arbitrary custom string fields */
  fields: Record<string, string>;
  /** Names of custom fields that are secure (stored as ProtectedValue) */
  secureFields: string[];
  /** Entry attachments */
  attachments: VaultAttachment[];
  /** Whether the entry has an expiration date set */
  expires: boolean;
  /** ISO-8601 expiration timestamp */
  expiryTime?: string;
  /** Entry tags */
  tags: string[];
  /** Parent group UUID */
  parentGroupUuid: string;
}

/** A folder / group node in the KeePass tree */
export interface VaultGroup {
  uuid: string;
  name: string;
  iconId: number;
  customIconUuid?: string;
  /** Direct child entries */
  entries: VaultEntry[];
  /** Nested sub-groups */
  groups: VaultGroup[];
  /** Parent group UUID (null for root) */
  parentGroupUuid: string | null;
}

// ────────────────────────────────────────────
// KDF / Crypto Configuration
// ────────────────────────────────────────────

/** Parameters for Argon2 key derivation (KDBX4) */
export interface Argon2Params {
  salt: Uint8Array;
  memory: number; // in KiB
  iterations: number;
  parallelism: number;
  hashLength: number;
  type: number; // 0 = Argon2d, 1 = Argon2i, 2 = Argon2id
  version: number;
}

/** Parameters for AES-KDF key derivation (KDBX3) */
export interface AesKdfParams {
  seed: Uint8Array;
  rounds: number;
}

/** Union of supported KDF parameter sets */
export type KdfParams = Argon2Params | AesKdfParams;

// ────────────────────────────────────────────
// Vault State
// ────────────────────────────────────────────

/** Possible states of the vault lifecycle */
export type VaultState =
  | "idle" // No database loaded
  | "loading" // Decryption / parsing in progress
  | "unlocked" // Database is open and readable
  | "locked" // Database in memory but key purged
  | "error"; // Decryption or I/O failure

/** Error information from a failed vault operation */
export interface VaultError {
  code:
    | "INVALID_PASSWORD"
    | "CORRUPT_FILE"
    | "UNSUPPORTED_VERSION"
    | "IO_ERROR"
    | "ARGON2_FAILURE"
    | "UNKNOWN";
  message: string;
}
