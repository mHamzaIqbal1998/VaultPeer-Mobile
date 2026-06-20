/* global jest */
jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: jest.fn().mockResolvedValue(true),
  isEnrolledAsync: jest.fn().mockResolvedValue(true),
  authenticateAsync: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue("mock-password"),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("react-native-webrtc", () => {
  return {
    RTCPeerConnection: jest.fn().mockImplementation(() => ({
      createOffer: jest.fn().mockResolvedValue({ type: "offer", sdp: "" }),
      createAnswer: jest.fn().mockResolvedValue({ type: "answer", sdp: "" }),
      setLocalDescription: jest.fn().mockResolvedValue(undefined),
      setRemoteDescription: jest.fn().mockResolvedValue(undefined),
      addIceCandidate: jest.fn().mockResolvedValue(undefined),
      createDataChannel: jest.fn().mockImplementation(() => ({
        send: jest.fn(),
        close: jest.fn(),
      })),
      close: jest.fn(),
    })),
    RTCSessionDescription: jest.fn().mockImplementation((init) => init),
    RTCIceCandidate: jest.fn().mockImplementation((init) => init),
  };
});
