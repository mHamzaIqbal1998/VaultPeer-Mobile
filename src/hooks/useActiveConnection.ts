import { useEffect, useCallback, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSignalingStore } from "../stores/useSignalingStore";

/** Grace period before tearing down connections when backgrounded (ms). */
const BACKGROUND_GRACE_MS = 30_000;

/**
 * Custom hook to ensure signaling WebSocket connects/reconnects actively
 * when the screen is focused or the app returns to the foreground.
 *
 * When the app goes to background, connections are kept alive for a grace
 * period (30s) to survive brief app switches without losing in-flight
 * transfers. Only if the app remains backgrounded beyond the grace period
 * are connections torn down.
 */
export function useActiveConnection() {
  const lastAppState = useRef<AppStateStatus>(AppState.currentState);
  const backgroundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelBackgroundTimer = useCallback(() => {
    if (backgroundTimer.current) {
      clearTimeout(backgroundTimer.current);
      backgroundTimer.current = null;
    }
  }, []);

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
          "[useActiveConnection] App returned to foreground, cancelling background timer & forcing reconnect"
        );
        cancelBackgroundTimer();
        checkAndConnect(true);
      } else if (nextAppState === "background") {
        console.log(
          `[useActiveConnection] App went to background, scheduling disconnect in ${BACKGROUND_GRACE_MS / 1000}s`
        );
        cancelBackgroundTimer();
        backgroundTimer.current = setTimeout(() => {
          console.log(
            "[useActiveConnection] Background grace period expired, disconnecting"
          );
          const { disconnect } = useSignalingStore.getState();
          disconnect();
        }, BACKGROUND_GRACE_MS);
      }
      lastAppState.current = nextAppState;
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    );
    return () => {
      cancelBackgroundTimer();
      subscription.remove();
    };
  }, [checkAndConnect, cancelBackgroundTimer]);
}
