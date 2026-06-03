import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { webRTCManager } from "../services/webrtc/webRTCManager";

export type ConnectionStatus =
  | "offline"
  | "disconnected"
  | "connecting"
  | "connected";
export type SyncMode = "offline" | "network" | null;

interface SignalingStoreState {
  // ── State Properties ──
  clientId: string;
  serverUrl: string;
  roomId: string;
  connectionStatus: ConnectionStatus;
  isConfigured: boolean;
  syncMode: SyncMode;
  lastError: string | null;
  iceServers: any[];

  // ── Actions ──
  setServerUrl: (url: string) => Promise<void>;
  setRoomId: (roomId: string) => Promise<void>;
  setIsConfigured: (configured: boolean) => Promise<void>;
  setSyncMode: (mode: SyncMode) => Promise<void>;
  setIceServers: (iceServers: any[]) => Promise<void>;
  loadSettings: () => Promise<void>;
  connect: () => void;
  disconnect: () => void;
  createRoom: () => Promise<string>;
  joinRoom: (roomId: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  sendMessage: (msg: any) => void;
}

let ws: WebSocket | null = null;
let reconnectTimer: any = null;
let backoffTime = 1000;
const MAX_BACKOFF = 30000;

export const useSignalingStore = create<SignalingStoreState>((set, get) => {
  const cleanSocket = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      } catch (e) {
        console.warn("[SignalingStore] Error closing websocket:", e);
      }
      ws = null;
    }
  };

  const attemptConnect = () => {
    const { serverUrl, isConfigured, roomId, clientId } = get();

    if (!isConfigured) {
      set({ connectionStatus: "offline", lastError: null });
      cleanSocket();
      return;
    }

    cleanSocket();
    set({ connectionStatus: "connecting", lastError: null });

    try {
      ws = new WebSocket(serverUrl);

      ws.onopen = () => {
        set({ connectionStatus: "connected", lastError: null });
        backoffTime = 1000; // Reset backoff on successful connection
        if (roomId) {
          try {
            // Join signaling room
            ws?.send(JSON.stringify({ type: "join", roomId }));
            // Announce presence to other peers in the room
            ws?.send(JSON.stringify({ type: "announce", senderId: clientId }));
          } catch (err) {
            console.warn(
              "[SignalingStore] Failed to send join/announce messages:",
              err
            );
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message && message.type === "ping") {
            ws?.send(JSON.stringify({ type: "pong" }));
          } else if (message) {
            webRTCManager.handleSignalingMessage(message);
          }
        } catch (e) {
          console.warn("[SignalingStore] Failed to parse message:", e);
        }
      };

      ws.onclose = () => {
        set({ connectionStatus: "disconnected" });
        scheduleReconnect();
      };

      ws.onerror = (error) => {
        console.warn("[SignalingStore] WebSocket error:", error);
        set({
          lastError:
            "WebSocket connection failed. Verify URL and server state.",
        });
        // Let onclose handle reconnect
      };
    } catch (err) {
      console.warn("[SignalingStore] Failed to create WebSocket:", err);
      set({ connectionStatus: "disconnected", lastError: String(err) });
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);

    const { isConfigured } = get();
    if (!isConfigured) return;

    reconnectTimer = setTimeout(() => {
      attemptConnect();
      backoffTime = Math.min(backoffTime * 2, MAX_BACKOFF);
    }, backoffTime);
  };

  return {
    // ── Initial State ──
    clientId: "",
    serverUrl: "ws://10.0.2.2:8080", // Default Android emulator host address
    roomId: "",
    connectionStatus: "offline",
    isConfigured: false,
    syncMode: null,
    lastError: null,
    iceServers: [],

    // ── Actions ──
    setServerUrl: async (url) => {
      try {
        await SecureStore.setItemAsync("vault_signaling_server_url", url);
        set({ serverUrl: url });
        if (get().isConfigured) {
          attemptConnect();
        }
      } catch (e) {
        console.warn("[SignalingStore] Failed to save serverUrl:", e);
      }
    },

    setRoomId: async (roomId) => {
      try {
        await SecureStore.setItemAsync("vault_signaling_room_id", roomId);
        set({ roomId });
        if (get().connectionStatus === "connected" && roomId) {
          ws?.send(JSON.stringify({ type: "join", roomId }));
          ws?.send(
            JSON.stringify({ type: "announce", senderId: get().clientId })
          );
        }
      } catch (e) {
        console.warn("[SignalingStore] Failed to save roomId:", e);
      }
    },

    setIsConfigured: async (configured) => {
      try {
        await SecureStore.setItemAsync(
          "vault_signaling_is_configured",
          configured ? "true" : "false"
        );
        set({ isConfigured: configured });
        if (configured) {
          attemptConnect();
        } else {
          cleanSocket();
          webRTCManager.destroy();
          set({ connectionStatus: "offline", lastError: null });
        }
      } catch (e) {
        console.warn("[SignalingStore] Failed to save isConfigured:", e);
      }
    },

    setSyncMode: async (mode) => {
      try {
        if (mode) {
          await SecureStore.setItemAsync("vault_sync_mode", mode);
        } else {
          await SecureStore.deleteItemAsync("vault_sync_mode");
        }
        set({ syncMode: mode });
      } catch (e) {
        console.warn("[SignalingStore] Failed to save syncMode:", e);
      }
    },

    setIceServers: async (iceServers) => {
      try {
        await SecureStore.setItemAsync(
          "vault_ice_servers",
          JSON.stringify(iceServers)
        );
        set({ iceServers });
      } catch (e) {
        console.warn("[SignalingStore] Failed to save iceServers:", e);
      }
    },

    loadSettings: async () => {
      try {
        const storedUrl = await SecureStore.getItemAsync(
          "vault_signaling_server_url"
        );
        const storedRoomId = await SecureStore.getItemAsync(
          "vault_signaling_room_id"
        );
        const storedConfigured = await SecureStore.getItemAsync(
          "vault_signaling_is_configured"
        );
        const storedSyncMode =
          await SecureStore.getItemAsync("vault_sync_mode");
        const storedIceServers =
          await SecureStore.getItemAsync("vault_ice_servers");

        let storedClientId = await SecureStore.getItemAsync("vault_client_id");
        if (!storedClientId) {
          storedClientId = Crypto.randomUUID();
          await SecureStore.setItemAsync("vault_client_id", storedClientId);
        }

        const updates: Partial<SignalingStoreState> = {
          clientId: storedClientId,
          iceServers: [],
        };
        if (storedUrl) {
          updates.serverUrl = storedUrl;
        }
        if (storedRoomId) {
          updates.roomId = storedRoomId;
        }
        if (storedConfigured) {
          updates.isConfigured = storedConfigured === "true";
        }
        if (storedSyncMode === "offline" || storedSyncMode === "network") {
          updates.syncMode = storedSyncMode;
        }
        if (storedIceServers) {
          try {
            const parsed = JSON.parse(storedIceServers);
            if (Array.isArray(parsed)) {
              updates.iceServers = parsed;
            }
          } catch (e) {
            console.warn(
              "[SignalingStore] Failed to parse stored iceServers:",
              e
            );
          }
        }

        set(updates);

        if (updates.isConfigured) {
          attemptConnect();
        } else {
          set({ connectionStatus: "offline", lastError: null });
        }
      } catch (e) {
        console.warn("[SignalingStore] Failed to load signaling settings:", e);
      }
    },

    connect: () => {
      attemptConnect();
    },

    disconnect: () => {
      cleanSocket();
      webRTCManager.destroy();
      set({ connectionStatus: "offline", lastError: null });
    },

    createRoom: async () => {
      const generatedRoomId = Crypto.randomUUID();
      await get().setRoomId(generatedRoomId);
      return generatedRoomId;
    },

    joinRoom: async (roomId) => {
      await get().setRoomId(roomId);
    },

    leaveRoom: async () => {
      const { roomId, clientId } = get();
      if (!roomId) return;

      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "leave", senderId: clientId }));
        } catch (e) {
          console.warn("[SignalingStore] Failed to send leave message:", e);
        }
      }
      webRTCManager.destroy();
      await get().setRoomId("");
    },

    sendMessage: (msg: any) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(msg));
        } catch (err) {
          console.warn(
            "[SignalingStore] Error sending signaling message:",
            err
          );
        }
      }
    },
  };
});
