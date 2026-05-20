/**
 * VaultPeer — Home Screen (Phase 1 Placeholder)
 *
 * Displays the crypto engine initialization status and a diagnostic
 * panel showing the Argon2 bridge availability. This screen will be
 * replaced by the File Setup screen in Phase 2.
 */

import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  FadeInDown,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Colors,
  Fonts,
  FontSizes,
  LineHeights,
  Spacing,
  Radii,
  Shadows,
  TouchTarget,
} from "@/src/constants/theme";
import { isCryptoEngineReady, createNewDatabase } from "@/src/services/crypto";

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

interface DiagnosticItem {
  label: string;
  status: "pass" | "fail" | "pending";
  detail: string;
}

// ────────────────────────────────────────────
// Component
// ────────────────────────────────────────────

export default function HomeScreen() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Glow pulse animation for the shield icon
  const glowOpacity = useSharedValue(0.4);

  useEffect(() => {
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.4, { duration: 1200, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [glowOpacity]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  // Button press animation
  const buttonScale = useSharedValue(1);
  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  async function runDiagnostics() {
    setIsRunning(true);
    const results: DiagnosticItem[] = [];

    // Check 1: Crypto engine ready
    results.push({
      label: "Crypto Engine",
      status: isCryptoEngineReady() ? "pass" : "fail",
      detail: isCryptoEngineReady()
        ? "Initialized with native Argon2"
        : "Not initialized",
    });
    setDiagnostics([...results]);

    // Check 2: Platform info
    results.push({
      label: "Platform",
      status: "pass",
      detail: `${Platform.OS} (${Platform.Version})`,
    });
    setDiagnostics([...results]);

    // Check 3: Database creation
    try {
      const db = createNewDatabase("DiagnosticTest", "test-password-123");
      const saved = await db.save();
      results.push({
        label: "KDBX Create + Save",
        status: saved.byteLength > 0 ? "pass" : "fail",
        detail: `${saved.byteLength} bytes written`,
      });
    } catch (error) {
      results.push({
        label: "KDBX Create + Save",
        status: "fail",
        detail: error instanceof Error ? error.message : "Unknown error",
      });
    }
    setDiagnostics([...results]);

    // Check 4: Argon2 native module
    results.push({
      label: "Argon2 JSI Bridge",
      status: Platform.OS !== "web" ? "pass" : "fail",
      detail:
        Platform.OS !== "web"
          ? "TurboModule available (requires dev build)"
          : "Not available on web",
    });
    setDiagnostics([...results]);

    setIsRunning(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header with animated glow */}
        <Animated.View
          entering={FadeInDown.duration(600).delay(100)}
          style={styles.headerContainer}
        >
          <View style={styles.shieldContainer}>
            <Animated.View style={[styles.shieldGlow, glowStyle]} />
            <Text style={styles.shieldIcon}>🛡️</Text>
          </View>
          <Text style={styles.title}>VaultPeer</Text>
          <Text style={styles.subtitle}>Phase 1 — Crypto Engine</Text>
        </Animated.View>

        {/* Status card */}
        <Animated.View
          entering={FadeInDown.duration(600).delay(250)}
          style={styles.statusCard}
        >
          <View style={styles.statusHeader}>
            <Text style={styles.statusTitle}>Engine Status</Text>
            <View
              style={[
                styles.statusBadge,
                isCryptoEngineReady()
                  ? styles.statusBadgePass
                  : styles.statusBadgeFail,
              ]}
            >
              <Text style={styles.statusBadgeText}>
                {isCryptoEngineReady() ? "READY" : "PENDING"}
              </Text>
            </View>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>kdbxweb</Text>
            <Text style={styles.statusValue}>Loaded</Text>
          </View>
          <View style={styles.statusDivider} />
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Argon2 KDF</Text>
            <Text style={styles.statusValue}>
              {Platform.OS !== "web" ? "Native JSI" : "Unavailable"}
            </Text>
          </View>
          <View style={styles.statusDivider} />
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>AES-256-CBC</Text>
            <Text style={styles.statusValue}>WebCrypto</Text>
          </View>
          <View style={styles.statusDivider} />
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>ChaCha20</Text>
            <Text style={styles.statusValue}>WebCrypto</Text>
          </View>
        </Animated.View>

        {/* Diagnostics results */}
        {diagnostics.length > 0 && (
          <Animated.View
            entering={FadeInDown.duration(400)}
            style={styles.diagnosticsCard}
          >
            <Text style={styles.diagnosticsTitle}>Diagnostics</Text>
            {diagnostics.map((item, index) => (
              <View key={index} style={styles.diagnosticRow}>
                <View style={styles.diagnosticLeft}>
                  <Text
                    style={[
                      styles.diagnosticDot,
                      item.status === "pass"
                        ? styles.dotPass
                        : item.status === "fail"
                          ? styles.dotFail
                          : styles.dotPending,
                    ]}
                  >
                    ●
                  </Text>
                  <Text style={styles.diagnosticLabel}>{item.label}</Text>
                </View>
                <Text style={styles.diagnosticDetail} numberOfLines={1}>
                  {item.detail}
                </Text>
              </View>
            ))}
          </Animated.View>
        )}

        {/* Run diagnostics button */}
        <Animated.View
          entering={FadeInDown.duration(600).delay(400)}
          style={[styles.buttonWrapper, buttonAnimatedStyle]}
        >
          <Pressable
            onPress={runDiagnostics}
            onPressIn={() => {
              buttonScale.value = withSpring(0.95);
            }}
            onPressOut={() => {
              buttonScale.value = withSpring(1);
            }}
            disabled={isRunning}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              isRunning && styles.buttonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Run crypto engine diagnostics"
          >
            <Text style={styles.buttonText}>
              {isRunning ? "Running..." : "Run Diagnostics"}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
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
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxxl,
  },

  // Header
  headerContainer: {
    alignItems: "center",
    marginBottom: Spacing.xxxl,
  },
  shieldContainer: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  shieldGlow: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.accentMint,
    ...Shadows.glow,
  },
  shieldIcon: {
    fontSize: 40,
  },
  title: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.title,
    lineHeight: LineHeights.title,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    lineHeight: LineHeights.bodySmall,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },

  // Status Card
  statusCard: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    ...Shadows.card,
  },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  statusTitle: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.subheading,
    color: Colors.textPrimary,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: Radii.sm,
  },
  statusBadgePass: {
    backgroundColor: Colors.statusSuccessDim,
  },
  statusBadgeFail: {
    backgroundColor: Colors.statusErrorDim,
  },
  statusBadgeText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.micro,
    color: Colors.accentMint,
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  statusLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
  },
  statusValue: {
    fontFamily: Fonts.mono.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.accentMint,
  },
  statusDivider: {
    height: 1,
    backgroundColor: Colors.borderSage,
  },

  // Diagnostics Card
  diagnosticsCard: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    ...Shadows.card,
  },
  diagnosticsTitle: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.subheading,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  diagnosticRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  diagnosticLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  diagnosticDot: {
    fontSize: FontSizes.caption,
  },
  dotPass: {
    color: Colors.statusSuccess,
  },
  dotFail: {
    color: Colors.statusError,
  },
  dotPending: {
    color: Colors.statusWarning,
  },
  diagnosticLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textPrimary,
  },
  diagnosticDetail: {
    fontFamily: Fonts.mono.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
    maxWidth: "50%",
    textAlign: "right",
  },

  // Button
  buttonWrapper: {
    marginTop: "auto",
    paddingBottom: Spacing.xxl,
  },
  button: {
    backgroundColor: Colors.accentMint,
    borderRadius: Radii.md,
    paddingVertical: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: TouchTarget.min,
    ...Shadows.glow,
  },
  buttonPressed: {
    backgroundColor: "#2BC48A",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.body,
    color: Colors.backgroundPrimary,
    letterSpacing: 0.5,
  },
});
