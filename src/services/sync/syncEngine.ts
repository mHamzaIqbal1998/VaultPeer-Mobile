/**
 * syncEngine — Peer file-synchronization orchestrator (singleton).
 *
 * Responsibilities:
 *   • Advertise the active file's metadata to peers (filename + logical mtime).
 *   • Decide, via Last-Write-Wins, whether to pull a newer remote copy.
 *   • Serve pull_requests and accept push_requests from peers.
 *   • Apply remote updates safely:
 *       - file not open  → write straight to disk.
 *       - open & clean   → hold for a "reload" prompt.
 *       - open & dirty   → hold for a "keep mine / take remote" conflict prompt.
 *   • Broadcast push_request on every successful local save.
 *
 * It is transport-agnostic: it talks to peers through hooks registered on the
 * WebRTCManager, and it talks to the file system / vault through an injected
 * {@link SyncHost} (implemented by FilePickerContext). This keeps the engine
 * free of React and free of circular imports.
 */

import { useSyncStore } from "../../stores/useSyncStore";
import { webRTCManager } from "../webrtc/webRTCManager";
import { useBackupStore } from "../../stores/useBackupStore";
import { backupPulledRevision } from "./backupService";
import { getEffectiveMtime, recordRemoteApply } from "./syncMetaStore";
import {
  LWW_THRESHOLD_MS,
  SyncMsg,
  type FileTransferMessage,
} from "./syncProtocol";

const TAG = "[SyncEngine]";

/** How long to keep the "syncing" indicator before settling to "synced".
 *  Must be generous enough for large KDBX file transfers over mobile WebRTC. */
const SYNC_TIMEOUT_MS = 15_000;

/**
 * Per-task timeout for individual pull/push operations.
 * Must be generous for ~5 MB files over slow mobile data channels,
 * especially when bidirectional traffic serialization causes queuing.
 */
const TASK_TIMEOUT_MS = 45_000;

export interface ActiveFile {
  uri: string;
  bookmark: string | null;
  /** Basename used as the sync key, e.g. "Passwords.kdbx". */
  filename: string;
}

/**
 * Bridge implemented by the React layer (FilePickerContext) so the engine can
 * perform file IO and vault reloads without importing React.
 */
export interface SyncHost {
  getActiveFile(): ActiveFile | null;
  /** Read the active file as base64 (serialized through the save lock). */
  readActiveFileBase64(): Promise<string>;
  /** Write base64 to the active file (serialized through the save lock). */
  writeActiveFileBase64(b64: string): Promise<boolean>;
  /** Is the in-memory vault open AND backed by the active file? */
  isVaultOpen(): boolean;
  /** Does the open vault have unsaved edits? */
  isVaultDirty(): boolean;
  /** Silent re-decrypt from disk using in-memory credentials + refresh state. */
  reloadOpenVaultFromDisk(): Promise<boolean>;
}

/**
 * Stashed disk-write: when a remote file is applied to disk while the vault is
 * closed, we record it here so that when the vault subsequently opens we can
 * prompt a reload rather than silently showing stale data.
 */
interface StashedDiskWrite {
  filename: string;
  remoteMtime: number;
  /** Timestamp (Date.now()) when the write happened. */
  writtenAt: number;
}

class SyncEngine {
  private host: SyncHost | null = null;
  private openChannels = new Set<string>();
  private syncTimeout: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  /**
   * Tracks a remote-applied disk write that was performed while the vault was
   * NOT open. Cleared when the vault opens and consumes it, or when the active
   * file changes.
   */
  private stashedDiskWrite: StashedDiskWrite | null = null;
  /**
   * Peers from whom we are awaiting metadata + possible pull completion before
   * advertising our own metadata. This prevents the race where a peer sees our
   * stale mtime and pulls old data before we've finished pulling their newer
   * file. Flow:
   *   1. We send metadata_query → peer is added to pendingAdvertise.
   *   2. We receive metadata_info → if pull needed, peer stays in set.
   *   3. We receive metadata_complete → if no pull was needed, advertise now.
   *      If a pull IS in flight, the advertisement stays deferred.
   *   4. Pull completes (applyIncomingFile) → advertise with updated mtime.
   */
  private pendingAdvertise = new Set<string>();
  /**
   * Peers for which we have an in-flight pull (waiting on pull_response).
   * While a pull is in flight the deferred advertisement must wait.
   */
  private activePulls = new Set<string>();
  /**
   * Peers for which we have an in-flight push (waiting on push_response).
   */
  private activePushes = new Set<string>();
  /**
   * Peers to whom we are currently sending a chunked pull_response.
   * Guards against serving duplicate pull_requests for the same file.
   */
  private activeServes = new Set<string>();
  /**
   * Pull requests that arrived while we were mid-receive (active pull) from
   * the same peer. Served after our pull completes to avoid a bidirectional
   * chunked transfer storm on mobile data channels.
   * Uses an array queue per peer to prevent losing requests.
   */
  private deferredPullRequests = new Map<string, string[]>(); // peerId → [filename, ...]
  private taskTimers = new Map<string, ReturnType<typeof setTimeout>>();

  public getActivePushesCount(): number {
    return this.activePushes.size;
  }

  public getActivePullsCount(): number {
    return this.activePulls.size;
  }

  /** Wire the engine to the file/vault host and the WebRTC transport. */
  public init(host: SyncHost) {
    this.host = host;
    if (!this.started) {
      webRTCManager.setSyncHooks({
        onChannelOpen: (peerId) => this.onPeerChannelOpen(peerId),
        onChannelClosed: (peerId) => this.onPeerChannelClosed(peerId),
        onMessage: (peerId, msg) => this.handlePeerMessage(peerId, msg),
      });
      this.started = true;
    }
    // Kick the sync handshake now that the host is wired. This covers the race
    // where the React effect for onActiveFileChanged fired before init() — at
    // that point `this.host` was still null so nothing happened.
    this.onActiveFileChanged();
  }

  // ── Status helpers ───────────────────────────

  private setStatus(
    status: ReturnType<typeof useSyncStore.getState>["status"]
  ) {
    useSyncStore.getState().setStatus(status);
  }

  private beginSyncing() {
    this.setStatus("syncing");
    if (this.syncTimeout) clearTimeout(this.syncTimeout);
    this.syncTimeout = setTimeout(() => {
      // Only settle if there are no active transfers in flight.
      if (
        useSyncStore.getState().status === "syncing" &&
        this.activePulls.size === 0 &&
        this.activePushes.size === 0
      ) {
        useSyncStore.getState().markSynced();
      }
    }, SYNC_TIMEOUT_MS);
  }

  /**
   * Cancel the syncing timeout early because we've conclusively finished all
   * transfers. Prevents the indicator lingering for the full timeout duration.
   */
  private settleIfIdle() {
    if (this.activePulls.size === 0 && this.activePushes.size === 0) {
      if (this.syncTimeout) {
        clearTimeout(this.syncTimeout);
        this.syncTimeout = null;
      }
      if (useSyncStore.getState().status === "syncing") {
        useSyncStore.getState().markSynced();
      }
    }
  }

  private refreshPeerCount() {
    useSyncStore.getState().setActivePeers(this.openChannels.size);
  }

  // ── Transport hooks (called by WebRTCManager) ─

  private onPeerChannelOpen(peerId: string) {
    this.openChannels.add(peerId);
    this.refreshPeerCount();

    const af = this.host?.getActiveFile();
    if (!af) {
      this.setStatus("idle");
      return;
    }
    this.beginSyncing();
    // Query-first: ask for the peer's files. Defer our own advertisement
    // until we receive `metadata_complete` so that we pull any newer files
    // before the peer sees our (possibly stale) metadata.
    this.pendingAdvertise.add(peerId);
    webRTCManager.sendToPeer(peerId, { type: SyncMsg.METADATA_QUERY });
  }

  private onPeerChannelClosed(peerId: string) {
    this.openChannels.delete(peerId);
    this.pendingAdvertise.delete(peerId);
    this.activePulls.delete(peerId);
    this.activePushes.delete(peerId);
    this.refreshPeerCount();

    // Fail all active/pending tasks for this peer
    const queue = useSyncStore.getState().syncQueue;
    for (const item of queue) {
      if (
        item.peerId === peerId &&
        (item.status === "syncing" || item.status === "pending")
      ) {
        const taskId = item.id;
        const timer = this.taskTimers.get(taskId);
        if (timer) {
          clearTimeout(timer);
          this.taskTimers.delete(taskId);
        }
        useSyncStore
          .getState()
          .updateQueueItemStatus(taskId, "failed", "Peer disconnected");
      }
    }

    if (this.openChannels.size === 0 && this.host?.getActiveFile()) {
      this.setStatus("offline");
    }
  }

  // ── Public API (called by FilePickerContext) ──

  /** Re-advertise to all peers — call when the active file changes. */
  public onActiveFileChanged() {
    // Clear any stashed disk-write from a different file.
    this.stashedDiskWrite = null;
    this.activePushes.clear();
    this.activePulls.clear();
    this.activeServes.clear();
    this.deferredPullRequests.clear();

    // Clear timeouts for all syncing tasks
    for (const timer of this.taskTimers.values()) {
      clearTimeout(timer);
    }
    this.taskTimers.clear();
    const activeFile = this.host?.getActiveFile();
    const activeFilename = activeFile ? activeFile.filename : null;

    // Transition any active or pending tasks to failed since they are being interrupted
    const currentQueue = useSyncStore.getState().syncQueue;
    const updatedQueue = currentQueue.map((item) => {
      if (item.status === "syncing" || item.status === "pending") {
        return {
          ...item,
          status: "failed" as const,
          error: "Sync interrupted by vault lock",
          timestamp: Date.now(),
        };
      }
      return item;
    });

    // Keep failed tasks:
    // If activeFilename is null, we keep all failed tasks in the queue (e.g. so they survive locking)
    // If activeFilename is non-null, we filter to keep only failed tasks for this active file
    const newQueue = updatedQueue.filter((item) => {
      if (item.status !== "failed") return false;
      if (activeFilename === null) return true;
      return item.filename === activeFilename;
    });

    useSyncStore.setState({ syncQueue: newQueue });

    // Guard: host may not be wired yet (React effect ordering). init() will
    // call us again once the host is set.
    if (!this.host) return;

    const af = this.host.getActiveFile();
    if (!af) {
      this.setStatus("idle");
      return;
    }
    if (this.openChannels.size === 0) {
      this.setStatus("offline");
      return;
    }
    this.beginSyncing();
    // Query-first: ask every peer for their files. Once each responds with
    // `metadata_complete`, we advertise our own metadata (see handlePeerMessage).
    // This avoids the race where a peer sees our stale mtime and pulls old data
    // before we've had a chance to pull their newer file.
    for (const peerId of this.openChannels) {
      this.pendingAdvertise.add(peerId);
      webRTCManager.sendToPeer(peerId, { type: SyncMsg.METADATA_QUERY });
    }
  }

  /**
   * Called by the React layer AFTER the vault has been opened (decrypted and
   * loaded into memory). If a remote file was written to disk while the vault
   * was still closed, the in-memory vault may hold stale data. In that case
   * we trigger an immediate reload-from-disk.
   */
  public async onVaultOpened() {
    // First, try to consume a stash immediately.
    const consumed = await this.tryConsumeStash();
    if (consumed) return;

    // If there are in-flight pulls, the stash may arrive imminently.
    // Schedule a short deferred re-check so we catch it.
    if (this.activePulls.size > 0) {
      console.log(
        TAG,
        "Vault opened with in-flight pulls — will re-check stash shortly"
      );
      this.scheduleStashRecheck();
    }
  }

  /**
   * Attempt to consume a stashed disk write. Returns true if a stash was found
   * and consumed (reloaded from disk).
   */
  private async tryConsumeStash(): Promise<boolean> {
    const stashed = this.stashedDiskWrite;
    if (!stashed || !this.host) return false;

    const af = this.host.getActiveFile();
    if (!af || af.filename !== stashed.filename) {
      // Stashed write is for a different file — irrelevant.
      this.stashedDiskWrite = null;
      return false;
    }

    // Consume the stash.
    this.stashedDiskWrite = null;

    console.log(
      TAG,
      "Vault opened after a disk-sync write — reloading from disk"
    );

    try {
      const ok = await this.host.reloadOpenVaultFromDisk();
      if (ok) {
        useSyncStore.getState().bumpApplied();
        useSyncStore.getState().markSynced();
      }
      return ok;
    } catch (e) {
      console.warn(TAG, "Post-open reload failed:", e);
      return false;
    }
  }

  /**
   * Re-check for a stashed disk write after a short delay. This covers the race
   * where the vault was opened just before an in-flight pull completes and
   * writes to disk.
   */
  private stashRecheckTimer: ReturnType<typeof setTimeout> | null = null;
  private stashRecheckAttempts = 0;
  private static readonly MAX_STASH_RECHECK_ATTEMPTS = 10;
  private static readonly STASH_RECHECK_INTERVAL_MS = 500;

  private scheduleStashRecheck() {
    if (this.stashRecheckTimer) clearTimeout(this.stashRecheckTimer);
    this.stashRecheckAttempts = 0;
    this.doStashRecheck();
  }

  private doStashRecheck() {
    this.stashRecheckTimer = setTimeout(async () => {
      this.stashRecheckTimer = null;
      this.stashRecheckAttempts++;

      // Stop if the vault was closed in the meantime.
      if (!this.host?.isVaultOpen()) return;

      const consumed = await this.tryConsumeStash();
      if (consumed) return;

      // Keep retrying as long as pulls are in-flight and we haven't exceeded
      // the maximum number of re-checks.
      if (
        this.activePulls.size > 0 &&
        this.stashRecheckAttempts < SyncEngine.MAX_STASH_RECHECK_ATTEMPTS
      ) {
        this.doStashRecheck();
      }
    }, SyncEngine.STASH_RECHECK_INTERVAL_MS);
  }

  /** Broadcast a push_request to all peers after a successful local save. */
  public async broadcastLocalChange(
    filename: string,
    fileDataB64: string,
    logicalMtime: number
  ) {
    if (this.openChannels.size === 0) return;
    this.beginSyncing();
    for (const peerId of this.openChannels) {
      const taskId = `${peerId}_${filename}_push`;

      // If a push is already in-flight to this peer, the new data supersedes
      // it. The WebRTC layer's generation counter will cancel the old chunked
      // send. We just reset the timeout so it doesn't fire prematurely.
      if (this.activePushes.has(peerId)) {
        console.log(
          TAG,
          `Superseding in-flight push to ${peerId} with newer data`
        );
        this.clearTaskTimeout(taskId);
      }

      this.activePushes.add(peerId);

      useSyncStore.getState().addToQueue({
        peerId,
        filename,
        type: "push",
        lastModified: logicalMtime,
        status: "syncing",
      });
      this.startTaskTimeout(taskId, peerId, "push");

      webRTCManager.sendToPeer(peerId, {
        type: SyncMsg.PUSH_REQUEST,
        filename,
        fileData: fileDataB64,
        lastModified: logicalMtime,
      });
    }
  }

  /** Resolve a pending remote update from a user decision. */
  public async resolvePending(decision: "apply" | "discard") {
    const pending = useSyncStore.getState().pendingRemote;
    useSyncStore.getState().setPendingRemote(null);
    if (!pending || decision === "discard") return;

    const af = this.host?.getActiveFile();
    if (!af || af.filename !== pending.filename || !this.host) {
      return;
    }

    try {
      // Preserve the revision currently on disk before the remote copy
      // overwrites it (mirrors the closed-vault pull path and the server node).
      const oldMtime = await getEffectiveMtime(
        af.uri,
        af.bookmark ?? undefined
      );
      await this.backupCurrentRevision(pending.filename, oldMtime);

      const ok = await this.host.writeActiveFileBase64(pending.fileData);
      if (!ok) {
        this.setStatus("error");
        return;
      }
      await recordRemoteApply(
        af.uri,
        af.bookmark ?? undefined,
        pending.remoteMtime
      );
      await this.host.reloadOpenVaultFromDisk();
      useSyncStore.getState().bumpApplied();
      useSyncStore.getState().markSynced();
    } catch (e) {
      console.warn(TAG, "Failed to apply pending remote:", e);
      this.setStatus("error");
    }
  }

  private startTaskTimeout(
    taskId: string,
    peerId: string,
    type: "pull" | "push"
  ) {
    const existing = this.taskTimers.get(taskId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.taskTimers.delete(taskId);
      const item = useSyncStore
        .getState()
        .syncQueue.find((q) => q.id === taskId);
      if (item && item.status === "syncing") {
        console.warn(TAG, `Sync timeout for task: ${taskId}`);
        useSyncStore
          .getState()
          .updateQueueItemStatus(taskId, "failed", "Sync timed out");
        if (type === "pull") {
          this.activePulls.delete(peerId);
          // Flush any deferred pull request from this peer
          this.serveDeferredPullRequest(peerId);
        } else {
          this.activePushes.delete(peerId);
        }
        this.settleIfIdle();
      }
    }, TASK_TIMEOUT_MS);
    this.taskTimers.set(taskId, timer);
  }

  private clearTaskTimeout(taskId: string) {
    const timer = this.taskTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.taskTimers.delete(taskId);
    }
  }

  /** Manually retry a failed or pending sync queue item. */
  public async retrySync(
    peerId: string,
    filename: string,
    type: "pull" | "push"
  ) {
    const af = this.host?.getActiveFile();
    if (!af || af.filename !== filename || !this.host) {
      console.warn(TAG, "Cannot retry sync: no active file or host mismatch");
      return;
    }

    // Verify the data channel is actually open before retrying.
    if (!this.openChannels.has(peerId)) {
      const taskId = `${peerId}_${filename}_${type}`;
      console.warn(TAG, `Cannot retry sync to ${peerId}: peer not connected`);
      useSyncStore
        .getState()
        .updateQueueItemStatus(taskId, "failed", "Peer not connected");
      return;
    }

    const taskId = `${peerId}_${filename}_${type}`;
    useSyncStore.getState().updateQueueItemStatus(taskId, "syncing");
    this.beginSyncing();

    if (type === "pull") {
      this.activePulls.add(peerId);
      this.startTaskTimeout(taskId, peerId, "pull");
      webRTCManager.sendToPeer(peerId, {
        type: SyncMsg.PULL_REQUEST,
        filename,
      });
    } else {
      // push — verify vault is open so we can read the file
      if (!this.host.isVaultOpen()) {
        console.warn(TAG, "Cannot retry push: vault is locked");
        useSyncStore
          .getState()
          .updateQueueItemStatus(taskId, "failed", "Vault is locked");
        this.settleIfIdle();
        return;
      }
      try {
        // Cancel any stale in-flight push to this peer (the WebRTC generation
        // counter handles the actual cancellation in sendChunkedToPeer).
        if (this.activePushes.has(peerId)) {
          console.log(TAG, `Superseding stale push to ${peerId} with retry`);
          this.clearTaskTimeout(taskId);
        }

        const b64 = await this.host.readActiveFileBase64();
        const mtime = await getEffectiveMtime(af.uri, af.bookmark ?? undefined);
        this.activePushes.add(peerId);
        this.startTaskTimeout(taskId, peerId, "push");
        webRTCManager.sendToPeer(peerId, {
          type: SyncMsg.PUSH_REQUEST,
          filename,
          fileData: b64,
          lastModified: mtime,
        });
      } catch (e: any) {
        console.warn(TAG, "Failed to read file for push retry:", e);
        useSyncStore
          .getState()
          .updateQueueItemStatus(
            taskId,
            "failed",
            e?.message || "Failed to read file"
          );
        this.activePushes.delete(peerId);
        this.settleIfIdle();
      }
    }
  }

  private onSyncCompleteReceived(
    peerId: string,
    msg: {
      filename: string;
      lastModified: number;
      status: "success" | "ignored" | "error";
      message?: string;
    }
  ) {
    const pushTaskId = `${peerId}_${msg.filename}_push`;
    const pullTaskId = `${peerId}_${msg.filename}_pull`;

    const queue = useSyncStore.getState().syncQueue;
    const pushItem = queue.find((q) => q.id === pushTaskId);
    const pullItem = queue.find((q) => q.id === pullTaskId);

    const handleItemComplete = (taskId: string, type: "pull" | "push") => {
      this.clearTaskTimeout(taskId);
      if (type === "pull") {
        this.activePulls.delete(peerId);
      } else {
        this.activePushes.delete(peerId);
      }

      if (msg.status === "success" || msg.status === "ignored") {
        useSyncStore.getState().removeFromQueue(taskId);
      } else {
        useSyncStore
          .getState()
          .updateQueueItemStatus(
            taskId,
            "failed",
            msg.message || "Remote sync check failed"
          );
      }
    };

    if (pushItem && pushItem.status === "syncing") {
      handleItemComplete(pushTaskId, "push");
    }
    if (pullItem && pullItem.status === "syncing") {
      handleItemComplete(pullTaskId, "pull");
    }

    this.settleIfIdle();
  }

  private handlePeerMessage(peerId: string, msg: any) {
    switch (msg?.type) {
      case SyncMsg.METADATA_QUERY:
        void this.advertiseTo(peerId, true);
        break;
      case SyncMsg.METADATA_INFO:
        void this.onMetadataInfo(peerId, msg);
        break;
      case SyncMsg.METADATA_COMPLETE:
        // Peer has finished sending all its metadata. If we were deferring
        // our advertisement AND no pull is in-flight for this peer,
        // advertise now. Otherwise wait for the pull to complete.
        if (
          this.pendingAdvertise.has(peerId) &&
          !this.activePulls.has(peerId)
        ) {
          this.pendingAdvertise.delete(peerId);
          void this.advertiseTo(peerId, false);
        }
        break;
      case SyncMsg.PULL_REQUEST:
        void this.handleIncomingPullRequest(peerId, msg.filename);
        break;
      case SyncMsg.PULL_RESPONSE:
      case SyncMsg.PUSH_REQUEST:
        void this.applyIncomingFile(peerId, msg as FileTransferMessage);
        break;
      case SyncMsg.PUSH_RESPONSE: {
        const taskId = `${peerId}_${msg.filename}_push`;
        this.clearTaskTimeout(taskId);
        this.activePushes.delete(peerId);
        if (msg.status === "success" || msg.status === "ignored") {
          useSyncStore.getState().removeFromQueue(taskId);
        } else {
          useSyncStore
            .getState()
            .updateQueueItemStatus(
              taskId,
              "failed",
              msg.message || "Failed to push"
            );
        }
        this.settleIfIdle();
        break;
      }
      case SyncMsg.SYNC_COMPLETE:
        this.onSyncCompleteReceived(peerId, msg);
        break;
      case SyncMsg.TRANSFER_NACK:
        this.onTransferNack(peerId, msg);
        break;
      case SyncMsg.DC_PING:
      case SyncMsg.DC_PONG:
        // Heartbeat messages handled by WebRTCManager, ignore here.
        break;
      default:
        break;
    }
  }

  // ── Handlers ─────────────────────────────────

  /**
   * Handle a transfer_nack from a peer — the receiver failed to reassemble
   * a chunked transfer we sent. Mark the relevant queue task as failed.
   */
  private onTransferNack(
    peerId: string,
    msg: { transferId: string; filename: string; reason: string }
  ) {
    console.warn(
      TAG,
      `Transfer NACK from ${peerId} for "${msg.filename}": ${msg.reason}`
    );
    // Try to match against push tasks (pull_response NACKs are uncommon
    // since the receiver initiated the pull)
    const pushTaskId = `${peerId}_${msg.filename}_push`;
    const pullTaskId = `${peerId}_${msg.filename}_pull`;

    const queue = useSyncStore.getState().syncQueue;
    const pushItem = queue.find(
      (q) => q.id === pushTaskId && q.status === "syncing"
    );
    const pullItem = queue.find(
      (q) => q.id === pullTaskId && q.status === "syncing"
    );

    if (pushItem) {
      this.clearTaskTimeout(pushTaskId);
      this.activePushes.delete(peerId);
      useSyncStore
        .getState()
        .updateQueueItemStatus(
          pushTaskId,
          "failed",
          `Receiver NACK: ${msg.reason}`
        );
    }
    if (pullItem) {
      this.clearTaskTimeout(pullTaskId);
      this.activePulls.delete(peerId);
      useSyncStore
        .getState()
        .updateQueueItemStatus(
          pullTaskId,
          "failed",
          `Transfer failed: ${msg.reason}`
        );
      this.serveDeferredPullRequest(peerId);
    }
    this.settleIfIdle();
  }

  private async advertiseTo(peerId: string, withComplete: boolean) {
    const af = this.host?.getActiveFile();
    if (!af) return;
    try {
      const mtime = await getEffectiveMtime(af.uri, af.bookmark ?? undefined);
      let size = 0;
      try {
        // @ts-ignore
        const { getMetadata } = await import("vaultpeer-file-system");
        const meta = await getMetadata(af.uri, af.bookmark ?? undefined);
        size = meta?.size ?? 0;
      } catch {
        // size is advisory only
      }
      webRTCManager.sendToPeer(peerId, {
        type: SyncMsg.METADATA_INFO,
        filename: af.filename,
        lastModified: mtime,
        size,
      });
      if (withComplete) {
        webRTCManager.sendToPeer(peerId, { type: SyncMsg.METADATA_COMPLETE });
      }
    } catch (e) {
      console.warn(TAG, "advertiseTo failed:", e);
    }
  }

  private async onMetadataInfo(
    peerId: string,
    msg: { filename: string; lastModified: number }
  ) {
    const af = this.host?.getActiveFile();
    if (!af || af.filename !== msg.filename) return;

    // Guard: if we already have a pull in-flight from this peer, ignore
    // duplicate metadata_info messages to prevent sending redundant
    // pull_requests and creating parallel inbound transfers.
    if (this.activePulls.has(peerId)) {
      console.log(
        TAG,
        `Already pulling from ${peerId}, ignoring duplicate metadata_info`
      );
      return;
    }

    try {
      const localMtime = await getEffectiveMtime(
        af.uri,
        af.bookmark ?? undefined
      );
      // Only PULL when the remote is meaningfully newer. We never push here:
      // the peer that is behind receives our metadata_info and pulls from us,
      // which avoids duplicate transfers in both directions.
      if (msg.lastModified - localMtime > LWW_THRESHOLD_MS) {
        this.beginSyncing();
        // Track the pull so deferred advertisement waits for completion.
        this.activePulls.add(peerId);

        const taskId = `${peerId}_${af.filename}_pull`;
        useSyncStore.getState().addToQueue({
          peerId,
          filename: af.filename,
          type: "pull",
          lastModified: msg.lastModified,
          status: "syncing",
        });
        this.startTaskTimeout(taskId, peerId, "pull");

        webRTCManager.sendToPeer(peerId, {
          type: SyncMsg.PULL_REQUEST,
          filename: af.filename,
        });
      } else {
        this.settleIfIdle();
      }
    } catch (e) {
      console.warn(TAG, "onMetadataInfo failed:", e);
    }
  }

  /**
   * Route an incoming pull_request: if we're currently receiving data from
   * this peer (active pull), defer our response to avoid a bidirectional
   * chunked transfer storm that saturates mobile data channels.
   */
  private handleIncomingPullRequest(peerId: string, filename: string) {
    if (this.activePulls.has(peerId)) {
      // We're mid-receive from this peer. Sending chunks back while
      // receiving chunks simultaneously will saturate the data channel
      // on mobile connections. Queue it and serve after our pull completes.
      console.log(
        TAG,
        `Deferring pull_request from ${peerId} — active pull in-flight`
      );
      const queue = this.deferredPullRequests.get(peerId) || [];
      // Only queue if this filename isn't already queued
      if (!queue.includes(filename)) {
        queue.push(filename);
        this.deferredPullRequests.set(peerId, queue);
      }
      return;
    }
    void this.servePullRequest(peerId, filename);
  }

  /**
   * Serve any deferred pull_request from a peer after our pull from them
   * has completed (or timed out).
   */
  private serveDeferredPullRequest(peerId: string) {
    const queue = this.deferredPullRequests.get(peerId);
    if (!queue || queue.length === 0) {
      this.deferredPullRequests.delete(peerId);
      return;
    }
    // Serve the oldest request first (FIFO)
    const filename = queue.shift()!;
    if (queue.length === 0) {
      this.deferredPullRequests.delete(peerId);
    }
    console.log(
      TAG,
      `Serving deferred pull_request to ${peerId} for "${filename}" (${queue?.length ?? 0} remaining)`
    );
    void this.servePullRequest(peerId, filename);
  }

  private async servePullRequest(peerId: string, filename: string) {
    const af = this.host?.getActiveFile();
    if (!af || af.filename !== filename || !this.host) return;

    // Guard: if we're already serving a pull_response to this peer, skip
    // to avoid duplicate parallel transfers.
    if (this.activeServes.has(peerId)) {
      console.log(
        TAG,
        `Already serving pull_response to ${peerId}, skipping duplicate`
      );
      return;
    }

    this.activeServes.add(peerId);
    try {
      const b64 = await this.host.readActiveFileBase64();
      const mtime = await getEffectiveMtime(af.uri, af.bookmark ?? undefined);
      webRTCManager.sendToPeer(peerId, {
        type: SyncMsg.PULL_RESPONSE,
        filename,
        fileData: b64,
        lastModified: mtime,
      });
    } catch (e) {
      console.warn(TAG, "servePullRequest failed:", e);
    } finally {
      this.activeServes.delete(peerId);
    }
  }

  private async applyIncomingFile(peerId: string, msg: FileTransferMessage) {
    const af = this.host?.getActiveFile();
    if (!af || af.filename !== msg.filename || !this.host) return;

    const pullTaskId = `${peerId}_${msg.filename}_pull`;
    const isPull = msg.type === SyncMsg.PULL_RESPONSE;

    const ackPush = (
      status: "success" | "ignored" | "error",
      message: string
    ) => {
      if (msg.type === SyncMsg.PUSH_REQUEST) {
        webRTCManager.sendToPeer(peerId, {
          type: SyncMsg.PUSH_RESPONSE,
          filename: msg.filename,
          status,
          message,
        });
      }
    };

    const sendSyncComplete = (
      status: "success" | "ignored" | "error",
      message: string
    ) => {
      webRTCManager.sendToPeer(peerId, {
        type: SyncMsg.SYNC_COMPLETE,
        filename: msg.filename,
        lastModified: msg.lastModified,
        status,
        message,
      });
    };

    const handlePullComplete = (
      status: "success" | "ignored" | "error",
      errorMsg?: string
    ) => {
      if (isPull) {
        this.clearTaskTimeout(pullTaskId);
        if (status === "success" || status === "ignored") {
          useSyncStore.getState().removeFromQueue(pullTaskId);
        } else {
          useSyncStore
            .getState()
            .updateQueueItemStatus(
              pullTaskId,
              "failed",
              errorMsg || "Failed to pull file"
            );
        }
      }
    };

    try {
      const localMtime = await getEffectiveMtime(
        af.uri,
        af.bookmark ?? undefined
      );

      // LWW: ignore unless the remote is meaningfully newer.
      if (!(msg.lastModified - localMtime > LWW_THRESHOLD_MS)) {
        this.settleIfIdle();
        ackPush("ignored", "Local copy is newer or equal");
        sendSyncComplete("ignored", "Local copy is newer or equal");
        handlePullComplete("ignored");
        this.flushDeferredAdvertise(peerId);
        return;
      }

      const open = this.host.isVaultOpen();

      if (!open) {
        // Safe path: no in-memory state to disturb — write straight to disk.
        // Preserve the revision currently on disk before overwriting it.
        await this.backupCurrentRevision(msg.filename, localMtime);
        const ok = await this.host.writeActiveFileBase64(msg.fileData);
        if (ok) {
          await recordRemoteApply(
            af.uri,
            af.bookmark ?? undefined,
            msg.lastModified
          );
          // Stash this write so that if the vault opens before the next sync
          // round, we can immediately reload from the updated disk file.
          this.stashedDiskWrite = {
            filename: msg.filename,
            remoteMtime: msg.lastModified,
            writtenAt: Date.now(),
          };
          this.settleIfIdle();
          ackPush("success", "Applied to disk");
          sendSyncComplete("success", "Applied to disk");
          handlePullComplete("success");
        } else {
          this.setStatus("error");
          ackPush("error", "Failed to write file");
          sendSyncComplete("error", "Failed to write file");
          handlePullComplete("error", "Failed to write file");
        }
        this.flushDeferredAdvertise(peerId);
        return;
      }

      // Vault is open — never auto-apply over a live database. Hold the payload
      // and let the UI prompt the user (reload if clean, conflict if dirty).
      const dirty = this.host.isVaultDirty();
      useSyncStore.getState().setPendingRemote({
        filename: msg.filename,
        fileData: msg.fileData,
        remoteMtime: msg.lastModified,
        fromPeerId: peerId,
        mode: dirty ? "conflict" : "reload",
      });
      this.settleIfIdle();
      ackPush("success", "Queued for user review");
      sendSyncComplete("success", "Queued for user review");
      handlePullComplete("success");
      this.flushDeferredAdvertise(peerId);
    } catch (e: any) {
      console.warn(TAG, "applyIncomingFile failed:", e);
      this.setStatus("error");
      ackPush("error", "Exception while applying");
      sendSyncComplete("error", "Exception while applying");
      handlePullComplete("error", e?.message || "Exception while applying");
      this.flushDeferredAdvertise(peerId);
    }
  }

  /**
   * After a pull completes (or is skipped), clear the pull-in-flight flag and
   * flush the deferred metadata advertisement if one is waiting.
   */
  private flushDeferredAdvertise(peerId: string) {
    this.activePulls.delete(peerId);
    if (this.pendingAdvertise.delete(peerId)) {
      void this.advertiseTo(peerId, false);
    }
    // Now that our pull is done, serve any deferred pull_request from this peer.
    // This serializes bidirectional transfers: receive first, then send.
    this.serveDeferredPullRequest(peerId);
  }

  /**
   * Copy the revision currently on disk into the user's backup directory before
   * it is overwritten by a pulled/remote file (mirrors the server node's
   * retention-on-pull). Best-effort: never throws and never blocks the pull.
   *
   * @param filename Basename of the active vault file.
   * @param oldMtime Logical clock of the revision being preserved (pre-apply).
   */
  private async backupCurrentRevision(filename: string, oldMtime: number) {
    try {
      // Cheap gate so we don't read the whole file when backups are off.
      const { enabled, dirUri } = useBackupStore.getState();
      if (!enabled || !dirUri || !this.host) return;

      const oldB64 = await this.host.readActiveFileBase64();
      await backupPulledRevision(filename, oldB64, oldMtime);
    } catch (e) {
      console.warn(TAG, "backupCurrentRevision failed:", e);
    }
  }
}

export const syncEngine = new SyncEngine();
