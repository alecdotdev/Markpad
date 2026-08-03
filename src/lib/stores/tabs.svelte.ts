import { t } from '../utils/i18n.js';
import { nextUntitledTitle } from '../utils/untitledTitle.js';
import { settings } from './settings.svelte.js';
import { hasRealFilePath } from '../utils/tabFileActions.js';
import { buildTransferredTab, type TransferableTab } from '../utils/tabTransfer.js';
import { canonicalizePath, isSameFilePath } from '../utils/pathIdentity.js';
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
	/**
	 * `path` as the FILESYSTEM identifies it: case folded, Unicode normalized
	 * and symlinks resolved, the way the volume itself does those (see the Rust
	 * `canonical_identity`). This is what "same file" means; `path` stays
	 * exactly what the user opened.
	 *
	 * The two are separate fields rather than one canonical `path` because
	 * canonicalization is lossy in a way the user can see: it would retitle a
	 * tab opened through a symlink after the link's target, rewrite the recent
	 * files list and "Copy path" with a name the user never typed, and mutate
	 * `path` on its own whenever a file is deleted and recreated under another
	 * spelling. A path also cannot always be canonicalized — Save As names a
	 * file that does not exist yet — so a single field would be canonical only
	 * *sometimes*, which is worse than a second field that is explicitly either
	 * known or not.
	 *
	 * Optional, and the safe direction: absent means "not resolved", and every
	 * comparison then falls back to exact path equality — what it did before.
	 * A construction site that forgets it therefore loses the improvement and
	 * nothing else, which is why this is `?` where `hasReplacementChars`, whose
	 * missing value would read as "safe to overwrite", is not.
	 */
	pathKey?: string;
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
			// Snapshots store paths as they were typed, and the restore reads
			// each file directly rather than through `loadMarkdown`, so nothing
			// else would ever resolve these. Without this a restored window sits
			// outside the one-tab-per-file rule until every tab happens to be
			// reopened. Resolving in the background is safe because it only ever
			// ADDS an identity — no tab is closed or reassigned here.
			for (const tab of restored) {
				void canonicalizePath(tab.path).then((key) => this.setTabPathKey(tab.id, tab.path, key));
			}
		} catch (e) {
			console.error('Failed to restore tab state', e);
		}
	}

	/**
	 * A file path identifies a tab: at most one tab per window may hold a given
	 * path. Two tabs on the same file are two independent buffers with two
	 * independent dirty flags and two auto-save timers writing the same file in
	 * turn, so whichever lands last silently overwrites the other's work — and
	 * the store is the only place that can rule it out, because every duplicate
	 * arrives through a different caller (a link opened in a new tab, Save As
	 * onto an open file, a tab moved in from another window).
	 *
	 * Mainstream editors make this state unrepresentable rather than merely
	 * unlikely: VS Code keys one `ITextModel` per file URI and points every
	 * editor at it, and Sublime Text's Open File links to the view that already
	 * holds the buffer (`clone_file` makes a second VIEW of the SAME buffer,
	 * never a second buffer). Markpad has no buffer/view split — a tab is the
	 * buffer — so the equivalent invariant is one tab per path.
	 *
	 * Resolving a conflict must not cost the user anything, so the loser is
	 * handled by what it has to lose:
	 * - clean: closed, since its buffer is a copy of the file the winner now
	 *   holds. It lands on the reopen-closed-tab stack like any other close.
	 * - dirty: kept, with its buffer intact, but its claim on the path is
	 *   released (it becomes untitled). Nothing is discarded and nothing can
	 *   auto-save over the file behind the user's back; saving it asks where to
	 *   put it, which is the one decision only the user can make.
	 *
	 * Only real file paths are exclusive: untitled tabs (`''`) and the home
	 * sentinel are not files, and several untitled tabs are normal.
	 *
	 * "The same path" means the same FILE, not the same string: `/notes/A.md`
	 * and `/notes/a.md` are one file on macOS and Windows, and two tabs on them
	 * are exactly the two auto-save timers this rule exists to prevent. The
	 * caller supplies `pathKey` — the filesystem's own answer, resolved once
	 * when the path entered the app — and `isSameFilePath` falls back to exact
	 * equality when either side does not have one, which is what the callers
	 * that cannot resolve a path yet get.
	 */
	private claimPath(path: string, claimantId: string, pathKey?: string) {
		if (!hasRealFilePath(path)) return;
		const incoming = { path, pathKey };
		for (const other of this.tabs.filter((t) => t.id !== claimantId && isSameFilePath(t, incoming))) {
			if (!other.isDirty) {
				this.closeTab(other.id);
				continue;
			}
			other.path = '';
			// The buffer no longer claims a file, so it must not keep the file's
			// identity either — a stale key would make this tab collide with the
			// next tab to open that file.
			other.pathKey = undefined;
			// The title still names the file the buffer came from — that is what
			// makes the tab recognizable, and `saveContent` offers it as the
			// default filename when the user places it.
			other.history = [''];
			other.historyIndex = 0;
		}
	}

	addTab(path: string, content: string = '', pathKey?: string) {
		// Opening a file that is already open activates that tab instead of
		// building a second buffer for it — VS Code and Sublime Text both
		// resolve an open request to the existing view. `content` is ignored in
		// that case on purpose: the open tab may hold unsaved edits, and a
		// freshly read copy of the file would erase them.
		if (hasRealFilePath(path)) {
			const existing = this.tabs.find((t) => isSameFilePath(t, { path, pathKey }));
			if (existing) {
				this.activeTabId = existing.id;
				return;
			}
		}

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
			hasReplacementChars: false,
			pathKey
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
		// The destination window may already have this file open, which would
		// leave the arriving buffer and the resident one saving over each other.
		// The payload carries the path as the source window had it, not its
		// identity, so this first claim compares literally.
		this.claimPath(tab.path, tab.id);
		this.tabs.push(tab);
		this.activeTabId = tab.id;
		// A transferred tab is never read from disk here — its buffer came with
		// it — so nothing else would ever resolve its path, and it would sit out
		// the one-tab-per-file rule for as long as it stayed open. Resolving it
		// in the background cannot undo the claim above, but it does let every
		// LATER open of the same file recognise this tab.
		void canonicalizePath(tab.path).then((key) => this.setTabPathKey(tab.id, tab.path, key));
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

	/**
	 * Record the filesystem's answer for a tab whose path arrived through a
	 * route that could not resolve it — back/forward, a link opened in a new
	 * tab, a cross-window move, a restored window. `loadMarkdown` reads the
	 * file anyway, so it resolves the path in the same breath and reports it
	 * here, which is what turns those tabs from "unresolved, compared
	 * literally" into full participants in the one-tab-per-file rule.
	 *
	 * Guarded on the path still matching: the tab may have been navigated
	 * elsewhere while the resolution was in flight, and a key describing a file
	 * the tab no longer holds is worse than no key at all.
	 */
	setTabPathKey(id: string, path: string, pathKey: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab && tab.path === path) tab.pathKey = pathKey;
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

	updateTabPath(id: string, path: string, pathKey?: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			// Save As can name a file that is already open here; the write has
			// happened by the time this runs, so the other tab's buffer is
			// already stale and must stop claiming the path.
			this.claimPath(path, id, pathKey);
			tab.path = path;
			tab.pathKey = pathKey;
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

	renameTab(id: string, newPath: string, pathKey?: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			this.claimPath(newPath, id, pathKey);
			tab.path = newPath;
			// The old key described the old name, so keeping it would make this
			// tab answer "same file" for a file it no longer holds. Unset is the
			// honest state until something resolves the new path.
			tab.pathKey = pathKey;
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

	navigate(id: string, path: string, pathKey?: string) {
		const tab = this.tabs.find(t => t.id === id);
		if (tab) {
			if (tab.path === path) return;

			// Following a link to a file another tab already holds. The caller
			// has read that file and is about to put its text in THIS tab, so
			// declining the navigation is not an option: the tab would keep its
			// old path and get the other document's content, and the next save
			// would write it to the wrong file.
			this.claimPath(path, id, pathKey);

			const fileHistory = navigateFileHistory({
				currentPath: tab.path,
				targetPath: path,
				history: tab.history,
				historyIndex: tab.historyIndex,
			});
			tab.history = fileHistory.history;
			tab.historyIndex = fileHistory.historyIndex;

			tab.path = path;
			tab.pathKey = pathKey;
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
			// Back/forward walk this tab's own history, which can lead to a file
			// that has since been opened in another tab. History holds the paths
			// as they were typed, not their identities, so this claim compares
			// literally; the caller loads the file straight afterwards and
			// `loadMarkdown` resolves the key then.
			this.claimPath(path, id);
			tab.history = result.history;
			tab.historyIndex = result.historyIndex;
			tab.path = path;
			tab.pathKey = undefined;
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
			this.claimPath(path, id);
			tab.history = result.history;
			tab.historyIndex = result.historyIndex;
			tab.path = path;
			tab.pathKey = undefined;
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
