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

  it("should add a new entry and update the parsed state and indices", () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const stateBefore = useVaultStore.getState();
    const rootUuid = stateBefore.rootGroup!.uuid;
    const initialEntryCount = stateBefore.entryIndex.size;

    // Create entry
    const newEntry = useVaultStore.getState().createEntry(rootUuid, {
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

  it("should handle recycle bin conditional permanent deletion for entries", () => {
    const db = createNewDatabase("Test Vault", "password123");
    db.meta.recycleBinEnabled = true;
    db.createRecycleBin();

    useVaultStore.getState().openDatabase(db, "test-path.kdbx");
    const state = useVaultStore.getState();
    const rootUuid = state.rootGroup!.uuid;
    const recycleBinUuid = db.meta.recycleBinUuid?.id;
    expect(recycleBinUuid).toBeDefined();

    // Create entry
    const entry = useVaultStore.getState().createEntry(rootUuid, {
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
