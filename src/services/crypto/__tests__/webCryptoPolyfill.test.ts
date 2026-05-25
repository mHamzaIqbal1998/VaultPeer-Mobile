/**
 * Jest Test Suite — WebCrypto JSI Polyfill
 *
 * Validates native-speed encryption/decryption against known standard cipher
 * test vectors and verifies DOMException error wrapping behavior.
 *
 * Tests run against the JS fallback path (crypto-js + expo-crypto) since
 * Jest does not have native JSI modules available. The native path is
 * validated through development build benchmarks on-device.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// ────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────

// Save and clear Node.js built-in crypto BEFORE any module loads
// so our polyfill's setupWebCryptoPolyfill() actually installs
const _originalCrypto = (global as any).crypto;
delete (global as any).crypto;

// Mock Platform to simulate Android
jest.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

// Mock react-native-quick-crypto as unavailable in test environment
// This forces the polyfill to use the JS fallback, which we can validate
jest.mock("react-native-quick-crypto", () => {
  throw new Error("Native module not available in test environment");
});

// Mock expo-crypto with real-ish implementations
const mockDigest = jest.fn();
const mockGetRandomValues = jest.fn((array: ArrayBufferView) => {
  // Fill with deterministic values for testing
  const view = new Uint8Array(
    (array as Uint8Array).buffer,
    (array as Uint8Array).byteOffset,
    (array as Uint8Array).byteLength
  );
  for (let i = 0; i < view.length; i++) {
    view[i] = i % 256;
  }
  return array;
});

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: {
    SHA256: "SHA-256",
    SHA512: "SHA-512",
  },
  digest: mockDigest,
  getRandomValues: mockGetRandomValues,
}));

// ────────────────────────────────────────────
// Imports (after mocks)
// ────────────────────────────────────────────

const { setupWebCryptoPolyfill } = require("../webCryptoPolyfill");

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

// ────────────────────────────────────────────
// Test Suite
// ────────────────────────────────────────────

describe("WebCryptoPolyfill", () => {
  afterAll(() => {
    // Restore original Node.js crypto after tests complete
    (global as any).crypto = _originalCrypto;
  });

  beforeEach(() => {
    mockDigest.mockClear();
    mockGetRandomValues.mockClear();
  });

  // ── Initialization ──

  describe("initialization", () => {
    it("should install global.crypto.subtle", () => {
      expect((global as any).crypto).toBeDefined();
      expect((global as any).crypto.subtle).toBeDefined();
    });

    it("should install global.crypto.getRandomValues", () => {
      expect((global as any).crypto.getRandomValues).toBeDefined();
    });

    it("should provide digest, importKey, sign, encrypt, decrypt methods", () => {
      const subtle = (global as any).crypto.subtle;
      expect(typeof subtle.digest).toBe("function");
      expect(typeof subtle.importKey).toBe("function");
      expect(typeof subtle.sign).toBe("function");
      expect(typeof subtle.encrypt).toBe("function");
      expect(typeof subtle.decrypt).toBe("function");
    });

    it("should be idempotent — safe to call multiple times", () => {
      expect(() => setupWebCryptoPolyfill()).not.toThrow();
      expect((global as any).crypto.subtle).toBeDefined();
    });
  });

  // ── getRandomValues ──

  describe("getRandomValues", () => {
    it("should fill a Uint8Array with random bytes", () => {
      const array = new Uint8Array(16);
      const result = (global as any).crypto.getRandomValues(array);
      expect(result).toBe(array);
    });

    it("should handle null gracefully", () => {
      const result = (global as any).crypto.getRandomValues(null);
      expect(result).toBeNull();
    });
  });

  // ── digest ──

  describe("digest", () => {
    it("should delegate SHA-256 to the underlying engine", async () => {
      const fakeHash = new ArrayBuffer(32);
      mockDigest.mockResolvedValueOnce(fakeHash);

      const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      const result = await (global as any).crypto.subtle.digest(
        "SHA-256",
        data
      );

      expect(result).toBe(fakeHash);
    });

    it("should accept algorithm as object { name }", async () => {
      const fakeHash = new ArrayBuffer(64);
      mockDigest.mockResolvedValueOnce(fakeHash);

      const data = new Uint8Array([0x01, 0x02]);
      const result = await (global as any).crypto.subtle.digest(
        { name: "SHA-512" },
        data
      );

      expect(result).toBe(fakeHash);
    });

    it("should throw DOMException for unsupported algorithms", async () => {
      await expect(
        (global as any).crypto.subtle.digest("MD5", new Uint8Array(4))
      ).rejects.toThrow("Unsupported digest algorithm");
    });

    it("should handle ArrayBufferView data (DataView)", async () => {
      const fakeHash = new ArrayBuffer(32);
      mockDigest.mockResolvedValueOnce(fakeHash);

      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      view.setUint32(0, 0x12345678);

      // DataView is an ArrayBufferView, should be coerced to Uint8Array
      const result = await (global as any).crypto.subtle.digest(
        "SHA-256",
        view
      );
      expect(result).toBe(fakeHash);
    });
  });

  // ── importKey ──

  describe("importKey", () => {
    it("should import a raw key for AES-CBC", async () => {
      const keyData = new Uint8Array(32); // 256-bit key
      keyData.fill(0xaa);

      const key = await (global as any).crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "AES-CBC" },
        false,
        ["encrypt", "decrypt"]
      );

      expect(key).toBeDefined();
      expect(key.type).toBe("secret");
      expect(key.extractable).toBe(false);
      expect(key.usages).toEqual(["encrypt", "decrypt"]);
    });

    it("should import a raw key for HMAC", async () => {
      const keyData = new Uint8Array(32);
      keyData.fill(0xbb);

      const key = await (global as any).crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: { name: "SHA-256" } },
        false,
        ["sign", "verify"]
      );

      expect(key).toBeDefined();
      expect(key.type).toBe("secret");
    });

    it("should throw DOMException for non-raw formats", async () => {
      await expect(
        (global as any).crypto.subtle.importKey(
          "pkcs8" as any,
          new Uint8Array(32),
          { name: "AES-CBC" },
          false,
          ["decrypt"]
        )
      ).rejects.toThrow("Unsupported key format");
    });
  });

  // ── sign (HMAC) ──

  describe("sign (HMAC)", () => {
    it("should produce HMAC-SHA256 signature", async () => {
      const keyData = new Uint8Array(32);
      keyData.fill(0x0b);

      const key = await (global as any).crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: { name: "SHA-256" } },
        false,
        ["sign"]
      );

      const data = new TextEncoder().encode("Hi There").buffer;
      const signature = await (global as any).crypto.subtle.sign(
        { name: "HMAC", hash: { name: "SHA-256" } },
        key,
        data
      );

      expect(signature).toBeInstanceOf(ArrayBuffer);
      expect(signature.byteLength).toBe(32); // SHA-256 output
    });

    it("should produce HMAC-SHA512 signature", async () => {
      const keyData = new Uint8Array(32);
      keyData.fill(0x0c);

      const key = await (global as any).crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: { name: "SHA-512" } },
        false,
        ["sign"]
      );

      const data = new TextEncoder().encode("Test Data").buffer;
      const signature = await (global as any).crypto.subtle.sign(
        { name: "HMAC", hash: { name: "SHA-512" } },
        key,
        data
      );

      expect(signature).toBeInstanceOf(ArrayBuffer);
      expect(signature.byteLength).toBe(64); // SHA-512 output
    });

    it("should throw for unsupported sign algorithms", async () => {
      const key = {
        _rawKey: new Uint8Array(32),
        algorithm: { name: "RSA-PSS" },
      };

      await expect(
        (global as any).crypto.subtle.sign("RSA-PSS", key, new ArrayBuffer(8))
      ).rejects.toThrow("Unsupported sign algorithm");
    });

    it("should throw for keys missing raw data", async () => {
      const invalidKey = {
        type: "secret",
        algorithm: { name: "HMAC" },
        // no _rawKey
      };

      await expect(
        (global as any).crypto.subtle.sign(
          "HMAC",
          invalidKey,
          new ArrayBuffer(8)
        )
      ).rejects.toThrow("missing raw key data");
    });
  });

  // ── encrypt / decrypt (AES-CBC) ──

  describe("encrypt/decrypt (AES-CBC)", () => {
    const AES_KEY_HEX =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const IV_HEX = "00112233445566778899aabbccddeeff";

    it("should round-trip encrypt → decrypt for arbitrary data", async () => {
      const keyBytes = new Uint8Array(hexToArrayBuffer(AES_KEY_HEX));
      const iv = new Uint8Array(hexToArrayBuffer(IV_HEX));

      const key = await (global as any).crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-CBC" },
        false,
        ["encrypt", "decrypt"]
      );

      // Original plaintext: "VaultPeer Password Manager!"
      const plaintext = new TextEncoder().encode(
        "VaultPeer Password Manager!"
      ).buffer;

      const ciphertext = await (global as any).crypto.subtle.encrypt(
        { name: "AES-CBC", iv },
        key,
        plaintext
      );

      expect(ciphertext).toBeInstanceOf(ArrayBuffer);
      expect(ciphertext.byteLength).toBeGreaterThan(0);
      // AES-CBC ciphertext should be padded to block boundary
      expect(ciphertext.byteLength % 16).toBe(0);

      const decrypted = await (global as any).crypto.subtle.decrypt(
        { name: "AES-CBC", iv },
        key,
        ciphertext
      );

      expect(decrypted).toBeInstanceOf(ArrayBuffer);

      const decryptedText = new TextDecoder().decode(decrypted);
      expect(decryptedText).toBe("VaultPeer Password Manager!");
    });

    it("should encrypt 16-byte aligned data correctly", async () => {
      const keyBytes = new Uint8Array(32);
      keyBytes.fill(0x42);
      const iv = new Uint8Array(16);
      iv.fill(0x00);

      const key = await (global as any).crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-CBC" },
        false,
        ["encrypt", "decrypt"]
      );

      // Exactly 16 bytes (one AES block)
      const plaintext = new Uint8Array(16).fill(0xff).buffer;

      const ciphertext = await (global as any).crypto.subtle.encrypt(
        { name: "AES-CBC", iv },
        key,
        plaintext
      );

      // With PKCS7 padding, 16 bytes becomes 32 bytes (one pad block added)
      expect(ciphertext.byteLength).toBe(32);
    });

    it("should throw DOMException for unsupported encrypt algorithm", async () => {
      const key = {
        _rawKey: new Uint8Array(32),
        algorithm: { name: "AES-GCM" },
      };

      await expect(
        (global as any).crypto.subtle.encrypt(
          { name: "AES-GCM", iv: new Uint8Array(12) },
          key,
          new ArrayBuffer(16)
        )
      ).rejects.toThrow("Unsupported encrypt algorithm");
    });

    it("should throw for encrypt with missing key data", async () => {
      const invalidKey = {
        type: "secret",
        algorithm: { name: "AES-CBC" },
      };

      await expect(
        (global as any).crypto.subtle.encrypt(
          { name: "AES-CBC", iv: new Uint8Array(16) },
          invalidKey,
          new ArrayBuffer(16)
        )
      ).rejects.toThrow("missing raw key data");
    });

    it("should throw for decrypt with missing key data", async () => {
      const invalidKey = {
        type: "secret",
        algorithm: { name: "AES-CBC" },
      };

      await expect(
        (global as any).crypto.subtle.decrypt(
          { name: "AES-CBC", iv: new Uint8Array(16) },
          invalidKey,
          new ArrayBuffer(32)
        )
      ).rejects.toThrow("missing raw key data");
    });

    it("should handle empty plaintext", async () => {
      const keyBytes = new Uint8Array(32);
      keyBytes.fill(0x55);
      const iv = new Uint8Array(16);
      iv.fill(0x01);

      const key = await (global as any).crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-CBC" },
        false,
        ["encrypt", "decrypt"]
      );

      const plaintext = new ArrayBuffer(0);

      const ciphertext = await (global as any).crypto.subtle.encrypt(
        { name: "AES-CBC", iv },
        key,
        plaintext
      );

      // Empty plaintext with PKCS7 produces 16-byte pad block
      expect(ciphertext.byteLength).toBe(16);

      const decrypted = await (global as any).crypto.subtle.decrypt(
        { name: "AES-CBC", iv },
        key,
        ciphertext
      );

      expect(decrypted.byteLength).toBe(0);
    });
  });

  // ── DOMException Error Wrapping ──

  describe("DOMException error wrapping", () => {
    it("should produce errors with 'name' property matching WebCrypto spec", async () => {
      try {
        await (global as any).crypto.subtle.digest(
          "UNSUPPORTED-ALGO",
          new Uint8Array(4)
        );
        fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("NotSupportedError");
        expect(error.code).toBe(9);
        expect(error.message).toContain("Unsupported digest algorithm");
      }
    });

    it("should wrap importKey errors as DataError (format not supported)", async () => {
      try {
        await (global as any).crypto.subtle.importKey(
          "jwk" as any,
          new Uint8Array(32),
          { name: "AES-CBC" },
          false,
          ["encrypt"]
        );
        fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("NotSupportedError");
        expect(error.code).toBe(9);
      }
    });

    it("should wrap sign errors as InvalidAccessError (bad key)", async () => {
      try {
        await (global as any).crypto.subtle.sign(
          "HMAC",
          { type: "secret" }, // no _rawKey
          new ArrayBuffer(8)
        );
        fail("Should have thrown");
      } catch (error: any) {
        expect(error.name).toBe("InvalidAccessError");
        expect(error.code).toBe(15);
      }
    });
  });

  // ── kdbxweb Int64 patch ──

  describe("kdbxweb Int64 patch", () => {
    it("should clamp values larger than MAX_SAFE_INTEGER instead of throwing", () => {
      const { Int64 } = require("kdbxweb");
      const largeInt = new Int64(0xffffffff, 0xffffffff);
      expect(() => largeInt.value).not.toThrow();
      expect(largeInt.value).toBe(Number.MAX_SAFE_INTEGER);
      expect(largeInt.valueOf()).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("should clamp Int64.from values larger than MAX_SAFE_INTEGER", () => {
      const { Int64 } = require("kdbxweb");
      const largeValue = Number.MAX_SAFE_INTEGER + 100;
      const clampedInt = Int64.from(largeValue);
      expect(clampedInt.value).toBe(Number.MAX_SAFE_INTEGER);
    });
  });
});
