import { useEffect, useCallback, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSignalingStore } from "../stores/useSignalingStore";

/**
 * Custom hook to ensure signaling WebSocket connects/reconnects actively
 * when the screen is focused or the app returns to the foreground.
 */
export function useActiveConnection() {
  const lastAppState = useRef<AppStateStatus>(AppState.currentState);

  const checkAndConnect = useCallback((force = false) => {
    const { syncMode, isConfigured, connectionStatus, connect } =
      useSignalingStore.getState();

    if (syncMode === "network" && isConfigured) {
      if (
        force ||
        (connectionStatus !== "connected" && connectionStatus !== "connecting")
      ) {
        console.log(
          `[useActiveConnection] Triggering connect (force: ${force}, status: ${connectionStatus})`
        );
        connect();
      }
    }
  }, []);

  // 1. Trigger check when screen is focused
  useFocusEffect(
    useCallback(() => {
      checkAndConnect(false);
    }, [checkAndConnect])
  );

  // 2. Trigger check when app returns to foreground or goes to background
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        lastAppState.current.match(/inactive|background/) &&
        nextAppState === "active"
      ) {
        console.log(
          "[useActiveConnection] App returned to foreground, forcing reconnect"
        );
        checkAndConnect(true);
      } else if (nextAppState === "background") {
        console.log(
          "[useActiveConnection] App went to background, disconnecting signaling and destroying peer connections"
        );
        const { disconnect } = useSignalingStore.getState();
        disconnect();
      }
      lastAppState.current = nextAppState;
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    );
    return () => {
      subscription.remove();
    };
  }, [checkAndConnect]);
}
