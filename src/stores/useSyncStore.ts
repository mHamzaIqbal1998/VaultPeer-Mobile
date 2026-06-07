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

  setStatus: (status: SyncStatus) => void;
  setActivePeers: (n: number) => void;
  markSynced: () => void;
  setPendingRemote: (pending: PendingRemote | null) => void;
  bumpApplied: () => void;
  reset: () => void;
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  status: "idle",
  lastSyncAt: null,
  activePeers: 0,
  pendingRemote: null,
  appliedRevision: 0,

  setStatus: (status) => set({ status }),
  setActivePeers: (n) => set({ activePeers: n }),
  markSynced: () => set({ status: "synced", lastSyncAt: Date.now() }),
  setPendingRemote: (pending) => set({ pendingRemote: pending }),
  bumpApplied: () => set((s) => ({ appliedRevision: s.appliedRevision + 1 })),
  reset: () =>
    set({
      status: "idle",
      lastSyncAt: null,
      activePeers: 0,
      pendingRemote: null,
    }),
}));
