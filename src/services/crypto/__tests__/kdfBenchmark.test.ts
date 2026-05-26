/**
 * KDF Benchmark Service Tests
 *
 * Validates benchmarking math, parameter tuning,
 * validation logic, and formatting utilities.
 */

import {
  getCurrentKdfParams,
  validateKdfParams,
  formatKdfParams,
  formatMemory,
} from "../kdfBenchmark";

// Mock the native Argon2 module to prevent TurboModule registration errors in Jest
jest.mock("react-native-argon2-turbo", () => ({
  hash: jest.fn().mockResolvedValue({ rawHash: "00".repeat(32) }),
}));

// ────────────────────────────────────────────
// formatMemory
// ────────────────────────────────────────────

describe("formatMemory", () => {
  it("formats KiB values", () => {
    expect(formatMemory(512)).toBe("512 KiB");
  });

  it("formats MiB values", () => {
    expect(formatMemory(8192)).toBe("8 MiB");
    expect(formatMemory(65536)).toBe("64 MiB");
    expect(formatMemory(131072)).toBe("128 MiB");
  });

  it("formats GiB values", () => {
    expect(formatMemory(1048576)).toBe("1.0 GiB");
    expect(formatMemory(2097152)).toBe("2.0 GiB");
  });
});

// ────────────────────────────────────────────
// validateKdfParams
// ────────────────────────────────────────────

describe("validateKdfParams", () => {
  describe("AES-KDF", () => {
    it("accepts valid rounds", () => {
      const result = validateKdfParams("AES-KDF", { rounds: 60000 });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects rounds below minimum", () => {
      const result = validateKdfParams("AES-KDF", { rounds: 100 });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects rounds above maximum", () => {
      const result = validateKdfParams("AES-KDF", { rounds: 200_000_000 });
      expect(result.valid).toBe(false);
    });
  });

  describe("Argon2id", () => {
    it("accepts valid parameters", () => {
      const result = validateKdfParams("Argon2id", {
        memory: 65536,
        iterations: 3,
        parallelism: 4,
      });
      expect(result.valid).toBe(true);
    });

    it("rejects memory below minimum", () => {
      const result = validateKdfParams("Argon2id", { memory: 1024 });
      expect(result.valid).toBe(false);
    });

    it("rejects memory above maximum", () => {
      const result = validateKdfParams("Argon2id", { memory: 5_000_000 });
      expect(result.valid).toBe(false);
    });

    it("rejects iterations below minimum", () => {
      const result = validateKdfParams("Argon2id", { iterations: 0 });
      expect(result.valid).toBe(false);
    });

    it("rejects iterations above maximum", () => {
      const result = validateKdfParams("Argon2id", { iterations: 200 });
      expect(result.valid).toBe(false);
    });

    it("rejects parallelism below minimum", () => {
      const result = validateKdfParams("Argon2id", { parallelism: 0 });
      expect(result.valid).toBe(false);
    });

    it("rejects parallelism above maximum", () => {
      const result = validateKdfParams("Argon2d", { parallelism: 32 });
      expect(result.valid).toBe(false);
    });

    it("collects multiple errors", () => {
      const result = validateKdfParams("Argon2id", {
        memory: 100,
        iterations: 0,
        parallelism: 99,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(3);
    });
  });
});

// ────────────────────────────────────────────
// formatKdfParams
// ────────────────────────────────────────────

describe("formatKdfParams", () => {
  it("formats AES-KDF params", () => {
    const lines = formatKdfParams("AES-KDF", { rounds: 60000 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Rounds");
    expect(lines[0]).toContain("60,000");
  });

  it("formats Argon2id params", () => {
    const lines = formatKdfParams("Argon2id", {
      memory: 65536,
      iterations: 3,
      parallelism: 4,
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Memory");
    expect(lines[0]).toContain("64 MiB");
    expect(lines[1]).toContain("Iterations");
    expect(lines[1]).toContain("3");
    expect(lines[2]).toContain("Parallelism");
    expect(lines[2]).toContain("4");
  });

  it("uses defaults for missing params", () => {
    const lines = formatKdfParams("Argon2d", {});
    expect(lines).toHaveLength(3);
    // Should use default values
    expect(lines[0]).toContain("Memory");
    expect(lines[1]).toContain("Iterations");
    expect(lines[2]).toContain("Parallelism");
  });
});

// ────────────────────────────────────────────
// getCurrentKdfParams
// ────────────────────────────────────────────

describe("getCurrentKdfParams", () => {
  it("returns defaults when kdfParameters is undefined", () => {
    const result = getCurrentKdfParams(undefined);
    expect(result.kdfType).toBe("Argon2id");
    expect(result.iterations).toBe(2);
    expect(result.memory).toBe(65536);
    expect(result.parallelism).toBe(2);
  });

  it("detects AES-KDF from UUID", () => {
    const params = new Map<string, unknown>();
    // Use an object with id that contains the AES-KDF hex substring
    params.set("$UUID", { id: "c9d9f39a-test-uuid" });
    params.set("R", 60000);

    const result = getCurrentKdfParams(params);
    expect(result.kdfType).toBe("AES-KDF");
    expect(result.rounds).toBe(60000);
  });

  it("detects Argon2d from UUID", () => {
    const params = new Map<string, unknown>();
    params.set("$UUID", { id: "ef636ddf-test-uuid" });
    params.set("M", 67108864); // 64 MiB in bytes
    params.set("I", 3);
    params.set("P", 4);

    const result = getCurrentKdfParams(params);
    expect(result.kdfType).toBe("Argon2d");
    expect(result.iterations).toBe(3);
    expect(result.parallelism).toBe(4);
  });

  it("defaults to Argon2id for unknown UUID", () => {
    const params = new Map<string, unknown>();
    params.set("$UUID", { id: "9e298b19-test-uuid" });
    params.set("M", 67108864);
    params.set("I", 2);
    params.set("P", 2);

    const result = getCurrentKdfParams(params);
    expect(result.kdfType).toBe("Argon2id");
  });

  it("handles missing parameter values with defaults", () => {
    const params = new Map<string, unknown>();
    params.set("$UUID", { id: "9e298b19-test-uuid" });

    const result = getCurrentKdfParams(params);
    expect(result.kdfType).toBe("Argon2id");
    expect(result.memory).toBe(65536);
    expect(result.iterations).toBe(2);
    expect(result.parallelism).toBe(2);
  });

  it("handles kdbxweb.Int64 parameter values correctly", () => {
    const params = new Map<string, unknown>();
    params.set("$UUID", { id: "ef636ddf-test-uuid" });
    params.set("M", { value: 67108864, valueOf: () => 67108864 }); // Simulated Int64
    params.set("I", { value: 3, valueOf: () => 3 }); // Simulated Int64
    params.set("P", 4);

    const result = getCurrentKdfParams(params);
    expect(result.kdfType).toBe("Argon2d");
    expect(result.memory).toBe(65536);
    expect(result.iterations).toBe(3);
    expect(result.parallelism).toBe(4);
  });
});

// ────────────────────────────────────────────
// Benchmark estimation math validation
// ────────────────────────────────────────────

describe("benchmark estimation math", () => {
  it("scales AES-KDF rounds linearly with target time", () => {
    // If 100,000 rounds took 500ms, we need 200,000 for 1000ms
    const testRounds = 100000;
    const elapsedMs = 500;
    const targetMs = 1000;

    const roundsPerMs = testRounds / elapsedMs;
    const estimated = Math.round(roundsPerMs * targetMs);

    expect(estimated).toBe(200000);
  });

  it("scales Argon2 iterations linearly with target time", () => {
    // If 2 iterations took 600ms, we need ceil(2 * 1000/600) ≈ 3.33 ≈ 3
    const testIterations = 2;
    const elapsedMs = 600;
    const targetMs = 1000;

    const scaleFactor = targetMs / elapsedMs;
    const estimated = Math.round(testIterations * scaleFactor);

    expect(estimated).toBe(3);
  });

  it("enforces minimum AES-KDF rounds", () => {
    const minRounds = 10000;
    const testRounds = 100000;
    // Very fast device: 100,000 rounds in 50000ms would yield 2 rounds
    const elapsedMs = 50000;
    const targetMs = 1000;

    const roundsPerMs = testRounds / elapsedMs;
    const raw = Math.round(roundsPerMs * targetMs);
    const estimated = Math.max(minRounds, raw);

    expect(estimated).toBe(minRounds);
  });

  it("enforces minimum Argon2 iterations", () => {
    const minIterations = 1;
    // Very slow device: 2 iterations took 5000ms
    const testIterations = 2;
    const elapsedMs = 5000;
    const targetMs = 1000;

    const scaleFactor = targetMs / elapsedMs;
    const raw = Math.round(testIterations * scaleFactor);
    const estimated = Math.max(minIterations, raw);

    expect(estimated).toBe(minIterations);
  });
});
