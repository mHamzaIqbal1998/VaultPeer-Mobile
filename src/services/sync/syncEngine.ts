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

import { webRTCManager } from "../webrtc/webRTCManager";
import { useSyncStore } from "../../stores/useSyncStore";
import {
  SyncMsg,
  LWW_THRESHOLD_MS,
  type FileTransferMessage,
} from "./syncProtocol";
import { getEffectiveMtime, recordRemoteApply } from "./syncMetaStore";

const TAG = "[SyncEngine]";

/** How long to keep the "syncing" indicator before settling to "synced". */
const SYNC_TIMEOUT_MS = 5000;

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

class SyncEngine {
  private host: SyncHost | null = null;
  private openChannels = new Set<string>();
  private syncTimeout: ReturnType<typeof setTimeout> | null = null;
  private started = false;

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
      // Settle the indicator if nothing else updated it.
      if (useSyncStore.getState().status === "syncing") {
        useSyncStore.getState().markSynced();
      }
    }, SYNC_TIMEOUT_MS);
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
    // Mirror the server handshake: ask for their files, advertise ours.
    webRTCManager.sendToPeer(peerId, { type: SyncMsg.METADATA_QUERY });
    void this.advertiseTo(peerId, false);
  }

  private onPeerChannelClosed(peerId: string) {
    this.openChannels.delete(peerId);
    this.refreshPeerCount();
    if (this.openChannels.size === 0 && this.host?.getActiveFile()) {
      this.setStatus("offline");
    }
  }

  // ── Public API (called by FilePickerContext) ──

  /** Re-advertise to all peers — call when the active file changes. */
  public onActiveFileChanged() {
    const af = this.host?.getActiveFile();
    if (!af) {
      this.setStatus("idle");
      return;
    }
    if (this.openChannels.size === 0) {
      this.setStatus("offline");
      return;
    }
    this.beginSyncing();
    for (const peerId of this.openChannels) {
      webRTCManager.sendToPeer(peerId, { type: SyncMsg.METADATA_QUERY });
      void this.advertiseTo(peerId, false);
    }
  }

  /** Broadcast a push_request to all peers after a successful local save. */
  public async broadcastLocalChange(
    filename: string,
    fileDataB64: string,
    logicalMtime: number
  ) {
    if (this.openChannels.size === 0) return;
    for (const peerId of this.openChannels) {
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

  // ── Message dispatch ─────────────────────────

  private handlePeerMessage(peerId: string, msg: any) {
    switch (msg?.type) {
      case SyncMsg.METADATA_QUERY:
        void this.advertiseTo(peerId, true);
        break;
      case SyncMsg.METADATA_INFO:
        void this.onMetadataInfo(peerId, msg);
        break;
      case SyncMsg.METADATA_COMPLETE:
        // No-op: nothing to finalize on the mobile side.
        break;
      case SyncMsg.PULL_REQUEST:
        void this.servePullRequest(peerId, msg.filename);
        break;
      case SyncMsg.PULL_RESPONSE:
      case SyncMsg.PUSH_REQUEST:
        void this.applyIncomingFile(peerId, msg as FileTransferMessage);
        break;
      case SyncMsg.PUSH_RESPONSE:
        // Acknowledgement of our push — nothing required.
        break;
      default:
        break;
    }
  }

  // ── Handlers ─────────────────────────────────

  private async advertiseTo(peerId: string, withComplete: boolean) {
    const af = this.host?.getActiveFile();
    if (!af) return;
    try {
      const mtime = await getEffectiveMtime(af.uri, af.bookmark ?? undefined);
      let size = 0;
      try {
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
        webRTCManager.sendToPeer(peerId, {
          type: SyncMsg.PULL_REQUEST,
          filename: af.filename,
        });
      } else {
        useSyncStore.getState().markSynced();
      }
    } catch (e) {
      console.warn(TAG, "onMetadataInfo failed:", e);
    }
  }

  private async servePullRequest(peerId: string, filename: string) {
    const af = this.host?.getActiveFile();
    if (!af || af.filename !== filename || !this.host) return;
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
    }
  }

  private async applyIncomingFile(peerId: string, msg: FileTransferMessage) {
    const af = this.host?.getActiveFile();
    if (!af || af.filename !== msg.filename || !this.host) return;

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

    try {
      const localMtime = await getEffectiveMtime(
        af.uri,
        af.bookmark ?? undefined
      );

      // LWW: ignore unless the remote is meaningfully newer.
      if (!(msg.lastModified - localMtime > LWW_THRESHOLD_MS)) {
        useSyncStore.getState().markSynced();
        ackPush("ignored", "Local copy is newer or equal");
        return;
      }

      const open = this.host.isVaultOpen();

      if (!open) {
        // Safe path: no in-memory state to disturb — write straight to disk.
        const ok = await this.host.writeActiveFileBase64(msg.fileData);
        if (ok) {
          await recordRemoteApply(
            af.uri,
            af.bookmark ?? undefined,
            msg.lastModified
          );
          useSyncStore.getState().markSynced();
          ackPush("success", "Applied to disk");
        } else {
          this.setStatus("error");
          ackPush("error", "Failed to write file");
        }
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
      useSyncStore.getState().markSynced();
      ackPush("success", "Queued for user review");
    } catch (e) {
      console.warn(TAG, "applyIncomingFile failed:", e);
      this.setStatus("error");
      ackPush("error", "Exception while applying");
    }
  }
}

export const syncEngine = new SyncEngine();
