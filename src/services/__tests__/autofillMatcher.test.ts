import { getMatchScore, suggestEntries } from "../autofillMatcher";
import type { VaultEntry } from "../../types/kdbx";

const mockEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  uuid: "test-uuid",
  title: "Test Entry",
  username: "testuser",
  password: "password123",
  url: "https://example.com",
  notes: "Some notes",
  iconId: 0,
  createdAt: "",
  modifiedAt: "",
  fields: {},
  secureFields: [],
  attachments: [],
  expires: false,
  tags: [],
  parentGroupUuid: "",
  ...overrides,
});

describe("autofillMatcher", () => {
  describe("getMatchScore", () => {
    it("should score 100 for exact web domain matches", () => {
      const entry = mockEntry({ url: "example.com" });
      const score = getMatchScore(entry, "", "example.com");
      expect(score).toBe(100);
    });

    it("should score 100 for domain match with scheme", () => {
      const entry = mockEntry({ url: "https://example.com" });
      const score = getMatchScore(entry, "", "example.com");
      expect(score).toBe(100);
    });

    it("should score 100 for domain match with subdomain", () => {
      const entry = mockEntry({ url: "login.example.com" });
      const score = getMatchScore(entry, "", "example.com");
      expect(score).toBe(100);
    });

    it("should score 80 for partial domain match in url", () => {
      const entry = mockEntry({
        url: "https://some-other-site.com/?ref=example.com",
      });
      const score = getMatchScore(entry, "", "example.com");
      expect(score).toBe(80);
    });

    it("should score 60 when package name segment matches title", () => {
      const entry = mockEntry({ title: "Instagram" });
      const score = getMatchScore(entry, "com.instagram.android", "");
      expect(score).toBe(60);
    });

    it("should score 50 when package name segment matches URL", () => {
      const entry = mockEntry({
        title: "Social App",
        url: "https://instagram.com/home",
      });
      const score = getMatchScore(entry, "com.instagram.android", "");
      expect(score).toBe(50);
    });

    it("should score 40 when domain keyword matches title", () => {
      const entry = mockEntry({ title: "Github Login" });
      const score = getMatchScore(entry, "", "github.com");
      expect(score).toBe(40);
    });

    it("should score 70 when domain matches keyword and title matches domain", () => {
      const entry = mockEntry({ title: "Facebook" });
      const score = getMatchScore(entry, "", "facebook.com");
      expect(score).toBe(70); // 40 (domain keyword matches title) + 30 (exact title in domain)
    });

    it("should return 0 when no criteria match", () => {
      const entry = mockEntry({ title: "Unrelated", url: "https://foo.bar" });
      const score = getMatchScore(entry, "com.unknown.app", "different.com");
      expect(score).toBe(0);
    });
  });

  describe("suggestEntries", () => {
    it("should return empty list when package name and domain are both empty", () => {
      const entries = [
        mockEntry({ title: "Facebook", url: "https://facebook.com" }),
        mockEntry({ title: "Instagram", url: "https://instagram.com" }),
      ];
      const results = suggestEntries(entries, "", "");
      expect(results).toEqual([]);
    });

    it("should sort suggested entries by score in descending order", () => {
      const entries = [
        mockEntry({
          uuid: "fb-1",
          title: "Facebook Page",
          url: "https://login.facebook.com",
        }), // Domain match (100) + title in domain (30) + domain keyword (40)
        mockEntry({
          uuid: "fb-2",
          title: "Facebook Support",
          url: "https://unrelated.com",
        }), // Domain keyword matches (40)
        mockEntry({
          uuid: "fb-3",
          title: "Unrelated",
          url: "https://unrelated.com",
        }), // No match (0)
      ];

      const results = suggestEntries(entries, "", "facebook.com");
      expect(results.length).toBe(2);
      expect(results[0].uuid).toBe("fb-1");
      expect(results[1].uuid).toBe("fb-2");
    });
  });
});
