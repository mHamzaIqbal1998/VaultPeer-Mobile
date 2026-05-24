import { useVaultStore } from "../useVaultStore";
import { createNewDatabase, initCryptoEngine } from "../../services/crypto";

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock("react-native-argon2-turbo", () => ({
  argon2Hash: jest.fn(),
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
    expect(newEntry?.attachments[0].data).toBe("SGVsbG8gV29ybGQ=");

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
});
