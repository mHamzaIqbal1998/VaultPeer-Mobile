/**
 * useBackupStore — persisted settings for vault backup retention on pull.
 *
 * Mirrors the server node's backup behavior: whenever a newer file is pulled
 * from a peer and overwrites the local vault, the previous revision is copied
 * into a user-chosen directory as `<filename>.<mtime>.bak`, and old revisions
 * are pruned down to `retention`. The latest file always keeps the original
 * vault filename — only the retained backups are renamed.
 *
 * Settings persist via SecureStore (matching the other app stores). The sync
 * engine reads these synchronously via `useBackupStore.getState()`.
 */

import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

const KEY_ENABLED = "vault_backup_enabled";
const KEY_RETENTION = "vault_backup_retention";
const KEY_DIR_URI = "vault_backup_dir_uri";
const KEY_DIR_NAME = "vault_backup_dir_name";

/** Default number of revisions to keep on mobile (server node default is 5). */
export const DEFAULT_BACKUP_RETENTION = 3;
/** Clamp bounds for the retention count exposed in settings. */
export const MIN_BACKUP_RETENTION = 1;
export const MAX_BACKUP_RETENTION = 50;

interface BackupStoreState {
  /** Whether backups are taken on each newer pull. */
  enabled: boolean;
  /** Number of previous revisions to retain. */
  retention: number;
  /** Destination directory URI (SAF tree URI) for backups, or null if unset. */
  dirUri: string | null;
  /** Human-friendly directory name for display, or null if unset. */
  dirName: string | null;
  /** True once persisted settings have been loaded. */
  isLoaded: boolean;

  loadSettings: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setRetention: (count: number) => Promise<void>;
  setBackupDir: (uri: string, name: string | null) => Promise<void>;
  clearBackupDir: () => Promise<void>;
}

function clampRetention(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_BACKUP_RETENTION;
  return Math.min(
    MAX_BACKUP_RETENTION,
    Math.max(MIN_BACKUP_RETENTION, Math.round(n))
  );
}

export const useBackupStore = create<BackupStoreState>((set, get) => ({
  enabled: false,
  retention: DEFAULT_BACKUP_RETENTION,
  dirUri: null,
  dirName: null,
  isLoaded: false,

  loadSettings: async () => {
    try {
      const [storedEnabled, storedRetention, storedDirUri, storedDirName] =
        await Promise.all([
          SecureStore.getItemAsync(KEY_ENABLED),
          SecureStore.getItemAsync(KEY_RETENTION),
          SecureStore.getItemAsync(KEY_DIR_URI),
          SecureStore.getItemAsync(KEY_DIR_NAME),
        ]);

      const retention = storedRetention
        ? clampRetention(parseInt(storedRetention, 10))
        : DEFAULT_BACKUP_RETENTION;

      set({
        // A folder is required, so never report enabled without one.
        enabled: storedEnabled === "true" && !!storedDirUri,
        retention,
        dirUri: storedDirUri || null,
        dirName: storedDirName || null,
        isLoaded: true,
      });
    } catch (e) {
      console.warn("[BackupStore] Failed to load backup settings:", e);
      set({ isLoaded: true });
    }
  },

  setEnabled: async (enabled) => {
    // Enabling requires a destination directory.
    if (enabled && !get().dirUri) {
      console.warn("[BackupStore] Cannot enable backups without a directory.");
      return;
    }
    try {
      await SecureStore.setItemAsync(KEY_ENABLED, enabled ? "true" : "false");
      set({ enabled });
    } catch (e) {
      console.warn("[BackupStore] Failed to save enabled:", e);
    }
  },

  setRetention: async (count) => {
    const retention = clampRetention(count);
    try {
      await SecureStore.setItemAsync(KEY_RETENTION, String(retention));
      set({ retention });
    } catch (e) {
      console.warn("[BackupStore] Failed to save retention:", e);
    }
  },

  setBackupDir: async (uri, name) => {
    try {
      await SecureStore.setItemAsync(KEY_DIR_URI, uri);
      if (name) {
        await SecureStore.setItemAsync(KEY_DIR_NAME, name);
      } else {
        await SecureStore.deleteItemAsync(KEY_DIR_NAME);
      }
      set({ dirUri: uri, dirName: name || null });
    } catch (e) {
      console.warn("[BackupStore] Failed to save backup directory:", e);
    }
  },

  clearBackupDir: async () => {
    try {
      await SecureStore.deleteItemAsync(KEY_DIR_URI);
      await SecureStore.deleteItemAsync(KEY_DIR_NAME);
      // Disabling too — backups cannot run without a directory.
      await SecureStore.setItemAsync(KEY_ENABLED, "false");
      set({ dirUri: null, dirName: null, enabled: false });
    } catch (e) {
      console.warn("[BackupStore] Failed to clear backup directory:", e);
    }
  },
}));
