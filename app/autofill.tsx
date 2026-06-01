import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  useThemeColors,
  Fonts,
  FontSizes,
  Spacing,
  Radii,
} from "@/src/constants/theme";
import { useVaultStore } from "@/src/stores/useVaultStore";
import { useFilePicker } from "@/src/context/FilePickerContext";
import { CyberCard } from "@/src/components/CyberCard";
import {
  isBiometricEnabled,
  getStoredPassword,
} from "@/src/services/biometricService";
import { suggestEntries } from "@/src/services/autofillMatcher";
import * as AutofillBridge from "@/modules/vaultpeer-autofill";
import type { VaultEntry } from "@/src/types/kdbx";

function getFilenameFromUri(uri?: string | null): string {
  if (!uri) return "No active file path";
  try {
    const decoded = decodeURIComponent(uri);
    const parts = decoded.split(/[/\\]/);
    const lastPart = parts[parts.length - 1];
    if (lastPart.includes(":")) {
      const subParts = lastPart.split(":");
      return subParts[subParts.length - 1];
    }
    return lastPart || "vault.kdbx";
  } catch {
    return "vault.kdbx";
  }
}

function formatLastOpened(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Recent";
  }
}

export default function AutofillScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Search/intent parameters
  const params = useLocalSearchParams<{
    packageName?: string;
    webDomain?: string;
  }>();
  const [callerPackage, setCallerPackage] = useState(params.packageName || "");
  const [callerDomain, setCallerDomain] = useState(params.webDomain || "");

  const {
    fileUri,
    filename,
    loadVault,
    error: fsError,
    clearError,
    recentVaults,
    selectRecentVault,
    selectVaultFile,
  } = useFilePicker();
  const { openDatabase, entryIndex, _db: db } = useVaultStore();

  // Screen state
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [bioEnabled, setBioEnabled] = useState(false);
  const hasAutoTriggeredBioRef = useRef(false);

  const [hasUsernameField, setHasUsernameField] = useState(true);
  const [hasPasswordField, setHasPasswordField] = useState(true);
  const [hasFocusedField, setHasFocusedField] = useState(false);
  const [selectedEntryForMenu, setSelectedEntryForMenu] =
    useState<VaultEntry | null>(null);

  const isUnlocked = db !== null;

  // Retrieve details directly from the native module if launching directly/deep-linked
  useEffect(() => {
    async function fetchRequestDetails() {
      const activeReq = await AutofillBridge.getActiveRequest();
      if (activeReq) {
        if (activeReq.packageName) setCallerPackage(activeReq.packageName);
        if (activeReq.webDomain) setCallerDomain(activeReq.webDomain);
        setHasUsernameField(activeReq.hasUsernameField ?? true);
        setHasPasswordField(activeReq.hasPasswordField ?? true);
        setHasFocusedField(activeReq.hasFocusedField ?? false);
      }
    }
    fetchRequestDetails();
  }, []);

  // Check biometric availability
  useEffect(() => {
    async function checkBio() {
      if (fileUri) {
        const enabled = await isBiometricEnabled(fileUri);
        setBioEnabled(enabled);
      }
    }
    checkBio();
  }, [fileUri]);

  const handleBiometricUnlock = useCallback(async () => {
    if (!fileUri) return;
    setLocalError(null);
    setIsLoading(true);
    // Add small delay to let visual loading state trigger
    setTimeout(async () => {
      try {
        const storedPassword = await getStoredPassword(fileUri);
        if (!storedPassword) {
          setIsLoading(false);
          return;
        }
        const { db: decryptedDb, fileUri: currentUri } =
          await loadVault(storedPassword);
        setPassword("");
        openDatabase(decryptedDb, currentUri);
      } catch (e: any) {
        setLocalError(e?.message || "Biometric authentication failed.");
      } finally {
        setIsLoading(false);
      }
    }, 50);
  }, [loadVault, openDatabase, fileUri]);

  // Auto trigger biometric unlock on mount if enabled
  useEffect(() => {
    if (
      fileUri &&
      bioEnabled &&
      !isUnlocked &&
      !hasAutoTriggeredBioRef.current
    ) {
      hasAutoTriggeredBioRef.current = true;
      setTimeout(() => {
        handleBiometricUnlock();
      }, 500);
    }
  }, [fileUri, bioEnabled, isUnlocked, handleBiometricUnlock]);

  const handlePasswordUnlock = async () => {
    if (!password) {
      setLocalError("Please enter the master password.");
      return;
    }
    setLocalError(null);
    setIsLoading(true);
    setTimeout(async () => {
      try {
        const { db: decryptedDb, fileUri: currentUri } =
          await loadVault(password);
        setPassword("");
        openDatabase(decryptedDb, currentUri);
      } catch (e: any) {
        setLocalError(e?.message || "Invalid master password.");
      } finally {
        setIsLoading(false);
      }
    }, 50);
  };

  const handleSelectEntry = async (entry: VaultEntry) => {
    // If only focused field is detected (neither username nor password fields explicitly identified)
    if (!hasUsernameField && !hasPasswordField && hasFocusedField) {
      setSelectedEntryForMenu(entry);
      return;
    }

    setIsLoading(true);
    try {
      const username = entry.username || "";
      const passwordVal = entry.password || "";
      const success = await AutofillBridge.submitCredentials(
        username,
        passwordVal
      );
      if (!success) {
        setLocalError("Autofill submission failed.");
        setIsLoading(false);
      }
    } catch (e: any) {
      setLocalError("Failed to submit credentials: " + (e?.message || ""));
      setIsLoading(false);
    }
  };

  const handleSelectiveFill = async (field: "username" | "password") => {
    if (!selectedEntryForMenu) return;
    const entry = selectedEntryForMenu;
    setSelectedEntryForMenu(null);
    setIsLoading(true);
    try {
      const username = field === "username" ? entry.username || "" : null;
      const passwordVal = field === "password" ? entry.password || "" : null;
      const success = await AutofillBridge.submitCredentials(
        username,
        passwordVal
      );
      if (!success) {
        setLocalError("Autofill selective fill failed.");
        setIsLoading(false);
      }
    } catch (e: any) {
      setLocalError("Failed to perform selective fill: " + (e?.message || ""));
      setIsLoading(false);
    }
  };

  const handleCancel = useCallback(async () => {
    try {
      await AutofillBridge.cancelRequest();
    } catch (e) {
      console.warn("Failed to cancel autofill request natively:", e);
      // Fallback: router back
      router.back();
    }
  }, [router]);

  // Native back handler to cancel request properly
  useEffect(() => {
    const onBackPress = () => {
      handleCancel();
      return true;
    };
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      onBackPress
    );
    return () => subscription.remove();
  }, [handleCancel]);

  // Suggested vs Search Entries
  const suggestedEntries = useMemo(() => {
    if (!isUnlocked) return [];
    return suggestEntries(
      Array.from(entryIndex.values()),
      callerPackage,
      callerDomain
    );
  }, [isUnlocked, entryIndex, callerPackage, callerDomain]);

  const searchedEntries = useMemo(() => {
    if (!isUnlocked) return [];
    const all = Array.from(entryIndex.values());
    if (!searchQuery.trim()) {
      // If we have suggested entries, return nothing to avoid duplicates, else return all
      return suggestedEntries.length > 0 ? [] : all;
    }
    const query = searchQuery.toLowerCase().trim();
    return all.filter((entry) => {
      return (
        entry.title.toLowerCase().includes(query) ||
        entry.username.toLowerCase().includes(query) ||
        entry.url.toLowerCase().includes(query) ||
        (entry.notes && entry.notes.toLowerCase().includes(query)) ||
        entry.tags.some((t) => t.toLowerCase().includes(query))
      );
    });
  }, [isUnlocked, entryIndex, searchQuery, suggestedEntries]);

  // Clear picker context errors on unmount
  useEffect(() => {
    return () => {
      clearError();
    };
  }, [clearError]);

  const activeError = localError || fsError;

  // 1. Render Loading Screen
  const renderLoading = () => (
    <View style={styles.centerContainer}>
      <ActivityIndicator size="large" color={colors.accentMint} />
      <Text style={styles.loadingText}>Processing...</Text>
    </View>
  );

  // 1.5. Render Vault Selection Screen (when fileUri is null/not active)
  const renderVaultSelector = () => (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerContainer}>
        <View style={styles.shieldContainer}>
          <Ionicons
            name="shield-checkmark"
            size={42}
            color={colors.accentMint}
          />
        </View>
        <Text style={styles.title}>Select Vault</Text>
        <Text style={styles.subtitle}>Choose or open a vault to autofill</Text>
      </View>

      {activeError && (
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle" size={20} color={colors.statusError} />
          <Text style={styles.errorText}>{activeError}</Text>
        </View>
      )}

      {recentVaults && recentVaults.length > 0 ? (
        <View style={styles.recentSection}>
          <Text style={styles.recentTitle}>Recent Vaults</Text>
          {recentVaults.map((vault) => (
            <Pressable
              key={vault.uri}
              onPress={async () => {
                try {
                  setLocalError(null);
                  await selectRecentVault(vault.uri);
                } catch (e: any) {
                  setLocalError(e.message || "Failed to select vault.");
                }
              }}
              disabled={isLoading}
              style={({ pressed }) => [
                styles.recentVaultItem,
                pressed && styles.recentVaultItemPressed,
              ]}
            >
              <Ionicons
                name="wallet-outline"
                size={16}
                color={colors.accentMint}
                style={styles.recentVaultIcon}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.recentVaultName} numberOfLines={1}>
                  {vault.name}
                </Text>
                <Text style={styles.recentVaultPath} numberOfLines={1}>
                  Last opened: {formatLastOpened(vault.lastOpened)}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textDisabled}
              />
            </Pressable>
          ))}
        </View>
      ) : (
        <CyberCard
          style={[styles.card, { padding: Spacing.xl, alignItems: "center" }]}
        >
          <Ionicons name="folder-open" size={48} color={colors.textDisabled} />
          <Text
            style={[
              styles.errorTitle,
              { marginTop: Spacing.md, textAlign: "center" },
            ]}
          >
            No Vaults Found
          </Text>
          <Text
            style={[
              styles.errorSubtitle,
              { marginBottom: Spacing.md, paddingHorizontal: 0 },
            ]}
          >
            Please select a KeePass vault file from your device to begin.
          </Text>
        </CyberCard>
      )}

      <Pressable
        onPress={async () => {
          try {
            setLocalError(null);
            setIsLoading(true);
            await selectVaultFile();
          } catch (e: any) {
            setLocalError(e.message || "Failed to select file.");
          } finally {
            setIsLoading(false);
          }
        }}
        disabled={isLoading}
        style={({ pressed }) => [
          styles.selectFileBtn,
          { marginTop: Spacing.lg },
          pressed && styles.buttonPressed,
          isLoading && styles.buttonDisabled,
        ]}
      >
        <Ionicons
          name="folder-open-outline"
          size={16}
          color={colors.accentMint}
        />
        <Text style={styles.selectFileText}>Open Vault File...</Text>
      </Pressable>

      <Pressable onPress={handleCancel} style={styles.cancelLink}>
        <Text style={styles.cancelLinkText}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );

  // 2. Render Unlock Screen
  const renderUnlock = () => (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerContainer}>
        <View style={styles.shieldContainer}>
          <Ionicons
            name="shield-checkmark"
            size={42}
            color={colors.accentMint}
          />
        </View>
        <Text style={styles.title}>Vault Locked</Text>
        <Text style={styles.subtitle}>
          Unlock VaultPeer to Autofill credentials
        </Text>
      </View>

      {activeError && (
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle" size={20} color={colors.statusError} />
          <Text style={styles.errorText}>{activeError}</Text>
        </View>
      )}

      <CyberCard style={styles.card}>
        <Text style={styles.filenameLabel}>
          File:{" "}
          <Text style={styles.filename}>
            {filename || getFilenameFromUri(fileUri)}
          </Text>
        </Text>

        <View style={styles.inputContainer}>
          <Ionicons
            name="key"
            size={18}
            color={colors.textMuted}
            style={styles.inputIcon}
          />
          <TextInput
            style={styles.input}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            placeholder="Master Password"
            placeholderTextColor={colors.textDisabled}
            editable={!isLoading}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            onPress={() => setShowPassword(!showPassword)}
            style={styles.eyeButton}
            hitSlop={8}
          >
            <Ionicons
              name={showPassword ? "eye-off" : "eye"}
              size={20}
              color={colors.textMuted}
            />
          </Pressable>
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            onPress={handlePasswordUnlock}
            disabled={isLoading}
            style={({ pressed }) => [
              styles.button,
              { flex: 1 },
              pressed && styles.buttonPressed,
              isLoading && styles.buttonDisabled,
            ]}
          >
            {isLoading ? (
              <ActivityIndicator
                size="small"
                color={colors.backgroundPrimary}
              />
            ) : (
              <>
                <Ionicons
                  name="lock-open"
                  size={16}
                  color={colors.backgroundPrimary}
                  style={styles.buttonIcon}
                />
                <Text style={styles.buttonText}>Unlock Vault</Text>
              </>
            )}
          </Pressable>

          {bioEnabled && (
            <Pressable
              onPress={handleBiometricUnlock}
              disabled={isLoading}
              style={({ pressed }) => [
                styles.bioButton,
                pressed && styles.bioButtonPressed,
                isLoading && styles.bioButtonDisabled,
              ]}
            >
              <Ionicons
                name="finger-print"
                size={24}
                color={colors.accentMint}
              />
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={async () => {
            try {
              setLocalError(null);
              setIsLoading(true);
              await selectVaultFile();
            } catch (e: any) {
              setLocalError(e.message || "Failed to select file.");
            } finally {
              setIsLoading(false);
            }
          }}
          disabled={isLoading}
          style={({ pressed }) => [
            styles.selectFileBtn,
            pressed && styles.buttonPressed,
            isLoading && styles.buttonDisabled,
          ]}
        >
          <Ionicons
            name="folder-open-outline"
            size={16}
            color={colors.accentMint}
          />
          <Text style={styles.selectFileText}>Open Different Vault...</Text>
        </Pressable>
      </CyberCard>

      {recentVaults && recentVaults.length > 1 && (
        <View style={styles.recentSection}>
          <Text style={styles.recentTitle}>Recent Vaults</Text>
          {recentVaults.map((vault) => {
            if (vault.uri === fileUri) return null;
            return (
              <Pressable
                key={vault.uri}
                onPress={async () => {
                  try {
                    setLocalError(null);
                    await selectRecentVault(vault.uri);
                  } catch (e: any) {
                    setLocalError(e.message || "Failed to switch vault.");
                  }
                }}
                disabled={isLoading}
                style={({ pressed }) => [
                  styles.recentVaultItem,
                  pressed && styles.recentVaultItemPressed,
                ]}
              >
                <Ionicons
                  name="wallet-outline"
                  size={16}
                  color={colors.accentMint}
                  style={styles.recentVaultIcon}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.recentVaultName} numberOfLines={1}>
                    {vault.name}
                  </Text>
                  <Text style={styles.recentVaultPath} numberOfLines={1}>
                    Last opened: {formatLastOpened(vault.lastOpened)}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.textDisabled}
                />
              </Pressable>
            );
          })}
        </View>
      )}

      <Pressable onPress={handleCancel} style={styles.cancelLink}>
        <Text style={styles.cancelLinkText}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );

  // 3. Render Credentials Selection Screen
  const renderSelection = () => {
    const hasSuggestions = suggestedEntries.length > 0;
    const hasSearched = searchedEntries.length > 0;

    return (
      <View style={styles.selectionContainer}>
        {/* App bar / requesting app details */}
        <View style={styles.requestBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.requestTitle}>Autofill Request</Text>
            <Text style={styles.requestSubtitle} numberOfLines={1}>
              For: {callerDomain || callerPackage || "Android App"}
            </Text>
          </View>
          <Pressable
            onPress={handleCancel}
            style={styles.cancelIconBtn}
            hitSlop={12}
          >
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Search Input */}
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={18}
            color={colors.textMuted}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search all entries..."
            placeholderTextColor={colors.textDisabled}
          />
          {searchQuery ? (
            <Pressable
              onPress={() => setSearchQuery("")}
              style={styles.searchClear}
              hitSlop={8}
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textMuted}
              />
            </Pressable>
          ) : null}
        </View>

        {activeError && (
          <View style={[styles.errorCard, { marginHorizontal: Spacing.lg }]}>
            <Ionicons
              name="alert-circle"
              size={18}
              color={colors.statusError}
            />
            <Text style={styles.errorText}>{activeError}</Text>
          </View>
        )}

        <ScrollView
          style={styles.entriesScroll}
          contentContainerStyle={styles.entriesContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Suggested Section */}
          {hasSuggestions && !searchQuery.trim() && (
            <View>
              <Text style={styles.sectionHeader}>Suggested Entries</Text>
              {suggestedEntries.map((entry, index) => (
                <Animated.View
                  key={entry.uuid}
                  entering={FadeInDown.delay(index * 50)}
                >
                  <CyberCard
                    onPress={() => handleSelectEntry(entry)}
                    style={styles.entryCard}
                  >
                    <View style={styles.entryRow}>
                      <View style={styles.iconCircle}>
                        <Ionicons
                          name="key-outline"
                          size={20}
                          color={colors.accentMint}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.entryTitle}>{entry.title}</Text>
                        <Text style={styles.entryUsername}>
                          {entry.username || "(No username)"}
                        </Text>
                        {entry.url ? (
                          <Text style={styles.entryUrl} numberOfLines={1}>
                            {entry.url}
                          </Text>
                        ) : null}
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.textDisabled}
                      />
                    </View>
                  </CyberCard>
                </Animated.View>
              ))}
            </View>
          )}

          {/* Searched / All Section */}
          {(!hasSuggestions || searchQuery.trim()) && (
            <View>
              <Text style={styles.sectionHeader}>
                {searchQuery.trim() ? "Search Results" : "All Entries"}
              </Text>
              {hasSearched ? (
                searchedEntries.map((entry, index) => (
                  <Animated.View
                    key={entry.uuid}
                    entering={FadeInDown.delay(index * 20).duration(200)}
                  >
                    <CyberCard
                      onPress={() => handleSelectEntry(entry)}
                      style={styles.entryCard}
                    >
                      <View style={styles.entryRow}>
                        <View
                          style={[
                            styles.iconCircle,
                            { backgroundColor: colors.surfaceElevated },
                          ]}
                        >
                          <Ionicons
                            name="logo-android"
                            size={18}
                            color={colors.textMuted}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.entryTitle}>{entry.title}</Text>
                          <Text style={styles.entryUsername}>
                            {entry.username || "(No username)"}
                          </Text>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={colors.textDisabled}
                        />
                      </View>
                    </CyberCard>
                  </Animated.View>
                ))
              ) : (
                <View style={styles.emptyContainer}>
                  <Ionicons
                    name="search-outline"
                    size={36}
                    color={colors.textDisabled}
                  />
                  <Text style={styles.emptyText}>No entries found</Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    );
  };

  // 4. Main Router / Switcher
  if (isLoading && !isUnlocked) {
    return (
      <SafeAreaView style={styles.container}>{renderLoading()}</SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {!fileUri
          ? renderVaultSelector()
          : !isUnlocked
            ? renderUnlock()
            : renderSelection()}

        {isUnlocked && (
          <Modal
            visible={selectedEntryForMenu !== null}
            transparent
            animationType="slide"
            onRequestClose={() => setSelectedEntryForMenu(null)}
          >
            <Pressable
              style={styles.modalOverlay}
              onPress={() => setSelectedEntryForMenu(null)}
            >
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Choose field to fill</Text>
                  <Pressable
                    onPress={() => setSelectedEntryForMenu(null)}
                    style={styles.modalCloseBtn}
                    hitSlop={8}
                  >
                    <Ionicons name="close" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>

                <Pressable
                  onPress={() => handleSelectiveFill("username")}
                  style={({ pressed }) => [
                    styles.modalOptionBtn,
                    pressed && styles.modalOptionBtnPressed,
                  ]}
                >
                  <View style={styles.modalOptionIcon}>
                    <Ionicons
                      name="person-outline"
                      size={18}
                      color={colors.accentMint}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalOptionText}>Fill Username</Text>
                    <Text style={styles.modalOptionSubtext}>
                      {selectedEntryForMenu?.username || "(Empty)"}
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => handleSelectiveFill("password")}
                  style={({ pressed }) => [
                    styles.modalOptionBtn,
                    pressed && styles.modalOptionBtnPressed,
                  ]}
                >
                  <View style={styles.modalOptionIcon}>
                    <Ionicons
                      name="key-outline"
                      size={18}
                      color={colors.accentMint}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalOptionText}>Fill Password</Text>
                    <Text style={styles.modalOptionSubtext}>••••••••</Text>
                  </View>
                </Pressable>

                {/* The 'Fill Both Fields' option was removed because the modal is only shown when username and password fields are both undetected, meaning we only have a single focused field. */}
              </View>
            </Pressable>
          </Modal>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: any) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.backgroundPrimary,
    },
    keyboardView: {
      flex: 1,
    },
    centerContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: Spacing.xxl,
    },
    loadingText: {
      marginTop: Spacing.md,
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.body,
      color: colors.textSecondary,
    },
    scrollContent: {
      flexGrow: 1,
      padding: Spacing.xl,
      justifyContent: "center",
    },
    headerContainer: {
      alignItems: "center",
      marginBottom: Spacing.xxl,
    },
    shieldContainer: {
      width: 72,
      height: 72,
      borderRadius: Radii.full,
      backgroundColor: colors.accentMintDim,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.md,
      borderWidth: 1,
      borderColor: colors.borderSage,
    },
    title: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.title - 4,
      color: colors.textPrimary,
      textAlign: "center",
    },
    subtitle: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textMuted,
      textAlign: "center",
      marginTop: Spacing.xs,
    },
    errorCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.statusErrorDim,
      borderRadius: Radii.md,
      padding: Spacing.md,
      marginBottom: Spacing.lg,
      borderWidth: 1,
      borderColor: colors.statusError,
      gap: Spacing.sm,
    },
    errorText: {
      flex: 1,
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.statusError,
    },
    card: {
      padding: Spacing.xl,
      marginBottom: Spacing.xl,
    },
    filenameLabel: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textMuted,
      marginBottom: Spacing.lg,
    },
    filename: {
      fontFamily: Fonts.heading.medium,
      color: colors.textPrimary,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: colors.borderSage,
      height: 48,
      paddingHorizontal: Spacing.md,
      marginBottom: Spacing.lg,
    },
    inputIcon: {
      marginRight: Spacing.sm,
    },
    input: {
      flex: 1,
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.body,
      color: colors.textPrimary,
      height: "100%",
    },
    eyeButton: {
      padding: Spacing.xs,
    },
    buttonRow: {
      flexDirection: "row",
      gap: Spacing.md,
    },
    button: {
      height: 48,
      borderRadius: Radii.md,
      backgroundColor: colors.accentMint,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.sm,
    },
    buttonPressed: {
      opacity: 0.8,
    },
    buttonDisabled: {
      backgroundColor: colors.borderSage,
      opacity: 0.5,
    },
    buttonIcon: {
      marginRight: 2,
    },
    buttonText: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.bodySmall,
      color: colors.backgroundPrimary,
    },
    bioButton: {
      width: 48,
      height: 48,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: colors.accentMint,
      backgroundColor: colors.accentMintDim,
      alignItems: "center",
      justifyContent: "center",
    },
    bioButtonPressed: {
      opacity: 0.7,
    },
    bioButtonDisabled: {
      borderColor: colors.borderSage,
      backgroundColor: colors.transparent,
      opacity: 0.5,
    },
    cancelLink: {
      alignSelf: "center",
      padding: Spacing.md,
    },
    cancelLinkText: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.bodySmall,
      color: colors.textMuted,
    },
    selectionContainer: {
      flex: 1,
    },
    requestBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSage,
    },
    requestTitle: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    requestSubtitle: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.subheading,
      color: colors.textPrimary,
      marginTop: 2,
    },
    cancelIconBtn: {
      padding: Spacing.xs,
    },
    searchContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceCard,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: colors.borderSage,
      height: 44,
      margin: Spacing.lg,
      paddingHorizontal: Spacing.md,
    },
    searchIcon: {
      marginRight: Spacing.sm,
    },
    searchInput: {
      flex: 1,
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
      height: "100%",
    },
    searchClear: {
      padding: Spacing.xs,
    },
    entriesScroll: {
      flex: 1,
    },
    entriesContent: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.xxl,
      gap: Spacing.md,
    },
    sectionHeader: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.accentMint,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: Spacing.sm,
      marginTop: Spacing.sm,
    },
    entryCard: {
      marginBottom: Spacing.sm,
      padding: Spacing.md,
    },
    entryRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.md,
    },
    iconCircle: {
      width: 40,
      height: 40,
      borderRadius: Radii.md,
      backgroundColor: colors.accentMintDim,
      alignItems: "center",
      justifyContent: "center",
    },
    entryTitle: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
    },
    entryUsername: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      marginTop: 1,
    },
    entryUrl: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption - 1,
      color: colors.textDisabled,
      marginTop: 1,
    },
    emptyContainer: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: Spacing.huge,
      gap: Spacing.sm,
    },
    emptyText: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textDisabled,
    },
    errorTitle: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.heading,
      color: colors.textPrimary,
      marginTop: Spacing.lg,
    },
    errorSubtitle: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.bodySmall,
      color: colors.textMuted,
      textAlign: "center",
      marginTop: Spacing.sm,
      paddingHorizontal: Spacing.xl,
    },
    backButton: {
      marginTop: Spacing.xxl,
      height: 40,
      paddingHorizontal: Spacing.xl,
      borderRadius: Radii.md,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.borderSage,
      alignItems: "center",
      justifyContent: "center",
    },
    backButtonText: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
    },
    selectFileBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginTop: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.borderSage,
      backgroundColor: "transparent",
    },
    selectFileText: {
      fontFamily: Fonts.heading.medium,
      fontSize: FontSizes.caption,
      color: colors.accentMint,
      marginLeft: Spacing.xs,
    },
    recentSection: {
      marginTop: Spacing.xl,
      paddingHorizontal: Spacing.xs,
    },
    recentTitle: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: Spacing.sm,
    },
    recentVaultItem: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceCard,
      padding: Spacing.md,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: colors.borderSage,
      marginBottom: Spacing.sm,
      gap: Spacing.sm,
    },
    recentVaultItemPressed: {
      borderColor: colors.borderSageActive,
      backgroundColor: colors.surfaceElevated,
    },
    recentVaultIcon: {
      marginRight: Spacing.xs,
    },
    recentVaultName: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
    },
    recentVaultPath: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption - 1,
      color: colors.textDisabled,
      marginTop: 2,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.6)",
      justifyContent: "flex-end",
    },
    modalContent: {
      backgroundColor: colors.backgroundPrimary,
      borderTopLeftRadius: Radii.lg,
      borderTopRightRadius: Radii.lg,
      borderWidth: 1,
      borderColor: colors.borderSage,
      padding: Spacing.xl,
      paddingBottom: Spacing.xxl + 16,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: Spacing.lg,
    },
    modalTitle: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.subheading,
      color: colors.textPrimary,
    },
    modalCloseBtn: {
      padding: Spacing.xs,
    },
    modalOptionBtn: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.borderSage,
      borderRadius: Radii.md,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      gap: Spacing.md,
    },
    modalOptionBtnPressed: {
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.borderSageActive,
    },
    modalOptionIcon: {
      width: 36,
      height: 36,
      borderRadius: Radii.sm,
      backgroundColor: colors.accentMintDim,
      alignItems: "center",
      justifyContent: "center",
    },
    modalOptionText: {
      fontFamily: Fonts.heading.semiBold,
      fontSize: FontSizes.bodySmall,
      color: colors.textPrimary,
    },
    modalOptionSubtext: {
      fontFamily: Fonts.body.regular,
      fontSize: FontSizes.caption,
      color: colors.textMuted,
      marginTop: 2,
    },
  });
}
