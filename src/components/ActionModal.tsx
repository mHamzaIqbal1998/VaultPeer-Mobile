import {
  FontSizes,
  Fonts,
  Radii,
  Shadows,
  Spacing,
  TouchTarget,
  useThemeColors,
} from "@/src/constants/theme";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Dimensions,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

export interface ActionModalOption {
  label: string;
  value: any;
  isSelected?: boolean;
  onPress: () => void;
}

export interface ActionModalButton {
  text: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "destructive";
  disabled?: boolean;
}

interface ActionModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  options?: ActionModalOption[];
  buttons?: ActionModalButton[];
  hideOverlay?: boolean;
}

export function ActionModal({
  visible,
  onClose,
  title,
  description,
  icon,
  iconColor,
  options,
  buttons,
  hideOverlay = false,
}: ActionModalProps) {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: hideOverlay ? "transparent" : colors.overlay },
          ]}
        />
        <Pressable style={styles.overlayPress} onPress={onClose} />
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={styles.modalContainer}
        >
          {/* Header */}
          <View style={styles.header}>
            {icon && (
              <View style={styles.headerIcon}>
                <Ionicons
                  name={icon}
                  size={20}
                  color={iconColor || colors.accentMint}
                />
              </View>
            )}
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          {/* Scrollable Content */}
          <ScrollView
            style={styles.scrollList}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {description && (
              <Text style={styles.description}>{description}</Text>
            )}

            {/* List Selection Options */}
            {options && options.length > 0 && (
              <View style={styles.optionsContainer}>
                {options.map((option, idx) => (
                  <Pressable
                    key={idx}
                    onPress={() => {
                      option.onPress();
                    }}
                    style={({ pressed }) => [
                      styles.optionRow,
                      option.isSelected && styles.optionRowSelected,
                      pressed && styles.optionRowPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionLabel,
                        option.isSelected && styles.optionLabelSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                    {option.isSelected && (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={colors.accentMint}
                      />
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>

          {/* Action Buttons */}
          {buttons && buttons.length > 0 && (
            <View
              style={[
                styles.buttonsContainer,
                buttons.length > 2 && styles.buttonsContainerVertical,
              ]}
            >
              {buttons.map((btn, idx) => {
                const isDestructive = btn.variant === "destructive";
                const isSecondary = btn.variant === "secondary";
                const isPrimary = !isDestructive && !isSecondary;

                return (
                  <Pressable
                    key={idx}
                    onPress={btn.onPress}
                    disabled={btn.disabled}
                    style={({ pressed }) => [
                      styles.btn,
                      buttons.length > 2 && styles.btnVertical,
                      isPrimary && styles.btnPrimary,
                      isSecondary && styles.btnSecondary,
                      isDestructive && styles.btnDestructive,
                      pressed && isPrimary && styles.btnPrimaryPressed,
                      pressed && isSecondary && styles.btnSecondaryPressed,
                      pressed && isDestructive && styles.btnDestructivePressed,
                      btn.disabled && styles.btnDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.btnText,
                        isPrimary && styles.btnTextPrimary,
                        isSecondary && styles.btnTextSecondary,
                        isDestructive && styles.btnTextDestructive,
                      ]}
                    >
                      {btn.text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function createStyles(colors: any) {
  return StyleSheet.create({
    overlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      height: Dimensions.get("screen").height,
      justifyContent: "center",
      alignItems: "center",
    },
    overlayPress: {
      ...StyleSheet.absoluteFillObject,
    },
    modalContainer: {
      width: "90%",
      maxWidth: 380,
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
      paddingBottom: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSage,
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
      marginTop: Spacing.md,
    },
    scrollContent: {
      paddingBottom: Spacing.sm,
    },
    description: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: Spacing.md,
    },
    optionsContainer: {
      gap: Spacing.xs,
    },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
      borderRadius: Radii.md,
      backgroundColor: colors.transparent,
      borderWidth: 1,
      borderColor: colors.borderSage,
    },
    optionRowSelected: {
      backgroundColor: colors.accentMintDim,
      borderColor: colors.accentMint,
    },
    optionRowPressed: {
      opacity: 0.8,
      backgroundColor: colors.accentMintDim,
    },
    optionLabel: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
    },
    optionLabelSelected: {
      color: colors.accentMint,
      fontFamily: Fonts.heading.semiBold,
    },
    buttonsContainer: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: Spacing.sm,
      marginTop: Spacing.lg,
      paddingTop: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.borderSage,
    },
    buttonsContainerVertical: {
      flexDirection: "column",
      alignItems: "stretch",
    },
    btn: {
      flex: 1,
      height: TouchTarget.min,
      borderRadius: Radii.md,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: Spacing.md,
    },
    btnVertical: {
      flex: 0,
    },
    btnPrimary: {
      backgroundColor: colors.accentMint,
    },
    btnPrimaryPressed: {
      backgroundColor: "#2BC48A",
    },
    btnSecondary: {
      backgroundColor: colors.transparent,
      borderWidth: 1,
      borderColor: colors.borderSage,
    },
    btnSecondaryPressed: {
      backgroundColor: colors.surfaceElevated,
    },
    btnDestructive: {
      backgroundColor: colors.statusErrorDim,
      borderWidth: 1,
      borderColor: colors.statusError,
    },
    btnDestructivePressed: {
      backgroundColor: "rgba(239, 68, 68, 0.2)",
    },
    btnDisabled: {
      opacity: 0.5,
    },
    btnText: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.bodySmall,
    },
    btnTextPrimary: {
      color: colors.backgroundPrimary,
    },
    btnTextSecondary: {
      color: colors.textMuted,
    },
    btnTextDestructive: {
      color: colors.statusError,
    },
  });
}
