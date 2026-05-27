import { Tabs, useRouter } from "expo-router";
import { useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColors, Fonts } from "@/src/constants/theme";
import { useVaultStore } from "@/src/stores/useVaultStore";

export default function VaultLayout() {
  const { _db: db } = useVaultStore();
  const router = useRouter();
  const colors = useThemeColors();

  useEffect(() => {
    if (!db) {
      router.replace("/");
    }
  }, [db, router]);

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
