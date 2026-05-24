import { Platform } from "react-native";

let quickBase64: any = null;
try {
  if (Platform.OS !== "web") {
    // Dynamic require so it doesn't fail in test/web environments where it's not mocked or linked
    quickBase64 = require("react-native-quick-base64");
  }
} catch (e) {
  // Fall back to JS implementation
}

const chars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Encodes an ArrayBuffer into a Base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (quickBase64 && typeof quickBase64.fromByteArray === "function") {
    return quickBase64.fromByteArray(new Uint8Array(buffer));
  }

  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  let base64 = "";

  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : NaN;
    const b3 = i + 2 < len ? bytes[i + 2] : NaN;

    const c1 = b1 >> 2;
    const c2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : b2 >> 4);
    const c3 = isNaN(b2) ? 64 : ((b2 & 15) << 2) | (isNaN(b3) ? 0 : b3 >> 6);
    const c4 = isNaN(b3) ? 64 : b3 & 63;

    base64 +=
      chars.charAt(c1) +
      chars.charAt(c2) +
      (c3 === 64 ? "=" : chars.charAt(c3)) +
      (c4 === 64 ? "=" : chars.charAt(c4));
  }

  return base64;
}

/**
 * Decodes a Base64 string into an ArrayBuffer.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  if (quickBase64 && typeof quickBase64.toByteArray === "function") {
    const uint8 = quickBase64.toByteArray(base64);
    if (
      uint8.byteOffset === 0 &&
      uint8.byteLength === uint8.buffer.byteLength
    ) {
      return uint8.buffer;
    }
    return uint8.buffer.slice(
      uint8.byteOffset,
      uint8.byteOffset + uint8.byteLength
    );
  }

  // Remove padding characters and whitespace
  const cleaned = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const len = cleaned.length;
  const buffer = new ArrayBuffer(Math.floor((len * 3) / 4));
  const bytes = new Uint8Array(buffer);

  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = chars.indexOf(cleaned.charAt(i));
    const c2 = i + 1 < len ? chars.indexOf(cleaned.charAt(i + 1)) : 0;
    const c3 = i + 2 < len ? chars.indexOf(cleaned.charAt(i + 2)) : 0;
    const c4 = i + 3 < len ? chars.indexOf(cleaned.charAt(i + 3)) : 0;

    const b1 = (c1 << 2) | (c2 >> 4);
    const b2 = ((c2 & 15) << 4) | (c3 >> 2);
    const b3 = ((c3 & 3) << 6) | c4;

    bytes[p++] = b1;
    if (i + 2 < len) bytes[p++] = b2;
    if (i + 3 < len) bytes[p++] = b3;
  }

  return buffer;
}
