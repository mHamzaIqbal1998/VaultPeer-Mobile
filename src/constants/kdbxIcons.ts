/**
 * KeePass Icon Map
 *
 * Maps KeePass standard icon IDs (0–68) to Ionicons names.
 * Used throughout the UI to render group and entry icons.
 */

import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

type IoniconsName = ComponentProps<typeof Ionicons>["name"];

const KDBX_ICON_MAP: Record<number, IoniconsName> = {
  0: "key-outline", // Key
  1: "earth-outline", // World
  2: "alert-circle-outline", // Warning
  3: "server-outline", // Server
  4: "pin-outline", // Clipboard / Pin
  5: "chatbox-outline", // Chat
  6: "construct-outline", // Wrench
  7: "pricetag-outline", // Notepad
  8: "globe-outline", // World (socket)
  9: "person-outline", // Identity
  10: "document-text-outline", // Paperclip
  11: "camera-outline", // Camera
  12: "wifi-outline", // WiFi
  13: "keypad-outline", // Keys (passcode keypad for distinction)
  14: "flash-outline", // Energy
  15: "mail-outline", // Email
  16: "settings-outline", // Gear
  17: "scan-outline", // Scanner
  18: "browsers-outline", // Browser
  19: "disc-outline", // CD
  20: "desktop-outline", // Monitor
  21: "mail-open-outline", // Email open
  22: "cog-outline", // Gear 2
  23: "clipboard-outline", // Clipboard
  24: "document-outline", // Paper
  25: "terminal-outline", // Terminal
  26: "print-outline", // Printer
  27: "apps-outline", // Grid
  28: "flag-outline", // Flag
  29: "checkmark-circle-outline", // Checkmark
  30: "hardware-chip-outline", // Chip
  31: "folder-outline", // Folder
  32: "folder-open-outline", // Folder open
  33: "file-tray-stacked-outline", // File cabinet
  34: "lock-closed-outline", // Lock
  35: "lock-open-outline", // Lock open
  36: "checkmark-outline", // Check
  37: "pencil-outline", // Pen
  38: "image-outline", // Picture
  39: "book-outline", // Book
  40: "list-outline", // List
  41: "person-circle-outline", // User (key)
  42: "code-slash-outline", // Code
  43: "time-outline", // Clock
  44: "search-outline", // Search
  45: "document-attach-outline", // Paper w/ attachment
  46: "cube-outline", // Memory
  47: "trash-outline", // Trash
  48: "create-outline", // Sticky note
  49: "close-circle-outline", // Cancel
  50: "help-circle-outline", // Help
  51: "archive-outline", // Package
  52: "wallet-outline", // Wallet
  53: "log-in-outline", // Log in
  54: "star-outline", // Star
  55: "heart-outline", // Heart
  56: "shield-outline", // Shield
  57: "card-outline", // Card
  58: "phone-portrait-outline", // Phone
  59: "home-outline", // Home
  60: "star", // Star Alt (filled star for distinction)
  61: "laptop-outline", // Laptop
  62: "cash-outline", // Money
  63: "receipt-outline", // Certificate
  64: "at-outline", // @
  65: "logo-github", // GitHub-like
  66: "navigate-outline", // Compass
  67: "cloud-outline", // Cloud
  68: "barcode-outline", // Barcode
};

/**
 * Get the Ionicons name for a KeePass icon ID.
 * Falls back to "key-outline" for unknown IDs.
 */
export function getKdbxIconName(iconId: number): IoniconsName {
  return KDBX_ICON_MAP[iconId] ?? "key-outline";
}

/**
 * Default icon for groups (folder).
 */
export const GROUP_DEFAULT_ICON: IoniconsName = "folder-outline";

/**
 * Default icon for entries (key).
 */
export const ENTRY_DEFAULT_ICON: IoniconsName = "key-outline";
