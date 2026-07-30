import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { settings } from '../stores/settings.svelte.js';
import { tabManager } from '../stores/tabs.svelte.js';
import { hasMarkdownLinkExtension } from '../utils/markdownLinks.js';

export type LoadMarkdownOptions = {
	navigate?: boolean;
	skipTabManagement?: boolean;
	preserveEditState?: boolean;
	resetScrollHistory?: boolean;
};

type DocumentSessionOptions = {
	setShowHome: (value: boolean) => void;
	currentFile: () => string;
	resetScrollHistory: () => void;
	renderMarkdown: (raw: string, path: string) => Promise<string>;
	isLiveMode: () => boolean;
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
				const [, content, isFull] = (await invoke('open_markdown_preview', { path: filePath, maxBytes: 50000 })) as [string, string, boolean];
				if (pendingNavigateTabId) tabManager.navigate(pendingNavigateTabId, filePath);
				const processed = await options.renderMarkdown(content, filePath);
				tabManager.updateTabContent(activeId, processed);
				tabManager.setTabRawContent(activeId, content);

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
			if (options.isLiveMode()) invoke('watch_file', { path: filePath }).catch(console.error);
			await options.afterLoad();
			if (filePath) options.saveRecentFile(filePath);
		} catch (error) {
			console.error('Error loading file:', error);
			const errorText = String(error);
			if (errorText.includes('The system cannot find the file specified') || errorText.includes('No such file or directory')) {
				options.deleteRecentFile(filePath);
				if (tabManager.activeTab?.path === filePath) tabManager.closeTab(tabManager.activeTab.id);
			} else options.onError('Error loading file', error);
		}
	}

	async function saveContent(tabId?: string): Promise<boolean> {
		const tab = tabId ? tabManager.tabs.find((item) => item.id === tabId) : tabManager.activeTab;
		if (!tab) return false;
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

	async function toggleTaskCheckbox(index: number, nowChecked: boolean) {
		const tab = tabManager.activeTab;
		if (!tab || !tab.path) return false;
		const raw = tab.rawContent;
		let count = 0;
		const updated = raw.replace(/^(\s*[-*+] )\[( |x|X)\]/gm, (match, prefix) => {
			if (count++ === index) return `${prefix}[${nowChecked ? 'x' : ' '}]`;
			return match;
		});
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

	return { loadMarkdown, saveContent, saveContentAs, toggleTaskCheckbox, shouldReloadExternalChange, canCloseTab };
}
