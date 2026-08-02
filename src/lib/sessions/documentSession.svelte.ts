import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { settings } from '../stores/settings.svelte.js';
import { tabManager } from '../stores/tabs.svelte.js';
import { getMarkdownBodyWithoutFrontMatter } from '../utils/frontMatter.js';
import { hasMarkdownLinkExtension } from '../utils/markdownLinks.js';

export type LoadMarkdownOptions = {
	navigate?: boolean;
	skipTabManagement?: boolean;
	preserveEditState?: boolean;
	resetScrollHistory?: boolean;
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
	renderMarkdown: (raw: string, path: string) => Promise<string>;
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
			const full = (await invoke('read_file_content', { path: tab.path })) as string;
			tabManager.setTabRawContent(tabId, full);
			return true;
		} catch (error) {
			options.onError('Error loading the rest of the file', error);
			return false;
		}
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
			if (loadOptions.navigate && tabManager.activeTab) {
				pendingNavigateTabId = tabManager.activeTab.id;
			} else if (!loadOptions.skipTabManagement) {
				existing = tabManager.tabs.find((tab) => tab.path === filePath);
				if (existing) tabManager.setActive(existing.id);
				else if (tabManager.activeTab && tabManager.activeTab.path === '' && !tabManager.activeTab.isDirty && tabManager.activeTab.rawContent.trim() === '') {
					tabManager.updateTabPath(tabManager.activeTab.id, filePath);
				} else tabManager.addTab(filePath);
			}
			const activeId = tabManager.activeTabId;
			if (!activeId) return;
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
				if (initialIsEditing || initialIsSplit) {
					content = (await invoke('read_file_content', { path: filePath })) as string;
					isFull = true;
				} else {
					[, content, isFull] = (await invoke('open_markdown_preview', { path: filePath, maxBytes: 50000 })) as [string, string, boolean];
				}
				if (pendingNavigateTabId) tabManager.navigate(pendingNavigateTabId, filePath);
				const processed = await options.renderMarkdown(content, filePath);
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
					(invoke('read_file_content', { path: filePath }) as Promise<string>)
						.then((fullContent) => {
							const applyFull = () => {
								try {
									if (options.isScrolling()) return void setTimeout(applyFull, 100);
									if (!canApplyFullLoad()) return updateLoading(activeId, false);
									options.renderMarkdown(fullContent, filePath)
										.then((fullProcessed) => {
											if (!canApplyFullLoad()) return updateLoading(activeId, false);
											tabManager.updateTabContent(activeId, fullProcessed);
											tabManager.setTabRawContent(activeId, fullContent);
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
				const content = (await invoke('read_file_content', { path: filePath })) as string;
				if (pendingNavigateTabId) tabManager.navigate(pendingNavigateTabId, filePath);
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
		}
		const snapshot = tab.rawContent;
		markSelfWrite(targetPath);
		try {
			await invoke('save_file_content', { path: targetPath, content: snapshot });
			markSelfWrite(targetPath);
			if (tab.path === '') {
				tabManager.updateTabPath(tab.id, targetPath);
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
		const snapshot = tab.rawContent;
		markSelfWrite(selected);
		try {
			await invoke('save_file_content', { path: selected, content: snapshot });
			markSelfWrite(selected);
			tabManager.updateTabPath(tab.id, selected);
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

	return { loadMarkdown, saveContent, saveContentAs, toggleTaskCheckbox, shouldReloadExternalChange, resolveExternalChange, ensureFullContent, canCloseTab };
}
