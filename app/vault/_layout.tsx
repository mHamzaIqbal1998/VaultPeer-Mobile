import { Tabs, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColors, Fonts } from "@/src/constants/theme";
import { useVaultStore } from "@/src/stores/useVaultStore";
import { useFilePicker } from "@/src/context/FilePickerContext";

export default function VaultLayout() {
  const {
    _db: db,
    isDirty,
    autoSave,
    markClean,
    setIsSaving,
    vaultRevision,
  } = useVaultStore();
  const router = useRouter();
  const colors = useThemeColors();
  const { saveVault } = useFilePicker();

  const lastSavedRevision = useRef<number>(0);

  useEffect(() => {
    if (!db) {
      router.replace("/");
    }
  }, [db, router]);

  // Synchronize lastSavedRevision when vault becomes clean or changes
  useEffect(() => {
    if (!isDirty || !db) {
      lastSavedRevision.current = vaultRevision;
    }
  }, [isDirty, db, vaultRevision]);

  useEffect(() => {
    if (
      autoSave &&
      isDirty &&
      db &&
      vaultRevision > lastSavedRevision.current
    ) {
      const currentRevision = vaultRevision;

      const timer = setTimeout(async () => {
        // Double check that we are still dirty and the db hasn't been closed
        const currentStore = useVaultStore.getState();
        if (!currentStore._db || !currentStore.isDirty) return;

        try {
          setIsSaving(true);
          await saveVault(currentStore._db);

          lastSavedRevision.current = currentRevision;

          // If no new mutations happened during the save, mark it clean
          if (useVaultStore.getState().vaultRevision === currentRevision) {
            markClean();
          }
          console.log("[AutoSave] Vault automatically saved successfully.");
        } catch (e) {
          console.error("[AutoSave] Failed to auto-save vault:", e);
        } finally {
          setIsSaving(false);
        }
      }, 2000); // 2 seconds debounce

      return () => clearTimeout(timer);
    }
  }, [isDirty, vaultRevision, autoSave, db, saveVault, markClean, setIsSaving]);

  if (!db) {
    return null;
  }
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surfaceCard,
          borderTopColor:
            colors.theme === "light"
              ? "rgba(208, 219, 214, 0.6)"
              : "rgba(35, 46, 42, 0.5)", // thin glass border
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 10,
          paddingTop: 8,
          elevation: 8,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.15,
          shadowRadius: 6,
        },
        tabBarActiveTintColor: colors.accentMint,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontFamily: Fonts.body.regular,
          fontSize: 11,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Explorer",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "folder-open" : "folder-open-outline"}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="generator"
        options={{
          title: "Generator",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "key" : "key-outline"}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "settings" : "settings-outline"}
              size={22}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
