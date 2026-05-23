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
  Alert,
} from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Colors,
  Fonts,
  FontSizes,
  Spacing,
  Radii,
  Shadows,
  TouchTarget,
} from "@/src/constants/theme";
import { useVaultStore } from "@/src/stores/useVaultStore";
import { useFilePicker } from "@/src/context/FilePickerContext";
import { searchEntries } from "@/src/services/searchService";
import { getKdbxIconName, GROUP_DEFAULT_ICON } from "@/src/constants/kdbxIcons";
import type { VaultEntry, VaultGroup } from "@/src/types/kdbx";

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
          color={Colors.accentMint}
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
      <Ionicons name="chevron-forward" size={18} color={Colors.textDisabled} />
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
  const iconName = getKdbxIconName(entry.iconId);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.entryRow, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`View entry ${entry.title}`}
    >
      <View style={styles.rowIconContainer}>
        <Ionicons name={iconName} size={20} color={Colors.textMuted} />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.entryTitle} numberOfLines={1}>
          {entry.title || "Untitled"}
        </Text>
        <Text style={styles.entryUsername} numberOfLines={1}>
          {entry.username || "No username"}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.textDisabled} />
    </Pressable>
  );
}

// ────────────────────────────────────────────
// Main Screen
// ────────────────────────────────────────────

export default function VaultBrowserScreen() {
  const router = useRouter();
  const { saveVault } = useFilePicker();

  const rootGroup = useVaultStore((state) => state.rootGroup);
  const activeGroupUuid = useVaultStore((state) => state.activeGroupUuid);
  const breadcrumbs = useVaultStore((state) => state.breadcrumbs);
  const entryIndex = useVaultStore((state) => state.entryIndex);
  const groupIndex = useVaultStore((state) => state.groupIndex);
  const isDirty = useVaultStore((state) => state.isDirty);
  const db = useVaultStore((state) => state._db);
  const markClean = useVaultStore((state) => state.markClean);

  const navigateToGroup = useVaultStore((state) => state.navigateToGroup);
  const navigateBack = useVaultStore((state) => state.navigateBack);
  const navigateToRoot = useVaultStore((state) => state.navigateToRoot);
  const createGroup = useVaultStore((state) => state.createGroup);
  const deleteGroup = useVaultStore((state) => state.deleteGroup);
  const renameGroup = useVaultStore((state) => state.renameGroup);
  const isGroupInRecycleBin = useVaultStore(
    (state) => state.isGroupInRecycleBin
  );

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
    router.push({
      pathname: "/entry/edit" as const as any,
      params: { groupId: activeGroupUuid },
    } as any);
  }, [activeGroupUuid, router]);

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

      Alert.alert(`Group: ${group.name}`, "Choose an action", [
        {
          text: "Rename",
          onPress: () => {
            setRenameGroupId(group.uuid);
            setRenameGroupName(group.name);
            setShowRenameInput(true);
          },
        },
        {
          text: deleteText,
          style: "destructive",
          onPress: () => {
            Alert.alert(
              inBin ? "Permanently Delete" : "Delete Group",
              inBin
                ? `Are you sure you want to permanently delete "${group.name}"? This action cannot be undone.`
                : `Are you sure you want to delete "${group.name}"? This will move it to the recycle bin.`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: inBin ? "Delete Permanently" : "Delete",
                  style: "destructive",
                  onPress: () => {
                    deleteGroup(group.uuid);
                  },
                },
              ]
            );
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [rootGroup, db, deleteGroup, isGroupInRecycleBin]
  );

  const handleCurrentGroupOptions = useCallback(() => {
    if (!activeGroup) return;
    const inBin = isGroupInRecycleBin(activeGroup.uuid);
    const deleteText = inBin ? "Delete Permanently" : "Delete Group";

    Alert.alert(`Group: ${activeGroup.name}`, "Choose an action", [
      {
        text: "Rename",
        onPress: () => {
          setRenameGroupId(activeGroup.uuid);
          setRenameGroupName(activeGroup.name);
          setShowRenameInput(true);
        },
      },
      {
        text: deleteText,
        style: "destructive",
        onPress: () => {
          Alert.alert(
            inBin ? "Permanently Delete" : "Delete Group",
            inBin
              ? `Are you sure you want to permanently delete "${activeGroup.name}"? This action cannot be undone.`
              : `Are you sure you want to delete "${activeGroup.name}"? This will move it to the recycle bin.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: inBin ? "Delete Permanently" : "Delete",
                style: "destructive",
                onPress: () => {
                  deleteGroup(activeGroup.uuid);
                },
              },
            ]
          );
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [activeGroup, deleteGroup, isGroupInRecycleBin]);

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
            color={Colors.textDisabled}
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
                color={Colors.accentMint}
              />
            </Pressable>
          )}
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {activeGroup.name}
            </Text>
            {isDirty && (
              <View style={styles.dirtyBadge}>
                <Text style={styles.dirtyBadgeText}>Unsaved</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.headerRight}>
          {isDirty && (
            <Animated.View
              entering={FadeIn.duration(300)}
              exiting={FadeOut.duration(200)}
            >
              <Pressable
                onPress={handleSave}
                style={styles.iconButton}
                hitSlop={8}
                accessibilityLabel="Save changes"
              >
                <Ionicons
                  name="save-outline"
                  size={22}
                  color={Colors.accentMint}
                />
              </Pressable>
            </Animated.View>
          )}
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
              color={Colors.textPrimary}
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
                color={Colors.textPrimary}
              />
            </Pressable>
          )}
        </View>
      </View>

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
            <Ionicons name="home-outline" size={14} color={Colors.textMuted} />
          </Pressable>
          {breadcrumbLabels.slice(0, -1).map((crumb, i) => (
            <React.Fragment key={`${crumb.uuid}-${i}`}>
              <Ionicons
                name="chevron-forward"
                size={12}
                color={Colors.textDisabled}
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
            color={Colors.textDisabled}
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
            color={Colors.textMuted}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search entries..."
            placeholderTextColor={Colors.textDisabled}
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
                color={Colors.textMuted}
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
              color={Colors.textDisabled}
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
            placeholderTextColor={Colors.textDisabled}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleRenameGroup}
          />
          <Pressable
            onPress={handleRenameGroup}
            style={styles.newGroupConfirm}
            hitSlop={4}
          >
            <Ionicons name="checkmark" size={22} color={Colors.accentMint} />
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
            <Ionicons name="close" size={22} color={Colors.textMuted} />
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
            placeholderTextColor={Colors.textDisabled}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleCreateGroup}
          />
          <Pressable
            onPress={handleCreateGroup}
            style={styles.newGroupConfirm}
            hitSlop={4}
          >
            <Ionicons name="checkmark" size={22} color={Colors.accentMint} />
          </Pressable>
          <Pressable
            onPress={() => {
              setShowNewGroupInput(false);
              setNewGroupName("");
            }}
            style={styles.newGroupCancel}
            hitSlop={4}
          >
            <Ionicons name="close" size={22} color={Colors.textMuted} />
          </Pressable>
        </Animated.View>
      )}

      {/* ── FAB (Add) ── */}
      {!isSearching && (
        <View style={styles.fabContainer}>
          <Pressable
            onPress={() => {
              Alert.alert("Add to Vault", "What would you like to create?", [
                {
                  text: "New Entry",
                  onPress: handleCreateEntry,
                },
                {
                  text: "New Group",
                  onPress: () => setShowNewGroupInput(true),
                },
                { text: "Cancel", style: "cancel" },
              ]);
            }}
            style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
            accessibilityLabel="Add entry or group"
          >
            <Ionicons name="add" size={28} color={Colors.backgroundPrimary} />
          </Pressable>
        </View>
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

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSage,
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
    fontSize: FontSizes.heading,
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  dirtyBadge: {
    backgroundColor: Colors.statusWarningDim,
    borderRadius: Radii.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  dirtyBadgeText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.micro,
    color: Colors.statusWarning,
  },
  headerRight: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  iconButton: {
    minWidth: TouchTarget.min,
    minHeight: TouchTarget.min,
    alignItems: "center",
    justifyContent: "center",
  },

  // Breadcrumbs
  breadcrumbBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: 4,
    backgroundColor: Colors.surfaceCard,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSage,
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
    color: Colors.textMuted,
    maxWidth: 80,
  },
  breadcrumbActive: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.caption,
    color: Colors.accentMint,
    maxWidth: 120,
  },

  // Search
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSage,
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
    color: Colors.textPrimary,
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
    color: Colors.textMuted,
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
    borderBottomColor: Colors.borderSage,
  },
  rowPressed: {
    backgroundColor: Colors.surfaceElevated,
  },
  rowIconContainer: {
    width: 36,
    height: 36,
    borderRadius: Radii.sm,
    backgroundColor: Colors.accentMintDim,
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
    color: Colors.textPrimary,
  },
  groupMeta: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
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
    borderBottomColor: Colors.borderSage,
  },
  entryTitle: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
  },
  entryUsername: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
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
    color: Colors.textMuted,
  },
  emptyHint: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textDisabled,
  },

  // New Group Input
  newGroupBar: {
    position: "absolute",
    bottom: 96,
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.borderSageActive,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Shadows.elevated,
  },
  newGroupInput: {
    flex: 1,
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
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
    backgroundColor: Colors.accentMint,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.glow,
  },
  fabPressed: {
    backgroundColor: "#2BC48A",
    transform: [{ scale: 0.95 }],
  },
});
