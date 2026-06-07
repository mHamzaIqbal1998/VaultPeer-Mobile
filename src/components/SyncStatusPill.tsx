/**
 * SyncStatusPill — Compact, non-blocking indicator of peer sync state.
 *
 * Reads directly from useSyncStore so it stays in sync with the engine without
 * any prop drilling. Designed to sit on the unlock card: it never blocks the
 * user from opening their vault — it just communicates what's happening.
 */

import React, { useMemo } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useThemeColors,
  Fonts,
  FontSizes,
  Spacing,
  Radii,
} from "@/src/constants/theme";
import { useSyncStore, type SyncStatus } from "@/src/stores/useSyncStore";

interface PillVisual {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  spinner?: boolean;
}

export function SyncStatusPill() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const status = useSyncStore((s) => s.status);
  const activePeers = useSyncStore((s) => s.activePeers);

  // The pill is meaningless when there is nothing to sync.
  if (status === "idle") return null;

  const visual = resolveVisual(status, activePeers, colors);

  return (
    <View
      style={[
        styles.pill,
        { borderColor: visual.color, backgroundColor: `${visual.color}1A` },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Sync status: ${visual.label}`}
    >
      {visual.spinner ? (
        <ActivityIndicator size="small" color={visual.color} />
      ) : (
        <Ionicons name={visual.icon} size={14} color={visual.color} />
      )}
      <Text style={[styles.label, { color: visual.color }]} numberOfLines={1}>
        {visual.label}
      </Text>
    </View>
  );
}

function resolveVisual(
  status: SyncStatus,
  activePeers: number,
  colors: any
): PillVisual {
  switch (status) {
    case "syncing":
      return {
        label:
          activePeers > 0
            ? `Syncing with ${activePeers} peer${activePeers > 1 ? "s" : ""}…`
            : "Syncing…",
        icon: "sync",
        color: colors.accentMint,
        spinner: true,
      };
    case "synced":
      return {
        label:
          activePeers > 0
            ? `Up to date · ${activePeers} peer${activePeers > 1 ? "s" : ""}`
            : "Up to date",
        icon: "checkmark-circle",
        color: colors.accentMint,
      };
    case "offline":
      return {
        label: "Waiting for peers",
        icon: "cloud-offline-outline",
        color: colors.textMuted,
      };
    case "error":
      return {
        label: "Sync error",
        icon: "alert-circle",
        color: colors.statusError,
      };
    default:
      return {
        label: "Idle",
        icon: "ellipse-outline",
        color: colors.textMuted,
      };
  }
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: Spacing.xs,
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      borderRadius: Radii.full ?? 999,
      borderWidth: 1,
      marginBottom: Spacing.lg,
    },
    label: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      letterSpacing: 0.3,
    },
  });
