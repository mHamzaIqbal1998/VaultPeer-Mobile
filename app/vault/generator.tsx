import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useClipboard } from "@/src/hooks/useClipboard";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import {
  Colors,
  Fonts,
  FontSizes,
  Spacing,
  Radii,
  Shadows,
  TouchTarget,
} from "@/src/constants/theme";
import {
  generatePassword,
  estimatePasswordStrength,
} from "@/src/services/passwordGenerator";
import { CyberCard } from "@/src/components/CyberCard";

// ────────────────────────────────────────────
// Animated Strength Bar Sub-Component
// ────────────────────────────────────────────

function AnimatedStrengthBar({
  active,
  color,
}: {
  active: boolean;
  color: string;
}) {
  const scaleY = useSharedValue(active ? 1 : 0.4);
  const opacity = useSharedValue(active ? 1 : 0.25);

  useEffect(() => {
    scaleY.value = withTiming(active ? 1 : 0.4, { duration: 200 });
    opacity.value = withTiming(active ? 1 : 0.25, { duration: 200 });
  }, [active, opacity, scaleY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scaleY.value }],
    opacity: opacity.value,
    backgroundColor: active ? color : Colors.surfaceElevated,
  }));

  return <Animated.View style={[styles.strengthBar, animatedStyle]} />;
}

// ────────────────────────────────────────────
// Option Pill Sub-Component
// ────────────────────────────────────────────

function OptionPill({
  label,
  active,
  onPress,
  iconName,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  iconName: React.ComponentProps<typeof Ionicons>["name"];
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`Toggle ${label}`}
    >
      <Ionicons
        name={iconName}
        size={16}
        color={active ? Colors.backgroundPrimary : Colors.textMuted}
      />
      <Text style={[styles.pillText, active && styles.pillTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ────────────────────────────────────────────
// Main Screen Component
// ────────────────────────────────────────────

export default function PasswordGeneratorScreen() {
  const [length, setLength] = useState(16);
  const [useUppercase, setUseUppercase] = useState(true);
  const [useLowercase, setUseLowercase] = useState(true);
  const [useNumbers, setUseNumbers] = useState(true);
  const [useSymbols, setUseSymbols] = useState(true);
  const [excludeLookalikes, setExcludeLookalikes] = useState(false);
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const { copyToClipboard } = useClipboard();

  const handleGenerate = useCallback(() => {
    // Prevent generation if no character sets are selected
    if (!useUppercase && !useLowercase && !useNumbers && !useSymbols) {
      setPassword("");
      return;
    }
    const pwd = generatePassword({
      length,
      useUppercase,
      useLowercase,
      useNumbers,
      useSymbols,
      excludeLookalikes,
    });
    setPassword(pwd);
    setCopied(false);
  }, [
    length,
    useUppercase,
    useLowercase,
    useNumbers,
    useSymbols,
    excludeLookalikes,
  ]);

  // Generate on mount or when options change
  useEffect(() => {
    handleGenerate();
  }, [handleGenerate]);

  const strength = estimatePasswordStrength(password);

  const handleCopy = async () => {
    if (!password) return;
    const success = await copyToClipboard(password, true);
    if (success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Adjust length handler with limit checks
  const changeLength = (amount: number) => {
    setLength((prev) => {
      const next = prev + amount;
      if (next < 8) return 8;
      if (next > 64) return 64;
      return next;
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Password Generator</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Output Screen Card */}
        <CyberCard style={styles.outputCard}>
          <Text
            style={[
              styles.passwordText,
              password.length > 24 && styles.passwordTextSmall,
            ]}
            selectable
            numberOfLines={2}
          >
            {password || "Select options below"}
          </Text>

          <View style={styles.outputActions}>
            <Pressable
              onPress={handleGenerate}
              style={({ pressed }) => [
                styles.actionBtn,
                pressed && styles.actionBtnPressed,
              ]}
              hitSlop={8}
              accessibilityLabel="Regenerate password"
            >
              <Ionicons name="refresh" size={22} color={Colors.textPrimary} />
            </Pressable>

            <Pressable
              onPress={handleCopy}
              disabled={!password}
              style={({ pressed }) => [
                styles.copyBtn,
                pressed && styles.copyBtnPressed,
                !password && styles.copyBtnDisabled,
              ]}
              accessibilityLabel="Copy password to clipboard"
            >
              <Ionicons
                name={copied ? "checkmark-circle" : "copy-outline"}
                size={18}
                color={Colors.backgroundPrimary}
              />
              <Text style={styles.copyBtnText}>
                {copied ? "Copied" : "Copy"}
              </Text>
            </Pressable>
          </View>
        </CyberCard>

        {/* Strength Indicator */}
        <CyberCard style={styles.strengthCard}>
          <View style={styles.strengthHeader}>
            <Text style={styles.strengthLabel}>Security Strength</Text>
            <Text style={[styles.strengthValue, { color: strength.color }]}>
              {strength.label} ({Math.round(strength.entropy)} bits)
            </Text>
          </View>
          <View style={styles.strengthBarContainer}>
            {[0, 1, 2, 3].map((index) => {
              const active = strength.score >= index + 1;
              return (
                <AnimatedStrengthBar
                  key={index}
                  active={active}
                  color={strength.color}
                />
              );
            })}
          </View>
        </CyberCard>

        {/* Options Card */}
        <CyberCard style={styles.optionsCard}>
          <Text style={styles.sectionTitle}>Password Length</Text>
          <View style={styles.lengthPickerContainer}>
            <Pressable
              onPress={() => changeLength(-1)}
              style={({ pressed }) => [
                styles.lengthBtn,
                pressed && styles.lengthBtnPressed,
              ]}
              hitSlop={8}
              accessibilityLabel="Decrease length by 1"
            >
              <Ionicons name="remove" size={20} color={Colors.textPrimary} />
            </Pressable>

            <View style={styles.lengthDisplay}>
              <Text style={styles.lengthText}>{length}</Text>
              <Text style={styles.lengthSub}>characters</Text>
            </View>

            <Pressable
              onPress={() => changeLength(1)}
              style={({ pressed }) => [
                styles.lengthBtn,
                pressed && styles.lengthBtnPressed,
              ]}
              hitSlop={8}
              accessibilityLabel="Increase length by 1"
            >
              <Ionicons name="add" size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>

          {/* Quick Length Segments */}
          <View style={styles.quickLengthContainer}>
            {[12, 16, 24, 32].map((len) => (
              <Pressable
                key={len}
                onPress={() => setLength(len)}
                style={[
                  styles.quickLengthBtn,
                  length === len && styles.quickLengthBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.quickLengthText,
                    length === len && styles.quickLengthTextActive,
                  ]}
                >
                  {len}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.divider} />

          <Text style={styles.sectionTitle}>Character Options</Text>
          <View style={styles.pillsGrid}>
            <OptionPill
              label="Uppercase"
              active={useUppercase}
              onPress={() => setUseUppercase(!useUppercase)}
              iconName="text"
            />
            <OptionPill
              label="Lowercase"
              active={useLowercase}
              onPress={() => setUseLowercase(!useLowercase)}
              iconName="text-outline"
            />
            <OptionPill
              label="Numbers"
              active={useNumbers}
              onPress={() => setUseNumbers(!useNumbers)}
              iconName="phone-portrait-outline"
            />
            <OptionPill
              label="Symbols"
              active={useSymbols}
              onPress={() => setUseSymbols(!useSymbols)}
              iconName="star-outline"
            />
            <OptionPill
              label="Exclude Lookalikes"
              active={excludeLookalikes}
              onPress={() => setExcludeLookalikes(!excludeLookalikes)}
              iconName="eye-off-outline"
            />
          </View>
        </CyberCard>
      </ScrollView>
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
  header: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSage,
    alignItems: "center",
  },
  headerTitle: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.subheading,
    color: Colors.textPrimary,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.huge,
    gap: Spacing.lg,
  },

  // Output Card
  outputCard: {
    gap: Spacing.md,
    alignItems: "center",
  },
  passwordText: {
    fontFamily: Fonts.mono.regular,
    fontSize: 22,
    color: Colors.accentMint,
    textAlign: "center",
    letterSpacing: 0.5,
    marginVertical: Spacing.sm,
    lineHeight: 32,
  },
  passwordTextSmall: {
    fontSize: FontSizes.body,
    lineHeight: 22,
  },
  outputActions: {
    flexDirection: "row",
    gap: Spacing.md,
    width: "100%",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.xs,
  },
  actionBtn: {
    width: TouchTarget.min,
    height: TouchTarget.min,
    borderRadius: Radii.md,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    justifyContent: "center",
    alignItems: "center",
  },
  actionBtnPressed: {
    backgroundColor: Colors.borderSage,
    transform: [{ scale: 0.95 }],
  },
  copyBtn: {
    flex: 1,
    height: TouchTarget.min,
    borderRadius: Radii.md,
    backgroundColor: Colors.accentMint,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    ...Shadows.glow,
  },
  copyBtnDisabled: {
    opacity: 0.5,
  },
  copyBtnPressed: {
    backgroundColor: "#2BC48A",
    transform: [{ scale: 0.98 }],
  },
  copyBtnText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.bodySmall,
    color: Colors.backgroundPrimary,
  },

  // Strength Card
  strengthCard: {
    paddingVertical: Spacing.md,
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
    color: Colors.textMuted,
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
    backgroundColor: Colors.surfaceElevated,
  },

  // Options Card
  optionsCard: {
    gap: Spacing.md,
  },
  sectionTitle: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  lengthPickerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radii.md,
    padding: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.borderSage,
  },
  lengthBtn: {
    width: TouchTarget.min,
    height: TouchTarget.min,
    borderRadius: Radii.sm,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.surfaceCard,
  },
  lengthBtnPressed: {
    backgroundColor: Colors.surfaceElevated,
  },
  lengthDisplay: {
    alignItems: "center",
    justifyContent: "center",
  },
  lengthText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.heading,
    color: Colors.textPrimary,
  },
  lengthSub: {
    fontFamily: Fonts.body.regular,
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: -2,
  },
  quickLengthContainer: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  quickLengthBtn: {
    flex: 1,
    height: TouchTarget.min,
    borderRadius: Radii.sm,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    justifyContent: "center",
    alignItems: "center",
  },
  quickLengthBtnActive: {
    borderColor: Colors.accentMint,
    backgroundColor: Colors.accentMintDim,
  },
  quickLengthText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
  },
  quickLengthTextActive: {
    fontFamily: Fonts.heading.medium,
    color: Colors.accentMint,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderSage,
    marginVertical: Spacing.xs,
  },
  pillsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    minHeight: TouchTarget.min,
  },
  pillActive: {
    backgroundColor: Colors.accentMint,
    borderColor: Colors.accentMint,
  },
  pillText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
  },
  pillTextActive: {
    fontFamily: Fonts.heading.medium,
    color: Colors.backgroundPrimary,
  },
});
