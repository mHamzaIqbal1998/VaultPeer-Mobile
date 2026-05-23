import {
  isBiometricsSupported,
  isBiometricEnabled,
  enableBiometric,
  disableBiometric,
  getStoredPassword,
} from "../biometricService";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe("BiometricService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isBiometricsSupported", () => {
    it("should return true when hardware is present and user is enrolled", async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(
        true
      );
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(
        true
      );

      const result = await isBiometricsSupported();
      expect(result).toBe(true);
    });

    it("should return false when hardware is missing", async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(
        false
      );
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(
        true
      );

      const result = await isBiometricsSupported();
      expect(result).toBe(false);
    });
  });

  describe("isBiometricEnabled", () => {
    it("should return true if enabled flag is 'true' in secure store", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("true");
      const result = await isBiometricEnabled();
      expect(result).toBe(true);
    });

    it("should return false if enabled flag is not 'true'", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("false");
      const result = await isBiometricEnabled();
      expect(result).toBe(false);
    });
  });

  describe("enableBiometric", () => {
    it("should return true and save credentials if biometrics are supported and verification succeeds", async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(
        true
      );
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(
        true
      );
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
        success: true,
      });

      const result = await enableBiometric("my-password");
      expect(result).toBe(true);
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        "vault_biometric_enabled",
        "true"
      );
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        "vault_master_password",
        "my-password",
        expect.any(Object)
      );
    });

    it("should return false if user cancels authentication prompt", async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(
        true
      );
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(
        true
      );
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
        success: false,
      });

      const result = await enableBiometric("my-password");
      expect(result).toBe(false);
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    });
  });

  describe("disableBiometric", () => {
    it("should delete keys from secure store", async () => {
      await disableBiometric();
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
        "vault_biometric_enabled"
      );
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
        "vault_master_password"
      );
    });
  });

  describe("getStoredPassword", () => {
    it("should retrieve stored password if biometrics is enabled", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockImplementation((key) => {
        if (key === "vault_biometric_enabled") return Promise.resolve("true");
        if (key === "vault_master_password")
          return Promise.resolve("retrieved-password");
        return Promise.resolve(null);
      });

      const result = await getStoredPassword();
      expect(result).toBe("retrieved-password");
    });

    it("should return null if biometric is not enabled", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("false");

      const result = await getStoredPassword();
      expect(result).toBeNull();
    });
  });
});
