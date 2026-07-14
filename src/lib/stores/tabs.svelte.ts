import { t } from '../utils/i18n.js';
import { nextUntitledTitle } from '../utils/untitledTitle.js';
import { settings } from './settings.svelte.js';
import { buildTransferredTab, type TransferableTab } from '../utils/tabTransfer.js';
import {
	canGoBackInHistory,
	canGoForwardInHistory,
	createFileHistory,
	goBackInHistory,
	goForwardInHistory,
	navigateFileHistory,
	replaceCurrentHistoryEntry,
} from '../utils/tabHistory.js';

export interface Tab {
	id: string;
	path: string;
	title: string;
	content: string;
	rawContent: string;
	originalContent: string;
	scrollTop: number;
	isDirty: boolean;
	isEditing: boolean;
	history: string[];
	historyIndex: number;
	editorViewState: any; // monaco.editor.ICodeEditorViewState | null
	scrollPercentage: number;
	anchorLine: number;
	isSplit: boolean;
	splitRatio: number;
	isScrollSynced: boolean;
}

class TabManager {
	tabs = $state<Tab[]>([]);
	activeTabId = $state<string | null>(null);
	splitScrollSyncPreference = $state(false);

	constructor() {
		if (typeof localStorage !== 'undefined') {
			const saved = localStorage.getItem('editor.splitScrollSync');
			if (saved !== null) {
				this.splitScrollSyncPreference = saved === 'true';
			}
		}
	}

	private saveSplitScrollSyncPreference() {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('editor.splitScrollSync', String(this.splitScrollSyncPreference));
		}
	}

	get activeTab() {
		return this.tabs.find((t) => t.id === this.activeTabId);
	}

	/**
	 * Serialize WINDOW state only: which files are open, the active tab, and
	 * per-tab UI (edit mode, split, scroll). Document content always lives on
	 * disk — the snapshot never carries rawContent, so unsaved changes are
	 * handled exclusively by the close dialogs, never smuggled through here.
	 * Untitled tabs have no disk backing and are resolved at close, so they
	 * are not persisted.
	 */
	// Optional user-assigned window identity (Chrome-tab-group-style name +
	// color chip). Window-level, not tab-level; secondary windows' tags die
	// with them, main's rides the v2 snapshot as an additive field that
	// older builds simply ignore.
	windowTag = $state<{ name: string; color: string; pinned?: boolean } | null>(null);

	setWindowTag(tag: { name: string; color: string; pinned?: boolean } | null) {
		this.windowTag = tag;
	}

	serializeState(): string {
		const stateData = {
			version: 2,
			windowTag: this.windowTag,
			activeTabId: this.activeTabId,
			tabs: this.tabs
				.filter((t) => t.path !== '')
				.map((t) => ({
					id: t.id,
					path: t.path,
					title: t.title,
					isEditing: t.isEditing,
					isSplit: t.isSplit,
					splitRatio: t.splitRatio,
					isScrollSynced: t.isScrollSynced,
					scrollTop: t.scrollTop,
					scrollPercentage: t.scrollPercentage,
					anchorLine: t.anchorLine
				}))
		};
		return JSON.stringify(stateData);
	}

	/**
	 * Rebuild clean tabs from a window-state snapshot. Content starts empty —
	 * the caller reads each file from disk afterwards. Also accepts the legacy
	 * full-tab format, from which only the window-state fields are taken
	 * (legacy untitled entries are dropped).
	 */
	restoreState(jsonBuffer: string) {
		try {
			const data = JSON.parse(jsonBuffer);
			if (!data || !Array.isArray(data.tabs)) return;

			if (
				data.windowTag &&
				typeof data.windowTag.name === 'string' &&
				data.windowTag.name !== '' &&
				typeof data.windowTag.color === 'string'
			) {
				this.windowTag = {
					name: data.windowTag.name,
					color: data.windowTag.color,
					pinned: data.windowTag.pinned === true,
				};
			}

			const restored: Tab[] = [];
			for (const saved of data.tabs) {
				if (!saved || typeof saved.path !== 'string' || saved.path === '') continue;
				const filename = saved.path.split('\\').pop()?.split('/').pop() || saved.path;
				const fileHistory = createFileHistory(saved.path, '');
				restored.push({
					id: typeof saved.id === 'string' ? saved.id : crypto.randomUUID(),
					path: saved.path,
					title: typeof saved.title === 'string' && saved.title !== '' ? saved.title : filename,
					content: '',
					rawContent: '',
					originalContent: '',
					scrollTop: typeof saved.scrollTop === 'number' ? saved.scrollTop : 0,
					isDirty: false,
					isEditing: saved.isEditing === true,
					history: fileHistory.history,
					historyIndex: fileHistory.historyIndex,
					editorViewState: null,
					scrollPercentage: typeof saved.scrollPercentage === 'number' ? saved.scrollPercentage : 0,
					anchorLine: typeof saved.anchorLine === 'number' ? saved.anchorLine : 0,
					isSplit: saved.isSplit === true,
					splitRatio: typeof saved.splitRatio === 'number' ? saved.splitRatio : 0.5,
					isScrollSynced: saved.isScrollSynced === true
				});
			}

			this.tabs = restored;
			this.activeTabId = restored.some((t) => t.id === data.activeTabId)
				? data.activeTabId
				: restored[0]?.id ?? null;
		} catch (e) {
			console.error('Failed to restore tab state', e);
		}
	}

	addTab(path: string, content: string = '') {
		const id = crypto.randomUUID();
		const filename =
			path.split('\\').pop()?.split('/').pop() ||
			nextUntitledTitle(
				this.tabs.map((tab) => tab.title),
				t('tabs.untitled', settings.language),
			);
		const fileHistory = createFileHistory(path, content);

		this.tabs.push({
			id,
			path,
			title: filename,
			content,
			rawContent: content,
			originalContent: content,
			scrollTop: 0,
			isDirty: false,
			isEditing: false,
			history: fileHistory.history,
			historyIndex: fileHistory.historyIndex,
			editorViewState: null,
			scrollPercentage: 0,
			anchorLine: 0,
			isSplit: false,
			splitRatio: 0.5,
			isScrollSynced: false
		});

		this.activeTabId = id;
	}

	addNewTab() {
		const id = crypto.randomUUID();
		const content = '';

		this.tabs.push({
			id,
			path: '',
			title: nextUntitledTitle(
				this.tabs.map((tab) => tab.title),
				t('tabs.untitled', settings.language),
			),
			content,
			rawContent: content,
			originalContent: content,
			scrollTop: 0,
			isDirty: false,
			isEditing: settings.newFileDefaultMode,
			history: [content],
			historyIndex: 0,
			editorViewState: null,
			scrollPercentage: 0,
			anchorLine: 0,
			isSplit: false,
			splitRatio: 0.5,
			isScrollSynced: false
		});

		this.activeTabId = id;
	}

	addHomeTab() {
		const homeTab = this.tabs.find(t => t.path === 'HOME');
		if (homeTab) {
			this.activeTabId = homeTab.id;
			return;
		}

		const id = crypto.randomUUID();
		this.tabs.push({
			id,
			path: 'HOME',
			title: t('tabs.home', settings.language),
			content: '',
			rawContent: '',
			originalContent: '',
			scrollTop: 0,
			isDirty: false,
			isEditing: false,
			history: [],
			historyIndex: 0,
			editorViewState: null,
			scrollPercentage: 0,
			anchorLine: 0,
			isSplit: false,
			splitRatio: 0.5,
			isScrollSynced: false
		});

		this.activeTabId = id;
	}

	/**
	 * Insert a tab that arrived from another window (cross-window transfer).
	 * The snapshot carries the unsaved buffer — see tabTransfer.ts. Rendered
	 * content starts empty (the caller re-renders); untitled arrivals are
	 * re-numbered against THIS window's tabs. Independent of serializeState/
	 * restoreState, which persist window shape only.
	 */
	insertTransferredTab(snap: TransferableTab): string {
		const tab = buildTransferredTab(
			snap,
			this.tabs.map((tab) => tab.title),
			t('tabs.untitled', settings.language),
		);
		this.tabs.push(tab);
		this.activeTabId = tab.id;
		return tab.id;
	}

	closeTab(id: string) {
		const index = this.tabs.findIndex((t) => t.id === id);
		if (index === -1) return;

		if (this.activeTabId === id) {
			const fallback = this.tabs[index + 1] || this.tabs[index - 1];
			this.activeTabId = fallback ? fallback.id : null;
		}

		const tab = this.tabs[index];
		if (tab.path && tab.path !== 'HOME') {
			this.recentlyClosed.push(tab.path);
		}
		this.tabs.splice(index, 1);
	}

	closeAll() {
		this.tabs = [];
		this.activeTabId = null;
	}

	setActive(id: string) {
		this.activeTabId = id;
	}

	updateTabContent(id: string, content: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.content = content;
		}
	}

	updateTabRawContent(id: string, raw: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.rawContent = raw;
			tab.isDirty = tab.rawContent !== tab.originalContent;
		}
	}

	setTabRawContent(id: string, raw: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.rawContent = raw;
			tab.originalContent = raw;
			tab.isDirty = false;
		}
	}

	updateTabScroll(id: string, scrollTop: number) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.scrollTop = scrollTop;
		}
	}

	updateTabEditorState(id: string, viewState: any) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.editorViewState = viewState;
		}
	}

	updateTabScrollPercentage(id: string, percentage: number) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.scrollPercentage = percentage;
		}
	}

	updateTabAnchorLine(id: string, line: number) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.anchorLine = line;
		}
	}

	toggleSplit(id: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			this.setSplitEnabled(id, !tab.isSplit);
		}
	}

	setSplitEnabled(id: string, enabled: boolean) {
		const tab = this.tabs.find((t) => t.id === id);
		if (!tab) return;

		tab.isSplit = enabled;
		if (enabled) {
			tab.isScrollSynced = this.splitScrollSyncPreference;
		} else {
			this.splitScrollSyncPreference = tab.isScrollSynced;
			this.saveSplitScrollSyncPreference();
		}
	}

	setSplitRatio(id: string, ratio: number) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.splitRatio = Math.max(0.1, Math.min(0.9, ratio));
		}
	}

	toggleScrollSync(id: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.isScrollSynced = !tab.isScrollSynced;
			this.splitScrollSyncPreference = tab.isScrollSynced;
			this.saveSplitScrollSyncPreference();
		}
	}


	reorderTabs(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex) return;
		const [moved] = this.tabs.splice(fromIndex, 1);
		this.tabs.splice(toIndex, 0, moved);
	}

	cycleTab(direction: 'next' | 'prev') {
		if (this.tabs.length < 2) return;
		const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
		if (currentIndex === -1) return;

		let nextIndex: number;
		if (direction === 'next') {
			nextIndex = (currentIndex + 1) % this.tabs.length;
		} else {
			nextIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
		}
		this.activeTabId = this.tabs[nextIndex].id;
	}

	updateTabPath(id: string, path: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.path = path;
			tab.title = path.split(/[/\\]/).pop() || 'Untitled';
			tab.isDirty = false;
			const fileHistory = replaceCurrentHistoryEntry({
				currentPath: tab.path,
				targetPath: path,
				history: tab.history,
				historyIndex: tab.historyIndex,
			});
			tab.history = fileHistory.history;
			tab.historyIndex = fileHistory.historyIndex;
		}
	}

	renameTab(id: string, newPath: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.path = newPath;
			tab.title = newPath.split(/[/\\]/).pop() || 'Untitled';
			const fileHistory = replaceCurrentHistoryEntry({
				currentPath: tab.path,
				targetPath: newPath,
				history: tab.history,
				historyIndex: tab.historyIndex,
			});
			tab.history = fileHistory.history;
			tab.historyIndex = fileHistory.historyIndex;
		}
	}

	navigate(id: string, path: string) {
		const tab = this.tabs.find(t => t.id === id);
		if (tab) {
			if (tab.path === path) return;

			const fileHistory = navigateFileHistory({
				currentPath: tab.path,
				targetPath: path,
				history: tab.history,
				historyIndex: tab.historyIndex,
			});
			tab.history = fileHistory.history;
			tab.historyIndex = fileHistory.historyIndex;

			tab.path = path;
			tab.title = path.split(/[/\\]/).pop() || 'Untitled';
			tab.isDirty = false;
			tab.scrollTop = 0;
		}
	}

	canGoBack(id: string): boolean {
		const tab = this.tabs.find(t => t.id === id);
		return tab ? canGoBackInHistory(tab) : false;
	}

	canGoForward(id: string): boolean {
		const tab = this.tabs.find(t => t.id === id);
		return tab ? canGoForwardInHistory(tab) : false;
	}

	goBack(id: string): string | null {
		const tab = this.tabs.find(t => t.id === id);
		if (tab) {
			const result = goBackInHistory(tab);
			if (!result.path) return null;
			const path = result.path;
			tab.history = result.history;
			tab.historyIndex = result.historyIndex;
			tab.path = path;
			tab.title = path.split(/[/\\]/).pop() || 'Untitled';
			tab.isDirty = false;
			return path;
		}
		return null;
	}

	goForward(id: string): string | null {
		const tab = this.tabs.find(t => t.id === id);
		if (tab) {
			const result = goForwardInHistory(tab);
			if (!result.path) return null;
			const path = result.path;
			tab.history = result.history;
			tab.historyIndex = result.historyIndex;
			tab.path = path;
			tab.title = path.split(/[/\\]/).pop() || 'Untitled';
			tab.isDirty = false;
			return path;
		}
		return null;
	}

	recentlyClosed = $state<string[]>([]);

	popRecentlyClosed() {
		return this.recentlyClosed.pop();
	}
}

export const tabManager = new TabManager();
