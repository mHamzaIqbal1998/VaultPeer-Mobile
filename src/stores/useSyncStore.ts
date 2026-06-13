/**
 * useSyncStore — Zustand UI state for peer file synchronization.
 *
 * Holds the user-visible sync status plus any pending remote update that needs
 * a user decision. The sync *logic* lives in syncEngine; this store is the thin
 * reactive surface the UI subscribes to (status pill, reload banner, conflict
 * dialog).
 */

import { create } from "zustand";

export type SyncStatus =
  | "idle" // no active file / nothing to do
  | "offline" // active file set but no peers connected
  | "syncing" // exchanging metadata / transferring a file
  | "synced" // up to date with peers
  | "error"; // last sync attempt failed

/**
 * A newer remote version waiting on the user.
 *  - mode "reload"   → vault is open & clean; offer to reload to latest.
 *  - mode "conflict" → vault is open & has unsaved edits; user must choose
 *                      between keeping local edits or taking the remote copy.
 */
export interface PendingRemote {
  filename: string;
  fileData: string; // base64 KDBX
  remoteMtime: number;
  fromPeerId: string;
  mode: "reload" | "conflict";
}

export interface SyncQueueItem {
  id: string; // unique identifier: `${peerId}_${filename}_${type}`
  peerId: string;
  filename: string;
  type: "pull" | "push";
  status: "pending" | "syncing" | "completed" | "failed";
  lastModified: number;
  error?: string;
  timestamp: number;
}

interface SyncStoreState {
  status: SyncStatus;
  lastSyncAt: number | null;
  /** Number of peers currently exchanging sync data. */
  activePeers: number;
  /** A remote update awaiting a user decision, or null. */
  pendingRemote: PendingRemote | null;
  /** Incremented whenever the engine applies a remote vault to the open DB,
   * so screens can re-derive after a silent reload. */
  appliedRevision: number;
  /** Queue of active and failed sync tasks. */
  syncQueue: SyncQueueItem[];

  setStatus: (status: SyncStatus) => void;
  setActivePeers: (n: number) => void;
  markSynced: () => void;
  setPendingRemote: (pending: PendingRemote | null) => void;
  bumpApplied: () => void;
  addToQueue: (
    item: Omit<SyncQueueItem, "id" | "timestamp" | "status"> & {
      status?: SyncQueueItem["status"];
    }
  ) => void;
  updateQueueItemStatus: (
    id: string,
    status: SyncQueueItem["status"],
    error?: string
  ) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  reset: () => void;
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  status: "idle",
  lastSyncAt: null,
  activePeers: 0,
  pendingRemote: null,
  appliedRevision: 0,
  syncQueue: [],

  setStatus: (status) => set({ status }),
  setActivePeers: (n) => set({ activePeers: n }),
  markSynced: () => set({ status: "synced", lastSyncAt: Date.now() }),
  setPendingRemote: (pending) => set({ pendingRemote: pending }),
  bumpApplied: () => set((s) => ({ appliedRevision: s.appliedRevision + 1 })),
  addToQueue: (item) =>
    set((state) => {
      const id = `${item.peerId}_${item.filename}_${item.type}`;
      const existingIndex = state.syncQueue.findIndex((q) => q.id === id);
      const newItem: SyncQueueItem = {
        ...item,
        id,
        status: item.status ?? "pending",
        timestamp: Date.now(),
      };
      let newQueue = [...state.syncQueue];
      if (existingIndex > -1) {
        newQueue[existingIndex] = newItem;
      } else {
        newQueue = [newItem, ...newQueue];
      }
      return { syncQueue: newQueue };
    }),
  updateQueueItemStatus: (id, status, error) =>
    set((state) => ({
      syncQueue: state.syncQueue.map((item) =>
        item.id === id
          ? { ...item, status, error, timestamp: Date.now() }
          : item
      ),
    })),
  removeFromQueue: (id) =>
    set((state) => ({
      syncQueue: state.syncQueue.filter((item) => item.id !== id),
    })),
  clearQueue: () => set({ syncQueue: [] }),
  reset: () =>
    set({
      status: "idle",
      lastSyncAt: null,
      activePeers: 0,
      pendingRemote: null,
      syncQueue: [],
    }),
}));
