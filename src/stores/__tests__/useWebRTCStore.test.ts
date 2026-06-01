import { useWebRTCStore } from "../useWebRTCStore";

describe("useWebRTCStore", () => {
  beforeEach(() => {
    useWebRTCStore.getState().clearPeers();
  });

  it("should initialize with empty peers and 0 activePeersCount", () => {
    const state = useWebRTCStore.getState();
    expect(state.peers).toEqual({});
    expect(state.activePeersCount).toBe(0);
  });

  it("should add a new peer and initialize default values", () => {
    const store = useWebRTCStore.getState();
    store.addOrUpdatePeer("peer-1", { isOfferer: true });

    const state = useWebRTCStore.getState();
    expect(state.peers["peer-1"]).toEqual({
      peerId: "peer-1",
      connectionState: "new",
      dataChannelState: "connecting",
      isOfferer: true,
    });
    expect(state.activePeersCount).toBe(0);
  });

  it("should update an existing peer's connectionState and dataChannelState", () => {
    const store = useWebRTCStore.getState();
    store.addOrUpdatePeer("peer-1", { isOfferer: true });
    store.addOrUpdatePeer("peer-1", {
      connectionState: "connected",
      dataChannelState: "open",
    });

    const state = useWebRTCStore.getState();
    expect(state.peers["peer-1"]).toEqual({
      peerId: "peer-1",
      connectionState: "connected",
      dataChannelState: "open",
      isOfferer: true,
    });
    expect(state.activePeersCount).toBe(1);
  });

  it("should count multiple active peers correctly", () => {
    const store = useWebRTCStore.getState();
    store.addOrUpdatePeer("peer-1", { dataChannelState: "open" });
    store.addOrUpdatePeer("peer-2", { dataChannelState: "connecting" });
    store.addOrUpdatePeer("peer-3", { dataChannelState: "open" });

    const state = useWebRTCStore.getState();
    expect(state.activePeersCount).toBe(2);
  });

  it("should remove a peer and recalculate activePeersCount", () => {
    const store = useWebRTCStore.getState();
    store.addOrUpdatePeer("peer-1", { dataChannelState: "open" });
    store.addOrUpdatePeer("peer-2", { dataChannelState: "open" });

    expect(useWebRTCStore.getState().activePeersCount).toBe(2);

    store.removePeer("peer-1");

    const state = useWebRTCStore.getState();
    expect(state.peers["peer-1"]).toBeUndefined();
    expect(state.peers["peer-2"]).toBeDefined();
    expect(state.activePeersCount).toBe(1);
  });

  it("should clear all peers", () => {
    const store = useWebRTCStore.getState();
    store.addOrUpdatePeer("peer-1", { dataChannelState: "open" });
    store.addOrUpdatePeer("peer-2", { dataChannelState: "open" });

    store.clearPeers();

    const state = useWebRTCStore.getState();
    expect(state.peers).toEqual({});
    expect(state.activePeersCount).toBe(0);
  });
});
