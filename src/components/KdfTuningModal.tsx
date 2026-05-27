/**
 * KDF Tuning Modal
 *
 * Premium modal for configuring KDF parameters with
 * sliders/inputs and a "Benchmark for 1.0s" button.
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors,
  Fonts,
  FontSizes,
  Spacing,
  Radii,
  Shadows,
  TouchTarget,
} from "@/src/constants/theme";
import { CyberCard } from "./CyberCard";
import type {
  KdfType,
  KdfTuningParams,
} from "@/src/services/crypto/kdfBenchmark";
import {
  runKdfBenchmark,
  validateKdfParams,
  formatMemory,
} from "@/src/services/crypto/kdfBenchmark";

interface KdfTuningModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (params: KdfTuningParams) => void;
  kdfType: KdfType;
  cipherName: string;
  initialParams: KdfTuningParams;
}

const MEMORY_PRESETS = [
  { label: "8 MiB", value: 8192 },
  { label: "16 MiB", value: 16384 },
  { label: "32 MiB", value: 32768 },
  { label: "64 MiB", value: 65536 },
  { label: "128 MiB", value: 131072 },
  { label: "256 MiB", value: 262144 },
];

export function KdfTuningModal({
  visible,
  onClose,
  onApply,
  kdfType,
  cipherName,
  initialParams,
}: KdfTuningModalProps) {
  const [params, setParams] = useState<KdfTuningParams>(initialParams);
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<string | null>(null);
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setParams(initialParams);
      setBenchmarkResult(null);
      overlayOpacity.value = withTiming(1, { duration: 200 });
    } else {
      overlayOpacity.value = withTiming(0, { duration: 150 });
    }
  }, [visible, initialParams, overlayOpacity]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const handleBenchmark = useCallback(async () => {
    setBenchmarking(true);
    setBenchmarkResult(null);
    // Yield to the React Native render cycle to ensure the spinner/loading UI renders first
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      const result = await runKdfBenchmark(kdfType);
      setParams(result.recommended);
      setBenchmarkResult(
        `Completed in ${result.elapsedMs}ms — parameters calibrated for ~1.0s`
      );
    } catch (e: any) {
      Alert.alert("Benchmark Failed", e?.message || "Unknown error");
    } finally {
      setBenchmarking(false);
    }
  }, [kdfType]);

  const handleApply = useCallback(() => {
    const validation = validateKdfParams(kdfType, params);
    if (!validation.valid) {
      Alert.alert("Invalid Parameters", validation.errors.join("\n"));
      return;
    }
    onApply(params);
    onClose();
  }, [params, kdfType, onApply, onClose]);

  const updateParam = (key: keyof KdfTuningParams, value: string) => {
    const num = parseInt(value.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(num)) {
      setParams((p) => ({ ...p, [key]: num }));
    } else if (value === "") {
      setParams((p) => ({ ...p, [key]: 0 }));
    }
  };

  const isArgon2 = kdfType !== "AES-KDF";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.overlay, overlayStyle]}>
        <Pressable style={styles.overlayPress} onPress={onClose} />
        <Animated.View
          entering={FadeIn.duration(200).springify()}
          exiting={FadeOut.duration(150)}
          style={styles.modalContainer}
        >
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <Ionicons
                  name="shield-checkmark"
                  size={24}
                  color={Colors.accentMint}
                />
              </View>
              <Text style={styles.headerTitle}>Security & KDF Tuning</Text>
              <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>

            {/* Current Algorithm Info */}
            <CyberCard style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Cipher</Text>
                <View style={styles.infoBadge}>
                  <Text style={styles.infoBadgeText}>{cipherName}</Text>
                </View>
              </View>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>KDF</Text>
                <View style={[styles.infoBadge, styles.infoBadgeKdf]}>
                  <Text style={styles.infoBadgeText}>{kdfType}</Text>
                </View>
              </View>
            </CyberCard>

            {/* Parameter Controls */}
            <Text style={styles.sectionTitle}>Parameters</Text>

            {isArgon2 ? (
              <>
                {/* Memory */}
                <View style={styles.paramGroup}>
                  <Text style={styles.paramLabel}>Memory</Text>
                  <Text style={styles.paramValue}>
                    {formatMemory(params.memory ?? 65536)}
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.presetRow}
                >
                  {MEMORY_PRESETS.map((preset) => (
                    <Pressable
                      key={preset.value}
                      onPress={() =>
                        setParams((p) => ({ ...p, memory: preset.value }))
                      }
                      style={[
                        styles.presetPill,
                        params.memory === preset.value &&
                          styles.presetPillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.presetPillText,
                          params.memory === preset.value &&
                            styles.presetPillTextActive,
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Iterations */}
                <View style={styles.paramGroup}>
                  <Text style={styles.paramLabel}>Iterations</Text>
                  <TextInput
                    style={styles.paramInput}
                    keyboardType="number-pad"
                    value={String(params.iterations ?? 2)}
                    onChangeText={(v) => updateParam("iterations", v)}
                    placeholderTextColor={Colors.textDisabled}
                    maxLength={3}
                  />
                </View>

                {/* Parallelism */}
                <View style={styles.paramGroup}>
                  <Text style={styles.paramLabel}>Parallelism</Text>
                  <TextInput
                    style={styles.paramInput}
                    keyboardType="number-pad"
                    value={String(params.parallelism ?? 2)}
                    onChangeText={(v) => updateParam("parallelism", v)}
                    placeholderTextColor={Colors.textDisabled}
                    maxLength={2}
                  />
                </View>
              </>
            ) : (
              /* AES-KDF Rounds */
              <View style={styles.paramGroup}>
                <Text style={styles.paramLabel}>Rounds</Text>
                <TextInput
                  style={[styles.paramInput, { flex: 1 }]}
                  keyboardType="number-pad"
                  value={String(params.rounds ?? 60000)}
                  onChangeText={(v) => updateParam("rounds", v)}
                  placeholderTextColor={Colors.textDisabled}
                  maxLength={9}
                />
              </View>
            )}

            {/* Benchmark Button */}
            <Pressable
              onPress={handleBenchmark}
              disabled={benchmarking}
              style={({ pressed }) => [
                styles.benchmarkBtn,
                pressed && styles.benchmarkBtnPressed,
                benchmarking && { opacity: 0.7 },
              ]}
            >
              {benchmarking ? (
                <ActivityIndicator
                  size="small"
                  color={Colors.backgroundPrimary}
                />
              ) : (
                <>
                  <Ionicons
                    name="speedometer-outline"
                    size={18}
                    color={Colors.backgroundPrimary}
                  />
                  <Text style={styles.benchmarkBtnText}>
                    Benchmark for 1.0s
                  </Text>
                </>
              )}
            </Pressable>

            {benchmarkResult && (
              <View style={styles.benchmarkResult}>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={Colors.statusSuccess}
                />
                <Text style={styles.benchmarkResultText}>
                  {benchmarkResult}
                </Text>
              </View>
            )}

            {/* Info Notice */}
            <View style={styles.noticeCard}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={Colors.textMuted}
              />
              <Text style={styles.noticeText}>
                Higher parameters increase security but slow down unlock time.
                Use the benchmark to find optimal settings for your device.
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.actionRow}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.cancelBtn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleApply}
                style={({ pressed }) => [
                  styles.applyBtn,
                  pressed && styles.applyBtnPressed,
                ]}
              >
                <Ionicons
                  name="checkmark"
                  size={18}
                  color={Colors.backgroundPrimary}
                />
                <Text style={styles.applyBtnText}>Apply</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },
  overlayPress: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContainer: {
    width: "90%",
    maxWidth: 420,
    maxHeight: "85%",
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    ...Shadows.elevated,
  },
  scrollContent: {
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: Radii.md,
    backgroundColor: Colors.accentMintDim,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.subheading,
    color: Colors.textPrimary,
  },
  closeBtn: {
    width: TouchTarget.min,
    height: TouchTarget.min,
    justifyContent: "center",
    alignItems: "center",
  },
  infoCard: {
    padding: Spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  infoLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
  },
  infoBadge: {
    backgroundColor: "rgba(52, 211, 153, 0.12)",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: Radii.sm,
  },
  infoBadgeKdf: {
    backgroundColor: "rgba(99, 102, 241, 0.12)",
  },
  infoBadgeText: {
    fontFamily: Fonts.mono.regular,
    fontSize: FontSizes.caption,
    color: Colors.textPrimary,
  },
  infoDivider: {
    height: 1,
    backgroundColor: Colors.borderSage,
    marginVertical: Spacing.xxs,
  },
  sectionTitle: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.textPrimary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: Spacing.xs,
  },
  paramGroup: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.xs,
  },
  paramLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
    flex: 1,
  },
  paramValue: {
    fontFamily: Fonts.mono.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.accentMint,
  },
  paramInput: {
    width: 90,
    height: 38,
    backgroundColor: Colors.backgroundPrimary,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    borderRadius: Radii.sm,
    color: Colors.textPrimary,
    fontFamily: Fonts.mono.regular,
    fontSize: FontSizes.bodySmall,
    textAlign: "center",
    paddingHorizontal: Spacing.sm,
  },
  presetRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  presetPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    backgroundColor: Colors.surfaceElevated,
  },
  presetPillActive: {
    borderColor: Colors.accentMint,
    backgroundColor: Colors.accentMintDim,
  },
  presetPillText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
  },
  presetPillTextActive: {
    color: Colors.accentMint,
  },
  benchmarkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.accentMint,
    borderRadius: Radii.md,
    height: TouchTarget.min,
    marginTop: Spacing.xs,
    ...Shadows.glow,
  },
  benchmarkBtnPressed: {
    backgroundColor: "#2BC48A",
    transform: [{ scale: 0.98 }],
  },
  benchmarkBtnText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.bodySmall,
    color: Colors.backgroundPrimary,
  },
  benchmarkResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  benchmarkResultText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.statusSuccess,
    flex: 1,
  },
  noticeCard: {
    flexDirection: "row",
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radii.sm,
    padding: Spacing.md,
    alignItems: "flex-start",
  },
  noticeText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
    flex: 1,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    height: TouchTarget.min,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderSage,
  },
  cancelBtnText: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
  },
  applyBtn: {
    flex: 1,
    flexDirection: "row",
    gap: Spacing.xs,
    height: TouchTarget.min,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: Radii.md,
    backgroundColor: Colors.accentMint,
  },
  applyBtnPressed: {
    backgroundColor: "#2BC48A",
    transform: [{ scale: 0.98 }],
  },
  applyBtnText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.bodySmall,
    color: Colors.backgroundPrimary,
  },
});
