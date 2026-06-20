import { webRTCManager } from "../webRTCManager";
import { useSignalingStore } from "../../../stores/useSignalingStore";
import { useWebRTCStore } from "../../../stores/useWebRTCStore";
import { RTCPeerConnection } from "react-native-webrtc";

jest.mock("react-native-webrtc", () => {
  class MockRTCPeerConnection {
    iceServers: any;
    connectionState = "new";
    iceConnectionState = "new";
    signalingState = "stable";
    localDescription: any = null;
    remoteDescription: any = null;

    onicecandidate: any = null;
    onconnectionstatechange: any = null;
    oniceconnectionstatechange: any = null;
    ondatachannel: any = null;

    constructor(config: any) {
      this.iceServers = config?.iceServers;
      MockRTCPeerConnection.lastInstance = this as any;
    }

    static lastInstance: MockRTCPeerConnection | null = null;

    createOffer = jest
      .fn()
      .mockResolvedValue({ type: "offer", sdp: "mock-sdp-offer" });
    createAnswer = jest
      .fn()
      .mockResolvedValue({ type: "answer", sdp: "mock-sdp-answer" });
    setLocalDescription = jest.fn().mockImplementation((desc) => {
      this.localDescription = desc;
      return Promise.resolve();
    });
    setRemoteDescription = jest.fn().mockImplementation((desc) => {
      this.remoteDescription = desc;
      this.signalingState =
        desc.type === "offer" ? "have-remote-offer" : "stable";
      return Promise.resolve();
    });
    addIceCandidate = jest.fn().mockResolvedValue(undefined);
    createDataChannel = jest.fn().mockImplementation((label) => {
      const channel = {
        label,
        readyState: "connecting",
        send: jest.fn(),
        close: jest.fn(),
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
      };
      return channel;
    });
    close = jest.fn();
  }

  return {
    RTCPeerConnection: MockRTCPeerConnection,
    RTCSessionDescription: jest.fn().mockImplementation((init) => init),
    RTCIceCandidate: jest.fn().mockImplementation((init) => init),
  };
});

// Helper to flush microtask / promise queue
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WebRTCManager", () => {
  let mockSendMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    useWebRTCStore.getState().clearPeers();
    mockSendMessage = jest.fn();
    useSignalingStore.setState({
      // "b" is lexicographically:
      // - GREATER than "a" (so local is offerer / impolite)
      // - LESS than "c" (so local is answerer / polite)
      clientId: "b",
      sendMessage: mockSendMessage,
    });
  });

  afterEach(() => {
    webRTCManager.destroy();
  });

  it("should ignore signaling messages intended for other clients or from self", () => {
    // Message from self
    webRTCManager.handleSignalingMessage({
      type: "announce",
      senderId: "b",
    });
    expect(useWebRTCStore.getState().peers["b"]).toBeUndefined();

    // Message targeted for another client
    webRTCManager.handleSignalingMessage({
      type: "announce",
      senderId: "a",
      targetId: "other-client-999",
    });
    expect(useWebRTCStore.getState().peers["a"]).toBeUndefined();
  });

  it("should create RTCPeerConnection as an offerer (impolite) if local ID > remote ID", async () => {
    // local ("b") > remote ("a") -> local is offerer
    webRTCManager.handleSignalingMessage({
      type: "announce",
      senderId: "a",
    });

    await flushPromises();

    const peerInfo = useWebRTCStore.getState().peers["a"];
    expect(peerInfo).toBeDefined();
    expect(peerInfo.isOfferer).toBe(true);

    const pcInstance = (RTCPeerConnection as any).lastInstance;
    expect(pcInstance).toBeDefined();
    expect(pcInstance.createDataChannel).toHaveBeenCalledWith("vault-sync");
    expect(pcInstance.createOffer).toHaveBeenCalled();
    expect(pcInstance.setLocalDescription).toHaveBeenCalled();

    // Verify SDP offer was sent via signaling channel
    expect(mockSendMessage).toHaveBeenCalledWith({
      type: "offer",
      senderId: "b",
      targetId: "a",
      sdp: "mock-sdp-offer",
    });
  });

  it("should create RTCPeerConnection as an answerer (polite) if local ID < remote ID", async () => {
    // local ("b") < remote ("c") -> local is answerer (polite)
    webRTCManager.handleSignalingMessage({
      type: "announce",
      senderId: "c",
    });

    await flushPromises();

    const peerInfo = useWebRTCStore.getState().peers["c"];
    expect(peerInfo).toBeDefined();
    expect(peerInfo.isOfferer).toBe(false);

    const pcInstance = (RTCPeerConnection as any).lastInstance;
    expect(pcInstance).toBeDefined();
    // Answerer should not create data channel or send offer, but should send targeted announce back
    expect(pcInstance.createDataChannel).not.toHaveBeenCalled();
    expect(pcInstance.createOffer).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith({
      type: "announce",
      senderId: "b",
      targetId: "c",
    });
  });

  it("should set remote description and send answer on handleOffer", async () => {
    // Simulate receiving an offer from "a"
    await (webRTCManager as any).handleOffer("a", "remote-sdp-offer");

    const pcInstance = (RTCPeerConnection as any).lastInstance;
    expect(pcInstance.setRemoteDescription).toHaveBeenCalledWith({
      type: "offer",
      sdp: "remote-sdp-offer",
    });
    expect(pcInstance.createAnswer).toHaveBeenCalled();
    expect(pcInstance.setLocalDescription).toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith({
      type: "answer",
      senderId: "b",
      targetId: "a",
      sdp: "mock-sdp-answer",
    });
  });

  it("should polite/impolite tiebreak offer collision (ignore offer if impolite)", async () => {
    // local ("b") > remote ("a") -> local is impolite
    // Initialize connection first by receiving announce
    webRTCManager.handleSignalingMessage({
      type: "announce",
      senderId: "a",
    });

    await flushPromises();

    const pcInstance = (RTCPeerConnection as any).lastInstance;
    // Set state simulating we are waiting for answer / not stable
    pcInstance.signalingState = "have-local-offer";
    (webRTCManager as any).peers.get("a").makingOffer = true;

    // Impolite peer receives colliding offer -> should ignore
    await (webRTCManager as any).handleOffer("a", "colliding-remote-sdp-offer");

    // setRemoteDescription should NOT have been called with the colliding offer
    expect(pcInstance.setRemoteDescription).not.toHaveBeenCalledWith({
      type: "offer",
      sdp: "colliding-remote-sdp-offer",
    });
  });

  it("should set remote description on handleAnswer", async () => {
    // Announce to initialize
    webRTCManager.handleSignalingMessage({
      type: "announce",
      senderId: "a",
    });

    await flushPromises();

    const pcInstance = (RTCPeerConnection as any).lastInstance;

    await (webRTCManager as any).handleAnswer("a", "remote-sdp-answer");

    expect(pcInstance.setRemoteDescription).toHaveBeenLastCalledWith({
      type: "answer",
      sdp: "remote-sdp-answer",
    });
  });

  it("should add ICE candidates once connection is initialized", async () => {
    // Announce to initialize
    webRTCManager.handleSignalingMessage({
      type: "announce",
      senderId: "a",
    });

    await flushPromises();

    const pcInstance = (RTCPeerConnection as any).lastInstance;
    // Set remote description so candidate is added immediately
    pcInstance.remoteDescription = { type: "offer", sdp: "remote-sdp" };

    await (webRTCManager as any).handleCandidate(
      "a",
      "candidate-data",
      "sdp-mid-0"
    );

    expect(pcInstance.addIceCandidate).toHaveBeenCalledWith({
      candidate: "candidate-data",
      sdpMid: "sdp-mid-0",
      sdpMLineIndex: 0,
    });
  });

  it("should queue ICE candidates when remoteDescription is not set and process them later", async () => {
    // Announce to initialize
    webRTCManager.handleSignalingMessage({
      type: "announce",
      senderId: "a",
    });

    await flushPromises();

    const pcInstance = (RTCPeerConnection as any).lastInstance;

    // Call handleCandidate when remoteDescription is null/unset
    await (webRTCManager as any).handleCandidate(
      "a",
      "queued-candidate-data",
      "sdp-mid-1"
    );

    // expect addIceCandidate not to have been called yet
    expect(pcInstance.addIceCandidate).not.toHaveBeenCalled();

    // Now set remote description via handleAnswer
    await (webRTCManager as any).handleAnswer("a", "remote-sdp-answer");

    // expect queued candidate to be processed
    expect(pcInstance.addIceCandidate).toHaveBeenCalledWith({
      candidate: "queued-candidate-data",
      sdpMid: "sdp-mid-1",
      sdpMLineIndex: 0,
    });
  });

  it("should clean up peer on leave signaling message", async () => {
    webRTCManager.handleSignalingMessage({
      type: "announce",
      senderId: "a",
    });

    await flushPromises();

    expect(useWebRTCStore.getState().peers["a"]).toBeDefined();

    webRTCManager.handleSignalingMessage({
      type: "leave",
      senderId: "a",
    });

    expect(useWebRTCStore.getState().peers["a"]).toBeUndefined();
  });
});
