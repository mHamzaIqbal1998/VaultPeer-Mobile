/**
 * VaultStore — Zustand Global State
 *
 * Manages the in-memory KeePass database state:
 * - Active kdbxweb.Kdbx instance (never exposed to UI directly)
 * - Parsed VaultGroup tree and flat entry index
 * - Navigation breadcrumb stack for group drilling
 * - History log for recent entry accesses
 * - Dirty flag for unsaved mutations
 *
 * All CRUD operations mutate the underlying kdbxweb database
 * AND update the parsed React-readable state in one atomic action.
 */

import { create } from "zustand";
import * as kdbxweb from "kdbxweb";
import { parseDatabase } from "../services/crypto/databaseParser";
import type {
  VaultEntry,
  VaultGroup,
  VaultMeta,
  VaultHistorySnapshot,
} from "../types/kdbx";
import { base64ToArrayBuffer, arrayBufferToBase64 } from "../services/base64";
import { createCredentials } from "../services/crypto";
import {
  isBiometricEnabled,
  enableBiometric,
} from "../services/biometricService";
import * as SecureStore from "expo-secure-store";

// ────────────────────────────────────────────
// History Entry
// ────────────────────────────────────────────

export interface HistoryLogEntry {
  entryUuid: string;
  entryTitle: string;
  action: "viewed" | "copied" | "created" | "updated" | "deleted";
  timestamp: string; // ISO-8601
}

// ────────────────────────────────────────────
// Store State
// ────────────────────────────────────────────

interface VaultStoreState {
  // ── Core Database ──
  /** Raw kdbxweb instance — NEVER read from UI. Only used by store internals. */
  _db: kdbxweb.Kdbx | null;
  /** Parsed metadata */
  meta: VaultMeta | null;
  /** Parsed root group tree */
  rootGroup: VaultGroup | null;
  /** Flat map of all entries by UUID for O(1) lookups */
  entryIndex: Map<string, VaultEntry>;
  /** Flat map of all groups by UUID for O(1) lookups */
  groupIndex: Map<string, VaultGroup>;

  // ── Navigation ──
  /** Stack of group UUIDs for breadcrumb navigation */
  breadcrumbs: string[];
  /** UUID of the currently viewed group */
  activeGroupUuid: string | null;

  // ── History ──
  historyLog: HistoryLogEntry[];

  // ── File metadata ──
  filePath: string | null;
  isDirty: boolean;
  vaultRevision: number;

  // ── Actions ──
  /** Open a decrypted database and parse its tree */
  openDatabase: (db: kdbxweb.Kdbx, filePath?: string) => void;
  /** Close / purge the database from memory */
  closeDatabase: () => void;
  /** Re-parse the current database (after external save/sync) */
  refreshParsedState: () => void;

  // Navigation
  navigateToGroup: (groupUuid: string) => void;
  navigateBack: () => void;
  navigateToRoot: () => void;
  /** Get the currently active group (derived from activeGroupUuid) */
  getActiveGroup: () => VaultGroup | null;

  // Entry CRUD
  getEntry: (uuid: string) => VaultEntry | null;
  createEntry: (
    parentGroupUuid: string,
    data: Partial<VaultEntry>
  ) => Promise<VaultEntry | null>;
  updateEntry: (
    uuid: string,
    data: Partial<VaultEntry>
  ) => Promise<VaultEntry | null>;
  deleteEntry: (uuid: string) => boolean;
  restoreEntry: (uuid: string) => boolean;
  getAttachmentData: (
    entryUuid: string,
    attachmentName: string
  ) => Promise<string>;

  // Group CRUD
  createGroup: (parentGroupUuid: string, name: string) => VaultGroup | null;
  renameGroup: (uuid: string, name: string) => boolean;
  deleteGroup: (uuid: string) => boolean;
  isGroupInRecycleBin: (groupUuid: string) => boolean;

  // History
  logAccess: (
    entryUuid: string,
    entryTitle: string,
    action: HistoryLogEntry["action"]
  ) => void;

  // Maintenance
  cleanupDatabase: (options: { binaries?: boolean; history?: boolean }) => {
    totalHistory: number;
    historyToRemove: number;
    totalBinaries: number;
    binariesToRemove: number;
  } | null;
  runCleanupDatabase: (options: {
    binaries?: boolean;
    history?: boolean;
  }) => boolean;

  // Templates Support
  setTemplatesEnabled: (enabled: boolean) => Promise<void>;
  setTemplatesGroup: (groupUuid: string) => Promise<void>;

  // Recycle Bin Support
  setRecycleBinEnabled: (enabled: boolean) => Promise<void>;
  setRecycleBinGroup: (groupUuid: string) => Promise<void>;
  emptyRecycleBin: () => Promise<boolean>;

  // Credentials / Master Password
  changeMasterPassword: (newPassword: string) => Promise<boolean>;

  // Entry History
  getEntryHistory: (entryUuid: string) => VaultHistorySnapshot[];
  restoreHistorySnapshot: (
    entryUuid: string,
    snapshotIndex: number
  ) => Promise<VaultEntry | null>;
  deleteHistorySnapshot: (entryUuid: string, snapshotIndex: number) => boolean;

  // History Settings
  setHistoryMaxItems: (value: number) => void;
  setHistoryMaxSize: (value: number) => void;

  // App Settings
  theme: "dark" | "light";
  autoLockTimeout: number; // in milliseconds
  clipboardClearTime: number; // in milliseconds
  autoSave: boolean;

  setTheme: (theme: "dark" | "light") => Promise<void>;
  setAutoLockTimeout: (timeout: number) => Promise<void>;
  setClipboardClearTime: (timeout: number) => Promise<void>;
  setAutoSave: (enabled: boolean) => Promise<void>;
  loadAppSettings: () => Promise<void>;

  // Dirty state
  markDirty: () => void;
  markClean: () => void;

  // Saving state
  isSaving: boolean;
  setIsSaving: (isSaving: boolean) => void;

  // ── Autofill Save ──
  pendingAutofillSave: {
    username?: string;
    password?: string;
    packageName?: string;
    domain?: string;
  } | null;
  setPendingAutofillSave: (
    payload: {
      username?: string;
      password?: string;
      packageName?: string;
      domain?: string;
    } | null
  ) => void;
}

// ────────────────────────────────────────────
// Index Builders
// ────────────────────────────────────────────

function buildEntryIndex(group: VaultGroup): Map<string, VaultEntry> {
  const map = new Map<string, VaultEntry>();

  function walk(g: VaultGroup) {
    for (const entry of g.entries) {
      map.set(entry.uuid, entry);
    }
    for (const sub of g.groups) {
      walk(sub);
    }
  }

  walk(group);
  return map;
}

function buildGroupIndex(group: VaultGroup): Map<string, VaultGroup> {
  const map = new Map<string, VaultGroup>();

  function walk(g: VaultGroup) {
    map.set(g.uuid, g);
    for (const sub of g.groups) {
      walk(sub);
    }
  }

  walk(group);
  return map;
}

// ────────────────────────────────────────────
// kdbxweb Mutation Helpers
// ────────────────────────────────────────────

function findKdbxGroup(
  root: kdbxweb.KdbxGroup,
  uuid: string
): kdbxweb.KdbxGroup | null {
  if (root.uuid?.id === uuid) return root;
  for (const sub of root.groups ?? []) {
    const found = findKdbxGroup(sub, uuid);
    if (found) return found;
  }
  return null;
}

function ensureRecycleBinGroup(db: kdbxweb.Kdbx) {
  if (!db.meta.recycleBinEnabled) return;

  const root = db.getDefaultGroup();
  let binGroup: kdbxweb.KdbxGroup | null = null;

  if (
    db.meta.recycleBinUuid &&
    db.meta.recycleBinUuid.id &&
    db.meta.recycleBinUuid.id !== root.uuid?.id
  ) {
    binGroup = findKdbxGroup(root, db.meta.recycleBinUuid.id);
  }

  if (!binGroup) {
    const existing = root.groups.find(
      (g) => g.name?.toLowerCase() === "recycle bin"
    );
    if (existing) {
      binGroup = existing;
      db.meta.recycleBinUuid = existing.uuid;
    } else {
      const newGroup = db.createGroup(root, "Recycle Bin");
      newGroup.icon = 27;
      binGroup = newGroup;
      db.meta.recycleBinUuid = newGroup.uuid;
    }
  }
}

function ensureTemplatesGroup(db: kdbxweb.Kdbx): kdbxweb.KdbxGroup | null {
  const customData = db.meta.customData;
  const enabled = customData?.get("templatesEnabled")?.value === "true";
  if (!enabled) return null;

  const root = db.getDefaultGroup();
  let templatesGroup: kdbxweb.KdbxGroup | null = null;

  if (
    db.meta.entryTemplatesGroup &&
    db.meta.entryTemplatesGroup.id &&
    db.meta.entryTemplatesGroup.id !== root.uuid?.id
  ) {
    templatesGroup = findKdbxGroup(root, db.meta.entryTemplatesGroup.id);
  }

  if (!templatesGroup) {
    const existing = root.groups.find(
      (g) => g.name?.toLowerCase() === "templates"
    );
    if (existing) {
      templatesGroup = existing;
      db.meta.entryTemplatesGroup = existing.uuid;
    } else {
      const newGroup = db.createGroup(root, "Templates");
      newGroup.icon = 20;
      templatesGroup = newGroup;
      db.meta.entryTemplatesGroup = newGroup.uuid;
    }
  }

  return templatesGroup;
}

function findKdbxEntry(
  root: kdbxweb.KdbxGroup,
  uuid: string
): { entry: kdbxweb.KdbxEntry; parent: kdbxweb.KdbxGroup } | null {
  for (const entry of root.entries ?? []) {
    if (entry.uuid?.id === uuid) return { entry, parent: root };
  }
  for (const sub of root.groups ?? []) {
    const found = findKdbxEntry(sub, uuid);
    if (found) return found;
  }
  return null;
}

function isInRecycleBin(
  group: kdbxweb.KdbxGroup | undefined,
  recycleBinUuid: kdbxweb.KdbxUuid | undefined
): boolean {
  if (!group || !recycleBinUuid) return false;
  let current: kdbxweb.KdbxGroup | undefined = group;
  while (current) {
    if (current.uuid?.id === recycleBinUuid.id) {
      return true;
    }
    current = current.parentGroup;
  }
  return false;
}

function seedDefaultTemplates(db: kdbxweb.Kdbx, group: kdbxweb.KdbxGroup) {
  const hasCard = group.entries.some(
    (e) => e.fields.get("Title")?.toString() === "Credit Card"
  );
  if (!hasCard) {
    const entry = db.createEntry(group);
    entry.fields.set("Title", "Credit Card");
    entry.fields.set("UserName", "");
    entry.fields.set("Password", kdbxweb.ProtectedValue.fromString(""));
    entry.fields.set("Cardholder Name", "");
    entry.fields.set("Card Number", "");
    entry.fields.set("Expiry Date", "");
    entry.fields.set("CVV", kdbxweb.ProtectedValue.fromString(""));
    entry.fields.set("PIN", kdbxweb.ProtectedValue.fromString(""));
    entry.icon = 62;
  }

  const hasEmail = group.entries.some(
    (e) => e.fields.get("Title")?.toString() === "Email Account"
  );
  if (!hasEmail) {
    const entry = db.createEntry(group);
    entry.fields.set("Title", "Email Account");
    entry.fields.set("UserName", "");
    entry.fields.set("Password", kdbxweb.ProtectedValue.fromString(""));
    entry.fields.set("Email Address", "");
    entry.fields.set("Provider", "");
    entry.icon = 19;
  }

  const hasNote = group.entries.some(
    (e) => e.fields.get("Title")?.toString() === "Secure Note"
  );
  if (!hasNote) {
    const entry = db.createEntry(group);
    entry.fields.set("Title", "Secure Note");
    entry.fields.set("Notes", "Write your secure note here.");
    entry.icon = 0;
  }

  const hasSsh = group.entries.some(
    (e) => e.fields.get("Title")?.toString() === "SSH Server"
  );
  if (!hasSsh) {
    const entry = db.createEntry(group);
    entry.fields.set("Title", "SSH Server");
    entry.fields.set("UserName", "root");
    entry.fields.set("Password", kdbxweb.ProtectedValue.fromString(""));
    entry.fields.set("URL", "192.168.1.1");
    entry.fields.set("Port", "22");
    entry.fields.set("Private Key", kdbxweb.ProtectedValue.fromString(""));
    entry.fields.set("Passphrase", kdbxweb.ProtectedValue.fromString(""));
    entry.icon = 12;
  }

  const hasWifi = group.entries.some(
    (e) => e.fields.get("Title")?.toString() === "Wi-Fi Router"
  );
  if (!hasWifi) {
    const entry = db.createEntry(group);
    entry.fields.set("Title", "Wi-Fi Router");
    entry.fields.set("UserName", "admin");
    entry.fields.set("Password", kdbxweb.ProtectedValue.fromString(""));
    entry.fields.set("SSID", "MyHomeWiFi");
    entry.fields.set("WPA Key", kdbxweb.ProtectedValue.fromString(""));
    entry.fields.set("Router IP", "192.168.1.1");
    entry.icon = 3;
  }

  const hasIdentity = group.entries.some(
    (e) => e.fields.get("Title")?.toString() === "Membership / ID"
  );
  if (!hasIdentity) {
    const entry = db.createEntry(group);
    entry.fields.set("Title", "Membership / ID");
    entry.fields.set("Full Name", "");
    entry.fields.set("Document Number", "");
    entry.fields.set("Expiry Date", "");
    entry.fields.set("Issuing Authority", "");
    entry.icon = 40;
  }

  const hasLicense = group.entries.some(
    (e) => e.fields.get("Title")?.toString() === "Software License"
  );
  if (!hasLicense) {
    const entry = db.createEntry(group);
    entry.fields.set("Title", "Software License");
    entry.fields.set("UserName", "");
    entry.fields.set("License Key", kdbxweb.ProtectedValue.fromString(""));
    entry.fields.set("Publisher", "");
    entry.fields.set("Version", "");
    entry.icon = 11;
  }
}

// ────────────────────────────────────────────
// Store Creation
// ────────────────────────────────────────────

const MAX_HISTORY = 50;

export const useVaultStore = create<VaultStoreState>((rawSet, get) => {
  const set = (partial: any, replace?: boolean) => {
    if (typeof partial === "function") {
      (rawSet as any)((state: any) => {
        const nextState = partial(state);
        if (nextState && nextState.isDirty === true) {
          return {
            ...nextState,
            vaultRevision: (state.vaultRevision || 0) + 1,
          };
        }
        return nextState;
      }, replace);
    } else {
      if (partial && partial.isDirty === true) {
        (rawSet as any)(
          (state: any) => ({
            ...partial,
            vaultRevision: (state.vaultRevision || 0) + 1,
          }),
          replace
        );
      } else {
        (rawSet as any)(partial, replace);
      }
    }
  };

  return {
    // Initial state
    _db: null,
    meta: null,
    rootGroup: null,
    entryIndex: new Map(),
    groupIndex: new Map(),
    breadcrumbs: [],
    activeGroupUuid: null,
    historyLog: [],
    filePath: null,
    isDirty: false,
    isSaving: false,
    vaultRevision: 0,

    pendingAutofillSave: null,
    setPendingAutofillSave: (payload) => {
      set({ pendingAutofillSave: payload });
    },

    // App Settings default values
    theme: "dark",
    autoLockTimeout: 60000, // 60 seconds
    clipboardClearTime: 30000, // 30 seconds
    autoSave: false,

    // ────── Core Actions ──────

    openDatabase: (db, filePath) => {
      ensureRecycleBinGroup(db);
      const templatesGroup = ensureTemplatesGroup(db);
      if (templatesGroup) {
        seedDefaultTemplates(db, templatesGroup);
      }
      const { meta, rootGroup } = parseDatabase(db);
      set({
        _db: db,
        meta,
        rootGroup,
        entryIndex: buildEntryIndex(rootGroup),
        groupIndex: buildGroupIndex(rootGroup),
        breadcrumbs: [],
        activeGroupUuid: rootGroup.uuid,
        filePath: filePath ?? null,
        isDirty: false,
        historyLog: [],
        vaultRevision: 0,
      });
    },

    getAttachmentData: async (entryUuid, attachmentName) => {
      const state = get();
      const db = state._db;
      if (!db) throw new Error("Database not loaded");

      const root = db.getDefaultGroup();
      const found = findKdbxEntry(root, entryUuid);
      if (!found) throw new Error("Entry not found");

      const binVal = found.entry.binaries.get(attachmentName);
      if (!binVal) throw new Error("Attachment not found");

      let rawBin: kdbxweb.KdbxBinary;
      if (binVal && typeof binVal === "object" && "value" in binVal) {
        rawBin = (binVal as any).value;
      } else {
        rawBin = binVal as kdbxweb.KdbxBinary;
      }

      if (!rawBin) throw new Error("Attachment is empty");

      let base64Data = "";
      const anyBin = rawBin as any;
      if (
        anyBin instanceof kdbxweb.ProtectedValue ||
        (typeof anyBin === "object" && "toBase64" in anyBin)
      ) {
        base64Data = anyBin.toBase64();
      } else if (anyBin instanceof ArrayBuffer) {
        base64Data = arrayBufferToBase64(anyBin);
      } else if (anyBin instanceof Uint8Array) {
        base64Data = arrayBufferToBase64(anyBin.buffer as ArrayBuffer);
      }

      return base64Data;
    },

    closeDatabase: () => {
      const db = get()._db;
      const isSaving = get().isSaving;
      // Clear protected values from memory
      if (db) {
        if (isSaving) {
          // Defer cleanup until saving is done to avoid concurrent modification/corruption
          const checkAndCleanup = () => {
            if (get().isSaving) {
              setTimeout(checkAndCleanup, 50);
            } else {
              try {
                db.cleanup({
                  historyRules: true,
                  customIcons: false,
                  binaries: true,
                });
              } catch {}
            }
          };
          setTimeout(checkAndCleanup, 50);
        } else {
          try {
            db.cleanup({
              historyRules: true,
              customIcons: false,
              binaries: true,
            });
          } catch {
            // cleanup is best-effort
          }
        }
      }
      set({
        _db: null,
        meta: null,
        rootGroup: null,
        entryIndex: new Map(),
        groupIndex: new Map(),
        breadcrumbs: [],
        activeGroupUuid: null,
        filePath: null,
        isDirty: false,
      });
    },

    refreshParsedState: () => {
      const db = get()._db;
      if (!db) return;
      const { meta, rootGroup } = parseDatabase(db);
      set({
        meta,
        rootGroup,
        entryIndex: buildEntryIndex(rootGroup),
        groupIndex: buildGroupIndex(rootGroup),
      });
    },

    // ────── Navigation ──────

    navigateToGroup: (groupUuid) => {
      const state = get();
      const group = state.groupIndex.get(groupUuid);
      if (!group) return;

      const currentUuid = state.activeGroupUuid;
      set({
        activeGroupUuid: groupUuid,
        breadcrumbs: currentUuid
          ? [...state.breadcrumbs, currentUuid]
          : state.breadcrumbs,
      });
    },

    navigateBack: () => {
      const state = get();
      if (state.breadcrumbs.length === 0) return;

      const newBreadcrumbs = [...state.breadcrumbs];
      const parentUuid = newBreadcrumbs.pop()!;
      set({
        activeGroupUuid: parentUuid,
        breadcrumbs: newBreadcrumbs,
      });
    },

    navigateToRoot: () => {
      const state = get();
      if (!state.rootGroup) return;
      set({
        activeGroupUuid: state.rootGroup.uuid,
        breadcrumbs: [],
      });
    },

    getActiveGroup: () => {
      const state = get();
      if (!state.activeGroupUuid || !state.groupIndex) return null;
      return state.groupIndex.get(state.activeGroupUuid) ?? null;
    },

    // ────── Entry CRUD ──────

    getEntry: (uuid) => {
      return get().entryIndex.get(uuid) ?? null;
    },

    createEntry: async (parentGroupUuid, data) => {
      const state = get();
      const db = state._db;
      if (!db) return null;

      const root = db.getDefaultGroup();
      const parentKdbx = findKdbxGroup(root, parentGroupUuid);
      if (!parentKdbx) return null;

      // Create new kdbxweb entry
      const newKdbxEntry = db.createEntry(parentKdbx);

      // Set fields
      newKdbxEntry.fields.set("Title", data.title || "Untitled");
      newKdbxEntry.fields.set("UserName", data.username || "");
      newKdbxEntry.fields.set(
        "Password",
        kdbxweb.ProtectedValue.fromString(data.password || "")
      );
      newKdbxEntry.fields.set("URL", data.url || "");
      newKdbxEntry.fields.set("Notes", data.notes || "");
      if (data.otp !== undefined) {
        if (data.otp) {
          newKdbxEntry.fields.set("otp", data.otp);
        } else {
          newKdbxEntry.fields.delete("otp");
        }
      }

      if (data.iconId !== undefined) {
        newKdbxEntry.icon = data.iconId;
      }

      // Set custom fields
      if (data.fields) {
        const secureFields = data.secureFields || [];
        for (const [key, value] of Object.entries(data.fields)) {
          if (secureFields.includes(key)) {
            newKdbxEntry.fields.set(
              key,
              kdbxweb.ProtectedValue.fromString(value)
            );
          } else {
            newKdbxEntry.fields.set(key, value);
          }
        }
      }

      if (data.tags) {
        newKdbxEntry.tags = [...data.tags];
      }

      // Expiration
      if (data.expires !== undefined) {
        newKdbxEntry.times.expires = data.expires;
      }
      if (data.expiryTime !== undefined) {
        newKdbxEntry.times.expiryTime = data.expiryTime
          ? new Date(data.expiryTime)
          : undefined;
      }

      // Attachments
      if (data.attachments !== undefined) {
        for (const attachment of data.attachments) {
          const buffer = base64ToArrayBuffer(attachment.data || "");
          const binaryWithHash = await db.binaries.add(buffer);
          newKdbxEntry.binaries.set(attachment.name, binaryWithHash);
        }
        try {
          db.cleanup({ binaries: true });
        } catch {
          // best-effort
        }
      }

      // Re-parse to update React state
      const { meta, rootGroup } = parseDatabase(db);
      const entryIndex = buildEntryIndex(rootGroup);
      const groupIndex = buildGroupIndex(rootGroup);

      const newEntry = entryIndex.get(newKdbxEntry.uuid.id) ?? null;

      set({
        meta,
        rootGroup,
        entryIndex,
        groupIndex,
        isDirty: true,
      });

      return newEntry;
    },

    updateEntry: async (uuid, data) => {
      const state = get();
      const db = state._db;
      if (!db) return null;

      const root = db.getDefaultGroup();
      const found = findKdbxEntry(root, uuid);
      if (!found) return null;

      const { entry } = found;

      // Push current state to history before modification
      entry.pushHistory();
      pruneEntryHistory(entry, db);

      // Update fields
      if (data.title !== undefined) entry.fields.set("Title", data.title);
      if (data.username !== undefined)
        entry.fields.set("UserName", data.username);
      if (data.password !== undefined) {
        entry.fields.set(
          "Password",
          kdbxweb.ProtectedValue.fromString(data.password)
        );
      }
      if (data.url !== undefined) entry.fields.set("URL", data.url);
      if (data.notes !== undefined) entry.fields.set("Notes", data.notes);
      if (data.iconId !== undefined) entry.icon = data.iconId;
      if (data.otp !== undefined) {
        if (data.otp) {
          entry.fields.set("otp", data.otp);
        } else {
          entry.fields.delete("otp");
        }
      }

      if (data.fields) {
        // Remove old custom fields not in the new set
        const standardFields = new Set([
          "Title",
          "UserName",
          "Password",
          "URL",
          "Notes",
          "otp",
          "TimeOtp",
          "totp",
        ]);
        const newKeys = new Set(Object.keys(data.fields));

        entry.fields.forEach((_value, key) => {
          if (!standardFields.has(key) && !newKeys.has(key)) {
            entry.fields.delete(key);
          }
        });

        const secureFields = data.secureFields || [];
        for (const [key, value] of Object.entries(data.fields)) {
          if (secureFields.includes(key)) {
            entry.fields.set(key, kdbxweb.ProtectedValue.fromString(value));
          } else {
            entry.fields.set(key, value);
          }
        }
      }

      if (data.tags) {
        entry.tags = [...data.tags];
      }

      // Expiration
      if (data.expires !== undefined) {
        entry.times.expires = data.expires;
      }
      if (data.expiryTime !== undefined) {
        entry.times.expiryTime = data.expiryTime
          ? new Date(data.expiryTime)
          : undefined;
      }

      // Attachments
      if (data.attachments !== undefined) {
        // 1. Remove attachments that are no longer present
        const newNames = new Set(data.attachments.map((a) => a.name));
        entry.binaries.forEach((_val, key) => {
          if (!newNames.has(key)) {
            entry.binaries.delete(key);
          }
        });

        // 2. Add or update attachments
        for (const attachment of data.attachments) {
          // If data is not provided, this is an existing unchanged attachment (which wasn't loaded)
          if (!attachment.data) {
            continue;
          }

          const buffer = base64ToArrayBuffer(attachment.data);
          const binaryWithHash = await db.binaries.add(buffer);
          entry.binaries.set(attachment.name, binaryWithHash);
        }

        try {
          db.cleanup({ binaries: true });
        } catch {
          // best-effort
        }
      }

      // Update modification time
      entry.times.lastModTime = new Date();

      // Re-parse state
      const { meta, rootGroup } = parseDatabase(db);
      const entryIndex = buildEntryIndex(rootGroup);
      const groupIndex = buildGroupIndex(rootGroup);

      const updatedEntry = entryIndex.get(uuid) ?? null;

      set({
        meta,
        rootGroup,
        entryIndex,
        groupIndex,
        isDirty: true,
      });

      return updatedEntry;
    },

    deleteEntry: (uuid) => {
      const state = get();
      const db = state._db;
      if (!db) return false;

      const root = db.getDefaultGroup();
      const found = findKdbxEntry(root, uuid);
      if (!found) return false;

      const recycleBinEnabled = db.meta.recycleBinEnabled;
      const recycleBinUuid = db.meta.recycleBinUuid;
      const isAlreadyInBin = isInRecycleBin(found.parent, recycleBinUuid);

      if (recycleBinEnabled && recycleBinUuid && !isAlreadyInBin) {
        const recycleBinGroup = findKdbxGroup(root, recycleBinUuid.id);
        if (recycleBinGroup) {
          // Store the original parent group UUID in a custom field before moving
          found.entry.fields.set(
            "PreviousParentGroupUuid",
            found.parent.uuid.id
          );
          db.move(found.entry, recycleBinGroup);
        } else {
          db.move(found.entry, null);
        }
      } else {
        db.move(found.entry, null);
      }

      // Re-parse
      const { meta, rootGroup } = parseDatabase(db);
      set({
        meta,
        rootGroup,
        entryIndex: buildEntryIndex(rootGroup),
        groupIndex: buildGroupIndex(rootGroup),
        isDirty: true,
      });

      return true;
    },

    restoreEntry: (uuid) => {
      const state = get();
      const db = state._db;
      if (!db) return false;

      const root = db.getDefaultGroup();
      const found = findKdbxEntry(root, uuid);
      if (!found) return false;

      const recycleBinUuid = db.meta.recycleBinUuid;

      // Find the previous parent group UUID from the entry's custom fields
      const rawVal = found.entry.fields.get("PreviousParentGroupUuid");
      let prevParentUuid: string | undefined;
      if (rawVal) {
        if (typeof rawVal === "string") {
          prevParentUuid = rawVal;
        } else if (typeof rawVal === "object" && "getText" in rawVal) {
          prevParentUuid = (rawVal as { getText(): string }).getText();
        } else {
          prevParentUuid = String(rawVal);
        }
      }

      let targetGroup: kdbxweb.KdbxGroup | null = null;
      if (prevParentUuid) {
        const g = findKdbxGroup(root, prevParentUuid);
        // Ensure the group exists and is NOT currently in the recycle bin
        if (g && !isInRecycleBin(g, recycleBinUuid)) {
          targetGroup = g;
        }
      }

      // If no safe target group was resolved, restore to the root group
      if (!targetGroup) {
        targetGroup = root;
      }

      // Move the entry back
      db.move(found.entry, targetGroup);

      // Remove the custom field helper
      found.entry.fields.delete("PreviousParentGroupUuid");

      // Re-parse
      const { meta, rootGroup } = parseDatabase(db);
      set({
        meta,
        rootGroup,
        entryIndex: buildEntryIndex(rootGroup),
        groupIndex: buildGroupIndex(rootGroup),
        isDirty: true,
      });

      return true;
    },

    // ────── Group CRUD ──────

    createGroup: (parentGroupUuid, name) => {
      const state = get();
      const db = state._db;
      if (!db) return null;

      const root = db.getDefaultGroup();
      const parentKdbx = findKdbxGroup(root, parentGroupUuid);
      if (!parentKdbx) return null;

      const newKdbxGroup = db.createGroup(parentKdbx, name);

      // Re-parse
      const { meta, rootGroup } = parseDatabase(db);
      const groupIndex = buildGroupIndex(rootGroup);

      const newGroup = groupIndex.get(newKdbxGroup.uuid.id) ?? null;

      set({
        meta,
        rootGroup,
        entryIndex: buildEntryIndex(rootGroup),
        groupIndex,
        isDirty: true,
      });

      return newGroup;
    },

    renameGroup: (uuid, name) => {
      const state = get();
      const db = state._db;
      if (!db) return false;

      const root = db.getDefaultGroup();
      const group = findKdbxGroup(root, uuid);
      if (!group) return false;

      group.name = name;

      // Re-parse
      const { meta, rootGroup } = parseDatabase(db);
      set({
        meta,
        rootGroup,
        entryIndex: buildEntryIndex(rootGroup),
        groupIndex: buildGroupIndex(rootGroup),
        isDirty: true,
      });

      return true;
    },

    deleteGroup: (uuid) => {
      const state = get();
      const db = state._db;
      if (!db) return false;

      const root = db.getDefaultGroup();
      // Don't allow deleting the root group
      if (root.uuid?.id === uuid) return false;

      const group = findKdbxGroup(root, uuid);
      if (!group) return false;

      const recycleBinEnabled = db.meta.recycleBinEnabled;
      const recycleBinUuid = db.meta.recycleBinUuid;
      const isAlreadyInBin = isInRecycleBin(group.parentGroup, recycleBinUuid);

      const isRecycleBinSelf =
        recycleBinUuid && group.uuid?.id === recycleBinUuid.id;

      if (
        recycleBinEnabled &&
        recycleBinUuid &&
        !isAlreadyInBin &&
        !isRecycleBinSelf
      ) {
        const recycleBinGroup = findKdbxGroup(root, recycleBinUuid.id);
        if (recycleBinGroup) {
          db.move(group, recycleBinGroup);
        } else {
          db.move(group, null);
        }
      } else {
        db.move(group, null);
      }

      // Re-parse
      const { meta, rootGroup } = parseDatabase(db);
      const groupIndex = buildGroupIndex(rootGroup);

      // If we were viewing the deleted group, navigate to root
      const newActiveUuid = groupIndex.has(state.activeGroupUuid ?? "")
        ? state.activeGroupUuid
        : rootGroup.uuid;

      set({
        meta,
        rootGroup,
        entryIndex: buildEntryIndex(rootGroup),
        groupIndex,
        activeGroupUuid: newActiveUuid,
        breadcrumbs: newActiveUuid === rootGroup.uuid ? [] : state.breadcrumbs,
        isDirty: true,
      });

      return true;
    },

    isGroupInRecycleBin: (groupUuid) => {
      const state = get();
      const db = state._db;
      if (!db || !db.meta.recycleBinUuid) return false;
      const recycleBinId = db.meta.recycleBinUuid.id;

      let currentUuid: string | null = groupUuid;
      while (currentUuid) {
        if (currentUuid === recycleBinId) {
          return true;
        }
        const group = state.groupIndex.get(currentUuid);
        currentUuid = group?.parentGroupUuid ?? null;
      }
      return false;
    },

    // ────── History ──────

    logAccess: (entryUuid, entryTitle, action) => {
      set((state: any) => ({
        historyLog: [
          {
            entryUuid,
            entryTitle,
            action,
            timestamp: new Date().toISOString(),
          },
          ...state.historyLog,
        ].slice(0, MAX_HISTORY),
      }));
    },

    // ────── Maintenance ──────

    cleanupDatabase: (options) => {
      const state = get();
      const db = state._db;
      if (!db) return null;

      let totalHistoryEntries = 0;
      let historyEntriesToRemove = 0;
      const historyMaxItems =
        options.history &&
        typeof db.meta.historyMaxItems === "number" &&
        db.meta.historyMaxItems >= 0
          ? db.meta.historyMaxItems
          : 10;

      const usedBinaries = new Set<string>();

      // Traverse entries
      const allEntries: kdbxweb.KdbxEntry[] = [];
      const walkGroup = (group: kdbxweb.KdbxGroup) => {
        allEntries.push(...(group.entries ?? []));
        for (const subGroup of group.groups ?? []) {
          walkGroup(subGroup);
        }
      };
      walkGroup(db.getDefaultGroup());

      for (const entry of allEntries) {
        totalHistoryEntries += entry.history?.length ?? 0;
        if (
          options.history &&
          entry.history &&
          entry.history.length > historyMaxItems
        ) {
          historyEntriesToRemove += entry.history.length - historyMaxItems;
        }

        const processBinaries = (e: kdbxweb.KdbxEntry) => {
          e.binaries.forEach((binVal) => {
            if (binVal && typeof binVal === "object" && "hash" in binVal) {
              usedBinaries.add((binVal as any).hash);
            }
          });
        };

        processBinaries(entry);
        if (entry.history) {
          const keepStartIndex = options.history
            ? Math.max(0, entry.history.length - historyMaxItems)
            : 0;
          for (let i = keepStartIndex; i < entry.history.length; i++) {
            processBinaries(entry.history[i]);
          }
        }
      }

      const totalBinaries = db.binaries.getAllWithHashes().length;
      let binariesToRemove = 0;
      if (options.binaries) {
        for (const binary of db.binaries.getAllWithHashes()) {
          if (!usedBinaries.has(binary.hash)) {
            binariesToRemove++;
          }
        }
      }

      return {
        totalHistory: totalHistoryEntries,
        historyToRemove: historyEntriesToRemove,
        totalBinaries,
        binariesToRemove,
      };
    },

    runCleanupDatabase: (options) => {
      const state = get();
      const db = state._db;
      if (!db) return false;

      db.cleanup({
        binaries: options.binaries,
        historyRules: options.history,
      });

      state.refreshParsedState();
      set({ isDirty: true });
      return true;
    },

    // ────── Templates Support ──────

    setTemplatesEnabled: async (enabled) => {
      const state = get();
      const db = state._db;
      if (!db) return;

      if (!db.meta.customData) {
        (db.meta as any).customData = new Map();
      }
      db.meta.customData.set("templatesEnabled", {
        value: enabled ? "true" : "false",
        lastModified: new Date(),
      });

      if (enabled) {
        const templatesGroupKdbx = ensureTemplatesGroup(db);
        if (templatesGroupKdbx) {
          seedDefaultTemplates(db, templatesGroupKdbx);
        }
      }

      set({ isDirty: true });
      state.refreshParsedState();
    },

    setTemplatesGroup: async (groupUuid) => {
      const state = get();
      const db = state._db;
      if (!db) return;

      const root = db.getDefaultGroup();
      if (groupUuid === root.uuid?.id) return;

      db.meta.entryTemplatesGroup = new kdbxweb.KdbxUuid(groupUuid);

      const templatesGroupKdbx = findKdbxGroup(root, groupUuid);
      if (templatesGroupKdbx) {
        seedDefaultTemplates(db, templatesGroupKdbx);
      }

      set({ isDirty: true });
      state.refreshParsedState();
    },

    // ────── Recycle Bin Support ──────

    setRecycleBinEnabled: async (enabled) => {
      const state = get();
      const db = state._db;
      if (!db) return;

      db.meta.recycleBinEnabled = enabled;

      if (enabled) {
        ensureRecycleBinGroup(db);
      }

      set({ isDirty: true });
      state.refreshParsedState();
    },

    setRecycleBinGroup: async (groupUuid) => {
      const state = get();
      const db = state._db;
      if (!db) return;

      const root = db.getDefaultGroup();
      if (groupUuid === root.uuid?.id) return;

      db.meta.recycleBinUuid = new kdbxweb.KdbxUuid(groupUuid);

      set({ isDirty: true });
      state.refreshParsedState();
    },

    emptyRecycleBin: async () => {
      const state = get();
      const db = state._db;
      if (!db || !db.meta.recycleBinUuid) return false;

      const root = db.getDefaultGroup();
      const binGroup = findKdbxGroup(root, db.meta.recycleBinUuid.id);
      if (!binGroup) return false;

      // Purge entries inside the recycle bin group
      const entriesToPurge = [...binGroup.entries];
      for (const entry of entriesToPurge) {
        db.move(entry, null);
      }

      // Purge subgroups inside the recycle bin group
      const groupsToPurge = [...binGroup.groups];
      for (const subgroup of groupsToPurge) {
        db.move(subgroup, null);
      }

      set({ isDirty: true });
      state.refreshParsedState();
      return true;
    },

    changeMasterPassword: async (newPassword) => {
      const state = get();
      const db = state._db;
      if (!db) return false;

      try {
        const newCredentials = createCredentials(newPassword);
        await newCredentials.ready;
        db.credentials = newCredentials;

        const bioActive = await isBiometricEnabled();
        if (bioActive) {
          const success = await enableBiometric(newPassword);
          if (!success) {
            console.warn(
              "[VaultStore] Biometric sync cancelled/failed during password update."
            );
          }
        }

        set({ isDirty: true });
        state.refreshParsedState();
        return true;
      } catch (e) {
        console.error("[VaultStore] Error changing master password:", e);
        return false;
      }
    },

    // ────── Entry History ──────

    getEntryHistory: (entryUuid) => {
      const state = get();
      const db = state._db;
      if (!db) return [];

      const root = db.getDefaultGroup();
      const found = findKdbxEntry(root, entryUuid);
      if (!found) return [];

      const { entry } = found;
      const history = entry.history ?? [];

      return history.map((histEntry, index) => {
        // Extract custom fields (exclude standard KeePass fields)
        const standardFields = new Set([
          "Title",
          "UserName",
          "Password",
          "URL",
          "Notes",
          "otp",
          "TimeOtp",
          "totp",
        ]);
        const fields: Record<string, string> = {};
        const secureFields: string[] = [];

        histEntry.fields.forEach((value, key) => {
          if (!standardFields.has(key)) {
            const isSecure =
              typeof value === "object" && value !== null && "getText" in value;
            if (isSecure) {
              secureFields.push(key);
            }
            fields[key] =
              typeof value === "string"
                ? value
                : typeof value === "object" && "getText" in value
                  ? (value as { getText(): string }).getText()
                  : String(value);
          }
        });

        const getVal = (field: string): string => {
          const val = histEntry.fields.get(field);
          if (!val) return "";
          if (typeof val === "string") return val;
          if (typeof val === "object" && "getText" in val) {
            return (val as { getText(): string }).getText();
          }
          return String(val);
        };

        return {
          index,
          title: getVal("Title"),
          username: getVal("UserName"),
          password: getVal("Password"),
          url: getVal("URL"),
          notes: getVal("Notes"),
          fields,
          secureFields,
          tags: histEntry.tags ?? [],
          modifiedAt: histEntry.times?.lastModTime
            ? histEntry.times.lastModTime.toISOString()
            : new Date(0).toISOString(),
          iconId: histEntry.icon ?? 0,
          otp:
            getVal("otp") || getVal("TimeOtp") || getVal("totp") || undefined,
        } satisfies VaultHistorySnapshot;
      });
    },

    restoreHistorySnapshot: async (entryUuid, snapshotIndex) => {
      const state = get();
      const db = state._db;
      if (!db) return null;

      const root = db.getDefaultGroup();
      const found = findKdbxEntry(root, entryUuid);
      if (!found) return null;

      const { entry } = found;
      const history = entry.history ?? [];
      if (snapshotIndex < 0 || snapshotIndex >= history.length) return null;

      const snapshot = history[snapshotIndex];

      // Push current state to history before restoring
      entry.pushHistory();
      pruneEntryHistory(entry, db);

      // Restore fields from snapshot
      const standardFields = new Set([
        "Title",
        "UserName",
        "Password",
        "URL",
        "Notes",
        "otp",
        "TimeOtp",
        "totp",
      ]);

      // Copy standard fields
      for (const field of ["Title", "UserName", "Password", "URL", "Notes"]) {
        const val = snapshot.fields.get(field);
        if (val !== undefined) {
          entry.fields.set(field, val);
        }
      }

      // Handle OTP
      const otpVal =
        snapshot.fields.get("otp") ||
        snapshot.fields.get("TimeOtp") ||
        snapshot.fields.get("totp");
      if (otpVal) {
        entry.fields.set("otp", otpVal);
      } else {
        entry.fields.delete("otp");
      }

      // Remove non-standard fields from current entry that aren't in snapshot
      const snapshotCustomKeys = new Set<string>();
      snapshot.fields.forEach((_val, key) => {
        if (!standardFields.has(key)) {
          snapshotCustomKeys.add(key);
        }
      });

      entry.fields.forEach((_val, key) => {
        if (!standardFields.has(key) && !snapshotCustomKeys.has(key)) {
          entry.fields.delete(key);
        }
      });

      // Restore custom fields from snapshot
      snapshot.fields.forEach((val, key) => {
        if (!standardFields.has(key)) {
          entry.fields.set(key, val);
        }
      });

      // Restore icon and tags
      entry.icon = snapshot.icon ?? 0;
      entry.tags = [...(snapshot.tags ?? [])];

      // Update modification time
      entry.times.lastModTime = new Date();

      // Re-parse state
      const { meta, rootGroup } = parseDatabase(db);
      const entryIndex = buildEntryIndex(rootGroup);
      const groupIndex = buildGroupIndex(rootGroup);

      const updatedEntry = entryIndex.get(entryUuid) ?? null;

      set({
        meta,
        rootGroup,
        entryIndex,
        groupIndex,
        isDirty: true,
      });

      return updatedEntry;
    },

    deleteHistorySnapshot: (entryUuid, snapshotIndex) => {
      const state = get();
      const db = state._db;
      if (!db) return false;

      const root = db.getDefaultGroup();
      const found = findKdbxEntry(root, entryUuid);
      if (!found) return false;

      const { entry } = found;
      const history = entry.history ?? [];
      if (snapshotIndex < 0 || snapshotIndex >= history.length) return false;

      entry.removeHistory(snapshotIndex);

      set({ isDirty: true });
      state.refreshParsedState();
      return true;
    },

    // ────── History Settings ──────

    setHistoryMaxItems: (value) => {
      const state = get();
      const db = state._db;
      if (!db) return;

      db.meta.historyMaxItems = value;

      set({ isDirty: true });
      state.refreshParsedState();
    },

    setHistoryMaxSize: (value) => {
      const state = get();
      const db = state._db;
      if (!db) return;

      db.meta.historyMaxSize = value;

      set({ isDirty: true });
      state.refreshParsedState();
    },

    // ────── App Settings Actions ──────

    setTheme: async (theme) => {
      try {
        await SecureStore.setItemAsync("vault_app_theme", theme);
        set({ theme });
      } catch (e) {
        console.error("[VaultStore] Failed to save theme settings:", e);
      }
    },

    setAutoLockTimeout: async (timeout) => {
      try {
        await SecureStore.setItemAsync(
          "vault_app_auto_lock_timeout",
          String(timeout)
        );
        set({ autoLockTimeout: timeout });
      } catch (e) {
        console.error("[VaultStore] Failed to save auto-lock settings:", e);
      }
    },

    setClipboardClearTime: async (timeout) => {
      try {
        await SecureStore.setItemAsync(
          "vault_app_clipboard_clear_time",
          String(timeout)
        );
        set({ clipboardClearTime: timeout });
      } catch (e) {
        console.error("[VaultStore] Failed to save clipboard settings:", e);
      }
    },

    setAutoSave: async (enabled) => {
      try {
        await SecureStore.setItemAsync(
          "vault_app_auto_save",
          enabled ? "true" : "false"
        );
        set({ autoSave: enabled });
      } catch (e) {
        console.error("[VaultStore] Failed to save auto-save settings:", e);
      }
    },

    loadAppSettings: async () => {
      try {
        const storedTheme = await SecureStore.getItemAsync("vault_app_theme");
        const storedAutoLock = await SecureStore.getItemAsync(
          "vault_app_auto_lock_timeout"
        );
        const storedClipboard = await SecureStore.getItemAsync(
          "vault_app_clipboard_clear_time"
        );
        const storedAutoSave = await SecureStore.getItemAsync(
          "vault_app_auto_save"
        );

        const updates: Partial<VaultStoreState> = {};
        if (storedTheme === "light" || storedTheme === "dark") {
          updates.theme = storedTheme;
        }
        if (storedAutoLock) {
          const val = parseInt(storedAutoLock, 10);
          if (!isNaN(val)) {
            updates.autoLockTimeout = val;
          }
        }
        if (storedClipboard) {
          const val = parseInt(storedClipboard, 10);
          if (!isNaN(val)) {
            updates.clipboardClearTime = val;
          }
        }
        if (storedAutoSave) {
          updates.autoSave = storedAutoSave === "true";
        }
        set(updates);
      } catch (e) {
        console.error("[VaultStore] Failed to load app settings:", e);
      }
    },

    // ────── Dirty State ──────

    markDirty: () => set({ isDirty: true }),
    markClean: () => set({ isDirty: false }),

    // ────── Saving State ──────
    setIsSaving: (isSaving) => set({ isSaving }),
  };
});

/**
 * Helper to prune entry history using the db metadata rules (max items, max size)
 */
function pruneEntryHistory(entry: kdbxweb.KdbxEntry, db: kdbxweb.Kdbx) {
  const maxItems = db.meta.historyMaxItems;
  const maxSize = db.meta.historyMaxSize;

  // 1. Prune by max items
  // Note: KeePass defaults maxItems to 10. If maxItems is undefined or invalid, we don't prune.
  // -1 means unlimited.
  if (maxItems !== undefined && maxItems !== -1 && maxItems >= 0) {
    while (entry.history.length > maxItems) {
      entry.removeHistory(0);
    }
  }

  // 2. Prune by max size
  // -1 means unlimited.
  if (maxSize !== undefined && maxSize !== -1 && maxSize >= 0) {
    let currentTotalSize = calculateEntryHistorySize(entry.history);
    while (currentTotalSize > maxSize && entry.history.length > 0) {
      entry.removeHistory(0);
      currentTotalSize = calculateEntryHistorySize(entry.history);
    }
  }
}

/**
 * Approximate the byte size of historical entry snapshots
 */
function calculateEntryHistorySize(history: kdbxweb.KdbxEntry[]): number {
  let total = 0;
  for (const hEntry of history) {
    total += 200; // estimated overhead (metadata, dates, uuid, type)

    // Fields
    hEntry.fields.forEach((val, key) => {
      total += key.length;
      if (val) {
        if (typeof val === "string") {
          total += val.length;
        } else if (val && typeof val === "object" && "byteLength" in val) {
          total += (val as any).byteLength;
        }
      }
    });

    // Binaries
    hEntry.binaries.forEach((val, key) => {
      total += key.length;
      if (val) {
        if (val && typeof val === "object") {
          if ("byteLength" in val) {
            total += (val as any).byteLength;
          } else if (
            "value" in val &&
            val.value &&
            typeof val.value === "object" &&
            "byteLength" in val.value
          ) {
            total += (val.value as any).byteLength;
          } else {
            total += 1024; // fallback
          }
        }
      }
    });
  }
  return total;
}
