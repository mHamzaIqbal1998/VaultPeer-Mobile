/**
 * VaultPeer — File Setup Screen (Phase 2)
 *
 * Implements the core database setup flows:
 * 1. Opening an existing KeePass (.kdbx) file via SAF/Security-Scoped Bookmarks.
 * 2. Creating a new KeePass database and exporting it.
 * 3. Unlocking a previously persisted vault.
 * 4. Displaying parsed vault statistics.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  FadeInDown,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as kdbxweb from "kdbxweb";
import {
  Colors,
  Fonts,
  FontSizes,
  LineHeights,
  Spacing,
  Radii,
  Shadows,
  TouchTarget,
} from "@/src/constants/theme";
import { useFilePicker } from "@/src/context/FilePickerContext";
import { parseMeta } from "@/src/services/crypto";
import { useVaultStore } from "@/src/stores/useVaultStore";
import type { VaultMeta } from "@/src/types/kdbx";
import { CyberCard } from "@/src/components/CyberCard";
import {
  isBiometricEnabled,
  getStoredPassword,
} from "@/src/services/biometricService";

// ────────────────────────────────────────────
// Helper: Parse File Name from URI
// ────────────────────────────────────────────

function getFilenameFromUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    // SAF URI might have segments split by '%3A' or '/'
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

// ────────────────────────────────────────────
// Main Screen Component
// ────────────────────────────────────────────

type ScreenMode = "select" | "unlock" | "create";

export default function FileSetupScreen() {
  const router = useRouter();
  const {
    fileUri,
    isLoading: isFsLoading,
    error: fsError,
    hasSavedVault,
    pickAndOpenVault,
    createNewVault,
    loadVault,
    clearVault,
  } = useFilePicker();
  const { openDatabase, closeDatabase } = useVaultStore();

  const [mode, setMode] = useState<ScreenMode>("select");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // New Vault Forms
  const [newVaultName, setNewVaultName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Unlocked State
  const [activeDb, setActiveDb] = useState<kdbxweb.Kdbx | null>(null);
  const [dbStats, setDbStats] = useState<VaultMeta | null>(null);

  // Active status/local loading
  const [localLoading, setLocalLoading] = useState(false);

  // Shield glow animation
  const glowOpacity = useSharedValue(0.4);
  useEffect(() => {
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.4, { duration: 1500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [glowOpacity]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  // Auto-transition to unlock if a vault is saved
  useEffect(() => {
    if (hasSavedVault && !activeDb) {
      setMode("unlock");
    } else if (!hasSavedVault) {
      setMode("select");
    }
  }, [hasSavedVault, activeDb]);

  const [bioEnabled, setBioEnabled] = useState(false);
  const hasAutoTriggeredBioRef = useRef(false);

  useEffect(() => {
    if (mode !== "unlock") {
      hasAutoTriggeredBioRef.current = false;
    }
  }, [mode]);

  const handleBiometricUnlock = useCallback(async () => {
    setFormError(null);
    setLocalLoading(true);
    try {
      const storedPassword = await getStoredPassword();
      if (!storedPassword) {
        return; // User cancelled
      }
      const db = await loadVault(storedPassword);
      setActiveDb(db);
      setDbStats(parseMeta(db));
      setPassword("");
      openDatabase(db, fileUri ?? undefined);
      router.push("/vault");
    } catch (e: any) {
      setFormError(e?.message || "Biometric authentication failed.");
    } finally {
      setLocalLoading(false);
    }
  }, [loadVault, openDatabase, fileUri, router]);

  useEffect(() => {
    async function checkBio() {
      if (hasSavedVault) {
        const enabled = await isBiometricEnabled();
        setBioEnabled(enabled);
        if (enabled && mode === "unlock" && !hasAutoTriggeredBioRef.current) {
          hasAutoTriggeredBioRef.current = true;
          setTimeout(() => {
            handleBiometricUnlock();
          }, 400);
        }
      } else {
        setBioEnabled(false);
        hasAutoTriggeredBioRef.current = false;
      }
    }
    checkBio();
  }, [hasSavedVault, mode, handleBiometricUnlock]);

  // Combined Loading state
  const isLoading = isFsLoading || localLoading;
  const currentError = formError || fsError;

  // ────────────────────────────────────────────
  // Operations
  // ────────────────────────────────────────────

  const handlePickAndOpen = async () => {
    if (!password) {
      setFormError("Please enter the master password.");
      return;
    }
    setFormError(null);
    setLocalLoading(true);
    try {
      const db = await pickAndOpenVault(password);
      setActiveDb(db);
      setDbStats(parseMeta(db));
      setPassword("");
      openDatabase(db, fileUri ?? undefined);
      router.push("/vault");
    } catch {
      // Error handled by FilePickerContext / caught locally
    } finally {
      setLocalLoading(false);
    }
  };

  const handleUnlockSaved = async () => {
    if (!password) {
      setFormError("Please enter the master password.");
      return;
    }
    setFormError(null);
    setLocalLoading(true);
    try {
      const db = await loadVault(password);
      setActiveDb(db);
      setDbStats(parseMeta(db));
      setPassword("");
      openDatabase(db, fileUri ?? undefined);
      router.push("/vault");
    } catch {
      // Error handled by FilePickerContext
    } finally {
      setLocalLoading(false);
    }
  };

  const handleCreateVault = async () => {
    if (!newVaultName.trim()) {
      setFormError("Please enter a database name.");
      return;
    }
    if (!newPassword) {
      setFormError("Please enter a master password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }
    setFormError(null);
    setLocalLoading(true);
    try {
      const db = await createNewVault(newVaultName.trim(), newPassword);
      setActiveDb(db);
      setDbStats(parseMeta(db));
      setNewVaultName("");
      setNewPassword("");
      setConfirmPassword("");
      openDatabase(db, fileUri ?? undefined);
      router.push("/vault");
    } catch {
      // Error handled by FilePickerContext
    } finally {
      setLocalLoading(false);
    }
  };

  const handleLockVault = () => {
    closeDatabase();
    setActiveDb(null);
    setDbStats(null);
    setPassword("");
    if (hasSavedVault) {
      setMode("unlock");
    } else {
      setMode("select");
    }
  };

  const handleForgetVault = async () => {
    await clearVault();
    setActiveDb(null);
    setDbStats(null);
    setPassword("");
    setMode("select");
    setFormError(null);
  };

  // ────────────────────────────────────────────
  // Render Helpers
  // ────────────────────────────────────────────

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <View style={styles.shieldContainer}>
        <Animated.View style={[styles.shieldGlow, glowStyle]} />
        <Ionicons name="shield-checkmark" size={38} color={Colors.accentMint} />
      </View>
      <Text style={styles.title}>VaultPeer</Text>
      <Text style={styles.subtitle}>Secure, In-place KeePass Vaults</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {renderHeader()}

          {/* Error Message Box */}
          {currentError && (
            <Animated.View entering={FadeInDown} style={styles.errorCard}>
              <Ionicons
                name="alert-circle"
                size={20}
                color={Colors.statusError}
              />
              <Text style={styles.errorText}>{currentError}</Text>
            </Animated.View>
          )}

          {/* Active Database / Unlocked Stats View */}
          {activeDb && dbStats ? (
            <Animated.View entering={FadeInDown.duration(400)}>
              <CyberCard
                style={{ marginBottom: Spacing.xl, padding: Spacing.xl }}
              >
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="lock-open"
                    size={22}
                    color={Colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Vault Decrypted</Text>
                </View>

                <View style={styles.statsRow}>
                  <Text style={styles.statsLabel}>Vault Name</Text>
                  <Text style={styles.statsValue}>{dbStats.name}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.statsRow}>
                  <Text style={styles.statsLabel}>Groups</Text>
                  <Text style={styles.statsValue}>{dbStats.groupCount}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.statsRow}>
                  <Text style={styles.statsLabel}>Entries</Text>
                  <Text style={styles.statsValue}>{dbStats.entryCount}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.statsRow}>
                  <Text style={styles.statsLabel}>Encryption / KDF</Text>
                  <Text style={styles.statsValue}>{dbStats.kdfName}</Text>
                </View>

                <Pressable
                  onPress={handleLockVault}
                  style={({ pressed }) => [
                    styles.button,
                    pressed && styles.buttonPressed,
                    styles.lockButton,
                  ]}
                >
                  <Ionicons
                    name="lock-closed"
                    size={16}
                    color={Colors.backgroundPrimary}
                    style={styles.buttonIcon}
                  />
                  <Text style={styles.buttonText}>Lock Vault</Text>
                </Pressable>
              </CyberCard>
            </Animated.View>
          ) : (
            /* Locked / Entry Flows */
            <>
              {mode === "unlock" && fileUri && (
                <Animated.View entering={FadeInDown.duration(300)}>
                  <CyberCard
                    style={{ marginBottom: Spacing.xl, padding: Spacing.xl }}
                  >
                    <View style={styles.cardHeader}>
                      <Ionicons
                        name="file-tray-full"
                        size={22}
                        color={Colors.accentMint}
                      />
                      <Text style={styles.cardTitle}>Unlock Vault</Text>
                    </View>
                    <Text style={styles.filenameLabel}>
                      File:{" "}
                      <Text style={styles.filename}>
                        {getFilenameFromUri(fileUri)}
                      </Text>
                    </Text>

                    <View style={styles.inputContainer}>
                      <Ionicons
                        name="key"
                        size={18}
                        color={Colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Master Password"
                        placeholderTextColor={Colors.textDisabled}
                        editable={!isLoading}
                      />
                      <Pressable
                        onPress={() => setShowPassword(!showPassword)}
                        style={styles.eyeButton}
                        hitSlop={8}
                      >
                        <Ionicons
                          name={showPassword ? "eye-off" : "eye"}
                          size={20}
                          color={Colors.textMuted}
                        />
                      </Pressable>
                    </View>

                    <View style={styles.buttonRow}>
                      <Pressable
                        onPress={handleUnlockSaved}
                        disabled={isLoading}
                        style={({ pressed }) => [
                          styles.button,
                          { flex: 1 },
                          pressed && styles.buttonPressed,
                          isLoading && styles.buttonDisabled,
                        ]}
                      >
                        {isLoading ? (
                          <ActivityIndicator
                            size="small"
                            color={Colors.backgroundPrimary}
                          />
                        ) : (
                          <>
                            <Ionicons
                              name="lock-open"
                              size={16}
                              color={Colors.backgroundPrimary}
                              style={styles.buttonIcon}
                            />
                            <Text style={styles.buttonText}>Unlock Vault</Text>
                          </>
                        )}
                      </Pressable>

                      {bioEnabled && (
                        <Pressable
                          onPress={handleBiometricUnlock}
                          disabled={isLoading}
                          style={({ pressed }) => [
                            styles.bioButton,
                            pressed && styles.bioButtonPressed,
                            isLoading && styles.bioButtonDisabled,
                          ]}
                          hitSlop={8}
                        >
                          <Ionicons
                            name="finger-print"
                            size={24}
                            color={Colors.accentMint}
                          />
                        </Pressable>
                      )}
                    </View>

                    <View style={styles.rowButtons}>
                      <Pressable
                        onPress={handleForgetVault}
                        style={styles.textButton}
                      >
                        <Text style={styles.textButtonText}>Forget Vault</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setMode("select")}
                        style={styles.textButton}
                      >
                        <Text style={styles.textButtonText}>
                          Choose Another
                        </Text>
                      </Pressable>
                    </View>
                  </CyberCard>
                </Animated.View>
              )}

              {mode === "select" && (
                <Animated.View entering={FadeInDown.duration(300)}>
                  <CyberCard
                    style={{ marginBottom: Spacing.xl, padding: Spacing.xl }}
                  >
                    <Text style={styles.infoLabel}>
                      Open an existing KeePass database (.kdbx) or create a new
                      one securely in-place.
                    </Text>

                    {/* Password entry for opening existing */}
                    <View
                      style={[styles.inputContainer, { marginTop: Spacing.sm }]}
                    >
                      <Ionicons
                        name="key"
                        size={18}
                        color={Colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Master Password"
                        placeholderTextColor={Colors.textDisabled}
                        editable={!isLoading}
                      />
                      <Pressable
                        onPress={() => setShowPassword(!showPassword)}
                        style={styles.eyeButton}
                        hitSlop={8}
                      >
                        <Ionicons
                          name={showPassword ? "eye-off" : "eye"}
                          size={20}
                          color={Colors.textMuted}
                        />
                      </Pressable>
                    </View>

                    <Pressable
                      onPress={handlePickAndOpen}
                      disabled={isLoading}
                      style={({ pressed }) => [
                        styles.button,
                        pressed && styles.buttonPressed,
                        isLoading && styles.buttonDisabled,
                      ]}
                    >
                      {isLoading ? (
                        <ActivityIndicator
                          size="small"
                          color={Colors.backgroundPrimary}
                        />
                      ) : (
                        <>
                          <Ionicons
                            name="folder-open"
                            size={16}
                            color={Colors.backgroundPrimary}
                            style={styles.buttonIcon}
                          />
                          <Text style={styles.buttonText}>
                            Open Existing Vault
                          </Text>
                        </>
                      )}
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        setMode("create");
                        setFormError(null);
                      }}
                      style={({ pressed }) => [
                        styles.buttonSecondary,
                        pressed && styles.buttonSecondaryPressed,
                      ]}
                    >
                      <Ionicons
                        name="add-circle"
                        size={16}
                        color={Colors.accentMint}
                        style={styles.buttonIcon}
                      />
                      <Text style={styles.buttonSecondaryText}>
                        Create New Vault
                      </Text>
                    </Pressable>
                  </CyberCard>
                </Animated.View>
              )}

              {mode === "create" && (
                <Animated.View entering={FadeInDown.duration(300)}>
                  <CyberCard
                    style={{ marginBottom: Spacing.xl, padding: Spacing.xl }}
                  >
                    <View style={styles.cardHeader}>
                      <Ionicons
                        name="add-circle"
                        size={22}
                        color={Colors.accentMint}
                      />
                      <Text style={styles.cardTitle}>Create KeePass Vault</Text>
                    </View>

                    <View style={styles.inputContainer}>
                      <Ionicons
                        name="document-text"
                        size={18}
                        color={Colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        value={newVaultName}
                        onChangeText={setNewVaultName}
                        placeholder="Database Name"
                        placeholderTextColor={Colors.textDisabled}
                        editable={!isLoading}
                      />
                    </View>

                    <View style={styles.inputContainer}>
                      <Ionicons
                        name="key"
                        size={18}
                        color={Colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        secureTextEntry={!showNewPassword}
                        value={newPassword}
                        onChangeText={setNewPassword}
                        placeholder="Master Password"
                        placeholderTextColor={Colors.textDisabled}
                        editable={!isLoading}
                      />
                      <Pressable
                        onPress={() => setShowNewPassword(!showNewPassword)}
                        style={styles.eyeButton}
                        hitSlop={8}
                      >
                        <Ionicons
                          name={showNewPassword ? "eye-off" : "eye"}
                          size={20}
                          color={Colors.textMuted}
                        />
                      </Pressable>
                    </View>

                    <View style={styles.inputContainer}>
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={Colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        secureTextEntry={!showNewPassword}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        placeholder="Confirm Master Password"
                        placeholderTextColor={Colors.textDisabled}
                        editable={!isLoading}
                      />
                    </View>

                    <Pressable
                      onPress={handleCreateVault}
                      disabled={isLoading}
                      style={({ pressed }) => [
                        styles.button,
                        pressed && styles.buttonPressed,
                        isLoading && styles.buttonDisabled,
                      ]}
                    >
                      {isLoading ? (
                        <ActivityIndicator
                          size="small"
                          color={Colors.backgroundPrimary}
                        />
                      ) : (
                        <>
                          <Ionicons
                            name="save"
                            size={16}
                            color={Colors.backgroundPrimary}
                            style={styles.buttonIcon}
                          />
                          <Text style={styles.buttonText}>
                            Generate & Export Vault
                          </Text>
                        </>
                      )}
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        setMode("select");
                        setFormError(null);
                      }}
                      style={styles.textButton}
                    >
                      <Text style={styles.textButtonText}>Cancel</Text>
                    </Pressable>
                  </CyberCard>
                </Animated.View>
              )}
            </>
          )}

          {/* Secure Sync Notice Info */}
          <View style={styles.infoBox}>
            <Ionicons
              name="lock-closed"
              size={14}
              color={Colors.textDisabled}
            />
            <Text style={styles.infoBoxText}>
              In-place file editing uses Android SAF / iOS Security Bookmarks.
              Changes are automatically updated in cloud folders (Nextcloud,
              Drive, Syncthing).
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxxl,
    paddingBottom: Spacing.huge,
  },

  // Header
  headerContainer: {
    alignItems: "center",
    marginBottom: Spacing.xxxl,
  },
  shieldContainer: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  shieldGlow: {
    position: "absolute",
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.accentMintDim,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    ...Shadows.glow,
  },
  title: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.title,
    lineHeight: LineHeights.title,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    lineHeight: LineHeights.bodySmall,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },

  // Cards
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
    ...Shadows.card,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  cardTitle: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.subheading,
    color: Colors.textPrimary,
  },
  infoLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    lineHeight: LineHeights.bodySmall,
    color: Colors.textMuted,
    marginBottom: Spacing.lg,
    textAlign: "center",
  },
  filenameLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
    marginBottom: Spacing.lg,
  },
  filename: {
    fontFamily: Fonts.mono.regular,
    color: Colors.accentMint,
  },

  // Error Card
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.statusErrorDim,
    borderWidth: 1,
    borderColor: Colors.statusError,
    borderRadius: Radii.md,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  errorText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textPrimary,
    flex: 1,
  },

  // Form Fields
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
    minHeight: TouchTarget.min,
  },
  inputIcon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    color: Colors.textPrimary,
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.body,
    paddingVertical: Spacing.sm,
  },
  eyeButton: {
    padding: Spacing.xs,
    justifyContent: "center",
    alignItems: "center",
    minWidth: TouchTarget.min,
    minHeight: TouchTarget.min,
  },

  // Buttons
  button: {
    backgroundColor: Colors.accentMint,
    borderRadius: Radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: TouchTarget.min,
    paddingVertical: Spacing.md,
    marginTop: Spacing.xs,
    ...Shadows.glow,
  },
  buttonPressed: {
    backgroundColor: "#2BC48A",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonIcon: {
    marginRight: Spacing.xs,
  },
  buttonText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.body,
    color: Colors.backgroundPrimary,
    letterSpacing: 0.5,
  },
  buttonSecondary: {
    backgroundColor: Colors.transparent,
    borderWidth: 1,
    borderColor: Colors.accentMint,
    borderRadius: Radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: TouchTarget.min,
    paddingVertical: Spacing.md,
    marginTop: Spacing.md,
  },
  buttonSecondaryPressed: {
    backgroundColor: Colors.accentMintDim,
  },
  buttonSecondaryText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.body,
    color: Colors.accentMint,
    letterSpacing: 0.5,
  },
  lockButton: {
    backgroundColor: Colors.accentMint,
  },
  textButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
    minHeight: TouchTarget.min,
  },
  textButtonText: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
  },
  rowButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: Spacing.sm,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: Colors.borderSage,
    marginVertical: Spacing.md,
  },

  // Statistics
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statsLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
  },
  statsValue: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.textPrimary,
  },

  // Info Box
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  infoBoxText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    lineHeight: LineHeights.caption,
    color: Colors.textDisabled,
    flex: 1,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.xs,
    alignItems: "center",
  },
  bioButton: {
    width: TouchTarget.min,
    height: TouchTarget.min,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.accentMint,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.transparent,
  },
  bioButtonPressed: {
    backgroundColor: Colors.accentMintDim,
  },
  bioButtonDisabled: {
    opacity: 0.5,
  },
});
