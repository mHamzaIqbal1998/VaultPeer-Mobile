import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { View, StyleSheet } from "react-native";
import { useThemeColors } from "@/src/constants/theme";
import { initCryptoEngine } from "@/src/services/crypto";
import { FilePickerProvider } from "@/src/context/FilePickerContext";
import { AppSecurityWrapper } from "@/src/components/AppSecurityWrapper";
import { useVaultStore } from "@/src/stores/useVaultStore";

/* eslint-disable */
// Silence expo-keep-awake unhandled promise rejections on Android dev builds
const isDev = typeof __DEV__ !== "undefined" && __DEV__;
if (isDev) {
  const customTrackingOptions = {
    allRejections: true,
    onUnhandled: (id: any, rejection: any) => {
      let message = "";
      let stack: string | undefined;
      if (rejection instanceof Error) {
        message = `${rejection.name}: ${rejection.message}`;
        stack = rejection.stack;
      } else {
        message =
          typeof rejection === "string" ? rejection : JSON.stringify(rejection);
      }

      if (message && message.toLowerCase().includes("keep awake")) {
        return;
      }

      const warning = `Possible unhandled promise rejection (id: ${id}):\n${message}`;
      try {
        const LogBox = require("react-native").LogBox;
        if (LogBox && typeof LogBox.addLog === "function") {
          LogBox.addLog({
            level: "warn",
            message: {
              content: warning,
              substitutions: [],
            },
            componentStack: [],
            componentStackType: null,
            stack,
            category: "possible_unhandled_promise_rejection",
          });
        } else {
          console.warn(warning);
        }
      } catch {
        console.warn(warning);
      }
    },
    onHandled: (id: any) => {
      const warning =
        `Promise rejection handled (id: ${id})\n` +
        "This means you can ignore any previous messages of the form " +
        `"Possible unhandled promise rejection (id: ${id}):"`;
      console.warn(warning);
    },
  };

  if (
    typeof HermesInternal !== "undefined" &&
    HermesInternal &&
    (HermesInternal as any).enablePromiseRejectionTracker
  ) {
    (HermesInternal as any).enablePromiseRejectionTracker(
      customTrackingOptions
    );
  } else {
    try {
      require("promise/setimmediate/rejection-tracking").enable(
        customTrackingOptions
      );
    } catch {}
  }
}
/* eslint-enable */

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [appReady, setAppReady] = useState(false);
  const colors = useThemeColors();

  useEffect(() => {
    async function prepare() {
      try {
        // Load custom fonts
        await Font.loadAsync({
          "Inter-Light": require("@/assets/fonts/Inter-Light.ttf"),
          "Inter-Regular": require("@/assets/fonts/Inter-Regular.ttf"),
          "Inter-Medium": require("@/assets/fonts/Inter-Medium.ttf"),
          "Inter-SemiBold": require("@/assets/fonts/Inter-SemiBold.ttf"),
          "SpaceMono-Regular": require("@/assets/fonts/SpaceMono-Regular.ttf"),
        });

        // Initialize the cryptographic engine (registers native Argon2)
        initCryptoEngine();

        // Load persisted app settings (theme, timeouts)
        await useVaultStore.getState().loadAppSettings();
      } catch (error) {
        console.warn("[RootLayout] Initialization error:", error);
      } finally {
        setAppReady(true);
      }
    }

    prepare();
  }, []);

  useEffect(() => {
    if (appReady) {
      SplashScreen.hideAsync();
    }
  }, [appReady]);

  if (!appReady) {
    // Return an empty view matching the splash screen background
    // to avoid a white flash during loading
    return (
      <View
        style={[styles.loading, { backgroundColor: colors.backgroundPrimary }]}
      />
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: colors.backgroundPrimary }]}
    >
      <StatusBar
        style={colors.theme === "dark" ? "light" : "dark"}
        backgroundColor={colors.backgroundPrimary}
      />
      <FilePickerProvider>
        <AppSecurityWrapper>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.backgroundPrimary },
              animation: "fade",
            }}
          />
        </AppSecurityWrapper>
      </FilePickerProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
  },
});
