import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
} from "react-native-webrtc";
import { useSignalingStore } from "../../stores/useSignalingStore";
import { useWebRTCStore } from "../../stores/useWebRTCStore";
import {
  ChunkReassembler,
  createChunkMessages,
  isChunkedType,
  computeSHA256,
  SyncMsg,
  type ReassemblyResult,
} from "../sync/syncProtocol";

const TAG = "[WebRTCManager]";

/** Pause chunk sending while the channel's send buffer exceeds this (bytes). */
const MAX_BUFFERED_AMOUNT = 128 * 1024; // 128 KB
/** Max time (ms) to wait for the send buffer to drain before aborting. */
const BUFFER_DRAIN_TIMEOUT_MS = 60_000; // 60s timeout
/** Data channel heartbeat interval (ms). */
const DC_HEARTBEAT_INTERVAL_MS = 15_000;
/** Data channel heartbeat timeout — if no pong within this, channel is stale. */
const DC_HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * Hooks the sync engine registers to receive data-channel lifecycle and
 * (reassembled) message events. Kept as a registration callback so the
 * transport never imports the engine — avoiding a circular dependency.
 */
export interface SyncHooks {
  onChannelOpen: (peerId: string) => void;
  onChannelClosed: (peerId: string) => void;
  onMessage: (peerId: string, msg: any) => void;
}
const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/** Maximum number of ICE restart attempts before giving up */
const MAX_ICE_RESTART_ATTEMPTS = 2;
/** Grace period (ms) before cleaning up a disconnected peer */
const DISCONNECT_GRACE_MS = 10_000;
/** Grace period (ms) after ICE restart before final cleanup */
const ICE_RESTART_GRACE_MS = 15_000;
/** Timeout (ms) waiting for ICE gathering before sending offer */
const ICE_GATHER_TIMEOUT_MS = 3_000;

interface PeerState {
  pc: RTCPeerConnection;
  dc: any | null; // DataChannel is not fully typed in all react-native-webrtc versions, so we use any
  isOfferer: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  candidateQueue?: any[];
  iceRestartCount: number;
  reassembler: ChunkReassembler;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  heartbeatTimeout: ReturnType<typeof setTimeout> | null;
}

class WebRTCManager {
  private peers = new Map<string, PeerState>();
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Per-peer transfer generation counter. Incremented each time a new chunked
   * transfer starts. The send loop checks whether its captured generation still
   * matches; if not, it aborts because a newer transfer has superseded it.
   */
  private transferGeneration = new Map<string, number>();
  private syncHooks: SyncHooks | null = null;

  /**
   * Register the sync engine's lifecycle/message hooks. Called once during
   * sync engine initialization.
   */
  public setSyncHooks(hooks: SyncHooks) {
    this.syncHooks = hooks;
  }

  /**
   * Processes inbound signaling messages from the signaling server.
   */
  public handleSignalingMessage(msg: any) {
    const { type, senderId, targetId } = msg;
    const { clientId } = useSignalingStore.getState();

    // Ignore messages not meant for us or from ourselves
    if (senderId === clientId) return;
    if (targetId && targetId !== clientId) return;

    switch (type) {
      case "announce":
        this.handleAnnounce(senderId);
        break;
      case "offer":
        this.handleOffer(senderId, msg.sdp);
        break;
      case "answer":
        this.handleAnswer(senderId, msg.sdp);
        break;
      case "candidate":
        this.handleCandidate(senderId, msg.candidate, msg.mid);
        break;
      case "leave":
      case "peer_left": {
        const idToCleanup = senderId || msg.peerId;
        if (idToCleanup) {
          this.cleanupPeer(idToCleanup);
        }
        break;
      }
      default:
        console.log(TAG, `Ignored signaling message type: ${type}`);
    }
  }

  /**
   * Initiates signaling messages via the signaling store.
   */
  private sendSignaling(msg: any) {
    useSignalingStore.getState().sendMessage(msg);
  }

  /**
   * Handle announce from a remote peer.
   * Compares local clientId with remote senderId:
   * - Greater ID: Offerer (impolite)
   * - Lesser ID: Answerer (polite)
   */
  private handleAnnounce(remotePeerId: string) {
    const { clientId } = useSignalingStore.getState();
    const weAreOfferer = clientId > remotePeerId;

    console.log(
      TAG,
      `Announce received from ${remotePeerId}. Role: ${
        weAreOfferer ? "offerer (impolite)" : "answerer (polite)"
      }`
    );

    if (this.peers.has(remotePeerId)) {
      console.log(
        TAG,
        `Peer ${remotePeerId} announced again. Cleaning up old connection.`
      );
      this.cleanupPeer(remotePeerId);
    }

    if (weAreOfferer) {
      this.createPeerConnection(remotePeerId, true);
    } else {
      console.log(
        TAG,
        `Sending targeted announce back to offerer ${remotePeerId}`
      );
      this.sendSignaling({
        type: "announce",
        senderId: clientId,
        targetId: remotePeerId,
      });
      this.createPeerConnection(remotePeerId, false);
    }
  }

  /**
   * Handle incoming offer from impolite peer.
   */
  private async handleOffer(remotePeerId: string, sdp: string) {
    console.log(TAG, `Received offer from ${remotePeerId}`);

    let state = this.peers.get(remotePeerId);
    if (!state) {
      this.createPeerConnection(remotePeerId, false);
      state = this.peers.get(remotePeerId)!;
    }

    const { pc } = state;
    const { clientId } = useSignalingStore.getState();
    const polite = clientId < remotePeerId;

    // Polite negotiation collision handling
    const offerCollision = state.makingOffer || pc.signalingState !== "stable";
    state.ignoreOffer = !polite && offerCollision;

    if (state.ignoreOffer) {
      console.log(
        TAG,
        `Collision detected, we are impolite. Ignoring offer from ${remotePeerId}`
      );
      return;
    }

    try {
      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: "offer", sdp })
      );
      await this.processQueuedCandidates(remotePeerId, state);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.sendSignaling({
        type: "answer",
        senderId: clientId,
        targetId: remotePeerId,
        sdp: pc.localDescription?.sdp || answer.sdp,
      });
    } catch (err) {
      console.error(TAG, `Error handling offer from ${remotePeerId}:`, err);
    }
  }

  /**
   * Handle incoming answer from polite peer.
   */
  private async handleAnswer(remotePeerId: string, sdp: string) {
    console.log(TAG, `Received answer from ${remotePeerId}`);
    const state = this.peers.get(remotePeerId);
    if (!state) {
      console.warn(TAG, `Received answer from untracked peer ${remotePeerId}`);
      return;
    }

    try {
      await state.pc.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp })
      );
      await this.processQueuedCandidates(remotePeerId, state);
    } catch (err) {
      console.error(
        TAG,
        `Error setting remote description answer for ${remotePeerId}:`,
        err
      );
    }
  }

  /**
   * Handle incoming ICE candidate.
   */
  private async handleCandidate(
    remotePeerId: string,
    candidate: any,
    sdpMid: string
  ) {
    const state = this.peers.get(remotePeerId);
    if (!state) {
      console.warn(
        TAG,
        `Received candidate from untracked peer ${remotePeerId}`
      );
      return;
    }

    let candInfo = candidate;
    if (typeof candidate === "string") {
      candInfo = { candidate, sdpMid, sdpMLineIndex: 0 };
    } else if (candidate && !candidate.sdpMid) {
      candInfo = { ...candidate, sdpMid };
    }

    if (!candInfo) return;

    // Check if remoteDescription is set yet. If not, queue the candidate.
    if (!state.pc.remoteDescription || !state.pc.remoteDescription.type) {
      console.log(
        TAG,
        `Remote description not set yet for ${remotePeerId}. Queueing ICE candidate.`
      );
      if (!state.candidateQueue) {
        state.candidateQueue = [];
      }
      state.candidateQueue.push(candInfo);
      return;
    }

    try {
      await state.pc.addIceCandidate(new RTCIceCandidate(candInfo));
    } catch (err) {
      console.warn(
        TAG,
        `Error adding remote candidate from ${remotePeerId}:`,
        err
      );
    }
  }

  /**
   * Process any queued remote ICE candidates once remote description is set.
   */
  private async processQueuedCandidates(
    remotePeerId: string,
    state: PeerState
  ) {
    if (!state.candidateQueue || state.candidateQueue.length === 0) return;
    console.log(
      TAG,
      `Processing ${state.candidateQueue.length} queued remote ICE candidates for ${remotePeerId}`
    );
    const queue = [...state.candidateQueue];
    state.candidateQueue = [];
    for (const candInfo of queue) {
      try {
        await state.pc.addIceCandidate(new RTCIceCandidate(candInfo));
      } catch (err) {
        console.warn(
          TAG,
          `Error adding queued remote candidate from ${remotePeerId}:`,
          err
        );
      }
    }
  }

  /**
   * Detect whether user-provided ICE servers contain any TURN entries.
   */
  private hasTurnServers(servers: any[]): boolean {
    return servers.some((s) => {
      const urls = Array.isArray(s.urls)
        ? s.urls
        : typeof s.urls === "string"
          ? [s.urls]
          : [];
      return urls.some(
        (u: string) => u.startsWith("turn:") || u.startsWith("turns:")
      );
    });
  }

  /**
   * Filter, deduplicate, and prioritize ICE servers to prevent concurrent
   * allocation attempts to the same TURN host, which causes collisions and
   * rate-limiting on mobile CGNAT networks.
   * Priority order:
   *   1. turns: (TLS over TCP on 443) — most reliable, looks like HTTPS traffic
   *   2. turn:  with transport=tcp — TCP avoids UDP NAT mapping timeout
   *   3. turn:  UDP — fastest but NAT may kill the mapping after ~30s
   *   4. stun:  only — useless on CGNAT, deprioritize or filter out
   */
  private filterAndPrioritizeIceServers(servers: any[]): any[] {
    const flat: { url: string; username?: string; credential?: string }[] = [];
    for (const s of servers) {
      if (!s) continue;
      const urls = Array.isArray(s.urls)
        ? s.urls
        : typeof s.urls === "string"
          ? [s.urls]
          : [];
      for (const u of urls) {
        if (typeof u === "string") {
          flat.push({
            url: u,
            username: s.username,
            credential: s.credential,
          });
        }
      }
    }

    const getHost = (url: string): string => {
      const match = url.match(/^(?:stun|stuns|turn|turns):([^:?]+)/i);
      return match ? match[1].toLowerCase() : url.toLowerCase();
    };

    const getPriority = (url: string): number => {
      if (url.startsWith("turns:")) return 0;
      if (url.startsWith("turn:") && url.includes("transport=tcp")) return 1;
      if (url.startsWith("turn:")) return 2;
      return 3;
    };

    const groups = new Map<string, typeof flat>();
    for (const item of flat) {
      const host = getHost(item.url);
      if (!groups.has(host)) {
        groups.set(host, []);
      }
      groups.get(host)!.push(item);
    }

    const result: any[] = [];
    groups.forEach((items) => {
      items.sort((a, b) => getPriority(a.url) - getPriority(b.url));
      const best = items[0];
      if (best) {
        const rtcServer: any = { urls: [best.url] };
        if (best.username) rtcServer.username = best.username;
        if (best.credential) rtcServer.credential = best.credential;
        result.push(rtcServer);
      }
    });

    const hasTurn = result.some((s) =>
      s.urls.some(
        (u: string) => u.startsWith("turn:") || u.startsWith("turns:")
      )
    );

    if (hasTurn) {
      const turnDomains = result
        .filter((s) =>
          s.urls.some(
            (u: string) => u.startsWith("turn:") || u.startsWith("turns:")
          )
        )
        .map((s) => {
          const host = getHost(s.urls[0]);
          return host.replace(/^(?:standard|stun|turn|relay)\./, "");
        });

      return result.filter((s) => {
        const isStunOnly = s.urls.every(
          (u: string) => u.startsWith("stun:") || u.startsWith("stuns:")
        );
        if (!isStunOnly) return true;
        const host = getHost(s.urls[0]);
        const stunDomain = host.replace(/^(?:standard|stun|turn|relay)\./, "");
        const isDuplicate = turnDomains.some(
          (td) => stunDomain.includes(td) || td.includes(stunDomain)
        );
        if (isDuplicate) {
          console.log(TAG, `Filtering out redundant STUN server: ${s.urls[0]}`);
          return false;
        }
        return true;
      });
    }

    return result;
  }

  /**
   * Create and configure RTCPeerConnection.
   */
  private createPeerConnection(remotePeerId: string, isOfferer: boolean) {
    console.log(
      TAG,
      `Creating RTCPeerConnection for ${remotePeerId} (Offerer: ${isOfferer})`
    );

    const storeIceServers = useSignalingStore.getState().iceServers;
    const hasCustomServers = storeIceServers && storeIceServers.length > 0;

    // When user provides custom ICE servers (which already include their own STUN),
    // use them as-is. Don't prepend Google STUN — on CGNAT it generates useless
    // srflx candidates that compete with valid relay candidates.
    let configIceServers = hasCustomServers
      ? storeIceServers
      : DEFAULT_ICE_SERVERS;

    // Filter, deduplicate, and prioritize custom servers
    if (hasCustomServers) {
      configIceServers = this.filterAndPrioritizeIceServers(storeIceServers);
    }

    console.log(TAG, `ICE config: ${configIceServers.length} servers`);

    const rtcConfig: any = {
      iceServers: configIceServers,
      bundlePolicy: "max-bundle",
    };

    const pc = new RTCPeerConnection(rtcConfig);

    const state: PeerState = {
      pc,
      dc: null,
      isOfferer,
      makingOffer: false,
      ignoreOffer: false,
      candidateQueue: [],
      iceRestartCount: 0,
      reassembler: new ChunkReassembler(),
      heartbeatInterval: null,
      heartbeatTimeout: null,
    };

    this.peers.set(remotePeerId, state);
    useWebRTCStore.getState().addOrUpdatePeer(remotePeerId, {
      isOfferer,
      connectionState: pc.connectionState || "new",
      dataChannelState: "connecting",
    });

    // ── ICE Candidate Gathering ──
    (pc as any).onicecandidate = (event: any) => {
      if (event.candidate) {
        const { clientId } = useSignalingStore.getState();
        this.sendSignaling({
          type: "candidate",
          senderId: clientId,
          targetId: remotePeerId,
          candidate: event.candidate,
          mid: event.candidate.sdpMid,
        });
      }
    };

    // ── Connection State Change ──
    (pc as any).onconnectionstatechange = () => {
      const connState = pc.connectionState;
      console.log(
        TAG,
        `Peer ${remotePeerId} connectionState changed: ${connState}`
      );
      if (this.peers.get(remotePeerId)?.pc !== pc) {
        console.log(
          TAG,
          `Ignoring connectionStateChange for stale peer connection ${remotePeerId}`
        );
        return;
      }
      useWebRTCStore.getState().addOrUpdatePeer(remotePeerId, {
        connectionState: connState,
      });

      if (connState === "connected") {
        // Connection recovered or established — clear any pending disconnect timer
        // and reset the ICE restart counter
        this.clearDisconnectTimer(remotePeerId);
        const peerState = this.peers.get(remotePeerId);
        if (peerState) peerState.iceRestartCount = 0;
      } else if (connState === "disconnected") {
        // `disconnected` is transient — the ICE agent may still be trying
        // TURN relay candidates. Give it generous time before cleaning up.
        this.scheduleDisconnectCleanup(remotePeerId, DISCONNECT_GRACE_MS);
      } else if (connState === "failed") {
        // Attempt ICE restart before giving up
        this.clearDisconnectTimer(remotePeerId);
        this.attemptIceRestart(remotePeerId);
      } else if (connState === "closed") {
        this.clearDisconnectTimer(remotePeerId);
        this.cleanupPeer(remotePeerId);
      }
    };

    // ── Ice Connection State Change ──
    (pc as any).oniceconnectionstatechange = () => {
      console.log(
        TAG,
        `Peer ${remotePeerId} iceConnectionState changed: ${pc.iceConnectionState}`
      );
      if (this.peers.get(remotePeerId)?.pc !== pc) {
        console.log(
          TAG,
          `Ignoring iceConnectionStateChange for stale peer connection ${remotePeerId}`
        );
        return;
      }
      if (
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        this.clearDisconnectTimer(remotePeerId);
        const peerState = this.peers.get(remotePeerId);
        if (peerState) peerState.iceRestartCount = 0;
      } else if (pc.iceConnectionState === "disconnected") {
        // Transient — TURN relay candidates may still be in progress
        this.scheduleDisconnectCleanup(remotePeerId, DISCONNECT_GRACE_MS);
      } else if (pc.iceConnectionState === "failed") {
        this.clearDisconnectTimer(remotePeerId);
        this.attemptIceRestart(remotePeerId);
      } else if (pc.iceConnectionState === "closed") {
        this.clearDisconnectTimer(remotePeerId);
        this.cleanupPeer(remotePeerId);
      }
    };

    // ── ICE Gathering State (for debugging) ──
    (pc as any).onicegatheringstatechange = () => {
      console.log(
        TAG,
        `Peer ${remotePeerId} iceGatheringState: ${(pc as any).iceGatheringState}`
      );
    };

    // ── Data Channel setup ──
    if (isOfferer) {
      // Offerer creates the channel
      const dc = pc.createDataChannel("vault-sync");
      this.bindDataChannel(remotePeerId, state, dc);

      // Perform negotiation
      this.negotiate(remotePeerId, state);
    } else {
      // Answerer listens for the channel
      (pc as any).ondatachannel = (event: any) => {
        console.log(TAG, `Inbound data channel from ${remotePeerId}`);
        this.bindDataChannel(remotePeerId, state, event.channel);
      };
    }
  }

  /**
   * Wait for ICE gathering to complete or timeout.
   * On mobile networks with multiple TURN servers, gathering can take a while.
   * We wait up to ICE_GATHER_TIMEOUT_MS for "complete" state, then send whatever we have.
   */
  private waitForGatheringComplete(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if ((pc as any).iceGatheringState === "complete") {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        console.log(
          TAG,
          `ICE gathering timeout after ${ICE_GATHER_TIMEOUT_MS}ms — sending offer with current candidates`
        );
        (pc as any).onicegatheringstatechange = originalHandler;
        resolve();
      }, ICE_GATHER_TIMEOUT_MS);

      const originalHandler = (pc as any).onicegatheringstatechange;
      (pc as any).onicegatheringstatechange = () => {
        console.log(
          TAG,
          `ICE gathering state: ${(pc as any).iceGatheringState}`
        );
        if ((pc as any).iceGatheringState === "complete") {
          clearTimeout(timeout);
          (pc as any).onicegatheringstatechange = originalHandler;
          resolve();
        }
      };
    });
  }

  /**
   * Initiate negotiation (SDP Offer)
   * Waits briefly for ICE gathering to accumulate candidates before sending
   * the offer, which reduces the reliance on trickle ICE for reliability.
   */
  private async negotiate(remotePeerId: string, state: PeerState) {
    state.makingOffer = true;
    try {
      const offer = await state.pc.createOffer();
      // Verify peer wasn't cleaned up during async operation
      if (!this.peers.has(remotePeerId)) return;
      await state.pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete (or timeout) so the offer
      // includes as many candidates as possible — reducing reliance on
      // trickle ICE which is fragile on mobile networks.
      await this.waitForGatheringComplete(state.pc);
      if (!this.peers.has(remotePeerId)) return;

      const { clientId } = useSignalingStore.getState();
      this.sendSignaling({
        type: "offer",
        senderId: clientId,
        targetId: remotePeerId,
        sdp: state.pc.localDescription?.sdp || offer.sdp,
      });
    } catch (err) {
      console.error(TAG, `Error during negotiation with ${remotePeerId}:`, err);
    } finally {
      if (this.peers.has(remotePeerId)) {
        state.makingOffer = false;
      }
    }
  }

  /**
   * Bind event handlers to the DataChannel.
   */
  private bindDataChannel(remotePeerId: string, state: PeerState, dc: any) {
    state.dc = dc;
    useWebRTCStore.getState().addOrUpdatePeer(remotePeerId, {
      dataChannelState: dc.readyState || "connecting",
    });

    dc.onopen = () => {
      console.log(TAG, `Data channel with ${remotePeerId} is OPEN`);
      useWebRTCStore.getState().addOrUpdatePeer(remotePeerId, {
        dataChannelState: "open",
      });

      // Start data channel heartbeat
      this.startHeartbeat(remotePeerId, state);

      // Hand off to the sync engine, which performs the metadata handshake.
      this.syncHooks?.onChannelOpen(remotePeerId);
    };

    dc.onclose = () => {
      console.log(TAG, `Data channel with ${remotePeerId} is CLOSED`);
      useWebRTCStore.getState().addOrUpdatePeer(remotePeerId, {
        dataChannelState: "closed",
      });
      this.stopHeartbeat(state);
      state.reassembler.reset();
      state.dc = null;
      this.syncHooks?.onChannelClosed(remotePeerId);
    };

    dc.onerror = (error: any) => {
      console.error(TAG, `Data channel error for peer ${remotePeerId}:`, error);
    };

    dc.onmessage = (event: any) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        console.warn(TAG, `Received non-JSON message from ${remotePeerId}`);
        return;
      }

      // Handle data channel heartbeat
      if (msg.type === SyncMsg.DC_PING) {
        try {
          state.dc?.send(JSON.stringify({ type: SyncMsg.DC_PONG }));
        } catch {}
        return;
      }
      if (msg.type === SyncMsg.DC_PONG) {
        this.onHeartbeatPong(state);
        return;
      }

      // Reassemble chunked file transfers before dispatching to the engine.
      if (ChunkReassembler.isChunkMessage(msg.type)) {
        const result: ReassemblyResult | null =
          state.reassembler.handleChunkMessage(msg);
        if (result) {
          if (result.ok) {
            // Dispatch the reassembled message (integrity verified at engine level)
            void this.verifyAndDispatch(remotePeerId, result, state);
          } else {
            // Reassembly failed — send NACK to sender so they can retry
            console.warn(
              TAG,
              `Transfer reassembly failed from ${remotePeerId}: ${result.reason}`
            );
            try {
              state.dc?.send(
                JSON.stringify({
                  type: SyncMsg.TRANSFER_NACK,
                  transferId: result.transferId,
                  filename: result.filename,
                  reason: result.reason,
                })
              );
            } catch {}
            // Also notify sync engine of the failure
            this.syncHooks?.onMessage(remotePeerId, {
              type: SyncMsg.TRANSFER_NACK,
              transferId: result.transferId,
              filename: result.filename,
              reason: result.reason,
            });
          }
        }
        return;
      }

      this.syncHooks?.onMessage(remotePeerId, msg);
    };
  }

  /**
   * Send a JSON message to a peer over the data channel.
   *
   * File-bearing messages (pull_response / push_request) are automatically
   * split into chunks and streamed with backpressure handling. For these, the
   * boolean return only indicates the channel was open at dispatch time; the
   * actual streaming completes asynchronously.
   */
  public sendToPeer(peerId: string, msg: any): boolean {
    const state = this.peers.get(peerId);
    if (!state || !state.dc || state.dc.readyState !== "open") {
      return false;
    }

    if (msg && isChunkedType(msg.type)) {
      void this.sendChunkedWithHash(peerId, msg);
      return true;
    }

    try {
      state.dc.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      console.error(
        TAG,
        `Failed to send data channel message to ${peerId}:`,
        err
      );
      return false;
    }
  }

  /**
   * Stream a large file-bearing message as ordered chunks, pausing when the
   * data channel's send buffer grows too large to avoid overrunning it.
   *
   * Only ONE chunked transfer per peer is active at a time. If a new transfer
   * is started while a previous one is still in-flight, the previous one is
   * implicitly cancelled via a generation counter.
   */
  /**
   * Compute SHA-256 hash and then send chunked data with the hash embedded.
   */
  private async sendChunkedWithHash(
    peerId: string,
    msg: any
  ): Promise<boolean> {
    const fileData: string = msg.fileData || "";
    let sha256 = "";
    try {
      sha256 = await computeSHA256(fileData);
    } catch (e) {
      console.warn(TAG, `SHA-256 computation failed, sending without hash:`, e);
    }
    return this.sendChunkedToPeer(peerId, msg, sha256);
  }

  /**
   * Stream a large file-bearing message as ordered chunks, pausing when the
   * data channel's send buffer grows too large to avoid overrunning it.
   *
   * Only ONE chunked transfer per peer is active at a time. If a new transfer
   * is started while a previous one is still in-flight, the previous one is
   * implicitly cancelled via a generation counter.
   *
   * ADAPTIVE PACING: Instead of a fixed delay per chunk, we only pause when
   * the send buffer exceeds the threshold. On fast networks (WiFi/LAN), chunks
   * fly through with zero delay. On slow networks, backpressure naturally
   * throttles the rate.
   */
  private async sendChunkedToPeer(
    peerId: string,
    msg: any,
    sha256: string = ""
  ): Promise<boolean> {
    // Increment the generation counter — any previous in-flight transfer for
    // this peer will notice the mismatch and abort.
    const prevGen = this.transferGeneration.get(peerId) ?? 0;
    const myGen = prevGen + 1;
    this.transferGeneration.set(peerId, myGen);

    if (prevGen > 0) {
      console.log(
        TAG,
        `Superseding previous chunked transfer to ${peerId} (gen ${prevGen} → ${myGen})`
      );
    }

    const chunks = createChunkMessages(msg, sha256);
    console.log(
      TAG,
      `Sending ${msg.type} to ${peerId} in ${chunks.length} chunk message(s) (hash: ${sha256 ? sha256.substring(0, 8) + "…" : "none"})`
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Check if a newer transfer has superseded this one.
      if (this.transferGeneration.get(peerId) !== myGen) {
        console.log(
          TAG,
          `Chunked send to ${peerId} superseded by newer transfer (gen ${myGen}). Aborting.`
        );
        return false;
      }

      const state = this.peers.get(peerId);
      if (!state || !state.dc || state.dc.readyState !== "open") {
        console.warn(TAG, `Aborting chunked send to ${peerId}: channel gone`);
        return false;
      }

      // Backpressure: wait for the buffer to drain if it's too full.
      const bufferedAmount = state.dc.bufferedAmount ?? 0;
      if (bufferedAmount > MAX_BUFFERED_AMOUNT) {
        const drained = await this.waitForBufferDrain(peerId);
        if (!drained) {
          console.warn(TAG, `Aborting chunked send to ${peerId}: buffer stuck`);
          return false;
        }
        // Re-check generation after waiting for drain
        if (this.transferGeneration.get(peerId) !== myGen) {
          console.log(
            TAG,
            `Chunked send to ${peerId} superseded after buffer drain (gen ${myGen}). Aborting.`
          );
          return false;
        }
      }

      try {
        state.dc.send(JSON.stringify(chunk));
      } catch (err) {
        console.error(TAG, `Failed to send chunk to ${peerId}:`, err);
        return false;
      }

      // Adaptive pacing: yield to the event loop every 20 chunks to prevent
      // flooding the React Native bridge, but NO fixed delay per chunk.
      // Backpressure above handles slow networks; this just prevents UI jank.
      if (i > 0 && i % 20 === 0) {
        await new Promise((r) => setTimeout(r, 1));
      }
    }
    return true;
  }

  /**
   * Poll until the peer's send buffer drains below the threshold (or timeout).
   */
  private async waitForBufferDrain(peerId: string): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < BUFFER_DRAIN_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 20));
      const state = this.peers.get(peerId);
      if (!state || !state.dc || state.dc.readyState !== "open") return false;
      if ((state.dc.bufferedAmount ?? 0) <= MAX_BUFFERED_AMOUNT) return true;
    }
    return false;
  }

  /**
   * Broadcast message to all connected peers.
   */
  public broadcast(msg: any) {
    this.peers.forEach((state, peerId) => {
      this.sendToPeer(peerId, msg);
    });
  }

  /**
   * Schedule a delayed cleanup for a peer in `disconnected` state.
   * The timer is cancelled if the connection recovers to `connected`.
   */
  private scheduleDisconnectCleanup(peerId: string, delayMs: number) {
    // Don't schedule a second timer if one is already pending
    if (this.disconnectTimers.has(peerId)) return;

    console.log(
      TAG,
      `Scheduling disconnect cleanup for ${peerId} in ${delayMs}ms`
    );
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(peerId);
      const state = this.peers.get(peerId);
      if (!state) return;

      const connState = state.pc.connectionState;
      const iceState = state.pc.iceConnectionState;

      // Only clean up if still in a bad state after the grace period
      if (
        connState === "disconnected" ||
        connState === "failed" ||
        iceState === "disconnected" ||
        iceState === "failed"
      ) {
        console.log(
          TAG,
          `Peer ${peerId} still disconnected/failed after grace period — cleaning up`
        );
        this.cleanupPeer(peerId);
      } else {
        console.log(
          TAG,
          `Peer ${peerId} recovered (conn=${connState}, ice=${iceState}) — skipping cleanup`
        );
      }
    }, delayMs);

    this.disconnectTimers.set(peerId, timer);
  }

  /**
   * Cancel a pending disconnect timer for a peer.
   */
  private clearDisconnectTimer(peerId: string) {
    const timer = this.disconnectTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(peerId);
    }
  }

  /**
   * Attempt ICE restart before giving up on a failed connection.
   * Only the offerer triggers the restart; the answerer waits for a new offer.
   */
  private async attemptIceRestart(peerId: string) {
    const state = this.peers.get(peerId);
    if (!state) return;

    // Only attempt once — if we're already making an offer, skip
    if (state.makingOffer) {
      console.log(
        TAG,
        `Already negotiating with ${peerId}, skipping ICE restart`
      );
      return;
    }

    // Enforce maximum restart attempts
    if (state.iceRestartCount >= MAX_ICE_RESTART_ATTEMPTS) {
      console.log(
        TAG,
        `Max ICE restart attempts (${MAX_ICE_RESTART_ATTEMPTS}) reached for ${peerId} — cleaning up`
      );
      this.cleanupPeer(peerId);
      return;
    }

    if (!state.isOfferer) {
      console.log(
        TAG,
        `We are answerer for ${peerId} — waiting for offerer to restart ICE`
      );
      // Give the offerer generous time to restart;
      // if nothing happens, clean up
      this.scheduleDisconnectCleanup(peerId, ICE_RESTART_GRACE_MS);
      return;
    }

    state.iceRestartCount++;
    console.log(
      TAG,
      `Attempting ICE restart for ${peerId} (attempt ${state.iceRestartCount}/${MAX_ICE_RESTART_ATTEMPTS})`
    );
    state.makingOffer = true;
    try {
      const offer = await state.pc.createOffer({ iceRestart: true } as any);
      // Verify peer wasn't cleaned up during async createOffer
      if (!this.peers.has(peerId)) return;
      await state.pc.setLocalDescription(offer);

      // Wait briefly for new relay candidates to gather after restart
      await this.waitForGatheringComplete(state.pc);
      if (!this.peers.has(peerId)) return;

      const { clientId } = useSignalingStore.getState();
      this.sendSignaling({
        type: "offer",
        senderId: clientId,
        targetId: peerId,
        sdp: state.pc.localDescription?.sdp || offer.sdp,
      });

      // Give the restart generous time to complete,
      // then clean up if still failed
      this.scheduleDisconnectCleanup(peerId, ICE_RESTART_GRACE_MS);
    } catch (err) {
      console.error(TAG, `ICE restart failed for ${peerId}:`, err);
      this.cleanupPeer(peerId);
    } finally {
      if (this.peers.has(peerId)) {
        state.makingOffer = false;
      }
    }
  }

  /**
   * Clean up a peer connection.
   */
  public cleanupPeer(peerId: string) {
    const state = this.peers.get(peerId);
    if (!state) return;

    console.log(TAG, `Cleaning up peer connection for ${peerId}`);
    this.clearDisconnectTimer(peerId);
    this.stopHeartbeat(state);
    try {
      state.reassembler.destroy();
    } catch {}
    try {
      state.dc?.close();
    } catch {}
    try {
      state.pc.close();
    } catch {}

    this.peers.delete(peerId);
    useWebRTCStore.getState().removePeer(peerId);
    this.syncHooks?.onChannelClosed(peerId);
  }

  /**
   * Get all connected peer IDs.
   */
  public getConnectedPeers(): string[] {
    const result: string[] = [];
    this.peers.forEach((state, peerId) => {
      if (state.dc && state.dc.readyState === "open") {
        result.push(peerId);
      }
    });
    return result;
  }

  /**
   * Destroy all connections (e.g. on lock or logout).
   */
  public destroy() {
    console.log(TAG, "Destroying all peer connections");
    // Clear all disconnect timers first
    this.disconnectTimers.forEach((timer) => clearTimeout(timer));
    this.disconnectTimers.clear();
    this.peers.forEach((_, peerId) => {
      this.cleanupPeer(peerId);
    });
    useWebRTCStore.getState().clearPeers();
  }
  // ── Data Channel Heartbeat ──

  private startHeartbeat(peerId: string, state: PeerState) {
    this.stopHeartbeat(state);
    state.heartbeatInterval = setInterval(() => {
      if (!state.dc || state.dc.readyState !== "open") {
        this.stopHeartbeat(state);
        return;
      }
      try {
        state.dc.send(JSON.stringify({ type: SyncMsg.DC_PING }));
      } catch {
        return;
      }
      // Set a timeout — if no pong within DC_HEARTBEAT_TIMEOUT_MS, channel is dead
      state.heartbeatTimeout = setTimeout(() => {
        console.warn(
          TAG,
          `Data channel heartbeat timeout for ${peerId} — cleaning up`
        );
        this.cleanupPeer(peerId);
      }, DC_HEARTBEAT_TIMEOUT_MS);
    }, DC_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(state: PeerState) {
    if (state.heartbeatInterval) {
      clearInterval(state.heartbeatInterval);
      state.heartbeatInterval = null;
    }
    if (state.heartbeatTimeout) {
      clearTimeout(state.heartbeatTimeout);
      state.heartbeatTimeout = null;
    }
  }

  private onHeartbeatPong(state: PeerState) {
    if (state.heartbeatTimeout) {
      clearTimeout(state.heartbeatTimeout);
      state.heartbeatTimeout = null;
    }
  }

  // ── Integrity Verification ──

  private async verifyAndDispatch(
    peerId: string,
    result: Extract<ReassemblyResult, { ok: true }>,
    state: PeerState
  ) {
    // For now, SHA-256 hash is embedded in the file_chunk_start message.
    // The reassembler stored it internally. We need to verify against
    // the fileData. We pass the hash through the reassembled message.
    // Since ChunkReassembler returns just the FileTransferMessage, we
    // extract the hash from the _sha256 field if available.
    const msg = result.message;
    // Hash verification is done at the syncEngine level since
    // the reassembler already validates chunk completeness.
    this.syncHooks?.onMessage(peerId, msg);
  }
}

export const webRTCManager = new WebRTCManager();
