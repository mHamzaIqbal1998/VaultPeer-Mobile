import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Colors,
  Fonts,
  FontSizes,
  Spacing,
  Radii,
  TouchTarget,
  Shadows,
} from "@/src/constants/theme";
import { useVaultStore } from "@/src/stores/useVaultStore";
import { CyberCard } from "@/src/components/CyberCard";
import * as DocumentPicker from "expo-document-picker";
import { readFile } from "vaultpeer-file-system";
import type { VaultAttachment } from "@/src/types/kdbx";
import * as Haptics from "expo-haptics";
import {
  generatePassword,
  estimatePasswordStrength,
} from "@/src/services/passwordGenerator";
import { CameraView, useCameraPermissions } from "expo-camera";

interface CustomFieldState {
  id: string;
  key: string;
  value: string;
  isSecure: boolean;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  multiline,
  iconName,
  mono,
  rightElement,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  iconName: React.ComponentProps<typeof Ionicons>["name"];
  mono?: boolean;
  rightElement?: React.ReactNode;
}) {
  const [showSecret, setShowSecret] = useState(false);
  return (
    <View style={styles.formField}>
      <View style={styles.formLabelRow}>
        <Ionicons name={iconName} size={14} color={Colors.textMuted} />
        <Text style={styles.formLabel}>{label}</Text>
      </View>
      <View style={styles.formInputContainer}>
        <TextInput
          style={[
            styles.formInput,
            multiline && styles.formInputMultiline,
            mono && styles.formInputMono,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.textDisabled}
          secureTextEntry={secureTextEntry && !showSecret}
          multiline={multiline}
          numberOfLines={multiline ? 4 : 1}
          textAlignVertical={multiline ? "top" : "center"}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {secureTextEntry && (
          <Pressable
            onPress={() => setShowSecret(!showSecret)}
            style={styles.eyeBtn}
            hitSlop={8}
          >
            <Ionicons
              name={showSecret ? "eye-off-outline" : "eye-outline"}
              size={18}
              color={Colors.textMuted}
            />
          </Pressable>
        )}
        {rightElement}
      </View>
    </View>
  );
}

function QrScannerView({
  onScan,
  onClose,
}: {
  onScan: (data: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);

  if (!permission) {
    return (
      <View style={styles.scannerOverlayContainer}>
        <ActivityIndicator size="large" color={Colors.accentMint} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.scannerOverlayContainer}>
        <Ionicons name="camera-outline" size={48} color={Colors.textMuted} />
        <Text style={styles.scannerPermissionText}>
          We need your permission to show the camera
        </Text>
        <Pressable style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Grant Permission</Text>
        </Pressable>
        <Pressable style={styles.scannerCloseBtnTop} onPress={onClose}>
          <Ionicons name="close" size={24} color={Colors.textPrimary} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.scannerContainer}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
        onBarcodeScanned={({ data }) => onScan(data)}
        enableTorch={torch}
      >
        {/* Semi-transparent overlays */}
        <View style={styles.scannerOverlayTop} />
        <View style={styles.scannerOverlayMiddleRow}>
          <View style={styles.scannerOverlaySide} />
          <View style={styles.scannerTargetFrame}>
            {/* Glowing corners */}
            <View style={[styles.corner, styles.topLeftCorner]} />
            <View style={[styles.corner, styles.topRightCorner]} />
            <View style={[styles.corner, styles.bottomLeftCorner]} />
            <View style={[styles.corner, styles.bottomRightCorner]} />
          </View>
          <View style={styles.scannerOverlaySide} />
        </View>
        <View style={styles.scannerOverlayBottom} />

        {/* Floating Controls */}
        <SafeAreaView
          style={styles.scannerControlsContainer}
          edges={["top", "bottom"]}
        >
          <View style={styles.scannerHeaderRow}>
            <Pressable style={styles.scannerControlCircle} onPress={onClose}>
              <Ionicons name="close" size={20} color={Colors.textPrimary} />
            </Pressable>
            <Text style={styles.scannerTitle}>Scan QR Code</Text>
            <Pressable
              style={styles.scannerControlCircle}
              onPress={() => setTorch(!torch)}
            >
              <Ionicons
                name={torch ? "flash" : "flash-off"}
                size={20}
                color={torch ? Colors.accentMint : Colors.textPrimary}
              />
            </Pressable>
          </View>

          <View style={styles.scannerFooter}>
            <Text style={styles.scannerHelpText}>
              Align the QR code inside the frame to scan
            </Text>
          </View>
        </SafeAreaView>
      </CameraView>
    </View>
  );
}

export default function EntryEditScreen() {
  const { entryId, groupId } = useLocalSearchParams<{
    entryId?: string;
    groupId?: string;
  }>();
  const router = useRouter();
  const { getEntry, createEntry, updateEntry, logAccess } = useVaultStore();

  const isNew = !entryId;
  const existing = entryId ? getEntry(entryId) : null;

  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState(existing?.password ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [otp, setOtp] = useState(existing?.otp ?? "");
  const [showScanner, setShowScanner] = useState(false);

  const [showGenerator, setShowGenerator] = useState(false);
  const [genLength, setGenLength] = useState(16);
  const [genUppercase, setGenUppercase] = useState(true);
  const [genLowercase, setGenLowercase] = useState(true);
  const [genNumbers, setGenNumbers] = useState(true);
  const [genSymbols, setGenSymbols] = useState(true);
  const [genExcludeLookalikes, setGenExcludeLookalikes] = useState(false);

  const handleGenerateInline = useCallback(() => {
    if (!genUppercase && !genLowercase && !genNumbers && !genSymbols) {
      return;
    }
    const pwd = generatePassword({
      length: genLength,
      useUppercase: genUppercase,
      useLowercase: genLowercase,
      useNumbers: genNumbers,
      useSymbols: genSymbols,
      excludeLookalikes: genExcludeLookalikes,
    });
    setPassword(pwd);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [
    genLength,
    genUppercase,
    genLowercase,
    genNumbers,
    genSymbols,
    genExcludeLookalikes,
  ]);

  // Auto-regenerate password when options change, but only if generator is active
  useEffect(() => {
    if (showGenerator) {
      handleGenerateInline();
    }
  }, [
    showGenerator,
    genLength,
    genUppercase,
    genLowercase,
    genNumbers,
    genSymbols,
    genExcludeLookalikes,
    handleGenerateInline,
  ]);

  const [customFields, setCustomFields] = useState<CustomFieldState[]>(() => {
    if (!existing || !existing.fields) return [];
    return Object.entries(existing.fields).map(([key, value]) => ({
      id: Math.random().toString(),
      key,
      value,
      isSecure: existing.secureFields?.includes(key) ?? false,
    }));
  });

  const [attachments, setAttachments] = useState<VaultAttachment[]>(() => {
    return existing?.attachments ? [...existing.attachments] : [];
  });

  const [expires, setExpires] = useState(existing?.expires ?? false);
  const [expiryPreset, setExpiryPreset] = useState<string>(() => {
    if (!existing?.expires || !existing.expiryTime) return "1 Month";
    return "Custom";
  });
  const [customExpiryText, setCustomExpiryText] = useState<string>(() => {
    if (existing?.expiryTime) {
      const d = new Date(existing.expiryTime);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const [tags, setTags] = useState<string[]>(
    existing?.tags ? [...existing.tags] : []
  );
  const [newTagInput, setNewTagInput] = useState("");

  const handleAddAttachment = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (res.canceled || !res.assets || res.assets.length === 0) {
        return;
      }

      const asset = res.assets[0];
      const base64Data = await readFile(asset.uri);

      const newAttachment: VaultAttachment = {
        id: asset.name,
        name: asset.name,
        size: asset.size ?? 0,
        data: base64Data,
      };

      setAttachments((prev) => {
        const filtered = prev.filter((a) => a.name !== asset.name);
        return [...filtered, newAttachment];
      });
    } catch (err: any) {
      console.error(err);
      Alert.alert("Error", err.message || "Failed to import attachment.");
    }
  };

  const handleSave = useCallback(async () => {
    if (saving) return;
    if (!title.trim()) {
      Alert.alert("Missing Title", "Please enter a title for this entry.");
      return;
    }

    const fieldsMap: Record<string, string> = {};
    const secureFieldsList: string[] = [];
    for (const f of customFields) {
      const keyTrimmed = f.key.trim();
      if (keyTrimmed) {
        fieldsMap[keyTrimmed] = f.value;
        if (f.isSecure) {
          secureFieldsList.push(keyTrimmed);
        }
      }
    }

    let finalExpiryTime: string | undefined = undefined;
    if (expires) {
      if (expiryPreset === "1 Week") {
        finalExpiryTime = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString();
      } else if (expiryPreset === "1 Month") {
        finalExpiryTime = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        ).toISOString();
      } else if (expiryPreset === "3 Months") {
        finalExpiryTime = new Date(
          Date.now() + 90 * 24 * 60 * 60 * 1000
        ).toISOString();
      } else if (expiryPreset === "6 Months") {
        finalExpiryTime = new Date(
          Date.now() + 180 * 24 * 60 * 60 * 1000
        ).toISOString();
      } else if (expiryPreset === "1 Year") {
        finalExpiryTime = new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000
        ).toISOString();
      } else if (expiryPreset === "Custom") {
        const parsed = Date.parse(customExpiryText.trim().replace(" ", "T"));
        if (isNaN(parsed)) {
          Alert.alert(
            "Invalid Date",
            "Please enter a valid expiry date in YYYY-MM-DD HH:MM format."
          );
          return;
        }
        finalExpiryTime = new Date(parsed).toISOString();
      }
    }

    const payload = {
      title: title.trim(),
      username,
      password,
      url,
      notes,
      otp: otp.trim(),
      fields: fieldsMap,
      secureFields: secureFieldsList,
      attachments,
      expires,
      expiryTime: finalExpiryTime,
      tags,
    };

    setSaving(true);
    setTimeout(async () => {
      try {
        if (isNew) {
          const parentUuid = groupId;
          if (!parentUuid) {
            Alert.alert("Error", "No parent group specified.");
            setSaving(false);
            return;
          }
          const entry = await createEntry(parentUuid, payload);
          if (entry) {
            logAccess(entry.uuid, entry.title, "created");
            router.back();
          }
        } else if (entryId) {
          const entry = await updateEntry(entryId, payload);
          if (entry) {
            logAccess(entry.uuid, entry.title, "updated");
            router.back();
          }
        }
      } catch (err: any) {
        console.error(err);
        Alert.alert("Save Failed", err.message || "Failed to save the entry.");
      } finally {
        setSaving(false);
      }
    }, 50);
  }, [
    saving,
    isNew,
    title,
    username,
    password,
    url,
    notes,
    otp,
    customFields,
    expires,
    expiryPreset,
    customExpiryText,
    attachments,
    tags,
    groupId,
    entryId,
    createEntry,
    updateEntry,
    logAccess,
    router,
  ]);

  const handleDiscard = useCallback(() => {
    const hasChanges = isNew
      ? title ||
        username ||
        password ||
        url ||
        notes ||
        otp ||
        customFields.length > 0 ||
        attachments.length > 0 ||
        expires ||
        tags.length > 0
      : title !== existing?.title ||
        username !== existing?.username ||
        password !== existing?.password ||
        url !== existing?.url ||
        notes !== existing?.notes ||
        otp !== (existing?.otp ?? "") ||
        JSON.stringify(
          customFields.map((f) => ({
            key: f.key,
            val: f.value,
            sec: f.isSecure,
          }))
        ) !==
          JSON.stringify(
            Object.entries(existing?.fields || {}).map(([key, value]) => ({
              key,
              val: value,
              sec: existing?.secureFields?.includes(key) ?? false,
            }))
          ) ||
        JSON.stringify(attachments.map((a) => a.name)) !==
          JSON.stringify((existing?.attachments || []).map((a) => a.name)) ||
        expires !== existing?.expires ||
        JSON.stringify(tags) !== JSON.stringify(existing?.tags || []);

    if (hasChanges) {
      Alert.alert("Discard Changes?", "You have unsaved changes.", [
        { text: "Keep Editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  }, [
    isNew,
    title,
    username,
    password,
    url,
    notes,
    otp,
    customFields,
    attachments,
    expires,
    tags,
    existing,
    router,
  ]);

  const strength = estimatePasswordStrength(password);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={handleDiscard}
          disabled={saving}
          style={[styles.backButton, saving && { opacity: 0.5 }]}
          hitSlop={8}
        >
          <Ionicons
            name="close"
            size={24}
            color={saving ? Colors.textDisabled : Colors.textMuted}
          />
        </Pressable>
        <Text style={styles.headerTitle}>
          {isNew ? "New Entry" : "Edit Entry"}
        </Text>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveButton, saving && { opacity: 0.6 }]}
          hitSlop={8}
        >
          {saving ? (
            <ActivityIndicator size="small" color={Colors.backgroundPrimary} />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(300)}>
            <CyberCard style={{ padding: Spacing.xl }}>
              <FormField
                label="Title"
                value={title}
                onChangeText={setTitle}
                placeholder="Entry title"
                iconName="text-outline"
              />
              <FormField
                label="Username"
                value={username}
                onChangeText={setUsername}
                placeholder="Username or email"
                iconName="person-outline"
              />
              <FormField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                iconName="key-outline"
                secureTextEntry
                mono
                rightElement={
                  <Pressable
                    onPress={() => {
                      if (!showGenerator) {
                        setShowGenerator(true);
                        if (!password) {
                          const newPwd = generatePassword({
                            length: genLength,
                            useUppercase: genUppercase,
                            useLowercase: genLowercase,
                            useNumbers: genNumbers,
                            useSymbols: genSymbols,
                            excludeLookalikes: genExcludeLookalikes,
                          });
                          setPassword(newPwd);
                          Haptics.impactAsync(
                            Haptics.ImpactFeedbackStyle.Medium
                          );
                        }
                      } else {
                        setShowGenerator(false);
                      }
                    }}
                    style={styles.eyeBtn}
                    hitSlop={8}
                    accessibilityLabel="Toggle inline password generator"
                  >
                    <Ionicons
                      name="sparkles-outline"
                      size={18}
                      color={
                        showGenerator ? Colors.accentMint : Colors.textMuted
                      }
                    />
                  </Pressable>
                }
              />

              {password.length > 0 && (
                <Animated.View
                  entering={FadeInDown.duration(200)}
                  style={styles.strengthContainer}
                >
                  <View style={styles.strengthHeader}>
                    <Text style={styles.strengthLabel}>Password Strength</Text>
                    <Text
                      style={[styles.strengthValue, { color: strength.color }]}
                    >
                      {strength.label} ({Math.round(strength.entropy)} bits)
                    </Text>
                  </View>
                  <View style={styles.strengthBarContainer}>
                    {[0, 1, 2, 3].map((index) => {
                      const active = strength.score >= index + 1;
                      return (
                        <View
                          key={index}
                          style={[
                            styles.strengthBar,
                            active
                              ? { backgroundColor: strength.color }
                              : { backgroundColor: Colors.surfaceElevated },
                          ]}
                        />
                      );
                    })}
                  </View>
                </Animated.View>
              )}

              {showGenerator && (
                <Animated.View
                  entering={FadeInDown.duration(250)}
                  exiting={FadeOutUp.duration(200)}
                  style={styles.generatorPanel}
                >
                  <View style={styles.generatorHeaderRow}>
                    <Text style={styles.generatorTitle}>Inline Generator</Text>
                    <Pressable
                      onPress={handleGenerateInline}
                      style={styles.regenerateBtn}
                      hitSlop={8}
                    >
                      <Ionicons
                        name="refresh"
                        size={14}
                        color={Colors.accentMint}
                      />
                      <Text style={styles.regenerateBtnText}>Regenerate</Text>
                    </Pressable>
                  </View>

                  <View style={styles.generatorLengthRow}>
                    <Text style={styles.generatorLengthLabel}>
                      Length:{" "}
                      <Text style={styles.generatorLengthVal}>{genLength}</Text>
                    </Text>
                    <View style={styles.genLengthControls}>
                      <Pressable
                        onPress={() => {
                          setGenLength((prev) => Math.max(8, prev - 1));
                          Haptics.impactAsync(
                            Haptics.ImpactFeedbackStyle.Light
                          );
                        }}
                        style={styles.genLengthBtn}
                        hitSlop={4}
                      >
                        <Ionicons
                          name="remove"
                          size={14}
                          color={Colors.textPrimary}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setGenLength((prev) => Math.min(64, prev + 1));
                          Haptics.impactAsync(
                            Haptics.ImpactFeedbackStyle.Light
                          );
                        }}
                        style={styles.genLengthBtn}
                        hitSlop={4}
                      >
                        <Ionicons
                          name="add"
                          size={14}
                          color={Colors.textPrimary}
                        />
                      </Pressable>
                    </View>
                  </View>

                  {/* Character Toggle Pills */}
                  <View style={styles.genPillsGrid}>
                    <Pressable
                      onPress={() => {
                        setGenUppercase(!genUppercase);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      style={[
                        styles.genPill,
                        genUppercase && styles.genPillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.genPillText,
                          genUppercase && styles.genPillTextActive,
                        ]}
                      >
                        A-Z
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setGenLowercase(!genLowercase);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      style={[
                        styles.genPill,
                        genLowercase && styles.genPillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.genPillText,
                          genLowercase && styles.genPillTextActive,
                        ]}
                      >
                        a-z
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setGenNumbers(!genNumbers);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      style={[
                        styles.genPill,
                        genNumbers && styles.genPillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.genPillText,
                          genNumbers && styles.genPillTextActive,
                        ]}
                      >
                        0-9
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setGenSymbols(!genSymbols);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      style={[
                        styles.genPill,
                        genSymbols && styles.genPillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.genPillText,
                          genSymbols && styles.genPillTextActive,
                        ]}
                      >
                        !@#
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setGenExcludeLookalikes(!genExcludeLookalikes);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      style={[
                        styles.genPill,
                        genExcludeLookalikes && styles.genPillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.genPillText,
                          genExcludeLookalikes && styles.genPillTextActive,
                        ]}
                      >
                        No Lookalikes
                      </Text>
                    </Pressable>
                  </View>
                </Animated.View>
              )}
              <FormField
                label="URL"
                value={url}
                onChangeText={setUrl}
                placeholder="https://example.com"
                iconName="globe-outline"
              />
              <FormField
                label="OTP Secret or URI"
                value={otp}
                onChangeText={setOtp}
                placeholder="otpauth://... or raw secret"
                iconName="shield-checkmark-outline"
                secureTextEntry
                mono
                rightElement={
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowScanner(true);
                    }}
                    style={styles.eyeBtn}
                    hitSlop={8}
                    accessibilityLabel="Scan QR Code"
                  >
                    <Ionicons
                      name="qr-code-outline"
                      size={18}
                      color={Colors.accentMint}
                    />
                  </Pressable>
                }
              />
              <FormField
                label="Notes"
                value={notes}
                onChangeText={setNotes}
                placeholder="Additional notes..."
                iconName="document-text-outline"
                multiline
              />
            </CyberCard>

            {/* ── Tags ── */}
            <CyberCard style={{ padding: Spacing.xl, marginTop: Spacing.lg }}>
              <Text style={styles.sectionTitle}>Tags</Text>
              <View style={styles.tagsContainer}>
                {tags.map((tag) => (
                  <View key={tag} style={styles.tagItem}>
                    <Text style={styles.tagText}>{tag}</Text>
                    <Pressable
                      onPress={() =>
                        setTags((prev) => prev.filter((t) => t !== tag))
                      }
                      style={styles.tagDeleteBtn}
                      hitSlop={8}
                    >
                      <Ionicons
                        name="close-circle"
                        size={14}
                        color={Colors.statusError}
                      />
                    </Pressable>
                  </View>
                ))}
              </View>
              <View style={styles.addTagRow}>
                <TextInput
                  style={styles.tagInput}
                  value={newTagInput}
                  onChangeText={setNewTagInput}
                  placeholder="New tag..."
                  placeholderTextColor={Colors.textDisabled}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  onPress={() => {
                    const trimmed = newTagInput.trim();
                    if (trimmed && !tags.includes(trimmed)) {
                      setTags((prev) => [...prev, trimmed]);
                      setNewTagInput("");
                    }
                  }}
                  style={styles.addTagBtn}
                >
                  <Ionicons
                    name="add"
                    size={20}
                    color={Colors.backgroundPrimary}
                  />
                </Pressable>
              </View>
            </CyberCard>

            {/* ── Custom Fields ── */}
            <CyberCard style={{ padding: Spacing.xl, marginTop: Spacing.lg }}>
              <Text style={styles.sectionTitle}>Custom Fields</Text>
              {customFields.map((field) => (
                <View key={field.id} style={styles.customFieldRow}>
                  <View style={styles.customFieldInputs}>
                    <TextInput
                      style={styles.customFieldKeyInput}
                      value={field.key}
                      onChangeText={(val) => {
                        setCustomFields((prev) =>
                          prev.map((f) =>
                            f.id === field.id ? { ...f, key: val } : f
                          )
                        );
                      }}
                      placeholder="Field Name"
                      placeholderTextColor={Colors.textDisabled}
                      autoCapitalize="none"
                    />
                    <TextInput
                      style={styles.customFieldValueInput}
                      value={field.value}
                      onChangeText={(val) => {
                        setCustomFields((prev) =>
                          prev.map((f) =>
                            f.id === field.id ? { ...f, value: val } : f
                          )
                        );
                      }}
                      placeholder="Field Value"
                      placeholderTextColor={Colors.textDisabled}
                      secureTextEntry={field.isSecure}
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={styles.customFieldActions}>
                    <Pressable
                      onPress={() => {
                        setCustomFields((prev) =>
                          prev.map((f) =>
                            f.id === field.id
                              ? { ...f, isSecure: !f.isSecure }
                              : f
                          )
                        );
                      }}
                      style={styles.customFieldActionBtn}
                      hitSlop={8}
                    >
                      <Ionicons
                        name={
                          field.isSecure ? "lock-closed" : "lock-open-outline"
                        }
                        size={18}
                        color={
                          field.isSecure ? Colors.accentMint : Colors.textMuted
                        }
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setCustomFields((prev) =>
                          prev.filter((f) => f.id !== field.id)
                        );
                      }}
                      style={styles.customFieldActionBtn}
                      hitSlop={8}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={18}
                        color={Colors.statusError}
                      />
                    </Pressable>
                  </View>
                </View>
              ))}
              <Pressable
                onPress={() => {
                  setCustomFields((prev) => [
                    ...prev,
                    {
                      id: Math.random().toString(),
                      key: "",
                      value: "",
                      isSecure: false,
                    },
                  ]);
                }}
                style={styles.addFieldBtn}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={16}
                  color={Colors.accentMint}
                />
                <Text style={styles.addFieldBtnText}>Add Custom Field</Text>
              </Pressable>
            </CyberCard>

            {/* ── Expiration ── */}
            <CyberCard style={{ padding: Spacing.xl, marginTop: Spacing.lg }}>
              <View style={styles.expiryHeaderRow}>
                <Text style={styles.sectionTitle}>Expiration</Text>
                <Pressable
                  onPress={() => setExpires(!expires)}
                  style={[styles.checkbox, expires && styles.checkboxChecked]}
                  hitSlop={8}
                >
                  {expires && (
                    <Ionicons
                      name="checkmark"
                      size={14}
                      color={Colors.backgroundPrimary}
                    />
                  )}
                </Pressable>
              </View>

              {expires && (
                <View>
                  <View style={styles.presetGrid}>
                    {[
                      "1 Week",
                      "1 Month",
                      "3 Months",
                      "6 Months",
                      "1 Year",
                      "Custom",
                    ].map((preset) => (
                      <Pressable
                        key={preset}
                        onPress={() => setExpiryPreset(preset)}
                        style={[
                          styles.presetBtn,
                          expiryPreset === preset && styles.presetBtnActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.presetBtnText,
                            expiryPreset === preset &&
                              styles.presetBtnTextActive,
                          ]}
                        >
                          {preset}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {expiryPreset === "Custom" && (
                    <View style={styles.customExpiryContainer}>
                      <Text style={styles.customExpiryLabel}>
                        Custom Expiry (YYYY-MM-DD HH:MM)
                      </Text>
                      <TextInput
                        style={styles.customExpiryInput}
                        value={customExpiryText}
                        onChangeText={setCustomExpiryText}
                        placeholder="e.g. 2026-12-31 23:59"
                        placeholderTextColor={Colors.textDisabled}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                  )}
                </View>
              )}
            </CyberCard>

            {/* ── Attachments ── */}
            <CyberCard
              style={{
                padding: Spacing.xl,
                marginTop: Spacing.lg,
                marginBottom: Spacing.xl,
              }}
            >
              <Text style={styles.sectionTitle}>Attachments</Text>
              {attachments.map((attachment) => (
                <View key={attachment.id} style={styles.attachmentEditRow}>
                  <View style={styles.attachmentEditInfo}>
                    <Ionicons
                      name="document-attach-outline"
                      size={18}
                      color={Colors.accentMint}
                    />
                    <View style={{ marginLeft: Spacing.sm, flex: 1 }}>
                      <Text style={styles.attachmentEditName} numberOfLines={1}>
                        {attachment.name}
                      </Text>
                      <Text style={styles.attachmentEditSize}>
                        {formatSize(attachment.size)}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => {
                      setAttachments((prev) =>
                        prev.filter((a) => a.id !== attachment.id)
                      );
                    }}
                    style={styles.attachmentDeleteBtn}
                    hitSlop={8}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={Colors.statusError}
                    />
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={handleAddAttachment}
                style={styles.addAttachmentBtn}
              >
                <Ionicons
                  name="cloud-upload-outline"
                  size={16}
                  color={Colors.accentMint}
                />
                <Text style={styles.addAttachmentBtnText}>Add Attachment</Text>
              </Pressable>
            </CyberCard>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {showScanner && (
        <View style={StyleSheet.absoluteFillObject}>
          <QrScannerView
            onScan={(data) => {
              if (data.startsWith("otpauth://")) {
                setOtp(data);
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success
                );
              } else {
                setOtp(data.trim());
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success
                );
              }
              setShowScanner(false);
            }}
            onClose={() => setShowScanner(false)}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.backgroundPrimary },
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
    textAlign: "center",
  },
  saveButton: {
    backgroundColor: Colors.accentMint,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    minHeight: 36,
    justifyContent: "center",
  },
  saveButtonText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.bodySmall,
    color: Colors.backgroundPrimary,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.huge,
  },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    padding: Spacing.xl,
    ...Shadows.card,
  },
  formField: { marginBottom: Spacing.xl },
  formLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  formLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  formInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    minHeight: TouchTarget.min,
  },
  formInput: {
    flex: 1,
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
    paddingVertical: Spacing.sm,
  },
  formInputMultiline: { minHeight: 100, paddingTop: Spacing.md },
  formInputMono: { fontFamily: Fonts.mono.regular, letterSpacing: 1 },
  eyeBtn: {
    padding: Spacing.xs,
    minWidth: 36,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
    marginBottom: Spacing.md,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  tagsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  tagItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.accentMintDim,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radii.full,
    gap: Spacing.xs,
  },
  tagText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.accentMint,
  },
  tagDeleteBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
  addTagRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  tagInput: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    color: Colors.textPrimary,
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    height: 40,
  },
  addTagBtn: {
    width: 40,
    height: 40,
    backgroundColor: Colors.accentMint,
    borderRadius: Radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  customFieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  customFieldInputs: {
    flex: 1,
    gap: Spacing.xs,
  },
  customFieldKeyInput: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    color: Colors.textPrimary,
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    height: 38,
  },
  customFieldValueInput: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    color: Colors.textPrimary,
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    height: 38,
  },
  customFieldActions: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  customFieldActionBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radii.sm,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSage,
  },
  addFieldBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Colors.accentMint,
    marginTop: Spacing.sm,
  },
  addFieldBtnText: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.accentMint,
  },
  expiryHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: Colors.borderSageActive,
    borderRadius: Radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: Colors.accentMint,
    borderColor: Colors.accentMint,
  },
  presetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  presetBtn: {
    width: "31%",
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    borderRadius: Radii.md,
    paddingVertical: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  presetBtnActive: {
    borderColor: Colors.accentMint,
    backgroundColor: Colors.accentMintDim,
  },
  presetBtnText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  presetBtnTextActive: {
    color: Colors.accentMint,
    fontFamily: Fonts.heading.medium,
    textAlign: "center",
  },
  customExpiryContainer: {
    marginTop: Spacing.sm,
  },
  customExpiryLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },
  customExpiryInput: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.textPrimary,
    fontFamily: Fonts.mono.regular,
    fontSize: FontSizes.bodySmall,
    minHeight: 44,
  },
  attachmentEditRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSage,
    marginBottom: Spacing.sm,
  },
  attachmentEditInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  attachmentEditName: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textPrimary,
  },
  attachmentEditSize: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  attachmentDeleteBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  addAttachmentBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Colors.accentMint,
    marginTop: Spacing.sm,
  },
  addAttachmentBtnText: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.accentMint,
  },
  strengthContainer: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceCard,
    padding: Spacing.md,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderSage,
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
  generatorPanel: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  generatorHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  generatorTitle: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  regenerateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.sm,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderSage,
  },
  regenerateBtnText: {
    fontFamily: Fonts.heading.medium,
    fontSize: FontSizes.caption,
    color: Colors.accentMint,
  },
  generatorLengthRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.borderSage,
  },
  generatorLengthLabel: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textMuted,
  },
  generatorLengthVal: {
    fontFamily: Fonts.heading.semiBold,
    color: Colors.textPrimary,
  },
  genLengthControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  genLengthBtn: {
    width: 32,
    height: 32,
    borderRadius: Radii.sm,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.borderSage,
  },
  genPillsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  genPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: Colors.borderSage,
    backgroundColor: Colors.surfaceElevated,
    minHeight: 32,
    justifyContent: "center",
  },
  genPillActive: {
    backgroundColor: Colors.accentMintDim,
    borderColor: Colors.accentMint,
  },
  genPillText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.caption,
    color: Colors.textMuted,
  },
  genPillTextActive: {
    fontFamily: Fonts.heading.medium,
    color: Colors.accentMint,
  },

  // Scanner Styles
  scannerContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  scannerOverlayContainer: {
    flex: 1,
    backgroundColor: Colors.backgroundPrimary,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  scannerPermissionText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.body,
    color: Colors.textSecondary,
    textAlign: "center",
    marginVertical: Spacing.lg,
  },
  permissionBtn: {
    backgroundColor: Colors.accentMint,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
  },
  permissionBtnText: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.bodySmall,
    color: Colors.backgroundPrimary,
  },
  scannerCloseBtnTop: {
    position: "absolute",
    top: 50,
    right: 20,
    padding: Spacing.sm,
  },
  scannerOverlayTop: {
    flex: 1.5,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  scannerOverlayMiddleRow: {
    flexDirection: "row",
    height: 250,
  },
  scannerOverlaySide: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  scannerOverlayBottom: {
    flex: 2,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  scannerTargetFrame: {
    width: 250,
    height: 250,
    borderWidth: 1,
    borderColor: "rgba(52, 211, 153, 0.3)",
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 20,
    height: 20,
    borderColor: Colors.accentMint,
  },
  topLeftCorner: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: Radii.sm,
  },
  topRightCorner: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: Radii.sm,
  },
  bottomLeftCorner: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: Radii.sm,
  },
  bottomRightCorner: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: Radii.sm,
  },
  scannerControlsContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "space-between",
  },
  scannerHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  scannerControlCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  scannerTitle: {
    fontFamily: Fonts.heading.semiBold,
    fontSize: FontSizes.body,
    color: Colors.textPrimary,
  },
  scannerFooter: {
    alignItems: "center",
    paddingBottom: Spacing.xxl,
  },
  scannerHelpText: {
    fontFamily: Fonts.body.regular,
    fontSize: FontSizes.bodySmall,
    color: Colors.textSecondary,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.full,
    overflow: "hidden",
  },
});
