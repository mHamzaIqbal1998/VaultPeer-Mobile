import { create } from "zustand";

export interface PeerInfo {
  peerId: string;
  connectionState: string; // RTCPeerConnectionState
  dataChannelState: string; // RTCDataChannelState
  isOfferer: boolean;
}

interface WebRTCStoreState {
  peers: Record<string, PeerInfo>;
  activePeersCount: number;
  addOrUpdatePeer: (
    peerId: string,
    updates: Partial<Omit<PeerInfo, "peerId">>
  ) => void;
  removePeer: (peerId: string) => void;
  clearPeers: () => void;
}

export const useWebRTCStore = create<WebRTCStoreState>((set) => ({
  peers: {},
  activePeersCount: 0,

  addOrUpdatePeer: (peerId, updates) => {
    set((state) => {
      const existing = state.peers[peerId] || {
        peerId,
        connectionState: "new",
        dataChannelState: "connecting",
        isOfferer: false,
      };

      const updatedPeer = { ...existing, ...updates };
      const updatedPeers = { ...state.peers, [peerId]: updatedPeer };

      // Calculate active count
      const activePeersCount = Object.values(updatedPeers).filter(
        (p) => p.dataChannelState === "open"
      ).length;

      return {
        peers: updatedPeers,
        activePeersCount,
      };
    });
  },

  removePeer: (peerId) => {
    set((state) => {
      const updatedPeers = { ...state.peers };
      delete updatedPeers[peerId];

      const activePeersCount = Object.values(updatedPeers).filter(
        (p) => p.dataChannelState === "open"
      ).length;

      return {
        peers: updatedPeers,
        activePeersCount,
      };
    });
  },

  clearPeers: () => {
    set({ peers: {}, activePeersCount: 0 });
  },
}));
