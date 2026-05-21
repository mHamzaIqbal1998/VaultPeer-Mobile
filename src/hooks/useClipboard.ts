import { useEffect, useRef, useCallback } from "react";
import * as Clipboard from "expo-clipboard";

/**
 * Custom hook to safely copy text to the system clipboard.
 * Auto-clears the clipboard after 30 seconds for sensitive values (like passwords).
 */
export function useClipboard() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyToClipboard = useCallback(
    async (text: string, isSensitive: boolean = false) => {
      try {
        await Clipboard.setStringAsync(text);

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        if (isSensitive) {
          // Schedule clipboard auto-clear after 30 seconds
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
          }, 30000);
        }
        return true;
      } catch (e) {
        console.error("[useClipboard] Failed to set clipboard string:", e);
        return false;
      }
    },
    []
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
