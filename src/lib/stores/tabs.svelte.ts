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
}

class TabManager {
	tabs = $state<Tab[]>([]);
	activeTabId = $state<string | null>(null);

	get activeTab() {
		return this.tabs.find((t) => t.id === this.activeTabId);
	}

	addTab(path: string, content: string = '', rawContent: string = '') {
		const existing = this.tabs.find((t) => t.path === path);
		if (existing) {
			this.activeTabId = existing.id;
			return;
		}

		const id = crypto.randomUUID();
		const title = path.split(/[/\\]/).pop() || 'Untitled';

		this.tabs.push({
			id,
			path,
			title,
			content,
			rawContent,
			originalContent: rawContent,
			scrollTop: 0,
			isDirty: false,
			isEditing: false
		});
		this.activeTabId = id;
	}

	addNewTab() {
		const id = crypto.randomUUID();
		this.tabs.push({
			id,
			path: '',
			title: 'Untitled',
			content: '',
			rawContent: '',
			originalContent: '',
			scrollTop: 0,
			isDirty: false,
			isEditing: true
		});
		this.activeTabId = id;
	}

	addHomeTab() {
		const id = crypto.randomUUID();
		this.tabs.push({
			id,
			path: '',
			title: 'Recents',
			content: '',
			rawContent: '',
			originalContent: '',
			scrollTop: 0,
			isDirty: false,
			isEditing: false
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
		if (tab.path) {
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
		}
	}

	renameTab(id: string, newPath: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.path = newPath;
			tab.title = newPath.split(/[/\\]/).pop() || 'Untitled';
		}
	}

	recentlyClosed = $state<string[]>([]);

	popRecentlyClosed() {
		return this.recentlyClosed.pop();
	}
}

export const tabManager = new TabManager();
