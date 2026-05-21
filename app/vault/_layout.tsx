import { Stack } from "expo-router";
import { Colors } from "@/src/constants/theme";

export default function VaultLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.backgroundPrimary },
        animation: "slide_from_right",
      }}
    />
  );
}
