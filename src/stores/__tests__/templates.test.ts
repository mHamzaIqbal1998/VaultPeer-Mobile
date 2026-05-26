import { useVaultStore } from "../useVaultStore";
import { createNewDatabase, initCryptoEngine } from "../../services/crypto";

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock("react-native-argon2-turbo", () => ({
  hash: jest.fn().mockResolvedValue({ rawHash: "00".repeat(32) }),
}));

describe("Vault Entry Templates", () => {
  beforeAll(() => {
    initCryptoEngine();
  });

  beforeEach(() => {
    useVaultStore.getState().closeDatabase();
  });

  it("should enable and disable templates and seed default templates group and entries", async () => {
    const db = createNewDatabase("Templates Test", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();
    expect(state.meta?.entryTemplatesEnabled).toBe(false);
    expect(state.meta?.entryTemplatesGroup).toBeUndefined();

    // Enable templates
    await state.setTemplatesEnabled(true);

    const updatedState = useVaultStore.getState();
    expect(updatedState.meta?.entryTemplatesEnabled).toBe(true);
    expect(updatedState.meta?.entryTemplatesGroup).toBeDefined();

    // Check templates group existence in groupIndex
    const templatesGroupUuid = updatedState.meta?.entryTemplatesGroup!;
    const templatesGroup = updatedState.groupIndex.get(templatesGroupUuid);
    expect(templatesGroup).toBeDefined();
    expect(templatesGroup?.name).toBe("Templates");

    // Check seeded default templates
    expect(templatesGroup?.entries.length).toBe(7);
    const entryTitles = templatesGroup?.entries.map((e) => e.title);
    expect(entryTitles).toContain("Credit Card");
    expect(entryTitles).toContain("Email Account");
    expect(entryTitles).toContain("Secure Note");
    expect(entryTitles).toContain("SSH Server");
    expect(entryTitles).toContain("Wi-Fi Router");
    expect(entryTitles).toContain("Membership / ID");
    expect(entryTitles).toContain("Software License");

    // Verify fields of seeded "Credit Card"
    const cc = templatesGroup?.entries.find((e) => e.title === "Credit Card");
    expect(cc).toBeDefined();
    expect(cc?.fields["Card Number"]).toBe("");
    expect(cc?.fields["Expiry Date"]).toBe("");
    expect(cc?.fields["CVV"]).toBe("");
    expect(cc?.fields["Cardholder Name"]).toBe("");
    expect(cc?.secureFields).toContain("CVV");

    // Verify fields of seeded "SSH Server"
    const ssh = templatesGroup?.entries.find((e) => e.title === "SSH Server");
    expect(ssh).toBeDefined();
    expect(ssh?.fields["Port"]).toBe("22");
    expect(ssh?.username).toBe("root");
    expect(ssh?.secureFields).toContain("Private Key");

    // Disable templates
    await state.setTemplatesEnabled(false);
    const disabledState = useVaultStore.getState();
    expect(disabledState.meta?.entryTemplatesEnabled).toBe(false);
    expect(disabledState.meta?.entryTemplatesGroup).toBe(templatesGroupUuid);
  });

  it("should support selecting a different template group", async () => {
    const db = createNewDatabase("Templates Selector Test", "password123");
    useVaultStore.getState().openDatabase(db, "test-path.kdbx");

    const state = useVaultStore.getState();
    const rootUuid = state.rootGroup!.uuid;

    // Create a new custom group
    const customGroup = await state.createGroup(
      rootUuid,
      "My Custom Templates"
    );
    expect(customGroup).not.toBeNull();

    // Set it as templates group
    await state.setTemplatesGroup(customGroup!.uuid);

    const updatedState = useVaultStore.getState();
    expect(updatedState.meta?.entryTemplatesGroup).toBe(customGroup!.uuid);
  });
});
