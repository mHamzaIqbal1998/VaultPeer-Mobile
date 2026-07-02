/**
 * Group path helpers
 *
 * Utilities for representing a KeePass group location as a filesystem-style
 * path. The root group is represented as "/" and nested groups as "/a/b".
 */

import type { VaultGroup } from "../types/kdbx";

/**
 * Build a filesystem-style path for a group.
 * The root group is represented as "/" and nested groups as "/a/b".
 */
export function buildGroupPath(
  groupUuid: string | null | undefined,
  groupIndex: Map<string, VaultGroup>
): string {
  if (!groupUuid) return "/";
  const parts: string[] = [];
  let current = groupIndex.get(groupUuid);
  // Walk up until we reach the root (parentGroupUuid === null)
  while (current && current.parentGroupUuid !== null) {
    parts.unshift(current.name);
    current = groupIndex.get(current.parentGroupUuid);
  }
  return "/" + parts.join("/");
}
