/**
 * KDF Benchmark Service
 *
 * Runs test derivations for AES-KDF and Argon2 algorithms,
 * calculates elapsed time, and estimates the parameters required
 * to achieve a ~1.0-second delay on the current device.
 *
 * This mirrors KeePassDX's "Calculate for 1.0s" benchmark feature,
 * allowing users to calibrate their KDF parameters to match their
 * device's hardware capabilities.
 */

import { nativeArgon2Hash } from "./argon2Bridge";

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export type KdfType = "Argon2id" | "Argon2d" | "AES-KDF";

export interface KdfBenchmarkResult {
  /** Which KDF was benchmarked */
  kdfType: KdfType;
  /** How long the test derivation took (ms) */
  elapsedMs: number;
  /** Estimated parameters to achieve ~1.0s derivation */
  recommended: KdfTuningParams;
}

export interface KdfTuningParams {
  /** AES-KDF: number of rounds */
  rounds?: number;
  /** Argon2: memory in KiB */
  memory?: number;
  /** Argon2: iteration count */
  iterations?: number;
  /** Argon2: parallelism lanes */
  parallelism?: number;
}

// ────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────

/** Target derivation time in milliseconds */
const TARGET_MS = 1000;

/** Minimum safe values */
const MIN_AES_ROUNDS = 10000;
const MIN_ARGON2_MEMORY = 8192; // 8 MiB
const MIN_ARGON2_ITERATIONS = 1;
const MIN_ARGON2_PARALLELISM = 1;

/** Default test parameters */
const TEST_ARGON2_MEMORY = 65536; // 64 MiB
const TEST_ARGON2_ITERATIONS = 2;
const TEST_ARGON2_PARALLELISM = 2;

/** AES-KDF benchmark test rounds (small enough to be fast) */
const AES_KDF_TEST_ROUNDS = 100000;

// ────────────────────────────────────────────
// Random test data generators
// ────────────────────────────────────────────

function generateTestBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// ────────────────────────────────────────────
// AES-KDF Benchmark
// ────────────────────────────────────────────

/**
 * Benchmark AES-KDF by running a test derivation with a known
 * round count and estimating how many rounds achieve ~1.0s.
 *
 * Uses WebCrypto's AES-CBC encrypt loop, same as kdbxweb's internal
 * AES-KDF implementation.
 */
async function benchmarkAesKdf(): Promise<KdfBenchmarkResult> {
  const testKey = generateTestBytes(32);
  const testSeed = generateTestBytes(32);

  // Import AES key for benchmarking
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    testSeed,
    { name: "AES-CBC", length: 256 },
    false,
    ["encrypt"]
  );

  // Fixed IV for benchmark (not security-sensitive — this is timing only)
  const iv = new Uint8Array(16);
  let data = new Uint8Array(testKey);

  const startTime = performance.now();

  // Run test rounds
  for (let i = 0; i < AES_KDF_TEST_ROUNDS; i++) {
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-CBC", iv },
      cryptoKey,
      data
    );
    // Take first 32 bytes of result
    data = new Uint8Array(encrypted).slice(0, 32);
  }

  const elapsedMs = performance.now() - startTime;

  // Estimate rounds for TARGET_MS
  const roundsPerMs = AES_KDF_TEST_ROUNDS / elapsedMs;
  const estimatedRounds = Math.max(
    MIN_AES_ROUNDS,
    Math.round(roundsPerMs * TARGET_MS)
  );

  return {
    kdfType: "AES-KDF",
    elapsedMs: Math.round(elapsedMs),
    recommended: {
      rounds: estimatedRounds,
    },
  };
}

// ────────────────────────────────────────────
// Argon2 Benchmark
// ────────────────────────────────────────────

/**
 * Benchmark Argon2 (id or d) by running a test hash with moderate
 * parameters and scaling iterations to achieve ~1.0s.
 *
 * Strategy: Run with fixed memory/parallelism and a small iteration
 * count, then scale iterations proportionally.
 */
async function benchmarkArgon2(
  type: "Argon2id" | "Argon2d"
): Promise<KdfBenchmarkResult> {
  const testPassword = generateTestBytes(32);
  const testSalt = generateTestBytes(32);
  const argon2Type = type === "Argon2d" ? 0 : 2; // 0=d, 2=id

  const startTime = performance.now();

  await nativeArgon2Hash({
    password: testPassword,
    salt: testSalt,
    memory: TEST_ARGON2_MEMORY,
    iterations: TEST_ARGON2_ITERATIONS,
    hashLength: 32,
    parallelism: TEST_ARGON2_PARALLELISM,
    type: argon2Type,
    version: 0x13,
  });

  const elapsedMs = performance.now() - startTime;

  // Scale iterations to achieve target time
  // If 2 iterations took X ms, we need (TARGET_MS / X) * 2 iterations
  const scaleFactor = TARGET_MS / elapsedMs;
  const estimatedIterations = Math.max(
    MIN_ARGON2_ITERATIONS,
    Math.round(TEST_ARGON2_ITERATIONS * scaleFactor)
  );

  return {
    kdfType: type,
    elapsedMs: Math.round(elapsedMs),
    recommended: {
      memory: TEST_ARGON2_MEMORY,
      iterations: estimatedIterations,
      parallelism: TEST_ARGON2_PARALLELISM,
    },
  };
}

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

/**
 * Run a KDF benchmark for the specified algorithm.
 *
 * Returns the elapsed time of the test derivation and recommended
 * parameters to achieve ~1.0s derivation on this device.
 *
 * @param kdfType - The KDF algorithm to benchmark
 * @returns Benchmark results with recommended parameters
 */
export async function runKdfBenchmark(
  kdfType: KdfType
): Promise<KdfBenchmarkResult> {
  switch (kdfType) {
    case "AES-KDF":
      return benchmarkAesKdf();
    case "Argon2id":
      return benchmarkArgon2("Argon2id");
    case "Argon2d":
      return benchmarkArgon2("Argon2d");
    default:
      throw new Error(`[KdfBenchmark] Unsupported KDF type: ${kdfType}`);
  }
}

/**
 * Get the current KDF parameters from a kdbxweb database header.
 *
 * Reads kdfParameters map and returns a normalized params object.
 */
export function getCurrentKdfParams(
  kdfParameters: Map<string, unknown> | undefined
): KdfTuningParams & { kdfType: KdfType } {
  if (!kdfParameters) {
    return {
      kdfType: "Argon2id",
      iterations: 2,
      memory: 65536,
      parallelism: 2,
    };
  }

  const uuid = kdfParameters.get("$UUID");
  let kdfType: KdfType = "Argon2id";

  if (uuid) {
    // Convert UUID to hex for matching
    const hex = uuidToHex(uuid);
    if (hex.includes("ef636ddf")) {
      kdfType = "Argon2d";
    } else if (hex.includes("c9d9f39a")) {
      kdfType = "AES-KDF";
    } else {
      kdfType = "Argon2id";
    }
  }

  const toNumber = (val: unknown): number | undefined => {
    if (typeof val === "number") {
      return val;
    }
    if (val && typeof val === "object") {
      const anyVal = val as any;
      if (typeof anyVal.value === "number") {
        return anyVal.value;
      }
      if (typeof anyVal.valueOf === "function") {
        const num = anyVal.valueOf();
        if (typeof num === "number") {
          return num;
        }
      }
    }
    return undefined;
  };

  if (kdfType === "AES-KDF") {
    const rounds = toNumber(kdfParameters.get("R"));
    return {
      kdfType,
      rounds: rounds !== undefined ? rounds : 60000,
    };
  }

  // Argon2 parameters
  const memory = toNumber(kdfParameters.get("M"));
  const iterations = toNumber(kdfParameters.get("I"));
  const parallelism = toNumber(kdfParameters.get("P"));

  return {
    kdfType,
    memory: memory !== undefined ? Math.round(memory / 1024) : 65536, // Convert bytes to KiB
    iterations: iterations !== undefined ? iterations : 2,
    parallelism: parallelism !== undefined ? parallelism : 2,
  };
}

/**
 * Validate KDF parameters to ensure they're within safe bounds.
 */
export function validateKdfParams(
  kdfType: KdfType,
  params: KdfTuningParams
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (kdfType === "AES-KDF") {
    if (params.rounds !== undefined && params.rounds < MIN_AES_ROUNDS) {
      errors.push(
        `AES-KDF rounds must be at least ${MIN_AES_ROUNDS.toLocaleString()}`
      );
    }
    if (params.rounds !== undefined && params.rounds > 100_000_000) {
      errors.push("AES-KDF rounds must be at most 100,000,000");
    }
  } else {
    // Argon2
    if (params.memory !== undefined && params.memory < MIN_ARGON2_MEMORY) {
      errors.push(
        `Argon2 memory must be at least ${(MIN_ARGON2_MEMORY / 1024).toFixed(0)} MiB`
      );
    }
    if (params.memory !== undefined && params.memory > 4_194_304) {
      errors.push("Argon2 memory must be at most 4 GiB");
    }
    if (
      params.iterations !== undefined &&
      params.iterations < MIN_ARGON2_ITERATIONS
    ) {
      errors.push(
        `Argon2 iterations must be at least ${MIN_ARGON2_ITERATIONS}`
      );
    }
    if (params.iterations !== undefined && params.iterations > 100) {
      errors.push("Argon2 iterations must be at most 100");
    }
    if (
      params.parallelism !== undefined &&
      params.parallelism < MIN_ARGON2_PARALLELISM
    ) {
      errors.push(
        `Argon2 parallelism must be at least ${MIN_ARGON2_PARALLELISM}`
      );
    }
    if (params.parallelism !== undefined && params.parallelism > 16) {
      errors.push("Argon2 parallelism must be at most 16");
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Format KDF parameters for human-readable display.
 */
export function formatKdfParams(
  kdfType: KdfType,
  params: KdfTuningParams
): string[] {
  if (kdfType === "AES-KDF") {
    return [`Rounds: ${(params.rounds ?? 60000).toLocaleString()}`];
  }

  return [
    `Memory: ${formatMemory(params.memory ?? 65536)}`,
    `Iterations: ${params.iterations ?? 2}`,
    `Parallelism: ${params.parallelism ?? 2} threads`,
  ];
}

/**
 * Format memory in KiB to human-readable string.
 */
export function formatMemory(kib: number): string {
  if (kib >= 1_048_576) {
    return `${(kib / 1_048_576).toFixed(1)} GiB`;
  }
  if (kib >= 1024) {
    return `${(kib / 1024).toFixed(0)} MiB`;
  }
  return `${kib} KiB`;
}

// ────────────────────────────────────────────
// UUID Hex Helper (duplicated from parser for isolation)
// ────────────────────────────────────────────

function uuidToHex(uuid: unknown): string {
  if (!uuid) return "";
  if (typeof uuid === "string") return uuid;

  const anyUuid = uuid as any;
  let bytes: ArrayBuffer | Uint8Array | undefined;

  if (typeof anyUuid.toBytes === "function") {
    bytes = anyUuid.toBytes();
  } else if (anyUuid.bytes instanceof ArrayBuffer) {
    bytes = anyUuid.bytes;
  } else if (anyUuid instanceof ArrayBuffer || anyUuid instanceof Uint8Array) {
    bytes = anyUuid;
  } else if (typeof anyUuid === "object" && anyUuid !== null) {
    if (anyUuid.id && typeof anyUuid.id === "string") {
      return anyUuid.id;
    }
    bytes = new Uint8Array(Object.values(anyUuid) as number[]);
  } else {
    return String(uuid);
  }

  if (!bytes) return "";
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = "";
  for (let i = 0; i < uint8.length; i++) {
    hex += uint8[i].toString(16).padStart(2, "0");
  }
  return hex;
}
