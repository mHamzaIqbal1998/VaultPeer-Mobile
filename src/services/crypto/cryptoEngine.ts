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
 * @returns          New Kdbx database instance
 */
export function createNewDatabase(
  name: string,
  password?: string,
  keyFile?: ArrayBuffer
): kdbxweb.Kdbx {
  if (!_initialized) {
    throw new Error(
      "[CryptoEngine] Engine not initialized. Call initCryptoEngine() first."
    );
  }

  const credentials = createCredentials(password, keyFile);
  return kdbxweb.Kdbx.create(credentials, name);
}
