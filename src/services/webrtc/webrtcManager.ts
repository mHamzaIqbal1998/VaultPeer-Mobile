import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
} from "react-native-webrtc";
import * as SecureStore from "expo-secure-store";
import * as kdbxweb from "kdbxweb";
import { AppState, AppStateStatus } from "react-native";
import { readFile, writeFile, getFilenameFromUri } from "vaultpeer-file-system";
import {
  useSignalingStore,
  sendSignalingMessage,
  registerSignalingMessageListener,
  WebrtcSyncStatus,
} from "../../stores/useSignalingStore";
import { useVaultStore } from "../../stores/useVaultStore";
import { getLkm, setLkm } from "./lkmStore";
import { base64ToArrayBuffer } from "../base64";

const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

const peerConnections = new Map<string, RTCPeerConnection>();
const dataChannels = new Map<string, any>();

let syncTimeoutTimer: any = null;

function clearSyncTimeout() {
  if (syncTimeoutTimer) {
    clearTimeout(syncTimeoutTimer);
    syncTimeoutTimer = null;
  }
}

function setSyncStatus(status: WebrtcSyncStatus, error: string | null = null) {
  console.log(
    `[WebRTC] Sync status changed to: ${status}${error ? ` (Error: ${error})` : ""}`
  );
  useSignalingStore.getState().setWebrtcSyncStatus(status, error);

  // Clear timeout on terminal or progress states
  if (
    status === "synced" ||
    status === "up_to_date" ||
    status === "error" ||
    status === "idle"
  ) {
    clearSyncTimeout();
  }
}

function validateKdbxSignature(arrayBuffer: ArrayBuffer) {
  if (arrayBuffer.byteLength < 8) {
    throw new Error("Invalid vault file: File is too small.");
  }
  const view = new DataView(arrayBuffer);
  const magic = view.getUint32(0, true);
  const magic2 = view.getUint32(4, true);
  if (
    magic !== 0x9aa2d903 ||
    (magic2 !== 0xb54bfb67 && magic2 !== 0xb54bfb65)
  ) {
    throw new Error("Invalid vault file: Not a KeePass database.");
  }
}

function getFileNameFromUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const parts = decoded.split(/[/\\]/);
    const lastPart = parts[parts.length - 1];
    if (lastPart.includes(":")) {
      const subParts = lastPart.split(":");
      return subParts[subParts.length - 1] || "vault.kdbx";
    }
    return lastPart || "vault.kdbx";
  } catch {
    return "vault.kdbx";
  }
}

/**
 * Handle incoming WebRTC signaling messages from the signaling server
 */
export async function handleSignalingMessage(message: any) {
  const { type, senderId, targetId } = message;
  const myId = useSignalingStore.getState().myId;

  // Ignore messages from ourselves
  if (senderId === myId) return;

  // Ignore targeted messages not meant for us
  if (targetId && targetId !== myId) return;

  try {
    switch (type) {
      case "announce":
        // Handle presence/announce message
        if (myId > senderId) {
          // Offerer / Impolite peer: initiate peer connection
          console.log(
            `[WebRTC] Initiating offer to peer ${senderId} (myId > senderId)`
          );
          await createPeerConnection(senderId, true);
        } else {
          // Answerer / Polite peer: reply with targeted announce to initiate connection
          if (!targetId) {
            console.log(
              `[WebRTC] Replying with targeted announce to peer ${senderId}`
            );
            sendSignalingMessage({
              type: "announce",
              senderId: myId,
              targetId: senderId,
            });
          }
        }
        break;

      case "offer":
        console.log(`[WebRTC] Received offer from peer ${senderId}`);
        await handleOffer(senderId, message);
        break;

      case "answer":
        console.log(`[WebRTC] Received answer from peer ${senderId}`);
        await handleAnswer(senderId, message);
        break;

      case "candidate":
        console.log(`[WebRTC] Received ICE candidate from peer ${senderId}`);
        await handleIceCandidate(senderId, message);
        break;

      default:
        break;
    }
  } catch (error) {
    console.error("[WebRTC] Error handling signaling message:", error);
  }
}

/**
 * Create a peer connection with a specific peer
 */
async function createPeerConnection(remoteId: string, isOfferer: boolean) {
  setSyncStatus("connecting_peers");
  // Clean up any existing connection first
  cleanupPeer(remoteId);

  console.log(
    `[WebRTC] Creating peer connection for ${remoteId} (offerer: ${isOfferer})`
  );
  const pc: any = new RTCPeerConnection(configuration);
  peerConnections.set(remoteId, pc);

  // Exchange ICE candidates
  pc.onicecandidate = (event: any) => {
    if (event.candidate) {
      const myId = useSignalingStore.getState().myId;
      sendSignalingMessage({
        type: "candidate",
        senderId: myId,
        targetId: remoteId,
        candidate: event.candidate.candidate, // Headless format (string)
        mid: event.candidate.sdpMid || "0", // Headless format
        sdpMid: event.candidate.sdpMid || "0",
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? 0,
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(
      `[WebRTC] Connection to ${remoteId} changed state to: ${pc.connectionState}`
    );
    if (
      pc.connectionState === "disconnected" ||
      pc.connectionState === "failed" ||
      pc.connectionState === "closed"
    ) {
      cleanupPeer(remoteId);
    }
  };

  if (isOfferer) {
    // Offerer creates the data channel
    const channel = pc.createDataChannel("vault-sync");
    setupDataChannel(remoteId, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const myId = useSignalingStore.getState().myId;
    sendSignalingMessage({
      type: "offer",
      senderId: myId,
      targetId: remoteId,
      sdp: offer.sdp, // Headless format
      offer: {
        // Mobile format
        type: "offer",
        sdp: offer.sdp,
      },
    });
  } else {
    // Answerer listens for data channel
    pc.ondatachannel = (event: any) => {
      if (event.channel.label === "vault-sync") {
        setupDataChannel(remoteId, event.channel);
      }
    };
  }
}

/**
 * Handle WebRTC connection offer
 */
async function handleOffer(remoteId: string, message: any) {
  await createPeerConnection(remoteId, false);
  const pc = peerConnections.get(remoteId);
  if (!pc) return;

  let sdpString = "";
  if (typeof message.sdp === "string") {
    sdpString = message.sdp;
  } else if (message.offer) {
    if (typeof message.offer === "string") {
      sdpString = message.offer;
    } else if (typeof message.offer.sdp === "string") {
      sdpString = message.offer.sdp;
    }
  }

  const offerObj = {
    type: "offer" as const,
    sdp: sdpString,
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offerObj));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  const myId = useSignalingStore.getState().myId;
  sendSignalingMessage({
    type: "answer",
    senderId: myId,
    targetId: remoteId,
    sdp: answer.sdp, // Headless format
    answer: {
      // Mobile format
      type: "answer",
      sdp: answer.sdp,
    },
  });
}

/**
 * Handle WebRTC connection answer
 */
async function handleAnswer(remoteId: string, message: any) {
  const pc = peerConnections.get(remoteId);
  if (!pc) return;

  let sdpString = "";
  if (typeof message.sdp === "string") {
    sdpString = message.sdp;
  } else if (message.answer) {
    if (typeof message.answer === "string") {
      sdpString = message.answer;
    } else if (typeof message.answer.sdp === "string") {
      sdpString = message.answer.sdp;
    }
  }

  const answerObj = {
    type: "answer" as const,
    sdp: sdpString,
  };

  await pc.setRemoteDescription(new RTCSessionDescription(answerObj));
}

/**
 * Handle incoming ICE candidate
 */
async function handleIceCandidate(remoteId: string, message: any) {
  const pc = peerConnections.get(remoteId);
  if (!pc) return;

  let candStr = "";
  let sdpMid: string | null = null;
  let sdpMLineIndex: number | null = null;

  if (message.candidate) {
    if (typeof message.candidate === "string") {
      candStr = message.candidate;
      sdpMid = message.mid || message.sdpMid || "0";
      sdpMLineIndex =
        typeof message.sdpMLineIndex === "number" ? message.sdpMLineIndex : 0;
    } else if (typeof message.candidate === "object") {
      candStr = message.candidate.candidate || "";
      sdpMid = message.candidate.sdpMid || message.mid || message.sdpMid || "0";
      sdpMLineIndex =
        typeof message.candidate.sdpMLineIndex === "number"
          ? message.candidate.sdpMLineIndex
          : typeof message.sdpMLineIndex === "number"
            ? message.sdpMLineIndex
            : 0;
    }
  }

  if (!candStr) return;

  const candidateObj = {
    candidate: candStr,
    sdpMid: sdpMid,
    sdpMLineIndex: sdpMLineIndex,
  };

  await pc.addIceCandidate(new RTCIceCandidate(candidateObj));
}

interface ActiveTransfer {
  filename: string;
  totalChunks: number;
  lastModified: number;
  msgType: string;
  chunks: string[];
}
const activeTransfers = new Map<string, ActiveTransfer>();

/**
 * Helper to safely send a JSON message raw over RTCDataChannel.
 */
function sendRaw(channel: any, message: any, label: string): boolean {
  if (!channel) {
    console.error(
      `[WebRTC] [${label}] Cannot send raw, channel is null/undefined`
    );
    return false;
  }
  const payload = JSON.stringify(message);
  if (channel.readyState !== "open") {
    console.error(
      `[WebRTC] [${label}] Cannot send raw, channel readyState is: ${channel.readyState}`
    );
    return false;
  }
  try {
    channel.send(payload);
    return true;
  } catch (err: any) {
    console.error(
      `[WebRTC] [${label}] Error in channel.send raw:`,
      err?.message || err
    );
    return false;
  }
}

/**
 * Helper to split a large message and send it in chunks.
 */
function sendChunked(
  channel: any,
  message: any,
  label: string,
  sendFn: (chan: any, msg: any, lbl: string) => boolean
): boolean {
  const fileData = message.fileData || "";
  const chunkSize = 16384; // 16 KB chunks
  const totalChunks = Math.ceil(fileData.length / chunkSize);
  const transferId = `${message.type}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  console.log(
    `[WebRTC] [${label}] Starting chunked transfer ${transferId} of type ${message.type}. Total length: ${fileData.length}, chunks: ${totalChunks}`
  );

  // 1. Send start
  const startMsg = {
    type: "file_chunk_start",
    transferId,
    filename: message.filename,
    totalChunks,
    lastModified: message.lastModified,
    msgType: message.type,
  };
  if (!sendFn(channel, startMsg, label)) {
    console.error(
      `[WebRTC] [${label}] Failed to send chunk_start for transfer ${transferId}`
    );
    return false;
  }

  // 2. Send chunks
  for (let i = 0; i < totalChunks; i++) {
    const chunkData = fileData.substring(i * chunkSize, (i + 1) * chunkSize);
    const chunkMsg = {
      type: "file_chunk",
      transferId,
      chunkIndex: i,
      chunkData,
    };
    if (!sendFn(channel, chunkMsg, label)) {
      console.error(
        `[WebRTC] [${label}] Failed to send chunk ${i} for transfer ${transferId}`
      );
      return false;
    }
  }

  // 3. Send end
  const endMsg = {
    type: "file_chunk_end",
    transferId,
  };
  if (!sendFn(channel, endMsg, label)) {
    console.error(
      `[WebRTC] [${label}] Failed to send chunk_end for transfer ${transferId}`
    );
    return false;
  }

  console.log(
    `[WebRTC] [${label}] Finished sending all chunks for transfer ${transferId}`
  );
  return true;
}

/**
 * Helper to safely send a JSON message over a RTCDataChannel, logging status and catching errors.
 */
function sendOverDataChannel(
  channel: any,
  message: any,
  label: string = "DataChannel"
): boolean {
  if (!channel) {
    console.error(`[WebRTC] [${label}] Cannot send, channel is null/undefined`);
    return false;
  }

  if (message.type === "pull_response" || message.type === "push_request") {
    return sendChunked(channel, message, label, sendRaw);
  }

  const payload = JSON.stringify(message);
  console.log(
    `[WebRTC] [${label}] Sending message type: ${message.type}, readyState: ${channel.readyState}, bufferedAmount: ${channel.bufferedAmount}`
  );

  if (channel.readyState !== "open") {
    console.error(
      `[WebRTC] [${label}] Cannot send, channel readyState is: ${channel.readyState}`
    );
    return false;
  }
  try {
    channel.send(payload);
    console.log(
      `[WebRTC] [${label}] Send successful. Current bufferedAmount: ${channel.bufferedAmount}`
    );
    return true;
  } catch (err: any) {
    console.error(
      `[WebRTC] [${label}] Error in channel.send:`,
      err?.message || err
    );
    return false;
  }
}

/**
 * Helper to reassemble chunked file messages.
 */
async function handleChunkMessage(
  remoteId: string,
  channel: any,
  message: any
) {
  if (message.type === "file_chunk_start") {
    console.log(
      `[WebRTC] [${remoteId}] Received file_chunk_start for transfer ${message.transferId}, total chunks: ${message.totalChunks}`
    );
    activeTransfers.set(message.transferId, {
      filename: message.filename,
      totalChunks: message.totalChunks,
      lastModified: message.lastModified,
      msgType: message.msgType,
      chunks: new Array(message.totalChunks),
    });
    return;
  }

  if (message.type === "file_chunk") {
    const transfer = activeTransfers.get(message.transferId);
    if (transfer) {
      transfer.chunks[message.chunkIndex] = message.chunkData;
    } else {
      console.warn(
        `[WebRTC] [${remoteId}] Received chunk for unknown transfer ${message.transferId}`
      );
    }
    return;
  }

  if (message.type === "file_chunk_end") {
    console.log(
      `[WebRTC] [${remoteId}] Received file_chunk_end for transfer ${message.transferId}`
    );
    const transfer = activeTransfers.get(message.transferId);
    if (transfer) {
      activeTransfers.delete(message.transferId);
      const isComplete =
        transfer.chunks.filter((c) => c !== undefined).length ===
        transfer.totalChunks;
      if (!isComplete) {
        console.error(
          `[WebRTC] [${remoteId}] Transfer ${message.transferId} incomplete. Some chunks are missing.`
        );
        return;
      }
      const fullData = transfer.chunks.join("");
      const assembledMessage = {
        type: transfer.msgType,
        filename: transfer.filename,
        fileData: fullData,
        lastModified: transfer.lastModified,
      };
      console.log(
        `[WebRTC] [${remoteId}] Reassembled message type ${transfer.msgType} successfully. Size: ${fullData.length}`
      );
      await handleChannelMessage(remoteId, channel, assembledMessage);
    } else {
      console.warn(
        `[WebRTC] [${remoteId}] Received chunk_end for unknown transfer ${message.transferId}`
      );
    }
    return;
  }
}

/**
 * Setup data channel event listeners for message exchanging
 */
function setupDataChannel(remoteId: string, channel: any) {
  dataChannels.set(remoteId, channel);

  channel.onopen = async () => {
    console.log(`[WebRTC] Data channel with ${remoteId} is now OPEN`);
    setSyncStatus("checking_updates");

    // Symmetric Sync trigger upon connection establishment
    try {
      const fileUri = await SecureStore.getItemAsync("vault_file_uri");
      console.log(
        `[WebRTC] Data channel onopen with ${remoteId}, fileUri in SecureStore: ${fileUri}`
      );
      if (fileUri) {
        const localLkm = await getLkm(fileUri);
        const filename =
          (await SecureStore.getItemAsync("vault_file_name")) ||
          getFileNameFromUri(fileUri);
        console.log(
          `[WebRTC] Data channel onopen with ${remoteId}, localLkm: ${localLkm}, filename: ${filename}`
        );

        // Request remote metadata
        sendOverDataChannel(channel, { type: "metadata_query" }, remoteId);

        // Share local metadata
        sendOverDataChannel(
          channel,
          {
            type: "metadata_info",
            filename,
            lastModified: localLkm,
            size: 0,
          },
          remoteId
        );
      } else {
        console.warn(
          `[WebRTC] Data channel onopen with ${remoteId} but no vault_file_uri found in SecureStore`
        );
      }
    } catch (err: any) {
      console.error(
        `[WebRTC] Error in data channel onopen with ${remoteId}:`,
        err
      );
    }
  };

  channel.onclose = () => {
    console.log(`[WebRTC] Data channel with ${remoteId} is CLOSED`);
    cleanupPeer(remoteId);
  };

  channel.onerror = (error: any) => {
    console.error(`[WebRTC] Data channel error with ${remoteId}:`, error);
  };

  channel.onmessage = async (event: any) => {
    try {
      const message = JSON.parse(event.data);
      if (
        message.type === "file_chunk_start" ||
        message.type === "file_chunk" ||
        message.type === "file_chunk_end"
      ) {
        await handleChunkMessage(remoteId, channel, message);
      } else {
        await handleChannelMessage(remoteId, channel, message);
      }
    } catch (e) {
      console.error("[WebRTC] Failed to handle data channel message:", e);
    }
  };
}

/**
 * Process a message received over a data channel
 */
async function handleChannelMessage(
  remoteId: string,
  channel: any,
  message: any
) {
  const fileUri = await SecureStore.getItemAsync("vault_file_uri");
  const bookmark =
    (await SecureStore.getItemAsync("vault_file_bookmark")) || "";
  const localLkm = fileUri ? await getLkm(fileUri) : 0;
  const filename = fileUri
    ? (await SecureStore.getItemAsync("vault_file_name")) ||
      getFileNameFromUri(fileUri)
    : "vault.kdbx";

  switch (message.type) {
    case "metadata_query":
      console.log(`[WebRTC] Received metadata_query from ${remoteId}`);
      if (fileUri) {
        sendOverDataChannel(
          channel,
          {
            type: "metadata_info",
            filename,
            lastModified: localLkm,
            size: 0,
          },
          remoteId
        );
      }
      sendOverDataChannel(
        channel,
        {
          type: "metadata_complete",
        },
        remoteId
      );
      break;

    case "metadata_complete":
      console.log(`[WebRTC] Received metadata_complete from ${remoteId}`);
      if (
        useSignalingStore.getState().webrtcSyncStatus === "checking_updates" ||
        useSignalingStore.getState().webrtcSyncStatus === "connecting_peers"
      ) {
        console.log(
          "[WebRTC] Peer metadata exchange complete. No updates found."
        );
        setSyncStatus("up_to_date");
        setTimeout(() => {
          if (useSignalingStore.getState().webrtcSyncStatus === "up_to_date") {
            setSyncStatus("idle");
          }
        }, 3000);
      }
      break;

    case "metadata_info":
      console.log(
        `[WebRTC] Received metadata_info from ${remoteId} for "${message.filename}". Local LKM: ${localLkm}, Remote LKM: ${message.lastModified}`
      );
      if (fileUri && message.filename === filename) {
        if (message.lastModified - localLkm > 1000) {
          console.log(
            `[WebRTC] Remote database is newer. Requesting pull from ${remoteId}...`
          );
          setSyncStatus("pulling");
          sendOverDataChannel(
            channel,
            {
              type: "pull_request",
              filename,
            },
            remoteId
          );
        } else if (localLkm - message.lastModified > 1000 && localLkm > 0) {
          console.log(
            `[WebRTC] Local database is newer. Pushing update to ${remoteId}...`
          );
          setSyncStatus("pushing");
          try {
            const fileData = await readFile(fileUri, bookmark);
            sendOverDataChannel(
              channel,
              {
                type: "push_request",
                filename,
                fileData,
                lastModified: localLkm,
              },
              remoteId
            );
          } catch (err) {
            console.error("[WebRTC] Failed to read database for push:", err);
            setSyncStatus("error", "Failed to push: " + String(err));
          }
        } else {
          console.log(`[WebRTC] Database is up-to-date with ${remoteId}`);
          setSyncStatus("up_to_date");
          setTimeout(() => {
            if (
              useSignalingStore.getState().webrtcSyncStatus === "up_to_date"
            ) {
              setSyncStatus("idle");
            }
          }, 3000);
        }
      }
      break;

    case "pull_request":
      console.log(
        `[WebRTC] Received pull_request from ${remoteId} for "${message.filename}"`
      );
      if (fileUri && message.filename === filename) {
        try {
          const fileData = await readFile(fileUri, bookmark);
          sendOverDataChannel(
            channel,
            {
              type: "pull_response",
              filename,
              fileData,
              lastModified: localLkm,
            },
            remoteId
          );
        } catch (err) {
          console.error("[WebRTC] Failed to send database response:", err);
        }
      }
      break;

    case "pull_response":
    case "push_request":
      console.log(
        `[WebRTC] Received file payload (type: ${message.type}) from ${remoteId} for "${message.filename}". Remote LKM: ${message.lastModified}, Local LKM: ${localLkm}`
      );
      if (fileUri && message.filename === filename) {
        if (message.lastModified - localLkm > 1000) {
          try {
            const arrayBuffer = base64ToArrayBuffer(message.fileData);
            validateKdbxSignature(arrayBuffer);

            const currentDb = useVaultStore.getState()._db;
            if (!currentDb || !currentDb.credentials) {
              console.log(
                "[WebRTC] Database is currently locked. Saving update to file system directly."
              );
              const success = await writeFile(
                fileUri,
                message.fileData,
                bookmark
              );
              if (success) {
                await setLkm(fileUri, message.lastModified);
                console.log(
                  `[WebRTC] Successfully synced database file (while locked) from ${remoteId}`
                );
                setSyncStatus("synced");
                setTimeout(() => {
                  if (
                    useSignalingStore.getState().webrtcSyncStatus === "synced"
                  ) {
                    setSyncStatus("idle");
                  }
                }, 3000);
              }
              // Confirm push receipt even if locked
              if (message.type === "push_request") {
                sendOverDataChannel(
                  channel,
                  {
                    type: "push_response",
                    filename,
                    status: "success",
                  },
                  remoteId
                );
              }
              return;
            }

            // Verify that this file can be unlocked with the existing credentials
            const newDb = await kdbxweb.Kdbx.load(
              arrayBuffer,
              currentDb.credentials
            );

            // Atomic write to storage
            const success = await writeFile(
              fileUri,
              message.fileData,
              bookmark
            );
            if (success) {
              await setLkm(fileUri, message.lastModified);
              useVaultStore.getState().syncDatabase(newDb);
              console.log(
                `[WebRTC] Successfully synced and reloaded database from ${remoteId}`
              );
              setSyncStatus("synced");
              setTimeout(() => {
                if (
                  useSignalingStore.getState().webrtcSyncStatus === "synced"
                ) {
                  setSyncStatus("idle");
                }
              }, 3000);

              // Confirm push receipt
              if (message.type === "push_request") {
                sendOverDataChannel(
                  channel,
                  {
                    type: "push_response",
                    filename,
                    status: "success",
                  },
                  remoteId
                );
              }
            }
          } catch (err) {
            console.error(
              "[WebRTC] Failed to import synced database file:",
              err
            );
            setSyncStatus(
              "error",
              err instanceof Error ? err.message : "Sync failed"
            );
            if (message.type === "push_request") {
              sendOverDataChannel(
                channel,
                {
                  type: "push_response",
                  filename,
                  status: "error",
                  error:
                    err instanceof Error ? err.message : "Decryption failed",
                },
                remoteId
              );
            }
          }
        } else {
          console.log(
            `[WebRTC] Ignored payload from ${remoteId} because local is newer or same version`
          );
          if (message.type === "push_request") {
            sendOverDataChannel(
              channel,
              {
                type: "push_response",
                filename,
                status: "ignored",
              },
              remoteId
            );
          }
        }
      }
      break;

    case "push_response":
      console.log(
        `[WebRTC] Push status response from ${remoteId} for "${message.filename}":`,
        message.status
      );
      if (message.status === "success") {
        setSyncStatus("synced");
        setTimeout(() => {
          if (useSignalingStore.getState().webrtcSyncStatus === "synced") {
            setSyncStatus("idle");
          }
        }, 3000);
      } else if (message.status === "ignored") {
        setSyncStatus("up_to_date");
        setTimeout(() => {
          if (useSignalingStore.getState().webrtcSyncStatus === "up_to_date") {
            setSyncStatus("idle");
          }
        }, 3000);
      } else if (message.status === "error") {
        setSyncStatus("error", message.error || "Push failed on remote peer");
      }
      break;

    default:
      break;
  }
}

/**
 * Broadcasts a local vault push_request to all active data channels
 */
export function broadcastPushRequest(
  filename: string,
  fileData: string,
  lastModified: number
) {
  const msg = {
    type: "push_request",
    filename,
    fileData,
    lastModified,
  };

  console.log(
    `[WebRTC] Broadcasting push_request to ${dataChannels.size} peers. LKM: ${lastModified}`
  );
  for (const [remoteId, channel] of dataChannels.entries()) {
    sendOverDataChannel(channel, msg, `Broadcast:${remoteId}`);
  }
}

/**
 * Manually trigger metadata check for a specific file across all open data channels,
 * or announce presence if no channels are open yet.
 */
export async function triggerSyncCheckForFile(fileUri: string) {
  if (!fileUri) return;
  try {
    const localLkm = await getLkm(fileUri);
    let filename = await SecureStore.getItemAsync("vault_file_name");
    if (!filename) {
      filename = await getFilenameFromUri(fileUri);
      await SecureStore.setItemAsync("vault_file_name", filename);
    }
    console.log(
      `[WebRTC] Manually triggering sync check for: ${fileUri}, filename: ${filename}, localLkm: ${localLkm}`
    );

    // Clear any existing sync timeout
    clearSyncTimeout();

    if (dataChannels.size === 0) {
      console.log(
        "[WebRTC] No data channels open for manual trigger. Announcing presence to discover peers."
      );
      const { connectionStatus, myId, roomId } = useSignalingStore.getState();
      setSyncStatus("connecting_peers");

      // Set timeout for connecting to peers (10 seconds)
      syncTimeoutTimer = setTimeout(() => {
        const currentStatus = useSignalingStore.getState().webrtcSyncStatus;
        if (currentStatus === "connecting_peers") {
          console.log("[WebRTC] Sync connection timeout — no peers responded.");
          setSyncStatus("error", "No peers found");
          setTimeout(() => {
            if (useSignalingStore.getState().webrtcSyncStatus === "error") {
              setSyncStatus("idle");
            }
          }, 3000);
        }
      }, 10000);

      if (connectionStatus === "connected" && roomId) {
        sendSignalingMessage({
          type: "announce",
          senderId: myId,
        });
      }
      return;
    }

    setSyncStatus("checking_updates");

    // Set timeout for checking updates (10 seconds)
    syncTimeoutTimer = setTimeout(() => {
      const currentStatus = useSignalingStore.getState().webrtcSyncStatus;
      if (
        currentStatus === "checking_updates" ||
        currentStatus === "connecting_peers"
      ) {
        console.log(
          "[WebRTC] Sync checking updates timeout — peer unresponsive."
        );
        setSyncStatus("error", "Sync timed out");
        setTimeout(() => {
          if (useSignalingStore.getState().webrtcSyncStatus === "error") {
            setSyncStatus("idle");
          }
        }, 3000);
      }
    }, 10000);

    for (const [remoteId, channel] of dataChannels.entries()) {
      if (channel.readyState === "open") {
        console.log(
          `[WebRTC] Querying metadata from peer ${remoteId} for manually triggered check`
        );
        // Request remote metadata
        sendOverDataChannel(channel, { type: "metadata_query" }, remoteId);

        // Share local metadata
        sendOverDataChannel(
          channel,
          {
            type: "metadata_info",
            filename,
            lastModified: localLkm,
            size: 0,
          },
          remoteId
        );
      }
    }
  } catch (err) {
    console.error("[WebRTC] Error triggering manual sync check:", err);
  }
}

/**
 * Clean up a single peer's resources
 */
export function cleanupPeer(remoteId: string) {
  const pc = peerConnections.get(remoteId);
  if (pc) {
    try {
      pc.close();
    } catch {}
    peerConnections.delete(remoteId);
  }

  const channel = dataChannels.get(remoteId);
  if (channel) {
    dataChannels.delete(remoteId);
  }
}

/**
 * Clean up all active peer connections and data channels
 */
export function cleanupAllPeers() {
  console.log("[WebRTC] Cleaning up all peer connections");
  setSyncStatus("idle");
  for (const remoteId of peerConnections.keys()) {
    cleanupPeer(remoteId);
  }
}

// Register signaling listener
registerSignalingMessageListener(handleSignalingMessage);

// Subscribe to store changes to clean up peers on disconnect or room leave
useSignalingStore.subscribe((state, prevState) => {
  if (
    state.connectionStatus === "offline" &&
    prevState.connectionStatus !== "offline"
  ) {
    cleanupAllPeers();
  }
  if (!state.roomId && prevState.roomId) {
    cleanupAllPeers();
  }
});

// App state change handler for background/foreground transitions
let currentAppState: AppStateStatus = AppState.currentState;
AppState.addEventListener("change", (nextAppState: AppStateStatus) => {
  console.log(
    `[WebRTC] AppState changed from ${currentAppState} to ${nextAppState}`
  );
  if (nextAppState === "background" || nextAppState === "inactive") {
    // Clear all peer connections when entering background/inactive
    cleanupAllPeers();
  } else if (
    nextAppState === "active" &&
    (currentAppState === "background" || currentAppState === "inactive")
  ) {
    // When returning to foreground, force a reconnect if configured to clear any stale socket
    const { isConfigured } = useSignalingStore.getState();
    if (isConfigured) {
      console.log(
        "[WebRTC] App active again. Reconnecting signaling WebSocket..."
      );
      useSignalingStore.getState().connect();
    }
  }
  currentAppState = nextAppState;
});
