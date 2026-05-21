import React, { useCallback, useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Colors,
  Fonts,
  FontSizes,
  Spacing,
  Radii,
  TouchTarget,
  Shadows,
} from "@/src/constants/theme";
import { useVaultStore } from "@/src/stores/useVaultStore";
import { useFilePicker } from "@/src/context/FilePickerContext";
import { parseMeta } from "@/src/services/crypto";
import { CyberCard } from "@/src/components/CyberCard";
import {
  isBiometricsSupported,
  isBiometricEnabled,
  enableBiometric,
  disableBiometric,
} from "@/src/services/biometricService";

// Helper: parse clean filename
function getFilenameFromUri(uri?: string): string {
  if (!uri) return "No active file path";
  try {
    const decoded = decodeURIComponent(uri);
    const parts = decoded.split(/[/\\]/);
    const lastPart = parts[parts.length - 1];
    if (lastPart.includes(":")) {
      const subParts = lastPart.split(":");
      return subParts[subParts.length - 1];
    }
    return lastPart || "vault.kdbx";
  } catch {
    return "vault.kdbx";
  }
}

export default function VaultSettingsScreen() {
  const router = useRouter();
  const {
    closeDatabase,
    _db: db,
    filePath: fileUri,
    isDirty,
    markClean,
  } = useVaultStore();
  const { clearVault, hasSavedVault, saveVault, loadVault } = useFilePicker();

  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [showBiometricPasswordInput, setShowBiometricPasswordInput] =
    useState(false);
  const [biometricPassword, setBiometricPassword] = useState("");

  useEffect(() => {
    async function checkBiometrics() {
      const supported = await isBiometricsSupported();
      const enabled = await isBiometricEnabled();
      setBiometricSupported(supported);
      setBiometricEnabled(enabled);
    }
    checkBiometrics();
  }, []);

  const handleToggleBiometric = useCallback(async () => {
    if (biometricEnabled) {
      await disableBiometric();
      setBiometricEnabled(false);
      setShowBiometricPasswordInput(false);
      setBiometricPassword("");
      Alert.alert("Success", "Biometric unlock disabled.");
    } else {
      setShowBiometricPasswordInput(true);
    }
  }, [biometricEnabled]);

  const handleConfirmBiometric = useCallback(async () => {
    if (!biometricPassword) {
      Alert.alert("Error", "Please enter your master password.");
      return;
    }
    try {
      const verifiedDb = await loadVault(biometricPassword);
      if (verifiedDb) {
        const success = await enableBiometric(biometricPassword);
        if (success) {
          setBiometricEnabled(true);
          setShowBiometricPasswordInput(false);
          setBiometricPassword("");
          Alert.alert("Success", "Biometric unlock enabled successfully.");
        } else {
          Alert.alert("Error", "Failed to enable biometric authentication.");
        }
      }
    } catch (e: any) {
      Alert.alert(
        "Verification Failed",
        e?.message || "Invalid master password."
      );
    }
  }, [biometricPassword, loadVault]);

  const stats = useMemo(() => {
    if (!db) return null;
    return parseMeta(db);
  }, [db]);

  const handleLock = useCallback(() => {
    closeDatabase();
    // Redirect to home screen (which is index/unlock screen)
    router.replace("/");
  }, [closeDatabase, router]);

  const handleSave = useCallback(async () => {
    if (!db) return;
    try {
      await saveVault(db);
      markClean();
      Alert.alert("Success", "Vault saved successfully.");
    } catch (e: any) {
      Alert.alert(
        "Error Saving",
        e?.message || "Failed to write database file."
      );
    }
  }, [db, saveVault, markClean]);

  const handleForget = useCallback(() => {
    Alert.alert(
      "Forget Vault",
      "This will remove the vault pointer and clear biometrics. The .kdbx file itself will not be deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: async () => {
            closeDatabase();
            await clearVault();
            router.replace("/");
          },
        },
      ]
    );
  }, [clearVault, closeDatabase, router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Vault Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Save Status Banner */}
        {isDirty && (
          <CyberCard style={styles.warningCard}>
            <View style={styles.warningHeader}>
              <Ionicons
                name="warning-outline"
                size={20}
                color={Colors.statusWarning}
              />
              <Text style={styles.warningTitle}>Unsaved Changes</Text>
            </View>
            <Text style={styles.warningText}>
              You have added or modified entries since the last save. Save
              changes to write to the file.
            </Text>
            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && styles.saveBtnPressed,
              ]}
            >
              <Ionicons
                name="save-outline"
                size={16}
                color={Colors.backgroundPrimary}
              />
              <Text style={styles.saveBtnText}>Save Changes</Text>
            </Pressable>
          </CyberCard>
        )}

        {/* Database Meta Statistics */}
        {stats && (
          <CyberCard style={styles.card}>
            <Text style={styles.cardTitle}>Vault Information</Text>
            <View style={styles.statsRow}>
              <Text style={styles.statsLabel}>Name</Text>
              <Text style={styles.statsValue}>{stats.name}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.statsRow}>
              <Text style={styles.statsLabel}>Groups</Text>
              <Text style={styles.statsValue}>{stats.groupCount}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.statsRow}>
              <Text style={styles.statsLabel}>Entries</Text>
              <Text style={styles.statsValue}>{stats.entryCount}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.statsRow}>
              <Text style={styles.statsLabel}>KDF / Encryption</Text>
              <Text style={styles.statsValue}>{stats.kdfName}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.statsRow}>
              <Text style={styles.statsLabel}>File Path</Text>
              <Text
                style={styles.statsValueMono}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {getFilenameFromUri(fileUri ?? undefined)}
              </Text>
            </View>
          </CyberCard>
        )}

        {/* Actions Card */}
        <CyberCard style={styles.card}>
          <Text style={styles.cardTitle}>Security Actions</Text>

          <Pressable
            onPress={handleLock}
            style={({ pressed }) => [
              styles.actionBtn,
              pressed && styles.actionBtnPressed,
              styles.lockBtn,
            ]}
          >
            <Ionicons
              name="lock-closed-outline"
              size={20}
              color={Colors.textPrimary}
            />
            <View style={styles.actionBtnTextContainer}>
              <Text style={styles.actionBtnText}>Lock Database</Text>
              <Text style={styles.actionBtnSub}>
                Close and encrypt database in memory
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textMuted}
            />
          </Pressable>

          {biometricSupported && (
            <>
              <View style={styles.divider} />
              <View style={styles.biometricRow}>
                <View style={styles.actionBtnTextContainer}>
                  <Text style={styles.actionBtnText}>Biometric Unlock</Text>
                  <Text style={styles.actionBtnSub}>
                    {biometricEnabled
                      ? "Use Face ID / Fingerprint to unlock"
                      : "Enable hardware-backed biometric unlock"}
                  </Text>
                </View>
                <Pressable
                  onPress={handleToggleBiometric}
                  style={styles.switchButton}
                  hitSlop={8}
                >
                  <Ionicons
                    name={biometricEnabled ? "toggle" : "toggle-outline"}
                    size={38}
                    color={
                      biometricEnabled ? Colors.accentMint : Colors.textMuted
                    }
                  />
                </Pressable>
              </View>

              {showBiometricPasswordInput && (
                <View style={styles.confirmPasswordContainer}>
                  <Text style={styles.confirmLabel}>
                    Confirm Master Password
                  </Text>
                  <View style={styles.confirmInputRow}>
                    <TextInput
                      style={styles.confirmInput}
                      secureTextEntry
                      value={biometricPassword}
                      onChangeText={setBiometricPassword}
                      placeholder="Master Password"
                      placeholderTextColor={Colors.textDisabled}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Pressable
                      onPress={handleConfirmBiometric}
                      style={styles.confirmBtn}
                    >
                      <Text style={styles.confirmBtnText}>Verify</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </>
          )}

          {hasSavedVault && (
            <>
              <View style={styles.divider} />
              <Pressable
                onPress={handleForget}
                style={({ pressed }) => [
                  styles.actionBtn,
                  pressed && styles.actionBtnPressed,
                ]}
              >
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={Colors.statusError}
                />
                <View style={styles.actionBtnTextContainer}>
                  <Text
                    style={[
                      styles.actionBtnText,
                      { color: Colors.statusError },
                    ]}
                  >
                    Forget Persistence
                  </Text>
                  <Text style={styles.actionBtnSub}>
                    Clear credentials and key binding
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={Colors.textMuted}
                />
              </Pressable>
            </>
          )}
        </CyberCard>

        {/* App Version Info */}
        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>VaultPeerMobile v0.0.1</Text>
          <Text style={styles.licenseText}>Licensed under Apache 2.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.backgroundPrimary,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSage,
    alignItems: "center",
  },
  headerTitle: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.subheading,
    color: Colors.textPrimary,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.huge,
    gap: Spacing.lg,
  },
  card: {
    padding: Spacing.lg,
  },
  cardTitle: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  statsLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
  },
  statsValue: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textPrimary,
  },
  statsValueMono: {
    fontFamily: Fonts.mono.regular,
    fontSize: FontSizes.caption,
    color: Colors.accentMint,
    maxWidth: 200,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderSage,
    marginVertical: Spacing.sm,
  },

  // Unsaved Warning Card
  warningCard: {
    borderColor: Colors.statusWarning,
    backgroundColor: Colors.statusWarningDim,
    padding: Spacing.lg,
  },
  warningHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  warningTitle: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.body,
    color: Colors.statusWarning,
  },
  warningText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.accentMint,
    borderRadius: Radii.md,
    height: TouchTarget.min,
    ...Shadows.glow,
  },
  saveBtnPressed: {
    backgroundColor: "#2BC48A",
    transform: [{ scale: 0.98 }],
  },
  saveBtnText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.bodySmall,
    color: Colors.backgroundPrimary,
  },

  // Interactive buttons inside cards
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    minHeight: TouchTarget.min,
  },
  actionBtnPressed: {
    opacity: 0.7,
  },
  lockBtn: {
    // styles specific to lock button if needed
  },
  actionBtnTextContainer: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  actionBtnText: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.textPrimary,
  },
  actionBtnSub: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },

  // Version Footer
  versionContainer: {
    alignItems: "center",
    marginTop: Spacing.xl,
    gap: Spacing.xxs,
  },
  versionText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
  },
  licenseText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.micro,
    color: Colors.textDisabled,
  },
  biometricRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.xs,
  },
  switchButton: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xs,
    minHeight: TouchTarget.min,
    minWidth: TouchTarget.min,
  },
  confirmPasswordContainer: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderSage,
  },
  confirmLabel: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.caption,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  confirmInputRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    alignItems: "center",
  },
  confirmInput: {
    flex: 1,
    height: 40,
    backgroundColor: Colors.backgroundPrimary,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    borderRadius: Radii.sm,
    color: Colors.textPrimary,
    paddingHorizontal: Spacing.sm,
    fontFamily: Fonts.mono.regular,
  },
  confirmBtn: {
    backgroundColor: Colors.accentMint,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.md,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmBtnText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.bodySmall,
    color: Colors.backgroundPrimary,
  },
});
