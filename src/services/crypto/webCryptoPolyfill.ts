/**
 * WebCrypto API Polyfill for React Native
 *
 * Implements the subset of SubtleCrypto and Crypto APIs required by kdbxweb
 * using expo-crypto (native-backed digests and randoms) and crypto-js (pure JS ciphers/HMAC).
 */

import * as Crypto from "expo-crypto";
import CryptoJS from "crypto-js";

// ────────────────────────────────────────────
// Byte Conversion Helpers
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
// WebCrypto Subtle Implementation
// ────────────────────────────────────────────

const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
  if (!array) return array;
  return Crypto.getRandomValues(array as any) as any;
};

const digest = async (
  algorithm: string | { name: string },
  data: ArrayBuffer
): Promise<ArrayBuffer> => {
  const algoName = typeof algorithm === "string" ? algorithm : algorithm.name;
  let expoAlgo: Crypto.CryptoDigestAlgorithm;

  if (algoName.toUpperCase() === "SHA-256") {
    expoAlgo = Crypto.CryptoDigestAlgorithm.SHA256;
  } else if (algoName.toUpperCase() === "SHA-512") {
    expoAlgo = Crypto.CryptoDigestAlgorithm.SHA512;
  } else {
    throw new Error(
      `[WebCryptoPolyfill] Unsupported digest algorithm: ${algoName}`
    );
  }

  return Crypto.digest(expoAlgo, data);
};

const importKey = async (
  format: "raw",
  keyData: ArrayBuffer | Uint8Array,
  algorithm: any,
  extractable: boolean,
  keyUsages: string[]
): Promise<any> => {
  if (format !== "raw") {
    throw new Error(`[WebCryptoPolyfill] Unsupported key format: ${format}`);
  }
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

const sign = async (
  algorithm: any,
  key: any,
  data: ArrayBuffer
): Promise<ArrayBuffer> => {
  const algoName = typeof algorithm === "string" ? algorithm : algorithm.name;
  if (algoName.toUpperCase() === "HMAC") {
    const rawKey = key._rawKey;
    if (!rawKey) {
      throw new Error(
        "[WebCryptoPolyfill] Invalid HMAC key: missing raw key data."
      );
    }
    const keyWordArray = arrayBufferToWordArray(rawKey);
    const dataWordArray = arrayBufferToWordArray(data);
    const hmac = CryptoJS.HmacSHA256(dataWordArray, keyWordArray);
    return wordArrayToArrayBuffer(hmac);
  }
  throw new Error(
    `[WebCryptoPolyfill] Unsupported sign algorithm: ${algoName}`
  );
};

const encrypt = async (
  algorithm: { name: string; iv: ArrayBuffer | Uint8Array },
  key: any,
  data: ArrayBuffer
): Promise<ArrayBuffer> => {
  const algoName = algorithm.name;
  if (algoName.toUpperCase() === "AES-CBC") {
    const rawKey = key._rawKey;
    if (!rawKey) {
      throw new Error(
        "[WebCryptoPolyfill] Invalid AES key: missing raw key data."
      );
    }
    const iv = algorithm.iv;

    const keyWordArray = arrayBufferToWordArray(rawKey);
    const ivWordArray = arrayBufferToWordArray(iv);
    const dataWordArray = arrayBufferToWordArray(data);

    const encrypted = CryptoJS.AES.encrypt(dataWordArray, keyWordArray, {
      iv: ivWordArray,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    return wordArrayToArrayBuffer(encrypted.ciphertext);
  }
  throw new Error(
    `[WebCryptoPolyfill] Unsupported encrypt algorithm: ${algoName}`
  );
};

const decrypt = async (
  algorithm: { name: string; iv: ArrayBuffer | Uint8Array },
  key: any,
  data: ArrayBuffer
): Promise<ArrayBuffer> => {
  const algoName = algorithm.name;
  if (algoName.toUpperCase() === "AES-CBC") {
    const rawKey = key._rawKey;
    if (!rawKey) {
      throw new Error(
        "[WebCryptoPolyfill] Invalid AES key: missing raw key data."
      );
    }
    const iv = algorithm.iv;

    const keyWordArray = arrayBufferToWordArray(rawKey);
    const ivWordArray = arrayBufferToWordArray(iv);
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
  }
  throw new Error(
    `[WebCryptoPolyfill] Unsupported decrypt algorithm: ${algoName}`
  );
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
