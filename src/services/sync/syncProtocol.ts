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
 *
 * Large payloads (pull_response / push_request) are split into:
 *   file_chunk_start { transferId, filename, totalChunks, lastModified, msgType }
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

// ────────────────────────────────────────────
// Chunking (send side)
// ────────────────────────────────────────────

/**
 * Split a file-bearing message into an ordered list of raw chunk messages
 * (start, …chunks, end) ready to be sent sequentially over a data channel.
 */
export function createChunkMessages(msg: {
  type: string;
  filename: string;
  fileData?: string;
  lastModified?: number;
}): Record<string, unknown>[] {
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
  lastModified: number;
  msgType: string;
  chunks: (string | undefined)[];
}

/**
 * Buffers incoming chunk messages and reassembles them into a complete
 * file-bearing message. Tracks multiple concurrent transfers by transferId.
 *
 * One instance should be kept per peer (or globally keyed by transferId, which
 * is already unique). Returns the assembled message on `file_chunk_end`, or
 * `null` while a transfer is still in progress / for non-chunk messages.
 */
export class ChunkReassembler {
  private transfers = new Map<string, ActiveTransfer>();

  /**
   * Feed a parsed chunk message.
   * @returns the assembled {@link FileTransferMessage} when complete, else null.
   */
  public handleChunkMessage(
    msg: Record<string, any>
  ): FileTransferMessage | null {
    switch (msg.type) {
      case SyncMsg.FILE_CHUNK_START: {
        this.transfers.set(msg.transferId, {
          filename: msg.filename,
          totalChunks: msg.totalChunks,
          lastModified: msg.lastModified,
          msgType: msg.msgType,
          chunks: new Array(msg.totalChunks),
        });
        return null;
      }

      case SyncMsg.FILE_CHUNK: {
        const transfer = this.transfers.get(msg.transferId);
        if (transfer) {
          transfer.chunks[msg.chunkIndex] = msg.chunkData;
        }
        return null;
      }

      case SyncMsg.FILE_CHUNK_END: {
        const transfer = this.transfers.get(msg.transferId);
        if (!transfer) return null;
        this.transfers.delete(msg.transferId);

        const received = transfer.chunks.filter((c) => c !== undefined).length;
        if (received !== transfer.totalChunks) {
          // Incomplete transfer — drop it.
          return null;
        }

        return {
          type: transfer.msgType as "pull_response" | "push_request",
          filename: transfer.filename,
          fileData: transfer.chunks.join(""),
          lastModified: transfer.lastModified,
        };
      }

      default:
        return null;
    }
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
