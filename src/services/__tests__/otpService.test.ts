import { decodeBase32, generateTotp, parseOtpUri } from "../otpService";

describe("otpService", () => {
  describe("decodeBase32", () => {
    it("should decode standard base32 string", () => {
      const decoded = decodeBase32("MZXW6YTBOI======");
      expect(Buffer.from(decoded).toString("utf-8")).toBe("foobar");
    });

    it("should decode lowercase and ignore spacing/padding", () => {
      const decoded = decodeBase32("mzxw 6ytb oi");
      expect(Buffer.from(decoded).toString("utf-8")).toBe("foobar");
    });

    it("should throw error on invalid character", () => {
      expect(() => decodeBase32("MZXW6YTBOI1")).toThrow(
        "Invalid base32 character"
      );
    });
  });

  describe("parseOtpUri", () => {
    it("should parse standard totp uri correctly", () => {
      const uri =
        "otpauth://totp/Google:hamza%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Google&digits=6&period=30";
      const parsed = parseOtpUri(uri);
      expect(parsed.type).toBe("totp");
      expect(parsed.label).toBe("hamza@example.com");
      expect(parsed.issuer).toBe("Google");
      expect(parsed.secret).toBe("JBSWY3DPEHPK3PXP");
      expect(parsed.digits).toBe(6);
      expect(parsed.period).toBe(30);
    });

    it("should fallback to label issuer if issuer param is missing", () => {
      const uri = "otpauth://totp/Github:hamza?secret=JBSWY3DPEHPK3PXP";
      const parsed = parseOtpUri(uri);
      expect(parsed.issuer).toBe("Github");
      expect(parsed.label).toBe("hamza");
      expect(parsed.secret).toBe("JBSWY3DPEHPK3PXP");
    });

    it("should handle missing issuer and label prefix", () => {
      const uri = "otpauth://totp/hamza?secret=JBSWY3DPEHPK3PXP";
      const parsed = parseOtpUri(uri);
      expect(parsed.issuer).toBe("Unknown");
      expect(parsed.label).toBe("hamza");
    });
  });

  describe("generateTotp (RFC 6238 Test Vectors)", () => {
    // Secret for RFC 6238 is "12345678901234567890" in ASCII
    // In Base32, this is "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    it("should match RFC 6238 test vectors", () => {
      expect(generateTotp(secret, { time: 59, digits: 8 })).toBe("94287082");
      expect(generateTotp(secret, { time: 1111111109, digits: 8 })).toBe(
        "07081804"
      );
      expect(generateTotp(secret, { time: 1111111111, digits: 8 })).toBe(
        "14050471"
      );
      expect(generateTotp(secret, { time: 1234567890, digits: 8 })).toBe(
        "89005924"
      );
      expect(generateTotp(secret, { time: 2000000000, digits: 8 })).toBe(
        "69279037"
      );
      expect(generateTotp(secret, { time: 20000000000, digits: 8 })).toBe(
        "65353130"
      );
    });

    it("should generate 6 digit code by default", () => {
      const code = generateTotp("JBSWY3DPEHPK3PXP", { time: 59 });
      expect(code).toHaveLength(6);
      expect(/^\d+$/.test(code)).toBe(true);
    });
  });
});
