import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { View, StyleSheet } from "react-native";
import { Colors } from "@/src/constants/theme";
import { initCryptoEngine } from "@/src/services/crypto";
import { FilePickerProvider } from "@/src/context/FilePickerContext";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [appReady, setAppReady] = useState(false);

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
    return <View style={styles.loading} />;
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor={Colors.backgroundPrimary} />
      <FilePickerProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Colors.backgroundPrimary },
            animation: "fade",
          }}
        />
      </FilePickerProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.backgroundPrimary,
  },
  loading: {
    flex: 1,
    backgroundColor: Colors.backgroundPrimary,
  },
});
