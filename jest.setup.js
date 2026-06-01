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

jest.mock("react-native-webrtc", () => ({
  RTCPeerConnection: jest.fn().mockImplementation(() => ({
    createDataChannel: jest.fn().mockReturnValue({
      send: jest.fn(),
      close: jest.fn(),
      readyState: "open",
    }),
    createOffer: jest.fn().mockResolvedValue({}),
    createAnswer: jest.fn().mockResolvedValue({}),
    setLocalDescription: jest.fn().mockResolvedValue({}),
    setRemoteDescription: jest.fn().mockResolvedValue({}),
    addIceCandidate: jest.fn().mockResolvedValue({}),
    close: jest.fn(),
  })),
  RTCIceCandidate: jest.fn(),
  RTCSessionDescription: jest.fn(),
}));

jest.mock("react-native-argon2-turbo", () => ({
  hash: jest.fn(),
}));
