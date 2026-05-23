import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const KEY_BIOMETRIC_ENABLED = "vault_biometric_enabled";
const KEY_MASTER_PASSWORD = "vault_master_password";

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
export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const isEnabled = await SecureStore.getItemAsync(KEY_BIOMETRIC_ENABLED);
    return isEnabled === "true";
  } catch {
    return false;
  }
}

/**
 * Enables biometric unlock by authenticating the user and saving the master password to SecureStore.
 */
export async function enableBiometric(password: string): Promise<boolean> {
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

    // Save flag
    await SecureStore.setItemAsync(KEY_BIOMETRIC_ENABLED, "true");

    // Save master password with requireAuthentication
    await SecureStore.setItemAsync(KEY_MASTER_PASSWORD, password, {
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
export async function disableBiometric(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY_BIOMETRIC_ENABLED);
    await SecureStore.deleteItemAsync(KEY_MASTER_PASSWORD);
  } catch (e) {
    console.error("[BiometricService] Error disabling biometrics:", e);
  }
}

/**
 * Retrieves the stored master password, prompting the user for biometrics.
 */
export async function getStoredPassword(): Promise<string | null> {
  try {
    const isEnabled = await isBiometricEnabled();
    if (!isEnabled) return null;

    // Retrieving the item with requireAuthentication automatically triggers the biometric scan
    return await SecureStore.getItemAsync(KEY_MASTER_PASSWORD, {
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
