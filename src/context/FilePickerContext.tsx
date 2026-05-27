import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import * as SecureStore from "expo-secure-store";
import * as kdbxweb from "kdbxweb";
import {
  pickFile,
  createFile,
  readFile,
  writeFile,
  writeTempFile,
} from "vaultpeer-file-system";
import { decryptDatabase, createNewDatabase } from "@/src/services/crypto";
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "@/src/services/base64";
import { disableBiometric } from "@/src/services/biometricService";

export interface RecentVault {
  uri: string;
  bookmark: string | null;
  name: string;
  lastOpened: number; // timestamp
}

interface FilePickerContextType {
  fileUri: string | null;
  bookmark: string | null;
  isLoading: boolean;
  error: string | null;
  hasSavedVault: boolean;
  recentVaults: RecentVault[];
  pickAndOpenVault: (
    password: string
  ) => Promise<{ db: kdbxweb.Kdbx; fileUri: string }>;
  selectVaultFile: () => Promise<string | null>;
  createNewVault: (
    name: string,
    password: string,
    options?: {
      kdf?: "Argon2id" | "Argon2d" | "AES-KDF";
      cipher?: "AES-256" | "ChaCha20";
    }
  ) => Promise<{ db: kdbxweb.Kdbx; fileUri: string }>;
  saveVault: (db: kdbxweb.Kdbx) => Promise<boolean>;
  loadVault: (
    password: string
  ) => Promise<{ db: kdbxweb.Kdbx; fileUri: string }>;
  clearVault: () => Promise<void>;
  clearError: () => void;
  selectRecentVault: (uri: string) => Promise<void>;
  removeRecentVault: (uri: string) => Promise<void>;
}

// Keys for SecureStore persistence
const KEY_VAULT_URI = "vault_file_uri";
const KEY_VAULT_BOOKMARK = "vault_file_bookmark";
const KEY_RECENT_VAULTS = "recent_vaults";

// ────────────────────────────────────────────
// Context Creation
// ────────────────────────────────────────────

const FilePickerContext = createContext<FilePickerContextType | undefined>(
  undefined
);

function getNameFromUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const parts = decoded.split(/[/\\]/);
    const lastPart = parts[parts.length - 1];
    let filename = lastPart;
    if (lastPart.includes(":")) {
      const subParts = lastPart.split(":");
      filename = subParts[subParts.length - 1];
    }
    filename = filename || "vault.kdbx";
    return filename.endsWith(".kdbx") ? filename.slice(0, -5) : filename;
  } catch (e) {
    console.error("[FilePickerContext] Failed to get name from URI:", e);
  }
  return "Vault";
}

function validateKdbxSignature(arrayBuffer: ArrayBuffer) {
  if (arrayBuffer.byteLength < 8) {
    throw new Error("Invalid vault file: File is too small.");
  }
  const view = new DataView(arrayBuffer);
  const magic = view.getUint32(0, true); // Little endian
  const magic2 = view.getUint32(4, true); // Little endian
  if (
    magic !== 0x9aa2d903 ||
    (magic2 !== 0xb54bfb67 && magic2 !== 0xb54bfb65)
  ) {
    throw new Error("Invalid vault file: Not a KeePass database.");
  }
}

export function FilePickerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [bookmark, setBookmark] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSavedVault, setHasSavedVault] = useState<boolean>(false);
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);
  const saveChain = useRef<Promise<any>>(Promise.resolve());

  // Restore saved vault path on app launch
  useEffect(() => {
    async function restoreSavedVault() {
      try {
        const savedRecents = await SecureStore.getItemAsync(KEY_RECENT_VAULTS);
        if (savedRecents) {
          setRecentVaults(JSON.parse(savedRecents));
        }
      } catch (err) {
        console.warn("[FilePickerContext] Failed to restore saved vault:", err);
      }
    }
    restoreSavedVault();
  }, []);

  /**
   * Let the user pick a file and attempt to open it with the provided password.
   */
  async function pickAndOpenVault(
    password: string
  ): Promise<{ db: kdbxweb.Kdbx; fileUri: string }> {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Pick file using native module
      const pickResult = await pickFile();
      if (!pickResult || !pickResult.uri) {
        throw new Error("No file selected.");
      }

      // 2. Read file base64 content
      const base64Content = await readFile(pickResult.uri, pickResult.bookmark);

      // 3. Convert Base64 to ArrayBuffer
      const arrayBuffer = base64ToArrayBuffer(base64Content);

      // 4. Validate KeePass signature
      validateKdbxSignature(arrayBuffer);

      // 5. Decrypt KDBX database
      const db = await decryptDatabase(arrayBuffer, password);

      // 5. If successful, persist file reference
      await SecureStore.setItemAsync(KEY_VAULT_URI, pickResult.uri);
      await SecureStore.setItemAsync(
        KEY_VAULT_BOOKMARK,
        pickResult.bookmark || ""
      );

      setFileUri(pickResult.uri);
      setBookmark(pickResult.bookmark);
      setHasSavedVault(true);

      // Add to recent vaults
      const name = getNameFromUri(pickResult.uri);
      const newRecent: RecentVault = {
        uri: pickResult.uri,
        bookmark: pickResult.bookmark || null,
        name,
        lastOpened: Date.now(),
      };
      setRecentVaults((prev) => {
        const filtered = prev.filter((v) => v.uri !== pickResult.uri);
        const updated = [newRecent, ...filtered];
        SecureStore.setItemAsync(KEY_RECENT_VAULTS, JSON.stringify(updated));
        return updated;
      });

      return { db, fileUri: pickResult.uri };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to open database file.";
      setError(msg);
      throw new Error(msg);
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Let the user pick a database file and store its path, without unlocking it yet.
   */
  async function selectVaultFile(): Promise<string | null> {
    setIsLoading(true);
    setError(null);
    try {
      const pickResult = await pickFile();
      if (!pickResult || !pickResult.uri) {
        return null;
      }

      // Read file and validate it's a valid KDBX file before storing reference
      const base64Content = await readFile(pickResult.uri, pickResult.bookmark);
      const arrayBuffer = base64ToArrayBuffer(base64Content);
      validateKdbxSignature(arrayBuffer);

      await SecureStore.setItemAsync(KEY_VAULT_URI, pickResult.uri);
      await SecureStore.setItemAsync(
        KEY_VAULT_BOOKMARK,
        pickResult.bookmark || ""
      );

      setFileUri(pickResult.uri);
      setBookmark(pickResult.bookmark);
      setHasSavedVault(true);

      // Add to recent vaults
      const name = getNameFromUri(pickResult.uri);
      const newRecent: RecentVault = {
        uri: pickResult.uri,
        bookmark: pickResult.bookmark || null,
        name,
        lastOpened: Date.now(),
      };
      setRecentVaults((prev) => {
        const filtered = prev.filter((v) => v.uri !== pickResult.uri);
        const updated = [newRecent, ...filtered];
        SecureStore.setItemAsync(KEY_RECENT_VAULTS, JSON.stringify(updated));
        return updated;
      });

      return pickResult.uri;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to select file.";
      setError(msg);
      throw new Error(msg);
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Create a new blank vault, prompt user to select a location, and save it.
   */
  async function createNewVault(
    name: string,
    password: string,
    options?: {
      kdf?: "Argon2id" | "Argon2d" | "AES-KDF";
      cipher?: "AES-256" | "ChaCha20";
    }
  ): Promise<{ db: kdbxweb.Kdbx; fileUri: string }> {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Instantiate a new database using crypto engine
      const db = createNewDatabase(name, password, undefined, options);

      // 2. Serialize database
      const arrayBuffer = await db.save();
      const base64Content = arrayBufferToBase64(arrayBuffer);

      // 3. Write base64 to a temporary native file
      const tempFileUri = await writeTempFile(base64Content);

      // 4. Prompt user to choose destination and save it permanently
      const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "") || "vault";
      const filename = `${sanitizedName}.kdbx`;

      const saveResult = await createFile(filename, tempFileUri);
      if (!saveResult || !saveResult.uri) {
        throw new Error("Failed to save new file.");
      }

      // 5. If successful, persist file reference
      await SecureStore.setItemAsync(KEY_VAULT_URI, saveResult.uri);
      await SecureStore.setItemAsync(
        KEY_VAULT_BOOKMARK,
        saveResult.bookmark || ""
      );

      setFileUri(saveResult.uri);
      setBookmark(saveResult.bookmark);
      setHasSavedVault(true);

      // Add to recent vaults
      const newRecent: RecentVault = {
        uri: saveResult.uri,
        bookmark: saveResult.bookmark || null,
        name: name,
        lastOpened: Date.now(),
      };
      setRecentVaults((prev) => {
        const filtered = prev.filter((v) => v.uri !== saveResult.uri);
        const updated = [newRecent, ...filtered];
        SecureStore.setItemAsync(KEY_RECENT_VAULTS, JSON.stringify(updated));
        return updated;
      });

      return { db, fileUri: saveResult.uri };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to create database file.";
      setError(msg);
      throw new Error(msg);
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Save an in-memory KDBX database back to the active file.
   */
  async function saveVault(db: kdbxweb.Kdbx): Promise<boolean> {
    if (!fileUri) {
      const msg = "No active file opened to save to.";
      setError(msg);
      throw new Error(msg);
    }

    setIsLoading(true);
    setError(null);

    // Append this save operation to the sequential queue
    const resultPromise = saveChain.current.then(async () => {
      try {
        // 1. Serialize in-memory database to binary ArrayBuffer
        const arrayBuffer = await db.save();
        const base64Content = arrayBufferToBase64(arrayBuffer);

        // 2. Call native write file (handles atomic write: temp file -> replace)
        const success = await writeFile(fileUri, base64Content, bookmark || "");
        return success;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to save changes to the database.";
        setError(msg);
        throw new Error(msg);
      }
    });

    // Update the queue pointer, catching errors so subsequent saves can still run
    saveChain.current = resultPromise.catch(() => {});

    try {
      return await resultPromise;
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Load the active vault file using a password (e.g. for unlocking after background/restart).
   */
  async function loadVault(
    password: string
  ): Promise<{ db: kdbxweb.Kdbx; fileUri: string }> {
    if (!fileUri) {
      const msg = "No vault file reference stored.";
      setError(msg);
      throw new Error(msg);
    }

    setIsLoading(true);
    setError(null);
    try {
      const base64Content = await readFile(fileUri, bookmark || "");
      const arrayBuffer = base64ToArrayBuffer(base64Content);

      // Validate KeePass signature
      validateKdbxSignature(arrayBuffer);

      const db = await decryptDatabase(arrayBuffer, password);

      // Add/update in recent vaults
      const name = getNameFromUri(fileUri);
      const newRecent: RecentVault = {
        uri: fileUri,
        bookmark: bookmark || null,
        name,
        lastOpened: Date.now(),
      };
      setRecentVaults((prev) => {
        const filtered = prev.filter((v) => v.uri !== fileUri);
        const updated = [newRecent, ...filtered];
        SecureStore.setItemAsync(KEY_RECENT_VAULTS, JSON.stringify(updated));
        return updated;
      });

      return { db, fileUri };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to load/unlock the database.";
      setError(msg);
      throw new Error(msg);
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Remove references to the active vault file and clear state.
   */
  async function clearVault(): Promise<void> {
    setIsLoading(true);
    setError(null);
    try {
      await SecureStore.deleteItemAsync(KEY_VAULT_URI);
      await SecureStore.deleteItemAsync(KEY_VAULT_BOOKMARK);
      setFileUri(null);
      setBookmark(null);
      setHasSavedVault(false);
    } catch (err) {
      console.warn("[FilePickerContext] Failed to clear vault reference:", err);
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Select a recent vault to make it the active one.
   */
  async function selectRecentVault(uri: string): Promise<void> {
    const vault = recentVaults.find((v) => v.uri === uri);
    if (!vault) {
      throw new Error("Vault not found in recent vaults.");
    }
    await SecureStore.setItemAsync(KEY_VAULT_URI, vault.uri);
    await SecureStore.setItemAsync(KEY_VAULT_BOOKMARK, vault.bookmark || "");

    setFileUri(vault.uri);
    setBookmark(vault.bookmark);
    setHasSavedVault(true);

    const updated = recentVaults.map((v) =>
      v.uri === uri ? { ...v, lastOpened: Date.now() } : v
    );
    updated.sort((a, b) => b.lastOpened - a.lastOpened);
    setRecentVaults(updated);
    await SecureStore.setItemAsync(KEY_RECENT_VAULTS, JSON.stringify(updated));
  }

  /**
   * Remove a vault from recent list and clear active vault reference if it matches.
   */
  async function removeRecentVault(uri: string): Promise<void> {
    // Purge biometric data for this URI
    await disableBiometric(uri);

    const updated = recentVaults.filter((v) => v.uri !== uri);
    setRecentVaults(updated);
    await SecureStore.setItemAsync(KEY_RECENT_VAULTS, JSON.stringify(updated));

    if (fileUri === uri) {
      await SecureStore.deleteItemAsync(KEY_VAULT_URI);
      await SecureStore.deleteItemAsync(KEY_VAULT_BOOKMARK);
      setFileUri(null);
      setBookmark(null);
      setHasSavedVault(false);
    }
  }

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <FilePickerContext.Provider
      value={{
        fileUri,
        bookmark,
        isLoading,
        error,
        hasSavedVault,
        recentVaults,
        pickAndOpenVault,
        selectVaultFile,
        createNewVault,
        saveVault,
        loadVault,
        clearVault,
        clearError,
        selectRecentVault,
        removeRecentVault,
      }}
    >
      {children}
    </FilePickerContext.Provider>
  );
}

export function useFilePicker() {
  const context = useContext(FilePickerContext);
  if (!context) {
    throw new Error("useFilePicker must be used within a FilePickerProvider");
  }
  return context;
}
