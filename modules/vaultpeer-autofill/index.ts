import { requireNativeModule } from "expo-modules-core";

const VaultPeerAutofill = requireNativeModule("VaultPeerAutofill");

export interface AutofillRequestInfo {
  packageName: string;
  webDomain: string | null;
  hasUsernameField?: boolean;
  hasPasswordField?: boolean;
  hasFocusedField?: boolean;
}

/**
 * Check if the VaultPeer Autofill service is currently selected as the active autofill provider on Android.
 */
export async function isAutofillServiceEnabled(): Promise<boolean> {
  try {
    return await VaultPeerAutofill.isAutofillServiceEnabled();
  } catch {
    return false;
  }
}

/**
 * Open the Android system settings dialog or screen to let the user select/activate VaultPeer as the Autofill Service.
 */
export async function openAutofillSettings(): Promise<void> {
  return await VaultPeerAutofill.openAutofillSettings();
}

/**
 * Retrieve the active autofill request details (package name and web domain of the requesting application/website).
 * Returns null if the app was not launched by an Autofill event.
 */
export async function getActiveRequest(): Promise<AutofillRequestInfo | null> {
  try {
    return await VaultPeerAutofill.getActiveRequest();
  } catch {
    return null;
  }
}

/**
 * Submit the selected credentials back to the Android Autofill system, which fills the fields and closes the app.
 */
export async function submitCredentials(
  username?: string | null,
  password?: string | null
): Promise<boolean> {
  return await VaultPeerAutofill.submitCredentials(
    username ?? null,
    password ?? null
  );
}

/**
 * Cancel the active autofill request and close the app.
 */
export async function cancelRequest(): Promise<void> {
  return await VaultPeerAutofill.cancelRequest();
}
