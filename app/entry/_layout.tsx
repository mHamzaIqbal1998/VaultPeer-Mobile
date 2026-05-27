import { Stack } from "expo-router";
import { useThemeColors } from "@/src/constants/theme";

export default function EntryLayout() {
  const colors = useThemeColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.backgroundPrimary },
        animation: "slide_from_right",
      }}
    />
  );
}
