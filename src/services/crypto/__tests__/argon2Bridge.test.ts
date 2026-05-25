/**
 * Jest Test Suite — Argon2 Bridge
 *
 * Validates the hex utility functions and the Argon2 bridge adapter
 * in isolation. Native module calls are mocked since Jest runs in Node.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// Mock react-native Platform
import type { Argon2HashRequest } from "../argon2Bridge";

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

// Mock react-native-argon2-turbo
const mockHash = jest.fn().mockResolvedValue({
  rawHash: "deadbeefcafebabe0123456789abcdef",
  encodedHash: "$argon2id$v=19$m=65536,t=3,p=1$...",
});

jest.mock("react-native-argon2-turbo", () => ({
  hash: mockHash,
}));

// Imports must come after jest.mock calls
const { nativeArgon2Hash, createKdbxArgon2Impl } = require("../argon2Bridge");

describe("Argon2 Bridge", () => {
  beforeEach(() => {
    mockHash.mockClear();
  });

  const sampleRequest: Argon2HashRequest = {
    password: new Uint8Array([0x74, 0x65, 0x73, 0x74]), // "test"
    salt: new Uint8Array([
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
      0x0d, 0x0e, 0x0f, 0x10,
    ]),
    memory: 65536,
    iterations: 3,
    hashLength: 32,
    parallelism: 1,
    type: 2, // argon2id
    version: 19,
  };

  it("should call native hash and return an ArrayBuffer", async () => {
    const result = await nativeArgon2Hash(sampleRequest);

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(16); // hex string 'deadbeef...' = 32 chars = 16 bytes
  });

  it("should correctly encode password and salt as hex", async () => {
    await nativeArgon2Hash(sampleRequest);

    expect(mockHash).toHaveBeenCalledWith(
      expect.objectContaining({
        password: "74657374", // "test" in hex
        salt: "0102030405060708090a0b0c0d0e0f10",
        memory: 65536,
        iterations: 3,
        hashLength: 32,
        parallelism: 1,
        mode: "argon2id",
        passwordEncoding: "hex",
        saltEncoding: "hex",
      })
    );
  });

  it("should map type 0 to argon2d", async () => {
    await nativeArgon2Hash({ ...sampleRequest, type: 0 });

    expect(mockHash).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "argon2d" })
    );
  });

  it("should map type 1 to argon2i", async () => {
    await nativeArgon2Hash({ ...sampleRequest, type: 1 });

    expect(mockHash).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "argon2i" })
    );
  });

  describe("createKdbxArgon2Impl", () => {
    it("should return a function compatible with kdbxweb CryptoEngine", () => {
      const impl = createKdbxArgon2Impl();
      expect(typeof impl).toBe("function");
    });

    it("should accept ArrayBuffer params and return ArrayBuffer", async () => {
      const impl = createKdbxArgon2Impl();
      const password = new Uint8Array([0x74, 0x65, 0x73, 0x74]).buffer;
      const salt = new Uint8Array([
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
        0x0d, 0x0e, 0x0f, 0x10,
      ]).buffer;

      const result = await impl(
        password as ArrayBuffer,
        salt as ArrayBuffer,
        65536,
        3,
        32,
        1,
        2,
        19
      );

      expect(result).toBeInstanceOf(ArrayBuffer);
    });
  });
});
