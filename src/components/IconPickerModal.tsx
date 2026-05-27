/**
 * Icon Picker Modal
 *
 * A full-screen bottom sheet modal that lets users select from the
 * 69 standard KeePass icons (IDs 0–68). Icons are organized into
 * semantic categories for easier discovery.
 *
 * Fully compatible with KeePassDX — these are the same standard
 * icon IDs defined by the KDBX specification.
 */

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  useThemeColors,
  Fonts,
  FontSizes,
  Spacing,
  Radii,
} from "@/src/constants/theme";
import { getKdbxIconName } from "@/src/constants/kdbxIcons";

// ────────────────────────────────────────────
// Category Definitions
// ────────────────────────────────────────────

interface IconCategory {
  title: string;
  iconIds: number[];
}

/**
 * Semantic grouping of KeePass standard icon IDs.
 * This makes the 69 icons discoverable without scrolling
 * through a flat list.
 */
const ICON_CATEGORIES: IconCategory[] = [
  {
    title: "Keys & Security",
    iconIds: [0, 13, 34, 35, 56, 36, 29],
  },
  {
    title: "Web & Network",
    iconIds: [1, 8, 12, 18, 64, 66, 67],
  },
  {
    title: "Communication",
    iconIds: [5, 15, 21, 58, 59],
  },
  {
    title: "People & Identity",
    iconIds: [9, 41, 53],
  },
  {
    title: "Documents & Files",
    iconIds: [10, 23, 24, 31, 32, 33, 39, 45, 48],
  },
  {
    title: "Devices & Hardware",
    iconIds: [3, 20, 26, 30, 61, 17],
  },
  {
    title: "Development",
    iconIds: [25, 42, 65, 68],
  },
  {
    title: "Media & Visuals",
    iconIds: [11, 38, 19],
  },
  {
    title: "Finance & Commerce",
    iconIds: [52, 57, 62, 63],
  },
  {
    title: "Tools & Settings",
    iconIds: [6, 16, 22, 27, 40, 37],
  },
  {
    title: "Status & Indicators",
    iconIds: [2, 14, 28, 43, 44, 46, 47, 49, 50, 51, 54, 55, 60],
  },
  {
    title: "Notes & Tags",
    iconIds: [4, 7],
  },
];

// ────────────────────────────────────────────
// Component
// ────────────────────────────────────────────

interface IconPickerModalProps {
  visible: boolean;
  selectedIconId: number;
  onSelect: (iconId: number) => void;
  onClose: () => void;
}

/** Human-readable label for a KeePass icon ID */
const ICON_LABELS: Record<number, string> = {
  0: "Key",
  1: "World",
  2: "Warning",
  3: "Server",
  4: "Pin",
  5: "Chat",
  6: "Wrench",
  7: "Tag",
  8: "Globe",
  9: "Person",
  10: "Document",
  11: "Camera",
  12: "WiFi",
  13: "Keys",
  14: "Energy",
  15: "Email",
  16: "Settings",
  17: "Scanner",
  18: "Browser",
  19: "Disc",
  20: "Monitor",
  21: "Mail Open",
  22: "Gear",
  23: "Clipboard",
  24: "Paper",
  25: "Terminal",
  26: "Printer",
  27: "Grid",
  28: "Flag",
  29: "Check",
  30: "Chip",
  31: "Folder",
  32: "Folder Open",
  33: "File Cabinet",
  34: "Lock",
  35: "Unlock",
  36: "Checkmark",
  37: "Pen",
  38: "Image",
  39: "Book",
  40: "List",
  41: "User",
  42: "Code",
  43: "Clock",
  44: "Search",
  45: "Attachment",
  46: "Cube",
  47: "Trash",
  48: "Note",
  49: "Cancel",
  50: "Help",
  51: "Package",
  52: "Wallet",
  53: "Login",
  54: "Star",
  55: "Heart",
  56: "Shield",
  57: "Card",
  58: "Phone",
  59: "Home",
  60: "Star Alt",
  61: "Laptop",
  62: "Money",
  63: "Certificate",
  64: "At",
  65: "GitHub",
  66: "Compass",
  67: "Cloud",
  68: "Barcode",
};

function IconCell({
  iconId,
  isSelected,
  onPress,
}: {
  iconId: number;
  isSelected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const iconName = getKdbxIconName(iconId);
  const label = ICON_LABELS[iconId] ?? `Icon ${iconId}`;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.iconCell, isSelected && styles.iconCellSelected]}
      accessibilityLabel={`${label} icon`}
      accessibilityState={{ selected: isSelected }}
    >
      <Ionicons
        name={iconName}
        size={22}
        color={isSelected ? colors.accentMint : colors.textSecondary}
      />
      <Text
        style={[
          styles.iconCellLabel,
          isSelected && styles.iconCellLabelSelected,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {isSelected && (
        <View style={styles.selectedBadge}>
          <Ionicons
            name="checkmark"
            size={10}
            color={colors.backgroundPrimary}
          />
        </View>
      )}
    </Pressable>
  );
}

export function IconPickerModal({
  visible,
  selectedIconId,
  onSelect,
  onClose,
}: IconPickerModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [localSelected, setLocalSelected] = useState(selectedIconId);
  const [active, setActive] = useState(false);
  const translateY = useSharedValue(600);
  const backdropOpacity = useSharedValue(0);

  // Sync local selection and trigger enter animation when modal opens
  React.useEffect(() => {
    if (visible) {
      setLocalSelected(selectedIconId);
      setActive(true);
      translateY.value = 600;
      backdropOpacity.value = 0;
      translateY.value = withTiming(0, {
        duration: 350,
        easing: Easing.out(Easing.cubic),
      });
      backdropOpacity.value = withTiming(1, {
        duration: 250,
      });
    } else {
      setActive(false);
    }
  }, [visible, selectedIconId, translateY, backdropOpacity]);

  const handleSelect = (iconId: number) => {
    setLocalSelected(iconId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleClose = () => {
    backdropOpacity.value = withTiming(0, { duration: 200 });
    translateY.value = withTiming(
      600,
      {
        duration: 300,
        easing: Easing.in(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          runOnJS(onClose)();
        }
      }
    );
  };

  const handleConfirm = () => {
    onSelect(localSelected);
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
          {/* Extends surfaceCard color below the sheet to cover any gap during slide-in */}
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
            <Text style={styles.sheetTitle}>Choose Icon</Text>
            <Pressable
              onPress={handleConfirm}
              style={styles.sheetConfirmBtn}
              hitSlop={8}
            >
              <Text style={styles.sheetConfirmText}>Done</Text>
            </Pressable>
          </View>

          {/* Preview of selected icon */}
          <View style={styles.previewRow}>
            <View style={styles.previewCircle}>
              <Ionicons
                name={getKdbxIconName(localSelected)}
                size={28}
                color={colors.accentMint}
              />
            </View>
            <View style={styles.previewInfo}>
              <Text style={styles.previewLabel}>Selected</Text>
              <Text style={styles.previewName}>
                {ICON_LABELS[localSelected] ?? `Icon ${localSelected}`}
              </Text>
            </View>
          </View>

          {/* Scrollable icon grid */}
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {ICON_CATEGORIES.map((category) => (
              <View key={category.title} style={styles.categorySection}>
                <Text style={styles.categoryTitle}>{category.title}</Text>
                <View style={styles.iconGrid}>
                  {category.iconIds.map((iconId) => (
                    <IconCell
                      key={iconId}
                      iconId={iconId}
                      isSelected={localSelected === iconId}
                      onPress={() => handleSelect(iconId)}
                    />
                  ))}
                </View>
              </View>
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
      paddingBottom: Spacing.xxl, // Stable safe bottom spacing, avoids Android modal layout shifts
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
    },
    previewLabel: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    previewName: {
      fontFamily: Fonts.heading.semiBold,
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

    // Categories
    categorySection: {
      marginBottom: Spacing.xl,
    },
    categoryTitle: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: Spacing.md,
    },
    iconGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.sm,
    },

    // Icon Cell
    iconCell: {
      width: 72,
      height: 72,
      borderRadius: Radii.md,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderSage,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      position: "relative",
    },
    iconCellSelected: {
      borderColor: colors.accentMint,
      borderWidth: 1.5,
      backgroundColor: colors.accentMintDim,
    },
    iconCellLabel: {
      fontFamily: Fonts.body.regular,
      fontSize: 9,
      color: colors.textMuted,
      textAlign: "center",
      maxWidth: 60,
    },
    iconCellLabelSelected: {
      color: colors.accentMint,
      fontFamily: Fonts.heading.medium,
    },

    // Selected badge
    selectedBadge: {
      position: "absolute",
      top: -4,
      right: -4,
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: colors.accentMint,
      alignItems: "center",
      justifyContent: "center",
    },
  });
