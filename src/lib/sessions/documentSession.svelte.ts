import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { settings } from '../stores/settings.svelte.js';
import { tabManager, type Tab } from '../stores/tabs.svelte.js';
import { getMarkdownBodyWithoutFrontMatter } from '../utils/frontMatter.js';
import { t } from '../utils/i18n.js';
import { hasMarkdownLinkExtension } from '../utils/markdownLinks.js';
import { canonicalizePath, isSameFilePath } from '../utils/pathIdentity.js';

export type LoadMarkdownOptions = {
	navigate?: boolean;
	skipTabManagement?: boolean;
	preserveEditState?: boolean;
	resetScrollHistory?: boolean;
	/**
	 * Read the file even though the tab that will receive it holds unsaved
	 * edits, discarding them. This is a REVERT, not an open, and only a caller
	 * acting on an explicit user decision may ask for it — the "Reload" answer
	 * to the external-change conflict, or "Reload from disk" after the close
	 * dialog has already resolved the buffer.
	 *
	 * Defaults to false, which is what makes `loadMarkdown` safe to call from
	 * every "open this file" entry point (recent files, drag-and-drop, a link
	 * opened in a new tab, the OS handing us a path) without each of them
	 * having to know whether that file is already open and edited.
	 */
	discardUnsavedBuffer?: boolean;
};

/**
 * What to do about a file the watcher reported as changed on disk.
 * `conflict` means the owning tab has unsaved edits, so the choice belongs
 * to the user rather than to a background reload.
 */
export type ExternalChangeOutcome =
	| { action: 'ignore' }
	| { action: 'reload'; tabId: string; path: string }
	| { action: 'conflict'; tabId: string; path: string };

type DocumentSessionOptions = {
	setShowHome: (value: boolean) => void;
	currentFile: () => string;
	resetScrollHistory: () => void;
	renderMarkdown: (raw: string, path: string, collapsedHeaders: Set<string>) => Promise<string>;
	afterLoad: () => Promise<unknown>;
	saveRecentFile: (path: string) => void;
	deleteRecentFile: (path: string) => void;
	setLoadingTabs: (tabIds: string[]) => void;
	measureInitialViewport: () => void;
	isScrolling: () => boolean;
	renderRichContent: () => void;
	onError: (message: string, error: unknown) => void;
	selfWriteGraceMs: number;
	cancelPendingAutoSave: (tabId: string) => void;
	askClose: (title: string) => Promise<'save' | 'discard' | 'cancel'>;
	onCloseSaveNewerEdits: () => void;
	onCloseAutoSaveFailed: () => void;
};

/**
 * Which heading sections the tab being loaded has folded, read at render time
 * rather than captured up front. A large file is rendered twice — the 50KB
 * preview, then the whole document once the background read lands — and the
 * user can fold something in between; the second render has to honour that.
 * An unknown tab folds nothing, which is what a load of a tab that has since
 * been closed should hand a renderer.
 */
function foldsForTab(tabId: string): Set<string> {
	return tabManager.tabs.find((item) => item.id === tabId)?.collapsedHeaders ?? new Set<string>();
}

export function createDocumentSession(options: DocumentSessionOptions) {
	const loadRevisionByTab = new Map<string, number>();
	const loadingTabs = new Set<string>();
	const selfWriteUntilByPath = new Map<string, number>();

	function markSelfWrite(path: string) {
		selfWriteUntilByPath.set(path, Date.now() + options.selfWriteGraceMs);
	}

	function clearSelfWrite(path: string) {
		selfWriteUntilByPath.delete(path);
	}

	function shouldReloadExternalChange(path: string) {
		const until = selfWriteUntilByPath.get(path);
		if (until === undefined) return true;
		if (Date.now() < until) return false;
		selfWriteUntilByPath.delete(path);
		return true;
	}

	/**
	 * Decide what a `file-changed` event should do. The event names the file
	 * that changed, so the tab that OWNS that path is the one affected —
	 * reloading "the active tab" would pull one document's disk content over
	 * a different document's buffer.
	 *
	 * A tab with unsaved edits is never reloaded: `setTabRawContent` replaces
	 * `originalContent` too, so the overwrite would also erase the evidence
	 * that anything was lost. The caller offers the user the choice instead.
	 */
	function resolveExternalChange(changedPath: string): ExternalChangeOutcome {
		if (!changedPath) return { action: 'ignore' };
		if (!shouldReloadExternalChange(changedPath)) return { action: 'ignore' };

		const active = tabManager.activeTab;
		const owner =
			active && active.path === changedPath
				? active
				: tabManager.tabs.find((tab) => tab.path === changedPath);
		if (!owner) return { action: 'ignore' };

		if (owner.isDirty) return { action: 'conflict', tabId: owner.id, path: changedPath };

		// `loadMarkdown` always writes into the active tab, so a background
		// owner cannot be refreshed through it. The watcher only ever follows
		// the active file, so this is a guard against a stale in-flight event,
		// not a dropped update.
		if (owner.id !== tabManager.activeTabId) return { action: 'ignore' };

		return { action: 'reload', tabId: owner.id, path: changedPath };
	}

	/**
	 * Replace a partial buffer (the >50KB preview read) with the whole file.
	 * Must be awaited by every path that can lead to a write — entering the
	 * editor or split view, editing front matter, toggling a task checkbox,
	 * moving the tab to another window — because writing the partial buffer
	 * back permanently truncates the document.
	 *
	 * Returns false when the buffer is still partial afterwards. A partial
	 * buffer that already carries edits is left alone: replacing it would
	 * trade the file's tail for the user's typing, so the caller has to stop
	 * instead. Every editing entry point calls this first, which is what makes
	 * that state unreachable in practice.
	 */
	async function ensureFullContent(tabId: string): Promise<boolean> {
		const tab = tabManager.tabs.find((item) => item.id === tabId);
		if (!tab) return false;
		if (!tab.isTruncated) return true;
		if (!tab.path) return true;
		if (tab.isDirty) return false;
		try {
			// Checked, like every other read that ends in a writable buffer.
			// The bare command was safe here only because this re-reads a file
			// whose tab `loadMarkdown` had already flagged — an invariant held
			// by two call sites agreeing, not by anything in the code. Reading
			// the fidelity again costs nothing and makes the flag a property of
			// the buffer instead of a memory of how it was obtained; it also
			// CLEARS the flag for a file converted to UTF-8 since the load.
			const [full, lossy] = (await invoke('read_file_content_checked', { path: tab.path })) as [string, boolean];
			tabManager.setTabDecodedLossy(tabId, lossy);
			tabManager.setTabRawContent(tabId, full);
			return true;
		} catch (error) {
			options.onError('Error loading the rest of the file', error);
			return false;
		}
	}

	// Tabs already told about a refused save. Auto-save re-arms on every
	// edit, so an undeduplicated toast would fire every 1.5s while typing.
	const lossySaveWarnedTabs = new Set<string>();

	/**
	 * Refuse to write a buffer back over the file it was decoded from when
	 * that decode was lossy: the file is not UTF-8, the bytes it disagreed
	 * with are already U+FFFD in the buffer, and the original is unrecoverable
	 * from it. Every writer — Ctrl+S, the auto-save timer in
	 * MarkdownViewer.svelte, the close dialogs in canCloseTab, the task
	 * checkbox — funnels through saveContent/saveContentAs, so this is the
	 * one place that has to hold.
	 *
	 * Only the SOURCE file is protected. Save As to any other path writes a
	 * genuine UTF-8 file, which is correct and is the user's way out; an
	 * untitled buffer (path === '') has no source file to destroy.
	 *
	 * This is damage control, not encoding support: Markpad cannot read GBK
	 * or Shift-JIS in the first place (that needs a real decoder), and this
	 * only stops it from overwriting what it could not read.
	 *
	 * "The same file" is the filesystem's judgement, not the string's: a Save As
	 * typed as `/notes/Legacy.md` for a tab opened as `/notes/legacy.md` is the
	 * source file on macOS and Windows, and letting it through is the exact
	 * destruction this guard exists to stop. The caller resolves the target once
	 * — it has just come out of a dialog — and passes its identity here.
	 * `targetPath !== tab.path` stays as the cheap first test so the common
	 * Ctrl+S case never consults anything further.
	 */
	function refuseIfLossilyDecoded(tab: Tab, targetPath: string, targetKey?: string): boolean {
		if (!tab.hasReplacementChars || targetPath === '') return false;
		if (targetPath !== tab.path && !isSameFilePath({ path: targetPath, pathKey: targetKey }, tab)) return false;
		console.warn('Refusing to overwrite a file that was decoded lossily', tab.path);
		if (!lossySaveWarnedTabs.has(tab.id)) {
			lossySaveWarnedTabs.add(tab.id);
			options.onError(t('toast.lossySaveBlocked', settings.language), tab.path);
		}
		return true;
	}

	/**
	 * True once this tab has been told, in words, that its buffer cannot be
	 * written back over its own file.
	 *
	 * The explanation is deduplicated per tab above, but the callers' own
	 * failure reporting was not: `saveContent` returns `false` for a refusal
	 * exactly as it does for a failed write, so the auto-save timer added its
	 * generic "auto-save failed" on top — and, because auto-save re-arms on
	 * every keystroke, repeated it every 1.5s for as long as the user kept
	 * typing. A refusal is not a failure to report again; it is a standing
	 * condition the user has already been told about and given an exit from.
	 */
	function isLossySaveRefused(tabId: string): boolean {
		return lossySaveWarnedTabs.has(tabId);
	}

	function updateLoading(tabId: string, loading: boolean) {
		if (loading) loadingTabs.add(tabId);
		else loadingTabs.delete(tabId);
		options.setLoadingTabs([...loadingTabs]);
	}

	async function loadMarkdown(filePath: string, loadOptions: LoadMarkdownOptions = {}) {
		options.setShowHome(false);
		let existing = null;
		let pendingNavigateTabId: string | null = null;
		try {
			if (loadOptions.resetScrollHistory || filePath !== options.currentFile()) {
				options.resetScrollHistory();
			}
			// Ask the filesystem what file this path names, ONCE, before any of
			// the decisions below. Every one of them is really a "same file?"
			// question — is it already open, does it belong to the tab holding
			// unsaved edits — and on macOS and Windows the string cannot answer
			// it: `/notes/A.md` and `/notes/a.md` are one file, and so are the
			// NFC and NFD spellings of an accented name.
			//
			// This is the only I/O added to the open path, and it is why the
			// comparisons themselves can stay synchronous: the answer is put on
			// the tab and reused. On failure `canonicalizePath` returns the path
			// unchanged, so an unreachable volume degrades to today's behaviour
			// rather than blocking the open.
			const pathKey = await canonicalizePath(filePath);
			const target = { path: filePath, pathKey };

			if (loadOptions.navigate && tabManager.activeTab) {
				pendingNavigateTabId = tabManager.activeTab.id;
			} else if (!loadOptions.skipTabManagement) {
				existing = tabManager.tabs.find((tab) => isSameFilePath(tab, target));
				if (existing) tabManager.setActive(existing.id);
				else if (tabManager.activeTab && tabManager.activeTab.path === '' && !tabManager.activeTab.isDirty && tabManager.activeTab.rawContent.trim() === '') {
					tabManager.updateTabPath(tabManager.activeTab.id, filePath, pathKey);
				} else tabManager.addTab(filePath, '', pathKey);
			}
			const activeId = tabManager.activeTabId;
			if (!activeId) return;
			// Callers that manage tabs themselves — back/forward, a link opened
			// in a new tab — put the path on the tab before getting here, so
			// this is where those tabs learn their identity. Cheap and idempotent
			// for the tabs that already have it.
			tabManager.setTabPathKey(activeId, filePath, pathKey);

			// Opening a file that is already open, in a tab that has unsaved
			// edits, must not re-read it: the load below replaces rawContent AND
			// originalContent, so the edits would be gone and the tab would not
			// even look dirty afterwards — the same silent loss
			// `resolveExternalChange` refuses for a watcher event, reached
			// through the ordinary open path instead.
			//
			// The whole request is answered by activating that tab, which every
			// mainstream editor does: VS Code reveals the existing editor over
			// its dirty `ITextModel`, Sublime Text focuses the view that already
			// holds the buffer, and Vim's `:e` refuses outright without `!`.
			// Discarding a buffer is a separate, explicit command everywhere —
			// here, "Reload from disk" and the external-change "Reload", and both
			// declare it by passing `discardUnsavedBuffer`. Authorization is
			// something a caller states, never something this function infers
			// from surrounding state.
			//
			// Note the tab is found by `activeTabId`: whether the caller reached
			// it by `setActive` on an already-open file, by `addTab` resolving to
			// it, or by never having left it, the buffer at risk is the same one.
			//
			// The match is by file, not by string: reopening `/notes/A.md` while
			// `/notes/a.md` sits here with unsaved edits is reopening THIS file,
			// and comparing the spellings would miss it and overwrite the buffer.
			const receiving = tabManager.tabs.find((item) => item.id === activeId);
			if (receiving && receiving.isDirty && isSameFilePath(receiving, target) && !loadOptions.discardUnsavedBuffer) {
				if (filePath) options.saveRecentFile(filePath);
				await options.afterLoad();
				return;
			}

			const fullLoadRevision = (loadRevisionByTab.get(activeId) ?? 0) + 1;
			loadRevisionByTab.set(activeId, fullLoadRevision);
			const isMarkdown = hasMarkdownLinkExtension(filePath);
			const tab = tabManager.tabs.find((item) => item.id === activeId);

			if (isMarkdown) {
				if (tab && !loadOptions.preserveEditState && !existing) tab.isEditing = settings.startInEditor;
				const initialIsEditing = tab?.isEditing ?? false;
				const initialIsSplit = tab?.isSplit ?? false;
				// `open_markdown_preview` returns only the first 50KB of a large
				// file, which is fine behind a read-only preview because the
				// background read below completes it. An editor bound to that
				// partial buffer is one keystroke away from auto-saving it back
				// over the whole document, so a pane that can write always gets
				// the complete file up front — this is the path F5 and "reload
				// from disk" take while edit or split mode is preserved.
				let content: string;
				let isFull: boolean;
				let lossy: boolean;
				if (initialIsEditing || initialIsSplit) {
					[content, lossy] = (await invoke('read_file_content_checked', { path: filePath })) as [string, boolean];
					isFull = true;
				} else {
					[, content, isFull, lossy] = (await invoke('open_markdown_preview', { path: filePath, maxBytes: 50000 })) as [string, string, boolean, boolean];
				}
				// Decided on every load, before the buffer can reach a writer.
				// Both branches report it, so this also CLEARS the flag on a
				// file the user has since converted to UTF-8.
				tabManager.setTabDecodedLossy(activeId, lossy);
				lossySaveWarnedTabs.delete(activeId);
				if (pendingNavigateTabId) tabManager.navigate(pendingNavigateTabId, filePath, pathKey);
				const processed = await options.renderMarkdown(content, filePath, foldsForTab(activeId));
				tabManager.updateTabContent(activeId, processed);
				// `isFull === false` means this is only the leading slice of a
				// large file. Marking the tab keeps anything downstream from
				// mistaking it for the whole document and writing it back.
				tabManager.setTabRawContent(activeId, content, !isFull);

				if (!isFull) {
					const canApplyFullLoad = () => {
						const targetTab = tabManager.tabs.find((item) => item.id === activeId);
						return targetTab?.path === filePath && loadRevisionByTab.get(activeId) === fullLoadRevision && !targetTab.isDirty && targetTab.isEditing === initialIsEditing && targetTab.isSplit === initialIsSplit;
					};
					updateLoading(activeId, true);
					options.measureInitialViewport();
					(invoke('read_file_content_checked', { path: filePath }) as Promise<[string, boolean]>)
						.then(([fullContent, fullLossy]) => {
							const applyFull = () => {
								try {
									if (options.isScrolling()) return void setTimeout(applyFull, 100);
									if (!canApplyFullLoad()) return updateLoading(activeId, false);
									options.renderMarkdown(fullContent, filePath, foldsForTab(activeId))
										.then((fullProcessed) => {
											if (!canApplyFullLoad()) return updateLoading(activeId, false);
											tabManager.updateTabContent(activeId, fullProcessed);
											tabManager.setTabRawContent(activeId, fullContent);
											// This buffer REPLACES the preview's, so it
											// carries its own verdict — the preview only
											// saw the first 50KB and a file can be valid
											// UTF-8 up to there and not after.
											tabManager.setTabDecodedLossy(activeId, fullLossy);
											updateLoading(activeId, false);
											if (tabManager.activeTabId === activeId) setTimeout(options.renderRichContent, 10);
										})
										.catch((error) => {
											options.onError('Error processing full markdown', error);
											updateLoading(activeId, false);
										});
								} catch (error) {
									options.onError('Error processing full markdown', error);
									updateLoading(activeId, false);
								}
							};
							if ('requestIdleCallback' in window) (window as any).requestIdleCallback(applyFull, { timeout: 2000 });
							else setTimeout(applyFull, 100);
						})
						.catch((error) => {
							options.onError('Backend Error loading full markdown', error);
							updateLoading(activeId, false);
						});
				}
			} else {
				const [content, lossy] = (await invoke('read_file_content_checked', { path: filePath })) as [string, boolean];
				tabManager.setTabDecodedLossy(activeId, lossy);
				lossySaveWarnedTabs.delete(activeId);
				if (pendingNavigateTabId) tabManager.navigate(pendingNavigateTabId, filePath, pathKey);
				if (tab) tab.isEditing = true;
				tabManager.setTabRawContent(activeId, content);
			}
			await options.afterLoad();
			if (filePath) options.saveRecentFile(filePath);
		} catch (error) {
			console.error('Error loading file:', error);
			// A watcher can observe a transient gap while another process replaces
			// the file. Keep the already-open buffer and recent-file entry instead
			// of closing the tab and discarding the user's recovery path.
			options.onError('Error loading file', error);
		}
	}

	async function saveContent(tabId?: string): Promise<boolean> {
		const tab = tabId ? tabManager.tabs.find((item) => item.id === tabId) : tabManager.activeTab;
		if (!tab) return false;
		// Backstop, not the main defence: every path that lets the user change
		// a large file completes its buffer first. If one is ever missed, the
		// write must fail loudly rather than silently truncate the document.
		if (tab.isTruncated) {
			options.onError('Refusing to save a partially loaded document', new Error(tab.path));
			return false;
		}
		let targetPath = tab.path;
		// The tab's own path is already resolved, so the ordinary save — Ctrl+S,
		// and the auto-save timer every 1.5s — adds no I/O here. Only the dialog
		// branch below produces a path nobody has resolved yet.
		let targetKey = tab.pathKey;
		if (!targetPath) {
			const selected = await save({
				filters: [
					{ name: 'Markdown', extensions: ['md'] },
					{ name: 'All Files', extensions: ['*'] },
				],
				defaultPath: tab.title,
			});
			if (!selected) return false;
			targetPath = selected;
			targetKey = await canonicalizePath(selected);
		}
		if (refuseIfLossilyDecoded(tab, targetPath, targetKey)) return false;
		const snapshot = tab.rawContent;
		markSelfWrite(targetPath);
		try {
			await invoke('save_file_content', { path: targetPath, content: snapshot });
			markSelfWrite(targetPath);
			if (tab.path === '') {
				tabManager.updateTabPath(tab.id, targetPath, targetKey);
				options.saveRecentFile(targetPath);
			}
			tab.originalContent = snapshot;
			tab.isDirty = tab.rawContent !== snapshot;
			return true;
		} catch (error) {
			clearSelfWrite(targetPath);
			options.onError('Failed to save file', error);
			return false;
		}
	}

	async function saveContentAs(): Promise<boolean> {
		const tab = tabManager.activeTab;
		if (!tab) return false;
		// A partial buffer would produce a silently incomplete copy.
		if (tab.isTruncated) {
			options.onError('Refusing to save a partially loaded document', new Error(tab.path));
			return false;
		}
		const selected = await save({
			filters: [
				{ name: 'Markdown', extensions: ['md'] },
				{ name: 'All Files', extensions: ['*'] },
			],
			defaultPath: tab.path || undefined,
		});
		if (!selected) return false;
		// Picking the source file again in the dialog is the same destructive
		// overwrite, just reached another way — and "again" includes naming it
		// in a different case, or with the accents composed differently, both of
		// which land on the very same file.
		const selectedKey = await canonicalizePath(selected);
		if (refuseIfLossilyDecoded(tab, selected, selectedKey)) return false;
		const snapshot = tab.rawContent;
		markSelfWrite(selected);
		try {
			await invoke('save_file_content', { path: selected, content: snapshot });
			markSelfWrite(selected);
			tabManager.updateTabPath(tab.id, selected, selectedKey);
			// The buffer now has a UTF-8 file of its own that it matches
			// exactly, so it is safe to save from here on.
			tabManager.setTabDecodedLossy(tab.id, false);
			lossySaveWarnedTabs.delete(tab.id);
			options.saveRecentFile(selected);
			tab.originalContent = snapshot;
			tab.isDirty = tab.rawContent !== snapshot;
			return true;
		} catch (error) {
			clearSelfWrite(selected);
			options.onError('Failed to save file as', error);
			return false;
		}
	}

	async function toggleTaskCheckbox(sourceLine: number, nowChecked: boolean) {
		const tab = tabManager.activeTab;
		if (!tab || !tab.path) return false;
		// Reading mode can reach a large file before its full buffer arrives.
		// Editing and saving the preview slice would drop everything past it.
		if (!(await ensureFullContent(tab.id))) return false;
		const raw = tab.rawContent;
		const body = getMarkdownBodyWithoutFrontMatter(raw);
		const updatedBody = body.replace(/^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+)\[( |x|X)\]/gm, (match, prefix, _state, offset) => {
			const line = body.slice(0, offset).split('\n').length;
			if (line === sourceLine) return `${prefix}[${nowChecked ? 'x' : ' '}]`;
			return match;
		});
		const updated = `${raw.slice(0, raw.length - body.length)}${updatedBody}`;
		if (updated === raw) return false;
		tabManager.updateTabRawContent(tab.id, updated);
		await saveContent(tab.id);
		return true;
	}

	async function canCloseTab(tabId: string): Promise<boolean> {
		const tab = tabManager.tabs.find((item) => item.id === tabId);
		if (!tab || (!tab.isDirty && tab.path !== '')) return true;
		if (!tab.isDirty) return true;
		if (settings.autoSave && !settings.confirmBeforeSave && tab.path !== '') {
			options.cancelPendingAutoSave(tabId);
			const success = await saveContent(tabId);
			if (success && !tab.isDirty) return true;
			if (success) options.onCloseSaveNewerEdits();
			else options.onCloseAutoSaveFailed();
		}
		const response = await options.askClose(tab.title);
		if (response === 'cancel') return false;
		if (response === 'save') {
			options.cancelPendingAutoSave(tabId);
			return saveContent(tabId);
		}
		options.cancelPendingAutoSave(tabId);
		tab.rawContent = tab.originalContent;
		tab.isDirty = false;
		return true;
	}

	return { loadMarkdown, saveContent, saveContentAs, toggleTaskCheckbox, shouldReloadExternalChange, resolveExternalChange, ensureFullContent, canCloseTab, isLossySaveRefused };
}
