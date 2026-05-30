/**
 * VaultPeer — File Setup Screen (Phase 2)
 *
 * Implements the core database setup flows:
 * 1. Opening an existing KeePass (.kdbx) file via SAF/Security-Scoped Bookmarks.
 * 2. Creating a new KeePass database and exporting it.
 * 3. Unlocking a previously persisted vault.
 * 4. Displaying parsed vault statistics.
 */

import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useRouter } from "expo-router";
import { useSignalingStore } from "@/src/stores/useSignalingStore";
import { CameraView, useCameraPermissions } from "expo-camera";
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
  withTiming,
  Easing,
  FadeInDown,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ActionModal } from "@/src/components/ActionModal";
import {
  useThemeColors,
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
import { estimatePasswordStrength } from "@/src/services/passwordGenerator";

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

function formatLastOpened(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Recent";
  }
}

// ────────────────────────────────────────────
// Main Screen Component
// ────────────────────────────────────────────

type ScreenMode = "select" | "unlock" | "create" | "recent";

export default function FileSetupScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const {
    fileUri,
    isLoading: isFsLoading,
    error: fsError,
    hasSavedVault,
    recentVaults,
    selectVaultFile,
    createNewVault,
    loadVault,
    clearVault,
    clearError,
    selectRecentVault,
    removeRecentVault,
  } = useFilePicker();
  const { openDatabase, closeDatabase } = useVaultStore();

  // Signaling & Onboarding State
  const syncMode = useSignalingStore((state) => state.syncMode);
  const connectionStatus = useSignalingStore((state) => state.connectionStatus);
  const roomId = useSignalingStore((state) => state.roomId);
  const serverUrl = useSignalingStore((state) => state.serverUrl);
  const isConfigured = useSignalingStore((state) => state.isConfigured);
  const { setSyncMode, setServerUrl, setIsConfigured, createRoom, joinRoom } =
    useSignalingStore();

  const [onboardingStep, setOnboardingStep] = useState<
    "select" | "network_config" | "channel_setup" | "join_channel"
  >("select");
  const [inputServerUrl, setInputServerUrl] = useState(serverUrl);
  const [inputRoomId, setInputRoomId] = useState("");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [connectingServer, setConnectingServer] = useState(false);

  // Monitor connection status during Network Config flow
  useEffect(() => {
    if (onboardingStep === "network_config" && connectingServer) {
      if (connectionStatus === "connected") {
        setConnectingServer(false);
        setOnboardingStep("channel_setup");
      }
    }
  }, [connectionStatus, onboardingStep, connectingServer]);

  const handleSelectOfflineMode = async () => {
    setFormError(null);
    try {
      await setSyncMode("offline");
      await setIsConfigured(false);
    } catch (e: any) {
      setFormError(e?.message || "Failed to set Offline Mode.");
    }
  };

  const handleSelectNetworkMode = () => {
    setFormError(null);
    setInputServerUrl(serverUrl || "ws://10.0.2.2:8080");
    setOnboardingStep("network_config");
  };

  const handleConnectServer = async () => {
    if (!inputServerUrl.trim()) {
      setFormError("Please enter a signaling server URL.");
      return;
    }
    setFormError(null);
    setConnectingServer(true);
    try {
      await setServerUrl(inputServerUrl.trim());
      await setIsConfigured(true);
      // Wait, force connect just in case
      useSignalingStore.getState().connect();
      // Set a timeout to check if connection failed
      setTimeout(() => {
        if (useSignalingStore.getState().connectionStatus !== "connected") {
          setConnectingServer(false);
          setFormError(
            "Could not connect to signaling server. Ensure server is running at " +
              inputServerUrl
          );
        }
      }, 5000);
    } catch (e: any) {
      setConnectingServer(false);
      setFormError(e?.message || "Failed to save server URL.");
    }
  };

  const handleCreateChannel = async () => {
    setFormError(null);
    try {
      const newChanId = await createRoom();
      await setSyncMode("network");
      setModalConfig({
        visible: true,
        title: "Channel Created",
        description: `Your sync channel ID is:\n\n${newChanId}\n\nShare this ID or scan its QR code on other devices to connect.`,
        icon: "checkmark-circle",
        iconColor: colors.accentMint,
        buttons: [{ text: "Proceed", onPress: hideModal, variant: "primary" }],
      });
    } catch (e: any) {
      setFormError(e?.message || "Failed to create channel.");
    }
  };

  const handleJoinChannel = async () => {
    if (!inputRoomId.trim()) {
      setFormError("Please enter or scan a channel ID.");
      return;
    }
    setFormError(null);
    try {
      await joinRoom(inputRoomId.trim());
      await setSyncMode("network");
    } catch (e: any) {
      setFormError(e?.message || "Failed to join channel.");
    }
  };

  const handleStartScan = async () => {
    setFormError(null);
    if (!cameraPermission) {
      const status = await requestCameraPermission();
      if (!status.granted) {
        setFormError("Camera permission is required to scan QR codes.");
        return;
      }
    } else if (!cameraPermission.granted) {
      const status = await requestCameraPermission();
      if (!status.granted) {
        setFormError("Camera permission is required to scan QR codes.");
        return;
      }
    }
    setIsScanning(true);
  };

  const [mode, setMode] = useState<ScreenMode>("select");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // New Vault Forms
  const [newVaultName, setNewVaultName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [modalConfig, setModalConfig] = useState<{
    visible: boolean;
    title: string;
    description?: string;
    icon?: keyof typeof Ionicons.glyphMap;
    iconColor?: string;
    options?: any[];
    buttons?: any[];
  }>({
    visible: false,
    title: "",
  });

  const hideModal = useCallback(() => {
    setModalConfig((prev) => ({ ...prev, visible: false }));
  }, []);

  // Unlocked State
  const storeDb = useVaultStore((state) => state._db);
  const [dbStats, setDbStats] = useState<VaultMeta | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (storeDb) {
      setDbStats(parseMeta(storeDb));
      setRedirecting(true);
      const pendingSave = useVaultStore.getState().pendingAutofillSave;
      if (pendingSave) {
        useVaultStore.getState().setPendingAutofillSave(null);
        router.replace({
          pathname: "/entry/edit",
          params: {
            groupId: storeDb.getDefaultGroup().uuid.id,
            autofillUsername: pendingSave.username,
            autofillPassword: pendingSave.password,
            autofillPackageName: pendingSave.packageName,
            autofillDomain: pendingSave.domain,
          },
        });
      } else {
        router.replace("/vault");
      }
    } else {
      setDbStats(null);
      setRedirecting(false);
    }
  }, [storeDb, router]);

  // Advanced Settings State
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedKdf, setSelectedKdf] = useState<
    "Argon2id" | "Argon2d" | "AES-KDF"
  >("Argon2id");
  const [selectedCipher, setSelectedCipher] = useState<"AES-256" | "ChaCha20">(
    "AES-256"
  );

  // Active status/local loading
  const [localLoading, setLocalLoading] = useState(false);

  // Shield glow animation
  const glowScale = useSharedValue(1.0);
  const glowOpacity = useSharedValue(0.3);

  useEffect(() => {
    glowScale.value = withRepeat(
      withTiming(1.2, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    glowOpacity.value = withRepeat(
      withTiming(0.8, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [glowScale, glowOpacity]);

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowScale.value }],
    opacity: glowOpacity.value,
  }));

  // Auto-transition depending on active vault or recent vaults list
  useEffect(() => {
    if (storeDb) return;
    if (fileUri) {
      setMode("unlock");
    } else if (recentVaults.length > 0) {
      setMode("recent");
    } else {
      setMode("select");
    }
  }, [fileUri, recentVaults.length, storeDb]);

  // Clear file errors and form errors on screen mode transition
  useEffect(() => {
    setFormError(null);
    clearError();
  }, [mode, clearError]);

  const [bioEnabled, setBioEnabled] = useState(false);
  const hasAutoTriggeredBioRef = useRef(false);

  useEffect(() => {
    if (mode !== "unlock") {
      hasAutoTriggeredBioRef.current = false;
    }
  }, [mode]);

  const handleBiometricUnlock = useCallback(async () => {
    if (!fileUri) return;
    setFormError(null);
    setLocalLoading(true);
    setTimeout(async () => {
      try {
        const storedPassword = await getStoredPassword(fileUri);
        if (!storedPassword) {
          setLocalLoading(false);
          return; // User cancelled
        }
        const { db, fileUri: currentUri } = await loadVault(storedPassword);
        setRedirecting(true);
        setPassword("");
        openDatabase(db, currentUri);
        router.replace("/vault");
      } catch (e: any) {
        setFormError(e?.message || "Biometric authentication failed.");
        setLocalLoading(false);
      }
    }, 50);
  }, [loadVault, openDatabase, router, fileUri]);

  useEffect(() => {
    async function checkBio() {
      if (hasSavedVault && fileUri) {
        const enabled = await isBiometricEnabled(fileUri);
        setBioEnabled(enabled);
        if (
          enabled &&
          mode === "unlock" &&
          !storeDb &&
          !hasAutoTriggeredBioRef.current
        ) {
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
  }, [hasSavedVault, mode, storeDb, fileUri, handleBiometricUnlock]);

  // Combined Loading state
  const isLoading = isFsLoading || localLoading;
  const currentError = formError || fsError;

  const strength = estimatePasswordStrength(newPassword);

  // ────────────────────────────────────────────
  // Operations
  // ────────────────────────────────────────────

  const handlePickAndOpen = async () => {
    setFormError(null);
    setLocalLoading(true);
    try {
      const newUri = await selectVaultFile();
      if (newUri) {
        setMode("unlock");
        setPassword("");
      }
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
    setTimeout(async () => {
      try {
        const { db, fileUri: currentUri } = await loadVault(password);
        setRedirecting(true);
        setPassword("");
        openDatabase(db, currentUri);
        router.replace("/vault");
      } catch {
        // Error handled by FilePickerContext
        setLocalLoading(false);
      }
    }, 50);
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
    setTimeout(async () => {
      try {
        const { db, fileUri: newUri } = await createNewVault(
          newVaultName.trim(),
          newPassword,
          {
            kdf: selectedKdf,
            cipher: selectedCipher,
          }
        );
        setRedirecting(true);
        setNewVaultName("");
        setNewPassword("");
        setConfirmPassword("");
        setShowAdvanced(false);
        setSelectedKdf("Argon2id");
        setSelectedCipher("AES-256");
        openDatabase(db, newUri);
        router.replace("/vault");
      } catch {
        // Error handled by FilePickerContext
        setLocalLoading(false);
      }
    }, 50);
  };

  const handleLockVault = () => {
    closeDatabase();
    setDbStats(null);
    setPassword("");
    if (fileUri) {
      setMode("unlock");
    } else if (recentVaults.length > 0) {
      setMode("recent");
    } else {
      setMode("select");
    }
  };

  const handleForgetVault = async () => {
    if (!fileUri) return;
    setModalConfig({
      visible: true,
      title: "Forget Vault",
      description:
        "Are you sure you want to forget this vault? This will remove it from your recents list and disable biometric unlock.",
      icon: "trash-outline",
      iconColor: colors.statusError,
      buttons: [
        { text: "Cancel", onPress: hideModal, variant: "secondary" },
        {
          text: "Forget",
          variant: "destructive",
          onPress: async () => {
            hideModal();
            await removeRecentVault(fileUri);
            setDbStats(null);
            setPassword("");
            setFormError(null);
          },
        },
      ],
    });
  };

  const handleChooseAnother = async () => {
    await clearVault();
    setPassword("");
    setFormError(null);
    if (recentVaults.length > 0) {
      setMode("recent");
    } else {
      setMode("select");
    }
  };

  // ────────────────────────────────────────────
  // Render Helpers
  // ────────────────────────────────────────────

  const renderOnboarding = () => {
    switch (onboardingStep) {
      case "select":
        return (
          <Animated.View entering={FadeInDown.duration(400)}>
            <CyberCard
              style={{ marginBottom: Spacing.xl, padding: Spacing.xl }}
            >
              <View style={styles.cardHeader}>
                <Ionicons
                  name="settings-outline"
                  size={22}
                  color={colors.accentMint}
                />
                <Text style={styles.cardTitle}>Select Sync Mode</Text>
              </View>
              <Text style={styles.infoLabel}>
                Choose how VaultPeer should manage and sync your database files.
              </Text>

              <Pressable
                onPress={handleSelectOfflineMode}
                style={({ pressed }) => [
                  styles.optionCard,
                  pressed && styles.optionCardPressed,
                ]}
              >
                <Ionicons
                  name="phone-portrait-outline"
                  size={28}
                  color={colors.accentMint}
                />
                <View style={styles.optionCardContent}>
                  <Text style={styles.optionCardTitle}>Offline Mode</Text>
                  <Text style={styles.optionCardDesc}>
                    Keep your vault local-only. Securely open and edit files
                    in-place without network synchronization.
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={handleSelectNetworkMode}
                style={({ pressed }) => [
                  styles.optionCard,
                  pressed && styles.optionCardPressed,
                ]}
              >
                <Ionicons
                  name="sync-outline"
                  size={28}
                  color={colors.accentMint}
                />
                <View style={styles.optionCardContent}>
                  <Text style={styles.optionCardTitle}>Network Sync Mode</Text>
                  <Text style={styles.optionCardDesc}>
                    Sync your vault peer-to-peer (P2P) across devices via secure
                    WebRTC signaling.
                  </Text>
                </View>
              </Pressable>
            </CyberCard>
          </Animated.View>
        );

      case "network_config":
        return (
          <Animated.View entering={FadeInDown.duration(400)}>
            <CyberCard
              style={{ marginBottom: Spacing.xl, padding: Spacing.xl }}
            >
              <View style={styles.cardHeader}>
                <Ionicons
                  name="globe-outline"
                  size={22}
                  color={colors.accentMint}
                />
                <Text style={styles.cardTitle}>Signaling Server</Text>
              </View>
              <Text style={styles.infoLabel}>
                Configure the WebSockets signaling server. This is used only to
                bridge peer discovery and WebRTC handshakes.
              </Text>

              <View style={styles.inputContainer}>
                <Ionicons
                  name="link"
                  size={18}
                  color={colors.textMuted}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  value={inputServerUrl}
                  onChangeText={setInputServerUrl}
                  placeholder="ws://10.0.2.2:8080"
                  placeholderTextColor={colors.textDisabled}
                  editable={!connectingServer}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <Pressable
                onPress={handleConnectServer}
                disabled={connectingServer}
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.buttonPressed,
                  connectingServer && styles.buttonDisabled,
                ]}
              >
                {connectingServer ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.backgroundPrimary}
                  />
                ) : (
                  <>
                    <Ionicons
                      name="cloud-upload"
                      size={16}
                      color={colors.backgroundPrimary}
                      style={styles.buttonIcon}
                    />
                    <Text style={styles.buttonText}>Connect to Server</Text>
                  </>
                )}
              </Pressable>

              <Pressable
                onPress={() => setOnboardingStep("select")}
                disabled={connectingServer}
                style={styles.textButton}
              >
                <Text style={styles.textButtonText}>Back</Text>
              </Pressable>
            </CyberCard>
          </Animated.View>
        );

      case "channel_setup":
        return (
          <Animated.View entering={FadeInDown.duration(400)}>
            <CyberCard
              style={{ marginBottom: Spacing.xl, padding: Spacing.xl }}
            >
              <View style={styles.cardHeader}>
                <Ionicons
                  name="link-outline"
                  size={22}
                  color={colors.accentMint}
                />
                <Text style={styles.cardTitle}>Signaling Connected</Text>
              </View>
              <Text style={styles.infoLabel}>
                Select whether you want to host a new synchronization channel or
                connect to an existing active channel.
              </Text>

              <Pressable
                onPress={handleCreateChannel}
                style={({ pressed }) => [
                  styles.optionCard,
                  pressed && styles.optionCardPressed,
                ]}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={28}
                  color={colors.accentMint}
                />
                <View style={styles.optionCardContent}>
                  <Text style={styles.optionCardTitle}>
                    Create Sync Channel
                  </Text>
                  <Text style={styles.optionCardDesc}>
                    Generate a new secure synchronization room and receive a
                    unique channel ID.
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => setOnboardingStep("join_channel")}
                style={({ pressed }) => [
                  styles.optionCard,
                  pressed && styles.optionCardPressed,
                ]}
              >
                <Ionicons
                  name="enter-outline"
                  size={28}
                  color={colors.accentMint}
                />
                <View style={styles.optionCardContent}>
                  <Text style={styles.optionCardTitle}>Join Sync Channel</Text>
                  <Text style={styles.optionCardDesc}>
                    Connect to an active room by typing or scanning a channel ID
                    from another device.
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => {
                  setIsConfigured(false);
                  setOnboardingStep("network_config");
                }}
                style={styles.textButton}
              >
                <Text style={styles.textButtonText}>Back</Text>
              </Pressable>
            </CyberCard>
          </Animated.View>
        );

      case "join_channel":
        return (
          <Animated.View entering={FadeInDown.duration(400)}>
            <CyberCard
              style={{ marginBottom: Spacing.xl, padding: Spacing.xl }}
            >
              <View style={styles.cardHeader}>
                <Ionicons name="enter" size={22} color={colors.accentMint} />
                <Text style={styles.cardTitle}>Join Sync Channel</Text>
              </View>
              <Text style={styles.infoLabel}>
                Input the synchronization room ID manually, or trigger the
                camera scanner.
              </Text>

              <View style={styles.inputContainer}>
                <Ionicons
                  name="key-outline"
                  size={18}
                  color={colors.textMuted}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  value={inputRoomId}
                  onChangeText={setInputRoomId}
                  placeholder="Enter Room/Channel ID"
                  placeholderTextColor={colors.textDisabled}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.buttonRow}>
                <Pressable
                  onPress={handleStartScan}
                  style={({ pressed }) => [
                    styles.buttonSecondary,
                    { flex: 1, marginTop: 0 },
                    pressed && styles.buttonSecondaryPressed,
                  ]}
                >
                  <Ionicons
                    name="camera-outline"
                    size={18}
                    color={colors.accentMint}
                    style={styles.buttonIcon}
                  />
                  <Text style={styles.buttonSecondaryText}>Scan QR</Text>
                </Pressable>

                <Pressable
                  onPress={handleJoinChannel}
                  style={({ pressed }) => [
                    styles.button,
                    { flex: 1, marginTop: 0 },
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={18}
                    color={colors.backgroundPrimary}
                    style={styles.buttonIcon}
                  />
                  <Text style={styles.buttonText}>Join</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => setOnboardingStep("channel_setup")}
                style={styles.textButton}
              >
                <Text style={styles.textButtonText}>Back</Text>
              </Pressable>
            </CyberCard>
          </Animated.View>
        );

      default:
        return null;
    }
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <View style={styles.shieldContainer}>
        <Animated.View style={[styles.shieldGlow, glowStyle]} />
        <Ionicons name="shield-checkmark" size={38} color={colors.accentMint} />
      </View>
      <Text style={styles.title}>VaultPeer</Text>
      <Text style={styles.subtitle}>Secure, In-place KeePass Vaults</Text>
    </View>
  );

  if (isScanning) {
    return (
      <SafeAreaView
        style={[
          styles.container,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ["qr"],
          }}
          onBarcodeScanned={({ data }) => {
            setIsScanning(false);
            if (data) {
              setInputRoomId(data);
            }
          }}
        />
        <View style={styles.scannerOverlay}>
          <View style={styles.scannerCutout} />
          <Text style={styles.scannerText}>
            Align sync channel QR code within the frame
          </Text>
          <Pressable
            onPress={() => setIsScanning(false)}
            style={styles.cancelScanButton}
          >
            <Text style={styles.buttonText}>Cancel Scan</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
                color={colors.statusError}
              />
              <Text style={styles.errorText}>{currentError}</Text>
            </Animated.View>
          )}

          {/* Active Database / Unlocked Stats View */}
          {redirecting ? (
            <Animated.View entering={FadeInDown.duration(300)}>
              <CyberCard
                style={{
                  marginBottom: Spacing.xl,
                  padding: Spacing.xl,
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 180,
                }}
              >
                <ActivityIndicator size="large" color={colors.accentMint} />
                <Text
                  style={[
                    styles.cardTitle,
                    { marginTop: Spacing.lg, color: colors.textSecondary },
                  ]}
                >
                  Opening Vault...
                </Text>
              </CyberCard>
            </Animated.View>
          ) : storeDb && dbStats ? (
            <Animated.View entering={FadeInDown.duration(400)}>
              <CyberCard
                style={{ marginBottom: Spacing.xl, padding: Spacing.xl }}
              >
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="lock-open"
                    size={22}
                    color={colors.accentMint}
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
                    color={colors.backgroundPrimary}
                    style={styles.buttonIcon}
                  />
                  <Text style={styles.buttonText}>Lock Vault</Text>
                </Pressable>
              </CyberCard>
            </Animated.View>
          ) : syncMode === null ? (
            renderOnboarding()
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
                        color={colors.accentMint}
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
                        color={colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Master Password"
                        placeholderTextColor={colors.textDisabled}
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
                          color={colors.textMuted}
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
                            color={colors.backgroundPrimary}
                          />
                        ) : (
                          <>
                            <Ionicons
                              name="lock-open"
                              size={16}
                              color={colors.backgroundPrimary}
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
                            color={colors.accentMint}
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
                        onPress={handleChooseAnother}
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

              {mode === "recent" && (
                <Animated.View entering={FadeInDown.duration(300)}>
                  <CyberCard
                    style={{ marginBottom: Spacing.xl, padding: Spacing.xl }}
                  >
                    <View style={styles.cardHeader}>
                      <Ionicons
                        name="time"
                        size={22}
                        color={colors.accentMint}
                      />
                      <Text style={styles.cardTitle}>Recent Vaults</Text>
                    </View>

                    <ScrollView
                      style={styles.recentList}
                      contentContainerStyle={{ gap: Spacing.md }}
                    >
                      {recentVaults.map((vault) => (
                        <View
                          key={vault.uri}
                          style={styles.recentItemContainer}
                        >
                          <Pressable
                            onPress={() => selectRecentVault(vault.uri)}
                            style={({ pressed }) => [
                              styles.recentItemPressable,
                              pressed && styles.recentItemPressed,
                            ]}
                          >
                            <Ionicons
                              name="file-tray-full-outline"
                              size={20}
                              color={colors.accentMint}
                              style={styles.recentItemIcon}
                            />
                            <View style={styles.recentItemInfo}>
                              <Text
                                style={styles.recentItemName}
                                numberOfLines={1}
                              >
                                {vault.name}
                              </Text>
                              <Text
                                style={styles.recentItemMeta}
                                numberOfLines={1}
                              >
                                Last opened:{" "}
                                {formatLastOpened(vault.lastOpened)}
                              </Text>
                            </View>
                          </Pressable>

                          <Pressable
                            onPress={() => {
                              setModalConfig({
                                visible: true,
                                title: "Forget Vault",
                                description: `Are you sure you want to remove "${vault.name}" from your recent list? This will also disable biometric unlock for this vault.`,
                                icon: "trash-outline",
                                iconColor: colors.statusError,
                                buttons: [
                                  {
                                    text: "Cancel",
                                    onPress: hideModal,
                                    variant: "secondary",
                                  },
                                  {
                                    text: "Forget",
                                    variant: "destructive",
                                    onPress: () => {
                                      hideModal();
                                      removeRecentVault(vault.uri);
                                    },
                                  },
                                ],
                              });
                            }}
                            style={({ pressed }) => [
                              styles.recentItemRemoveBtn,
                              pressed && styles.recentItemRemoveBtnPressed,
                            ]}
                            hitSlop={12}
                          >
                            <Ionicons
                              name="trash-outline"
                              size={18}
                              color={colors.statusError}
                            />
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>

                    <View style={styles.divider} />

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
                          color={colors.backgroundPrimary}
                        />
                      ) : (
                        <>
                          <Ionicons
                            name="folder-open"
                            size={16}
                            color={colors.backgroundPrimary}
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
                        color={colors.accentMint}
                        style={styles.buttonIcon}
                      />
                      <Text style={styles.buttonSecondaryText}>
                        Create New Vault
                      </Text>
                    </Pressable>
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
                          color={colors.backgroundPrimary}
                        />
                      ) : (
                        <>
                          <Ionicons
                            name="folder-open"
                            size={16}
                            color={colors.backgroundPrimary}
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
                        color={colors.accentMint}
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
                        color={colors.accentMint}
                      />
                      <Text style={styles.cardTitle}>Create KeePass Vault</Text>
                    </View>

                    <View style={styles.inputContainer}>
                      <Ionicons
                        name="document-text"
                        size={18}
                        color={colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        value={newVaultName}
                        onChangeText={setNewVaultName}
                        placeholder="Database Name"
                        placeholderTextColor={colors.textDisabled}
                        editable={!isLoading}
                      />
                    </View>

                    <View style={styles.inputContainer}>
                      <Ionicons
                        name="key"
                        size={18}
                        color={colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        secureTextEntry={!showNewPassword}
                        value={newPassword}
                        onChangeText={setNewPassword}
                        placeholder="Master Password"
                        placeholderTextColor={colors.textDisabled}
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
                          color={colors.textMuted}
                        />
                      </Pressable>
                    </View>

                    {newPassword.length > 0 && (
                      <Animated.View
                        entering={FadeInDown.duration(200)}
                        style={styles.strengthContainer}
                      >
                        <View style={styles.strengthHeader}>
                          <Text style={styles.strengthLabel}>
                            Password Strength
                          </Text>
                          <Text
                            style={[
                              styles.strengthValue,
                              { color: strength.color },
                            ]}
                          >
                            {strength.label} ({Math.round(strength.entropy)}{" "}
                            bits)
                          </Text>
                        </View>
                        <View style={styles.strengthBarContainer}>
                          {[0, 1, 2, 3].map((index) => {
                            const active = strength.score >= index + 1;
                            return (
                              <View
                                key={index}
                                style={[
                                  styles.strengthBar,
                                  active
                                    ? { backgroundColor: strength.color }
                                    : {
                                        backgroundColor: colors.surfaceElevated,
                                      },
                                ]}
                              />
                            );
                          })}
                        </View>
                      </Animated.View>
                    )}

                    <View style={styles.inputContainer}>
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        secureTextEntry={!showNewPassword}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        placeholder="Confirm Master Password"
                        placeholderTextColor={colors.textDisabled}
                        editable={!isLoading}
                      />
                    </View>

                    {/* Advanced Settings Accordion */}
                    <Pressable
                      onPress={() => setShowAdvanced(!showAdvanced)}
                      style={styles.advancedHeader}
                    >
                      <View style={styles.advancedHeaderLabelContainer}>
                        <Ionicons
                          name="options-outline"
                          size={18}
                          color={colors.textMuted}
                          style={styles.inputIcon}
                        />
                        <Text style={styles.advancedHeaderTitle}>
                          Advanced Settings
                        </Text>
                      </View>
                      <Ionicons
                        name={showAdvanced ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={colors.textMuted}
                      />
                    </Pressable>

                    {showAdvanced && (
                      <View style={styles.advancedContent}>
                        {/* Encryption Cipher Section */}
                        <View style={styles.optionSection}>
                          <Text style={styles.optionLabel}>
                            Encryption Cipher
                          </Text>
                          <View style={styles.segmentedControl}>
                            {(["AES-256", "ChaCha20"] as const).map(
                              (cipher) => (
                                <Pressable
                                  key={cipher}
                                  onPress={() => setSelectedCipher(cipher)}
                                  style={[
                                    styles.segmentBtn,
                                    selectedCipher === cipher &&
                                      styles.segmentBtnActive,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.segmentBtnText,
                                      selectedCipher === cipher &&
                                        styles.segmentBtnTextActive,
                                    ]}
                                  >
                                    {cipher}
                                  </Text>
                                </Pressable>
                              )
                            )}
                          </View>
                        </View>

                        {/* Key Derivation (KDF) Section */}
                        <View style={styles.optionSection}>
                          <Text style={styles.optionLabel}>
                            Key Derivation (KDF)
                          </Text>
                          <View style={styles.segmentedControl}>
                            {(["Argon2id", "Argon2d", "AES-KDF"] as const).map(
                              (kdf) => (
                                <Pressable
                                  key={kdf}
                                  onPress={() => setSelectedKdf(kdf)}
                                  style={[
                                    styles.segmentBtn,
                                    selectedKdf === kdf &&
                                      styles.segmentBtnActive,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.segmentBtnText,
                                      selectedKdf === kdf &&
                                        styles.segmentBtnTextActive,
                                    ]}
                                  >
                                    {kdf}
                                  </Text>
                                </Pressable>
                              )
                            )}
                          </View>
                        </View>
                      </View>
                    )}

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
                          color={colors.backgroundPrimary}
                        />
                      ) : (
                        <>
                          <Ionicons
                            name="save"
                            size={16}
                            color={colors.backgroundPrimary}
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
                        setMode(recentVaults.length > 0 ? "recent" : "select");
                        setFormError(null);
                        setShowAdvanced(false);
                        setSelectedKdf("Argon2id");
                        setSelectedCipher("AES-256");
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

          {/* Connection Status Indicator */}
          {syncMode === "network" && (
            <View
              style={[
                styles.infoBox,
                { marginBottom: Spacing.md, marginTop: -Spacing.xs },
              ]}
            >
              <Ionicons
                name="wifi-outline"
                size={14}
                color={
                  connectionStatus === "connected"
                    ? colors.accentMint
                    : colors.statusError
                }
              />
              <Text style={styles.infoBoxText}>
                Sync Status:{" "}
                <Text
                  style={{
                    color:
                      connectionStatus === "connected"
                        ? colors.accentMint
                        : colors.statusError,
                  }}
                >
                  {connectionStatus}
                </Text>
                {roomId ? ` | Room: ${roomId}` : ""}
                {isConfigured ? ` | Server: ${serverUrl}` : ""}
              </Text>
            </View>
          )}

          {/* Secure Sync Notice Info */}
          <View style={styles.infoBox}>
            <Ionicons
              name="lock-closed"
              size={14}
              color={colors.textDisabled}
            />
            <Text style={styles.infoBoxText}>
              In-place file editing uses Android SAF / iOS Security Bookmarks.
              Changes are automatically updated in cloud folders (Nextcloud,
              Drive, Syncthing).
            </Text>
          </View>

          {syncMode !== null && (
            <Pressable
              onPress={async () => {
                setModalConfig({
                  visible: true,
                  title: "Change Sync Mode",
                  description:
                    "Are you sure you want to reset your sync configurations? This will disconnect you from signaling and return you to the onboarding wizard.",
                  icon: "refresh-circle-outline",
                  iconColor: colors.statusWarning,
                  buttons: [
                    {
                      text: "Cancel",
                      onPress: hideModal,
                      variant: "secondary",
                    },
                    {
                      text: "Reset Mode",
                      variant: "destructive",
                      onPress: async () => {
                        hideModal();
                        await setSyncMode(null);
                        await setIsConfigured(false);
                        setOnboardingStep("select");
                      },
                    },
                  ],
                });
              }}
              style={styles.resetProtocolBtn}
            >
              <Ionicons
                name="refresh-outline"
                size={14}
                color={colors.textMuted}
                style={{ marginRight: Spacing.xs }}
              />
              <Text style={styles.resetProtocolBtnText}>
                Reset Sync Mode Settings
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Reusable Action Modal */}
      <ActionModal
        visible={modalConfig.visible}
        onClose={hideModal}
        title={modalConfig.title}
        description={modalConfig.description}
        icon={modalConfig.icon}
        iconColor={modalConfig.iconColor}
        options={modalConfig.options}
        buttons={modalConfig.buttons}
      />
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.backgroundPrimary,
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
      backgroundColor: colors.accentMintDim,
      borderWidth: 1.5,
      borderColor: "rgba(52, 211, 153, 0.3)",
      ...Platform.select<any>({
        ios: Shadows.glow,
        android: {},
      }),
    },
    title: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.title,
      lineHeight: LineHeights.title,
      color: colors.textPrimary,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      lineHeight: LineHeights.bodySmall,
      color: colors.textMuted,
      marginTop: Spacing.xs,
    },

    // Cards
    card: {
      backgroundColor: colors.surfaceCard,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: colors.borderSage,
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
      color: colors.textPrimary,
    },
    infoLabel: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      lineHeight: LineHeights.bodySmall,
      color: colors.textMuted,
      marginBottom: Spacing.lg,
      textAlign: "center",
    },
    filenameLabel: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textMuted,
      marginBottom: Spacing.lg,
    },
    filename: {
      fontFamily: Fonts.mono.regular,
      color: colors.accentMint,
    },

    // Error Card
    errorCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.statusErrorDim,
      borderWidth: 1,
      borderColor: colors.statusError,
      borderRadius: Radii.md,
      padding: Spacing.md,
      marginBottom: Spacing.xl,
      gap: Spacing.sm,
    },
    errorText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
      flex: 1,
    },

    // Form Fields
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderSage,
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
      color: colors.textPrimary,
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
      backgroundColor: colors.accentMint,
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
      color: colors.backgroundPrimary,
      letterSpacing: 0.5,
    },
    buttonSecondary: {
      backgroundColor: colors.transparent,
      borderWidth: 1,
      borderColor: colors.accentMint,
      borderRadius: Radii.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      minHeight: TouchTarget.min,
      paddingVertical: Spacing.md,
      marginTop: Spacing.md,
    },
    buttonSecondaryPressed: {
      backgroundColor: colors.accentMintDim,
    },
    buttonSecondaryText: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.body,
      color: colors.accentMint,
      letterSpacing: 0.5,
    },
    lockButton: {
      backgroundColor: colors.accentMint,
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
      color: colors.textMuted,
    },
    rowButtons: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: Spacing.sm,
    },

    // Divider
    divider: {
      height: 1,
      backgroundColor: colors.borderSage,
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
      color: colors.textMuted,
    },
    statsValue: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
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
      color: colors.textDisabled,
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
      borderColor: colors.accentMint,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.transparent,
    },
    bioButtonPressed: {
      backgroundColor: colors.accentMintDim,
    },
    bioButtonDisabled: {
      opacity: 0.5,
    },
    advancedHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: Spacing.sm,
      marginBottom: Spacing.md,
      marginTop: Spacing.xs,
    },
    advancedHeaderLabelContainer: {
      flexDirection: "row",
      alignItems: "center",
    },
    advancedHeaderTitle: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.bodySmall,
      color: colors.textSecondary,
    },
    advancedContent: {
      paddingBottom: Spacing.md,
      gap: Spacing.md,
    },
    optionSection: {
      gap: Spacing.xs,
    },
    optionLabel: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    segmentedControl: {
      flexDirection: "row",
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: colors.borderSage,
      padding: 2,
      gap: 2,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: Spacing.xs + 2,
      borderRadius: Radii.sm,
      justifyContent: "center",
      alignItems: "center",
      minHeight: 32,
    },
    segmentBtnActive: {
      backgroundColor: colors.accentMintDim,
    },
    segmentBtnText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      textAlign: "center",
    },
    segmentBtnTextActive: {
      fontFamily: Fonts.heading.semiBold,
      color: colors.accentMint,
      textAlign: "center",
    },
    strengthContainer: {
      marginTop: Spacing.sm,
      marginBottom: Spacing.md,
      backgroundColor: colors.surfaceCard,
      padding: Spacing.md,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: colors.borderSage,
    },
    strengthHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    strengthLabel: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
    },
    strengthValue: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.bodySmall,
    },
    strengthBarContainer: {
      flexDirection: "row",
      gap: Spacing.sm,
      height: 6,
    },
    strengthBar: {
      flex: 1,
      borderRadius: Radii.sm,
      backgroundColor: colors.surfaceElevated,
    },
    recentList: {
      maxHeight: 220,
      marginBottom: Spacing.md,
    },
    recentItemContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: colors.borderSage,
      paddingRight: Spacing.sm,
    },
    recentItemPressable: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      padding: Spacing.md,
      minHeight: TouchTarget.min,
    },
    recentItemPressed: {
      opacity: 0.7,
    },
    recentItemIcon: {
      marginRight: Spacing.md,
    },
    recentItemInfo: {
      flex: 1,
    },
    recentItemName: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
    },
    recentItemMeta: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      marginTop: 2,
    },
    recentItemRemoveBtn: {
      width: TouchTarget.min,
      height: TouchTarget.min,
      justifyContent: "center",
      alignItems: "center",
    },
    recentItemRemoveBtnPressed: {
      opacity: 0.6,
    },
    optionCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderSage,
      borderRadius: Radii.md,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      gap: Spacing.md,
    },
    optionCardPressed: {
      backgroundColor: colors.accentMintDim,
    },
    optionCardContent: {
      flex: 1,
    },
    optionCardTitle: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.body,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    optionCardDesc: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      lineHeight: LineHeights.caption,
      color: colors.textMuted,
    },
    scannerOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: "rgba(0,0,0,0.6)",
    },
    scannerCutout: {
      width: 260,
      height: 260,
      borderWidth: 2,
      borderColor: colors.accentMint,
      borderRadius: Radii.md,
      backgroundColor: "transparent",
      marginBottom: Spacing.xl,
    },
    scannerText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.body,
      color: "#ffffff",
      textAlign: "center",
      marginBottom: Spacing.xxl,
      paddingHorizontal: Spacing.xl,
    },
    cancelScanButton: {
      backgroundColor: colors.statusError,
      paddingHorizontal: Spacing.xl,
      minWidth: 160,
      marginTop: 0,
    },
    resetProtocolBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: Spacing.md,
      marginTop: Spacing.xl,
      alignSelf: "center",
    },
    resetProtocolBtnText: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
    },
  });
