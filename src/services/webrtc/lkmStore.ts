import * as SecureStore from "expo-secure-store";
import { sanitizeUri } from "../biometricService";

const LKM_PREFIX = "vault_lkm_";

/**
 * Gets the Last Known Modification (LKM) logical timestamp for a given file URI.
 * Returns 0 if no timestamp is stored.
 */
export async function getLkm(fileUri: string): Promise<number> {
  if (!fileUri) return 0;
  try {
    const key = `${LKM_PREFIX}${sanitizeUri(fileUri)}`;
    const stored = await SecureStore.getItemAsync(key);
    return stored ? parseInt(stored, 10) : 0;
  } catch (e) {
    console.error("[LkmStore] Failed to get LKM for URI:", fileUri, e);
    return 0;
  }
}

/**
 * Sets the Last Known Modification (LKM) logical timestamp for a given file URI.
 */
export async function setLkm(
  fileUri: string,
  timestamp: number
): Promise<void> {
  if (!fileUri) return;
  try {
    const key = `${LKM_PREFIX}${sanitizeUri(fileUri)}`;
    await SecureStore.setItemAsync(key, String(timestamp));
  } catch (e) {
    console.error("[LkmStore] Failed to set LKM for URI:", fileUri, e);
  }
}

/**
 * Clears the Last Known Modification (LKM) logical timestamp for a given file URI.
 */
export async function clearLkm(fileUri: string): Promise<void> {
  if (!fileUri) return;
  try {
    const key = `${LKM_PREFIX}${sanitizeUri(fileUri)}`;
    await SecureStore.deleteItemAsync(key);
  } catch (e) {
    console.error("[LkmStore] Failed to clear LKM for URI:", fileUri, e);
  }
}
