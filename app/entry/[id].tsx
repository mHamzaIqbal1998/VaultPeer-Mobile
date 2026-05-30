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

import { CyberCard } from "@/src/components/CyberCard";
import { getKdbxIconName } from "@/src/constants/kdbxIcons";
import { ActionModal } from "@/src/components/ActionModal";
import {
  useThemeColors,
  FontSizes,
  Fonts,
  LineHeights,
  Radii,
  Shadows,
  Spacing,
  TouchTarget,
} from "@/src/constants/theme";
import { useClipboard } from "@/src/hooks/useClipboard";
import type { OtpParams } from "@/src/services/otpService";
import { generateTotp, parseOtpUri } from "@/src/services/otpService";
import { useVaultStore } from "@/src/stores/useVaultStore";
import type { VaultAttachment, VaultHistorySnapshot } from "@/src/types/kdbx";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { createFile, writeTempFile } from "vaultpeer-file-system";

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

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
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [revealed, setRevealed] = useState(!isMasked);

  if (!value) return null;

  const displayValue = !revealed ? "••••••••••••" : value || "(empty)";

  return (
    <Animated.View entering={FadeInDown.duration(200)} style={styles.fieldRow}>
      <View style={styles.fieldHeader}>
        <View style={styles.fieldLabelRow}>
          <Ionicons name={iconName} size={16} color={colors.textMuted} />
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
                color={colors.textMuted}
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
                color={colors.accentMint}
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

function OtpCard({
  otpUri,
  entryTitle,
  entryUsername,
  onCopy,
}: {
  otpUri: string;
  entryTitle: string;
  entryUsername: string;
  onCopy: (text: string, label: string) => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [code, setCode] = useState("");
  const [timeLeft, setTimeLeft] = useState(30);
  const [progress, setProgress] = useState(1);
  const [params, setParams] = useState<OtpParams | null>(null);

  useEffect(() => {
    let resolvedParams: OtpParams;
    try {
      resolvedParams = parseOtpUri(otpUri);
    } catch {
      resolvedParams = {
        type: "totp",
        label: entryUsername || "Account",
        issuer: entryTitle || "Unknown",
        secret: otpUri.trim(),
        digits: 6,
        period: 30,
        algorithm: "SHA1",
      };
    }
    setParams(resolvedParams);

    const updateOtp = () => {
      try {
        const generated = generateTotp(resolvedParams.secret, {
          digits: resolvedParams.digits,
          period: resolvedParams.period,
        });
        setCode(generated);

        const period = resolvedParams.period;
        const elapsed = Math.floor(Date.now() / 1000) % period;
        const remaining = period - elapsed;
        setTimeLeft(remaining);
        setProgress(remaining / period);
      } catch (err) {
        console.error("Error generating TOTP:", err);
        setCode("ERROR");
      }
    };

    updateOtp();
    const interval = setInterval(updateOtp, 1000);

    return () => clearInterval(interval);
  }, [otpUri, entryTitle, entryUsername]);

  if (!params || !code) return null;

  const formattedCode =
    code.length === 6 ? `${code.substring(0, 3)} ${code.substring(3)}` : code;

  return (
    <Animated.View entering={FadeInDown.duration(250)}>
      <CyberCard style={styles.otpCard}>
        <View style={styles.otpHeader}>
          <View style={styles.otpInfo}>
            <Ionicons
              name="shield-checkmark-outline"
              size={20}
              color={colors.accentMint}
            />
            <View style={{ marginLeft: Spacing.sm }}>
              <Text style={styles.otpIssuer}>{params.issuer}</Text>
              <Text style={styles.otpLabel}>{params.label}</Text>
            </View>
          </View>
          <Pressable
            onPress={() => onCopy(code, "One-Time Password")}
            style={styles.otpCopyBtn}
            hitSlop={8}
            accessibilityLabel="Copy OTP code"
          >
            <Ionicons name="copy-outline" size={18} color={colors.accentMint} />
          </Pressable>
        </View>

        <View style={styles.otpCodeContainer}>
          <Text style={styles.otpCode}>{formattedCode}</Text>
        </View>

        <View style={styles.otpProgressRow}>
          <View style={styles.otpProgressBarBg}>
            <View
              style={[
                styles.otpProgressBarFill,
                { width: `${progress * 100}%` },
                progress < 0.2 && { backgroundColor: colors.statusError },
              ]}
            />
          </View>
          <Text
            style={[
              styles.otpCountdownText,
              progress < 0.2 && { color: colors.statusError },
            ]}
          >
            {timeLeft}s
          </Text>
        </View>
      </CyberCard>
    </Animated.View>
  );
}

// ────────────────────────────────────────────
// Main Screen
// ────────────────────────────────────────────

export default function EntryDetailScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const deleteEntry = useVaultStore((state) => state.deleteEntry);
  const restoreEntry = useVaultStore((state) => state.restoreEntry);
  const logAccess = useVaultStore((state) => state.logAccess);
  const getAttachmentData = useVaultStore((state) => state.getAttachmentData);
  const getEntryHistory = useVaultStore((state) => state.getEntryHistory);
  const restoreHistorySnapshot = useVaultStore(
    (state) => state.restoreHistorySnapshot
  );
  const deleteHistorySnapshot = useVaultStore(
    (state) => state.deleteHistorySnapshot
  );
  const isGroupInRecycleBin = useVaultStore(
    (state) => state.isGroupInRecycleBin
  );
  const entry = useVaultStore(
    useCallback((state) => state.entryIndex.get(id ?? "") ?? null, [id])
  );
  const { copyToClipboard } = useClipboard();

  const [exporting, setExporting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedSnapshot, setExpandedSnapshot] = useState<number | null>(null);
  const [historySnapshots, setHistorySnapshots] = useState<
    VaultHistorySnapshot[]
  >([]);
  const [restoringSnapshot, setRestoringSnapshot] = useState(false);

  const [modalConfig, setModalConfig] = useState<{
    visible: boolean;
    title: string;
    description?: string;
    icon?: keyof typeof Ionicons.glyphMap;
    iconColor?: string;
    options?: any[];
    buttons?: any[];
  }>({
    visible: false,
    title: "",
  });

  const hideModal = useCallback(() => {
    setModalConfig((prev) => ({ ...prev, visible: false }));
  }, []);

  const showNotificationModal = useCallback(
    (
      title: string,
      description: string,
      icon: keyof typeof Ionicons.glyphMap = "checkmark-circle-outline"
    ) => {
      setModalConfig({
        visible: true,
        title,
        description,
        icon,
        buttons: [
          {
            text: "OK",
            onPress: () =>
              setModalConfig((prev) => ({ ...prev, visible: false })),
            variant: "primary",
          },
        ],
      });
    },
    []
  );

  const showErrorModal = useCallback(
    (title: string, description: string) => {
      setModalConfig({
        visible: true,
        title,
        description,
        icon: "alert-circle-outline",
        iconColor: colors.statusError,
        buttons: [
          {
            text: "OK",
            onPress: () =>
              setModalConfig((prev) => ({ ...prev, visible: false })),
            variant: "primary",
          },
        ],
      });
    },
    [colors.statusError]
  );

  const handleExportAttachment = useCallback(
    async (attachment: VaultAttachment) => {
      try {
        setExporting(attachment.name);
        let base64Data = attachment.data;
        if (!base64Data && entry) {
          base64Data = await getAttachmentData(entry.uuid, attachment.name);
        }
        if (!base64Data) {
          throw new Error(
            "Attachment content is empty or could not be loaded."
          );
        }
        const tempFileUri = await writeTempFile(base64Data);
        await createFile(attachment.name, tempFileUri);
        showNotificationModal(
          "Success",
          `Saved attachment "${attachment.name}" successfully.`
        );
      } catch (err: any) {
        console.error(err);
        showErrorModal(
          "Export Failed",
          err?.message || "Could not save the attachment."
        );
      } finally {
        setExporting(null);
      }
    },
    [entry, getAttachmentData, showNotificationModal, showErrorModal]
  );

  const isExpired =
    entry?.expires &&
    entry?.expiryTime &&
    new Date(entry.expiryTime).getTime() < Date.now();
  const expiryDate = entry?.expiryTime ? new Date(entry.expiryTime) : null;

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

  const inRecycleBin = entry
    ? isGroupInRecycleBin(entry.parentGroupUuid)
    : false;

  const handleDelete = useCallback(() => {
    if (!entry || deleting) return;
    const title = inRecycleBin ? "Permanently Delete Entry" : "Delete Entry";
    const message = inRecycleBin
      ? `Are you sure you want to permanently delete "${entry.title}"? This action cannot be undone.`
      : `Are you sure you want to delete "${entry.title}"? This will move it to the recycle bin.`;
    const deleteBtnText = inRecycleBin ? "Delete Permanently" : "Delete";

    setModalConfig({
      visible: true,
      title,
      description: message,
      icon: "trash-outline",
      iconColor: colors.statusError,
      buttons: [
        { text: "Cancel", onPress: hideModal, variant: "secondary" },
        {
          text: deleteBtnText,
          variant: "destructive",
          onPress: () => {
            hideModal();
            setDeleting(true);
            setTimeout(() => {
              try {
                deleteEntry(entry.uuid);
                logAccess(entry.uuid, entry.title, "deleted");
                router.back();
              } catch (err) {
                setDeleting(false);
                console.error(err);
              }
            }, 50);
          },
        },
      ],
    });
  }, [
    entry,
    deleteEntry,
    logAccess,
    router,
    inRecycleBin,
    deleting,
    colors.statusError,
    hideModal,
  ]);

  const handleRestore = useCallback(() => {
    if (!entry || restoring) return;
    setModalConfig({
      visible: true,
      title: "Restore Entry",
      description: `Are you sure you want to restore "${entry.title}"?`,
      icon: "refresh-outline",
      iconColor: colors.textPrimary,
      buttons: [
        { text: "Cancel", onPress: hideModal, variant: "secondary" },
        {
          text: "Restore",
          variant: "primary",
          onPress: () => {
            hideModal();
            setRestoring(true);
            setTimeout(() => {
              try {
                const success = restoreEntry(entry.uuid);
                if (success) {
                  logAccess(entry.uuid, entry.title, "updated");
                  router.back();
                } else {
                  setRestoring(false);
                  showErrorModal("Error", "Failed to restore entry.");
                }
              } catch (err) {
                setRestoring(false);
                console.error(err);
              }
            }, 50);
          },
        },
      ],
    });
  }, [
    entry,
    restoreEntry,
    logAccess,
    router,
    restoring,
    colors.textPrimary,
    hideModal,
    showErrorModal,
  ]);

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
            color={colors.textDisabled}
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
          disabled={restoring || deleting}
          style={[
            styles.backButton,
            (restoring || deleting) && { opacity: 0.5 },
          ]}
          hitSlop={8}
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.accentMint} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {entry?.title || "Entry Detail"}
        </Text>
        <View style={styles.headerActions}>
          {inRecycleBin ? (
            <Pressable
              onPress={handleRestore}
              disabled={restoring || deleting}
              style={[
                styles.headerActionBtn,
                (restoring || deleting) && { opacity: 0.5 },
              ]}
              hitSlop={8}
              accessibilityLabel="Restore entry"
            >
              {restoring ? (
                <ActivityIndicator size="small" color={colors.accentMint} />
              ) : (
                <Ionicons
                  name="arrow-undo-outline"
                  size={22}
                  color={colors.accentMint}
                />
              )}
            </Pressable>
          ) : (
            <Pressable
              onPress={handleEdit}
              disabled={restoring || deleting}
              style={[
                styles.headerActionBtn,
                (restoring || deleting) && { opacity: 0.5 },
              ]}
              hitSlop={8}
              accessibilityLabel="Edit entry"
            >
              <Ionicons
                name="create-outline"
                size={22}
                color={colors.accentMint}
              />
            </Pressable>
          )}
          <Pressable
            onPress={handleDelete}
            disabled={restoring || deleting}
            style={[
              styles.headerActionBtn,
              (restoring || deleting) && { opacity: 0.5 },
            ]}
            hitSlop={8}
            accessibilityLabel="Delete entry"
          >
            {deleting ? (
              <ActivityIndicator size="small" color={colors.statusError} />
            ) : (
              <Ionicons
                name="trash-outline"
                size={22}
                color={colors.statusError}
              />
            )}
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
              <Ionicons name={iconName} size={28} color={colors.accentMint} />
            </View>
            <Text style={styles.entryTitle}>{entry.title || "Untitled"}</Text>
            {entry.expires && (
              <View style={styles.expiryBadgeRow}>
                {isExpired ? (
                  <View style={[styles.expiryBadge, styles.expiryBadgeExpired]}>
                    <Ionicons
                      name="warning"
                      size={12}
                      color={colors.statusError}
                    />
                    <Text style={styles.expiryBadgeTextExpired}>EXPIRED</Text>
                  </View>
                ) : (
                  <View style={styles.expiryBadge}>
                    <Ionicons
                      name="time"
                      size={12}
                      color={colors.statusWarning}
                    />
                    <Text style={styles.expiryBadgeText}>
                      Expires:{" "}
                      {expiryDate ? expiryDate.toLocaleString() : "Never"}
                    </Text>
                  </View>
                )}
              </View>
            )}
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

        {/* ── OTP Card ── */}
        {entry.otp ? (
          <OtpCard
            otpUri={entry.otp}
            entryTitle={entry.title}
            entryUsername={entry.username}
            onCopy={handleCopy}
          />
        ) : null}

        {/* ── Core Fields ── */}
        {entry.username || entry.password || entry.url || entry.notes ? (
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
        ) : null}

        {/* ── Custom Fields ── */}
        {Object.entries(entry.fields).some(([_, val]) => !!val) && (
          <CyberCard style={{ padding: Spacing.lg, marginBottom: Spacing.lg }}>
            <Text style={styles.sectionTitle}>Custom Fields</Text>
            {Object.entries(entry.fields).map(([key, value]) => (
              <FieldRow
                key={key}
                label={key}
                value={value}
                iconName="pricetag-outline"
                isMasked={entry.secureFields?.includes(key)}
                isMono={entry.secureFields?.includes(key)}
                onCopy={() => handleCopy(value, key)}
              />
            ))}
          </CyberCard>
        )}

        {/* ── Attachments ── */}
        {entry.attachments && entry.attachments.length > 0 && (
          <CyberCard style={{ padding: Spacing.lg, marginBottom: Spacing.lg }}>
            <Text style={styles.sectionTitle}>Attachments</Text>
            {entry.attachments.map((attachment) => (
              <View key={attachment.id} style={styles.attachmentRow}>
                <View style={styles.attachmentInfo}>
                  <Ionicons
                    name="document-attach-outline"
                    size={20}
                    color={colors.accentMint}
                  />
                  <View style={{ marginLeft: Spacing.sm, flex: 1 }}>
                    <Text style={styles.attachmentName} numberOfLines={1}>
                      {attachment.name}
                    </Text>
                    <Text style={styles.attachmentSize}>
                      {formatSize(attachment.size)}
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => handleExportAttachment(attachment)}
                  style={styles.attachmentExportBtn}
                  disabled={exporting === attachment.name}
                  hitSlop={8}
                >
                  {exporting === attachment.name ? (
                    <ActivityIndicator size="small" color={colors.accentMint} />
                  ) : (
                    <Ionicons
                      name="download-outline"
                      size={20}
                      color={colors.accentMint}
                    />
                  )}
                </Pressable>
              </View>
            ))}
          </CyberCard>
        )}

        {/* ── Entry History ── */}
        <CyberCard style={{ padding: Spacing.lg, marginBottom: Spacing.lg }}>
          <Pressable
            onPress={() => {
              if (!showHistory && entry) {
                const snapshots = getEntryHistory(entry.uuid);
                setHistorySnapshots(snapshots);
              }
              setShowHistory(!showHistory);
              setExpandedSnapshot(null);
            }}
            style={styles.historyToggleRow}
            hitSlop={4}
          >
            <View style={styles.fieldLabelRow}>
              <Ionicons
                name="time-outline"
                size={14}
                color={colors.textMuted}
              />
              <Text style={styles.historySectionTitle}>Entry History</Text>
            </View>
            <View style={styles.historyBadgeRow}>
              <Ionicons
                name={showHistory ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.textMuted}
              />
            </View>
          </Pressable>

          {showHistory && (
            <Animated.View entering={FadeInDown.duration(200)}>
              {historySnapshots.length === 0 ? (
                <View style={styles.historyEmpty}>
                  <Ionicons
                    name="document-outline"
                    size={28}
                    color={colors.textDisabled}
                  />
                  <Text style={styles.historyEmptyText}>
                    No history snapshots available
                  </Text>
                </View>
              ) : (
                historySnapshots
                  .slice()
                  .reverse()
                  .map((snapshot) => {
                    const realIndex = snapshot.index;
                    const isExpanded = expandedSnapshot === realIndex;
                    const snapDate = new Date(snapshot.modifiedAt);
                    const isActive =
                      snapshot.title === entry.title &&
                      snapshot.password === entry.password &&
                      snapshot.username === entry.username;

                    return (
                      <View key={realIndex} style={styles.historyItem}>
                        <Pressable
                          onPress={() =>
                            setExpandedSnapshot(isExpanded ? null : realIndex)
                          }
                          style={[
                            styles.historyItemHeader,
                            isExpanded && styles.historyItemHeaderExpanded,
                          ]}
                        >
                          <View style={styles.historyItemInfo}>
                            <Ionicons
                              name="git-commit-outline"
                              size={16}
                              color={
                                isActive ? colors.accentMint : colors.textMuted
                              }
                            />
                            <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                              <Text
                                style={styles.historyItemTitle}
                                numberOfLines={1}
                              >
                                {snapshot.title || "(no title)"}
                              </Text>
                              <Text style={styles.historyItemDate}>
                                {snapDate.toLocaleDateString()}{" "}
                                {snapDate.toLocaleTimeString()}
                              </Text>
                            </View>
                          </View>
                          <Ionicons
                            name={isExpanded ? "chevron-up" : "chevron-down"}
                            size={16}
                            color={colors.textMuted}
                          />
                        </Pressable>

                        {isExpanded &&
                          (() => {
                            const hasContent =
                              !!snapshot.username ||
                              !!snapshot.password ||
                              !!snapshot.url ||
                              !!snapshot.notes ||
                              (snapshot.tags && snapshot.tags.length > 0) ||
                              (snapshot.fields &&
                                Object.entries(snapshot.fields).some(
                                  ([_, val]) => !!val
                                ));

                            return (
                              <Animated.View
                                entering={FadeInDown.duration(150)}
                                style={styles.historyPreview}
                              >
                                <FieldRow
                                  label="Username"
                                  value={snapshot.username}
                                  iconName="person-outline"
                                  onCopy={() =>
                                    handleCopy(snapshot.username, "Username")
                                  }
                                />
                                <FieldRow
                                  label="Password"
                                  value={snapshot.password}
                                  iconName="key-outline"
                                  isMasked
                                  isMono
                                  onCopy={() =>
                                    handleCopy(snapshot.password, "Password")
                                  }
                                />
                                <FieldRow
                                  label="URL"
                                  value={snapshot.url}
                                  iconName="globe-outline"
                                  onCopy={() => handleCopy(snapshot.url, "URL")}
                                />
                                <FieldRow
                                  label="Notes"
                                  value={snapshot.notes}
                                  iconName="document-text-outline"
                                  onCopy={() =>
                                    handleCopy(snapshot.notes, "Notes")
                                  }
                                />

                                {/* Custom Fields */}
                                {snapshot.fields &&
                                  Object.entries(snapshot.fields).map(
                                    ([key, val]) => (
                                      <FieldRow
                                        key={key}
                                        label={key}
                                        value={val}
                                        iconName="pricetag-outline"
                                        isMasked={snapshot.secureFields?.includes(
                                          key
                                        )}
                                        isMono={snapshot.secureFields?.includes(
                                          key
                                        )}
                                        onCopy={() => handleCopy(val, key)}
                                      />
                                    )
                                  )}

                                {/* Tags */}
                                {snapshot.tags && snapshot.tags.length > 0 && (
                                  <View style={{ marginBottom: Spacing.lg }}>
                                    <View
                                      style={[
                                        styles.fieldLabelRow,
                                        { marginBottom: Spacing.xs },
                                      ]}
                                    >
                                      <Ionicons
                                        name="pricetag-outline"
                                        size={16}
                                        color={colors.textMuted}
                                      />
                                      <Text style={styles.fieldLabel}>
                                        Tags
                                      </Text>
                                    </View>
                                    <View style={styles.tagsRow}>
                                      {snapshot.tags.map((tag) => (
                                        <View key={tag} style={styles.tag}>
                                          <Text style={styles.tagText}>
                                            {tag}
                                          </Text>
                                        </View>
                                      ))}
                                    </View>
                                  </View>
                                )}

                                {/* Fallback if no content */}
                                {!hasContent && (
                                  <Text style={styles.historyEmptyFieldsText}>
                                    No fields populated in this version
                                  </Text>
                                )}

                                <View style={styles.historyActions}>
                                  <Pressable
                                    onPress={() => {
                                      if (restoringSnapshot) return;
                                      setModalConfig({
                                        visible: true,
                                        title: "Restore Snapshot",
                                        description: `Restore this entry to its state from ${snapDate.toLocaleString()}? The current state will be saved to history first.`,
                                        icon: "refresh-outline",
                                        iconColor: colors.textPrimary,
                                        buttons: [
                                          {
                                            text: "Cancel",
                                            onPress: hideModal,
                                            variant: "secondary",
                                          },
                                          {
                                            text: "Restore",
                                            variant: "primary",
                                            onPress: async () => {
                                              hideModal();
                                              setRestoringSnapshot(true);
                                              try {
                                                const result =
                                                  await restoreHistorySnapshot(
                                                    entry.uuid,
                                                    realIndex
                                                  );
                                                if (result) {
                                                  const updated =
                                                    getEntryHistory(entry.uuid);
                                                  setHistorySnapshots(updated);
                                                  setExpandedSnapshot(null);
                                                  Haptics.notificationAsync(
                                                    Haptics
                                                      .NotificationFeedbackType
                                                      .Success
                                                  );
                                                  showNotificationModal(
                                                    "Restored",
                                                    "Entry restored to snapshot state."
                                                  );
                                                } else {
                                                  showErrorModal(
                                                    "Error",
                                                    "Failed to restore snapshot."
                                                  );
                                                }
                                              } catch (err) {
                                                console.error(err);
                                                showErrorModal(
                                                  "Error",
                                                  "An error occurred while restoring."
                                                );
                                              } finally {
                                                setRestoringSnapshot(false);
                                              }
                                            },
                                          },
                                        ],
                                      });
                                    }}
                                    style={({ pressed }) => [
                                      styles.historyActionBtn,
                                      styles.historyRestoreBtn,
                                      pressed && { opacity: 0.7 },
                                      restoringSnapshot && { opacity: 0.5 },
                                    ]}
                                    disabled={restoringSnapshot}
                                  >
                                    {restoringSnapshot ? (
                                      <ActivityIndicator
                                        size="small"
                                        color={colors.backgroundPrimary}
                                      />
                                    ) : (
                                      <>
                                        <Ionicons
                                          name="refresh-outline"
                                          size={14}
                                          color={colors.backgroundPrimary}
                                        />
                                        <Text
                                          style={styles.historyRestoreBtnText}
                                        >
                                          Restore
                                        </Text>
                                      </>
                                    )}
                                  </Pressable>

                                  <Pressable
                                    onPress={() => {
                                      setModalConfig({
                                        visible: true,
                                        title: "Delete Snapshot",
                                        description: `Remove this history snapshot from ${snapDate.toLocaleString()}? This cannot be undone.`,
                                        icon: "trash-outline",
                                        iconColor: colors.statusError,
                                        buttons: [
                                          {
                                            text: "Cancel",
                                            onPress: hideModal,
                                            variant: "secondary",
                                          },
                                          {
                                            text: "Delete",
                                            variant: "destructive",
                                            onPress: () => {
                                              hideModal();
                                              const success =
                                                deleteHistorySnapshot(
                                                  entry.uuid,
                                                  realIndex
                                                );
                                              if (success) {
                                                const updated = getEntryHistory(
                                                  entry.uuid
                                                );
                                                setHistorySnapshots(updated);
                                                setExpandedSnapshot(null);
                                                Haptics.notificationAsync(
                                                  Haptics
                                                    .NotificationFeedbackType
                                                    .Success
                                                );
                                              } else {
                                                showErrorModal(
                                                  "Error",
                                                  "Failed to delete snapshot."
                                                );
                                              }
                                            },
                                          },
                                        ],
                                      });
                                    }}
                                    style={({ pressed }) => [
                                      styles.historyActionBtn,
                                      styles.historyDeleteBtn,
                                      pressed && { opacity: 0.7 },
                                    ]}
                                  >
                                    <Ionicons
                                      name="trash-outline"
                                      size={14}
                                      color={colors.statusError}
                                    />
                                    <Text style={styles.historyDeleteBtnText}>
                                      Delete
                                    </Text>
                                  </Pressable>
                                </View>
                              </Animated.View>
                            );
                          })()}
                      </View>
                    );
                  })
              )}
            </Animated.View>
          )}
        </CyberCard>

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

      {/* Reusable Action Modal */}
      <ActionModal
        visible={modalConfig.visible}
        onClose={hideModal}
        title={modalConfig.title}
        description={modalConfig.description}
        icon={modalConfig.icon}
        iconColor={modalConfig.iconColor}
        options={modalConfig.options}
        buttons={modalConfig.buttons}
      />
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.backgroundPrimary,
    },

    // Header
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSage,
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
      color: colors.textPrimary,
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
      backgroundColor: colors.surfaceCard,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: colors.borderSage,
      padding: Spacing.xxl,
      marginBottom: Spacing.lg,
      ...Shadows.card,
    },
    titleIconContainer: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accentMintDim,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.md,
    },
    entryTitle: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.heading,
      color: colors.textPrimary,
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
      backgroundColor: colors.accentMintDim,
      borderRadius: Radii.full,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
    },
    tagText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.micro,
      color: colors.accentMint,
    },

    // Fields Card
    fieldsCard: {
      backgroundColor: colors.surfaceCard,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: colors.borderSage,
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
      ...Shadows.card,
    },
    sectionTitle: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.bodySmall,
      color: colors.textMuted,
      marginBottom: Spacing.md,
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    historySectionTitle: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.bodySmall,
      color: colors.textMuted,
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
      color: colors.textMuted,
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
      color: colors.textPrimary,
    },
    fieldValueMono: {
      fontFamily: Fonts.mono.regular,
      letterSpacing: 1,
    },
    fieldValueMasked: {
      color: colors.textDisabled,
      letterSpacing: 3,
    },

    // Meta Card
    metaCard: {
      backgroundColor: colors.surfaceCard,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: colors.borderSage,
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
      color: colors.textMuted,
    },
    metaValue: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textSecondary,
    },
    metaDivider: {
      height: 1,
      backgroundColor: colors.borderSage,
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
      color: colors.textMuted,
    },
    backLink: {
      marginTop: Spacing.md,
      padding: Spacing.sm,
    },
    backLinkText: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.body,
      color: colors.accentMint,
    },

    // Expiry badge
    expiryBadgeRow: {
      marginTop: Spacing.xs,
    },
    expiryBadge: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.statusWarningDim,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 4,
      borderRadius: Radii.sm,
      gap: Spacing.xs,
    },
    expiryBadgeExpired: {
      backgroundColor: colors.statusErrorDim,
    },
    expiryBadgeText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.statusWarning,
    },
    expiryBadgeTextExpired: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.caption,
      color: colors.statusError,
      letterSpacing: 0.5,
    },

    // Attachments
    attachmentRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSage,
    },
    attachmentInfo: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
    },
    attachmentName: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
    },
    attachmentSize: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      marginTop: 2,
    },
    attachmentExportBtn: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },

    // OTP Card
    otpCard: {
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
    },
    otpHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: Spacing.md,
    },
    otpInfo: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
    },
    otpIssuer: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.body,
      color: colors.textPrimary,
    },
    otpLabel: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
    },
    otpCopyBtn: {
      minWidth: 36,
      minHeight: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: Radii.sm,
      backgroundColor: colors.accentMintDim,
    },
    otpCodeContainer: {
      alignItems: "center",
      justifyContent: "center",
      marginVertical: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    otpCode: {
      fontFamily: Fonts.mono.regular,
      fontSize: 32,
      color: colors.accentMint,
      letterSpacing: 2,
    },
    otpProgressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    otpProgressBarBg: {
      flex: 1,
      height: 4,
      backgroundColor: colors.borderSage,
      borderRadius: Radii.full,
      overflow: "hidden",
    },
    otpProgressBarFill: {
      height: "100%",
      backgroundColor: colors.accentMint,
      borderRadius: Radii.full,
    },
    otpCountdownText: {
      fontFamily: Fonts.mono.regular,
      fontSize: FontSizes.caption,
      color: colors.accentMint,
      minWidth: 24,
      textAlign: "right",
    },

    // Entry History
    historyToggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    historyBadgeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
    },
    historyEmpty: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: Spacing.xxl,
      gap: Spacing.sm,
    },
    historyEmptyText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textDisabled,
    },
    historyItem: {
      marginTop: Spacing.sm,
      borderWidth: 1,
      borderColor: colors.borderSage,
      borderRadius: Radii.md,
      overflow: "hidden",
    },
    historyItemHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
      backgroundColor: colors.surfaceElevated,
    },
    historyItemHeaderExpanded: {
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSage,
    },
    historyItemInfo: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
      marginRight: Spacing.sm,
    },
    historyItemTitle: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
    },
    historyItemDate: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      marginTop: 2,
    },
    historyPreview: {
      padding: Spacing.md,
      backgroundColor: colors.surfaceCard,
    },
    historyEmptyFieldsText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      textAlign: "center",
      paddingVertical: Spacing.md,
      fontStyle: "italic",
    },
    historyFieldRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: Spacing.xxs,
    },
    historyFieldLabel: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    historyFieldValue: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textSecondary,
      flex: 1,
      textAlign: "right",
      marginLeft: Spacing.md,
    },
    historyFieldMono: {
      fontFamily: Fonts.mono.regular,
      letterSpacing: 2,
    },
    historyActions: {
      flexDirection: "row",
      gap: Spacing.sm,
      marginTop: Spacing.sm,
      paddingTop: Spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.borderSage,
    },
    historyActionBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      borderRadius: Radii.md,
      minHeight: 36,
    },
    historyRestoreBtn: {
      backgroundColor: colors.accentMint,
      ...Shadows.glow,
    },
    historyRestoreBtnText: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.caption,
      color: colors.backgroundPrimary,
    },
    historyDeleteBtn: {
      backgroundColor: colors.statusErrorDim,
      borderWidth: 1,
      borderColor: colors.statusError,
    },
    historyDeleteBtnText: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.statusError,
    },
  });
