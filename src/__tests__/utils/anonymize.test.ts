import {
  hashValue,
  anonymizeEmail,
  anonymizeUsername,
  anonymizeFilePath,
  generateAnonymousMachineId,
  generateId,
} from "../../utils/anonymize";

describe("hashValue", () => {
  it("returns a consistent 16-character hex string for the same input", () => {
    const result = hashValue("hello");
    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
    expect(hashValue("hello")).toBe(result);
  });

  it("returns different results for different inputs", () => {
    expect(hashValue("a")).not.toBe(hashValue("b"));
  });

  it("returns different results for different salts", () => {
    const defaultSalt = hashValue("hello");
    const customSalt = hashValue("hello", "custom-salt");
    expect(defaultSalt).not.toBe(customSalt);
  });

  it("uses 'kdk-devinsights' as the default salt", () => {
    expect(hashValue("x")).toBe(hashValue("x", "kdk-devinsights"));
  });
});

describe("anonymizeEmail", () => {
  it("delegates to hashValue with the default salt", () => {
    const email = "user@example.com";
    expect(anonymizeEmail(email)).toBe(hashValue(email));
  });
});

describe("anonymizeUsername", () => {
  it("delegates to hashValue with the default salt", () => {
    const username = "jdoe";
    expect(anonymizeUsername(username)).toBe(hashValue(username));
  });
});

describe("anonymizeFilePath", () => {
  it("preserves the file extension", () => {
    const result = anonymizeFilePath("src/utils/helpers.ts");
    expect(result).toMatch(/\.ts$/);
  });

  it("hashes the file name to an 8-char hex prefix", () => {
    const result = anonymizeFilePath("file.js");
    expect(result).toMatch(/^[0-9a-f]{8}\.js$/);
  });

  it("preserves directory depth with */ prefixes", () => {
    const result = anonymizeFilePath("a/b/c/file.ts");
    expect(result).toMatch(/^\*\/\*\/\*\/[0-9a-f]{8}\.ts$/);
  });

  it("handles files with no extension", () => {
    const result = anonymizeFilePath("src/Makefile");
    expect(result).toMatch(/^\*\/[0-9a-f]{8}$/);
    expect(result).not.toContain(".");
  });

  it("handles single-segment paths (no directory)", () => {
    const result = anonymizeFilePath("README.md");
    expect(result).toMatch(/^[0-9a-f]{8}\.md$/);
    expect(result).not.toContain("*/");
  });

  it("produces consistent output for the same path", () => {
    expect(anonymizeFilePath("src/index.ts")).toBe(anonymizeFilePath("src/index.ts"));
  });
});

describe("generateAnonymousMachineId", () => {
  it("uses 'machine' as the salt", () => {
    const rawId = "abc-123";
    expect(generateAnonymousMachineId(rawId)).toBe(hashValue(rawId, "machine"));
  });

  it("returns a 16-character hex string", () => {
    expect(generateAnonymousMachineId("test")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("generateId", () => {
  it("returns a valid UUID v4 format", () => {
    const id = generateId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("returns unique values on successive calls", () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });
});
