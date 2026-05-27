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

jest.mock("../../services/biometricService", () => ({
  isBiometricEnabled: jest.fn(),
  enableBiometric: jest.fn(),
  disableBiometric: jest.fn(),
  isBiometricsSupported: jest.fn(),
}));

describe("Entry History", () => {
  beforeAll(() => {
    initCryptoEngine();
  });

  beforeEach(() => {
    useVaultStore.getState().closeDatabase();
  });

  it("should return empty history for a new entry", async () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test.kdbx");

    const rootUuid = useVaultStore.getState().rootGroup!.uuid;
    const entry = await useVaultStore.getState().createEntry(rootUuid, {
      title: "Fresh Entry",
      username: "user",
      password: "pass",
    });
    expect(entry).not.toBeNull();

    const history = useVaultStore.getState().getEntryHistory(entry!.uuid);
    expect(history).toEqual([]);
  });

  it("should have history after updateEntry", async () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test.kdbx");

    const rootUuid = useVaultStore.getState().rootGroup!.uuid;
    const entry = await useVaultStore.getState().createEntry(rootUuid, {
      title: "Original Title",
      username: "user1",
      password: "pass1",
    });
    expect(entry).not.toBeNull();

    // Update entry — this should push history
    await useVaultStore.getState().updateEntry(entry!.uuid, {
      title: "Updated Title",
      username: "user2",
      password: "pass2",
    });

    const history = useVaultStore.getState().getEntryHistory(entry!.uuid);
    expect(history.length).toBeGreaterThanOrEqual(1);

    // The oldest snapshot should have the original values
    const oldest = history[0];
    expect(oldest.title).toBe("Original Title");
    expect(oldest.username).toBe("user1");
  });

  it("should restore a history snapshot and push current to history", async () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test.kdbx");

    const rootUuid = useVaultStore.getState().rootGroup!.uuid;
    const entry = await useVaultStore.getState().createEntry(rootUuid, {
      title: "V1",
      username: "userV1",
      password: "passV1",
    });
    expect(entry).not.toBeNull();

    // Update to V2
    await useVaultStore.getState().updateEntry(entry!.uuid, {
      title: "V2",
      username: "userV2",
      password: "passV2",
    });

    const historyBefore = useVaultStore.getState().getEntryHistory(entry!.uuid);
    expect(historyBefore.length).toBeGreaterThanOrEqual(1);

    // Restore V1 snapshot (index 0)
    const restored = await useVaultStore
      .getState()
      .restoreHistorySnapshot(entry!.uuid, 0);

    expect(restored).not.toBeNull();
    expect(restored?.title).toBe("V1");
    expect(restored?.username).toBe("userV1");

    // History should now contain the V2 snapshot as well
    const historyAfter = useVaultStore.getState().getEntryHistory(entry!.uuid);
    expect(historyAfter.length).toBeGreaterThan(historyBefore.length);
  });

  it("should delete a history snapshot", async () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test.kdbx");

    const rootUuid = useVaultStore.getState().rootGroup!.uuid;
    const entry = await useVaultStore.getState().createEntry(rootUuid, {
      title: "A",
      username: "user",
      password: "pass",
    });

    // Create some history
    await useVaultStore.getState().updateEntry(entry!.uuid, {
      title: "B",
    });
    await useVaultStore.getState().updateEntry(entry!.uuid, {
      title: "C",
    });

    const historyBefore = useVaultStore.getState().getEntryHistory(entry!.uuid);
    const countBefore = historyBefore.length;
    expect(countBefore).toBeGreaterThanOrEqual(2);

    // Delete first snapshot
    const success = useVaultStore
      .getState()
      .deleteHistorySnapshot(entry!.uuid, 0);
    expect(success).toBe(true);

    const historyAfter = useVaultStore.getState().getEntryHistory(entry!.uuid);
    expect(historyAfter.length).toBe(countBefore - 1);
  });

  it("should return false when deleting out-of-range snapshot", async () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test.kdbx");

    const rootUuid = useVaultStore.getState().rootGroup!.uuid;
    const entry = await useVaultStore.getState().createEntry(rootUuid, {
      title: "Test",
      username: "u",
      password: "p",
    });

    const success = useVaultStore
      .getState()
      .deleteHistorySnapshot(entry!.uuid, 999);
    expect(success).toBe(false);
  });
});

describe("History Settings", () => {
  beforeAll(() => {
    initCryptoEngine();
  });

  beforeEach(() => {
    useVaultStore.getState().closeDatabase();
  });

  it("should read default historyMaxItems and historyMaxSize from meta", () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test.kdbx");

    const meta = useVaultStore.getState().meta;
    expect(meta?.historyMaxItems).toBe(10);
    expect(meta?.historyMaxSize).toBe(6 * 1024 * 1024);
  });

  it("should update historyMaxItems on the database", () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test.kdbx");

    useVaultStore.getState().setHistoryMaxItems(25);

    const state = useVaultStore.getState();
    expect(state.meta?.historyMaxItems).toBe(25);
    expect(state.isDirty).toBe(true);
    expect(state._db?.meta.historyMaxItems).toBe(25);
  });

  it("should update historyMaxSize on the database", () => {
    const db = createNewDatabase("Test Vault", "password123");
    useVaultStore.getState().openDatabase(db, "test.kdbx");

    const tenMB = 10 * 1024 * 1024;
    useVaultStore.getState().setHistoryMaxSize(tenMB);

    const state = useVaultStore.getState();
    expect(state.meta?.historyMaxSize).toBe(tenMB);
    expect(state.isDirty).toBe(true);
    expect(state._db?.meta.historyMaxSize).toBe(tenMB);
  });
});
