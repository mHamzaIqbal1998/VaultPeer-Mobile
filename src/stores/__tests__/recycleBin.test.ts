import { useVaultStore } from "../useVaultStore";
import { createNewDatabase, initCryptoEngine } from "../../services/crypto";

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock("react-native-argon2-turbo", () => ({
  hash: jest.fn().mockResolvedValue({ rawHash: "00".repeat(32) }),
}));

describe("Vault Recycle Bin Support", () => {
  beforeAll(() => {
    initCryptoEngine();
  });

  beforeEach(() => {
    useVaultStore.getState().closeDatabase();
  });

  it("should enable and disable recycle bin, seed default recycle bin group", async () => {
    const db = createNewDatabase("Recycle Bin Test", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();

    // Explicitly disable to verify state transitions
    await state.setRecycleBinEnabled(false);
    let updatedState = useVaultStore.getState();
    expect(updatedState.meta?.recycleBinEnabled).toBe(false);

    // Enable Recycle Bin
    await state.setRecycleBinEnabled(true);

    updatedState = useVaultStore.getState();
    expect(updatedState.meta?.recycleBinEnabled).toBe(true);
    expect(updatedState.meta?.recycleBinUuid).toBeDefined();

    // Check recycle bin group in groupIndex
    const binUuid = updatedState.meta?.recycleBinUuid!;
    const binGroup = updatedState.groupIndex.get(binUuid);
    expect(binGroup).toBeDefined();
    expect(binGroup?.name).toBe("Recycle Bin");

    // Disable Recycle Bin
    await state.setRecycleBinEnabled(false);
    const disabledState = useVaultStore.getState();
    expect(disabledState.meta?.recycleBinEnabled).toBe(false);
    expect(disabledState.meta?.recycleBinUuid).toBe(binUuid);
  });

  it("should support selecting a different recycle bin group", async () => {
    const db = createNewDatabase(
      "Recycle Bin Custom Selector Test",
      "password123"
    );
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();
    const rootUuid = state.rootGroup!.uuid;

    // Create a new custom group
    const customGroup = await state.createGroup(rootUuid, "My Custom Bin");
    expect(customGroup).not.toBeNull();

    // Set it as recycle bin group
    await state.setRecycleBinGroup(customGroup!.uuid);

    const updatedState = useVaultStore.getState();
    expect(updatedState.meta?.recycleBinUuid).toBe(customGroup!.uuid);
  });

  it("should route entry deletion: move to recycle bin if enabled, delete permanently if disabled or already in bin", async () => {
    const db = createNewDatabase("Entry Deletion Route Test", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();
    const rootUuid = state.rootGroup!.uuid;

    // Explicitly disable recycle bin to start
    await state.setRecycleBinEnabled(false);

    // Create an entry in root group
    const entry = await state.createEntry(rootUuid, { title: "Test Entry 1" });
    expect(entry).not.toBeNull();
    const entryUuid = entry!.uuid;

    // 1. Recycle bin is disabled. Deletion should be permanent.
    let success = await state.deleteEntry(entryUuid);
    expect(success).toBe(true);

    let updatedState = useVaultStore.getState();
    expect(
      updatedState.groupIndex
        .get(rootUuid)
        ?.entries.find((e) => e.uuid === entryUuid)
    ).toBeUndefined();

    // Create another entry
    const entry2 = await state.createEntry(rootUuid, { title: "Test Entry 2" });
    expect(entry2).not.toBeNull();
    const entry2Uuid = entry2!.uuid;

    // 2. Enable recycle bin, deletion should move it to the recycle bin
    await state.setRecycleBinEnabled(true);
    updatedState = useVaultStore.getState();
    const binUuid = updatedState.meta?.recycleBinUuid!;

    success = await state.deleteEntry(entry2Uuid);
    expect(success).toBe(true);

    updatedState = useVaultStore.getState();
    // Entry should NOT be in root
    expect(
      updatedState.groupIndex
        .get(rootUuid)
        ?.entries.find((e) => e.uuid === entry2Uuid)
    ).toBeUndefined();
    // Entry SHOULD be in recycle bin
    const binGroup = updatedState.groupIndex.get(binUuid);
    expect(binGroup?.entries.find((e) => e.uuid === entry2Uuid)).toBeDefined();

    // 3. Delete from the recycle bin: should delete permanently
    success = await state.deleteEntry(entry2Uuid);
    expect(success).toBe(true);

    updatedState = useVaultStore.getState();
    expect(
      updatedState.groupIndex
        .get(binUuid)
        ?.entries.find((e) => e.uuid === entry2Uuid)
    ).toBeUndefined();
  });

  it("should route group deletion: move to recycle bin if enabled, delete permanently if disabled or already in bin", async () => {
    const db = createNewDatabase("Group Deletion Route Test", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();
    const rootUuid = state.rootGroup!.uuid;

    // Explicitly disable recycle bin to start
    await state.setRecycleBinEnabled(false);

    // Create a group
    const group = await state.createGroup(rootUuid, "Target Group");
    expect(group).not.toBeNull();
    const groupUuid = group!.uuid;

    // 1. Recycle bin disabled -> permanent delete
    let success = await state.deleteGroup(groupUuid);
    expect(success).toBe(true);

    let updatedState = useVaultStore.getState();
    expect(updatedState.groupIndex.get(groupUuid)).toBeUndefined();

    // Create another group
    const group2 = await state.createGroup(rootUuid, "Target Group 2");
    expect(group2).not.toBeNull();
    const group2Uuid = group2!.uuid;

    // 2. Enable recycle bin -> moves to bin
    await state.setRecycleBinEnabled(true);
    updatedState = useVaultStore.getState();
    const binUuid = updatedState.meta?.recycleBinUuid!;

    success = await state.deleteGroup(group2Uuid);
    expect(success).toBe(true);

    updatedState = useVaultStore.getState();
    expect(updatedState.groupIndex.get(group2Uuid)).toBeDefined();
    // Verify it is inside the bin
    const binGroup = updatedState.groupIndex.get(binUuid)!;
    expect(binGroup.groups.find((g) => g.uuid === group2Uuid)).toBeDefined();

    // 3. Delete from recycle bin -> permanent delete
    success = await state.deleteGroup(group2Uuid);
    expect(success).toBe(true);

    updatedState = useVaultStore.getState();
    expect(updatedState.groupIndex.get(group2Uuid)).toBeUndefined();
  });

  it("should empty recycle bin permanently", async () => {
    const db = createNewDatabase("Empty Recycle Bin Test", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();
    const rootUuid = state.rootGroup!.uuid;

    // Enable recycle bin
    await state.setRecycleBinEnabled(true);
    const updatedState = useVaultStore.getState();
    const binUuid = updatedState.meta?.recycleBinUuid!;

    // Create entry in root and delete it (so it moves to bin)
    const entry = await state.createEntry(rootUuid, { title: "Test Entry 3" });
    const entryUuid = entry!.uuid;
    await state.deleteEntry(entryUuid);

    // Create group in root and delete it (so it moves to bin)
    const group = await state.createGroup(rootUuid, "Some Group");
    const groupUuid = group!.uuid;
    await state.deleteGroup(groupUuid);

    // Verify they are in the recycle bin group
    let binGroup = useVaultStore.getState().groupIndex.get(binUuid)!;
    expect(binGroup.entries.length).toBe(1);
    expect(binGroup.groups.length).toBe(1);

    // Empty bin
    const success = await state.emptyRecycleBin();
    expect(success).toBe(true);

    // Verify recycle bin is empty
    binGroup = useVaultStore.getState().groupIndex.get(binUuid)!;
    expect(binGroup.entries.length).toBe(0);
    expect(binGroup.groups.length).toBe(0);
  });

  it("should recreate recycle bin group when enabling it after the group was deleted while disabled", async () => {
    const db = createNewDatabase("Recreate Bin Test", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();

    // 1. Enable recycle bin first to make sure it exists
    await state.setRecycleBinEnabled(true);
    let updatedState = useVaultStore.getState();
    const binUuid = updatedState.meta?.recycleBinUuid!;
    expect(binUuid).toBeDefined();

    // 2. Disable recycle bin usage
    await state.setRecycleBinEnabled(false);
    updatedState = useVaultStore.getState();
    expect(updatedState.meta?.recycleBinEnabled).toBe(false);

    // 3. Delete the recycle bin group (since it's disabled, it should delete permanently)
    const success = await state.deleteGroup(binUuid);
    expect(success).toBe(true);

    updatedState = useVaultStore.getState();
    expect(updatedState.groupIndex.get(binUuid)).toBeUndefined();

    // 4. Enable recycle bin usage again: it should recreate the group
    await state.setRecycleBinEnabled(true);
    updatedState = useVaultStore.getState();
    expect(updatedState.meta?.recycleBinEnabled).toBe(true);

    // Verify a new recycle bin group is created and a new uuid is assigned
    const newBinUuid = updatedState.meta?.recycleBinUuid!;
    expect(newBinUuid).toBeDefined();
    expect(newBinUuid).not.toBe(binUuid);

    const newBinGroup = updatedState.groupIndex.get(newBinUuid);
    expect(newBinGroup).toBeDefined();
    expect(newBinGroup?.name).toBe("Recycle Bin");
  });

  it("should prevent setting recycle bin group to the root group", async () => {
    const db = createNewDatabase("Root Bin Guard Test", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();
    const rootUuid = state.rootGroup!.uuid;

    // Enable recycle bin first
    await state.setRecycleBinEnabled(true);
    const initialBinUuid = useVaultStore.getState().meta?.recycleBinUuid;

    // Attempt to set recycle bin group to root group
    await state.setRecycleBinGroup(rootUuid);

    const updatedState = useVaultStore.getState();
    expect(updatedState.meta?.recycleBinUuid).toBe(initialBinUuid);
    expect(updatedState.meta?.recycleBinUuid).not.toBe(rootUuid);
  });

  it("should self-heal and recreate recycle bin group if it was configured as the root group", async () => {
    const db = createNewDatabase("Root Bin Healing Test", "password123");
    const rootGroup = db.getDefaultGroup();

    // Manually corrupt metadata to point to root group's UUID
    db.meta.recycleBinUuid = rootGroup.uuid;
    db.meta.recycleBinEnabled = true;

    // Open database: this should trigger self-healing
    useVaultStore.getState().openDatabase(db, "corrupt-path.kdbx");

    const state = useVaultStore.getState();
    expect(state.meta?.recycleBinUuid).not.toBe(rootGroup.uuid?.id);
    expect(state.meta?.recycleBinUuid).toBeDefined();

    const binGroup = state.groupIndex.get(state.meta?.recycleBinUuid!);
    expect(binGroup).toBeDefined();
    expect(binGroup?.name).toBe("Recycle Bin");
  });
});
