import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const KEY_BIOMETRIC_ENABLED = "vault_biometric_enabled";
const KEY_MASTER_PASSWORD = "vault_master_password";

/**
 * Sanitizes a URI for use as a SecureStore key.
 */
export function sanitizeUri(uri: string): string {
  return uri.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Returns the SecureStore keys based on the optional fileUri.
 */
function getKeys(fileUri?: string) {
  if (!fileUri) {
    return {
      enabledKey: KEY_BIOMETRIC_ENABLED,
      passwordKey: KEY_MASTER_PASSWORD,
    };
  }
  const sanitized = sanitizeUri(fileUri);
  return {
    enabledKey: `${KEY_BIOMETRIC_ENABLED}_${sanitized}`,
    passwordKey: `${KEY_MASTER_PASSWORD}_${sanitized}`,
  };
}

/**
 * Checks if the device has biometric hardware and if the user has enrolled biometrics.
 */
export async function isBiometricsSupported(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && isEnrolled;
  } catch (e) {
    console.error("[BiometricService] Error checking support:", e);
    return false;
  }
}

/**
 * Returns true if biometric unlock setting is enabled.
 */
export async function isBiometricEnabled(fileUri?: string): Promise<boolean> {
  try {
    const { enabledKey } = getKeys(fileUri);
    const isEnabled = await SecureStore.getItemAsync(enabledKey);
    return isEnabled === "true";
  } catch {
    return false;
  }
}

/**
 * Enables biometric unlock by authenticating the user and saving the master password to SecureStore.
 */
export async function enableBiometric(
  password: string,
  fileUri?: string
): Promise<boolean> {
  try {
    const supported = await isBiometricsSupported();
    if (!supported) return false;

    // Prompt user to verify identity before saving
    const authResult = await LocalAuthentication.authenticateAsync({
      promptMessage: "Confirm biometrics to enable unlock",
      fallbackLabel: "Use Passcode",
    });

    if (!authResult.success) {
      return false;
    }

    const { enabledKey, passwordKey } = getKeys(fileUri);

    // Save flag
    await SecureStore.setItemAsync(enabledKey, "true");

    // Save master password with requireAuthentication
    await SecureStore.setItemAsync(passwordKey, password, {
      requireAuthentication: true,
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });

    return true;
  } catch (e: any) {
    const message = e?.message || "";
    const isCancel =
      message.includes("canceled") ||
      message.includes("cancelled") ||
      message.includes("Cancel") ||
      message.includes("user canceled");
    if (isCancel) {
      console.log("[BiometricService] User cancelled biometric prompt.");
    } else {
      console.error("[BiometricService] Error enabling biometrics:", e);
    }
    return false;
  }
}

/**
 * Disables biometric unlock and purges the stored master password.
 */
export async function disableBiometric(fileUri?: string): Promise<void> {
  try {
    const { enabledKey, passwordKey } = getKeys(fileUri);
    await SecureStore.deleteItemAsync(enabledKey);
    await SecureStore.deleteItemAsync(passwordKey);
  } catch (e) {
    console.error("[BiometricService] Error disabling biometrics:", e);
  }
}

/**
 * Retrieves the stored master password, prompting the user for biometrics.
 */
export async function getStoredPassword(
  fileUri?: string
): Promise<string | null> {
  try {
    const isEnabled = await isBiometricEnabled(fileUri);
    if (!isEnabled) return null;

    const { passwordKey } = getKeys(fileUri);

    // Retrieving the item with requireAuthentication automatically triggers the biometric scan
    return await SecureStore.getItemAsync(passwordKey, {
      requireAuthentication: true,
      authenticationPrompt: "Scan to decrypt your vault",
    });
  } catch (e: any) {
    const message = e?.message || "";
    const isCancel =
      message.includes("canceled") ||
      message.includes("cancelled") ||
      message.includes("Cancel") ||
      message.includes("user canceled");
    if (isCancel) {
      console.log("[BiometricService] User cancelled biometric unlock.");
    } else {
      console.error("[BiometricService] Error retrieving stored password:", e);
    }
    return null;
  }
}
