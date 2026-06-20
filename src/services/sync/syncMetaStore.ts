/**
 * syncMetaStore — Persisted hybrid logical clock for file synchronization.
 *
 * WHY THIS EXISTS
 * ---------------
 * The server node uses the OS file mtime (`fs.utimes`) as its Last-Write-Wins
 * clock. On mobile we cannot reliably *set* a document's mtime — Android's
 * Storage Access Framework exposes no API for it. So a "pure native mtime"
 * scheme would drift between platforms.
 *
 * Instead we maintain a small persisted record per file:
 *
 *   syncMeta[uri] = { logicalMtime, lastSeenNativeMtime }
 *
 *   • logicalMtime       — the cross-platform LWW clock we advertise as
 *                          `lastModified`. Bumped to Date.now() on local saves
 *                          and set to remoteMtime when we apply a pulled file.
 *   • lastSeenNativeMtime — the OS mtime we observed at the last in-app write.
 *                          Used to detect *external* (out-of-app) edits: if the
 *                          current native mtime jumps ahead of this, the file
 *                          was changed by another app and we bump logicalMtime.
 *
 * This keeps us LWW-compatible with the server while still detecting edits made
 * outside the app, and works around the SAF set-mtime limitation.
 */

import * as SecureStore from "expo-secure-store";
import { getMetadata } from "vaultpeer-file-system";

const STORE_KEY = "vault_sync_meta";

/** External-edit detection threshold (ms): native mtime must exceed the last
 * seen value by at least this to be treated as an out-of-app change. */
const EXTERNAL_EDIT_THRESHOLD_MS = 1500;

interface SyncMetaEntry {
  logicalMtime: number;
  lastSeenNativeMtime: number;
}

type SyncMetaMap = Record<string, SyncMetaEntry>;

let cache: SyncMetaMap | null = null;
let loadPromise: Promise<SyncMetaMap> | null = null;
// Serialize persistence writes so concurrent updates don't clobber each other.
let writeChain: Promise<unknown> = Promise.resolve();

async function load(): Promise<SyncMetaMap> {
  if (cache) return cache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORE_KEY);
      cache = raw ? (JSON.parse(raw) as SyncMetaMap) : {};
    } catch (e) {
      console.warn("[syncMetaStore] Failed to load sync meta:", e);
      cache = {};
    }
    return cache;
  })();

  return loadPromise;
}

function persist() {
  const snapshot = JSON.stringify(cache ?? {});
  writeChain = writeChain
    .then(() => SecureStore.setItemAsync(STORE_KEY, snapshot))
    .catch((e) => console.warn("[syncMetaStore] Failed to persist:", e));
  return writeChain;
}

async function readNativeMtime(
  uri: string,
  bookmark?: string
): Promise<number> {
  try {
    const meta = await getMetadata(uri, bookmark);
    return meta?.mtime ?? 0;
  } catch (e) {
    console.warn("[syncMetaStore] getMetadata failed:", e);
    return 0;
  }
}

/** Pre-load the persisted map (e.g. at app launch). Optional. */
export async function initSyncMeta(): Promise<void> {
  await load();
}

/**
 * Resolve the effective LWW timestamp to advertise for a file.
 *
 * Detects out-of-app edits by comparing the current native mtime against the
 * last value we recorded; if it jumped ahead, the logical clock is bumped so
 * the external change wins under LWW.
 */
export async function getEffectiveMtime(
  uri: string,
  bookmark?: string
): Promise<number> {
  const map = await load();
  const nativeMtime = await readNativeMtime(uri, bookmark);
  const entry = map[uri];

  if (!entry) {
    // First time we've seen this file — seed the clock from the OS, falling
    // back to "now" if the OS reports nothing.
    const seed = nativeMtime > 0 ? nativeMtime : Date.now();
    map[uri] = { logicalMtime: seed, lastSeenNativeMtime: nativeMtime };
    persist();
    return seed;
  }

  // Detect an external edit: native mtime advanced beyond what we last wrote.
  if (
    nativeMtime > 0 &&
    nativeMtime > entry.lastSeenNativeMtime + EXTERNAL_EDIT_THRESHOLD_MS
  ) {
    entry.logicalMtime = Math.max(entry.logicalMtime, nativeMtime);
    entry.lastSeenNativeMtime = nativeMtime;
    persist();
  }

  return entry.logicalMtime;
}

/**
 * Record a successful local (in-app) write.
 * @returns the logicalMtime now associated with the file.
 */
export async function recordLocalWrite(
  uri: string,
  bookmark?: string,
  logicalMtime?: number
): Promise<number> {
  const map = await load();
  const mtime = logicalMtime ?? Date.now();
  // After writing, re-read the OS mtime so future external-edit detection has a
  // fresh baseline.
  const nativeMtime = await readNativeMtime(uri, bookmark);
  map[uri] = {
    logicalMtime: mtime,
    lastSeenNativeMtime: nativeMtime,
  };
  persist();
  return mtime;
}

/**
 * Record application of a remote (pulled/pushed) file. The remote's mtime
 * becomes our logical clock so subsequent comparisons treat us as up-to-date.
 */
export async function recordRemoteApply(
  uri: string,
  bookmark: string | undefined,
  remoteMtime: number
): Promise<number> {
  const map = await load();
  const nativeMtime = await readNativeMtime(uri, bookmark);
  map[uri] = {
    logicalMtime: remoteMtime,
    lastSeenNativeMtime: nativeMtime,
  };
  persist();
  return remoteMtime;
}

/** Remove the record for a file (e.g. when a vault is removed). */
export async function forgetSyncMeta(uri: string): Promise<void> {
  const map = await load();
  if (map[uri]) {
    delete map[uri];
    persist();
  }
}
