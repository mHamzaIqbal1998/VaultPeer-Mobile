import React from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  useThemeColors,
  Fonts,
  FontSizes,
  Spacing,
  Radii,
} from "../constants/theme";
import { useWebRTCStore, PeerInfo } from "../stores/useWebRTCStore";
import { useSignalingStore } from "../stores/useSignalingStore";
import { useSyncStore } from "../stores/useSyncStore";
import { syncEngine } from "../services/sync/syncEngine";
import { useClipboard } from "../hooks/useClipboard";
import { webRTCManager } from "../services/webrtc/webRTCManager";

interface PeerListDrawerProps {
  visible: boolean;
  onClose: () => void;
}

export function PeerListDrawer({ visible, onClose }: PeerListDrawerProps) {
  const colors = useThemeColors();
  const peersMap = useWebRTCStore((state) => state.peers);
  const { clientId, roomId } = useSignalingStore();
  const syncQueue = useSyncStore((state) => state.syncQueue);
  const { copyToClipboard } = useClipboard();

  const peersList = Object.values(peersMap);

  const handleCopyId = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    copyToClipboard(id);
  };

  const handleDisconnectPeer = (peerId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    webRTCManager.cleanupPeer(peerId);
  };

  const handleRetrySync = (
    peerId: string,
    filename: string,
    type: "pull" | "push"
  ) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    syncEngine.retrySync(peerId, filename, type);
  };

  const getStatusColor = (peer: PeerInfo) => {
    if (peer.dataChannelState === "open") {
      return colors.statusSuccess;
    }
    if (
      peer.connectionState === "connecting" ||
      peer.dataChannelState === "connecting"
    ) {
      return colors.statusWarning;
    }
    if (
      peer.connectionState === "failed" ||
      peer.connectionState === "disconnected"
    ) {
      return colors.statusError;
    }
    return colors.textDisabled;
  };

  const getStatusLabel = (peer: PeerInfo) => {
    if (peer.dataChannelState === "open") {
      return "Connected & Ready";
    }
    if (peer.connectionState === "connecting") {
      return "Connecting P2P...";
    }
    if (peer.dataChannelState === "connecting") {
      return "Opening Data Channel...";
    }
    if (peer.connectionState === "failed") {
      return "Connection Failed";
    }
    if (peer.connectionState === "disconnected") {
      return "Disconnected";
    }
    return peer.connectionState || "Unknown State";
  };

  const renderPeerItem = ({ item }: { item: PeerInfo }) => {
    const statusColor = getStatusColor(item);
    const shortId =
      item.peerId.length > 12
        ? `${item.peerId.slice(0, 8)}...${item.peerId.slice(-4)}`
        : item.peerId;

    return (
      <View
        style={[
          styles.peerCard,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.borderSage,
          },
        ]}
      >
        <View style={styles.peerHeader}>
          <View style={styles.peerIdContainer}>
            <Text
              style={[
                styles.peerIdText,
                { color: colors.textPrimary, fontFamily: Fonts.mono.regular },
              ]}
            >
              {shortId}
            </Text>
            <Pressable
              onPress={() => handleCopyId(item.peerId)}
              style={styles.copyIconButton}
              hitSlop={8}
            >
              <Ionicons
                name="copy-outline"
                size={16}
                color={colors.accentMint}
              />
            </Pressable>
          </View>
          <Text
            style={[
              styles.roleBadge,
              { color: colors.textMuted, borderColor: colors.borderSage },
            ]}
          >
            {item.isOfferer ? "Offerer" : "Answerer"}
          </Text>
        </View>

        <View style={styles.peerFooter}>
          <View style={styles.statusRow}>
            <View
              style={[styles.statusDot, { backgroundColor: statusColor }]}
            />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>
              {getStatusLabel(item)}
            </Text>
          </View>

          <Pressable
            onPress={() => handleDisconnectPeer(item.peerId)}
            style={[
              styles.disconnectButton,
              { borderColor: colors.statusError },
            ]}
            hitSlop={6}
          >
            <Text
              style={[
                styles.disconnectButtonText,
                { color: colors.statusError },
              ]}
            >
              Disconnect
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.overlayPress} onPress={onClose} />

        <View
          style={[
            styles.drawerContainer,
            {
              backgroundColor: colors.surfaceCard,
              borderColor: colors.borderSage,
            },
          ]}
        >
          {/* Handle bar */}
          <View
            style={[styles.handleBar, { backgroundColor: colors.borderSage }]}
          />

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              Peer Sync Network
            </Text>
            <Pressable
              onPress={onClose}
              style={[
                styles.closeButton,
                { backgroundColor: colors.surfaceElevated },
              ]}
              hitSlop={8}
            >
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>

          {/* Client identity details */}
          <View
            style={[
              styles.identityCard,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.borderSage,
              },
            ]}
          >
            <View style={styles.identityRow}>
              <Text style={[styles.identityLabel, { color: colors.textMuted }]}>
                Room ID:
              </Text>
              <View style={styles.identityValueContainer}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.identityValue,
                    {
                      color: colors.textSecondary,
                      fontFamily: Fonts.mono.regular,
                    },
                  ]}
                >
                  {roomId || "Not joined"}
                </Text>
                {roomId ? (
                  <Pressable
                    onPress={() => handleCopyId(roomId)}
                    hitSlop={8}
                    style={styles.copyInlineButton}
                  >
                    <Ionicons
                      name="copy-outline"
                      size={14}
                      color={colors.accentMint}
                    />
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={styles.identityRow}>
              <Text style={[styles.identityLabel, { color: colors.textMuted }]}>
                My Peer ID:
              </Text>
              <View style={styles.identityValueContainer}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.identityValue,
                    {
                      color: colors.textSecondary,
                      fontFamily: Fonts.mono.regular,
                    },
                  ]}
                >
                  {clientId || "Not generated"}
                </Text>
                {clientId ? (
                  <Pressable
                    onPress={() => handleCopyId(clientId)}
                    hitSlop={8}
                    style={styles.copyInlineButton}
                  >
                    <Ionicons
                      name="copy-outline"
                      size={14}
                      color={colors.accentMint}
                    />
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>

          {/* Sync Queue Section */}
          {syncQueue.length > 0 ? (
            <View style={styles.queueContainer}>
              <Text
                style={[
                  styles.listHeader,
                  {
                    color: colors.textMuted,
                    paddingHorizontal: 0,
                    marginBottom: Spacing.sm,
                  },
                ]}
              >
                PENDING & FAILED SYNCS ({syncQueue.length})
              </Text>
              {syncQueue.map((item) => {
                const shortPeer =
                  item.peerId.length > 12
                    ? `${item.peerId.slice(0, 8)}...${item.peerId.slice(-4)}`
                    : item.peerId;

                const isSyncing = item.status === "syncing";
                const isFailed = item.status === "failed";

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.queueCard,
                      {
                        backgroundColor: colors.surfaceElevated,
                        borderColor: isFailed
                          ? colors.statusError
                          : colors.borderSage,
                      },
                    ]}
                  >
                    <View style={styles.queueCardLeft}>
                      <View
                        style={[
                          styles.typeBadge,
                          {
                            backgroundColor:
                              item.type === "push"
                                ? colors.accentMintDim
                                : `${colors.statusWarning}1A`,
                            borderColor:
                              item.type === "push"
                                ? colors.accentMint
                                : colors.statusWarning,
                          },
                        ]}
                      >
                        <Ionicons
                          name={
                            item.type === "push"
                              ? "arrow-up-outline"
                              : "arrow-down-outline"
                          }
                          size={12}
                          color={
                            item.type === "push"
                              ? colors.accentMint
                              : colors.statusWarning
                          }
                        />
                        <Text
                          style={[
                            styles.typeBadgeText,
                            {
                              color:
                                item.type === "push"
                                  ? colors.accentMint
                                  : colors.statusWarning,
                            },
                          ]}
                        >
                          {item.type.toUpperCase()}
                        </Text>
                      </View>

                      <View style={styles.queueCardInfo}>
                        <Text
                          style={[
                            styles.queueFilename,
                            { color: colors.textPrimary },
                          ]}
                          numberOfLines={1}
                        >
                          {item.filename}
                        </Text>
                        <Text
                          style={[
                            styles.queuePeerText,
                            { color: colors.textMuted },
                          ]}
                        >
                          Peer: {shortPeer}
                        </Text>
                        {isFailed && item.error ? (
                          <Text
                            style={[
                              styles.queueErrorText,
                              { color: colors.statusError },
                            ]}
                            numberOfLines={1}
                          >
                            Error: {item.error}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.queueCardRight}>
                      {isSyncing ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.accentMint}
                        />
                      ) : (
                        <Pressable
                          onPress={() =>
                            handleRetrySync(
                              item.peerId,
                              item.filename,
                              item.type
                            )
                          }
                          style={[
                            styles.syncButton,
                            {
                              backgroundColor: colors.accentMintDim,
                              borderColor: colors.accentMint,
                            },
                          ]}
                          hitSlop={8}
                        >
                          <Ionicons
                            name="sync-outline"
                            size={12}
                            color={colors.accentMint}
                          />
                          <Text
                            style={[
                              styles.syncButtonText,
                              { color: colors.accentMint },
                            ]}
                          >
                            Sync
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          <Text style={[styles.listHeader, { color: colors.textMuted }]}>
            CONNECTED PEERS ({peersList.length})
          </Text>

          <FlatList
            data={peersList}
            keyExtractor={(item) => item.peerId}
            renderItem={renderPeerItem}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons
                  name="git-network-outline"
                  size={48}
                  color={colors.borderSage}
                  style={styles.emptyIcon}
                />
                <Text
                  style={[styles.emptyText, { color: colors.textSecondary }]}
                >
                  No Active Peer Connections
                </Text>
                <Text
                  style={[styles.emptySubtext, { color: colors.textMuted }]}
                >
                  Discovery is automatic for devices connected to the same
                  signaling room.
                </Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  overlayPress: {
    ...StyleSheet.absoluteFillObject,
  },
  drawerContainer: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    borderTopWidth: 1,
    paddingTop: Spacing.sm,
    paddingBottom: Platform.OS === "ios" ? 34 : Spacing.xl,
    maxHeight: "80%",
    minHeight: "45%",
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSizes.heading,
    fontFamily: Fonts.heading.semiBold,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  identityCard: {
    marginHorizontal: Spacing.xl,
    padding: Spacing.md,
    borderRadius: Radii.md,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  identityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: Spacing.xs,
  },
  identityLabel: {
    fontSize: FontSizes.caption,
    fontFamily: Fonts.heading.medium,
    width: 80,
  },
  identityValueContainer: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  identityValue: {
    fontSize: FontSizes.caption,
    maxWidth: "80%",
    textAlign: "right",
  },
  copyInlineButton: {
    paddingLeft: Spacing.sm,
  },
  listHeader: {
    fontSize: FontSizes.micro,
    fontFamily: Fonts.heading.semiBold,
    letterSpacing: 1,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  listContent: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  peerCard: {
    padding: Spacing.md,
    borderRadius: Radii.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  peerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  peerIdContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  peerIdText: {
    fontSize: FontSizes.bodySmall,
  },
  copyIconButton: {
    paddingHorizontal: Spacing.sm,
  },
  roleBadge: {
    fontSize: FontSizes.micro,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  peerFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    width: Spacing.sm,
    height: Spacing.sm,
    borderRadius: Spacing.xs,
    marginRight: Spacing.sm,
  },
  statusText: {
    fontSize: FontSizes.caption,
  },
  disconnectButton: {
    borderWidth: 1,
    borderRadius: Radii.sm,
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
  },
  disconnectButtonText: {
    fontSize: FontSizes.caption,
    fontFamily: Fonts.heading.medium,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.huge,
  },
  emptyIcon: {
    marginBottom: Spacing.md,
  },
  emptyText: {
    fontSize: FontSizes.body,
    fontFamily: Fonts.heading.medium,
    marginBottom: Spacing.xs,
  },
  emptySubtext: {
    fontSize: FontSizes.caption,
    textAlign: "center",
    paddingHorizontal: Spacing.xl,
  },
  queueContainer: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  queueCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: Radii.md,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  queueCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Spacing.md,
  },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 9,
    fontFamily: Fonts.heading.semiBold,
  },
  queueCardInfo: {
    flex: 1,
  },
  queueFilename: {
    fontSize: FontSizes.bodySmall,
    fontFamily: Fonts.heading.medium,
  },
  queuePeerText: {
    fontSize: FontSizes.caption,
    fontFamily: Fonts.mono.regular,
    marginTop: 2,
  },
  queueErrorText: {
    fontSize: FontSizes.micro,
    fontFamily: Fonts.body.regular,
    marginTop: 2,
  },
  queueCardRight: {
    marginLeft: Spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  syncButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: Radii.sm,
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
  },
  syncButtonText: {
    fontSize: FontSizes.caption,
    fontFamily: Fonts.heading.medium,
  },
});
