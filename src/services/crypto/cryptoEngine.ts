/**
 * VaultPeer Crypto Engine
 *
 * Configures kdbxweb's built-in CryptoEngine with native Argon2 via JSI,
 * while retaining kdbxweb's WebCrypto-based AES-256-CBC and ChaCha20
 * implementations.
 *
 * Architecture Decision:
 *   kdbxweb already ships high-quality AES-CBC and ChaCha20 stream cipher
 *   implementations backed by WebCrypto (SubtleCrypto). The only bottleneck
 *   is Argon2 KDF, which we offload to the native JSI bridge for ~300ms
 *   unlock times vs. 15s+ in pure JS. This is the "Hybrid Approach" from
 *   the plan's Architecture Decision Log.
 */

import * as kdbxweb from "kdbxweb";
import { createKdbxArgon2Impl } from "./argon2Bridge";
import { Platform } from "react-native";

// ────────────────────────────────────────────
// Engine State
// ────────────────────────────────────────────

let _initialized = false;

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

/**
 * Initialize the crypto engine. Must be called once at app startup
 * before any database operations.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initCryptoEngine(): void {
  if (_initialized) return;

  if (Platform.OS !== "web") {
    // Register native Argon2 implementation for KDBX4 files
    const argon2Impl = createKdbxArgon2Impl();
    kdbxweb.CryptoEngine.setArgon2Impl(argon2Impl);
  }

  _initialized = true;
}

/**
 * Check whether the crypto engine has been initialized.
 */
export function isCryptoEngineReady(): boolean {
  return _initialized;
}

/**
 * Create kdbxweb credentials from a master password and optional key file.
 */
export function createCredentials(
  password?: string,
  keyFileData?: ArrayBuffer
): kdbxweb.Credentials {
  const protectedPassword = password
    ? kdbxweb.ProtectedValue.fromString(password)
    : null;

  return new kdbxweb.Credentials(protectedPassword, keyFileData ?? null);
}

/**
 * Decrypt and parse a .kdbx file buffer.
 *
 * @param data      Raw .kdbx file bytes
 * @param password  Master password (optional if key file is provided)
 * @param keyFile   Key file bytes (optional if password is provided)
 * @returns         Parsed Kdbx database instance
 * @throws          On invalid password, corrupt file, or unsupported version
 */
export async function decryptDatabase(
  data: ArrayBuffer,
  password?: string,
  keyFile?: ArrayBuffer
): Promise<kdbxweb.Kdbx> {
  if (!_initialized) {
    throw new Error(
      "[CryptoEngine] Engine not initialized. Call initCryptoEngine() first."
    );
  }

  const credentials = createCredentials(password, keyFile);
  return kdbxweb.Kdbx.load(data, credentials);
}

/**
 * Encrypt and serialize a Kdbx database to binary.
 *
 * @param db  The in-memory Kdbx database
 * @returns   Encrypted .kdbx file bytes
 */
export async function encryptDatabase(db: kdbxweb.Kdbx): Promise<ArrayBuffer> {
  if (!_initialized) {
    throw new Error(
      "[CryptoEngine] Engine not initialized. Call initCryptoEngine() first."
    );
  }

  return db.save();
}

/**
 * Create a brand new empty .kdbx database.
 *
 * @param name       Database name
 * @param password   Master password
 * @param keyFile    Optional key file data
 * @param options    Optional custom algorithms overrides
 * @returns          New Kdbx database instance
 */
export function createNewDatabase(
  name: string,
  password?: string,
  keyFile?: ArrayBuffer,
  options?: {
    kdf?: "Argon2id" | "Argon2d" | "AES-KDF";
    cipher?: "AES-256" | "ChaCha20";
    /** Raw KDF parameter overrides */
    kdfParams?: {
      rounds?: number;
      memory?: number;
      iterations?: number;
      parallelism?: number;
    };
  }
): kdbxweb.Kdbx {
  if (!_initialized) {
    throw new Error(
      "[CryptoEngine] Engine not initialized. Call initCryptoEngine() first."
    );
  }

  const credentials = createCredentials(password, keyFile);
  const db = kdbxweb.Kdbx.create(credentials, name);

  // Apply custom KDF overrides
  if (options?.kdf) {
    let kdfId: string;
    switch (options.kdf) {
      case "Argon2id":
        kdfId = "nimLGVbbR3OyPfw+xvCh5g==";
        break;
      case "Argon2d":
        kdfId = "72Nt34wpREuR96mkA+MKDA==";
        break;
      case "AES-KDF":
        kdfId = "ydnzmmKKRGC/dA0IwYpP6g==";
        break;
      default:
        kdfId = "nimLGVbbR3OyPfw+xvCh5g==";
    }
    db.setKdf(kdfId);
  }

  // Apply raw KDF parameters if provided
  if (options?.kdfParams) {
    applyKdfParams(db, options.kdfParams);
  }

  // Apply custom Cipher overrides
  if (options?.cipher) {
    let cipherId: string;
    switch (options.cipher) {
      case "AES-256":
        cipherId = "McHy5r9xQ1C+WAUhavxa/w==";
        break;
      case "ChaCha20":
        cipherId = "1gOKK4tvTLWlJDOaMdu1mg==";
        break;
      default:
        cipherId = "McHy5r9xQ1C+WAUhavxa/w==";
    }
    db.header.dataCipherUuid = new kdbxweb.KdbxUuid(cipherId);

    // Regenerate salts because IV length depends on the cipher
    db.header.generateSalts();
  }

  return db;
}

/**
 * Apply raw KDF parameters to an existing database's header.
 *
 * This writes directly to `db.header.kdfParameters` using the
 * standard KeePass parameter keys:
 * - AES-KDF: "R" (rounds as bigint for kdbxweb Int64)
 * - Argon2:  "M" (memory in bytes), "I" (iterations), "P" (parallelism)
 *
 * @param db      The in-memory Kdbx database
 * @param params  Raw KDF parameters to set
 */
export function applyKdfParams(
  db: kdbxweb.Kdbx,
  params: {
    rounds?: number;
    memory?: number;
    iterations?: number;
    parallelism?: number;
  }
): void {
  const kdfParameters = (
    db.header as unknown as { kdfParameters?: kdbxweb.VarDictionary }
  )?.kdfParameters;

  if (!kdfParameters) {
    console.warn("[CryptoEngine] No kdfParameters map found on header");
    return;
  }

  // AES-KDF uses "R" for rounds (stored as UInt64)
  if (params.rounds !== undefined) {
    kdfParameters.set(
      "R",
      kdbxweb.VarDictionary.ValueType.UInt64,
      kdbxweb.Int64.from(params.rounds)
    );
  }

  // Argon2 uses "M" for memory (in bytes), "I" for iterations, "P" for parallelism
  if (params.memory !== undefined) {
    kdfParameters.set(
      "M",
      kdbxweb.VarDictionary.ValueType.UInt64,
      kdbxweb.Int64.from(params.memory * 1024)
    );
  }
  if (params.iterations !== undefined) {
    kdfParameters.set(
      "I",
      kdbxweb.VarDictionary.ValueType.UInt64,
      kdbxweb.Int64.from(params.iterations)
    );
  }
  if (params.parallelism !== undefined) {
    kdfParameters.set(
      "P",
      kdbxweb.VarDictionary.ValueType.UInt32,
      params.parallelism
    );
  }
}
