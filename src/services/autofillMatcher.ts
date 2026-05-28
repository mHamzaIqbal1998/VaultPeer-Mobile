import type { VaultEntry } from "../types/kdbx";

export function getMatchScore(
  entry: VaultEntry,
  callerPackage: string,
  callerDomain: string
): number {
  let score = 0;
  const cleanPackage = (callerPackage || "").toLowerCase().trim();
  const cleanDomain = (callerDomain || "").toLowerCase().trim();
  const cleanTitle = (entry.title || "").toLowerCase().trim();
  const cleanUrl = (entry.url || "").toLowerCase().trim();

  // 1. Web Domain Match
  if (cleanDomain && cleanUrl) {
    if (
      cleanUrl === cleanDomain ||
      cleanUrl.includes("://" + cleanDomain) ||
      cleanUrl.includes("." + cleanDomain)
    ) {
      score += 100;
    } else if (cleanUrl.includes(cleanDomain)) {
      score += 80;
    }
  }

  // 2. Package Name Segment Match
  if (cleanPackage) {
    const segments = cleanPackage.split(".");
    const mainAppKeyword = segments.find(
      (s) =>
        s !== "com" &&
        s !== "android" &&
        s !== "apps" &&
        s !== "org" &&
        s !== "net" &&
        s !== "io"
    );
    if (mainAppKeyword) {
      if (cleanTitle.includes(mainAppKeyword)) {
        score += 60;
      }
      if (cleanUrl.includes(mainAppKeyword)) {
        score += 50;
      }
    }
  }

  // 3. Title Match with web domain keyword
  if (cleanDomain) {
    const domainKeyword = cleanDomain.split(".")[0];
    if (domainKeyword && cleanTitle.includes(domainKeyword)) {
      score += 40;
    }
  }

  // 4. Exact Username / Title overlap
  if (cleanTitle && cleanDomain && cleanDomain.includes(cleanTitle)) {
    score += 30;
  }

  return score;
}

export function suggestEntries(
  entries: VaultEntry[],
  callerPackage: string,
  callerDomain: string
): VaultEntry[] {
  if (!callerPackage && !callerDomain) return [];
  const list: { entry: VaultEntry; score: number }[] = [];
  for (const entry of entries) {
    const score = getMatchScore(entry, callerPackage, callerDomain);
    if (score > 0) {
      list.push({ entry, score });
    }
  }
  return list.sort((a, b) => b.score - a.score).map((item) => item.entry);
}
