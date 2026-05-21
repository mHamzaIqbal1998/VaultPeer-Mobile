import React, { createContext, useContext, useState, useEffect } from "react";
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

// ────────────────────────────────────────────
// Types & Interfaces
// ────────────────────────────────────────────

interface FilePickerContextType {
  fileUri: string | null;
  bookmark: string | null;
  isLoading: boolean;
  error: string | null;
  hasSavedVault: boolean;
  pickAndOpenVault: (
    password: string
  ) => Promise<{ db: kdbxweb.Kdbx; fileUri: string }>;
  createNewVault: (
    name: string,
    password: string
  ) => Promise<{ db: kdbxweb.Kdbx; fileUri: string }>;
  saveVault: (db: kdbxweb.Kdbx) => Promise<boolean>;
  loadVault: (
    password: string
  ) => Promise<{ db: kdbxweb.Kdbx; fileUri: string }>;
  clearVault: () => Promise<void>;
}

// Keys for SecureStore persistence
const KEY_VAULT_URI = "vault_file_uri";
const KEY_VAULT_BOOKMARK = "vault_file_bookmark";

// ────────────────────────────────────────────
// Context Creation
// ────────────────────────────────────────────

const FilePickerContext = createContext<FilePickerContextType | undefined>(
  undefined
);

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

  // Restore saved vault path on app launch
  useEffect(() => {
    async function restoreSavedVault() {
      try {
        const savedUri = await SecureStore.getItemAsync(KEY_VAULT_URI);
        const savedBookmark =
          await SecureStore.getItemAsync(KEY_VAULT_BOOKMARK);

        if (savedUri) {
          setFileUri(savedUri);
          setBookmark(savedBookmark);
          setHasSavedVault(true);
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

      // 4. Decrypt KDBX database
      const db = await decryptDatabase(arrayBuffer, password);

      // Disable previous biometric settings since we changed files
      await disableBiometric();

      // 5. If successful, persist file reference
      await SecureStore.setItemAsync(KEY_VAULT_URI, pickResult.uri);
      await SecureStore.setItemAsync(
        KEY_VAULT_BOOKMARK,
        pickResult.bookmark || ""
      );

      setFileUri(pickResult.uri);
      setBookmark(pickResult.bookmark);
      setHasSavedVault(true);

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
   * Create a new blank vault, prompt user to select a location, and save it.
   */
  async function createNewVault(
    name: string,
    password: string
  ): Promise<{ db: kdbxweb.Kdbx; fileUri: string }> {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Instantiate a new database using crypto engine
      const db = createNewDatabase(name, password);

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

      // Disable previous biometric settings since we changed files
      await disableBiometric();

      // 5. If successful, persist file reference
      await SecureStore.setItemAsync(KEY_VAULT_URI, saveResult.uri);
      await SecureStore.setItemAsync(
        KEY_VAULT_BOOKMARK,
        saveResult.bookmark || ""
      );

      setFileUri(saveResult.uri);
      setBookmark(saveResult.bookmark);
      setHasSavedVault(true);

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
      const db = await decryptDatabase(arrayBuffer, password);
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
      await disableBiometric();
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

  return (
    <FilePickerContext.Provider
      value={{
        fileUri,
        bookmark,
        isLoading,
        error,
        hasSavedVault,
        pickAndOpenVault,
        createNewVault,
        saveVault,
        loadVault,
        clearVault,
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
