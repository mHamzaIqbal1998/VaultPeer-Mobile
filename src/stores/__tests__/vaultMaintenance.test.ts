import { useVaultStore } from "../useVaultStore";
import { createNewDatabase, initCryptoEngine } from "../../services/crypto";
import * as kdbxweb from "kdbxweb";

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock("react-native-argon2-turbo", () => ({
  hash: jest.fn().mockResolvedValue({ rawHash: "00".repeat(32) }),
}));

describe("Vault Maintenance and Compression", () => {
  beforeAll(() => {
    initCryptoEngine();
  });

  beforeEach(() => {
    useVaultStore.getState().closeDatabase();
  });

  it("should change compression settings, set dirty state, and affect serialization", async () => {
    const db = createNewDatabase("Compression Test", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();
    expect(state.meta?.compression).toBe("GZip"); // Default is GZip
    expect(db.header.compression).toBe(1);

    // Toggle to None
    db.header.compression = 0;
    state.refreshParsedState();
    useVaultStore.setState({ isDirty: true });

    const stateNone = useVaultStore.getState();
    expect(stateNone.meta?.compression).toBe("None");
    expect(stateNone.isDirty).toBe(true);

    // Save database and verify it can be loaded back
    const arrayBufferNone = await db.save();
    const credentials = new kdbxweb.KdbxCredentials(
      kdbxweb.ProtectedValue.fromString("password123")
    );
    const loadedDbNone = await kdbxweb.Kdbx.load(arrayBufferNone, credentials);
    expect(loadedDbNone.header.compression).toBe(0);

    // Toggle back to GZip
    db.header.compression = 1;
    state.refreshParsedState();
    const stateGZip = useVaultStore.getState();
    expect(stateGZip.meta?.compression).toBe("GZip");

    const arrayBufferGzip = await db.save();
    const loadedDbGzip = await kdbxweb.Kdbx.load(arrayBufferGzip, credentials);
    expect(loadedDbGzip.header.compression).toBe(1);
  });

  it("should predict and run database cleanup of unreferenced binaries and old history", async () => {
    const db = createNewDatabase("Cleanup Test", "password123");
    // Ensure history limit is configured
    db.meta.historyMaxItems = 1;
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();
    const rootUuid = state.rootGroup!.uuid;

    // Create an entry with an attachment
    const entry = await state.createEntry(rootUuid, {
      title: "Binary Entry",
      username: "user",
      password: "pwd",
      attachments: [
        {
          id: "doc.txt",
          name: "doc.txt",
          size: 12,
          data: "SGVsbG8gQ2xlYW51cA==", // "Hello Cleanup"
        },
      ],
    });

    expect(entry).not.toBeNull();
    expect(db.binaries.getAllWithHashes().length).toBe(1);

    // Now, update the entry to remove the attachment (simulate unreferencing it)
    await state.updateEntry(entry!.uuid, {
      title: "Binary Entry Updated",
      attachments: [],
    });

    // The binary is still in db.binaries but unreferenced by any entries
    expect(db.binaries.getAllWithHashes().length).toBe(1);

    // Let's also simulate redundant history by manually pushing history entries
    const dbEntry = db.getDefaultGroup().entries[0];
    // Create dummy history entries (KdbxEntry clones)
    const history1 = new kdbxweb.KdbxEntry();
    history1.fields.set("Title", "History 1");
    const history2 = new kdbxweb.KdbxEntry();
    history2.fields.set("Title", "History 2");
    dbEntry.history.push(history1, history2);

    expect(dbEntry.history.length).toBe(3); // 1 from updateEntry + 2 manually pushed = 3

    // Run prediction
    const prediction = state.cleanupDatabase({ binaries: true, history: true });
    expect(prediction).not.toBeNull();
    expect(prediction?.binariesToRemove).toBe(1);
    expect(prediction?.historyToRemove).toBe(2); // 3 - 1 = 2 redundant history entries

    // Run actual cleanup
    const success = state.runCleanupDatabase({ binaries: true, history: true });
    expect(success).toBe(true);

    // Verify cleanup results
    expect(db.binaries.getAllWithHashes().length).toBe(0); // binary removed!
    expect(dbEntry.history.length).toBe(1); // oldest history removed, leaving 1!
    expect(useVaultStore.getState().isDirty).toBe(true);
  });
});
