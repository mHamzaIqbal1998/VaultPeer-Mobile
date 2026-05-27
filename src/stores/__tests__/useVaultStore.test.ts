import { useVaultStore } from "../useVaultStore";
import { createNewDatabase, initCryptoEngine } from "../../services/crypto";
import {
  isBiometricEnabled,
  enableBiometric,
} from "../../services/biometricService";
import * as kdbxweb from "kdbxweb";
import * as SecureStore from "expo-secure-store";

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock("react-native-argon2-turbo", () => ({
  argon2Hash: jest.fn(),
}));

jest.mock("../../services/biometricService", () => ({
  isBiometricEnabled: jest.fn(),
  enableBiometric: jest.fn(),
  disableBiometric: jest.fn(),
  isBiometricsSupported: jest.fn(),
}));

describe("useVaultStore", () => {
  beforeAll(() => {
    initCryptoEngine();
  });

  beforeEach(() => {
    useVaultStore.getState().closeDatabase();
  });

  it("should open a database and parse its structure", () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();
    expect(state._db).toBe(db);
    expect(state.rootGroup).not.toBeNull();
    expect(state.rootGroup?.name).toBe("Test Vault");
    expect(state.activeGroupUuid).toBe(state.rootGroup?.uuid);
    expect(state.filePath).toBe("test-path.kdbx");
    expect(state.isDirty).toBe(false);
  });

  it("should clear the state on closeDatabase", () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");
    expect(useVaultStore.getState()._db).toBe(db);

    useVaultStore.getState().closeDatabase();
    const state = useVaultStore.getState();
    expect(state._db).toBeNull();
    expect(state.rootGroup).toBeNull();
    expect(state.activeGroupUuid).toBeNull();
    expect(state.entryIndex.size).toBe(0);
    expect(state.groupIndex.size).toBe(0);
  });

  it("should add a new entry and update the parsed state and indices", async () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const stateBefore = useVaultStore.getState();
    const rootUuid = stateBefore.rootGroup!.uuid;
    const initialEntryCount = stateBefore.entryIndex.size;

    // Create entry
    const newEntry = await useVaultStore.getState().createEntry(rootUuid, {
      title: "New Entry Title",
      username: "user123",
      password: "securepassword",
    });

    expect(newEntry).not.toBeNull();
    expect(newEntry?.title).toBe("New Entry Title");
    expect(newEntry?.username).toBe("user123");
    expect(newEntry?.password).toBe("securepassword");

    const stateAfter = useVaultStore.getState();
    expect(stateAfter.isDirty).toBe(true);
    expect(stateAfter.entryIndex.size).toBe(initialEntryCount + 1);

    // Verify it is in the active group's entries
    const activeGroup = stateAfter.getActiveGroup();
    expect(activeGroup).not.toBeNull();
    const foundEntry = activeGroup?.entries.find(
      (e) => e.uuid === newEntry?.uuid
    );
    expect(foundEntry).toBeDefined();
    expect(foundEntry?.title).toBe("New Entry Title");
  });

  it("should support tags, custom fields, expiration, and attachments in createEntry and updateEntry", async () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();
    const rootUuid = state.rootGroup!.uuid;

    // Test attachments payload
    const testAttachment = {
      id: "test.txt",
      name: "test.txt",
      size: 11,
      data: "SGVsbG8gV29ybGQ=", // "Hello World" in base64
    };

    const newEntry = await state.createEntry(rootUuid, {
      title: "Detailed Entry",
      username: "user",
      password: "pwd",
      fields: {
        PinCode: "1234",
        PlainField: "NotSecret",
      },
      secureFields: ["PinCode"],
      tags: ["work", "finance"],
      expires: true,
      expiryTime: new Date(Date.now() + 100000).toISOString(),
      attachments: [testAttachment],
    });

    expect(newEntry).not.toBeNull();
    expect(newEntry?.title).toBe("Detailed Entry");
    expect(newEntry?.tags).toEqual(["work", "finance"]);
    expect(newEntry?.expires).toBe(true);
    expect(newEntry?.fields["PinCode"]).toBe("1234");
    expect(newEntry?.fields["PlainField"]).toBe("NotSecret");
    expect(newEntry?.secureFields).toContain("PinCode");
    expect(newEntry?.attachments.length).toBe(1);
    expect(newEntry?.attachments[0].name).toBe("test.txt");
    expect(newEntry?.attachments[0].data).toBe("");

    // Fetch the data on demand via getAttachmentData
    const fetchedData = await useVaultStore
      .getState()
      .getAttachmentData(newEntry!.uuid, "test.txt");
    expect(fetchedData).toBe("SGVsbG8gV29ybGQ=");

    // Test update
    const updatedEntry = await useVaultStore
      .getState()
      .updateEntry(newEntry!.uuid, {
        title: "Updated Detailed Entry",
        fields: {
          PinCode: "4321",
          NewField: "Added",
        },
        secureFields: ["PinCode"],
        tags: ["personal"],
        expires: false,
      });

    expect(updatedEntry).not.toBeNull();
    expect(updatedEntry?.title).toBe("Updated Detailed Entry");
    expect(updatedEntry?.tags).toEqual(["personal"]);
    expect(updatedEntry?.expires).toBe(false);
    expect(updatedEntry?.fields["PinCode"]).toBe("4321");
    expect(updatedEntry?.fields["NewField"]).toBe("Added");
    expect(updatedEntry?.fields["PlainField"]).toBeUndefined(); // removed since not in fields map
  });

  it("should handle recycle bin conditional permanent deletion for entries", async () => {
    const db = createNewDatabase("Test Vault", "password123");
    db.meta.recycleBinEnabled = true;
    db.createRecycleBin();

    useVaultStore.getState().openDatabase(db, "test-path.kdbx");
    const state = useVaultStore.getState();
    const rootUuid = state.rootGroup!.uuid;
    const recycleBinUuid = db.meta.recycleBinUuid?.id;
    expect(recycleBinUuid).toBeDefined();

    // Create entry
    const entry = await useVaultStore.getState().createEntry(rootUuid, {
      title: "Recycle Me",
      username: "user123",
      password: "pass",
    });
    expect(entry).not.toBeNull();
    const entryUuid = entry!.uuid;

    // Soft delete (moves to recycle bin)
    useVaultStore.getState().deleteEntry(entryUuid);

    const stateAfterDelete = useVaultStore.getState();
    const deletedEntry = stateAfterDelete.entryIndex.get(entryUuid);
    expect(deletedEntry).toBeDefined();
    expect(deletedEntry?.parentGroupUuid).toBe(recycleBinUuid);
    expect(
      stateAfterDelete.isGroupInRecycleBin(deletedEntry!.parentGroupUuid)
    ).toBe(true);

    // Hard delete (permanently removes)
    useVaultStore.getState().deleteEntry(entryUuid);

    const stateAfterPermanentDelete = useVaultStore.getState();
    expect(stateAfterPermanentDelete.entryIndex.get(entryUuid)).toBeUndefined();
  });

  it("should handle recycle bin conditional permanent deletion for groups", () => {
    const db = createNewDatabase("Test Vault", "password123");
    db.meta.recycleBinEnabled = true;
    db.createRecycleBin();

    useVaultStore.getState().openDatabase(db, "test-path.kdbx");
    const state = useVaultStore.getState();
    const rootUuid = state.rootGroup!.uuid;
    const recycleBinUuid = db.meta.recycleBinUuid?.id;
    expect(recycleBinUuid).toBeDefined();

    // Create group
    const group = useVaultStore
      .getState()
      .createGroup(rootUuid, "Folder to Delete");
    expect(group).not.toBeNull();
    const groupUuid = group!.uuid;

    // Soft delete (moves to recycle bin)
    useVaultStore.getState().deleteGroup(groupUuid);

    const stateAfterDelete = useVaultStore.getState();
    const deletedGroup = stateAfterDelete.groupIndex.get(groupUuid);
    expect(deletedGroup).toBeDefined();
    expect(deletedGroup?.parentGroupUuid).toBe(recycleBinUuid);

    // Hard delete (permanently removes)
    useVaultStore.getState().deleteGroup(groupUuid);

    const stateAfterPermanentDelete = useVaultStore.getState();
    expect(stateAfterPermanentDelete.groupIndex.get(groupUuid)).toBeUndefined();
  });

  it("should change the master password and update biometric settings", async () => {
    const mockIsBiometricEnabled = isBiometricEnabled as jest.Mock;
    const mockEnableBiometric = enableBiometric as jest.Mock;

    mockIsBiometricEnabled.mockResolvedValue(true);
    mockEnableBiometric.mockResolvedValue(true);

    const db = createNewDatabase("Test Vault", "oldPassword");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const success = await useVaultStore
      .getState()
      .changeMasterPassword("newPassword");
    expect(success).toBe(true);

    const state = useVaultStore.getState();
    expect(state.isDirty).toBe(true);

    // Verify credentials contain newPassword
    const updatedDb = state._db;
    expect(updatedDb).not.toBeNull();
    const credentials = updatedDb?.credentials as any;
    expect(credentials?.passwordHash).toBeDefined();

    // Verify it matches the hash of "newPassword"
    const expectedHash =
      await kdbxweb.ProtectedValue.fromString("newPassword").getHash();
    const actualHash = credentials.passwordHash.getBinary();
    expect(new Uint8Array(actualHash)).toEqual(new Uint8Array(expectedHash));

    // Verify biometric updates
    expect(mockEnableBiometric).toHaveBeenCalledWith("newPassword");
  });

  describe("app preferences", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Reset state defaults
      const store = useVaultStore.getState();
      store.theme = "dark";
      store.autoLockTimeout = 60000;
      store.clipboardClearTime = 30000;
    });

    it("should initialize with default app preferences", () => {
      const state = useVaultStore.getState();
      expect(state.theme).toBe("dark");
      expect(state.autoLockTimeout).toBe(60000);
      expect(state.clipboardClearTime).toBe(30000);
    });

    it("should update and persist theme selection", async () => {
      const store = useVaultStore.getState();
      const mockSetItem = SecureStore.setItemAsync as jest.Mock;

      await store.setTheme("light");

      const state = useVaultStore.getState();
      expect(state.theme).toBe("light");
      expect(mockSetItem).toHaveBeenCalledWith("vault_app_theme", "light");
    });

    it("should update and persist auto-lock timeout selection", async () => {
      const store = useVaultStore.getState();
      const mockSetItem = SecureStore.setItemAsync as jest.Mock;

      await store.setAutoLockTimeout(120000);

      const state = useVaultStore.getState();
      expect(state.autoLockTimeout).toBe(120000);
      expect(mockSetItem).toHaveBeenCalledWith(
        "vault_app_auto_lock_timeout",
        "120000"
      );
    });

    it("should update and persist clipboard clear timeout selection", async () => {
      const store = useVaultStore.getState();
      const mockSetItem = SecureStore.setItemAsync as jest.Mock;

      await store.setClipboardClearTime(15000);

      const state = useVaultStore.getState();
      expect(state.clipboardClearTime).toBe(15000);
      expect(mockSetItem).toHaveBeenCalledWith(
        "vault_app_clipboard_clear_time",
        "15000"
      );
    });

    it("should load persisted app preferences on startup", async () => {
      const mockGetItem = SecureStore.getItemAsync as jest.Mock;
      mockGetItem.mockImplementation((key: string) => {
        if (key === "vault_app_theme") return Promise.resolve("light");
        if (key === "vault_app_auto_lock_timeout")
          return Promise.resolve("300000");
        if (key === "vault_app_clipboard_clear_time")
          return Promise.resolve("10000");
        return Promise.resolve(null);
      });

      const store = useVaultStore.getState();
      await store.loadAppSettings();

      const state = useVaultStore.getState();
      expect(state.theme).toBe("light");
      expect(state.autoLockTimeout).toBe(300000);
      expect(state.clipboardClearTime).toBe(10000);
    });
  });
});
