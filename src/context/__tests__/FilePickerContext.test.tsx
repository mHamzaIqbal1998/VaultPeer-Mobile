import React from "react";
import { act, create } from "react-test-renderer";
import { FilePickerProvider, useFilePicker } from "../FilePickerContext";
import * as SecureStore from "expo-secure-store";
import { disableBiometric } from "@/src/services/biometricService";

// Mock the file system module
jest.mock("vaultpeer-file-system", () => ({
  pickFile: jest.fn(),
  createFile: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  writeTempFile: jest.fn(),
}));

// Mock secure store
jest.mock("expo-secure-store", () => {
  let store: Record<string, string> = {};
  return {
    getItemAsync: jest
      .fn()
      .mockImplementation(async (key) => store[key] || null),
    setItemAsync: jest.fn().mockImplementation(async (key, val) => {
      store[key] = val;
    }),
    deleteItemAsync: jest.fn().mockImplementation(async (key) => {
      delete store[key];
    }),
    __clearStore: () => {
      store = {};
    },
  };
});

// Mock biometric service
jest.mock("@/src/services/biometricService", () => ({
  disableBiometric: jest.fn().mockResolvedValue(true),
  isBiometricEnabled: jest.fn().mockResolvedValue(false),
  getStoredPassword: jest.fn().mockResolvedValue(null),
}));

// Mock crypto helpers
jest.mock("@/src/services/crypto", () => ({
  decryptDatabase: jest.fn(),
  createNewDatabase: jest.fn(),
}));

// Dummy component to consume the hook and expose its state/methods
function TestConsumer({
  onHook,
}: {
  onHook: (hook: ReturnType<typeof useFilePicker>) => void;
}) {
  const hook = useFilePicker();
  onHook(hook);
  return null;
}

describe("FilePickerContext - Recent Vaults & Multi-vault", () => {
  let hookValue: ReturnType<typeof useFilePicker>;
  const captureHook = (hook: ReturnType<typeof useFilePicker>) => {
    hookValue = hook;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (SecureStore as any).__clearStore();
  });

  const renderProvider = () => {
    return create(
      <FilePickerProvider>
        <TestConsumer onHook={captureHook} />
      </FilePickerProvider>
    );
  };

  it("should initialize with empty recent vaults if none saved", async () => {
    await act(async () => {
      renderProvider();
    });

    expect(hookValue.recentVaults).toEqual([]);
    expect(hookValue.fileUri).toBeNull();
  });

  it("should load recent vaults from SecureStore on mount, keeping active selection null", async () => {
    const mockRecent = [
      { uri: "file://1.kdbx", bookmark: "bm1", name: "1", lastOpened: 1000 },
      { uri: "file://2.kdbx", bookmark: "bm2", name: "2", lastOpened: 2000 },
    ];
    await SecureStore.setItemAsync("recent_vaults", JSON.stringify(mockRecent));
    await SecureStore.setItemAsync("vault_file_uri", "file://2.kdbx");
    await SecureStore.setItemAsync("vault_file_bookmark", "bm2");

    await act(async () => {
      renderProvider();
    });

    expect(hookValue.recentVaults).toEqual(mockRecent);
    expect(hookValue.fileUri).toBeNull();
    expect(hookValue.bookmark).toBeNull();
  });

  it("should select a recent vault and update active state and SecureStore", async () => {
    const mockRecent = [
      { uri: "file://1.kdbx", bookmark: "bm1", name: "1", lastOpened: 1000 },
      { uri: "file://2.kdbx", bookmark: "bm2", name: "2", lastOpened: 2000 },
    ];
    await SecureStore.setItemAsync("recent_vaults", JSON.stringify(mockRecent));

    await act(async () => {
      renderProvider();
    });

    await act(async () => {
      await hookValue.selectRecentVault("file://1.kdbx");
    });

    expect(hookValue.fileUri).toBe("file://1.kdbx");
    expect(hookValue.bookmark).toBe("bm1");
    expect(await SecureStore.getItemAsync("vault_file_uri")).toBe(
      "file://1.kdbx"
    );
    expect(await SecureStore.getItemAsync("vault_file_bookmark")).toBe("bm1");

    // The selected vault lastOpened should be updated to now (approximate check)
    expect(hookValue.recentVaults[0].uri).toBe("file://1.kdbx");
    expect(hookValue.recentVaults[0].lastOpened).toBeGreaterThan(2000);
  });

  it("should remove a recent vault, clear active selection if matching, and call disableBiometric", async () => {
    const mockRecent = [
      { uri: "file://1.kdbx", bookmark: "bm1", name: "1", lastOpened: 1000 },
      { uri: "file://2.kdbx", bookmark: "bm2", name: "2", lastOpened: 2000 },
    ];
    await SecureStore.setItemAsync("recent_vaults", JSON.stringify(mockRecent));
    await SecureStore.setItemAsync("vault_file_uri", "file://1.kdbx");
    await SecureStore.setItemAsync("vault_file_bookmark", "bm1");

    await act(async () => {
      renderProvider();
    });

    await act(async () => {
      await hookValue.removeRecentVault("file://1.kdbx");
    });

    // file://1.kdbx is removed, so recentVaults should only contain file://2.kdbx
    expect(hookValue.recentVaults).toHaveLength(1);
    expect(hookValue.recentVaults[0].uri).toBe("file://2.kdbx");

    // active vault was file://1.kdbx, so it should be cleared
    expect(hookValue.fileUri).toBeNull();
    expect(hookValue.bookmark).toBeNull();

    // Verify disableBiometric was called with the removed URI
    expect(disableBiometric).toHaveBeenCalledWith("file://1.kdbx");
  });

  it("should clear active vault without deleting biometric keys on clearVault", async () => {
    await SecureStore.setItemAsync("vault_file_uri", "file://1.kdbx");
    await SecureStore.setItemAsync("vault_file_bookmark", "bm1");

    await act(async () => {
      renderProvider();
    });

    await act(async () => {
      await hookValue.clearVault();
    });

    expect(hookValue.fileUri).toBeNull();
    expect(hookValue.bookmark).toBeNull();
    expect(await SecureStore.getItemAsync("vault_file_uri")).toBeNull();

    // Verify disableBiometric was NOT called
    expect(disableBiometric).not.toHaveBeenCalled();
  });
});
