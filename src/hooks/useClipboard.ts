import { useEffect, useRef, useCallback } from "react";
import * as Clipboard from "expo-clipboard";
import { useVaultStore } from "@/src/stores/useVaultStore";

/**
 * Custom hook to safely copy text to the system clipboard.
 * Auto-clears the clipboard after configured time for sensitive values (like passwords).
 */
export function useClipboard() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboardClearTime = useVaultStore((state) => state.clipboardClearTime);

  const copyToClipboard = useCallback(
    async (text: string, isSensitive: boolean = false) => {
      try {
        await Clipboard.setStringAsync(text);

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        if (isSensitive) {
          // Schedule clipboard auto-clear after user-configured time
          timeoutRef.current = setTimeout(async () => {
            try {
              const currentClipboard = await Clipboard.getStringAsync();
              // Only clear if the clipboard still contains the exact copied text
              if (currentClipboard === text) {
                await Clipboard.setStringAsync("");
                console.log("[useClipboard] Clipboard cleared for security.");
              }
            } catch (e) {
              console.error(
                "[useClipboard] Failed to read/clear clipboard on timeout:",
                e
              );
            }
          }, clipboardClearTime);
        }
        return true;
      } catch (e) {
        console.error("[useClipboard] Failed to set clipboard string:", e);
        return false;
      }
    },
    [clipboardClearTime]
  );

  // Clean up any pending timeouts when the hook unmounts
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { copyToClipboard };
}
