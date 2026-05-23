/**
 * WebCrypto API Polyfill for React Native — Native JSI Edition
 *
 * Forwards `global.crypto.subtle` calls directly to `react-native-quick-crypto`'s
 * native C++ JSI implementation for hardware-speed AES-CBC, SHA-256/512, and HMAC.
 *
 * This replaces the previous pure-JS `crypto-js` polyfill which was the primary
 * bottleneck for databases using strong AES-KDF configurations (10K+ rounds).
 *
 * Architecture Decision (plan.md §4 — Native SubtleCrypto Polyfill):
 *   Global polyfill using react-native-quick-crypto elevates AES-KDF, AES-CBC
 *   decryption, and HMAC hashing to native C++ speeds (~100–200ms) without
 *   altering any database parsing or UI code.
 *
 * Error Handling:
 *   All native JSI errors are wrapped in DOMException-compatible objects to
 *   maintain spec alignment with the W3C WebCrypto API.
 */

import { Platform } from "react-native";
import * as ExpoCrypto from "expo-crypto";
import CryptoJS from "crypto-js";

// ────────────────────────────────────────────
// DOMException Wrapper
// ────────────────────────────────────────────

/**
 * Lightweight DOMException polyfill for React Native.
 * Aligns native JSI error signatures with the W3C WebCrypto API spec.
 */
class CryptoDOMException extends Error {
  readonly code: number;

  constructor(message: string, name: string = "OperationError") {
    super(message);
    this.name = name;
    // Standard DOMException error codes
    switch (name) {
      case "NotSupportedError":
        this.code = 9;
        break;
      case "InvalidAccessError":
        this.code = 15;
        break;
      case "DataError":
        this.code = 0;
        break;
      case "OperationError":
      default:
        this.code = 0;
        break;
    }
  }
}

/**
 * Wraps a native error into a DOMException-compatible error with the correct
 * WebCrypto error name for the operation context.
 */
function wrapDOMException(
  error: unknown,
  operationName: string,
  errorName: string = "OperationError"
): CryptoDOMException {
  const message = error instanceof Error ? error.message : String(error);
  return new CryptoDOMException(
    `[WebCryptoPolyfill] ${operationName} failed: ${message}`,
    errorName
  );
}

// ────────────────────────────────────────────
// Algorithm Name Normalization
// ────────────────────────────────────────────

function normalizeAlgorithmName(algorithm: string | { name: string }): string {
  const name = typeof algorithm === "string" ? algorithm : algorithm.name;
  return name.toUpperCase().replace(/\s/g, "");
}

// ────────────────────────────────────────────
// Native Quick Crypto Loader
// ────────────────────────────────────────────

type QuickCryptoModule = {
  webcrypto: {
    subtle: SubtleCrypto;
    getRandomValues: <T extends ArrayBufferView>(array: T) => T;
  };
  install?: () => void;
};

let _nativeModule: QuickCryptoModule | null = null;
let _loadAttempted = false;

/**
 * Lazily loads the react-native-quick-crypto module.
 * Returns null if the native module is not available (e.g., Expo Go, web).
 */
function getNativeModule(): QuickCryptoModule | null {
  if (_loadAttempted) return _nativeModule;
  _loadAttempted = true;

  if (Platform.OS === "web") {
    return null;
  }

  try {
    // Dynamic require to avoid Metro resolution failures in Expo Go
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-quick-crypto") as QuickCryptoModule;
    if (mod.install) {
      mod.install();
    }
    _nativeModule = mod;
    console.log(
      "[WebCryptoPolyfill] Native JSI crypto engine loaded successfully."
    );
  } catch (e) {
    console.warn(
      "[WebCryptoPolyfill] react-native-quick-crypto not available, " +
        "falling back to JS implementation.",
      e instanceof Error ? e.message : e
    );
    _nativeModule = null;
  }
  return _nativeModule;
}

// ────────────────────────────────────────────
// JS Fallback Helpers (for Expo Go / test environments)
// ────────────────────────────────────────────

function wordArrayToArrayBuffer(
  wordArray: CryptoJS.lib.WordArray
): ArrayBuffer {
  const words = wordArray.words;
  const sigBytes = wordArray.sigBytes;
  const buffer = new ArrayBuffer(sigBytes);
  const uint8View = new Uint8Array(buffer);
  let dst = 0;
  for (let i = 0; i < sigBytes; i++) {
    const word = words[i >>> 2];
    const byte = (word >>> (24 - (i % 4) * 8)) & 0xff;
    uint8View[dst++] = byte;
  }
  return buffer;
}

function arrayBufferToWordArray(
  ab: ArrayBuffer | Uint8Array
): CryptoJS.lib.WordArray {
  const uint8View = ab instanceof Uint8Array ? ab : new Uint8Array(ab);
  const words: number[] = [];
  for (let i = 0; i < uint8View.length; i++) {
    words[i >>> 2] |= uint8View[i] << (24 - (i % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, uint8View.length);
}

// ────────────────────────────────────────────
// Unified SubtleCrypto Implementation
// ────────────────────────────────────────────

/**
 * Coerce any data argument into a plain Uint8Array for the native bridge.
 */
function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

// ── getRandomValues ──

const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
  if (!array) return array;

  const native = getNativeModule();
  if (native?.webcrypto?.getRandomValues) {
    return native.webcrypto.getRandomValues(array as any) as any;
  }

  // Fallback to expo-crypto
  return ExpoCrypto.getRandomValues(array as any) as any;
};

// ── digest ──

const digest = async (
  algorithm: string | { name: string },
  data: ArrayBuffer | ArrayBufferView
): Promise<ArrayBuffer> => {
  const algoName = normalizeAlgorithmName(algorithm);

  const native = getNativeModule();
  if (native?.webcrypto?.subtle) {
    try {
      const uint8Data = toUint8Array(data);
      return await native.webcrypto.subtle.digest(
        algoName === "SHA-256"
          ? "SHA-256"
          : algoName === "SHA-512"
            ? "SHA-512"
            : algoName,
        uint8Data as any
      );
    } catch (error) {
      throw wrapDOMException(error, `digest(${algoName})`, "OperationError");
    }
  }

  // JS fallback via expo-crypto
  let expoAlgo: ExpoCrypto.CryptoDigestAlgorithm;
  if (algoName === "SHA-256") {
    expoAlgo = ExpoCrypto.CryptoDigestAlgorithm.SHA256;
  } else if (algoName === "SHA-512") {
    expoAlgo = ExpoCrypto.CryptoDigestAlgorithm.SHA512;
  } else {
    throw new CryptoDOMException(
      `Unsupported digest algorithm: ${algoName}`,
      "NotSupportedError"
    );
  }

  const typedArray = toUint8Array(data);
  return ExpoCrypto.digest(expoAlgo, typedArray as any);
};

// ── importKey ──

const importKey = async (
  format: "raw",
  keyData: ArrayBuffer | Uint8Array,
  algorithm: any,
  extractable: boolean,
  keyUsages: string[]
): Promise<any> => {
  if (format !== "raw") {
    throw new CryptoDOMException(
      `Unsupported key format: ${format}`,
      "NotSupportedError"
    );
  }

  const native = getNativeModule();
  if (native?.webcrypto?.subtle) {
    try {
      const rawKey = toUint8Array(keyData);
      return await native.webcrypto.subtle.importKey(
        "raw",
        rawKey as any,
        algorithm,
        extractable,
        keyUsages as any
      );
    } catch (error) {
      throw wrapDOMException(error, "importKey", "DataError");
    }
  }

  // JS fallback: return a key-like object with the raw bytes
  const rawKey =
    keyData instanceof Uint8Array ? keyData : new Uint8Array(keyData);
  return {
    type: "secret",
    extractable,
    algorithm,
    usages: keyUsages,
    _rawKey: rawKey,
  };
};

// ── sign (HMAC) ──

const sign = async (
  algorithm: any,
  key: any,
  data: ArrayBuffer
): Promise<ArrayBuffer> => {
  const algoName = normalizeAlgorithmName(algorithm);

  if (algoName !== "HMAC") {
    throw new CryptoDOMException(
      `Unsupported sign algorithm: ${algoName}`,
      "NotSupportedError"
    );
  }

  const native = getNativeModule();
  if (native?.webcrypto?.subtle) {
    try {
      return await native.webcrypto.subtle.sign(algorithm, key, data);
    } catch (error) {
      throw wrapDOMException(error, "sign(HMAC)", "OperationError");
    }
  }

  // JS fallback via crypto-js
  const rawKey = key._rawKey;
  if (!rawKey) {
    throw new CryptoDOMException(
      "Invalid HMAC key: missing raw key data.",
      "InvalidAccessError"
    );
  }

  const keyWordArray = arrayBufferToWordArray(rawKey);
  const dataWordArray = arrayBufferToWordArray(data);

  // Determine hash function from key's algorithm metadata
  const hashName =
    key.algorithm?.hash?.name?.toUpperCase?.() ??
    algorithm?.hash?.name?.toUpperCase?.() ??
    "SHA-256";

  let hmac: CryptoJS.lib.WordArray;
  if (hashName === "SHA-512") {
    hmac = CryptoJS.HmacSHA512(dataWordArray, keyWordArray);
  } else {
    hmac = CryptoJS.HmacSHA256(dataWordArray, keyWordArray);
  }

  return wordArrayToArrayBuffer(hmac);
};

// ── encrypt ──

const encrypt = async (
  algorithm: { name: string; iv: ArrayBuffer | Uint8Array },
  key: any,
  data: ArrayBuffer
): Promise<ArrayBuffer> => {
  const algoName = normalizeAlgorithmName(algorithm);

  if (algoName !== "AES-CBC") {
    throw new CryptoDOMException(
      `Unsupported encrypt algorithm: ${algoName}`,
      "NotSupportedError"
    );
  }

  const native = getNativeModule();
  if (native?.webcrypto?.subtle) {
    try {
      return await native.webcrypto.subtle.encrypt(algorithm, key, data);
    } catch (error) {
      throw wrapDOMException(error, "encrypt(AES-CBC)", "OperationError");
    }
  }

  // JS fallback via crypto-js
  const rawKey = key._rawKey;
  if (!rawKey) {
    throw new CryptoDOMException(
      "Invalid AES key: missing raw key data.",
      "InvalidAccessError"
    );
  }

  const keyWordArray = arrayBufferToWordArray(rawKey);
  const ivWordArray = arrayBufferToWordArray(algorithm.iv);
  const dataWordArray = arrayBufferToWordArray(data);

  const encrypted = CryptoJS.AES.encrypt(dataWordArray, keyWordArray, {
    iv: ivWordArray,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return wordArrayToArrayBuffer(encrypted.ciphertext);
};

// ── decrypt ──

const decrypt = async (
  algorithm: { name: string; iv: ArrayBuffer | Uint8Array },
  key: any,
  data: ArrayBuffer
): Promise<ArrayBuffer> => {
  const algoName = normalizeAlgorithmName(algorithm);

  if (algoName !== "AES-CBC") {
    throw new CryptoDOMException(
      `Unsupported decrypt algorithm: ${algoName}`,
      "NotSupportedError"
    );
  }

  const native = getNativeModule();
  if (native?.webcrypto?.subtle) {
    try {
      return await native.webcrypto.subtle.decrypt(algorithm, key, data);
    } catch (error) {
      throw wrapDOMException(error, "decrypt(AES-CBC)", "OperationError");
    }
  }

  // JS fallback via crypto-js
  const rawKey = key._rawKey;
  if (!rawKey) {
    throw new CryptoDOMException(
      "Invalid AES key: missing raw key data.",
      "InvalidAccessError"
    );
  }

  const keyWordArray = arrayBufferToWordArray(rawKey);
  const ivWordArray = arrayBufferToWordArray(algorithm.iv);
  const dataWordArray = arrayBufferToWordArray(data);

  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: dataWordArray,
  });

  const decrypted = CryptoJS.AES.decrypt(cipherParams, keyWordArray, {
    iv: ivWordArray,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return wordArrayToArrayBuffer(decrypted);
};

// ────────────────────────────────────────────
// Self-Initialization
// ────────────────────────────────────────────

export function setupWebCryptoPolyfill(): void {
  if (typeof global.crypto === "undefined") {
    (global as any).crypto = {
      getRandomValues,
      subtle: {
        digest,
        importKey,
        sign,
        encrypt,
        decrypt,
      },
    };
  } else {
    const existingCrypto = global.crypto as any;
    if (typeof existingCrypto.getRandomValues === "undefined") {
      existingCrypto.getRandomValues = getRandomValues;
    }
    if (typeof existingCrypto.subtle === "undefined") {
      existingCrypto.subtle = {
        digest,
        importKey,
        sign,
        encrypt,
        decrypt,
      };
    }
  }
}

// Automatically setup on module load
setupWebCryptoPolyfill();
