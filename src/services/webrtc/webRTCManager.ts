import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
} from "react-native-webrtc";
import { useSignalingStore } from "../../stores/useSignalingStore";
import { useWebRTCStore } from "../../stores/useWebRTCStore";

const TAG = "[WebRTCManager]";
const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

interface PeerState {
  pc: RTCPeerConnection;
  dc: any | null; // DataChannel is not fully typed in all react-native-webrtc versions, so we use any
  isOfferer: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  candidateQueue?: any[];
}

class WebRTCManager {
  private peers = new Map<string, PeerState>();

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
        this.cleanupPeer(senderId);
        break;
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
   * Create and configure RTCPeerConnection.
   */
  private createPeerConnection(remotePeerId: string, isOfferer: boolean) {
    console.log(
      TAG,
      `Creating RTCPeerConnection for ${remotePeerId} (Offerer: ${isOfferer})`
    );

    const storeIceServers = useSignalingStore.getState().iceServers;
    // Always prepend Google STUN as the fallback first item
    const configIceServers = [
      DEFAULT_ICE_SERVERS[0],
      ...(storeIceServers && storeIceServers.length > 0
        ? storeIceServers
        : [DEFAULT_ICE_SERVERS[1]]),
    ];

    const pc = new RTCPeerConnection({
      iceServers: configIceServers,
    });

    const state: PeerState = {
      pc,
      dc: null,
      isOfferer,
      makingOffer: false,
      ignoreOffer: false,
      candidateQueue: [],
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

      if (
        connState === "closed" ||
        connState === "failed" ||
        connState === "disconnected"
      ) {
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
        pc.iceConnectionState === "failed" ||
        pc.iceConnectionState === "closed"
      ) {
        this.cleanupPeer(remotePeerId);
      }
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
   * Initiate negotiation (SDP Offer)
   */
  private async negotiate(remotePeerId: string, state: PeerState) {
    state.makingOffer = true;
    try {
      const offer = await state.pc.createOffer();
      await state.pc.setLocalDescription(offer);

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
      state.makingOffer = false;
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

      // Announce readiness/query files (can be fleshed out in file sync phase)
      this.sendToPeer(remotePeerId, { type: "metadata_query" });
    };

    dc.onclose = () => {
      console.log(TAG, `Data channel with ${remotePeerId} is CLOSED`);
      useWebRTCStore.getState().addOrUpdatePeer(remotePeerId, {
        dataChannelState: "closed",
      });
      state.dc = null;
    };

    dc.onerror = (error: any) => {
      console.error(TAG, `Data channel error for peer ${remotePeerId}:`, error);
    };

    dc.onmessage = (event: any) => {
      try {
        const msg = JSON.parse(event.data);
        console.log(TAG, `DC message received from ${remotePeerId}:`, msg.type);
        // Dispatch data-channel message to future sync handlers
      } catch {
        console.warn(TAG, `Received non-JSON message from ${remotePeerId}`);
      }
    };
  }

  /**
   * Send JSON message to a peer over data channel.
   */
  public sendToPeer(peerId: string, msg: any): boolean {
    const state = this.peers.get(peerId);
    if (state && state.dc && state.dc.readyState === "open") {
      try {
        state.dc.send(JSON.stringify(msg));
        return true;
      } catch (err) {
        console.error(
          TAG,
          `Failed to send data channel message to ${peerId}:`,
          err
        );
      }
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
   * Clean up a peer connection.
   */
  public cleanupPeer(peerId: string) {
    const state = this.peers.get(peerId);
    if (!state) return;

    console.log(TAG, `Cleaning up peer connection for ${peerId}`);
    try {
      state.dc?.close();
    } catch {}
    try {
      state.pc.close();
    } catch {}

    this.peers.delete(peerId);
    useWebRTCStore.getState().removePeer(peerId);
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
    this.peers.forEach((_, peerId) => {
      this.cleanupPeer(peerId);
    });
    useWebRTCStore.getState().clearPeers();
  }
}

export const webRTCManager = new WebRTCManager();
