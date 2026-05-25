import CryptoJS from "crypto-js";

export interface OtpParams {
  type: "totp" | "hotp";
  label: string;
  issuer: string;
  secret: string;
  digits: number;
  period: number;
  counter?: number;
  algorithm: string;
}

/**
 * Clean and decode a Base32 string into a Uint8Array.
 */
export function decodeBase32(b32: string): Uint8Array {
  const clean = b32.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const charMap: Record<string, number> = {};
  for (let i = 0; i < alphabet.length; i++) {
    charMap[alphabet[i]] = i;
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const val = charMap[char];
    if (val === undefined) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

function uint8ArrayToHex(arr: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function counterToHex(counter: number): string {
  const high = Math.floor(counter / 0x100000000);
  const low = counter % 0x100000000;
  const highHex = high.toString(16).padStart(8, "0");
  const lowHex = low.toString(16).padStart(8, "0");
  return highHex + lowHex;
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.substring(c, c + 2), 16));
  }
  return bytes;
}

/**
 * Parse an otpauth:// URI into its parameters.
 */
export function parseOtpUri(uri: string): OtpParams {
  const parseLogic = (urlString: string) => {
    const url = new URL(urlString);
    const type = url.host.toLowerCase();
    if (type !== "totp" && type !== "hotp") {
      throw new Error(`Unsupported OTP type: ${type}`);
    }

    let label = decodeURIComponent(url.pathname.substring(1));
    let issuer = "";
    const colonIndex = label.indexOf(":");
    if (colonIndex !== -1) {
      issuer = label.substring(0, colonIndex).trim();
      label = label.substring(colonIndex + 1).trim();
    }

    const searchParams = url.searchParams;
    const secret = searchParams.get("secret") || "";
    if (!secret) {
      throw new Error("Secret parameter is missing");
    }

    const issuerParam = searchParams.get("issuer");
    if (issuerParam) {
      issuer = issuerParam.trim();
    }

    const digits = parseInt(searchParams.get("digits") || "6", 10);
    const period = parseInt(searchParams.get("period") || "30", 10);
    const counterVal = searchParams.get("counter");
    const counter = counterVal ? parseInt(counterVal, 10) : undefined;
    const algorithm = searchParams.get("algorithm") || "SHA1";

    return {
      type: type as "totp" | "hotp",
      label,
      issuer: issuer || "Unknown",
      secret,
      digits: isNaN(digits) ? 6 : digits,
      period: isNaN(period) ? 30 : period,
      counter: counter !== undefined && !isNaN(counter) ? counter : undefined,
      algorithm: algorithm.toUpperCase(),
    };
  };

  try {
    return parseLogic(uri);
  } catch {
    // Fallback manual parser for standard otpauth strings that URL() may fail to parse
    const match = uri.match(/^otpauth:\/\/([^/]+)\/([^?]+)\?(.*)$/i);
    if (!match) {
      throw new Error("Invalid OTP URI format");
    }
    const type = match[1].toLowerCase();
    if (type !== "totp" && type !== "hotp") {
      throw new Error(`Unsupported OTP type: ${type}`);
    }

    let label = decodeURIComponent(match[2]);
    let issuer = "";
    const colonIndex = label.indexOf(":");
    if (colonIndex !== -1) {
      issuer = label.substring(0, colonIndex).trim();
      label = label.substring(colonIndex + 1).trim();
    }

    const query = match[3];
    const searchParams = new Map<string, string>();
    query.split("&").forEach((part) => {
      const eq = part.indexOf("=");
      if (eq !== -1) {
        searchParams.set(
          decodeURIComponent(part.substring(0, eq)).toLowerCase(),
          decodeURIComponent(part.substring(eq + 1))
        );
      }
    });

    const secret = searchParams.get("secret") || "";
    if (!secret) {
      throw new Error("Secret parameter is missing");
    }

    const issuerParam = searchParams.get("issuer");
    if (issuerParam) {
      issuer = issuerParam.trim();
    }

    const digits = parseInt(searchParams.get("digits") || "6", 10);
    const period = parseInt(searchParams.get("period") || "30", 10);
    const counterVal = searchParams.get("counter");
    const counter = counterVal ? parseInt(counterVal, 10) : undefined;
    const algorithm = searchParams.get("algorithm") || "SHA1";

    return {
      type: type as "totp" | "hotp",
      label,
      issuer: issuer || "Unknown",
      secret,
      digits: isNaN(digits) ? 6 : digits,
      period: isNaN(period) ? 30 : period,
      counter: counter !== undefined && !isNaN(counter) ? counter : undefined,
      algorithm: algorithm.toUpperCase(),
    };
  }
}

/**
 * Generate a TOTP code.
 */
export function generateTotp(
  secret: string,
  options?: {
    period?: number;
    digits?: number;
    time?: number;
  }
): string {
  const period = options?.period ?? 30;
  const digits = options?.digits ?? 6;
  const time = options?.time ?? Math.floor(Date.now() / 1000);

  const counter = Math.floor(time / period);
  const secretBytes = decodeBase32(secret);

  const keyWordArray = CryptoJS.enc.Hex.parse(uint8ArrayToHex(secretBytes));
  const counterHex = counterToHex(counter);
  const counterWordArray = CryptoJS.enc.Hex.parse(counterHex);

  const hmac = CryptoJS.HmacSHA1(counterWordArray, keyWordArray);
  const hmacHex = CryptoJS.enc.Hex.stringify(hmac);
  const hmacBytes = hexToBytes(hmacHex);

  const offset = hmacBytes[hmacBytes.length - 1] & 0xf;
  const binary =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff);

  const otpNum = binary % Math.pow(10, digits);
  return otpNum.toString().padStart(digits, "0");
}
