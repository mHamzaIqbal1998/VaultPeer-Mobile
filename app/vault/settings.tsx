import * as AutofillBridge from "@/modules/vaultpeer-autofill";
import { ActionModal } from "@/src/components/ActionModal";
import { CyberCard } from "@/src/components/CyberCard";
import { KdfTuningModal } from "@/src/components/KdfTuningModal";
import {
  FontSizes,
  Fonts,
  Radii,
  Shadows,
  Spacing,
  TouchTarget,
  useThemeColors,
} from "@/src/constants/theme";
import { useFilePicker } from "@/src/context/FilePickerContext";
import { useClipboard } from "@/src/hooks/useClipboard";
import {
  disableBiometric,
  enableBiometric,
  isBiometricEnabled,
  isBiometricsSupported,
} from "@/src/services/biometricService";
import { applyKdfParams, parseMeta } from "@/src/services/crypto";
import type { KdfTuningParams } from "@/src/services/crypto/kdfBenchmark";
import {
  formatKdfParams,
  getCurrentKdfParams,
} from "@/src/services/crypto/kdfBenchmark";
import { estimatePasswordStrength } from "@/src/services/passwordGenerator";
import { syncEngine } from "@/src/services/sync/syncEngine";
import {
  MAX_BACKUP_RETENTION,
  MIN_BACKUP_RETENTION,
  useBackupStore,
} from "@/src/stores/useBackupStore";
import { useSignalingStore } from "@/src/stores/useSignalingStore";
import { useVaultStore } from "@/src/stores/useVaultStore";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import * as kdbxweb from "kdbxweb";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { pickDirectory } from "vaultpeer-file-system";

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

// ────────────────────────────────────────────
// Format Helpers
// ────────────────────────────────────────────

function formatAutoLock(ms: number) {
  if (ms === 0) return "Never";
  if (ms < 60000) return `${ms / 1000}s`;
  return `${ms / 60000}m`;
}

function formatClipboard(ms: number) {
  if (ms === 0) return "Never";
  if (ms < 60000) return `${ms / 1000}s`;
  return `${ms / 60000}m`;
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
  const colors = useThemeColors();
  const segStyles = useMemo(() => createSegStyles(colors), [colors]);
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
              ? colors.backgroundPrimary
              : colors.textMuted
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
            activeTab === "app" ? colors.backgroundPrimary : colors.textMuted
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

function createSegStyles(colors: any) {
  return StyleSheet.create({
    container: {
      flexDirection: "row",
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radii.md,
      padding: 3,
      position: "relative",
    },
    indicator: {
      position: "absolute",
      top: 3,
      bottom: 3,
      width: "50%",
      backgroundColor: colors.accentMint,
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
      color: colors.textMuted,
    },
    tabTextActive: {
      color: colors.backgroundPrimary,
    },
  });
}

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
  const colors = useThemeColors();
  const rowStyles = useMemo(() => createRowStyles(colors), [colors]);

  const content = (
    <View style={rowStyles.row}>
      <Ionicons
        name={icon as any}
        size={20}
        color={
          iconColor || (destructive ? colors.statusError : colors.textPrimary)
        }
      />
      <View style={rowStyles.textCol}>
        <Text
          style={[
            rowStyles.title,
            destructive && { color: colors.statusError },
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
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
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

function createRowStyles(colors: any) {
  return StyleSheet.create({
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
      color: colors.textPrimary,
    },
    subtitle: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      marginTop: 2,
    },
    value: {
      fontFamily: Fonts.mono.regular,
      fontSize: FontSizes.caption,
      color: colors.accentMint,
      maxWidth: 140,
    },
  });
}

// ────────────────────────────────────────────
// Main Settings Screen
// ────────────────────────────────────────────

export default function VaultSettingsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const modalStyles = useMemo(() => createModalStyles(colors), [colors]);
  const prefStyles = useMemo(() => createPrefStyles(colors), [colors]);
  const rowStyles = useMemo(() => createRowStyles(colors), [colors]);
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
    setTemplatesEnabled,
    setTemplatesGroup,
    groupIndex,
    setRecycleBinEnabled,
    setRecycleBinGroup,
    emptyRecycleBin,
    changeMasterPassword,
    setHistoryMaxItems,
    setHistoryMaxSize,
    theme,
    setTheme,
    autoLockTimeout,
    setAutoLockTimeout,
    clipboardClearTime,
    setClipboardClearTime,
    autoSave,
    setAutoSave,
    isSaving,
    setIsSaving,
  } = useVaultStore();
  const { clearVault, hasSavedVault, saveVault, loadVault } = useFilePicker();

  const {
    syncMode,
    setSyncMode,
    serverUrl,
    setServerUrl,
    roomId,
    connectionStatus,
    setIsConfigured,
    connect,
    disconnect,
    createRoom,
    joinRoom,
    leaveRoom,
    lastError,
    iceServers,
    setIceServers,
  } = useSignalingStore();

  const {
    enabled: backupEnabled,
    retention: backupRetention,
    dirUri: backupDirUri,
    dirName: backupDirName,
    setEnabled: setBackupEnabled,
    setRetention: setBackupRetention,
    setBackupDir,
    clearBackupDir,
  } = useBackupStore();

  const { copyToClipboard } = useClipboard();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [showQrModal, setShowQrModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showServerEditModal, setShowServerEditModal] = useState(false);
  const [showIceServersModal, setShowIceServersModal] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [newServerUrl, setNewServerUrl] = useState(serverUrl);
  const [newIceServersText, setNewIceServersText] = useState("");
  const [newRoomId, setNewRoomId] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<SettingsTab>("database");

  const themeIndicatorX = useSharedValue(theme === "dark" ? 0 : 1);

  useEffect(() => {
    themeIndicatorX.value = withSpring(theme === "dark" ? 0 : 1, {
      damping: 18,
      stiffness: 200,
    });
  }, [theme, themeIndicatorX]);

  const themeIndicatorStyle = useAnimatedStyle(() => ({
    left: `${themeIndicatorX.value * 50}%` as any,
  }));
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [showBiometricPasswordInput, setShowBiometricPasswordInput] =
    useState(false);
  const [biometricPassword, setBiometricPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showRecycleBinGroupModal, setShowRecycleBinGroupModal] =
    useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(
    null
  );
  const [changingPassword, setChangingPassword] = useState(false);
  const [autofillEnabled, setAutofillEnabled] = useState(false);

  const checkAutofillStatus = useCallback(async () => {
    try {
      const enabled = await AutofillBridge.isAutofillServiceEnabled();
      setAutofillEnabled(enabled);
    } catch {
      setAutofillEnabled(false);
    }
  }, []);

  const [historyMaxItemsInput, setHistoryMaxItemsInput] = useState("");
  const [historyMaxSizeInput, setHistoryMaxSizeInput] = useState("");
  const [historySettingsInitialized, setHistorySettingsInitialized] =
    useState(false);

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
    if (useVaultStore.getState().isSaving) return;
    setModalConfig((prev) => ({ ...prev, visible: false }));
  }, []);

  const showNotificationModal = useCallback(
    (
      title: string,
      description: string,
      icon: keyof typeof Ionicons.glyphMap = "checkmark-circle-outline"
    ) => {
      setModalConfig({
        visible: true,
        title,
        description,
        icon,
        buttons: [
          {
            text: "OK",
            onPress: () =>
              setModalConfig((prev) => ({ ...prev, visible: false })),
            variant: "primary",
          },
        ],
      });
    },
    []
  );

  const showErrorModal = useCallback(
    (title: string, description: string) => {
      setModalConfig({
        visible: true,
        title,
        description,
        icon: "alert-circle-outline",
        iconColor: colors.statusError,
        buttons: [
          {
            text: "OK",
            onPress: () =>
              setModalConfig((prev) => ({ ...prev, visible: false })),
            variant: "primary",
          },
        ],
      });
    },
    [colors.statusError]
  );

  const handleTestConnection = useCallback(() => {
    if (isTestingConnection) return;
    setIsTestingConnection(true);

    connect();

    setTimeout(() => {
      setIsTestingConnection(false);
      const newStatus = useSignalingStore.getState().connectionStatus;
      const errorMsg = useSignalingStore.getState().lastError;
      if (newStatus === "connected") {
        showNotificationModal(
          "Connection Successful",
          `Successfully connected to the signaling server at:\n${useSignalingStore.getState().serverUrl}`,
          "wifi-outline"
        );
      } else {
        showErrorModal(
          "Connection Failed",
          `Could not connect to the signaling server at:\n${useSignalingStore.getState().serverUrl}\n\nDetails: ${errorMsg || "Verify server URL and network connection"}\n\nCurrent Status: ${newStatus}\n\nPlease verify that the server is online.`
        );
      }
    }, 2500);
  }, [isTestingConnection, connect, showNotificationModal, showErrorModal]);

  // ── Backup retention handlers ──

  const handlePickBackupDir = useCallback(async () => {
    try {
      const result = await pickDirectory();
      if (!result || !result.uri) return;
      await setBackupDir(result.uri, result.name || null);
      return result.uri;
    } catch (e: any) {
      // ERR_CANCELLED is expected when the user dismisses the picker.
      if (e?.code !== "ERR_CANCELLED" && !`${e?.message}`.includes("cancel")) {
        showErrorModal(
          "Folder Selection Failed",
          e?.message || "Could not select a backup folder."
        );
      }
      return undefined;
    }
  }, [setBackupDir, showErrorModal]);

  const handleToggleBackup = useCallback(async () => {
    if (backupEnabled) {
      await setBackupEnabled(false);
      return;
    }
    // Enabling requires a destination folder. Prompt for one if needed.
    let dir = backupDirUri;
    if (!dir) {
      dir = (await handlePickBackupDir()) ?? null;
      if (!dir) return; // user cancelled or it failed — leave disabled
    }
    await setBackupEnabled(true);
  }, [backupEnabled, backupDirUri, handlePickBackupDir, setBackupEnabled]);

  const handleChangeRetention = useCallback(
    (delta: number) => {
      void setBackupRetention(backupRetention + delta);
    },
    [backupRetention, setBackupRetention]
  );

  const handleClearBackupDir = useCallback(() => {
    setModalConfig({
      visible: true,
      title: "Remove Backup Folder",
      description:
        "Backups will be turned off until you choose a new folder. Existing backup files will not be deleted.",
      icon: "folder-open-outline",
      buttons: [
        {
          text: "Cancel",
          onPress: () =>
            setModalConfig((prev) => ({ ...prev, visible: false })),
          variant: "secondary",
        },
        {
          text: "Remove",
          onPress: async () => {
            setModalConfig((prev) => ({ ...prev, visible: false }));
            await clearBackupDir();
          },
          variant: "destructive",
        },
      ],
    });
  }, [clearBackupDir]);

  const handleStartScan = useCallback(async () => {
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
    setFormError(null);
    setIsScanning(true);
    setShowJoinModal(false);
  }, [cameraPermission, requestCameraPermission]);

  const templateGroupName = useMemo(() => {
    if (!storeMeta?.entryTemplatesGroup) return "Templates";
    const group = groupIndex.get(storeMeta.entryTemplatesGroup);
    return group ? group.name : "Templates";
  }, [storeMeta, groupIndex]);

  const recycleBinGroupName = useMemo(() => {
    if (!storeMeta?.recycleBinUuid) return "Recycle Bin";
    const group = groupIndex.get(storeMeta.recycleBinUuid);
    return group ? group.name : "Recycle Bin";
  }, [storeMeta, groupIndex]);

  const handleEmptyRecycleBinPress = useCallback(() => {
    if (!db || !storeMeta?.recycleBinUuid) return;
    const binGroup = groupIndex.get(storeMeta.recycleBinUuid);
    if (!binGroup) return;

    const itemsCount =
      (binGroup.entries?.length || 0) + (binGroup.groups?.length || 0);
    if (itemsCount === 0) {
      showNotificationModal(
        "Recycle Bin Empty",
        "There are no items in the Recycle Bin to delete.",
        "trash-outline"
      );
      return;
    }

    setModalConfig({
      visible: true,
      title: "Empty Recycle Bin",
      description: `Are you sure you want to permanently delete all ${itemsCount} item(s) inside the "${binGroup.name}" group? This action cannot be undone.`,
      icon: "trash-outline",
      iconColor: colors.statusError,
      buttons: [
        { text: "Cancel", onPress: hideModal, variant: "secondary" },
        {
          text: "Empty Bin",
          variant: "destructive",
          onPress: async () => {
            hideModal();
            const success = await emptyRecycleBin();
            if (success) {
              showNotificationModal(
                "Success",
                "Recycle bin emptied successfully."
              );
            } else {
              showErrorModal("Error", "Failed to empty the recycle bin.");
            }
          },
        },
      ],
    });
  }, [
    db,
    storeMeta,
    groupIndex,
    emptyRecycleBin,
    colors.statusError,
    hideModal,
    showNotificationModal,
    showErrorModal,
  ]);

  const handleChangePassword = async () => {
    if (!currentPassword) {
      setChangePasswordError("Please enter your current master password.");
      return;
    }
    if (!newPassword) {
      setChangePasswordError("Please enter a new master password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError("New passwords do not match.");
      return;
    }

    try {
      const inputHash =
        await kdbxweb.ProtectedValue.fromString(currentPassword).getHash();
      const currentHash = (db?.credentials as any)?.passwordHash?.getBinary();
      if (!currentHash) {
        setChangePasswordError(
          "Failed to retrieve current database credentials."
        );
        return;
      }

      let match = inputHash.byteLength === currentHash.byteLength;
      if (match) {
        const inputArr = new Uint8Array(inputHash);
        const currentArr = new Uint8Array(currentHash);
        for (let i = 0; i < inputArr.length; i++) {
          if (inputArr[i] !== currentArr[i]) {
            match = false;
            break;
          }
        }
      }

      if (!match) {
        setChangePasswordError("Incorrect current master password.");
        return;
      }
    } catch (e: any) {
      setChangePasswordError(
        "Failed to verify current master password: " + (e?.message || "")
      );
      return;
    }

    setChangePasswordError(null);
    setChangingPassword(true);

    setTimeout(async () => {
      try {
        const success = await changeMasterPassword(newPassword);
        if (success) {
          showNotificationModal(
            "Success",
            "Master password updated successfully. Don't forget to save your database to persist changes."
          );
          setShowChangePasswordModal(false);
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        } else {
          setChangePasswordError("Failed to update master password.");
        }
      } catch (e: any) {
        setChangePasswordError(e?.message || "An unexpected error occurred.");
      } finally {
        setChangingPassword(false);
      }
    }, 100);
  };

  const [showKdfModal, setShowKdfModal] = useState(false);

  const handleAutoLockPress = useCallback(() => {
    const options = [
      {
        label: "15 Seconds",
        value: 15000,
        isSelected: autoLockTimeout === 15000,
        onPress: () => {
          setAutoLockTimeout(15000);
          hideModal();
        },
      },
      {
        label: "30 Seconds",
        value: 30000,
        isSelected: autoLockTimeout === 30000,
        onPress: () => {
          setAutoLockTimeout(30000);
          hideModal();
        },
      },
      {
        label: "1 Minute",
        value: 60000,
        isSelected: autoLockTimeout === 60000,
        onPress: () => {
          setAutoLockTimeout(60000);
          hideModal();
        },
      },
      {
        label: "2 Minutes",
        value: 120000,
        isSelected: autoLockTimeout === 120000,
        onPress: () => {
          setAutoLockTimeout(120000);
          hideModal();
        },
      },
      {
        label: "5 Minutes",
        value: 300000,
        isSelected: autoLockTimeout === 300000,
        onPress: () => {
          setAutoLockTimeout(300000);
          hideModal();
        },
      },
      {
        label: "Never",
        value: 0,
        isSelected: autoLockTimeout === 0,
        onPress: () => {
          setAutoLockTimeout(0);
          hideModal();
        },
      },
    ];
    setModalConfig({
      visible: true,
      title: "Auto-Lock Timeout",
      description: "Select inactivity duration before the database is locked.",
      icon: "time-outline",
      options,
    });
  }, [autoLockTimeout, setAutoLockTimeout, hideModal]);

  const handleClipboardPress = useCallback(() => {
    const options = [
      {
        label: "10 Seconds",
        value: 10000,
        isSelected: clipboardClearTime === 10000,
        onPress: () => {
          setClipboardClearTime(10000);
          hideModal();
        },
      },
      {
        label: "20 Seconds",
        value: 20000,
        isSelected: clipboardClearTime === 20000,
        onPress: () => {
          setClipboardClearTime(20000);
          hideModal();
        },
      },
      {
        label: "30 Seconds",
        value: 30000,
        isSelected: clipboardClearTime === 30000,
        onPress: () => {
          setClipboardClearTime(30000);
          hideModal();
        },
      },
      {
        label: "1 Minute",
        value: 60000,
        isSelected: clipboardClearTime === 60000,
        onPress: () => {
          setClipboardClearTime(60000);
          hideModal();
        },
      },
      {
        label: "2 Minutes",
        value: 120000,
        isSelected: clipboardClearTime === 120000,
        onPress: () => {
          setClipboardClearTime(120000);
          hideModal();
        },
      },
      {
        label: "Never",
        value: 0,
        isSelected: clipboardClearTime === 0,
        onPress: () => {
          setClipboardClearTime(0);
          hideModal();
        },
      },
    ];
    setModalConfig({
      visible: true,
      title: "Clipboard Clear",
      description: "Select delay before sensitive clipboard items are cleared.",
      icon: "clipboard-outline",
      options,
    });
  }, [clipboardClearTime, setClipboardClearTime, hideModal]);

  useEffect(() => {
    async function checkBiometrics() {
      const supported = await isBiometricsSupported();
      const enabled = await isBiometricEnabled(fileUri || undefined);
      setBiometricSupported(supported);
      setBiometricEnabled(enabled);
    }
    checkBiometrics();
  }, [fileUri]);

  useEffect(() => {
    checkAutofillStatus();
    const interval = setInterval(checkAutofillStatus, 3000);
    return () => clearInterval(interval);
  }, [checkAutofillStatus]);

  // Initialize history settings inputs from storeMeta
  useEffect(() => {
    if (storeMeta && !historySettingsInitialized) {
      setHistoryMaxItemsInput(String(storeMeta.historyMaxItems ?? 10));
      const sizeInMB =
        Math.round(
          ((storeMeta.historyMaxSize ?? 6 * 1024 * 1024) / (1024 * 1024)) * 10
        ) / 10;
      setHistoryMaxSizeInput(String(sizeInMB));
      setHistorySettingsInitialized(true);
    }
  }, [storeMeta, historySettingsInitialized]);

  const handleToggleBiometric = useCallback(async () => {
    if (biometricEnabled) {
      await disableBiometric(fileUri || undefined);
      setBiometricEnabled(false);
      setShowBiometricPasswordInput(false);
      setBiometricPassword("");
      showNotificationModal(
        "Success",
        "Biometric unlock disabled.",
        "finger-print-outline"
      );
    } else {
      setShowBiometricPasswordInput(true);
    }
  }, [biometricEnabled, fileUri, showNotificationModal]);

  const handleConfirmBiometric = useCallback(async () => {
    if (verifying) return;
    if (!biometricPassword) {
      showErrorModal("Error", "Please enter your master password.");
      return;
    }
    setVerifying(true);
    setTimeout(async () => {
      try {
        const { db: verifiedDb } = await loadVault(biometricPassword);
        if (verifiedDb) {
          const success = await enableBiometric(
            biometricPassword,
            fileUri || undefined
          );
          if (success) {
            setBiometricEnabled(true);
            setShowBiometricPasswordInput(false);
            setBiometricPassword("");
            showNotificationModal(
              "Success",
              "Biometric unlock enabled successfully.",
              "finger-print-outline"
            );
          } else {
            showErrorModal(
              "Error",
              "Failed to enable biometric authentication."
            );
          }
        }
      } catch (e: any) {
        showErrorModal(
          "Verification Failed",
          e?.message || "Invalid master password."
        );
      } finally {
        setVerifying(false);
      }
    }, 50);
  }, [
    biometricPassword,
    loadVault,
    verifying,
    fileUri,
    showNotificationModal,
    showErrorModal,
  ]);

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
    Keyboard.dismiss();
    const performLock = () => {
      closeDatabase();
      router.replace("/");
    };

    const waitAndLock = () => {
      const engine = syncEngine;

      let attempts = 0;
      const maxAttempts = 150; // 15 seconds timeout to allow sync to complete

      const poll = () => {
        const pushes = engine.getActivePushesCount();
        const pulls = engine.getActivePullsCount();
        const localSaving = useVaultStore.getState().isSaving;

        if (
          (localSaving || pushes > 0 || pulls > 0) &&
          attempts < maxAttempts
        ) {
          attempts++;
          let title = "Saving Changes";
          let desc = "Saving changes to your vault file. Please wait...";
          if (pushes > 0 || pulls > 0) {
            title = "Syncing with Peers";
            desc = `Syncing changes with connected peers. Please wait...`;
          }
          setModalConfig({
            visible: true,
            title,
            description: desc,
            icon: pushes > 0 || pulls > 0 ? "sync-outline" : "save-outline",
            iconColor: colors.accentMint,
            buttons: [],
          });
          setTimeout(poll, 100);
        } else {
          setModalConfig((prev) => ({ ...prev, visible: false }));
          performLock();
        }
      };

      poll();
    };

    if (isSaving) {
      waitAndLock();
      return;
    }

    if (isDirty) {
      if (autoSave) {
        // Trigger save immediately, then wait for saving and syncing to finish
        setSaving(true);
        setIsSaving(true);
        setTimeout(async () => {
          try {
            if (db) {
              await saveVault(db);
              markClean();
            }
            waitAndLock();
          } catch (e: any) {
            showErrorModal(
              "Error Saving",
              e?.message || "Failed to write database file."
            );
          } finally {
            setSaving(false);
            setIsSaving(false);
          }
        }, 150);
        return;
      } else {
        // Manual save prompt
        setModalConfig({
          visible: true,
          title: "Unsaved Changes",
          description:
            "You have unsaved changes. Do you want to save them before locking, or discard them?",
          icon: "alert-circle-outline",
          iconColor: colors.statusError,
          buttons: [
            {
              text: "Save & Lock",
              variant: "primary",
              onPress: async () => {
                setModalConfig((prev) => ({ ...prev, visible: false }));
                setSaving(true);
                setIsSaving(true);
                setTimeout(async () => {
                  try {
                    if (db) {
                      await saveVault(db);
                      markClean();
                    }
                    waitAndLock();
                  } catch (e: any) {
                    showErrorModal(
                      "Error Saving",
                      e?.message || "Failed to write database file."
                    );
                  } finally {
                    setSaving(false);
                    setIsSaving(false);
                  }
                }, 150);
              },
            },
            {
              text: "Discard & Lock",
              variant: "destructive",
              onPress: () => {
                setModalConfig((prev) => ({ ...prev, visible: false }));
                performLock();
              },
            },
            {
              text: "Cancel",
              variant: "secondary",
              onPress: () => {
                setModalConfig((prev) => ({ ...prev, visible: false }));
              },
            },
          ],
        });
        return;
      }
    }

    // If not dirty, check if we need to wait for any active sync/pushes first
    waitAndLock();
  }, [
    isDirty,
    autoSave,
    db,
    saveVault,
    markClean,
    closeDatabase,
    router,
    colors.statusError,
    colors.accentMint,
    showErrorModal,
    isSaving,
    setIsSaving,
  ]);

  const handleSave = useCallback(async () => {
    if (!db || saving) return;
    setSaving(true);
    setIsSaving(true);
    setTimeout(async () => {
      try {
        await saveVault(db);
        markClean();
        showNotificationModal("Success", "Vault saved successfully.");
      } catch (e: any) {
        showErrorModal(
          "Error Saving",
          e?.message || "Failed to write database file."
        );
      } finally {
        setSaving(false);
        setIsSaving(false);
      }
    }, 150);
  }, [
    db,
    saveVault,
    markClean,
    saving,
    showNotificationModal,
    showErrorModal,
    setIsSaving,
  ]);

  const handleForget = useCallback(() => {
    setModalConfig({
      visible: true,
      title: "Forget Vault",
      description:
        "This will remove the vault pointer and clear biometrics. The .kdbx file itself will not be deleted.",
      icon: "trash-outline",
      iconColor: colors.statusError,
      buttons: [
        { text: "Cancel", onPress: hideModal, variant: "secondary" },
        {
          text: "Forget",
          variant: "destructive",
          onPress: async () => {
            hideModal();
            closeDatabase();
            await clearVault();
            router.replace("/");
          },
        },
      ],
    });
  }, [clearVault, closeDatabase, router, colors.statusError, hideModal]);

  const handleApplyKdfParams = useCallback(
    (params: KdfTuningParams) => {
      if (!db) return;
      applyKdfParams(db, params);
      refreshParsedState();
      useVaultStore.getState().markDirty();
      showNotificationModal(
        "KDF Updated",
        "New parameters applied. Save the database to persist changes."
      );
    },
    [db, refreshParsedState, showNotificationModal]
  );

  const handleToggleCompression = useCallback(() => {
    if (!db) return;
    const compressionVal = db.header.compression || 0;
    const options = [
      {
        label: "GZip (Default)",
        value: 1,
        isSelected: compressionVal === 1,
        onPress: () => {
          db.header.compression = 1; // 1 = GZip
          refreshParsedState();
          useVaultStore.getState().markDirty();
          hideModal();
          showNotificationModal(
            "Compression Updated",
            "New parameters applied. Save the database to persist changes."
          );
        },
      },
      {
        label: "None",
        value: 0,
        isSelected: compressionVal === 0,
        onPress: () => {
          db.header.compression = 0; // 0 = None
          refreshParsedState();
          useVaultStore.getState().markDirty();
          hideModal();
          showNotificationModal(
            "Compression Updated",
            "New parameters applied. Save the database to persist changes."
          );
        },
      },
    ];
    setModalConfig({
      visible: true,
      title: "Database Compression",
      description:
        "Select XML compression algorithm for database serialization.",
      icon: "file-tray-full-outline",
      options,
    });
  }, [db, refreshParsedState, hideModal, showNotificationModal]);

  const handleCleanupPress = useCallback(() => {
    if (!db) return;
    const summary = cleanupDatabase({ binaries: true, history: true });
    if (!summary) return;

    const { historyToRemove, binariesToRemove } = summary;

    if (historyToRemove === 0 && binariesToRemove === 0) {
      showNotificationModal(
        "Database Clean",
        "Your database is already clean! No unreferenced attachments or redundant history entries found.",
        "shield-checkmark-outline"
      );
      return;
    }

    setModalConfig({
      visible: true,
      title: "Clean Up Database",
      description: `This will optimize your database file size.\n\nSummary of items to remove:\n• Unused binaries/attachments: ${binariesToRemove}\n• Redundant history entries: ${historyToRemove}\n\nDo you want to proceed?`,
      icon: "sparkles-outline",
      buttons: [
        { text: "Cancel", onPress: hideModal, variant: "secondary" },
        {
          text: "Clean Up",
          variant: "primary",
          onPress: () => {
            hideModal();
            const success = runCleanupDatabase({
              binaries: true,
              history: true,
            });
            if (success) {
              showNotificationModal(
                "Cleanup Success",
                `Successfully cleaned up the database!\n\nRemoved:\n• ${binariesToRemove} unused binaries/attachments\n• ${historyToRemove} redundant history entries.\n\nDon't forget to save your changes.`
              );
            } else {
              showErrorModal("Error", "Failed to perform database cleanup.");
            }
          },
        },
      ],
    });
  }, [
    db,
    cleanupDatabase,
    runCleanupDatabase,
    hideModal,
    showNotificationModal,
    showErrorModal,
  ]);

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
        {(isDirty || isSaving) && (
          <CyberCard style={styles.warningCard}>
            <View style={styles.warningHeader}>
              <Ionicons
                name="warning-outline"
                size={20}
                color={colors.statusWarning}
              />
              <Text style={styles.warningTitle}>Unsaved Changes</Text>
            </View>
            <Text style={styles.warningText}>
              You have modifications since the last save. Save now to write to
              file.
            </Text>
            <Pressable
              onPress={handleSave}
              disabled={saving || isSaving || (autoSave && isDirty)}
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && styles.saveBtnPressed,
                (saving || isSaving || (autoSave && isDirty)) && {
                  opacity: 0.6,
                },
              ]}
            >
              {saving || isSaving || (autoSave && isDirty) ? (
                <ActivityIndicator
                  size="small"
                  color={colors.backgroundPrimary}
                />
              ) : (
                <>
                  <Ionicons
                    name="save-outline"
                    size={16}
                    color={colors.backgroundPrimary}
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
                    color={colors.accentMint}
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
                    color={colors.accentMint}
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
                  icon="key-outline"
                  iconColor={colors.accentMint}
                  title="Change Master Password"
                  subtitle="Modify database master passphrase"
                  onPress={() => setShowChangePasswordModal(true)}
                />
                <View style={styles.divider} />
                <SettingsRow
                  icon="speedometer-outline"
                  iconColor={colors.accentMint}
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
                    color={colors.accentMint}
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

            {/* Entry History Settings */}
            <Animated.View entering={FadeInDown.duration(200).delay(160)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="time-outline"
                    size={18}
                    color={colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Entry History</Text>
                </View>
                <Text style={styles.historyDesc}>
                  Configure how many historical snapshots are retained per
                  entry.
                </Text>
                <View style={styles.historyInputRow}>
                  <View style={styles.historyInputGroup}>
                    <Text style={styles.historyInputLabel}>Max Items</Text>
                    <View style={styles.historyInputContainer}>
                      <TextInput
                        style={styles.historyInput}
                        value={historyMaxItemsInput}
                        onChangeText={setHistoryMaxItemsInput}
                        onBlur={() => {
                          const parsed = parseInt(historyMaxItemsInput, 10);
                          if (!isNaN(parsed) && parsed >= 0) {
                            setHistoryMaxItems(parsed);
                          } else {
                            setHistoryMaxItemsInput(
                              String(storeMeta?.historyMaxItems ?? 10)
                            );
                          }
                        }}
                        keyboardType="number-pad"
                        placeholderTextColor={colors.textDisabled}
                        placeholder="10"
                        maxLength={4}
                      />
                    </View>
                    <Text style={styles.historyInputHint}>per entry</Text>
                  </View>
                  <View style={styles.historyInputGroup}>
                    <Text style={styles.historyInputLabel}>Max Size</Text>
                    <View style={styles.historyInputContainer}>
                      <TextInput
                        style={styles.historyInput}
                        value={historyMaxSizeInput}
                        onChangeText={setHistoryMaxSizeInput}
                        onBlur={() => {
                          const parsed = parseFloat(historyMaxSizeInput);
                          if (!isNaN(parsed) && parsed >= 0) {
                            const bytes = Math.round(parsed * 1024 * 1024);
                            setHistoryMaxSize(bytes);
                          } else {
                            const currentMB =
                              Math.round(
                                ((storeMeta?.historyMaxSize ??
                                  6 * 1024 * 1024) /
                                  (1024 * 1024)) *
                                  10
                              ) / 10;
                            setHistoryMaxSizeInput(String(currentMB));
                          }
                        }}
                        keyboardType="decimal-pad"
                        placeholderTextColor={colors.textDisabled}
                        placeholder="6"
                        maxLength={6}
                      />
                    </View>
                    <Text style={styles.historyInputHint}>MB total</Text>
                  </View>
                </View>
              </CyberCard>
            </Animated.View>

            {/* Entry Templates */}
            <Animated.View entering={FadeInDown.duration(200).delay(175)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="copy-outline"
                    size={18}
                    color={colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Entry Templates</Text>
                </View>
                <View style={styles.biometricRow}>
                  <View style={rowStyles.textCol}>
                    <Text style={rowStyles.title}>Enable Entry Templates</Text>
                    <Text style={rowStyles.subtitle}>
                      Use predefined templates for creating new entries
                    </Text>
                  </View>
                  <Pressable
                    onPress={async () => {
                      const newEnabled = !storeMeta?.entryTemplatesEnabled;
                      await setTemplatesEnabled(newEnabled);
                    }}
                    style={styles.switchButton}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={
                        storeMeta?.entryTemplatesEnabled
                          ? "toggle"
                          : "toggle-outline"
                      }
                      size={38}
                      color={
                        storeMeta?.entryTemplatesEnabled
                          ? colors.accentMint
                          : colors.textMuted
                      }
                    />
                  </Pressable>
                </View>
                {storeMeta?.entryTemplatesEnabled && (
                  <>
                    <View style={styles.divider} />
                    <SettingsRow
                      icon="folder-open-outline"
                      title="Template Group"
                      subtitle="Group containing your custom templates"
                      value={templateGroupName}
                      onPress={() => setShowGroupModal(true)}
                    />
                  </>
                )}
              </CyberCard>
            </Animated.View>

            {/* Recycle Bin */}
            <Animated.View entering={FadeInDown.duration(200).delay(185)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color={colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Recycle Bin</Text>
                </View>
                <View style={styles.biometricRow}>
                  <View style={rowStyles.textCol}>
                    <Text style={rowStyles.title}>Enable Recycle Bin</Text>
                    <Text style={rowStyles.subtitle}>
                      Move deleted items to a recycle bin instead of deleting
                      permanently
                    </Text>
                  </View>
                  <Pressable
                    onPress={async () => {
                      const newEnabled = !storeMeta?.recycleBinEnabled;
                      await setRecycleBinEnabled(newEnabled);
                    }}
                    style={styles.switchButton}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={
                        storeMeta?.recycleBinEnabled
                          ? "toggle"
                          : "toggle-outline"
                      }
                      size={38}
                      color={
                        storeMeta?.recycleBinEnabled
                          ? colors.accentMint
                          : colors.textMuted
                      }
                    />
                  </Pressable>
                </View>
                {storeMeta?.recycleBinEnabled && (
                  <>
                    <View style={styles.divider} />
                    <SettingsRow
                      icon="folder-open-outline"
                      title="Recycle Bin Group"
                      subtitle="Group designated as the active recycle bin"
                      value={recycleBinGroupName}
                      onPress={() => setShowRecycleBinGroupModal(true)}
                    />
                    <View style={styles.divider} />
                    <SettingsRow
                      icon="trash-bin-outline"
                      iconColor={colors.statusError}
                      title="Empty Recycle Bin"
                      subtitle="Permanently delete all items in the bin"
                      onPress={handleEmptyRecycleBinPress}
                      destructive
                    />
                  </>
                )}
              </CyberCard>
            </Animated.View>

            {/* Database Actions */}
            <Animated.View entering={FadeInDown.duration(200).delay(200)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="construct-outline"
                    size={18}
                    color={colors.accentMint}
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
                      color={colors.accentMint}
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
                            ? colors.accentMint
                            : colors.textMuted
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
                          placeholderTextColor={colors.textDisabled}
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
                              color={colors.backgroundPrimary}
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
                    color={colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Preferences</Text>
                </View>

                {/* Theme Selector */}
                <View style={prefStyles.themeRow}>
                  <View style={rowStyles.textCol}>
                    <Text style={rowStyles.title}>Theme</Text>
                    <Text style={rowStyles.subtitle}>
                      Select application color palette
                    </Text>
                  </View>
                  <View style={prefStyles.segmentedContainer}>
                    <Animated.View
                      style={[prefStyles.indicator, themeIndicatorStyle]}
                    />
                    <Pressable
                      style={prefStyles.segmentButton}
                      onPress={() => setTheme("dark")}
                    >
                      <Text
                        style={[
                          prefStyles.segmentText,
                          theme === "dark" && prefStyles.segmentTextActive,
                        ]}
                      >
                        Dark
                      </Text>
                    </Pressable>
                    <Pressable
                      style={prefStyles.segmentButton}
                      onPress={() => setTheme("light")}
                    >
                      <Text
                        style={[
                          prefStyles.segmentText,
                          theme === "light" && prefStyles.segmentTextActive,
                        ]}
                      >
                        Light
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.divider} />

                {/* Auto Lock */}
                <SettingsRow
                  icon="timer-outline"
                  title="Auto-Lock"
                  subtitle="Inactivity duration before locking"
                  value={formatAutoLock(autoLockTimeout)}
                  onPress={handleAutoLockPress}
                />

                <View style={styles.divider} />

                {/* Clipboard Clear */}
                <SettingsRow
                  icon="clipboard-outline"
                  title="Clipboard Clear"
                  subtitle="Delay before clearing clipboard"
                  value={formatClipboard(clipboardClearTime)}
                  onPress={handleClipboardPress}
                />

                <View style={styles.divider} />

                {/* Auto-Save */}
                <SettingsRow
                  icon="save-outline"
                  title="Auto-Save"
                  subtitle="Automatically save changes to storage"
                  onPress={() => setAutoSave(!autoSave)}
                  rightElement={
                    <View pointerEvents="none" style={styles.switchButton}>
                      <Ionicons
                        name={autoSave ? "toggle" : "toggle-outline"}
                        size={38}
                        color={autoSave ? colors.accentMint : colors.textMuted}
                      />
                    </View>
                  }
                />
              </CyberCard>
            </Animated.View>

            {/* Android Autofill Service */}
            <Animated.View entering={FadeInDown.duration(200).delay(120)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="color-wand-outline"
                    size={18}
                    color={colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Android Autofill</Text>
                </View>

                <View style={styles.biometricRow}>
                  <View style={rowStyles.textCol}>
                    <Text style={rowStyles.title}>
                      {autofillEnabled ? "Service Active" : "Service Inactive"}
                    </Text>
                    <Text style={rowStyles.subtitle}>
                      {autofillEnabled
                        ? "VaultPeer is registered as your system autofill provider"
                        : "Enable VaultPeer to automatically fill passwords in other apps"}
                    </Text>
                  </View>
                  <Pressable
                    onPress={async () => {
                      try {
                        await AutofillBridge.openAutofillSettings();
                      } catch {
                        showErrorModal(
                          "Error",
                          "Could not open Autofill settings."
                        );
                      }
                    }}
                    style={styles.switchButton}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={
                        autofillEnabled
                          ? "checkmark-circle"
                          : "arrow-forward-circle-outline"
                      }
                      size={28}
                      color={
                        autofillEnabled ? colors.accentMint : colors.textMuted
                      }
                    />
                  </Pressable>
                </View>
              </CyberCard>
            </Animated.View>

            {/* Network & Peer Sync */}
            <Animated.View entering={FadeInDown.duration(200).delay(130)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="wifi-outline"
                    size={18}
                    color={colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Network & Peer Sync</Text>
                </View>

                {/* Enable/Disable Sync */}
                <View style={styles.biometricRow}>
                  <View style={rowStyles.textCol}>
                    <Text style={rowStyles.title}>
                      {syncMode === "network"
                        ? "Sync Mode: Network Sync"
                        : "Sync Mode: Offline Local"}
                    </Text>
                    <Text style={rowStyles.subtitle}>
                      {syncMode === "network"
                        ? "Real-time vault syncing with other devices"
                        : "Vault remains strictly on this local device"}
                    </Text>
                  </View>
                  <Pressable
                    onPress={async () => {
                      const nextMode =
                        syncMode === "network" ? "offline" : "network";
                      await setSyncMode(nextMode);
                      await setIsConfigured(nextMode === "network");
                      if (nextMode === "offline") {
                        disconnect();
                      }
                    }}
                    style={styles.switchButton}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={
                        syncMode === "network" ? "toggle" : "toggle-outline"
                      }
                      size={38}
                      color={
                        syncMode === "network"
                          ? colors.accentMint
                          : colors.textMuted
                      }
                    />
                  </Pressable>
                </View>

                {syncMode === "network" && (
                  <>
                    <View style={styles.divider} />
                    {/* Server URL */}
                    <SettingsRow
                      icon="server-outline"
                      title="Signaling Server"
                      subtitle="Endpoint for secure peer negotiation"
                      value={serverUrl}
                      onPress={() => {
                        setNewServerUrl(serverUrl);
                        setShowServerEditModal(true);
                      }}
                    />

                    <View style={styles.divider} />
                    {/* ICE Servers */}
                    <SettingsRow
                      icon="shield-outline"
                      title="ICE Servers (STUN/TURN)"
                      subtitle="Relay configuration for symmetric NATs"
                      value={
                        iceServers.length > 0
                          ? `${iceServers.length} custom server${
                              iceServers.length > 1 ? "s" : ""
                            }`
                          : "Default (STUN only)"
                      }
                      onPress={() => {
                        setNewIceServersText(
                          iceServers.length > 0
                            ? JSON.stringify(iceServers, null, 2)
                            : ""
                        );
                        setShowIceServersModal(true);
                      }}
                    />

                    <View style={styles.divider} />
                    {/* Connection Status & Test Connection */}
                    <View style={rowStyles.row}>
                      <Ionicons
                        name="link-outline"
                        size={20}
                        color={
                          connectionStatus === "connected"
                            ? colors.accentMint
                            : connectionStatus === "connecting"
                              ? colors.statusWarning
                              : colors.statusError
                        }
                      />
                      <View style={rowStyles.textCol}>
                        <Text style={rowStyles.title}>Connection Status</Text>
                        <Text style={rowStyles.subtitle}>
                          {connectionStatus === "connected" && "Connected"}
                          {connectionStatus === "connecting" && "Connecting..."}
                          {connectionStatus === "disconnected" &&
                            "Disconnected / Reconnecting"}
                          {connectionStatus === "offline" && "Offline"}
                        </Text>
                        {connectionStatus !== "connected" && lastError ? (
                          <Text
                            style={[
                              rowStyles.subtitle,
                              {
                                color: colors.statusError,
                                marginTop: 2,
                                fontSize: 11,
                              },
                            ]}
                          >
                            {lastError}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={handleTestConnection}
                        style={[
                          styles.testButton,
                          isTestingConnection && { opacity: 0.6 },
                        ]}
                        disabled={isTestingConnection}
                      >
                        {isTestingConnection ? (
                          <ActivityIndicator
                            size="small"
                            color={colors.accentMint}
                          />
                        ) : (
                          <Text style={styles.testButtonText}>
                            Test Connection
                          </Text>
                        )}
                      </Pressable>
                    </View>

                    <View style={styles.divider} />
                    {/* Room ID and options */}
                    {roomId ? (
                      <>
                        <SettingsRow
                          icon="qr-code-outline"
                          title="Show Sync QR Code"
                          subtitle="Scan this from another device to sync"
                          value={roomId.substring(0, 8) + "..."}
                          onPress={() => setShowQrModal(true)}
                        />
                        <View style={styles.divider} />
                        <SettingsRow
                          icon="swap-horizontal-outline"
                          title="Change Sync Channel"
                          subtitle="Connect to a different channel"
                          onPress={() => {
                            setNewRoomId(roomId);
                            setShowJoinModal(true);
                          }}
                        />
                        <View style={styles.divider} />
                        <SettingsRow
                          icon="exit-outline"
                          title="Leave Sync Channel"
                          subtitle="Disconnect from the active channel"
                          onPress={async () => {
                            await leaveRoom();
                            showNotificationModal(
                              "Channel Left",
                              "Successfully left the sync channel."
                            );
                          }}
                        />
                      </>
                    ) : (
                      <>
                        <SettingsRow
                          icon="add-circle-outline"
                          title="Create Sync Channel"
                          subtitle="Generate a new secure peer sync channel"
                          onPress={async () => {
                            const genId = await createRoom();
                            showNotificationModal(
                              "Channel Created",
                              `Sync Channel generated successfully:\n\n${genId}`
                            );
                          }}
                        />
                        <View style={styles.divider} />
                        <SettingsRow
                          icon="enter-outline"
                          title="Join Sync Channel"
                          subtitle="Scan a QR code or input manual channel ID"
                          onPress={() => {
                            setNewRoomId("");
                            setShowJoinModal(true);
                          }}
                        />
                      </>
                    )}
                  </>
                )}
              </CyberCard>
            </Animated.View>

            {/* Vault Backups */}
            <Animated.View entering={FadeInDown.duration(200).delay(140)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="albums-outline"
                    size={18}
                    color={colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>Vault Backups</Text>
                </View>

                {/* Enable / Disable backup retention */}
                <View style={styles.biometricRow}>
                  <View style={rowStyles.textCol}>
                    <Text style={rowStyles.title}>Backup on Sync</Text>
                    <Text style={rowStyles.subtitle}>
                      Keep previous versions when a newer vault is pulled from a
                      peer
                    </Text>
                  </View>
                  <Pressable
                    onPress={handleToggleBackup}
                    style={styles.switchButton}
                    hitSlop={8}
                  >
                    <Ionicons
                      name={backupEnabled ? "toggle" : "toggle-outline"}
                      size={38}
                      color={
                        backupEnabled ? colors.accentMint : colors.textMuted
                      }
                    />
                  </Pressable>
                </View>

                <View style={styles.divider} />

                {/* Backup folder */}
                <SettingsRow
                  icon="folder-outline"
                  title="Backup Folder"
                  subtitle={
                    backupDirUri
                      ? "Where retained versions are stored"
                      : "Choose a folder to store backups"
                  }
                  value={
                    backupDirName || (backupDirUri ? "Selected" : "Not set")
                  }
                  onPress={handlePickBackupDir}
                />
                {backupDirUri ? (
                  <Pressable
                    onPress={handleClearBackupDir}
                    style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                    hitSlop={6}
                  >
                    <Text style={styles.backupClearLink}>Remove folder</Text>
                  </Pressable>
                ) : null}

                <View style={styles.divider} />

                {/* Retention count stepper */}
                <View style={rowStyles.row}>
                  <Ionicons
                    name="layers-outline"
                    size={20}
                    color={colors.textPrimary}
                  />
                  <View style={rowStyles.textCol}>
                    <Text style={rowStyles.title}>Backups to Keep</Text>
                    <Text style={rowStyles.subtitle}>
                      Oldest versions beyond this are removed
                    </Text>
                  </View>
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => handleChangeRetention(-1)}
                      disabled={backupRetention <= MIN_BACKUP_RETENTION}
                      style={[
                        styles.stepperBtn,
                        backupRetention <= MIN_BACKUP_RETENTION && {
                          opacity: 0.4,
                        },
                      ]}
                      hitSlop={6}
                    >
                      <Ionicons
                        name="remove"
                        size={18}
                        color={colors.textPrimary}
                      />
                    </Pressable>
                    <Text style={styles.stepperValue}>{backupRetention}</Text>
                    <Pressable
                      onPress={() => handleChangeRetention(1)}
                      disabled={backupRetention >= MAX_BACKUP_RETENTION}
                      style={[
                        styles.stepperBtn,
                        backupRetention >= MAX_BACKUP_RETENTION && {
                          opacity: 0.4,
                        },
                      ]}
                      hitSlop={6}
                    >
                      <Ionicons
                        name="add"
                        size={18}
                        color={colors.textPrimary}
                      />
                    </Pressable>
                  </View>
                </View>
              </CyberCard>
            </Animated.View>

            {/* About */}
            <Animated.View entering={FadeInDown.duration(200).delay(150)}>
              <CyberCard style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="heart-outline"
                    size={18}
                    color={colors.accentMint}
                  />
                  <Text style={styles.cardTitle}>About</Text>
                </View>
                <SettingsRow
                  icon="code-slash-outline"
                  title="Version"
                  value={Constants.expoConfig?.version ?? "unknown"}
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

      {/* Change Master Password Modal */}
      <Modal
        visible={showChangePasswordModal}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => {
          if (!changingPassword) {
            setShowChangePasswordModal(false);
            setChangePasswordError(null);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
          }
        }}
      >
        <View style={modalStyles.overlay}>
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: colors.overlay },
            ]}
          />
          <Pressable
            style={modalStyles.overlayPress}
            onPress={() => {
              if (!changingPassword) {
                setShowChangePasswordModal(false);
                setChangePasswordError(null);
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
              }
            }}
          />
          <Animated.View
            entering={FadeIn.duration(200).springify()}
            exiting={FadeOut.duration(150)}
            style={[modalStyles.modalContainer, { maxHeight: "85%" }]}
          >
            <View style={modalStyles.header}>
              <View style={modalStyles.headerIcon}>
                <Ionicons
                  name="key-outline"
                  size={20}
                  color={colors.accentMint}
                />
              </View>
              <Text style={modalStyles.headerTitle}>
                Change Master Password
              </Text>
              <Pressable
                onPress={() => {
                  if (!changingPassword) {
                    setShowChangePasswordModal(false);
                    setChangePasswordError(null);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                  }
                }}
                disabled={changingPassword}
                hitSlop={12}
                style={modalStyles.closeBtn}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: Spacing.md }}
            >
              {changePasswordError && (
                <View style={styles.errorContainer}>
                  <Ionicons
                    name="alert-circle"
                    size={16}
                    color={colors.statusError}
                  />
                  <Text style={styles.errorText}>{changePasswordError}</Text>
                </View>
              )}

              {/* Current Password */}
              <Text style={styles.inputLabel}>Current Master Password</Text>
              <View style={styles.inputContainer}>
                <Ionicons
                  name="lock-closed"
                  size={18}
                  color={colors.textMuted}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  secureTextEntry={!showCurrentPassword}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Enter current password"
                  placeholderTextColor={colors.textDisabled}
                  editable={!changingPassword}
                />
                <Pressable
                  onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                  style={styles.eyeButton}
                  hitSlop={8}
                >
                  <Ionicons
                    name={showCurrentPassword ? "eye-off" : "eye"}
                    size={20}
                    color={colors.textMuted}
                  />
                </Pressable>
              </View>

              {/* New Password */}
              <Text style={styles.inputLabel}>New Master Password</Text>
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
                  placeholder="Enter new password"
                  placeholderTextColor={colors.textDisabled}
                  editable={!changingPassword}
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

              {/* Password Strength Indicator */}
              {newPassword.length > 0 && (
                <View style={styles.strengthContainer}>
                  <View style={styles.strengthHeader}>
                    <Text style={styles.strengthLabel}>Password Strength</Text>
                    <Text
                      style={[
                        styles.strengthValue,
                        { color: estimatePasswordStrength(newPassword).color },
                      ]}
                    >
                      {estimatePasswordStrength(newPassword).label} (
                      {Math.round(
                        estimatePasswordStrength(newPassword).entropy
                      )}{" "}
                      bits)
                    </Text>
                  </View>
                  <View style={styles.strengthBarContainer}>
                    {[0, 1, 2, 3].map((index) => {
                      const strength = estimatePasswordStrength(newPassword);
                      const active = strength.score >= index + 1;
                      return (
                        <View
                          key={index}
                          style={[
                            styles.strengthBar,
                            active
                              ? { backgroundColor: strength.color }
                              : { backgroundColor: colors.surfaceElevated },
                          ]}
                        />
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Confirm New Password */}
              <Text style={styles.inputLabel}>Confirm New Master Password</Text>
              <View style={styles.inputContainer}>
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={colors.textMuted}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  secureTextEntry={!showConfirmPassword}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm new password"
                  placeholderTextColor={colors.textDisabled}
                  editable={!changingPassword}
                />
                <Pressable
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={styles.eyeButton}
                  hitSlop={8}
                >
                  <Ionicons
                    name={showConfirmPassword ? "eye-off" : "eye"}
                    size={20}
                    color={colors.textMuted}
                  />
                </Pressable>
              </View>

              <Pressable
                onPress={handleChangePassword}
                disabled={changingPassword}
                style={({ pressed }) => [
                  styles.submitButton,
                  pressed && styles.submitButtonPressed,
                  changingPassword && styles.submitButtonDisabled,
                ]}
              >
                {changingPassword ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.backgroundPrimary}
                  />
                ) : (
                  <Text style={styles.submitButtonText}>
                    Change Master Password
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Group Selector Modal */}
      <Modal
        visible={showGroupModal}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setShowGroupModal(false)}
      >
        <View style={modalStyles.overlay}>
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: colors.overlay },
            ]}
          />
          <Pressable
            style={modalStyles.overlayPress}
            onPress={() => setShowGroupModal(false)}
          />
          <Animated.View
            entering={FadeIn.duration(200).springify()}
            exiting={FadeOut.duration(150)}
            style={modalStyles.modalContainer}
          >
            <View style={modalStyles.header}>
              <View style={modalStyles.headerIcon}>
                <Ionicons
                  name="folder-open-outline"
                  size={20}
                  color={colors.accentMint}
                />
              </View>
              <Text style={modalStyles.headerTitle}>Select Template Group</Text>
              <Pressable
                onPress={() => setShowGroupModal(false)}
                hitSlop={12}
                style={modalStyles.closeBtn}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              style={modalStyles.scrollList}
              showsVerticalScrollIndicator={false}
            >
              {Array.from(groupIndex.values())
                .filter((g) => g.parentGroupUuid !== null)
                .map((group) => {
                  const isSelected =
                    storeMeta?.entryTemplatesGroup === group.uuid;
                  return (
                    <Pressable
                      key={group.uuid}
                      style={[
                        modalStyles.groupRow,
                        isSelected && modalStyles.groupRowSelected,
                      ]}
                      onPress={async () => {
                        await setTemplatesGroup(group.uuid);
                        setShowGroupModal(false);
                      }}
                    >
                      <Ionicons
                        name="folder"
                        size={20}
                        color={
                          isSelected ? colors.accentMint : colors.textMuted
                        }
                      />
                      <Text
                        style={[
                          modalStyles.groupName,
                          isSelected && modalStyles.groupNameSelected,
                        ]}
                      >
                        {group.name}
                      </Text>
                      {isSelected && (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={colors.accentMint}
                        />
                      )}
                    </Pressable>
                  );
                })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Recycle Bin Group Selector Modal */}
      <Modal
        visible={showRecycleBinGroupModal}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setShowRecycleBinGroupModal(false)}
      >
        <View style={modalStyles.overlay}>
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: colors.overlay },
            ]}
          />
          <Pressable
            style={modalStyles.overlayPress}
            onPress={() => setShowRecycleBinGroupModal(false)}
          />
          <Animated.View
            entering={FadeIn.duration(200).springify()}
            exiting={FadeOut.duration(150)}
            style={modalStyles.modalContainer}
          >
            <View style={modalStyles.header}>
              <View style={modalStyles.headerIcon}>
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={colors.accentMint}
                />
              </View>
              <Text style={modalStyles.headerTitle}>
                Select Recycle Bin Group
              </Text>
              <Pressable
                onPress={() => setShowRecycleBinGroupModal(false)}
                hitSlop={12}
                style={modalStyles.closeBtn}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              style={modalStyles.scrollList}
              showsVerticalScrollIndicator={false}
            >
              {Array.from(groupIndex.values())
                .filter((g) => g.parentGroupUuid !== null)
                .map((group) => {
                  const isSelected = storeMeta?.recycleBinUuid === group.uuid;
                  return (
                    <Pressable
                      key={group.uuid}
                      style={[
                        modalStyles.groupRow,
                        isSelected && modalStyles.groupRowSelected,
                      ]}
                      onPress={async () => {
                        await setRecycleBinGroup(group.uuid);
                        setShowRecycleBinGroupModal(false);
                      }}
                    >
                      <Ionicons
                        name="folder"
                        size={20}
                        color={
                          isSelected ? colors.accentMint : colors.textMuted
                        }
                      />
                      <Text
                        style={[
                          modalStyles.groupName,
                          isSelected && modalStyles.groupNameSelected,
                        ]}
                      >
                        {group.name}
                      </Text>
                      {isSelected && (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={colors.accentMint}
                        />
                      )}
                    </Pressable>
                  );
                })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Edit Server URL Modal */}
      <Modal
        visible={showServerEditModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowServerEditModal(false)}
      >
        <View style={modalStyles.overlay}>
          <CyberCard style={modalStyles.modalContainer}>
            <View style={modalStyles.header}>
              <Ionicons
                name="server-outline"
                size={24}
                color={colors.accentMint}
              />
              <Text style={modalStyles.headerTitle}>Signaling Server URL</Text>
            </View>

            <View style={styles.modalInputContainer}>
              <Text style={styles.inputLabel}>Server URL</Text>
              <TextInput
                style={styles.modalInput}
                value={newServerUrl}
                onChangeText={(text) => {
                  setNewServerUrl(text);
                  setFormError(null);
                }}
                placeholder="ws://... or wss://..."
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {formError && (
                <Text style={{ color: colors.statusError, fontSize: 12 }}>
                  {formError}
                </Text>
              )}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.modalButton,
                pressed && { opacity: 0.8 },
              ]}
              onPress={async () => {
                if (!newServerUrl.trim()) {
                  setFormError("Server URL cannot be empty");
                  return;
                }
                if (
                  !newServerUrl.startsWith("ws://") &&
                  !newServerUrl.startsWith("wss://")
                ) {
                  setFormError("URL must start with ws:// or wss://");
                  return;
                }
                setServerUrl(newServerUrl.trim());
                setShowServerEditModal(false);
                setFormError(null);
                // Trigger reconnection
                connect();
              }}
            >
              <Text style={styles.modalButtonText}>Save URL</Text>
            </Pressable>

            <Pressable
              style={styles.modalButtonSecondary}
              onPress={() => {
                setShowServerEditModal(false);
                setFormError(null);
              }}
            >
              <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
            </Pressable>
          </CyberCard>
        </View>
      </Modal>

      {/* Edit ICE Servers Modal */}
      <Modal
        visible={showIceServersModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowIceServersModal(false);
          setFormError(null);
        }}
      >
        <View style={modalStyles.overlay}>
          <CyberCard style={modalStyles.modalContainer}>
            <View style={modalStyles.header}>
              <Ionicons
                name="shield-checkmark-outline"
                size={24}
                color={colors.accentMint}
              />
              <Text style={modalStyles.headerTitle}>
                ICE Servers Configuration
              </Text>
            </View>

            <View style={styles.modalInputContainer}>
              <Text style={styles.inputLabel}>ICE Servers (JSON Array)</Text>
              <TextInput
                style={[
                  styles.modalInput,
                  {
                    height: 120,
                    textAlignVertical: "top",
                    paddingTop: 8,
                    paddingBottom: 8,
                    fontFamily: "SpaceMono-Regular",
                    fontSize: 12,
                  },
                ]}
                multiline
                numberOfLines={6}
                value={newIceServersText}
                onChangeText={(text) => {
                  setNewIceServersText(text);
                  setFormError(null);
                }}
                placeholder={`[\n  { "urls": ["stun:stun.l.google.com:19302"] },\n  { "urls": ["turn:your-turn-server.com:3478"], "username": "user", "credential": "pwd" }\n]`}
                placeholderTextColor={colors.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {formError && (
                <Text
                  style={{
                    color: colors.statusError,
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  {formError}
                </Text>
              )}
              <Text
                style={{ marginTop: 8, fontSize: 11, color: colors.textMuted }}
              >
                Input must be a valid JSON array of RTCIceServer objects. Leave
                empty to reset to default Google STUN.
              </Text>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.modalButton,
                pressed && { opacity: 0.8 },
              ]}
              onPress={async () => {
                const trimmed = newIceServersText.trim();
                if (!trimmed) {
                  await setIceServers([]);
                  setShowIceServersModal(false);
                  setFormError(null);
                  return;
                }

                try {
                  const parsed = JSON.parse(trimmed);
                  if (!Array.isArray(parsed)) {
                    setFormError("Configuration must be a JSON array");
                    return;
                  }
                  for (let i = 0; i < parsed.length; i++) {
                    const item = parsed[i];
                    if (typeof item !== "object" || item === null) {
                      setFormError(`Item at index ${i} must be an object`);
                      return;
                    }
                    if (!item.urls) {
                      setFormError(
                        `Item at index ${i} is missing "urls" field`
                      );
                      return;
                    }
                  }

                  await setIceServers(parsed);
                  setShowIceServersModal(false);
                  setFormError(null);
                } catch (e: any) {
                  setFormError(`Invalid JSON: ${e.message}`);
                }
              }}
            >
              <Text style={styles.modalButtonText}>Save Configuration</Text>
            </Pressable>

            <Pressable
              style={styles.modalButtonSecondary}
              onPress={() => {
                setShowIceServersModal(false);
                setFormError(null);
              }}
            >
              <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
            </Pressable>
          </CyberCard>
        </View>
      </Modal>

      {/* QR Code Modal */}
      <Modal
        visible={showQrModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowQrModal(false)}
      >
        <View style={modalStyles.overlay}>
          <CyberCard style={modalStyles.modalContainer}>
            <View style={modalStyles.header}>
              <Ionicons
                name="qr-code-outline"
                size={24}
                color={colors.accentMint}
              />
              <Text style={modalStyles.headerTitle}>Scan to Sync</Text>
            </View>

            <Text
              style={{
                fontFamily: Fonts.body.regular,
                fontSize: FontSizes.bodySmall,
                color: colors.textSecondary,
                textAlign: "center",
                marginBottom: Spacing.sm,
              }}
            >
              Scan this QR code from another VaultPeer device to securely join
              this channel.
            </Text>

            <View style={styles.qrContainer}>
              {roomId ? (
                <Image
                  source={{
                    uri: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(roomId)}`,
                  }}
                  style={styles.qrImage}
                  resizeMode="contain"
                />
              ) : null}
            </View>

            <Text style={styles.qrCodeText}>{roomId}</Text>

            <View style={styles.qrButtonsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  { flex: 1 },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => {
                  copyToClipboard(roomId);
                  showNotificationModal(
                    "Copied",
                    "Sync Channel ID copied to clipboard."
                  );
                }}
              >
                <Text style={styles.modalButtonText}>Copy ID</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.modalButtonSecondary,
                  { flex: 1, marginTop: 0 },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setShowQrModal(false)}
              >
                <Text style={styles.modalButtonSecondaryText}>Close</Text>
              </Pressable>
            </View>
          </CyberCard>
        </View>
      </Modal>

      {/* Join / Change Channel Modal */}
      <Modal
        visible={showJoinModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowJoinModal(false)}
      >
        <View style={modalStyles.overlay}>
          <CyberCard style={modalStyles.modalContainer}>
            <View style={modalStyles.header}>
              <Ionicons
                name="enter-outline"
                size={24}
                color={colors.accentMint}
              />
              <Text style={modalStyles.headerTitle}>Join Sync Channel</Text>
            </View>

            <View style={styles.modalInputContainer}>
              <Text style={styles.inputLabel}>Channel / Room ID</Text>
              <TextInput
                style={styles.modalInput}
                value={newRoomId}
                onChangeText={(text) => {
                  setNewRoomId(text);
                  setFormError(null);
                }}
                placeholder="Enter room ID or scan QR code"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {formError && (
                <Text
                  style={{
                    color: colors.statusError,
                    fontSize: 12,
                    marginBottom: Spacing.xs,
                  }}
                >
                  {formError}
                </Text>
              )}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.modalButton,
                pressed && { opacity: 0.8 },
              ]}
              onPress={async () => {
                if (!newRoomId.trim()) {
                  setFormError("Room ID cannot be empty");
                  return;
                }
                await joinRoom(newRoomId.trim());
                setShowJoinModal(false);
                setFormError(null);
                showNotificationModal(
                  "Channel Joined",
                  `Successfully joined sync channel:\n\n${newRoomId.trim()}`
                );
              }}
            >
              <Text style={styles.modalButtonText}>Join Channel</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.modalButtonSecondary,
                { borderStyle: "dashed", borderColor: colors.accentMint },
                pressed && { opacity: 0.8 },
              ]}
              onPress={handleStartScan}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: Spacing.xs,
                }}
              >
                <Ionicons
                  name="camera-outline"
                  size={16}
                  color={colors.accentMint}
                />
                <Text
                  style={[
                    styles.modalButtonSecondaryText,
                    { color: colors.accentMint },
                  ]}
                >
                  Scan QR Code
                </Text>
              </View>
            </Pressable>

            <Pressable
              style={[styles.modalButtonSecondary, { marginTop: Spacing.xs }]}
              onPress={() => {
                setShowJoinModal(false);
                setFormError(null);
              }}
            >
              <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
            </Pressable>
          </CyberCard>
        </View>
      </Modal>

      {/* Full screen Camera QR Scanner overlay */}
      {isScanning && (
        <View style={styles.scannerOverlay}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ["qr"],
            }}
            onBarcodeScanned={async ({ data }) => {
              if (data) {
                setIsScanning(false);
                await joinRoom(data);
                showNotificationModal(
                  "Channel Joined",
                  `Successfully joined sync channel:\n\n${data}`
                );
              }
            }}
          />
          <View
            style={{
              alignItems: "center",
              position: "absolute",
              bottom: 60,
              left: 20,
              right: 20,
            }}
          >
            <View style={styles.scannerCutout} />
            <Text style={styles.scannerText}>
              Position the sync QR code inside the frame
            </Text>
            <Pressable
              style={styles.cancelScanButton}
              onPress={() => {
                setIsScanning(false);
                setShowJoinModal(true);
              }}
            >
              <Text style={styles.cancelScanButtonText}>Cancel Scan</Text>
            </Pressable>
          </View>
        </View>
      )}

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
        hideOverlay
      />
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────

function createStyles(colors: any) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.backgroundPrimary,
    },
    header: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSage,
      alignItems: "center",
    },
    headerTitle: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.subheading,
      color: colors.textPrimary,
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
      color: colors.textPrimary,
    },
    divider: {
      height: 1,
      backgroundColor: colors.borderSage,
      marginVertical: Spacing.xs,
    },

    // Unsaved Warning Card
    warningCard: {
      borderColor: colors.statusWarning,
      backgroundColor: colors.statusWarningDim,
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
      color: colors.statusWarning,
    },
    warningText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: Spacing.md,
    },
    saveBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.xs,
      backgroundColor: colors.accentMint,
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
      color: colors.backgroundPrimary,
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
    stepper: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
    },
    stepperBtn: {
      width: 32,
      height: 32,
      borderRadius: Radii.sm,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderSage,
    },
    stepperValue: {
      fontFamily: Fonts.mono.regular,
      fontSize: FontSizes.body,
      color: colors.accentMint,
      minWidth: 24,
      textAlign: "center",
    },
    backupClearLink: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.statusError,
      paddingVertical: Spacing.xs,
      marginLeft: 32,
    },
    confirmPasswordContainer: {
      marginTop: Spacing.sm,
      padding: Spacing.md,
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: colors.borderSage,
    },
    confirmLabel: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.textPrimary,
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
      backgroundColor: colors.backgroundPrimary,
      borderWidth: 1,
      borderColor: colors.borderSage,
      borderRadius: Radii.sm,
      color: colors.textPrimary,
      paddingHorizontal: Spacing.sm,
      fontFamily: Fonts.mono.regular,
    },
    confirmBtn: {
      backgroundColor: colors.accentMint,
      borderRadius: Radii.sm,
      paddingHorizontal: Spacing.md,
      height: 40,
      justifyContent: "center",
      alignItems: "center",
    },
    confirmBtnText: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.bodySmall,
      color: colors.backgroundPrimary,
    },
    errorContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs,
      backgroundColor: colors.statusErrorDim,
      borderColor: colors.statusError,
      borderWidth: 1,
      borderRadius: Radii.md,
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    errorText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.statusError,
      flex: 1,
    },
    inputLabel: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.textSecondary,
      marginBottom: Spacing.xs,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
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
    },
    submitButton: {
      backgroundColor: colors.accentMint,
      borderRadius: Radii.md,
      height: TouchTarget.min,
      justifyContent: "center",
      alignItems: "center",
      marginTop: Spacing.md,
      ...Shadows.glow,
    },
    submitButtonPressed: {
      backgroundColor: "#2BC48A",
      transform: [{ scale: 0.98 }],
    },
    submitButtonDisabled: {
      opacity: 0.5,
    },
    submitButtonText: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.body,
      color: colors.backgroundPrimary,
    },
    strengthContainer: {
      marginTop: -Spacing.xs,
      marginBottom: Spacing.lg,
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

    // History Settings
    historyDesc: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      lineHeight: 18,
      marginBottom: Spacing.md,
    },
    historyInputRow: {
      flexDirection: "row",
      gap: Spacing.lg,
    },
    historyInputGroup: {
      flex: 1,
      alignItems: "center",
    },
    historyInputLabel: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.textSecondary,
      marginBottom: Spacing.xs,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    historyInputContainer: {
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderSage,
      borderRadius: Radii.md,
      width: "100%",
      overflow: "hidden",
    },
    historyInput: {
      color: colors.textPrimary,
      fontFamily: Fonts.mono.regular,
      fontSize: FontSizes.body,
      textAlign: "center",
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      minHeight: TouchTarget.min,
    },
    historyInputHint: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.micro,
      color: colors.textMuted,
      marginTop: Spacing.xxs,
    },
    testButton: {
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderSage,
      borderRadius: Radii.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      justifyContent: "center",
      alignItems: "center",
    },
    testButtonText: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.accentMint,
    },
    qrContainer: {
      alignItems: "center",
      justifyContent: "center",
      marginVertical: Spacing.md,
      padding: Spacing.md,
      backgroundColor: "#ffffff",
      borderRadius: Radii.md,
    },
    qrImage: {
      width: 200,
      height: 200,
    },
    qrCodeText: {
      fontFamily: Fonts.mono.regular,
      fontSize: FontSizes.caption,
      color: colors.textSecondary,
      textAlign: "center",
      marginTop: Spacing.sm,
      backgroundColor: colors.surfaceElevated,
      padding: Spacing.sm,
      borderRadius: Radii.sm,
      borderWidth: 1,
      borderColor: colors.borderSage,
    },
    qrButtonsRow: {
      flexDirection: "row",
      gap: Spacing.md,
      marginTop: Spacing.md,
      justifyContent: "center",
    },
    scannerOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.85)",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 1000,
    },
    scannerCutout: {
      width: 250,
      height: 250,
      borderWidth: 2,
      borderColor: colors.accentMint,
      backgroundColor: "transparent",
      borderRadius: Radii.lg,
      marginBottom: Spacing.lg,
    },
    scannerText: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.bodySmall,
      color: "#ffffff",
      textAlign: "center",
      marginBottom: Spacing.lg,
    },
    cancelScanButton: {
      backgroundColor: colors.statusError,
      borderRadius: Radii.md,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
    },
    cancelScanButtonText: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.bodySmall,
      color: "#ffffff",
    },
    modalInputContainer: {
      marginBottom: Spacing.md,
    },
    modalInput: {
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderSage,
      borderRadius: Radii.md,
      color: colors.textPrimary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontFamily: Fonts.mono.regular,
      fontSize: FontSizes.bodySmall,
      height: TouchTarget.min,
      marginBottom: Spacing.sm,
    },
    modalButton: {
      backgroundColor: colors.accentMint,
      borderRadius: Radii.md,
      height: TouchTarget.min,
      justifyContent: "center",
      alignItems: "center",
      marginTop: Spacing.xs,
    },
    modalButtonText: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.bodySmall,
      color: colors.backgroundPrimary,
    },
    modalButtonSecondary: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: colors.borderSage,
      borderRadius: Radii.md,
      height: TouchTarget.min,
      justifyContent: "center",
      alignItems: "center",
      marginTop: Spacing.sm,
    },
    modalButtonSecondaryText: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.bodySmall,
      color: colors.textSecondary,
    },
  });
}

function createModalStyles(colors: any) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    overlayPress: {
      ...StyleSheet.absoluteFillObject,
    },
    modalContainer: {
      width: "90%",
      maxWidth: 400,
      maxHeight: "70%",
      backgroundColor: colors.surfaceCard,
      borderRadius: Radii.xl,
      borderWidth: 1,
      borderColor: colors.borderSage,
      padding: Spacing.lg,
      ...Shadows.elevated,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      marginBottom: Spacing.md,
    },
    headerIcon: {
      width: 32,
      height: 32,
      borderRadius: Radii.md,
      backgroundColor: colors.accentMintDim,
      justifyContent: "center",
      alignItems: "center",
    },
    headerTitle: {
      flex: 1,
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.body,
      color: colors.textPrimary,
    },
    closeBtn: {
      width: TouchTarget.min,
      height: TouchTarget.min,
      justifyContent: "center",
      alignItems: "center",
    },
    scrollList: {
      maxHeight: 350,
    },
    groupRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
      borderRadius: Radii.md,
      gap: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    groupRowSelected: {
      backgroundColor: colors.accentMintDim,
    },
    groupName: {
      flex: 1,
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textSecondary,
    },
    groupNameSelected: {
      fontFamily: Fonts.heading.medium,
      color: colors.accentMint,
    },
  });
}

function createPrefStyles(colors: any) {
  return StyleSheet.create({
    themeRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: Spacing.xs,
    },
    segmentedContainer: {
      flexDirection: "row",
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radii.md,
      padding: 3,
      width: 140,
      position: "relative",
    },
    indicator: {
      position: "absolute",
      top: 3,
      bottom: 3,
      width: "50%",
      backgroundColor: colors.accentMint,
      borderRadius: Radii.sm,
    },
    segmentButton: {
      flex: 1,
      paddingVertical: 6,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: Radii.sm,
      zIndex: 1,
    },
    segmentText: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
    },
    segmentTextActive: {
      color: colors.backgroundPrimary,
    },
  });
}
