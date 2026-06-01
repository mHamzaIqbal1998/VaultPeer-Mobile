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

// WeakMap to store raw key data for WebCrypto CryptoKey objects.
// This allows us to retrieve key bytes synchronously for fast Node-style operations.
const rawKeyMap = new WeakMap<any, Uint8Array>();

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
  createCipheriv?: (algorithm: string, key: Uint8Array, iv: Uint8Array) => any;
  createDecipheriv?: (
    algorithm: string,
    key: Uint8Array,
    iv: Uint8Array
  ) => any;
  createHash?: (algorithm: string) => any;
  createHmac?: (algorithm: string, key: Uint8Array) => any;
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
  let view: Uint8Array;
  if (data instanceof Uint8Array) {
    view = data;
  } else if (ArrayBuffer.isView(data)) {
    view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    view = new Uint8Array(data);
  }

  // If the view is a slice of a larger buffer (has non-zero offset or is smaller than the full buffer),
  // copy the bytes to a fresh Uint8Array to reset the byteOffset to 0 and isolate the data.
  if (view.byteOffset !== 0 || view.byteLength !== view.buffer.byteLength) {
    return new Uint8Array(view);
  }
  return view;
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
      if (typeof native.createHash === "function") {
        const hashAlgo =
          algoName === "SHA-256"
            ? "sha256"
            : algoName === "SHA-512"
              ? "sha512"
              : algoName.toLowerCase();
        const hash = native.createHash(hashAlgo);
        hash.update(uint8Data);
        const result = hash.digest();
        return result.buffer.slice(
          result.byteOffset,
          result.byteOffset + result.byteLength
        );
      }
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
      const keyObj = await native.webcrypto.subtle.importKey(
        "raw",
        rawKey as any,
        algorithm,
        extractable,
        keyUsages as any
      );
      if (keyObj && typeof keyObj === "object") {
        rawKeyMap.set(keyObj, rawKey);
        (keyObj as any)._rawKey = rawKey;
      }
      return keyObj;
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
      const rawKey = rawKeyMap.get(key) || key._rawKey;
      if (rawKey && typeof native.createHmac === "function") {
        const hashName =
          key.algorithm?.hash?.name?.toUpperCase?.() ??
          algorithm?.hash?.name?.toUpperCase?.() ??
          "SHA-256";
        const hmacAlgo = hashName === "SHA-512" ? "sha512" : "sha256";
        const hmac = native.createHmac(hmacAlgo, toUint8Array(rawKey));
        hmac.update(toUint8Array(data));
        const result = hmac.digest();
        return result.buffer.slice(
          result.byteOffset,
          result.byteOffset + result.byteLength
        );
      }
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
      const rawKey = rawKeyMap.get(key) || key._rawKey;
      if (rawKey && typeof native.createCipheriv === "function") {
        const keyBytes = toUint8Array(rawKey);
        const ivBytes = toUint8Array(algorithm.iv);
        const dataBytes = toUint8Array(data);
        const cipher = native.createCipheriv("aes-256-cbc", keyBytes, ivBytes);
        const r1 = cipher.update(dataBytes);
        const r2 = cipher.final();
        const totalLength = r1.length + r2.length;
        const result = new Uint8Array(totalLength);
        result.set(r1, 0);
        result.set(r2, r1.length);
        return result.buffer.slice(
          result.byteOffset,
          result.byteOffset + result.byteLength
        );
      }
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
      const rawKey = rawKeyMap.get(key) || key._rawKey;
      if (rawKey && typeof native.createDecipheriv === "function") {
        const keyBytes = toUint8Array(rawKey);
        const ivBytes = toUint8Array(algorithm.iv);
        const dataBytes = toUint8Array(data);
        const decipher = native.createDecipheriv(
          "aes-256-cbc",
          keyBytes,
          ivBytes
        );
        const r1 = decipher.update(dataBytes);
        const r2 = decipher.final();
        const totalLength = r1.length + r2.length;
        const result = new Uint8Array(totalLength);
        result.set(r1, 0);
        result.set(r2, r1.length);
        return result.buffer.slice(
          result.byteOffset,
          result.byteOffset + result.byteLength
        );
      }
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
// Binary-safe btoa and atob Polyfills
// ────────────────────────────────────────────

let quickBase64: any = null;
try {
  if (Platform.OS !== "web") {
    // eslint-disable-next-line
    quickBase64 = require("react-native-quick-base64");
  }
} catch {
  // Fall back
}

const btoaLookup =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function binaryBtoa(input: string): string {
  if (quickBase64 && typeof quickBase64.fromByteArray === "function") {
    const bytes = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      bytes[i] = input.charCodeAt(i) & 0xff;
    }
    return quickBase64.fromByteArray(bytes);
  }

  let result = "";
  let i = 0;
  const len = input.length;
  while (i < len) {
    const b1 = input.charCodeAt(i++) & 0xff;
    const b2 = i < len ? input.charCodeAt(i++) & 0xff : NaN;
    const b3 = i < len ? input.charCodeAt(i++) & 0xff : NaN;

    const c1 = b1 >> 2;
    const c2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : b2 >> 4);
    const c3 = isNaN(b2) ? 64 : ((b2 & 15) << 2) | (isNaN(b3) ? 0 : b3 >> 6);
    const c4 = isNaN(b3) ? 64 : b3 & 63;

    result +=
      btoaLookup.charAt(c1) +
      btoaLookup.charAt(c2) +
      (c3 === 64 ? "=" : btoaLookup.charAt(c3)) +
      (c4 === 64 ? "=" : btoaLookup.charAt(c4));
  }
  return result;
}

function binaryAtob(input: string): string {
  const cleaned = input.replace(/[\s\r\n]/g, "");

  if (quickBase64 && typeof quickBase64.toByteArray === "function") {
    const bytes = quickBase64.toByteArray(cleaned);
    let str = "";
    const chunkSize = 16384;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      str += String.fromCharCode.apply(null, chunk as any);
    }
    return str;
  }

  if (/[^A-Za-z0-9+/=]/.test(cleaned) || cleaned.length % 4 !== 0) {
    throw new Error("Invalid base64 string");
  }

  let result = "";
  const len = cleaned.length;
  for (let i = 0; i < len; i += 4) {
    const c1 = btoaLookup.indexOf(cleaned.charAt(i));
    const c2 = btoaLookup.indexOf(cleaned.charAt(i + 1));
    const c3 =
      cleaned.charAt(i + 2) === "="
        ? -1
        : btoaLookup.indexOf(cleaned.charAt(i + 2));
    const c4 =
      cleaned.charAt(i + 3) === "="
        ? -1
        : btoaLookup.indexOf(cleaned.charAt(i + 3));

    if (
      c1 === -1 ||
      c2 === -1 ||
      (cleaned.charAt(i + 2) !== "=" && c3 === -1) ||
      (cleaned.charAt(i + 3) !== "=" && c4 === -1)
    ) {
      throw new Error("Invalid base64 string");
    }

    const b1 = (c1 << 2) | (c2 >> 4);
    result += String.fromCharCode(b1);

    if (c3 !== -1) {
      const b2 = ((c2 & 15) << 4) | (c3 >> 2);
      result += String.fromCharCode(b2);
      if (c4 !== -1) {
        const b3 = ((c3 & 3) << 6) | c4;
        result += String.fromCharCode(b3);
      }
    }
  }
  return result;
}

// ────────────────────────────────────────────
// Self-Initialization
// ────────────────────────────────────────────

export function setupWebCryptoPolyfill(): void {
  if (Platform.OS !== "web") {
    (global as any).btoa = binaryBtoa;
    (global as any).atob = binaryAtob;
  }

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

// ────────────────────────────────────────────
// kdbxweb Int64 Polyfill/Patch
// ────────────────────────────────────────────
// In KDBX databases edited/merged by some clients (e.g. KeePassDX), date values
// can be saved with invalid/huge numbers that exceed JS Date's maximum bounds.
// The maximum safe time value representable by standard JS Date objects corresponds
// to secondsFrom00 = 8702135596800. Values exceeding this cause Invalid Date and
// subsequent serialization RangeErrors (e.g. "Date value out of bounds") during saving.
// This patches kdbxweb's Int64 class getter and static from methods to clamp
// values to 8702135596800 instead of throwing or producing out-of-bound Date values.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const kdbxweb = require("kdbxweb");
  if (kdbxweb && kdbxweb.Int64) {
    const proto = kdbxweb.Int64.prototype;
    const originalValueDescriptor = Object.getOwnPropertyDescriptor(
      proto,
      "value"
    );
    if (originalValueDescriptor) {
      Object.defineProperty(proto, "value", {
        get() {
          if (this.hi >= 0x200000) {
            return 8702135596800;
          }
          const val = originalValueDescriptor.get
            ? originalValueDescriptor.get.call(this)
            : this.lo;
          if (val > 8702135596800) {
            return 8702135596800;
          }
          return val;
        },
        configurable: true,
        enumerable: true,
      });
    }

    const originalFrom = kdbxweb.Int64.from;
    if (typeof originalFrom === "function") {
      kdbxweb.Int64.from = function (value: number) {
        if (value > 8702135596800) {
          return new kdbxweb.Int64(531855104, 2026); // 8702135596800
        }
        return originalFrom.call(this, value);
      };
    }
  }
} catch (e) {
  console.warn("[WebCryptoPolyfill] Failed to patch kdbxweb Int64:", e);
}
