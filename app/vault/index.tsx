/**
 * Vault Browser Screen
 *
 * Displays the KeePass group tree with entry listings.
 * Supports:
 * - Navigating into sub-groups via breadcrumb stack
 * - Searching entries across the entire vault
 * - Viewing entry summaries with tap-to-detail navigation
 * - Creating new entries and groups via FAB
 */

import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  ActivityIndicator,
  Modal,
  ScrollView,
  Keyboard,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  useThemeColors,
  Fonts,
  FontSizes,
  Spacing,
  Radii,
  Shadows,
  TouchTarget,
} from "@/src/constants/theme";
import { useVaultStore } from "@/src/stores/useVaultStore";
import { useFilePicker } from "@/src/context/FilePickerContext";
import { useSignalingStore } from "@/src/stores/useSignalingStore";
import { useActiveConnection } from "@/src/hooks/useActiveConnection";
import { useSyncStore } from "@/src/stores/useSyncStore";
import { searchEntries } from "@/src/services/searchService";
import { getKdbxIconName, GROUP_DEFAULT_ICON } from "@/src/constants/kdbxIcons";
import type { VaultEntry, VaultGroup } from "@/src/types/kdbx";
import { ActionModal } from "@/src/components/ActionModal";
import { PeerListDrawer } from "@/src/components/PeerListDrawer";
import { RemoteUpdateBanner } from "@/src/components/RemoteUpdateBanner";
import { syncEngine } from "@/src/services/sync/syncEngine";

// ────────────────────────────────────────────
// Sub-Components
// ────────────────────────────────────────────

function GroupRow({
  group,
  onPress,
  onLongPress,
}: {
  group: VaultGroup;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const entryCount = group.entries.length;
  const subgroupCount = group.groups.length;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.groupRow, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Open group ${group.name}`}
    >
      <View style={styles.rowIconContainer}>
        <Ionicons
          name={GROUP_DEFAULT_ICON}
          size={22}
          color={colors.accentMint}
        />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.groupName} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={styles.groupMeta}>
          {subgroupCount > 0 &&
            `${subgroupCount} group${subgroupCount > 1 ? "s" : ""}`}
          {subgroupCount > 0 && entryCount > 0 && " · "}
          {entryCount > 0 &&
            `${entryCount} entr${entryCount > 1 ? "ies" : "y"}`}
          {subgroupCount === 0 && entryCount === 0 && "Empty"}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
    </Pressable>
  );
}

function EntryRow({
  entry,
  onPress,
}: {
  entry: VaultEntry;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const iconName = getKdbxIconName(entry.iconId);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.entryRow, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`View entry ${entry.title}`}
    >
      <View style={styles.rowIconContainer}>
        <Ionicons name={iconName} size={20} color={colors.textMuted} />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.entryTitle} numberOfLines={1}>
          {entry.title || "Untitled"}
        </Text>
        <Text style={styles.entryUsername} numberOfLines={1}>
          {entry.username || "No username"}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
    </Pressable>
  );
}

/**
 * SyncStatusButton — Header sync indicator
 *
 * Shows:
 *   • Sync icon with peer count badge when connected
 *   • Spinning sync icon when actively syncing/pushing
 *   • Spinning sync icon when saving (which triggers push to peers)
 *   • Offline icon when no peers
 *   • Error state when sync fails
 */
function SyncStatusButton({ onPress }: { onPress: () => void }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { syncMode, connectionStatus } = useSignalingStore();

  const syncStatus = useSyncStore((s) => s.status);
  const activePeers = useSyncStore((s) => s.activePeers);
  const pendingRemote = useSyncStore((s) => s.pendingRemote);
  const isSaving = useVaultStore((s) => s.isSaving);
  const isDirty = useVaultStore((s) => s.isDirty);
  const autoSave = useVaultStore((s) => s.autoSave);

  // Spinner animation for syncing/saving/connecting state
  const spinValue = useSharedValue(0);
  React.useEffect(() => {
    const shouldSpin =
      syncStatus === "syncing" ||
      isSaving ||
      (isDirty && autoSave) ||
      connectionStatus === "connecting";
    if (shouldSpin) {
      spinValue.value = withRepeat(
        withTiming(360, { duration: 1200 }),
        -1,
        false
      );
    } else {
      spinValue.value = 0;
    }
  }, [syncStatus, isSaving, isDirty, autoSave, connectionStatus, spinValue]);

  const spinStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${spinValue.value}deg` }],
    };
  });

  // Pulse animation for active state
  const pulseScale = useSharedValue(1);
  React.useEffect(() => {
    const shouldPulse =
      connectionStatus === "connecting" ||
      (connectionStatus === "connected" && activePeers > 0);
    if (shouldPulse) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 1000 }),
          withTiming(1.0, { duration: 1000 })
        ),
        -1,
        true
      );
    } else {
      pulseScale.value = 1;
    }
  }, [connectionStatus, activePeers, pulseScale]);

  const pulseStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: pulseScale.value }],
    };
  });

  if (syncMode !== "network") return null;

  // Determine appearance based on combined state
  let iconName: React.ComponentProps<typeof Ionicons>["name"] = "globe-outline";
  let iconColor: string = colors.textMuted;
  let text = "";
  let capsuleStyle: any = styles.syncCapsule;
  let textStyle: any = styles.syncCapsuleText;
  let isSpinning = false;
  let accessibilityLabel = "Sync status: idle";

  // 1. Connection states (signaling server)
  if (connectionStatus === "disconnected") {
    iconName = "cloud-offline-outline";
    iconColor = colors.statusError;
    text = "Offline";
    capsuleStyle = [styles.syncCapsule, styles.syncCapsuleError];
    textStyle = [styles.syncCapsuleText, styles.syncCapsuleTextError];
    accessibilityLabel = "Sync offline · disconnected from signaling server";
  } else if (connectionStatus === "connecting") {
    iconName = "sync-outline";
    iconColor = colors.statusWarning;
    text = "Connecting";
    capsuleStyle = [styles.syncCapsule, styles.syncCapsuleWarning];
    textStyle = [styles.syncCapsuleText, styles.syncCapsuleTextWarning];
    isSpinning = true;
    accessibilityLabel = "Connecting to signaling server…";
  } else {
    // connectionStatus === "connected"
    // Check active saving operations first (independent of peer count)
    if (isSaving || (isDirty && autoSave)) {
      iconName = "save";
      iconColor = colors.accentMint;
      text = activePeers > 0 ? `${activePeers}` : "Saving";
      capsuleStyle = [styles.syncCapsule, styles.syncCapsuleActive];
      textStyle = [styles.syncCapsuleText, styles.syncCapsuleTextActive];
      isSpinning = true;
      accessibilityLabel = `Saving changes and pushing to ${activePeers} peers…`;
    } else if (activePeers === 0) {
      iconName = "globe-outline";
      iconColor = colors.textMuted;
      text = "0";
      capsuleStyle = styles.syncCapsule;
      textStyle = styles.syncCapsuleText;
      accessibilityLabel = "Connected to signaling · waiting for peers";
    } else {
      // We have peers connected!
      iconName = "people-outline";
      iconColor = colors.accentMint;
      text = `${activePeers}`;
      capsuleStyle = [styles.syncCapsule, styles.syncCapsuleActive];
      textStyle = [styles.syncCapsuleText, styles.syncCapsuleTextActive];
      accessibilityLabel = `Connected · ${activePeers} peer${activePeers !== 1 ? "s" : ""} active`;

      // Handle active operations
      if (syncStatus === "syncing") {
        iconName = "sync";
        isSpinning = true;
        accessibilityLabel = `Syncing with ${activePeers} peer${activePeers !== 1 ? "s" : ""}…`;
      } else if (pendingRemote) {
        iconName =
          pendingRemote.mode === "conflict"
            ? "warning-outline"
            : "cloud-download-outline";
        iconColor =
          pendingRemote.mode === "conflict"
            ? colors.statusWarning
            : colors.accentMint;
        text = pendingRemote.mode === "conflict" ? "Conflict" : "Update";
        capsuleStyle = [
          styles.syncCapsule,
          pendingRemote.mode === "conflict"
            ? styles.syncCapsuleWarning
            : styles.syncCapsuleActive,
        ];
        textStyle = [
          styles.syncCapsuleText,
          pendingRemote.mode === "conflict"
            ? styles.syncCapsuleTextWarning
            : styles.syncCapsuleTextActive,
        ];
        accessibilityLabel =
          pendingRemote.mode === "conflict"
            ? "Sync conflict · action required"
            : "Remote update available · tap to apply";
      } else if (syncStatus === "error") {
        iconName = "alert-circle-outline";
        iconColor = colors.statusError;
        text = "Error";
        capsuleStyle = [styles.syncCapsule, styles.syncCapsuleError];
        textStyle = [styles.syncCapsuleText, styles.syncCapsuleTextError];
        accessibilityLabel = "Sync error occurred";
      }
    }
  }

  const RenderedIcon = () => (
    <Ionicons name={iconName} size={15} color={iconColor} />
  );

  return (
    <Animated.View style={pulseStyle}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [capsuleStyle, pressed && { opacity: 0.7 }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {isSpinning ? (
          <Animated.View style={spinStyle}>
            <RenderedIcon />
          </Animated.View>
        ) : (
          <RenderedIcon />
        )}
        {text ? <Text style={textStyle}>{text}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

const getTemplateCardStyle = (title: string, colors: any) => {
  switch (title.toLowerCase()) {
    case "credit card":
      return {
        icon: "card-outline" as const,
        bgDim: "rgba(244, 63, 94, 0.12)",
        color: "#F43F5E",
      };
    case "email account":
      return {
        icon: "mail-outline" as const,
        bgDim: "rgba(79, 70, 229, 0.12)",
        color: "#6366F1",
      };
    case "secure note":
      return {
        icon: "document-text-outline" as const,
        bgDim: "rgba(5, 150, 105, 0.12)",
        color: "#10B981",
      };
    case "ssh server":
      return {
        icon: "terminal-outline" as const,
        bgDim: "rgba(6, 182, 212, 0.12)",
        color: "#06B6D4",
      };
    case "wi-fi router":
      return {
        icon: "wifi-outline" as const,
        bgDim: "rgba(245, 158, 11, 0.12)",
        color: "#F59E0B",
      };
    case "membership / id":
      return {
        icon: "person-outline" as const,
        bgDim: "rgba(236, 72, 153, 0.12)",
        color: "#EC4899",
      };
    case "software license":
      return {
        icon: "key-outline" as const,
        bgDim: "rgba(139, 92, 246, 0.12)",
        color: "#8B5CF6",
      };
    default:
      return {
        icon: "shield-outline" as const,
        bgDim: "rgba(52, 211, 153, 0.12)",
        color: colors.accentMint,
      };
  }
};

// ────────────────────────────────────────────
// Main Screen
// ────────────────────────────────────────────

export default function VaultBrowserScreen() {
  useActiveConnection();
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const templateModalStyles = useMemo(
    () => createTemplateModalStyles(colors),
    [colors]
  );
  const { saveVault } = useFilePicker();

  const rootGroup = useVaultStore((state) => state.rootGroup);
  const activeGroupUuid = useVaultStore((state) => state.activeGroupUuid);
  const meta = useVaultStore((state) => state.meta);
  const breadcrumbs = useVaultStore((state) => state.breadcrumbs);
  const entryIndex = useVaultStore((state) => state.entryIndex);
  const groupIndex = useVaultStore((state) => state.groupIndex);
  const isDirty = useVaultStore((state) => state.isDirty);
  const db = useVaultStore((state) => state._db);
  const markClean = useVaultStore((state) => state.markClean);
  const closeDatabase = useVaultStore((state) => state.closeDatabase);
  const autoSave = useVaultStore((state) => state.autoSave);
  const isSaving = useVaultStore((state) => state.isSaving);
  const setIsSaving = useVaultStore((state) => state.setIsSaving);

  const navigateToGroup = useVaultStore((state) => state.navigateToGroup);
  const navigateBack = useVaultStore((state) => state.navigateBack);
  const navigateToRoot = useVaultStore((state) => state.navigateToRoot);
  const createGroup = useVaultStore((state) => state.createGroup);
  const deleteGroup = useVaultStore((state) => state.deleteGroup);
  const renameGroup = useVaultStore((state) => state.renameGroup);
  const isGroupInRecycleBin = useVaultStore(
    (state) => state.isGroupInRecycleBin
  );
  const [showPeerDrawer, setShowPeerDrawer] = useState(false);

  const activeGroup = useVaultStore((state) => {
    if (!state.activeGroupUuid || !state.groupIndex) return null;
    return state.groupIndex.get(state.activeGroupUuid) ?? null;
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const [showRenameInput, setShowRenameInput] = useState(false);
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameGroupName, setRenameGroupName] = useState("");
  const [saving, setSaving] = useState(false);

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

  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const templateEntries = useMemo(() => {
    if (!meta?.entryTemplatesGroup) return [];
    const group = groupIndex.get(meta.entryTemplatesGroup);
    return group?.entries ?? [];
  }, [meta, groupIndex]);

  const isAtRoot = breadcrumbs.length === 0;

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchEntries(searchQuery, entryIndex);
  }, [searchQuery, entryIndex]);

  const isSearching = searchQuery.trim().length > 0;

  // Build breadcrumb labels
  const breadcrumbLabels = useMemo(() => {
    const labels: { uuid: string; name: string }[] = [];
    for (const uuid of breadcrumbs) {
      const group = groupIndex.get(uuid);
      labels.push({ uuid, name: group?.name ?? "..." });
    }
    if (activeGroup) {
      labels.push({ uuid: activeGroup.uuid, name: activeGroup.name });
    }
    return labels;
  }, [breadcrumbs, activeGroup, groupIndex]);

  // ────── Handlers ──────

  const handleGroupPress = useCallback(
    (group: VaultGroup) => {
      navigateToGroup(group.uuid);
    },
    [navigateToGroup]
  );

  const handleEntryPress = useCallback(
    (entry: VaultEntry) => {
      router.push({
        pathname: "/entry/[id]" as const as any,
        params: { id: entry.uuid },
      } as any);
    },
    [router]
  );

  const handleCreateGroup = useCallback(() => {
    if (!newGroupName.trim() || !activeGroupUuid) return;
    createGroup(activeGroupUuid, newGroupName.trim());
    setNewGroupName("");
    setShowNewGroupInput(false);
  }, [newGroupName, activeGroupUuid, createGroup]);

  const handleCreateEntry = useCallback(() => {
    if (!activeGroupUuid) return;
    if (meta?.entryTemplatesEnabled) {
      setShowTemplateModal(true);
    } else {
      router.push({
        pathname: "/entry/edit" as const as any,
        params: { groupId: activeGroupUuid },
      } as any);
    }
  }, [activeGroupUuid, router, meta]);

  const canModifyCurrentGroup = useMemo(() => {
    return (
      activeGroupUuid &&
      activeGroupUuid !== rootGroup?.uuid &&
      activeGroupUuid !== db?.meta.recycleBinUuid?.id
    );
  }, [activeGroupUuid, rootGroup?.uuid, db?.meta.recycleBinUuid?.id]);

  const handleRenameGroup = useCallback(() => {
    if (!renameGroupName.trim() || !renameGroupId) return;
    renameGroup(renameGroupId, renameGroupName.trim());
    setRenameGroupName("");
    setRenameGroupId(null);
    setShowRenameInput(false);
  }, [renameGroupName, renameGroupId, renameGroup]);

  const handleGroupOptions = useCallback(
    (group: VaultGroup) => {
      if (
        group.uuid === rootGroup?.uuid ||
        group.uuid === db?.meta.recycleBinUuid?.id
      ) {
        return;
      }

      const inBin = isGroupInRecycleBin(group.uuid);
      const deleteText = inBin ? "Delete Permanently" : "Delete Group";

      const options = [
        {
          label: "Rename",
          onPress: () => {
            hideModal();
            setRenameGroupId(group.uuid);
            setRenameGroupName(group.name);
            setShowRenameInput(true);
          },
        },
        {
          label: deleteText,
          style: "destructive",
          onPress: () => {
            setModalConfig({
              visible: true,
              title: inBin ? "Permanently Delete" : "Delete Group",
              description: inBin
                ? `Are you sure you want to permanently delete "${group.name}"? This action cannot be undone.`
                : `Are you sure you want to delete "${group.name}"? This will move it to the recycle bin.`,
              icon: "trash-outline",
              iconColor: colors.statusError,
              buttons: [
                { text: "Cancel", onPress: hideModal, variant: "secondary" },
                {
                  text: inBin ? "Delete Permanently" : "Delete",
                  variant: "destructive",
                  onPress: () => {
                    hideModal();
                    deleteGroup(group.uuid);
                  },
                },
              ],
            });
          },
        },
      ];

      setModalConfig({
        visible: true,
        title: `Group: ${group.name}`,
        description: "Choose an action",
        icon: "folder-open-outline",
        options,
      });
    },
    [
      rootGroup,
      db,
      deleteGroup,
      isGroupInRecycleBin,
      colors.statusError,
      hideModal,
    ]
  );

  const handleCurrentGroupOptions = useCallback(() => {
    if (!activeGroup) return;
    const inBin = isGroupInRecycleBin(activeGroup.uuid);
    const deleteText = inBin ? "Delete Permanently" : "Delete Group";

    const options = [
      {
        label: "Rename",
        onPress: () => {
          hideModal();
          setRenameGroupId(activeGroup.uuid);
          setRenameGroupName(activeGroup.name);
          setShowRenameInput(true);
        },
      },
      {
        label: deleteText,
        style: "destructive",
        onPress: () => {
          setModalConfig({
            visible: true,
            title: inBin ? "Permanently Delete" : "Delete Group",
            description: inBin
              ? `Are you sure you want to permanently delete "${activeGroup.name}"? This action cannot be undone.`
              : `Are you sure you want to delete "${activeGroup.name}"? This will move it to the recycle bin.`,
            icon: "trash-outline",
            iconColor: colors.statusError,
            buttons: [
              { text: "Cancel", onPress: hideModal, variant: "secondary" },
              {
                text: inBin ? "Delete Permanently" : "Delete",
                variant: "destructive",
                onPress: () => {
                  hideModal();
                  deleteGroup(activeGroup.uuid);
                },
              },
            ],
          });
        },
      },
    ];

    setModalConfig({
      visible: true,
      title: `Group: ${activeGroup.name}`,
      description: "Choose an action",
      icon: "folder-open-outline",
      options,
    });
  }, [
    activeGroup,
    deleteGroup,
    isGroupInRecycleBin,
    colors.statusError,
    hideModal,
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
    }, 50);
  }, [
    db,
    saveVault,
    markClean,
    saving,
    showNotificationModal,
    showErrorModal,
    setIsSaving,
  ]);

  const handleLock = useCallback(() => {
    Keyboard.dismiss();
    const performLock = () => {
      closeDatabase();
      router.replace("/");
    };

    const waitAndLock = () => {
      const engine = syncEngine;

      let attempts = 0;
      const maxAttempts = 30; // 3 seconds timeout

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
        }, 50);
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

  // ────── Render Helpers ──────

  type ListItem =
    | { type: "group"; data: VaultGroup }
    | { type: "entry"; data: VaultEntry }
    | { type: "search-result"; data: VaultEntry; score: number };

  const listData: ListItem[] = useMemo(() => {
    if (isSearching) {
      return searchResults.map((r) => ({
        type: "search-result" as const,
        data: r.entry,
        score: r.score,
      }));
    }

    if (!activeGroup) return [];

    const items: ListItem[] = [];
    for (const g of activeGroup.groups) {
      items.push({ type: "group", data: g });
    }
    for (const e of activeGroup.entries) {
      items.push({ type: "entry", data: e });
    }
    return items;
  }, [isSearching, searchResults, activeGroup]);

  const renderItem = useCallback(
    ({ item, index }: { item: ListItem; index: number }) => {
      if (item.type === "group") {
        return (
          <Animated.View entering={FadeInDown.delay(index * 30).duration(200)}>
            <GroupRow
              group={item.data as VaultGroup}
              onPress={() => handleGroupPress(item.data as VaultGroup)}
              onLongPress={() => handleGroupOptions(item.data as VaultGroup)}
            />
          </Animated.View>
        );
      }

      if (item.type === "search-result") {
        return (
          <EntryRow
            entry={item.data as VaultEntry}
            onPress={() => handleEntryPress(item.data as VaultEntry)}
          />
        );
      }

      return (
        <Animated.View entering={FadeInDown.delay(index * 30).duration(200)}>
          <EntryRow
            entry={item.data as VaultEntry}
            onPress={() => handleEntryPress(item.data as VaultEntry)}
          />
        </Animated.View>
      );
    },
    [handleGroupPress, handleEntryPress, handleGroupOptions]
  );

  const keyExtractor = useCallback((item: ListItem) => {
    if (item.type === "group") return `group-${(item.data as VaultGroup).uuid}`;
    return `entry-${(item.data as VaultEntry).uuid}`;
  }, []);

  if (!rootGroup || !activeGroup) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.textDisabled}
          />
          <Text style={styles.emptyText}>No vault loaded</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {!isAtRoot && (
            <Pressable
              onPress={navigateBack}
              style={styles.backButton}
              accessibilityLabel="Go back"
              hitSlop={8}
            >
              <Ionicons
                name="chevron-back"
                size={24}
                color={colors.accentMint}
              />
            </Pressable>
          )}
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {activeGroup.name}
            </Text>
            {isDirty && !autoSave && (
              <View style={styles.dirtyBadge}>
                <Text style={styles.dirtyBadgeText}>Unsaved</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.headerRight}>
          {!autoSave && (isDirty || isSaving) && (
            <Animated.View
              entering={FadeIn.duration(300)}
              exiting={FadeOut.duration(200)}
            >
              <Pressable
                onPress={handleSave}
                disabled={saving || isSaving}
                style={[
                  styles.iconButton,
                  (saving || isSaving) && {
                    opacity: 0.6,
                  },
                ]}
                hitSlop={8}
                accessibilityLabel="Save changes"
              >
                {saving || isSaving ? (
                  <ActivityIndicator size="small" color={colors.accentMint} />
                ) : (
                  <Ionicons
                    name="save-outline"
                    size={22}
                    color={colors.accentMint}
                  />
                )}
              </Pressable>
            </Animated.View>
          )}
          <SyncStatusButton onPress={() => setShowPeerDrawer(true)} />
          <Pressable
            onPress={handleLock}
            style={styles.iconButton}
            hitSlop={8}
            accessibilityLabel="Lock database"
          >
            <Ionicons
              name="lock-closed-outline"
              size={22}
              color={colors.textPrimary}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              setShowSearch(!showSearch);
              if (showSearch) setSearchQuery("");
            }}
            style={styles.iconButton}
            hitSlop={8}
            accessibilityLabel="Toggle search"
          >
            <Ionicons
              name={showSearch ? "close" : "search"}
              size={22}
              color={colors.textPrimary}
            />
          </Pressable>
          {canModifyCurrentGroup && (
            <Pressable
              onPress={handleCurrentGroupOptions}
              style={styles.iconButton}
              hitSlop={8}
              accessibilityLabel="Group options"
            >
              <Ionicons
                name="ellipsis-vertical"
                size={22}
                color={colors.textPrimary}
              />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Remote sync update / conflict prompt ── */}
      <RemoteUpdateBanner />

      {/* ── Breadcrumbs ── */}
      {breadcrumbLabels.length > 1 && !isSearching && (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={styles.breadcrumbBar}
        >
          <Pressable
            onPress={navigateToRoot}
            style={styles.breadcrumbItem}
            hitSlop={4}
          >
            <Ionicons name="home-outline" size={14} color={colors.textMuted} />
          </Pressable>
          {breadcrumbLabels.slice(0, -1).map((crumb, i) => (
            <React.Fragment key={`${crumb.uuid}-${i}`}>
              <Ionicons
                name="chevron-forward"
                size={12}
                color={colors.textDisabled}
              />
              <Pressable
                onPress={() => {
                  // Navigate back to this breadcrumb level
                  const targetIndex = breadcrumbs.indexOf(crumb.uuid);
                  if (targetIndex >= 0) {
                    // Navigate back to this breadcrumb level
                    for (
                      let j = breadcrumbs.length - 1;
                      j >= targetIndex;
                      j--
                    ) {
                      navigateBack();
                    }
                  }
                }}
                style={styles.breadcrumbItem}
                hitSlop={4}
              >
                <Text style={styles.breadcrumbText} numberOfLines={1}>
                  {crumb.name}
                </Text>
              </Pressable>
            </React.Fragment>
          ))}
          <Ionicons
            name="chevron-forward"
            size={12}
            color={colors.textDisabled}
          />
          <Text style={styles.breadcrumbActive} numberOfLines={1}>
            {breadcrumbLabels[breadcrumbLabels.length - 1]?.name}
          </Text>
        </Animated.View>
      )}

      {/* ── Search Bar ── */}
      {showSearch && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          exiting={FadeOut.duration(150)}
          style={styles.searchContainer}
        >
          <Ionicons
            name="search"
            size={18}
            color={colors.textMuted}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search entries..."
            placeholderTextColor={colors.textDisabled}
            autoFocus
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable
              onPress={() => setSearchQuery("")}
              hitSlop={8}
              style={styles.clearButton}
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textMuted}
              />
            </Pressable>
          )}
        </Animated.View>
      )}

      {/* ── Search Results Count ── */}
      {isSearching && (
        <View style={styles.searchMeta}>
          <Text style={styles.searchMetaText}>
            {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}{" "}
            found
          </Text>
        </View>
      )}

      {/* ── List ── */}
      <FlatList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons
              name={isSearching ? "search-outline" : "folder-open-outline"}
              size={40}
              color={colors.textDisabled}
            />
            <Text style={styles.emptyText}>
              {isSearching ? "No matching entries" : "This group is empty"}
            </Text>
            {!isSearching && (
              <Text style={styles.emptyHint}>
                Tap + to add an entry or group
              </Text>
            )}
          </View>
        }
      />

      {/* ── Rename Group Input (inline) ── */}
      {showRenameInput && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          exiting={FadeOut.duration(150)}
          style={styles.newGroupBar}
        >
          <TextInput
            style={styles.newGroupInput}
            value={renameGroupName}
            onChangeText={setRenameGroupName}
            placeholder="Rename group..."
            placeholderTextColor={colors.textDisabled}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleRenameGroup}
          />
          <Pressable
            onPress={handleRenameGroup}
            style={styles.newGroupConfirm}
            hitSlop={4}
          >
            <Ionicons name="checkmark" size={22} color={colors.accentMint} />
          </Pressable>
          <Pressable
            onPress={() => {
              setShowRenameInput(false);
              setRenameGroupId(null);
              setRenameGroupName("");
            }}
            style={styles.newGroupCancel}
            hitSlop={4}
          >
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </Animated.View>
      )}

      {/* ── New Group Input (inline) ── */}
      {showNewGroupInput && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          exiting={FadeOut.duration(150)}
          style={styles.newGroupBar}
        >
          <TextInput
            style={styles.newGroupInput}
            value={newGroupName}
            onChangeText={setNewGroupName}
            placeholder="New group name..."
            placeholderTextColor={colors.textDisabled}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleCreateGroup}
          />
          <Pressable
            onPress={handleCreateGroup}
            style={styles.newGroupConfirm}
            hitSlop={4}
          >
            <Ionicons name="checkmark" size={22} color={colors.accentMint} />
          </Pressable>
          <Pressable
            onPress={() => {
              setShowNewGroupInput(false);
              setNewGroupName("");
            }}
            style={styles.newGroupCancel}
            hitSlop={4}
          >
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </Animated.View>
      )}

      {/* ── FAB (Add) ── */}
      {!isSearching && (
        <View style={styles.fabContainer}>
          <Pressable
            onPress={() => {
              const options = [
                {
                  label: "New Entry",
                  onPress: () => {
                    hideModal();
                    handleCreateEntry();
                  },
                },
                {
                  label: "New Group",
                  onPress: () => {
                    hideModal();
                    setShowNewGroupInput(true);
                  },
                },
              ];
              setModalConfig({
                visible: true,
                title: "Add to Vault",
                description: "What would you like to create?",
                icon: "add-circle-outline",
                options,
              });
            }}
            style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
            accessibilityLabel="Add entry or group"
          >
            <Ionicons name="add" size={28} color={colors.backgroundPrimary} />
          </Pressable>
        </View>
      )}
      {/* Template Selector Modal */}
      <Modal
        visible={showTemplateModal}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setShowTemplateModal(false)}
      >
        <View style={templateModalStyles.overlay}>
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: colors.overlay },
            ]}
          />
          <Pressable
            style={templateModalStyles.overlayPress}
            onPress={() => setShowTemplateModal(false)}
          />
          <Animated.View
            entering={FadeIn.duration(200).springify()}
            exiting={FadeOut.duration(150)}
            style={templateModalStyles.modalContainer}
          >
            <View style={templateModalStyles.header}>
              <View style={templateModalStyles.headerIcon}>
                <Ionicons
                  name="copy-outline"
                  size={20}
                  color={colors.accentMint}
                />
              </View>
              <Text style={templateModalStyles.headerTitle}>
                Select Template
              </Text>
              <Pressable
                onPress={() => setShowTemplateModal(false)}
                hitSlop={12}
                style={templateModalStyles.closeBtn}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={templateModalStyles.gridContainer}
              showsVerticalScrollIndicator={false}
            >
              {/* Blank Entry */}
              <Pressable
                style={templateModalStyles.card}
                onPress={() => {
                  setShowTemplateModal(false);
                  router.push({
                    pathname: "/entry/edit" as const as any,
                    params: { groupId: activeGroupUuid },
                  } as any);
                }}
              >
                <View
                  style={[
                    templateModalStyles.cardIconContainer,
                    { backgroundColor: "rgba(148, 163, 184, 0.12)" },
                  ]}
                >
                  <Ionicons
                    name="add-outline"
                    size={24}
                    color={colors.textMuted}
                  />
                </View>
                <Text style={templateModalStyles.cardTitle}>Blank Entry</Text>
                <Text
                  style={templateModalStyles.cardSubtitle}
                  numberOfLines={2}
                >
                  Create an entry with default fields
                </Text>
              </Pressable>

              {/* Dynamic Templates */}
              {templateEntries.map((entry) => {
                const styleInfo = getTemplateCardStyle(entry.title, colors);
                const customKeys = Object.keys(entry.fields).filter(
                  (k) =>
                    !["Title", "UserName", "Password", "URL", "Notes"].includes(
                      k
                    )
                );
                const parts = [];
                if (entry.username || entry.fields["UserName"] !== undefined)
                  parts.push("Username");
                if (entry.password || entry.fields["Password"] !== undefined)
                  parts.push("Password");
                parts.push(...customKeys);
                if (entry.notes) parts.push("Notes");
                const fieldsText = parts.join(", ") || "Standard Fields";

                return (
                  <Pressable
                    key={entry.uuid}
                    style={templateModalStyles.card}
                    onPress={() => {
                      setShowTemplateModal(false);
                      router.push({
                        pathname: "/entry/edit" as const as any,
                        params: {
                          groupId: activeGroupUuid,
                          templateEntryId: entry.uuid,
                        },
                      } as any);
                    }}
                  >
                    <View
                      style={[
                        templateModalStyles.cardIconContainer,
                        { backgroundColor: styleInfo.bgDim },
                      ]}
                    >
                      <Ionicons
                        name={styleInfo.icon}
                        size={24}
                        color={styleInfo.color}
                      />
                    </View>
                    <Text style={templateModalStyles.cardTitle}>
                      {entry.title}
                    </Text>
                    <Text
                      style={templateModalStyles.cardSubtitle}
                      numberOfLines={2}
                    >
                      {fieldsText}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

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

      <PeerListDrawer
        visible={showPeerDrawer}
        onClose={() => setShowPeerDrawer(false)}
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

    // Header
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSage,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
      gap: Spacing.xs,
    },
    backButton: {
      minWidth: TouchTarget.min,
      minHeight: TouchTarget.min,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitleContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      flex: 1,
    },
    headerTitle: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.subheading,
      color: colors.textPrimary,
      flexShrink: 1,
    },
    dirtyBadge: {
      backgroundColor: colors.statusWarningDim,
      borderRadius: Radii.sm,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
    },
    dirtyBadgeText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.micro,
      color: colors.statusWarning,
    },
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
    },
    iconButton: {
      minWidth: TouchTarget.min,
      minHeight: TouchTarget.min,
      alignItems: "center",
      justifyContent: "center",
    },
    syncCapsule: {
      height: 32,
      borderRadius: Radii.lg,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: Spacing.sm,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderSage,
      gap: 6,
    },
    syncCapsuleActive: {
      backgroundColor: colors.accentMintDim,
      borderColor: colors.accentMint,
    },
    syncCapsuleWarning: {
      backgroundColor: colors.statusWarningDim,
      borderColor: colors.statusWarning,
    },
    syncCapsuleError: {
      backgroundColor: colors.statusErrorDim,
      borderColor: colors.statusError,
    },
    syncCapsuleText: {
      fontFamily: Fonts.mono.regular,
      fontSize: FontSizes.caption,
      fontWeight: "bold",
      color: colors.textMuted,
    },
    syncCapsuleTextActive: {
      color: colors.accentMint,
    },
    syncCapsuleTextWarning: {
      color: colors.statusWarning,
    },
    syncCapsuleTextError: {
      color: colors.statusError,
    },

    // Breadcrumbs
    breadcrumbBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      gap: 4,
      backgroundColor: colors.surfaceCard,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSage,
    },
    breadcrumbItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 2,
      paddingHorizontal: 4,
    },
    breadcrumbText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      maxWidth: 80,
    },
    breadcrumbActive: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.accentMint,
      maxWidth: 120,
    },

    // Search
    searchContainer: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: Spacing.lg,
      marginVertical: Spacing.sm,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderSage,
      borderRadius: Radii.md,
      paddingHorizontal: Spacing.md,
      minHeight: TouchTarget.min,
    },
    searchIcon: {
      marginRight: Spacing.sm,
    },
    searchInput: {
      flex: 1,
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.body,
      color: colors.textPrimary,
      paddingVertical: Spacing.sm,
    },
    clearButton: {
      padding: Spacing.xs,
    },
    searchMeta: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.xs,
    },
    searchMetaText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
    },

    // List
    listContent: {
      paddingBottom: 100,
    },

    // Group Row
    groupRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      minHeight: 56,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSage,
    },
    rowPressed: {
      backgroundColor: colors.surfaceElevated,
    },
    rowIconContainer: {
      width: 36,
      height: 36,
      borderRadius: Radii.sm,
      backgroundColor: colors.accentMintDim,
      alignItems: "center",
      justifyContent: "center",
      marginRight: Spacing.md,
    },
    rowContent: {
      flex: 1,
      justifyContent: "center",
    },
    groupName: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.body,
      color: colors.textPrimary,
    },
    groupMeta: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      marginTop: 2,
    },

    // Entry Row
    entryRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      minHeight: 56,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSage,
    },
    entryTitle: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.body,
      color: colors.textPrimary,
    },
    entryUsername: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      marginTop: 2,
    },

    // Empty State
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingTop: Spacing.huge,
      gap: Spacing.md,
    },
    emptyText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.body,
      color: colors.textMuted,
    },
    emptyHint: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textDisabled,
    },

    // New Group Input
    newGroupBar: {
      position: "absolute",
      bottom: 96,
      left: Spacing.lg,
      right: Spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.borderSageActive,
      borderRadius: Radii.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      ...Shadows.elevated,
    },
    newGroupInput: {
      flex: 1,
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.body,
      color: colors.textPrimary,
      paddingVertical: Spacing.xs,
    },
    newGroupConfirm: {
      padding: Spacing.sm,
      minWidth: TouchTarget.min,
      minHeight: TouchTarget.min,
      alignItems: "center",
      justifyContent: "center",
    },
    newGroupCancel: {
      padding: Spacing.sm,
      minWidth: TouchTarget.min,
      minHeight: TouchTarget.min,
      alignItems: "center",
      justifyContent: "center",
    },

    // FAB
    fabContainer: {
      position: "absolute",
      bottom: Spacing.xxl,
      right: Spacing.xl,
    },
    fab: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accentMint,
      alignItems: "center",
      justifyContent: "center",
      ...Shadows.glow,
    },
    fabPressed: {
      backgroundColor: "#2BC48A",
      transform: [{ scale: 0.95 }],
    },
  });
}

function createTemplateModalStyles(colors: any) {
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
      width: "92%",
      maxWidth: 440,
      maxHeight: "80%",
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
      marginBottom: Spacing.lg,
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
    gridContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      gap: Spacing.md,
      paddingBottom: Spacing.md,
    },
    card: {
      width: "47%",
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: colors.borderSage,
      padding: Spacing.md,
      marginBottom: Spacing.xs,
      alignItems: "flex-start",
    },
    cardIconContainer: {
      width: 44,
      height: 44,
      borderRadius: Radii.md,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: Spacing.md,
    },
    cardTitle: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
      marginBottom: Spacing.xxs,
    },
    cardSubtitle: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      lineHeight: 16,
    },
  });
}
