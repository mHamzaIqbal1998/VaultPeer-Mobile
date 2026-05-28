import React, { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useVaultStore } from "@/src/stores/useVaultStore";
import {
  useThemeColors,
  Fonts,
  FontSizes,
  Spacing,
} from "@/src/constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { cancelRequest } from "@/modules/vaultpeer-autofill";

export default function AutofillSaveScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{
    username?: string;
    password?: string;
    packageName?: string;
    domain?: string;
  }>();

  const { _db: db, setPendingAutofillSave } = useVaultStore();

  useEffect(() => {
    const checkAndRoute = async () => {
      const username = params.username || "";
      const password = params.password || "";
      const packageName = params.packageName || "";
      const domain = params.domain || "";

      try {
        const storedStr = await SecureStore.getItemAsync("last_processed_save");
        if (storedStr) {
          const stored = JSON.parse(storedStr);
          const isMatch =
            stored.username === username &&
            stored.password === password &&
            stored.packageName === packageName &&
            Date.now() - stored.timestamp < 300000; // 5 minutes

          if (isMatch) {
            console.log(
              "Autofill Save - Duplicate launch from Recents history. Redirecting to safety."
            );
            if (db) {
              router.replace("/vault");
            } else {
              router.replace("/");
            }
            setTimeout(async () => {
              try {
                await cancelRequest();
              } catch (e) {
                console.error("Autofill Save - cancelRequest failed:", e);
              }
            }, 100);
            return;
          }
        }
      } catch (err) {
        console.error("Autofill Save - Error checking SecureStore:", err);
      }

      if (db) {
        // Vault is already unlocked, navigate straight to the new entry creation screen
        router.replace({
          pathname: "/entry/edit",
          params: {
            groupId: db.getDefaultGroup().uuid.id,
            autofillUsername: username,
            autofillPassword: password,
            autofillPackageName: packageName,
            autofillDomain: domain,
          },
        });
      } else {
        // Vault is locked. Store the credentials payload as pending and navigate to unlock
        setPendingAutofillSave({
          username,
          password,
          packageName,
          domain,
        });
        router.replace("/");
      }
    };

    checkAndRoute();
  }, [db, params, router, setPendingAutofillSave]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.backgroundPrimary }]}
    >
      <View style={styles.content}>
        <ActivityIndicator size="large" color={colors.accentMint} />
        <View style={styles.textContainer}>
          <Ionicons
            name="key-outline"
            size={24}
            color={colors.accentMint}
            style={styles.icon}
          />
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            Saving Credentials
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Analyzing password entry from Autofill Service...
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  textContainer: {
    marginTop: Spacing.xl,
    alignItems: "center",
  },
  icon: {
    marginBottom: Spacing.sm,
  },
  title: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.subheading,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    textAlign: "center",
  },
});
