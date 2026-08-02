import { t } from '../utils/i18n.js';
import { nextUntitledTitle } from '../utils/untitledTitle.js';
import { settings } from './settings.svelte.js';
import { hasRealFilePath } from '../utils/tabFileActions.js';
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
	/**
	 * True while `rawContent` holds only the leading slice of a large file
	 * (the >50KB preview read) instead of the whole document. Such a buffer
	 * looks clean and authoritative but writing it back truncates the file,
	 * so every path that can reach disk must complete it first — see
	 * `ensureFullContent` in documentSession. Optional because tabs built
	 * from a cross-window transfer payload always arrive complete.
	 */
	isTruncated?: boolean;
	/**
	 * `rawContent` was decoded with U+FFFD substitutions because the file is
	 * not UTF-8 (GBK, Big5, Shift-JIS ...). The buffer is NOT a copy of the
	 * file and the original bytes cannot be recovered from it, so writing it
	 * back over that file destroys the document — documentSession.saveContent
	 * refuses to. Required, not optional: unlike `isTruncated` above, this one
	 * DOES travel through a transfer payload, and a construction site that
	 * forgets it would default to "safe to overwrite" — the failure mode here
	 * is a destroyed document, so the compiler asks every one of them.
	 */
	hasReplacementChars: boolean;
}

class TabManager {
	tabs = $state<Tab[]>([]);
	activeTabId = $state<string | null>(null);
	splitScrollSyncPreference = $state(false);
	windowTag = $state<{ name: string; color: string; pinned: boolean } | null>(null);

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

	setWindowTag(tag: { name: string; color: string; pinned?: boolean } | null) {
		this.windowTag = tag ? { ...tag, pinned: tag.pinned === true } : null;
	}

	/**
	 * Serialize WINDOW state only: which files are open, the active tab, and
	 * per-tab UI (edit mode, split, scroll). Document content always lives on
	 * disk — the snapshot never carries rawContent, so unsaved changes are
	 * handled exclusively by the close dialogs, never smuggled through here.
	 * Untitled tabs have no disk backing and are resolved at close, so they
	 * are not persisted.
	 *
	 * The filter is `hasRealFilePath`, not `path !== ''`: the home screen sits
	 * in a tab whose path is the sentinel string `'HOME'`, which passes the
	 * non-empty test and used to be written into the snapshot. Restoring it
	 * then asked the backend to read a file called `HOME`, and the failure left
	 * a permanently unreadable phantom tab — or, when HOME was the only tab, a
	 * window that came back empty.
	 */
	serializeState(): string {
		const stateData = {
			version: 2,
			windowTag: this.windowTag,
			activeTabId: this.activeTabId,
			tabs: this.tabs
				.filter((t) => hasRealFilePath(t.path))
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
	 *
	 * Entries are accepted only for real file paths. Snapshots written by
	 * earlier builds can still contain the `'HOME'` sentinel, so the read side
	 * has to reject it too — otherwise those users keep restoring a tab that
	 * can never be read.
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
				this.setWindowTag({
					name: data.windowTag.name,
					color: data.windowTag.color,
					pinned: data.windowTag.pinned === true,
				});
			}

			const restored: Tab[] = [];
			for (const saved of data.tabs) {
				if (!saved || typeof saved.path !== 'string' || !hasRealFilePath(saved.path)) continue;
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
					isScrollSynced: saved.isScrollSynced === true,
					isTruncated: false,
					hasReplacementChars: false
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
			isScrollSynced: false,
			isTruncated: false,
			hasReplacementChars: false
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
			isScrollSynced: false,
			isTruncated: false,
			hasReplacementChars: false
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
			isScrollSynced: false,
			isTruncated: false,
			hasReplacementChars: false
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

	/**
	 * Replace a tab's buffer with what was just read from disk: the new text
	 * becomes both the buffer and the saved baseline, so the tab is clean.
	 *
	 * `isTruncated` says whether that read covered the whole file. It defaults
	 * to false because every caller but the large-file preview read supplies a
	 * complete document, and a stale `true` is the dangerous direction: it
	 * would block saving a file that is actually intact. The opposite mistake
	 * — a partial buffer that claims to be whole — is what truncates files, so
	 * the preview read must pass it explicitly.
	 */
	setTabRawContent(id: string, raw: string, isTruncated = false) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.rawContent = raw;
			tab.originalContent = raw;
			tab.isDirty = false;
			tab.isTruncated = isTruncated;
		}
	}

	/**
	 * The tab's file could not be read. The tab stays open with its path — the
	 * file may be on a share that is temporarily down, a drive that is not
	 * plugged in, or a file another program has locked, and none of those are
	 * the user's decision to close a document — but its empty buffer is flagged
	 * incomplete so nothing can mistake it for the document and write it back.
	 *
	 * This is the same flag the large-file preview read uses, deliberately: it
	 * already means "this buffer is not the whole file", every writer already
	 * refuses it, and `documentSession.ensureFullContent` already re-reads the
	 * file and clears the flag the next time the user opens the tab for
	 * editing — which is how a tab recovers once the drive is plugged back in.
	 *
	 * A dirty buffer is never touched: unsaved text the user typed outranks a
	 * failed read of the file it came from.
	 */
	markTabContentUnavailable(id: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (!tab || tab.isDirty) return;
		tab.rawContent = '';
		tab.originalContent = '';
		tab.isTruncated = true;
	}

	/**
	 * Record whether this buffer came from a lossy decode. Set on every load,
	 * both ways: a file the user has since converted to UTF-8 must clear the
	 * flag, and Save As clears it once the buffer has a UTF-8 file of its own.
	 */
	setTabDecodedLossy(id: string, lossy: boolean) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.hasReplacementChars = lossy;
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
