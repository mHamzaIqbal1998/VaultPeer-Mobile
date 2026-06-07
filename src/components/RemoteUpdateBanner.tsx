/**
 * RemoteUpdateBanner — In-vault prompt shown when a newer copy arrives from a
 * peer while the vault is open.
 *
 * Two modes, decided by the sync engine based on the local dirty state:
 *   • "reload"   — vault is clean. Offer a one-tap silent reload.
 *   • "conflict" — vault has unsaved edits. Force an explicit choice:
 *                  keep local edits, or discard them and take the remote copy.
 *
 * It never auto-applies over a live database; the user is always in control.
 */

import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import {
  useThemeColors,
  Fonts,
  FontSizes,
  LineHeights,
  Spacing,
  Radii,
} from "@/src/constants/theme";
import { useSyncStore } from "@/src/stores/useSyncStore";
import { syncEngine } from "@/src/services/sync/syncEngine";

export function RemoteUpdateBanner() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const pending = useSyncStore((s) => s.pendingRemote);
  const [busy, setBusy] = useState(false);

  if (!pending) return null;

  const isConflict = pending.mode === "conflict";
  const accent = isConflict ? colors.statusWarning : colors.accentMint;

  const resolve = async (decision: "apply" | "discard") => {
    if (busy) return;
    setBusy(true);
    try {
      await syncEngine.resolvePending(decision);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(250)}
      exiting={FadeOut.duration(150)}
      style={[styles.banner, { borderColor: accent }]}
    >
      <View style={styles.row}>
        <Ionicons
          name={isConflict ? "warning-outline" : "cloud-download-outline"}
          size={20}
          color={accent}
        />
        <View style={styles.textContainer}>
          <Text style={styles.title}>
            {isConflict ? "Sync conflict" : "Newer version available"}
          </Text>
          <Text style={styles.body}>
            {isConflict
              ? `A newer copy of "${pending.filename}" arrived from a peer, but you have unsaved changes. Choose which version to keep.`
              : `A newer copy of "${pending.filename}" was received from a peer. Reload to see the latest changes.`}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        {isConflict ? (
          <>
            <Pressable
              onPress={() => resolve("discard")}
              disabled={busy}
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              <Text style={styles.secondaryBtnText}>Keep my edits</Text>
            </Pressable>
            <Pressable
              onPress={() => resolve("apply")}
              disabled={busy}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: accent },
                pressed && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              <Text style={styles.primaryBtnText}>Discard & take remote</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => resolve("discard")}
              disabled={busy}
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              <Text style={styles.secondaryBtnText}>Later</Text>
            </Pressable>
            <Pressable
              onPress={() => resolve("apply")}
              disabled={busy}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: accent },
                pressed && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              <Ionicons
                name="refresh"
                size={15}
                color={colors.backgroundPrimary}
                style={{ marginRight: Spacing.xs }}
              />
              <Text style={styles.primaryBtnText}>Reload now</Text>
            </Pressable>
          </>
        )}
      </View>
    </Animated.View>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    banner: {
      marginHorizontal: Spacing.lg,
      marginTop: Spacing.md,
      padding: Spacing.md,
      borderRadius: Radii.md,
      borderWidth: 1,
      backgroundColor: colors.surfaceElevated,
      gap: Spacing.md,
    },
    row: {
      flexDirection: "row",
      gap: Spacing.sm,
    },
    textContainer: {
      flex: 1,
    },
    title: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
      marginBottom: 2,
    },
    body: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      lineHeight: LineHeights.caption,
      color: colors.textMuted,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: Spacing.sm,
    },
    primaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radii.sm,
    },
    primaryBtnText: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.caption,
      color: colors.backgroundPrimary,
    },
    secondaryBtn: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radii.sm,
      borderWidth: 1,
      borderColor: colors.borderSage,
    },
    secondaryBtnText: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.textSecondary,
    },
    pressed: {
      opacity: 0.7,
    },
    disabled: {
      opacity: 0.5,
    },
  });
