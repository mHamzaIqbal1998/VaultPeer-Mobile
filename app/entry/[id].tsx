/**
 * Entry Detail Screen
 *
 * Displays all fields of a password entry with:
 * - Masked password with reveal toggle
 * - Copy-to-clipboard for each field
 * - Navigates to edit screen
 * - Delete with confirmation
 * - Access history logging
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useClipboard } from "@/src/hooks/useClipboard";
import * as Haptics from "expo-haptics";
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
import { useVaultStore } from "@/src/stores/useVaultStore";
import { getKdbxIconName } from "@/src/constants/kdbxIcons";
import { CyberCard } from "@/src/components/CyberCard";

// ────────────────────────────────────────────
// Sub-Components
// ────────────────────────────────────────────

function FieldRow({
  label,
  value,
  iconName,
  isMasked = false,
  isMono = false,
  onCopy,
}: {
  label: string;
  value: string;
  iconName: React.ComponentProps<typeof Ionicons>["name"];
  isMasked?: boolean;
  isMono?: boolean;
  onCopy?: () => void;
}) {
  const [revealed, setRevealed] = useState(!isMasked);

  if (!value && !isMasked) return null;

  const displayValue = !revealed ? "••••••••••••" : value || "(empty)";

  return (
    <Animated.View entering={FadeInDown.duration(200)} style={styles.fieldRow}>
      <View style={styles.fieldHeader}>
        <View style={styles.fieldLabelRow}>
          <Ionicons name={iconName} size={16} color={Colors.textMuted} />
          <Text style={styles.fieldLabel}>{label}</Text>
        </View>
        <View style={styles.fieldActions}>
          {isMasked && (
            <Pressable
              onPress={() => setRevealed(!revealed)}
              style={styles.fieldAction}
              hitSlop={8}
              accessibilityLabel={revealed ? "Hide password" : "Show password"}
            >
              <Ionicons
                name={revealed ? "eye-off-outline" : "eye-outline"}
                size={18}
                color={Colors.textMuted}
              />
            </Pressable>
          )}
          {onCopy && (
            <Pressable
              onPress={onCopy}
              style={styles.fieldAction}
              hitSlop={8}
              accessibilityLabel={`Copy ${label}`}
            >
              <Ionicons
                name="copy-outline"
                size={18}
                color={Colors.accentMint}
              />
            </Pressable>
          )}
        </View>
      </View>
      <Text
        style={[
          styles.fieldValue,
          isMono && styles.fieldValueMono,
          !revealed && styles.fieldValueMasked,
        ]}
        selectable={revealed}
        numberOfLines={isMasked && !revealed ? 1 : undefined}
      >
        {displayValue}
      </Text>
    </Animated.View>
  );
}

// ────────────────────────────────────────────
// Main Screen
// ────────────────────────────────────────────

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { getEntry, deleteEntry, logAccess, isGroupInRecycleBin } =
    useVaultStore();
  const { copyToClipboard } = useClipboard();

  const entry = getEntry(id ?? "");

  // Log view on mount
  useEffect(() => {
    if (entry) {
      logAccess(entry.uuid, entry.title, "viewed");
    }
  }, [entry?.uuid]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = useCallback(
    async (text: string, fieldName: string) => {
      const isSensitive = fieldName.toLowerCase() === "password";
      const success = await copyToClipboard(text, isSensitive);
      if (success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (entry) {
          logAccess(entry.uuid, entry.title, "copied");
        }
      }
    },
    [entry, logAccess, copyToClipboard]
  );

  const handleDelete = useCallback(() => {
    if (!entry) return;
    const inRecycleBin = isGroupInRecycleBin(entry.parentGroupUuid);
    const title = inRecycleBin ? "Permanently Delete Entry" : "Delete Entry";
    const message = inRecycleBin
      ? `Are you sure you want to permanently delete "${entry.title}"? This action cannot be undone.`
      : `Are you sure you want to delete "${entry.title}"? This will move it to the recycle bin.`;
    const deleteBtnText = inRecycleBin ? "Delete Permanently" : "Delete";

    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: deleteBtnText,
        style: "destructive",
        onPress: () => {
          deleteEntry(entry.uuid);
          logAccess(entry.uuid, entry.title, "deleted");
          router.back();
        },
      },
    ]);
  }, [entry, deleteEntry, logAccess, router, isGroupInRecycleBin]);

  const handleEdit = useCallback(() => {
    if (!entry) return;
    router.push({
      pathname: "/entry/edit" as const as any,
      params: { entryId: entry.uuid },
    } as any);
  }, [entry, router]);

  if (!entry) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={Colors.textDisabled}
          />
          <Text style={styles.emptyText}>Entry not found</Text>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <Text style={styles.backLinkText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const iconName = getKdbxIconName(entry.iconId);
  const modifiedDate = new Date(entry.modifiedAt);
  const createdDate = new Date(entry.createdAt);

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={8}
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.accentMint} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Entry Detail
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleEdit}
            style={styles.headerActionBtn}
            hitSlop={8}
            accessibilityLabel="Edit entry"
          >
            <Ionicons
              name="create-outline"
              size={22}
              color={Colors.accentMint}
            />
          </Pressable>
          <Pressable
            onPress={handleDelete}
            style={styles.headerActionBtn}
            hitSlop={8}
            accessibilityLabel="Delete entry"
          >
            <Ionicons
              name="trash-outline"
              size={22}
              color={Colors.statusError}
            />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Title Card ── */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <CyberCard
            style={{
              alignItems: "center",
              padding: Spacing.xxl,
              marginBottom: Spacing.lg,
            }}
          >
            <View style={styles.titleIconContainer}>
              <Ionicons name={iconName} size={28} color={Colors.accentMint} />
            </View>
            <Text style={styles.entryTitle}>{entry.title || "Untitled"}</Text>
            {entry.tags.length > 0 && (
              <View style={styles.tagsRow}>
                {entry.tags.map((tag) => (
                  <View key={tag} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
          </CyberCard>
        </Animated.View>

        {/* ── Core Fields ── */}
        <CyberCard style={{ padding: Spacing.lg, marginBottom: Spacing.lg }}>
          <FieldRow
            label="Username"
            value={entry.username}
            iconName="person-outline"
            onCopy={() => handleCopy(entry.username, "Username")}
          />
          <FieldRow
            label="Password"
            value={entry.password}
            iconName="key-outline"
            isMasked
            isMono
            onCopy={() => handleCopy(entry.password, "Password")}
          />
          <FieldRow
            label="URL"
            value={entry.url}
            iconName="globe-outline"
            onCopy={() => handleCopy(entry.url, "URL")}
          />
          <FieldRow
            label="Notes"
            value={entry.notes}
            iconName="document-text-outline"
            onCopy={() => handleCopy(entry.notes, "Notes")}
          />
        </CyberCard>

        {/* ── Custom Fields ── */}
        {Object.keys(entry.fields).length > 0 && (
          <CyberCard style={{ padding: Spacing.lg, marginBottom: Spacing.lg }}>
            <Text style={styles.sectionTitle}>Custom Fields</Text>
            {Object.entries(entry.fields).map(([key, value]) => (
              <FieldRow
                key={key}
                label={key}
                value={value}
                iconName="pricetag-outline"
                onCopy={() => handleCopy(value, key)}
              />
            ))}
          </CyberCard>
        )}

        {/* ── Metadata ── */}
        <CyberCard style={{ padding: Spacing.lg, marginBottom: Spacing.lg }}>
          <Text style={styles.sectionTitle}>Metadata</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Created</Text>
            <Text style={styles.metaValue}>
              {createdDate.toLocaleDateString()}{" "}
              {createdDate.toLocaleTimeString()}
            </Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Modified</Text>
            <Text style={styles.metaValue}>
              {modifiedDate.toLocaleDateString()}{" "}
              {modifiedDate.toLocaleTimeString()}
            </Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>UUID</Text>
            <Text style={[styles.metaValue, styles.uuidText]} numberOfLines={1}>
              {entry.uuid}
            </Text>
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

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSage,
  },
  backButton: {
    minWidth: TouchTarget.min,
    minHeight: TouchTarget.min,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.subheading,
    color: Colors.textPrimary,
  },
  headerActions: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  headerActionBtn: {
    minWidth: TouchTarget.min,
    minHeight: TouchTarget.min,
    alignItems: "center",
    justifyContent: "center",
  },

  // Scroll
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.huge,
  },

  // Title Card
  titleCard: {
    alignItems: "center",
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    padding: Spacing.xxl,
    marginBottom: Spacing.lg,
    ...Shadows.card,
  },
  titleIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.accentMintDim,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  entryTitle: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.heading,
    color: Colors.textPrimary,
    textAlign: "center",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    justifyContent: "center",
  },
  tag: {
    backgroundColor: Colors.accentMintDim,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  tagText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.micro,
    color: Colors.accentMint,
  },

  // Fields Card
  fieldsCard: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    ...Shadows.card,
  },
  sectionTitle: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
    marginBottom: Spacing.md,
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  // Field Row
  fieldRow: {
    marginBottom: Spacing.lg,
  },
  fieldHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  fieldLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  fieldActions: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  fieldAction: {
    minWidth: 36,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radii.sm,
  },
  fieldValue: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.body,
    lineHeight: LineHeights.body,
    color: Colors.textPrimary,
  },
  fieldValueMono: {
    fontFamily: Fonts.mono.regular,
    letterSpacing: 1,
  },
  fieldValueMasked: {
    color: Colors.textDisabled,
    letterSpacing: 3,
  },

  // Meta Card
  metaCard: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
  },
  metaValue: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textSecondary,
  },
  metaDivider: {
    height: 1,
    backgroundColor: Colors.borderSage,
    marginVertical: Spacing.sm,
  },
  uuidText: {
    fontFamily: Fonts.mono.regular,
    fontSize: FontSizes.micro,
    maxWidth: 180,
  },

  // Empty State
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  emptyText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.body,
    color: Colors.textMuted,
  },
  backLink: {
    marginTop: Spacing.md,
    padding: Spacing.sm,
  },
  backLinkText: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.body,
    color: Colors.accentMint,
  },
});
