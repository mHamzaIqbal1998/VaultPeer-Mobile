import { handleSignalingMessage } from "../webrtcManager";
import { getLkm, setLkm, clearLkm } from "../lkmStore";
import * as SecureStore from "expo-secure-store";
import { useSignalingStore } from "../../../stores/useSignalingStore";
import * as useSignalingStoreModule from "../../../stores/useSignalingStore";
import { useVaultStore } from "../../../stores/useVaultStore";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
} from "react-native-webrtc";

jest.mock("vaultpeer-file-system", () => ({
  readFile: jest.fn().mockResolvedValue("mock-file-base64"),
  writeFile: jest.fn().mockResolvedValue(true),
}));

jest.mock("kdbxweb", () => {
  const mockLoad = jest.fn().mockResolvedValue({
    meta: { name: "Decrypted DB" },
  });
  return {
    __esModule: true,
    Kdbx: {
      load: mockLoad,
    },
  };
});

describe("WebRTC Sync Protocol & LKM Store", () => {
  let createdInstances: any[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    createdInstances = [];

    // Mock RTCSessionDescription and RTCIceCandidate to preserve the data passed to their constructors
    (RTCSessionDescription as any).mockImplementation((arg: any) => arg);
    (RTCIceCandidate as any).mockImplementation((arg: any) => arg);

    // Custom implementation of RTCPeerConnection mock to track returned objects
    (RTCPeerConnection as any).mockImplementation(() => {
      const pc = {
        createDataChannel: jest.fn().mockReturnValue({
          send: jest.fn(),
          close: jest.fn(),
          readyState: "open",
        }),
        createOffer: jest
          .fn()
          .mockResolvedValue({ type: "offer", sdp: "local-offer" }),
        createAnswer: jest
          .fn()
          .mockResolvedValue({ type: "answer", sdp: "local-answer" }),
        setLocalDescription: jest.fn().mockResolvedValue(undefined),
        setRemoteDescription: jest.fn().mockResolvedValue(undefined),
        addIceCandidate: jest.fn().mockResolvedValue(undefined),
        close: jest.fn(),
      };
      createdInstances.push(pc);
      return pc;
    });

    useSignalingStore.setState({
      myId: "clientA",
      roomId: "room123",
      connectionStatus: "connected",
    });
    useVaultStore.setState({
      _db: {
        credentials: {} as any,
      } as any,
    } as any);
  });

  describe("LKM Store", () => {
    it("should return 0 when no logical timestamp is stored", async () => {
      jest.spyOn(SecureStore, "getItemAsync").mockResolvedValue(null);
      const timestamp = await getLkm("file://vault.kdbx");
      expect(timestamp).toBe(0);
    });

    it("should save and retrieve logical timestamps", async () => {
      jest.spyOn(SecureStore, "getItemAsync").mockResolvedValue("1716000000");
      const mockSetItem = jest
        .spyOn(SecureStore, "setItemAsync")
        .mockResolvedValue(undefined);

      await setLkm("file://vault.kdbx", 1716000000);
      expect(mockSetItem).toHaveBeenCalledWith(
        expect.stringContaining("vault_lkm_"),
        "1716000000"
      );

      const timestamp = await getLkm("file://vault.kdbx");
      expect(timestamp).toBe(1716000000);
    });

    it("should delete stored timestamps", async () => {
      const mockDeleteItem = jest
        .spyOn(SecureStore, "deleteItemAsync")
        .mockResolvedValue(undefined);
      await clearLkm("file://vault.kdbx");
      expect(mockDeleteItem).toHaveBeenCalled();
    });
  });

  describe("Signaling Conflict Resolution", () => {
    it("should initiate offer if remoteId is lexicographically smaller (impolite)", async () => {
      const mockSendMessage = jest
        .spyOn(useSignalingStoreModule, "sendSignalingMessage")
        .mockImplementation(() => {});

      // clientA (myId) > client9 (remoteId) => Impolite (Offerer)
      await handleSignalingMessage({
        type: "announce",
        senderId: "client9",
      });

      // Verification: Should instantiate RTCPeerConnection and send offer
      expect(RTCPeerConnection).toHaveBeenCalled();
      mockSendMessage.mockRestore();
    });

    it("should send targeted announce if remoteId is lexicographically greater (polite)", async () => {
      const mockSendMessage = jest
        .spyOn(useSignalingStoreModule, "sendSignalingMessage")
        .mockImplementation(() => {});

      // clientA (myId) < clientB (remoteId) => Polite (Answerer)
      await handleSignalingMessage({
        type: "announce",
        senderId: "clientB",
      });

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: "announce",
        senderId: "clientA",
        targetId: "clientB",
      });
      mockSendMessage.mockRestore();
    });
  });

  describe("Dual-Format Signaling Parser", () => {
    it("should parse flat headless-style offers", async () => {
      // 1. Announce to instantiate the connection
      await handleSignalingMessage({
        type: "announce",
        senderId: "client0",
      });

      // 2. Send offer in headless format (with sdp field directly under message)
      await handleSignalingMessage({
        type: "offer",
        senderId: "client0",
        sdp: "headless-offer-sdp",
      });

      // Grab the latest created peer connection instance
      const latestPc = createdInstances[createdInstances.length - 1];

      expect(latestPc.setRemoteDescription).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "offer",
          sdp: "headless-offer-sdp",
        })
      );
    });

    it("should parse flat headless-style ICE candidates", async () => {
      // 1. Announce to instantiate the connection
      await handleSignalingMessage({
        type: "announce",
        senderId: "client0",
      });

      // 2. Send candidate in headless format
      await handleSignalingMessage({
        type: "candidate",
        senderId: "client0",
        candidate: "candidate:12345",
        mid: "0",
      });

      const latestPc = createdInstances[createdInstances.length - 1];

      expect(latestPc.addIceCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          candidate: "candidate:12345",
          sdpMid: "0",
          sdpMLineIndex: 0,
        })
      );
    });
  });
});
