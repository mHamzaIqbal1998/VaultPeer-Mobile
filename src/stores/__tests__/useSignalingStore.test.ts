import { useSignalingStore } from "../useSignalingStore";
import * as SecureStore from "expo-secure-store";

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "mock-uuid-abc-123"),
}));

class MockWebSocket {
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  send = jest.fn();
  close = jest.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.lastInstance = this;
  }

  static lastInstance: MockWebSocket | null = null;
}

(global as any).WebSocket = MockWebSocket;

describe("useSignalingStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSignalingStore.setState({
      serverUrl: "ws://10.0.2.2:8080",
      roomId: "",
      connectionStatus: "offline",
      isConfigured: false,
    });
    MockWebSocket.lastInstance = null;
  });

  it("should initialize with default state", () => {
    const state = useSignalingStore.getState();
    expect(state.serverUrl).toBe("ws://10.0.2.2:8080");
    expect(state.roomId).toBe("");
    expect(state.connectionStatus).toBe("offline");
    expect(state.isConfigured).toBe(false);
  });

  it("should load settings from SecureStore", async () => {
    const mockGetItem = SecureStore.getItemAsync as jest.Mock;
    mockGetItem.mockImplementation((key: string) => {
      if (key === "vault_signaling_server_url")
        return Promise.resolve("ws://example.com");
      if (key === "vault_signaling_room_id")
        return Promise.resolve("persisted-room-id");
      if (key === "vault_signaling_is_configured")
        return Promise.resolve("true");
      return Promise.resolve(null);
    });

    const store = useSignalingStore.getState();
    await store.loadSettings();

    const state = useSignalingStore.getState();
    expect(state.serverUrl).toBe("ws://example.com");
    expect(state.roomId).toBe("persisted-room-id");
    expect(state.isConfigured).toBe(true);
    expect(state.connectionStatus).toBe("connecting");
    expect(MockWebSocket.lastInstance).not.toBeNull();
    expect(MockWebSocket.lastInstance?.url).toBe("ws://example.com");
  });

  it("should persist and update configurations", async () => {
    const mockSetItem = SecureStore.setItemAsync as jest.Mock;
    const store = useSignalingStore.getState();

    await store.setServerUrl("ws://new-server:3000");
    expect(useSignalingStore.getState().serverUrl).toBe("ws://new-server:3000");
    expect(mockSetItem).toHaveBeenCalledWith(
      "vault_signaling_server_url",
      "ws://new-server:3000"
    );

    await store.setRoomId("custom-room-id");
    expect(useSignalingStore.getState().roomId).toBe("custom-room-id");
    expect(mockSetItem).toHaveBeenCalledWith(
      "vault_signaling_room_id",
      "custom-room-id"
    );

    await store.setIsConfigured(true);
    expect(useSignalingStore.getState().isConfigured).toBe(true);
    expect(mockSetItem).toHaveBeenCalledWith(
      "vault_signaling_is_configured",
      "true"
    );
  });

  it("should connect, send join room message, and reply to ping with pong", async () => {
    const store = useSignalingStore.getState();
    await store.setRoomId("room-123");
    await store.setIsConfigured(true);

    const state = useSignalingStore.getState();
    expect(state.connectionStatus).toBe("connecting");
    const wsInstance = MockWebSocket.lastInstance;
    expect(wsInstance).not.toBeNull();

    // Simulate connection open
    wsInstance?.onopen?.();
    expect(useSignalingStore.getState().connectionStatus).toBe("connected");
    expect(wsInstance?.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "join", roomId: "room-123" })
    );

    // Simulate receiving ping message
    wsInstance?.onmessage?.({ data: JSON.stringify({ type: "ping" }) });
    expect(wsInstance?.send).toHaveBeenLastCalledWith(
      JSON.stringify({ type: "pong" })
    );
  });

  it("should generate a room UUID and join on createRoom", async () => {
    const store = useSignalingStore.getState();
    const createdId = await store.createRoom();

    expect(createdId).toBe("mock-uuid-abc-123");
    expect(useSignalingStore.getState().roomId).toBe("mock-uuid-abc-123");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "vault_signaling_room_id",
      "mock-uuid-abc-123"
    );
  });

  it("should disconnect and cleanup websocket", async () => {
    const store = useSignalingStore.getState();
    await store.setIsConfigured(true);
    const wsInstance = MockWebSocket.lastInstance;
    expect(wsInstance).not.toBeNull();

    store.disconnect();
    expect(useSignalingStore.getState().connectionStatus).toBe("offline");
    expect(wsInstance?.close).toHaveBeenCalled();
  });

  it("should send leave payload and clear roomId on leaveRoom", async () => {
    const store = useSignalingStore.getState();
    await store.setRoomId("room-abc");
    await store.setIsConfigured(true);

    const wsInstance = MockWebSocket.lastInstance;
    wsInstance?.onopen?.();

    await store.leaveRoom();
    expect(wsInstance?.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "leave" })
    );
    expect(useSignalingStore.getState().roomId).toBe("");
  });

  it("should capture lastError on websocket errors", async () => {
    const store = useSignalingStore.getState();
    await store.setIsConfigured(true);

    const wsInstance = MockWebSocket.lastInstance;
    expect(useSignalingStore.getState().lastError).toBeNull();

    // Trigger error
    wsInstance?.onerror?.({ message: "Connection refused" });
    expect(useSignalingStore.getState().lastError).toBe(
      "WebSocket connection failed. Verify URL and server state."
    );
  });
});
