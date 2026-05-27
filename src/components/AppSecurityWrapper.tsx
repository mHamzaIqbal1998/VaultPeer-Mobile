import React, { useEffect, useRef, useCallback } from "react";
import { AppState, View, StyleSheet, AppStateStatus } from "react-native";
import { useVaultStore } from "@/src/stores/useVaultStore";

interface AppSecurityWrapperProps {
  children: React.ReactNode;
}

// Security constants
const GRACE_PERIOD_MS = 30000; // 30 seconds grace period for background/inactive states

/**
 * Global wrapper to enforce application security:
 * 1. Purges the database from memory if the app goes to the background.
 * 2. Auto-locks/purges the database after user touch inactivity.
 */
export function AppSecurityWrapper({ children }: AppSecurityWrapperProps) {
  const { closeDatabase, _db: db, autoLockTimeout } = useVaultStore();
  const inactivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const backgroundTimeRef = useRef<number | null>(null);

  const lockDatabase = useCallback(() => {
    if (db) {
      console.log(
        "[AppSecurityWrapper] Auto-locking vault due to security trigger."
      );
      closeDatabase();
    }
  }, [db, closeDatabase]);

  // Inactivity timeout reset
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
    }
    if (db) {
      // Auto-lock after configured time of inactivity
      inactivityTimeoutRef.current = setTimeout(() => {
        lockDatabase();
      }, autoLockTimeout);
    }
  }, [db, lockDatabase, autoLockTimeout]);

  // AppState background/inactive listener
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        // Clear the foreground inactivity timer so it doesn't fire in the background
        if (inactivityTimeoutRef.current) {
          clearTimeout(inactivityTimeoutRef.current);
          inactivityTimeoutRef.current = null;
        }

        // Record the time the app was backgrounded/inactive
        if (backgroundTimeRef.current === null) {
          backgroundTimeRef.current = Date.now();
          console.log(
            `[AppSecurityWrapper] App state changed to ${nextAppState}. Starting background grace period.`
          );
        }
      } else if (nextAppState === "active") {
        // Check if we were backgrounded and if the grace period has expired
        if (backgroundTimeRef.current !== null) {
          const elapsed = Date.now() - backgroundTimeRef.current;
          backgroundTimeRef.current = null;

          if (elapsed > GRACE_PERIOD_MS) {
            console.log(
              `[AppSecurityWrapper] Grace period expired (${Math.round(
                elapsed / 1000
              )}s). Locking.`
            );
            lockDatabase();
          } else {
            console.log(
              `[AppSecurityWrapper] Resumed within grace period (${Math.round(
                elapsed / 1000
              )}s). Remaining unlocked.`
            );
            // Start a fresh inactivity timer
            resetInactivityTimer();
          }
        } else {
          // If we weren't backgrounded but transitioned to active, reset timer
          resetInactivityTimer();
        }
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    );

    return () => {
      subscription.remove();
    };
  }, [lockDatabase, resetInactivityTimer]);

  // Set/reset timer when database state changes
  useEffect(() => {
    resetInactivityTimer();
    return () => {
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
    };
  }, [db, resetInactivityTimer]);

  return (
    <View
      style={styles.container}
      onStartShouldSetResponderCapture={() => {
        resetInactivityTimer();
        return false; // Do not consume the touch, let child components handle it
      }}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
