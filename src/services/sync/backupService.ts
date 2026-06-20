/**
 * backupService — retain previous vault revisions when a newer file is pulled.
 *
 * This mirrors the server node's `storage.backupExisting` / `pruneBackups`:
 * before a pulled (or remote-applied) file overwrites the local vault, the
 * current on-disk revision is copied into a user-chosen directory as
 *
 *     <filename>.<mtime><BACKUP_SUFFIX>     e.g.  Passwords.kdbx.1718870400000.bak
 *
 * where `<mtime>` is the epoch-ms logical clock of the revision being preserved.
 * The embedded timestamp keeps revisions sortable by recency. The latest file
 * always keeps the original vault filename — only retained backups are renamed.
 *
 * Backups are best-effort: a failure here must never block a pull from
 * completing (again matching the server node).
 */

import {
  createFileInDirectory,
  listDirectory,
  deleteDocument,
} from "vaultpeer-file-system";
import { useBackupStore } from "../../stores/useBackupStore";

const TAG = "[BackupService]";

/**
 * Suffix appended to retained backup revisions. Matches the server node so the
 * naming scheme is identical across platforms.
 */
const BACKUP_SUFFIX = ".bak";

/**
 * Back up the current local revision before it is overwritten by a newer pull.
 *
 * No-ops when backups are disabled, no directory is configured, retention is
 * non-positive, or there is no prior content to preserve.
 *
 * @param filename       Basename of the vault file, e.g. "Passwords.kdbx".
 * @param oldContentB64  Base64 of the revision currently on disk (about to be
 *                       overwritten). Empty/undefined skips the backup.
 * @param oldMtime       Epoch-ms logical clock of the revision being preserved.
 */
export async function backupPulledRevision(
  filename: string,
  oldContentB64: string | null | undefined,
  oldMtime: number
): Promise<void> {
  const { enabled, dirUri, retention } = useBackupStore.getState();

  if (!enabled || !dirUri || retention <= 0) return;
  if (!oldContentB64) return;

  const ts = Math.round(oldMtime);
  if (!Number.isFinite(ts) || ts <= 0) {
    console.warn(TAG, "Skipping backup — invalid mtime", {
      filename,
      oldMtime,
    });
    return;
  }

  const backupName = `${filename}.${ts}${BACKUP_SUFFIX}`;

  try {
    await createFileInDirectory(dirUri, backupName, oldContentB64);
    console.log(TAG, "Backup created", { filename, backup: backupName });
  } catch (e) {
    // A backup failure must not block the pull from completing.
    console.warn(TAG, "Failed to create backup", { filename, error: e });
    return;
  }

  await pruneBackups(filename, dirUri, retention);
}

/**
 * Delete the oldest backups for a file so at most `retention` remain. Newest
 * revisions (highest embedded timestamp) are kept.
 */
async function pruneBackups(
  filename: string,
  dirUri: string,
  retention: number
): Promise<void> {
  const prefix = `${filename}.`;
  try {
    const entries = await listDirectory(dirUri);
    const backups = entries
      .filter(
        (e) => e.name.startsWith(prefix) && e.name.endsWith(BACKUP_SUFFIX)
      )
      .map((e) => ({
        uri: e.uri,
        ts: Number(e.name.slice(prefix.length, -BACKUP_SUFFIX.length)),
      }))
      .filter((b) => Number.isFinite(b.ts))
      .sort((a, b) => b.ts - a.ts); // newest first

    for (const stale of backups.slice(retention)) {
      try {
        await deleteDocument(stale.uri);
        console.log(TAG, "Pruned old backup", { filename, uri: stale.uri });
      } catch (e) {
        console.warn(TAG, "Failed to prune backup", {
          uri: stale.uri,
          error: e,
        });
      }
    }
  } catch (e) {
    console.warn(TAG, "Failed to enumerate backups for pruning", {
      filename,
      error: e,
    });
  }
}
