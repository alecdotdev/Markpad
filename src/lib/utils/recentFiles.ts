import { writeStoredSetting } from '../stores/settings.svelte.js';

// Module-private on purpose. Both used to be exported, and the only importer
// was recentFilesMultiWindow.test.ts, which compared each one with itself —
// so renaming the key or changing the cap could not fail anything. The test
// writes both values out now; an export that exists to be asserted against
// itself is not a contract with anyone.
const RECENT_FILES_KEY = 'recent-files';
const RECENT_FILES_LIMIT = 9;

/**
 * The recent-file list, as stored. Anything that is not an array of strings is
 * treated as absent rather than thrown: a corrupt entry must not be able to
 * stop the app from recording new files.
 */
export function parseRecentFiles(raw: string | null): string[] {
	if (raw === null) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
	} catch {
		return [];
	}
}

function dedupe(files: readonly string[]): string[] {
	return [...new Set(files)];
}

/** Moves `path` to the front, keeping the list at most {@link RECENT_FILES_LIMIT} long. */
export function promoteRecentFile(stored: readonly string[], path: string): string[] {
	return dedupe([path, ...stored]).slice(0, RECENT_FILES_LIMIT);
}

export function dropRecentFile(stored: readonly string[], path: string): string[] {
	return stored.filter((file) => file !== path);
}

/**
 * Follows a renamed file. Deduplicates afterwards: the new name may already be
 * in the list (the user renamed a file back onto a path they had opened
 * before), and two entries for one file is a list that cannot be cleaned up
 * from the UI, which removes one entry per click.
 */
export function renameRecentFile(stored: readonly string[], oldPath: string, newPath: string): string[] {
	return dedupe(stored.map((file) => (file === oldPath ? newPath : file)));
}

export function readStoredRecentFiles(): string[] {
	if (typeof localStorage === 'undefined') return [];
	return parseRecentFiles(localStorage.getItem(RECENT_FILES_KEY));
}

/**
 * Read-modify-write against localStorage, and the only way this list is
 * changed.
 *
 * Every Markpad window is a separate webview with its own copy of the list and
 * one shared localStorage. Writing `JSON.stringify(recentFiles)` from an
 * in-memory copy therefore published a snapshot taken when that window last
 * looked — so opening a file in window B erased everything window A had opened
 * since, and there was no ordering in which both survived. Re-reading first
 * makes each change a change to the *stored* list rather than to a stale copy
 * of it.
 *
 * It narrows the race rather than closing it. Two windows are two documents
 * over one storage area and the spec's storage mutex is not implemented
 * anywhere, so the `getItem`/`setItem` pair below can still interleave with
 * another window's. It is accepted here because the cycle is one synchronous
 * turn of the event loop, it runs only on discrete user actions, and the worst
 * loss is one recent-file entry the next open restores — three things that are
 * NOT true of every shared key. `update_pinned_tags` in `window_runtime.rs`
 * documents the contrast and takes a real lock.
 *
 * The write goes through {@link writeStoredSetting} (#370) so that a write
 * which changes nothing does not fire a `storage` event in the other windows.
 * That is what keeps the listener below from bouncing an update back and
 * forth; the reasoning for preferring compare-and-set over an
 * "I am applying a remote change" flag is documented there.
 */
export function updateStoredRecentFiles(mutate: (current: string[]) => string[]): string[] {
	const next = dedupe(mutate(readStoredRecentFiles())).slice(0, RECENT_FILES_LIMIT);
	writeStoredSetting(RECENT_FILES_KEY, JSON.stringify(next));
	return next;
}

/**
 * True when `event` means the recent-file list changed somewhere else.
 * A null key is localStorage being cleared wholesale.
 */
export function isRecentFilesStorageEvent(event: Pick<StorageEvent, 'key' | 'storageArea'>): boolean {
	if (typeof localStorage !== 'undefined' && event.storageArea && event.storageArea !== localStorage) return false;
	return event.key === null || event.key === RECENT_FILES_KEY;
}
