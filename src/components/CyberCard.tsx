import React, { useMemo } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  ViewStyle,
  StyleProp,
} from "react-native";
import { useThemeColors, Radii, Shadows } from "../constants/theme";

interface CyberCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "none";
}

export function CyberCard({
  children,
  style,
  onPress,
  accessibilityLabel,
  accessibilityRole,
}: CyberCardProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole ?? "button"}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[styles.card, style]}>{children}</View>;
}

function createStyles(colors: any) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceCard,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor:
        colors.theme === "light"
          ? "rgba(208, 219, 214, 0.6)"
          : "rgba(35, 46, 42, 0.5)", // Thin glass border adapted to theme
      padding: 16,
      ...Shadows.card,
    },
    pressed: {
      backgroundColor: colors.surfaceElevated,
      borderColor:
        colors.theme === "light"
          ? "rgba(5, 150, 105, 0.3)"
          : "rgba(52, 211, 153, 0.3)", // Glow tint on press
      transform: [{ scale: 0.99 }],
    },
  });
}
