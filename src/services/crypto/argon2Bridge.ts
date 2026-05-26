/**
 * Argon2 JSI Bridge
 *
 * Wraps `react-native-argon2-turbo` (TurboModule / JSI) to provide
 * native-speed Argon2 hashing for kdbxweb's CryptoEngine.
 *
 * On web / Expo Go, falls back to a warning since native modules
 * are unavailable — a WASM fallback can be plugged in later.
 */

import { Platform } from "react-native";
import { hash as argon2Hash } from "react-native-argon2-turbo";

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export interface Argon2HashRequest {
  password: Uint8Array;
  salt: Uint8Array;
  memory: number; // KiB
  iterations: number;
  hashLength: number;
  parallelism: number;
  type: number; // 0=d, 1=i, 2=id
  version: number; // 0x13 = 19
}

// ────────────────────────────────────────────
// Hex Utilities
// ────────────────────────────────────────────

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function argon2TypeToMode(type: number): "argon2d" | "argon2i" | "argon2id" {
  switch (type) {
    case 0:
      return "argon2d";
    case 1:
      return "argon2i";
    case 2:
    default:
      return "argon2id";
  }
}

// ────────────────────────────────────────────
// Native Argon2 Bridge
// ────────────────────────────────────────────

/**
 * Perform native Argon2 key derivation via JSI TurboModule.
 *
 * This function is designed to be registered with kdbxweb's
 * `CryptoEngine.setArgon2Impl()`.
 *
 * @returns Derived key bytes as ArrayBuffer
 */
export async function nativeArgon2Hash(
  request: Argon2HashRequest
): Promise<ArrayBuffer> {
  if (Platform.OS === "web") {
    throw new Error(
      "[Argon2Bridge] Native Argon2 is not available on web. " +
        "Provide a WASM-based fallback for web builds."
    );
  }

  try {
    const passwordHex = uint8ArrayToHex(request.password);
    const saltHex = uint8ArrayToHex(request.salt);

    const result = await argon2Hash({
      password: passwordHex,
      salt: saltHex,
      memory: request.memory,
      iterations: request.iterations,
      hashLength: request.hashLength,
      parallelism: request.parallelism,
      mode: argon2TypeToMode(request.type),
      passwordEncoding: "hex",
      saltEncoding: "hex",
    });

    // `rawHash` is a hex-encoded string of the derived key
    const derivedBytes = hexToUint8Array(result.rawHash);
    return derivedBytes.buffer as ArrayBuffer;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Argon2 error";
    throw new Error(`[Argon2Bridge] Native hashing failed: ${message}`);
  }
}

/**
 * Create the Argon2 implementation function with the signature
 * expected by `kdbxweb.CryptoEngine.setArgon2Impl()`.
 */
export function createKdbxArgon2Impl() {
  return async (
    password: ArrayBuffer,
    salt: ArrayBuffer,
    memory: number,
    iterations: number,
    length: number,
    parallelism: number,
    type: number,
    version: number
  ): Promise<ArrayBuffer> => {
    return nativeArgon2Hash({
      password: new Uint8Array(password),
      salt: new Uint8Array(salt),
      memory,
      iterations,
      hashLength: length,
      parallelism,
      type,
      version,
    });
  };
}
