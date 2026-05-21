import React, { useEffect, useRef, useCallback } from "react";
import { AppState, View, StyleSheet, AppStateStatus } from "react-native";
import { useVaultStore } from "@/src/stores/useVaultStore";

interface AppSecurityWrapperProps {
  children: React.ReactNode;
}

/**
 * Global wrapper to enforce application security:
 * 1. Purges the database from memory if the app goes to the background.
 * 2. Auto-locks/purges the database after 60 seconds of user touch inactivity.
 */
export function AppSecurityWrapper({ children }: AppSecurityWrapperProps) {
  const { closeDatabase, _db: db } = useVaultStore();
  const inactivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const lockDatabase = useCallback(() => {
    if (db) {
      console.log(
        "[AppSecurityWrapper] Auto-locking vault due to security trigger."
      );
      closeDatabase();
    }
  }, [db, closeDatabase]);

  // AppState background/inactive listener
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        lockDatabase();
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    );

    return () => {
      subscription.remove();
    };
  }, [lockDatabase]);

  // Inactivity timeout reset
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
    }
    if (db) {
      // Auto-lock after 60 seconds of inactivity
      inactivityTimeoutRef.current = setTimeout(() => {
        lockDatabase();
      }, 60000);
    }
  }, [db, lockDatabase]);

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
