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

	addTab(path: string, content: string = '') {
		const id = crypto.randomUUID();
		const filename = path.split('\\').pop()?.split('/').pop() || 'Untitled';

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

	addNewTab() {
		const id = crypto.randomUUID();
		const content = '';

		this.tabs.push({
			id,
			path: '',
			title: 'Untitled',
			content,
			rawContent: content,
			originalContent: content,
			scrollTop: 0,
			isDirty: false,
			isEditing: true, // Start in edit mode
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
		// Check if home tab exists
		const homeTab = this.tabs.find(t => t.path === 'HOME');
		if (homeTab) {
			this.activeTabId = homeTab.id;
			return;
		}

		const id = crypto.randomUUID();
		this.tabs.push({
			id,
			path: 'HOME',
			title: 'Home',
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

	closeTab(id: string) {
		const index = this.tabs.findIndex((t) => t.id === id);
		if (index === -1) return;

		if (this.activeTabId === id) {
			const fallback = this.tabs[index + 1] || this.tabs[index - 1];
			this.activeTabId = fallback ? fallback.id : null;
		}

		const tab = this.tabs[index];
		// Don't add HOME to history
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
			// If we update path (e.g. save untitled), strictly speaking it replaces the current history entry
			if (tab.history.length > 0) {
				tab.history[tab.historyIndex] = path;
			} else {
				tab.history = [path];
				tab.historyIndex = 0;
			}
		}
	}

	renameTab(id: string, newPath: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.path = newPath;
			tab.title = newPath.split(/[/\\]/).pop() || 'Untitled';
			if (tab.history.length > 0) {
				tab.history[tab.historyIndex] = newPath;
			}
		}
	}

	// Navigation History
	navigate(id: string, path: string) {
		const tab = this.tabs.find(t => t.id === id);
		if (tab) {
			// If we are "navigating" to the same path, do nothing (or reload?)
			if (tab.path === path) return;

			// Truncate forward history
			tab.history = tab.history.slice(0, tab.historyIndex + 1);
			tab.history.push(path);
			tab.historyIndex++;

			tab.path = path;
			tab.title = path.split(/[/\\]/).pop() || 'Untitled';
			tab.isDirty = false;
			tab.scrollTop = 0;
		}
	}

	canGoBack(id: string): boolean {
		const tab = this.tabs.find(t => t.id === id);
		return tab ? tab.historyIndex > 0 : false;
	}

	canGoForward(id: string): boolean {
		const tab = this.tabs.find(t => t.id === id);
		return tab ? tab.historyIndex < tab.history.length - 1 : false;
	}

	goBack(id: string): string | null {
		const tab = this.tabs.find(t => t.id === id);
		if (tab && tab.historyIndex > 0) {
			tab.historyIndex--;
			const path = tab.history[tab.historyIndex];
			tab.path = path;
			tab.title = path.split(/[/\\]/).pop() || 'Untitled';
			tab.isDirty = false; // Assuming navigating away discards unsaved changes or we handle it? 
			// Ideally we should warn before navigation if dirty, but simple history for now.
			return path;
		}
		return null;
	}

	goForward(id: string): string | null {
		const tab = this.tabs.find(t => t.id === id);
		if (tab && tab.historyIndex < tab.history.length - 1) {
			tab.historyIndex++;
			const path = tab.history[tab.historyIndex];
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
