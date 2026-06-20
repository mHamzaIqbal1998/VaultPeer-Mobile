/**
 * syncProtocol — Wire protocol for KDBX file synchronization over WebRTC data channels.
 *
 * This MUST stay compatible with the server node implementation
 * (servernode-code/src/index.js + webrtc.js). Message shapes and the chunking
 * scheme mirror the server exactly so a mobile peer can sync with a server node,
 * another mobile app, or any compatible peer.
 *
 * Message flow:
 *   metadata_query   → ask a peer for its file metadata
 *   metadata_info    → advertise our file metadata { filename, lastModified, size }
 *   metadata_complete→ signals end of a metadata_info batch (sent after a query)
 *   pull_request     → ask a peer to send a file { filename }
 *   pull_response    → carries the base64 KDBX file (CHUNKED) { filename, fileData, lastModified }
 *   push_request     → proactively push a file (CHUNKED) { filename, fileData, lastModified }
 *   push_response    → ack a push { filename, status, message }
 *   transfer_nack    → receiver reports failed reassembly { transferId, filename, reason }
 *   dc_ping / dc_pong→ data channel heartbeat keep-alive
 *
 * Large payloads (pull_response / push_request) are split into:
 *   file_chunk_start { transferId, filename, totalChunks, lastModified, msgType, sha256 }
 *   file_chunk       { transferId, chunkIndex, chunkData }
 *   file_chunk_end   { transferId }
 */

// ────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────

/** Chunk size in base64 characters — MUST match the server (16 KB). */
export const CHUNK_SIZE = 16384;

/**
 * Last-Write-Wins threshold in milliseconds. A remote file is only considered
 * "newer" when it exceeds the local mtime by more than this, which absorbs
 * minor clock skew between peers. MUST match the server (`> 1000`).
 */
export const LWW_THRESHOLD_MS = 1000;

/**
 * Stale transfer cleanup timeout (ms). If no chunks arrive for a transfer
 * within this window, the partial transfer is discarded to prevent memory leaks.
 */
export const STALE_TRANSFER_TIMEOUT_MS = 30_000;

export const SyncMsg = {
  METADATA_QUERY: "metadata_query",
  METADATA_INFO: "metadata_info",
  METADATA_COMPLETE: "metadata_complete",
  PULL_REQUEST: "pull_request",
  PULL_RESPONSE: "pull_response",
  PUSH_REQUEST: "push_request",
  PUSH_RESPONSE: "push_response",
  FILE_CHUNK_START: "file_chunk_start",
  FILE_CHUNK: "file_chunk",
  FILE_CHUNK_END: "file_chunk_end",
  SYNC_COMPLETE: "sync_complete",
  TRANSFER_NACK: "transfer_nack",
  DC_PING: "dc_ping",
  DC_PONG: "dc_pong",
} as const;

/** Message types whose `fileData` payload must be transmitted in chunks. */
const CHUNKED_TYPES = new Set<string>([
  SyncMsg.PULL_RESPONSE,
  SyncMsg.PUSH_REQUEST,
]);

export function isChunkedType(type: string): boolean {
  return CHUNKED_TYPES.has(type);
}

// ────────────────────────────────────────────
// Message Types
// ────────────────────────────────────────────

export interface MetadataInfoMessage {
  type: "metadata_info";
  filename: string;
  lastModified: number;
  size: number;
}

export interface PullRequestMessage {
  type: "pull_request";
  filename: string;
}

/** A file-bearing message (pull_response / push_request) after reassembly. */
export interface FileTransferMessage {
  type: "pull_response" | "push_request";
  filename: string;
  fileData: string; // base64
  lastModified: number;
}

export interface PushResponseMessage {
  type: "push_response";
  filename: string;
  status: "success" | "ignored" | "error";
  message: string;
}

export interface SyncCompleteMessage {
  type: "sync_complete";
  filename: string;
  lastModified: number;
  status: "success" | "ignored" | "error";
  message?: string;
}

export interface TransferNackMessage {
  type: "transfer_nack";
  transferId: string;
  filename: string;
  reason: string;
}

// ────────────────────────────────────────────
// SHA-256 Hashing (platform-agnostic)
// ────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a string. Uses expo-crypto on React Native,
 * falls back to Node.js crypto for server environments.
 */
export async function computeSHA256(data: string): Promise<string> {
  try {
    // Try expo-crypto first (React Native)
    const ExpoCrypto = require("expo-crypto");
    return await ExpoCrypto.digestStringAsync(
      ExpoCrypto.CryptoDigestAlgorithm.SHA256,
      data
    );
  } catch {
    // Fallback for Node.js (server node)
    try {
      const crypto = require("crypto");
      return crypto.createHash("sha256").update(data).digest("hex");
    } catch {
      // If neither is available, return empty (skip verification)
      return "";
    }
  }
}

// ────────────────────────────────────────────
// Chunking (send side)
// ────────────────────────────────────────────

/**
 * Split a file-bearing message into an ordered list of raw chunk messages
 * (start, …chunks, end) ready to be sent sequentially over a data channel.
 *
 * @param sha256 - Pre-computed SHA-256 hash of `msg.fileData` for integrity
 *   verification. Pass empty string to skip (backward-compatible).
 */
export function createChunkMessages(
  msg: {
    type: string;
    filename: string;
    fileData?: string;
    lastModified?: number;
  },
  sha256: string = ""
): Record<string, unknown>[] {
  const fileData = msg.fileData || "";
  const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE);
  const transferId = `${msg.type}_${Date.now()}_${Math.floor(
    Math.random() * 1000
  )}`;

  const messages: Record<string, unknown>[] = [];

  messages.push({
    type: SyncMsg.FILE_CHUNK_START,
    transferId,
    filename: msg.filename,
    totalChunks,
    lastModified: msg.lastModified,
    msgType: msg.type,
    sha256, // empty string = no verification (backward compat)
  });

  for (let i = 0; i < totalChunks; i++) {
    messages.push({
      type: SyncMsg.FILE_CHUNK,
      transferId,
      chunkIndex: i,
      chunkData: fileData.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
    });
  }

  messages.push({
    type: SyncMsg.FILE_CHUNK_END,
    transferId,
  });

  return messages;
}

// ────────────────────────────────────────────
// Reassembly (receive side)
// ────────────────────────────────────────────

interface ActiveTransfer {
  filename: string;
  totalChunks: number;
  receivedCount: number;
  lastModified: number;
  msgType: string;
  sha256: string;
  chunks: (string | undefined)[];
  /** Timestamp of last chunk activity — used for stale transfer cleanup. */
  lastActivity: number;
}

/** Result of reassembly: either a successful message or a failure with reason. */
export type ReassemblyResult =
  | { ok: true; message: FileTransferMessage }
  | { ok: false; transferId: string; filename: string; reason: string };

/**
 * Buffers incoming chunk messages and reassembles them into a complete
 * file-bearing message. Tracks multiple concurrent transfers by transferId.
 *
 * One instance should be kept per peer (or globally keyed by transferId, which
 * is already unique). Returns the assembled message on `file_chunk_end`, or
 * `null` while a transfer is still in progress / for non-chunk messages.
 *
 * Now includes:
 * - SHA-256 integrity verification (when hash is provided)
 * - Stale transfer cleanup (30s inactivity timeout)
 * - Progress tracking (received/total chunk counts)
 */
export class ChunkReassembler {
  private transfers = new Map<string, ActiveTransfer>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodically clean up stale transfers
    this.cleanupTimer = setInterval(
      () => this.cleanupStaleTransfers(),
      STALE_TRANSFER_TIMEOUT_MS / 2
    );
  }

  /**
   * Feed a parsed chunk message.
   * @returns the assembled {@link FileTransferMessage} when complete,
   *   a failure result if reassembly failed, or null while in progress.
   */
  public handleChunkMessage(msg: Record<string, any>): ReassemblyResult | null {
    switch (msg.type) {
      case SyncMsg.FILE_CHUNK_START: {
        // If there's already a transfer with the same ID, discard the old one
        // (sender restarted)
        this.transfers.set(msg.transferId, {
          filename: msg.filename,
          totalChunks: msg.totalChunks,
          receivedCount: 0,
          lastModified: msg.lastModified,
          msgType: msg.msgType,
          sha256: msg.sha256 || "",
          chunks: new Array(msg.totalChunks),
          lastActivity: Date.now(),
        });
        return null;
      }

      case SyncMsg.FILE_CHUNK: {
        const transfer = this.transfers.get(msg.transferId);
        if (transfer) {
          if (transfer.chunks[msg.chunkIndex] === undefined) {
            transfer.receivedCount++;
          }
          transfer.chunks[msg.chunkIndex] = msg.chunkData;
          transfer.lastActivity = Date.now();
        }
        return null;
      }

      case SyncMsg.FILE_CHUNK_END: {
        const transfer = this.transfers.get(msg.transferId);
        if (!transfer) return null;
        this.transfers.delete(msg.transferId);

        // Check completeness
        if (transfer.receivedCount !== transfer.totalChunks) {
          const missing = transfer.totalChunks - transfer.receivedCount;
          return {
            ok: false,
            transferId: msg.transferId,
            filename: transfer.filename,
            reason: `Incomplete: ${missing}/${transfer.totalChunks} chunks missing`,
          };
        }

        const fileData = transfer.chunks.join("");

        // SHA-256 integrity check is deferred to the caller via
        // verifyIntegrity() since hashing may be async.
        return {
          ok: true,
          message: {
            type: transfer.msgType as "pull_response" | "push_request",
            filename: transfer.filename,
            fileData,
            lastModified: transfer.lastModified,
          },
        };
      }

      default:
        return null;
    }
  }

  /**
   * Verify the integrity of a reassembled message against the expected hash.
   * Returns true if the hash matches or no hash was provided (backward compat).
   */
  public async verifyIntegrity(
    fileData: string,
    expectedHash: string
  ): Promise<boolean> {
    if (!expectedHash) return true; // No hash provided, skip check
    const actualHash = await computeSHA256(fileData);
    if (!actualHash) return true; // Hashing not available, skip check
    return actualHash === expectedHash;
  }

  /**
   * Get the expected SHA-256 hash for a transfer (from the file_chunk_start).
   * Must be called after file_chunk_start but before file_chunk_end cleanup.
   */
  public getTransferHash(transferId: string): string {
    return this.transfers.get(transferId)?.sha256 || "";
  }

  /**
   * Get progress for a specific transfer.
   * @returns { received, total, percent } or null if no such transfer.
   */
  public getProgress(
    transferId: string
  ): { received: number; total: number; percent: number } | null {
    const transfer = this.transfers.get(transferId);
    if (!transfer) return null;
    return {
      received: transfer.receivedCount,
      total: transfer.totalChunks,
      percent:
        transfer.totalChunks > 0
          ? Math.round((transfer.receivedCount / transfer.totalChunks) * 100)
          : 0,
    };
  }

  /**
   * Get aggregated progress across all active transfers.
   */
  public getAggregatedProgress(): {
    activeTransfers: number;
    totalChunks: number;
    receivedChunks: number;
    percent: number;
  } {
    let totalChunks = 0;
    let receivedChunks = 0;
    for (const transfer of this.transfers.values()) {
      totalChunks += transfer.totalChunks;
      receivedChunks += transfer.receivedCount;
    }
    return {
      activeTransfers: this.transfers.size,
      totalChunks,
      receivedChunks,
      percent:
        totalChunks > 0 ? Math.round((receivedChunks / totalChunks) * 100) : 0,
    };
  }

  /** Whether a message type is one of the chunk envelope types. */
  public static isChunkMessage(type: string): boolean {
    return (
      type === SyncMsg.FILE_CHUNK_START ||
      type === SyncMsg.FILE_CHUNK ||
      type === SyncMsg.FILE_CHUNK_END
    );
  }

  /** Discard any in-flight transfers (e.g. on peer disconnect). */
  public reset() {
    this.transfers.clear();
  }

  /** Clean up the periodic timer (call on shutdown). */
  public destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.transfers.clear();
  }

  /**
   * Remove transfers that haven't received any chunk activity within
   * STALE_TRANSFER_TIMEOUT_MS. Prevents memory leaks from crashed senders.
   */
  private cleanupStaleTransfers() {
    const now = Date.now();
    for (const [transferId, transfer] of this.transfers) {
      if (now - transfer.lastActivity > STALE_TRANSFER_TIMEOUT_MS) {
        console.warn(
          `[ChunkReassembler] Cleaning up stale transfer ${transferId} ` +
            `for "${transfer.filename}" (${transfer.receivedCount}/${transfer.totalChunks} chunks, ` +
            `inactive for ${Math.round((now - transfer.lastActivity) / 1000)}s)`
        );
        this.transfers.delete(transferId);
      }
    }
  }
}

/** Extract the basename (e.g. "Passwords.kdbx") from a file URI. */
export function basenameFromUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const parts = decoded.split(/[/\\]/);
    let last = parts[parts.length - 1] || "";
    if (last.includes(":")) {
      const sub = last.split(":");
      last = sub[sub.length - 1];
    }
    return last || "vault.kdbx";
  } catch {
    return "vault.kdbx";
  }
}
