/**
 * Entry Edit Screen — Create or update a password entry.
 */

import React, { useState, useCallback } from "react";
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
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
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

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  multiline,
  iconName,
  mono,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  iconName: React.ComponentProps<typeof Ionicons>["name"];
  mono?: boolean;
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
      </View>
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

  const [title, setTitle] = useState(existing?.title ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState(existing?.password ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const handleSave = useCallback(() => {
    if (!title.trim()) {
      Alert.alert("Missing Title", "Please enter a title for this entry.");
      return;
    }
    if (isNew) {
      const parentUuid = groupId;
      if (!parentUuid) {
        Alert.alert("Error", "No parent group specified.");
        return;
      }
      const entry = createEntry(parentUuid, {
        title: title.trim(),
        username,
        password,
        url,
        notes,
      });
      if (entry) {
        logAccess(entry.uuid, entry.title, "created");
        router.back();
      }
    } else if (entryId) {
      const entry = updateEntry(entryId, {
        title: title.trim(),
        username,
        password,
        url,
        notes,
      });
      if (entry) {
        logAccess(entry.uuid, entry.title, "updated");
        router.back();
      }
    }
  }, [
    isNew,
    title,
    username,
    password,
    url,
    notes,
    groupId,
    entryId,
    createEntry,
    updateEntry,
    logAccess,
    router,
  ]);

  const handleDiscard = useCallback(() => {
    const hasChanges = isNew
      ? title || username || password || url || notes
      : title !== existing?.title ||
        username !== existing?.username ||
        password !== existing?.password ||
        url !== existing?.url ||
        notes !== existing?.notes;

    if (hasChanges) {
      Alert.alert("Discard Changes?", "You have unsaved changes.", [
        { text: "Keep Editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  }, [isNew, title, username, password, url, notes, existing, router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={handleDiscard}
          style={styles.backButton}
          hitSlop={8}
        >
          <Ionicons name="close" size={24} color={Colors.textMuted} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {isNew ? "New Entry" : "Edit Entry"}
        </Text>
        <Pressable onPress={handleSave} style={styles.saveButton} hitSlop={8}>
          <Text style={styles.saveButtonText}>Save</Text>
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
          <Animated.View
            entering={FadeInDown.duration(300)}
            style={styles.card}
          >
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
            />
            <FormField
              label="URL"
              value={url}
              onChangeText={setUrl}
              placeholder="https://example.com"
              iconName="globe-outline"
            />
            <FormField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Additional notes..."
              iconName="document-text-outline"
              multiline
            />
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
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
});
