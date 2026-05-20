import { arrayBufferToBase64, base64ToArrayBuffer } from "../base64";

describe("Base64 Utilities", () => {
  it("should successfully roundtrip encode/decode standard text values", () => {
    const originalText = "VaultPeer Security and In-place Sync System";

    // Convert to ArrayBuffer
    const encoder = new TextEncoder();
    const buffer = encoder.encode(originalText).buffer;

    // Encode to Base64
    const base64 = arrayBufferToBase64(buffer);
    expect(typeof base64).toBe("string");
    expect(base64.length).toBeGreaterThan(0);

    // Decode from Base64
    const decodedBuffer = base64ToArrayBuffer(base64);
    const decoder = new TextDecoder();
    const decodedText = decoder.decode(decodedBuffer);

    expect(decodedText).toBe(originalText);
  });

  it("should handle empty buffers correctly", () => {
    const emptyBuffer = new ArrayBuffer(0);
    const base64 = arrayBufferToBase64(emptyBuffer);
    expect(base64).toBe("");

    const decoded = base64ToArrayBuffer("");
    expect(decoded.byteLength).toBe(0);
  });

  it("should handle binary data roundtrip with exact byte matching", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255, 100, 200, 50]);
    const buffer = bytes.buffer;

    const base64 = arrayBufferToBase64(buffer);
    const decodedBuffer = base64ToArrayBuffer(base64);
    const decodedBytes = new Uint8Array(decodedBuffer);

    expect(decodedBytes.length).toBe(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      expect(decodedBytes[i]).toBe(bytes[i]);
    }
  });
});
