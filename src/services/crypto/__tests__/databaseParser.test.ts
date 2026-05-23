/**
 * Jest Test Suite — Database Parser
 *
 * Validates the transformation from kdbxweb's internal tree
 * structure into VaultPeer's type-safe data model.
 */

import { parseEntry, parseGroup, parseDatabase } from "../databaseParser";

// ────────────────────────────────────────────
// Mock Data Factories
// ────────────────────────────────────────────

interface MockEntryOverrides {
  uuid?: string;
  title?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  icon?: number;
  tags?: string[];
  customFields?: Record<string, string>;
}

function createMockEntry(overrides: MockEntryOverrides = {}) {
  const fields = new Map<string, string | { getText(): string }>();
  fields.set("Title", overrides.title ?? "Test Entry");
  fields.set("UserName", overrides.username ?? "testuser");
  fields.set("Password", {
    getText: () => overrides.password ?? "secret123",
  });
  fields.set("URL", overrides.url ?? "https://example.com");
  fields.set("Notes", overrides.notes ?? "Test notes");

  if (overrides.customFields) {
    Object.entries(overrides.customFields).forEach(([key, value]) => {
      fields.set(key, value);
    });
  }

  return {
    uuid: { id: overrides.uuid ?? "entry-uuid-1" },
    fields,
    icon: overrides.icon ?? 0,
    customIcon: undefined,
    times: {
      creationTime: new Date("2024-01-01T00:00:00Z"),
      lastModTime: new Date("2024-06-15T12:00:00Z"),
    },
    tags: overrides.tags ?? [],
  };
}

interface MockGroupOverrides {
  uuid?: string;
  name?: string;
  entries?: ReturnType<typeof createMockEntry>[];
  groups?: ReturnType<typeof createMockGroup>[];
}

function createMockGroup(overrides: MockGroupOverrides = {}): {
  uuid: { id: string };
  name: string;
  icon: number;
  customIcon: undefined;
  entries: ReturnType<typeof createMockEntry>[];
  groups: ReturnType<typeof createMockGroup>[];
} {
  return {
    uuid: { id: overrides.uuid ?? "group-uuid-1" },
    name: overrides.name ?? "Test Group",
    icon: 48,
    customIcon: undefined,
    entries: overrides.entries ?? [],
    groups: overrides.groups ?? [],
  };
}

// ────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────

describe("Database Parser", () => {
  describe("parseEntry", () => {
    it("should extract standard fields from an entry", () => {
      const mockEntry = createMockEntry();
      const result = parseEntry(mockEntry as never, "parent-group-uuid");

      expect(result.uuid).toBe("entry-uuid-1");
      expect(result.title).toBe("Test Entry");
      expect(result.username).toBe("testuser");
      expect(result.password).toBe("secret123");
      expect(result.url).toBe("https://example.com");
      expect(result.notes).toBe("Test notes");
      expect(result.parentGroupUuid).toBe("parent-group-uuid");
    });

    it("should extract custom fields separately", () => {
      const mockEntry = createMockEntry({
        customFields: {
          "OTP Secret": "JBSWY3DPEHPK3PXP",
          "Recovery Code": "abc-123-xyz",
        },
      });
      const result = parseEntry(mockEntry as never, "parent");

      expect(result.fields["OTP Secret"]).toBe("JBSWY3DPEHPK3PXP");
      expect(result.fields["Recovery Code"]).toBe("abc-123-xyz");
      expect(result.fields["Title"]).toBeUndefined();
      expect(result.fields["Password"]).toBeUndefined();
    });

    it("should handle entries with tags", () => {
      const mockEntry = createMockEntry({ tags: ["banking", "important"] });
      const result = parseEntry(mockEntry as never, "parent");

      expect(result.tags).toEqual(["banking", "important"]);
    });

    it("should format timestamps as ISO strings", () => {
      const mockEntry = createMockEntry();
      const result = parseEntry(mockEntry as never, "parent");

      expect(result.createdAt).toBe("2024-01-01T00:00:00.000Z");
      expect(result.modifiedAt).toBe("2024-06-15T12:00:00.000Z");
    });
  });

  describe("parseGroup", () => {
    it("should parse a group with entries", () => {
      const group = createMockGroup({
        name: "Banking",
        entries: [createMockEntry({ title: "Bank Login" })],
      });
      const result = parseGroup(group as never, null);

      expect(result.name).toBe("Banking");
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].title).toBe("Bank Login");
      expect(result.parentGroupUuid).toBeNull();
    });

    it("should recursively parse nested sub-groups", () => {
      const group = createMockGroup({
        name: "Root",
        groups: [
          createMockGroup({
            uuid: "child-1",
            name: "Email",
            entries: [createMockEntry({ title: "Gmail" })],
          }),
          createMockGroup({
            uuid: "child-2",
            name: "Social",
            entries: [createMockEntry({ title: "Twitter" })],
          }),
        ],
      });
      const result = parseGroup(group as never, null);

      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].name).toBe("Email");
      expect(result.groups[0].entries[0].title).toBe("Gmail");
      expect(result.groups[1].name).toBe("Social");
      expect(result.groups[1].entries[0].title).toBe("Twitter");
    });

    it("should set parent group UUID for child groups", () => {
      const group = createMockGroup({
        uuid: "parent-uuid",
        groups: [createMockGroup({ uuid: "child-uuid" })],
      });
      const result = parseGroup(group as never, null);

      expect(result.groups[0].parentGroupUuid).toBe("parent-uuid");
    });
  });

  describe("parseDatabase", () => {
    it("should return both meta and rootGroup, including cipher and KDF details", () => {
      const root = createMockGroup({
        entries: [
          createMockEntry({ title: "Entry 1" }),
          createMockEntry({ title: "Entry 2" }),
        ],
        groups: [
          createMockGroup({
            name: "Sub Group",
            entries: [createMockEntry({ title: "Entry 3" })],
          }),
        ],
      });
      const db = {
        getDefaultGroup: () => root,
        meta: {
          name: "Test Vault",
          desc: "A test vault for unit testing",
          settingsChanged: new Date("2024-06-15T12:00:00Z"),
        },
        header: {
          version: 4,
          dataCipherUuid: "1gOKK4tvTLWlJDOaMdu1mg==", // ChaCha20 in base64
          kdfParameters: new Map([["$UUID", "nimLGVbbR3OyPfw+xvCh5g=="]]), // Argon2id in base64
        },
      };
      const result = parseDatabase(db as never);

      expect(result.meta.name).toBe("Test Vault");
      expect(result.meta.entryCount).toBe(3);
      expect(result.meta.groupCount).toBe(1);
      expect(result.meta.cipherName).toBe("ChaCha20");
      expect(result.meta.kdfName).toBe("Argon2id");
      expect(result.rootGroup.entries).toHaveLength(2);
      expect(result.rootGroup.groups).toHaveLength(1);
    });

    it("should fall back to AES-256 for unknown or missing cipher UUIDs", () => {
      const root = createMockGroup();
      const db = {
        getDefaultGroup: () => root,
        meta: {
          name: "Test Vault",
          settingsChanged: new Date(),
        },
        header: {
          version: 4,
          kdfParameters: new Map([["$UUID", "c9d9f39a-fake-aeskdf"]]),
        },
      };
      const result = parseDatabase(db as never);
      expect(result.meta.cipherName).toBe("AES-256");
      expect(result.meta.kdfName).toBe("AES-KDF");
    });
  });
});
