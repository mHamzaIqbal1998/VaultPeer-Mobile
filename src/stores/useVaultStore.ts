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
import type { VaultEntry, VaultGroup, VaultMeta } from "../types/kdbx";

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
  ) => VaultEntry | null;
  updateEntry: (uuid: string, data: Partial<VaultEntry>) => VaultEntry | null;
  deleteEntry: (uuid: string) => boolean;

  // Group CRUD
  createGroup: (parentGroupUuid: string, name: string) => VaultGroup | null;
  renameGroup: (uuid: string, name: string) => boolean;
  deleteGroup: (uuid: string) => boolean;

  // History
  logAccess: (
    entryUuid: string,
    entryTitle: string,
    action: HistoryLogEntry["action"]
  ) => void;

  // Dirty state
  markClean: () => void;
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

// ────────────────────────────────────────────
// Store Creation
// ────────────────────────────────────────────

const MAX_HISTORY = 50;

export const useVaultStore = create<VaultStoreState>((set, get) => ({
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

  // ────── Core Actions ──────

  openDatabase: (db, filePath) => {
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
    });
  },

  closeDatabase: () => {
    const db = get()._db;
    // Clear protected values from memory
    if (db) {
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

  createEntry: (parentGroupUuid, data) => {
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

    if (data.iconId !== undefined) {
      newKdbxEntry.icon = data.iconId;
    }

    // Set custom fields
    if (data.fields) {
      for (const [key, value] of Object.entries(data.fields)) {
        newKdbxEntry.fields.set(key, value);
      }
    }

    if (data.tags) {
      newKdbxEntry.tags = [...data.tags];
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

  updateEntry: (uuid, data) => {
    const state = get();
    const db = state._db;
    if (!db) return null;

    const root = db.getDefaultGroup();
    const found = findKdbxEntry(root, uuid);
    if (!found) return null;

    const { entry } = found;

    // Push current state to history before modification
    entry.pushHistory();

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

    if (data.fields) {
      // Remove old custom fields not in the new set
      const standardFields = new Set([
        "Title",
        "UserName",
        "Password",
        "URL",
        "Notes",
      ]);
      const newKeys = new Set(Object.keys(data.fields));

      entry.fields.forEach((_value, key) => {
        if (!standardFields.has(key) && !newKeys.has(key)) {
          entry.fields.delete(key);
        }
      });

      for (const [key, value] of Object.entries(data.fields)) {
        entry.fields.set(key, value);
      }
    }

    if (data.tags) {
      entry.tags = [...data.tags];
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

    // Move to recycle bin (or delete permanently if no bin)
    db.remove(found.entry);

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

    db.remove(group);

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

  // ────── History ──────

  logAccess: (entryUuid, entryTitle, action) => {
    set((state) => ({
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

  // ────── Dirty State ──────

  markClean: () => set({ isDirty: false }),
}));
