import React, { useCallback, useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
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
import { parseMeta, applyKdfParams } from "@/src/services/crypto";
import {
  getCurrentKdfParams,
  formatKdfParams,
} from "@/src/services/crypto/kdfBenchmark";
import type { KdfTuningParams } from "@/src/services/crypto/kdfBenchmark";
import { CyberCard } from "@/src/components/CyberCard";
import { KdfTuningModal } from "@/src/components/KdfTuningModal";
import {
  isBiometricsSupported,
  isBiometricEnabled,
  enableBiometric,
  disableBiometric,
} from "@/src/services/biometricService";

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

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

type SettingsTab = "database" | "app";

// ────────────────────────────────────────────
// Segmented Tab Control
// ────────────────────────────────────────────

function SegmentedControl({
  activeTab,
  onTabChange,
}: {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}) {
  const indicatorX = useSharedValue(activeTab === "database" ? 0 : 1);

  useEffect(() => {
    indicatorX.value = withSpring(activeTab === "database" ? 0 : 1, {
      damping: 18,
      stiffness: 200,
    });
  }, [activeTab, indicatorX]);

  const indicatorStyle = useAnimatedStyle(() => ({
    left: `${indicatorX.value * 50}%` as any,
  }));

  return (
    <View style={segStyles.container}>
      <Animated.View style={[segStyles.indicator, indicatorStyle]} />
      <Pressable
        style={segStyles.tab}
        onPress={() => onTabChange("database")}
        hitSlop={4}
      >
        <Ionicons
          name="server-outline"
          size={15}
          color={
            activeTab === "database"
              ? Colors.backgroundPrimary
              : Colors.textMuted
          }
        />
        <Text
          style={[
            segStyles.tabText,
            activeTab === "database" && segStyles.tabTextActive,
          ]}
        >
          Database
        </Text>
      </Pressable>
      <Pressable
        style={segStyles.tab}
        onPress={() => onTabChange("app")}
        hitSlop={4}
      >
        <Ionicons
          name="phone-portrait-outline"
          size={15}
          color={
            activeTab === "app" ? Colors.backgroundPrimary : Colors.textMuted
          }
        />
        <Text
          style={[
            segStyles.tabText,
            activeTab === "app" && segStyles.tabTextActive,
          ]}
        >
          App
        </Text>
      </Pressable>
    </View>
  );
}

const segStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radii.md,
    padding: 3,
    position: "relative",
  },
  indicator: {
    position: "absolute",
    top: 3,
    bottom: 3,
    width: "50%",
    backgroundColor: Colors.accentMint,
    borderRadius: Radii.sm,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    zIndex: 1,
  },
  tabText: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
  },
  tabTextActive: {
    color: Colors.backgroundPrimary,
  },
});

// ────────────────────────────────────────────
// Settings Row Component
// ────────────────────────────────────────────

function SettingsRow({
  icon,
  iconColor,
  title,
  subtitle,
  value,
  onPress,
  rightElement,
  destructive,
}: {
  icon: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  destructive?: boolean;
}) {
  const content = (
    <View style={rowStyles.row}>
      <Ionicons
        name={icon as any}
        size={20}
        color={
          iconColor || (destructive ? Colors.statusError : Colors.textPrimary)
        }
      />
      <View style={rowStyles.textCol}>
        <Text
          style={[
            rowStyles.title,
            destructive && { color: Colors.statusError },
          ]}
        >
          {title}
        </Text>
        {subtitle && <Text style={rowStyles.subtitle}>{subtitle}</Text>}
      </View>
      {value && (
        <Text style={rowStyles.value} numberOfLines={1}>
          {value}
        </Text>
      )}
      {rightElement}
      {onPress && !rightElement && (
        <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [pressed && { opacity: 0.7 }]}
      >
        {content}
      </Pressable>
    );
  }
  return content;
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    minHeight: TouchTarget.min,
    gap: Spacing.md,
  },
  textCol: {
    flex: 1,
  },
  title: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  value: {
    fontFamily: Fonts.mono.regular,
    fontSize: FontSizes.caption,
    color: Colors.accentMint,
    maxWidth: 140,
  },
});

// ────────────────────────────────────────────
// Main Settings Screen
// ────────────────────────────────────────────

export default function VaultSettingsScreen() {
  const router = useRouter();
  const {
    closeDatabase,
    _db: db,
    filePath: fileUri,
    isDirty,
    markClean,
    refreshParsedState,
    meta: storeMeta,
    cleanupDatabase,
    runCleanupDatabase,
  } = useVaultStore();
  const { clearVault, hasSavedVault, saveVault, loadVault } = useFilePicker();

  const [activeTab, setActiveTab] = useState<SettingsTab>("database");
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [showBiometricPasswordInput, setShowBiometricPasswordInput] =
    useState(false);
  const [biometricPassword, setBiometricPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showKdfModal, setShowKdfModal] = useState(false);

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
    if (verifying) return;
    if (!biometricPassword) {
      Alert.alert("Error", "Please enter your master password.");
      return;
    }
    setVerifying(true);
    setTimeout(async () => {
      try {
        const { db: verifiedDb } = await loadVault(biometricPassword);
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
      } finally {
        setVerifying(false);
      }
    }, 50);
  }, [biometricPassword, loadVault, verifying]);

  const stats = useMemo(() => {
    if (!db) return null;
    return parseMeta(db);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, storeMeta]);

  const kdfInfo = useMemo(() => {
    if (!db) return null;
    const header = db.header as unknown as {
      kdfParameters?: Map<string, unknown>;
    };
    return getCurrentKdfParams(header?.kdfParameters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, storeMeta]);

  const kdfParamLabels = useMemo(() => {
    if (!kdfInfo) return [];
    return formatKdfParams(kdfInfo.kdfType, kdfInfo);
  }, [kdfInfo]);

  const handleLock = useCallback(() => {
    closeDatabase();
    router.replace("/");
  }, [closeDatabase, router]);

  const handleSave = useCallback(async () => {
    if (!db || saving) return;
    setSaving(true);
    setTimeout(async () => {
      try {
        await saveVault(db);
        markClean();
        Alert.alert("Success", "Vault saved successfully.");
      } catch (e: any) {
        Alert.alert(
          "Error Saving",
          e?.message || "Failed to write database file."
        );
      } finally {
        setSaving(false);
      }
    }, 50);
  }, [db, saveVault, markClean, saving]);

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

  const handleApplyKdfParams = useCallback(
    (params: KdfTuningParams) => {
      if (!db) return;
      applyKdfParams(db, params);
      refreshParsedState();
      useVaultStore.setState({ isDirty: true });
      Alert.alert(
        "KDF Updated",
        "New parameters applied. Save the database to persist changes."
      );
    },
    [db, refreshParsedState]
  );

  const handleToggleCompression = useCallback(() => {
    if (!db) return;
    Alert.alert(
      "Database Compression",
      "Select XML compression algorithm for database serialization.",
      [
        {
          text: "GZip (Default)",
          onPress: () => {
            db.header.compression = 1; // 1 = GZip
            refreshParsedState();
            useVaultStore.setState({ isDirty: true });
          },
        },
        {
          text: "None",
          onPress: () => {
            db.header.compression = 0; // 0 = None
            refreshParsedState();
            useVaultStore.setState({ isDirty: true });
          },
        },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }, [db, refreshParsedState]);

  const handleCleanupPress = useCallback(() => {
    if (!db) return;
    const summary = cleanupDatabase({ binaries: true, history: true });
    if (!summary) return;

    const { historyToRemove, binariesToRemove } = summary;

    if (historyToRemove === 0 && binariesToRemove === 0) {
      Alert.alert(
        "Database Clean",
        "Your database is already clean! No unreferenced attachments or redundant history entries found."
      );
      return;
    }

    Alert.alert(
      "Clean Up Database",
      `This will optimize your database file size.\n\nSummary of items to remove:\n• Unused binaries/attachments: ${binariesToRemove}\n• Redundant history entries: ${historyToRemove}\n\nDo you want to proceed?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clean Up",
          style: "destructive",
          onPress: () => {
            const success = runCleanupDatabase({
              binaries: true,
              history: true,
            });
            if (success) {
              Alert.alert(
                "Cleanup Success",
                `Successfully cleaned up the database!\n\nRemoved:\n• ${binariesToRemove} unused binaries/attachments\n• ${historyToRemove} redundant history entries.\n\nDon't forget to save your changes.`
              );
            } else {
              Alert.alert("Error", "Failed to perform database cleanup.");
            }
          },
        },
      ]
    );
  }, [db, cleanupDatabase, runCleanupDatabase]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      {/* Segmented Tab Bar */}
      <View style={styles.segmentWrapper}>
        <SegmentedControl activeTab={activeTab} onTabChange={setActiveTab} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Unsaved Changes Banner */}
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
              You have modifications since the last save. Save now to write to
              file.
            </Text>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && styles.saveBtnPressed,
                saving && { opacity: 0.6 },
              ]}
            >
              {saving ? (
                <ActivityIndicator
                  size="small"
                  color={Colors.backgroundPrimary}
                />
              ) : (
                <>
                  <Ionicons
                    name="save-outline"
                    size={16}
                    color={Colors.backgroundPrimary}
                  />
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                </>
              )}
            </Pressable>
          </CyberCard>
        )}

        {/* ═══════════════ DATABASE TAB ═══════════════ */}
        {activeTab === "database" && stats && (
          <>
            {/* Vault Info */}
            <Animated.View entering={FadeInDown.duration(200).delay(50)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="information-circle-outline"
                    size={18}
                    color={Colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Vault Information</Text>
                </View>
                <SettingsRow
                  icon="document-text-outline"
                  title="Name"
                  value={stats.name}
                />
                <View style={styles.divider} />
                <SettingsRow
                  icon="grid-outline"
                  title="Groups"
                  value={String(stats.groupCount)}
                />
                <View style={styles.divider} />
                <SettingsRow
                  icon="list-outline"
                  title="Entries"
                  value={String(stats.entryCount)}
                />
                <View style={styles.divider} />
                <SettingsRow
                  icon="folder-outline"
                  title="File"
                  value={getFilenameFromUri(fileUri ?? undefined)}
                />
              </CyberCard>
            </Animated.View>

            {/* Security & Encryption */}
            <Animated.View entering={FadeInDown.duration(200).delay(100)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="shield-outline"
                    size={18}
                    color={Colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Security & Encryption</Text>
                </View>
                <SettingsRow
                  icon="lock-closed-outline"
                  title="Cipher"
                  value={stats.cipherName}
                />
                <View style={styles.divider} />
                <SettingsRow
                  icon="key-outline"
                  title="KDF"
                  value={stats.kdfName}
                />
                <View style={styles.divider} />
                {kdfParamLabels.map((label, idx) => (
                  <React.Fragment key={label}>
                    <SettingsRow
                      icon="options-outline"
                      title={label.split(":")[0]?.trim() || ""}
                      value={label.split(":")[1]?.trim() || ""}
                    />
                    {idx < kdfParamLabels.length - 1 && (
                      <View style={styles.divider} />
                    )}
                  </React.Fragment>
                ))}
                <View style={styles.divider} />
                <SettingsRow
                  icon="speedometer-outline"
                  iconColor={Colors.accentMint}
                  title="Tune KDF Parameters"
                  subtitle="Benchmark & adjust security strength"
                  onPress={() => setShowKdfModal(true)}
                />
                <View style={styles.divider} />
                <SettingsRow
                  icon="archive-outline"
                  title="Database Compression"
                  subtitle="Configure XML compression algorithm"
                  value={stats.compression || "GZip"}
                  onPress={handleToggleCompression}
                />
              </CyberCard>
            </Animated.View>

            {/* Database Maintenance */}
            <Animated.View entering={FadeInDown.duration(200).delay(150)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="hammer-outline"
                    size={18}
                    color={Colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Database Maintenance</Text>
                </View>
                <SettingsRow
                  icon="brush-outline"
                  title="Clean Up Database"
                  subtitle="Remove unlinked attachments & clean history entries"
                  onPress={handleCleanupPress}
                />
              </CyberCard>
            </Animated.View>

            {/* Database Actions */}
            <Animated.View entering={FadeInDown.duration(200).delay(200)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="construct-outline"
                    size={18}
                    color={Colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Database Actions</Text>
                </View>
                <SettingsRow
                  icon="lock-closed-outline"
                  title="Lock Database"
                  subtitle="Close and encrypt database in memory"
                  onPress={handleLock}
                />
                {hasSavedVault && (
                  <>
                    <View style={styles.divider} />
                    <SettingsRow
                      icon="trash-outline"
                      title="Forget Persistence"
                      subtitle="Clear credentials and key binding"
                      onPress={handleForget}
                      destructive
                    />
                  </>
                )}
              </CyberCard>
            </Animated.View>
          </>
        )}

        {/* ═══════════════ APP TAB ═══════════════ */}
        {activeTab === "app" && (
          <>
            {/* Biometric Unlock */}
            {biometricSupported && (
              <Animated.View entering={FadeInDown.duration(200).delay(50)}>
                <CyberCard style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Ionicons
                      name="finger-print-outline"
                      size={18}
                      color={Colors.accentMint}
                    />
                    <Text style={styles.cardTitle}>Biometric Unlock</Text>
                  </View>
                  <View style={styles.biometricRow}>
                    <View style={rowStyles.textCol}>
                      <Text style={rowStyles.title}>
                        {biometricEnabled ? "Enabled" : "Disabled"}
                      </Text>
                      <Text style={rowStyles.subtitle}>
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
                          biometricEnabled
                            ? Colors.accentMint
                            : Colors.textMuted
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
                          disabled={verifying}
                          style={[
                            styles.confirmBtn,
                            verifying && { opacity: 0.6 },
                          ]}
                        >
                          {verifying ? (
                            <ActivityIndicator
                              size="small"
                              color={Colors.backgroundPrimary}
                            />
                          ) : (
                            <Text style={styles.confirmBtnText}>Verify</Text>
                          )}
                        </Pressable>
                      </View>
                    </View>
                  )}
                </CyberCard>
              </Animated.View>
            )}

            {/* App Preferences */}
            <Animated.View entering={FadeInDown.duration(200).delay(100)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="settings-outline"
                    size={18}
                    color={Colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Preferences</Text>
                </View>
                <SettingsRow
                  icon="timer-outline"
                  title="Auto-Lock"
                  subtitle="Lock after 60 seconds of inactivity"
                  value="60s"
                />
                <View style={styles.divider} />
                <SettingsRow
                  icon="clipboard-outline"
                  title="Clipboard Clear"
                  subtitle="Auto-clear copied passwords"
                  value="30s"
                />
                <View style={styles.divider} />
                <SettingsRow
                  icon="moon-outline"
                  title="Theme"
                  subtitle="Cyber-Sage dark mode"
                  value="Dark"
                />
              </CyberCard>
            </Animated.View>

            {/* About */}
            <Animated.View entering={FadeInDown.duration(200).delay(150)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="heart-outline"
                    size={18}
                    color={Colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>About</Text>
                </View>
                <SettingsRow
                  icon="code-slash-outline"
                  title="Version"
                  value="0.0.1"
                />
                <View style={styles.divider} />
                <SettingsRow
                  icon="document-outline"
                  title="License"
                  value="Apache 2.0"
                />
              </CyberCard>
            </Animated.View>
          </>
        )}

        {/* Bottom Spacer */}
        <View style={{ height: Spacing.huge }} />
      </ScrollView>

      {/* KDF Tuning Modal */}
      {kdfInfo && stats && (
        <KdfTuningModal
          visible={showKdfModal}
          onClose={() => setShowKdfModal(false)}
          onApply={handleApplyKdfParams}
          kdfType={kdfInfo.kdfType}
          cipherName={stats.cipherName}
          initialParams={kdfInfo}
        />
      )}
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────

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
  segmentWrapper: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  card: {
    padding: Spacing.lg,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  cardTitle: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderSage,
    marginVertical: Spacing.xs,
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

  // Biometric
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
