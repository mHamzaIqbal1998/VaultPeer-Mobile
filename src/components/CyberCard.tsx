import React from "react";
import {
  View,
  StyleSheet,
  Pressable,
  ViewStyle,
  StyleProp,
} from "react-native";
import { Colors, Radii, Shadows } from "../constants/theme";

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

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: "rgba(35, 46, 42, 0.5)", // Thin glass border
    padding: 16,
    ...Shadows.card,
  },
  pressed: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: "rgba(52, 211, 153, 0.3)", // Glow tint on press
    transform: [{ scale: 0.99 }],
  },
});
