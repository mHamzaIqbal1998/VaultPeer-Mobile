/**
 * Group Picker Modal
 *
 * A full-screen bottom sheet modal that lets users select the folder/group
 * where an entry will be created or moved. The vault's group tree is flattened
 * into an indented, selectable list and the currently selected location is
 * shown as a filesystem-style path (e.g. "/", "/Work", "/Work/Email").
 */

import { GROUP_DEFAULT_ICON } from "@/src/constants/kdbxIcons";
import {
  FontSizes,
  Fonts,
  Radii,
  Spacing,
  useThemeColors,
} from "@/src/constants/theme";
import { buildGroupPath } from "@/src/services/groupPath";
import type { VaultGroup } from "@/src/types/kdbx";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// ────────────────────────────────────────────
// Component
// ────────────────────────────────────────────

interface FlatGroup {
  uuid: string;
  name: string;
  depth: number;
  path: string;
}

interface GroupPickerModalProps {
  visible: boolean;
  rootGroup: VaultGroup | null;
  groupIndex: Map<string, VaultGroup>;
  selectedGroupId: string | null;
  /** UUID of the recycle bin group to exclude from the picker (optional) */
  recycleBinUuid?: string;
  onSelect: (groupUuid: string) => void;
  onClose: () => void;
}

function flattenGroups(
  root: VaultGroup | null,
  excludeUuid?: string
): FlatGroup[] {
  if (!root) return [];
  const list: FlatGroup[] = [];

  function walk(group: VaultGroup, depth: number, parentPath: string) {
    if (excludeUuid && group.uuid === excludeUuid) return;

    const isRoot = group.parentGroupUuid === null;
    const path = isRoot
      ? "/"
      : parentPath === "/"
        ? `/${group.name}`
        : `${parentPath}/${group.name}`;

    list.push({
      uuid: group.uuid,
      name: isRoot ? "/" : group.name,
      depth,
      path,
    });

    for (const sub of group.groups) {
      walk(sub, depth + 1, path);
    }
  }

  walk(root, 0, "");
  return list;
}

function GroupRow({
  item,
  isSelected,
  onPress,
}: {
  item: FlatGroup;
  isSelected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isRoot = item.depth === 0;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.groupRow,
        { paddingLeft: Spacing.md + item.depth * Spacing.lg },
        isSelected && styles.groupRowSelected,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Select folder ${item.path}`}
      accessibilityState={{ selected: isSelected }}
    >
      <Ionicons
        name={isRoot ? "home-outline" : GROUP_DEFAULT_ICON}
        size={20}
        color={isSelected ? colors.accentMint : colors.textSecondary}
      />
      <Text
        style={[
          styles.groupRowLabel,
          isSelected && styles.groupRowLabelSelected,
        ]}
        numberOfLines={1}
      >
        {isRoot ? "Root (/)" : item.name}
      </Text>
      {isSelected && (
        <Ionicons name="checkmark-circle" size={20} color={colors.accentMint} />
      )}
    </Pressable>
  );
}

export function GroupPickerModal({
  visible,
  rootGroup,
  groupIndex,
  selectedGroupId,
  recycleBinUuid,
  onSelect,
  onClose,
}: GroupPickerModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [localSelected, setLocalSelected] = useState<string | null>(
    selectedGroupId
  );
  const [active, setActive] = useState(false);
  const translateY = useSharedValue(600);
  const backdropOpacity = useSharedValue(0);

  const flatGroups = useMemo(
    () => flattenGroups(rootGroup, recycleBinUuid),
    [rootGroup, recycleBinUuid]
  );

  const selectedPath = useMemo(
    () => buildGroupPath(localSelected, groupIndex),
    [localSelected, groupIndex]
  );

  React.useEffect(() => {
    if (visible) {
      setLocalSelected(selectedGroupId);
      setActive(true);
      translateY.value = 600;
      backdropOpacity.value = 0;
      translateY.value = withTiming(0, {
        duration: 350,
        easing: Easing.out(Easing.cubic),
      });
      backdropOpacity.value = withTiming(1, { duration: 250 });
    } else {
      setActive(false);
    }
    // Only react to `visible` toggling. Depending on `selectedGroupId` here
    // would re-run the open animation when a selection is confirmed (which
    // updates the parent prop), cancelling the close animation and causing
    // the sheet to reopen on first use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleSelect = (uuid: string) => {
    setLocalSelected(uuid);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleClose = () => {
    backdropOpacity.value = withTiming(0, { duration: 200 });
    translateY.value = withTiming(
      600,
      { duration: 300, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(onClose)();
        }
      }
    );
  };

  const handleConfirm = () => {
    if (localSelected) {
      onSelect(localSelected);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    handleClose();
  };

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const animatedBackdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  return (
    <Modal
      visible={active}
      animationType="none"
      transparent
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.modalContainer}>
        {/* Backdrop */}
        <Animated.View style={[styles.backdrop, animatedBackdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        </Animated.View>

        {/* Bottom Sheet */}
        <Animated.View style={[styles.sheet, animatedSheetStyle]}>
          <View style={styles.sheetBottomFill} />

          {/* Handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.sheetHeader}>
            <Pressable
              onPress={onClose}
              style={styles.sheetCloseBtn}
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
            <Text style={styles.sheetTitle}>Choose Location</Text>
            <Pressable
              onPress={handleConfirm}
              style={styles.sheetConfirmBtn}
              hitSlop={8}
            >
              <Text style={styles.sheetConfirmText}>Done</Text>
            </Pressable>
          </View>

          {/* Preview of selected path */}
          <View style={styles.previewRow}>
            <View style={styles.previewCircle}>
              <Ionicons
                name="folder-open-outline"
                size={24}
                color={colors.accentMint}
              />
            </View>
            <View style={styles.previewInfo}>
              <Text style={styles.previewLabel}>Selected Location</Text>
              <Text style={styles.previewName} numberOfLines={1}>
                {selectedPath}
              </Text>
            </View>
          </View>

          {/* Scrollable group tree */}
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {flatGroups.map((item) => (
              <GroupRow
                key={item.uuid}
                item={item}
                isSelected={localSelected === item.uuid}
                onPress={() => handleSelect(item.uuid)}
              />
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────

const createStyles = (colors: any) =>
  StyleSheet.create({
    modalContainer: {
      flex: 1,
      justifyContent: "flex-end",
      alignItems: "stretch",
      backgroundColor: "transparent",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
    },
    sheet: {
      width: "100%",
      maxHeight: "85%",
      backgroundColor: colors.surfaceCard,
      borderTopLeftRadius: Radii.xl,
      borderTopRightRadius: Radii.xl,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
      elevation: 16,
      paddingBottom: Spacing.xxl,
    },
    sheetBottomFill: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: -200,
      height: 200,
      backgroundColor: colors.surfaceCard,
    },
    handleContainer: {
      alignItems: "center",
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xs,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderSageActive,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSage,
    },
    sheetCloseBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    sheetTitle: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.subheading,
      color: colors.textPrimary,
    },
    sheetConfirmBtn: {
      backgroundColor: colors.accentMint,
      borderRadius: Radii.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
    },
    sheetConfirmText: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.bodySmall,
      color: colors.backgroundPrimary,
    },

    // Preview
    previewRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSage,
    },
    previewCircle: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.accentMintDim,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.accentMint,
    },
    previewInfo: {
      marginLeft: Spacing.lg,
      flex: 1,
    },
    previewLabel: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    previewName: {
      fontFamily: Fonts.mono.regular,
      fontSize: FontSizes.body,
      color: colors.textPrimary,
      marginTop: 2,
    },

    // Scroll
    scrollContent: {
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.huge,
    },

    // Group Row
    groupRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.md,
      paddingVertical: Spacing.md,
      paddingRight: Spacing.md,
      borderRadius: Radii.md,
      marginBottom: 2,
    },
    groupRowSelected: {
      backgroundColor: colors.accentMintDim,
    },
    groupRowLabel: {
      flex: 1,
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.body,
      color: colors.textPrimary,
    },
    groupRowLabelSelected: {
      color: colors.accentMint,
      fontFamily: Fonts.heading.medium,
    },
  });
