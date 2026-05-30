/**
 * Cyber-Sage Design System — Color Tokens & Typography
 *
 * A dark-mode-first aesthetic with tech-organic cyber feel.
 * High-fidelity surfaces, glowing indicators, glassmorphism boundaries.
 */

// ────────────────────────────────────────────
// Color Palette
// ────────────────────────────────────────────

import { Platform } from "react-native";
import { useVaultStore } from "../stores/useVaultStore";

export const DarkColors = {
  /** Near-black emerald slate — primary background */
  backgroundPrimary: "#0B0F0E",

  /** Dark emerald surface — card / sheet backgrounds */
  surfaceCard: "#141A18",

  /** Slightly elevated surface — for nested elements */
  surfaceElevated: "#1A2220",

  /** Muted sage border for cards / inputs */
  borderSage: "#232E2A",

  /** Active/hover border — slightly brighter sage */
  borderSageActive: "#2E3D37",

  /** Vibrant mint green — primary CTAs, active indicators */
  accentMint: "#34D399",

  /** Dimmed mint — for subtle active states */
  accentMintDim: "rgba(52, 211, 153, 0.15)",

  /** High-contrast mint-white — readable headings */
  textPrimary: "#ECFDF5",

  /** Standard white for body text over dark surfaces */
  textSecondary: "#D1FAE5",

  /** Soft slate gray — labels, captions, timestamps */
  textMuted: "#94A3B8",

  /** Dimmed text for disabled / placeholder states */
  textDisabled: "#64748B",

  /** Soft red — lock state / error alerts */
  statusError: "#EF4444",

  /** Error background tint */
  statusErrorDim: "rgba(239, 68, 68, 0.12)",

  /** Standard emerald — strength / integrity indicators */
  statusSuccess: "#10B981",

  /** Success background tint */
  statusSuccessDim: "rgba(16, 185, 129, 0.12)",

  /** Warning amber */
  statusWarning: "#F59E0B",

  /** Warning background tint */
  statusWarningDim: "rgba(245, 158, 11, 0.12)",

  /** Pure transparent */
  transparent: "transparent",

  /** Overlay for modals / sheets */
  overlay: "rgba(0, 0, 0, 0.6)",
} as const;

export const LightColors = {
  /** Crisp light sage/mint background */
  backgroundPrimary: "#F0F4F2",

  /** Clean white card surfaces */
  surfaceCard: "#FFFFFF",

  /** Slightly elevated surface — for nested elements */
  surfaceElevated: "#F8FAFB",

  /** Muted light sage border */
  borderSage: "#D0DBD6",

  /** Active/hover border — slightly brighter sage */
  borderSageActive: "#A8BFB5",

  /** Rich mint green for light mode readability */
  accentMint: "#059669",

  /** Dimmed mint — for subtle active states */
  accentMintDim: "rgba(5, 150, 105, 0.1)",

  /** Deep dark green-black for high contrast headings */
  textPrimary: "#061A13",

  /** Slate-800 for readable body text */
  textSecondary: "#1E293B",

  /** Slate-500 for labels, captions, timestamps */
  textMuted: "#64748B",

  /** Slate-400 for disabled / placeholder states */
  textDisabled: "#94A3B8",

  /** Readable red for error alerts */
  statusError: "#DC2626",

  /** Error background tint */
  statusErrorDim: "rgba(220, 38, 38, 0.08)",

  /** Standard green for strength / integrity indicators */
  statusSuccess: "#16A34A",

  /** Success background tint */
  statusSuccessDim: "rgba(22, 163, 74, 0.08)",

  /** Warning amber */
  statusWarning: "#D97706",

  /** Warning background tint */
  statusWarningDim: "rgba(217, 119, 6, 0.08)",

  /** Pure transparent */
  transparent: "transparent",

  /** Softer overlay for modals / sheets */
  overlay: "rgba(0, 0, 0, 0.4)",
} as const;

export const Colors = DarkColors;

export function useThemeColors() {
  const theme = useVaultStore((state) => state.theme);
  const colors = theme === "light" ? LightColors : DarkColors;
  return {
    ...colors,
    theme,
  };
}

// ────────────────────────────────────────────
// Typography
// ────────────────────────────────────────────

export const Fonts = {
  heading: {
    semiBold: "Inter-SemiBold",
    medium: "Inter-Medium",
  },
  body: {
    regular: "Inter-Regular",
    light: "Inter-Light",
  },
  mono: {
    regular: "SpaceMono-Regular",
  },
} as const;

export const FontSizes = {
  /** 28px — page titles */
  title: 28,
  /** 22px — section headings */
  heading: 22,
  /** 18px — sub-headings, card titles */
  subheading: 18,
  /** 16px — standard body text (minimum readable on mobile) */
  body: 16,
  /** 14px — secondary body, list items */
  bodySmall: 14,
  /** 12px — captions, labels, timestamps */
  caption: 12,
  /** 11px — micro labels */
  micro: 11,
} as const;

export const LineHeights = {
  title: 36,
  heading: 30,
  subheading: 26,
  body: 24,
  bodySmall: 20,
  caption: 16,
  micro: 14,
} as const;

// ────────────────────────────────────────────
// Spacing (4px scale)
// ────────────────────────────────────────────

export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

// ────────────────────────────────────────────
// Radii
// ────────────────────────────────────────────

export const Radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

// ────────────────────────────────────────────
// Shadows (iOS + Android elevation)
// ────────────────────────────────────────────

export const Shadows = {
  get card() {
    const theme = useVaultStore.getState().theme;
    const isLight = theme === "light";
    return {
      shadowColor: isLight ? "rgba(6, 26, 19, 0.08)" : "#000000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isLight ? 0.06 : 0.25,
      shadowRadius: isLight ? 12 : 6,
      elevation: isLight ? 2 : 4,
    };
  },
  get elevated() {
    const theme = useVaultStore.getState().theme;
    const isLight = theme === "light";
    return {
      shadowColor: isLight ? "rgba(6, 26, 19, 0.12)" : "#000000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: isLight ? 0.08 : 0.3,
      shadowRadius: isLight ? 16 : 10,
      elevation: isLight ? 4 : 8,
    };
  },
  get glow() {
    const theme = useVaultStore.getState().theme;
    const isLight = theme === "light";
    return {
      shadowColor: isLight ? "#059669" : "#34D399",
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: isLight ? 0.2 : 0.4,
      shadowRadius: 12,
      ...Platform.select({
        ios: { elevation: 4 },
        android: { elevation: 0 },
        default: { elevation: 0 },
      }),
    };
  },
};

// ────────────────────────────────────────────
// Animation Timings
// ────────────────────────────────────────────

export const Animation = {
  /** Quick micro-interactions (press feedback) */
  fast: 150,
  /** Standard transitions (page, modal) */
  medium: 250,
  /** Slow, deliberate animations (onboarding) */
  slow: 400,
} as const;

// ────────────────────────────────────────────
// Touch Targets (WCAG / Apple HIG minimum)
// ────────────────────────────────────────────

export const TouchTarget = {
  /** Minimum physical touch area */
  min: 44,
} as const;
