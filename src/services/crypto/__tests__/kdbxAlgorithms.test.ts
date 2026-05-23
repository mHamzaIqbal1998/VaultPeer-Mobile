import {
  createNewDatabase,
  decryptDatabase,
  initCryptoEngine,
} from "../cryptoEngine";
import { parseDatabase } from "../databaseParser";

// Mock react-native Platform
jest.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

// Mock react-native-argon2-turbo to return a fixed 32-byte key (64 hex characters)
jest.mock("react-native-argon2-turbo", () => ({
  hash: jest.fn().mockResolvedValue({
    rawHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    encodedHash: "$argon2id$v=19$m=65536,t=3,p=1$...",
  }),
}));

describe("KDBX Custom Algorithm Combinations", () => {
  beforeAll(() => {
    initCryptoEngine();
  });

  const kdfs = ["Argon2id", "Argon2d", "AES-KDF"] as const;
  const ciphers = ["AES-256", "ChaCha20"] as const;

  for (const kdf of kdfs) {
    for (const cipher of ciphers) {
      it(`should successfully create, save, and load a vault with KDF=${kdf} and Cipher=${cipher}`, async () => {
        // 1. Create database with options
        const db = createNewDatabase(
          "TestVault",
          "myMasterPassword",
          undefined,
          {
            kdf,
            cipher,
          }
        );

        // 2. Validate in-memory metadata before saving
        const parsedBefore = parseDatabase(db);
        expect(parsedBefore.meta.kdfName).toBe(kdf);
        expect(parsedBefore.meta.cipherName).toBe(cipher);

        // 3. Save (serialize) database
        const savedBuffer = await db.save();
        expect(savedBuffer).toBeInstanceOf(ArrayBuffer);
        expect(savedBuffer.byteLength).toBeGreaterThan(0);

        // 4. Decrypt and load database back
        const decryptedDb = await decryptDatabase(
          savedBuffer,
          "myMasterPassword"
        );
        const parsedAfter = parseDatabase(decryptedDb);

        // 5. Verify metadata remains consistent after deserialization
        expect(parsedAfter.meta.kdfName).toBe(kdf);
        expect(parsedAfter.meta.cipherName).toBe(cipher);
      });
    }
  }
});
