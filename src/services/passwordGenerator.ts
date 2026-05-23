import * as Crypto from "expo-crypto";

export interface GeneratorOptions {
  length: number;
  useUppercase: boolean;
  useLowercase: boolean;
  useNumbers: boolean;
  useSymbols: boolean;
  excludeLookalikes: boolean;
}

const UPPERCASE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // Excludes I, O if lookalikes excluded, standard below
const UPPERCASE_CHARSET_ALL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE_CHARSET = "abcdefghijkmnopqrstuvwxyz"; // Excludes l, o if lookalikes excluded
const LOWERCASE_CHARSET_ALL = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS_CHARSET = "23456789"; // Excludes 0, 1 if lookalikes excluded
const NUMBERS_CHARSET_ALL = "0123456789";
const SYMBOLS_CHARSET = "!@#$%^&*()_+-=[]{}|;:,.<>?";

export function generatePassword(options: GeneratorOptions): string {
  let charset = "";
  if (options.useUppercase) {
    charset += options.excludeLookalikes
      ? UPPERCASE_CHARSET
      : UPPERCASE_CHARSET_ALL;
  }
  if (options.useLowercase) {
    charset += options.excludeLookalikes
      ? LOWERCASE_CHARSET
      : LOWERCASE_CHARSET_ALL;
  }
  if (options.useNumbers) {
    charset += options.excludeLookalikes
      ? NUMBERS_CHARSET
      : NUMBERS_CHARSET_ALL;
  }
  if (options.useSymbols) {
    charset += SYMBOLS_CHARSET;
  }

  if (charset.length === 0) {
    return "";
  }

  let result = "";
  try {
    const array = new Uint32Array(options.length);
    Crypto.getRandomValues(array);
    for (let i = 0; i < options.length; i++) {
      result += charset[array[i] % charset.length];
    }
    return result;
  } catch {
    // Fallback to Math.random
    for (let i = 0; i < options.length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      result += charset[randomIndex];
    }
    return result;
  }
}

export interface PasswordStrength {
  score: number; // 0 to 4
  label: "Weak" | "Fair" | "Good" | "Strong" | "Very Strong";
  color: string;
  entropy: number; // in bits
}

export function estimatePasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, label: "Weak", color: "#EF4444", entropy: 0 };
  }

  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 26; // approx symbol pool size

  if (poolSize === 0) poolSize = 1;

  const entropy = password.length * Math.log2(poolSize);

  // Strength score based on entropy thresholds
  if (entropy < 28) {
    return { score: 0, label: "Weak", color: "#EF4444", entropy };
  } else if (entropy < 48) {
    return { score: 1, label: "Fair", color: "#F59E0B", entropy };
  } else if (entropy < 64) {
    return { score: 2, label: "Good", color: "#EAB308", entropy };
  } else if (entropy < 80) {
    return { score: 3, label: "Strong", color: "#10B981", entropy };
  } else {
    return { score: 4, label: "Very Strong", color: "#34D399", entropy };
  }
}
