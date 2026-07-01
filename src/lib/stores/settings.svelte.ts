import { invoke } from '@tauri-apps/api/core';
import {
	DEFAULT_EDITOR_TOOLBAR_ORDER,
	applyEditorToolbarMove,
	getEditorToolbarAdjacentMove,
	getEditorToolbarReorderMove,
	normalizeEditorToolbarHidden,
	normalizeEditorToolbarOrder,
} from '../utils/editorToolbar.js';
import {
	DEFAULT_TITLEBAR_TOOLBAR_ORDER,
	DEFAULT_TITLEBAR_TOOLBAR_PLACEMENT,
	applyTitlebarToolbarMove,
	getTitlebarToolbarAdjacentMove,
	getTitlebarToolbarReorderMove,
	normalizeTitlebarToolbarHidden,
	normalizeTitlebarToolbarOrder,
	normalizeTitlebarToolbarPlacement,
	type TitlebarToolbarPlacement,
} from '../utils/titlebarToolbar.js';

export type OSType = 'macos' | 'windows' | 'linux' | 'unknown';
export type LanguageCode =
	| 'en' // English
	| 'ja' // Japanese
	| 'zh-CN' // Chinese (Simplified)
	| 'zh-TW' // Chinese (Traditional)
	| 'ko' // Korean
	| 'ru' // Russian
	| 'es' // Spanish
	| 'fr' // French
	| 'de' // German
	| 'pt-BR' // Portuguese (Brazil)
	| 'it' // Italian
	| 'pl' // Polish
	| 'nl' // Dutch
	| 'sv' // Swedish
	| 'vi' // Vietnamese
	| 'pt' // Portuguese (European)
	| 'ro' // Romanian
	| 'hu' // Hungarian
	| 'cs' // Czech
	| 'sk' // Slovak
	| 'el' // Greek
	| 'fi' // Finnish
	| 'da' // Danish
	| 'no' // Norwegian
	| 'id' // Indonesian
	| 'tr'; // Turkish

export const SUPPORTED_LANGUAGES: { code: LanguageCode; name: string; nativeName: string }[] = [
	{ code: 'cs', name: 'Czech', nativeName: 'Čeština' },
	{ code: 'da', name: 'Danish', nativeName: 'Dansk' },
	{ code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
	{ code: 'en', name: 'English', nativeName: 'English' },
	{ code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
	{ code: 'fr', name: 'French', nativeName: 'Français' },
	{ code: 'de', name: 'German', nativeName: 'Deutsch' },
	{ code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
	{ code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
	{ code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
	{ code: 'it', name: 'Italian', nativeName: 'Italiano' },
	{ code: 'ja', name: 'Japanese', nativeName: '日本語' },
	{ code: 'ko', name: 'Korean', nativeName: '한국어' },
	{ code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
	{ code: 'pl', name: 'Polish', nativeName: 'Polski' },
	{ code: 'pt', name: 'Portuguese (European)', nativeName: 'Português (Europeu)' },
	{ code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
	{ code: 'ro', name: 'Romanian', nativeName: 'Română' },
	{ code: 'ru', name: 'Russian', nativeName: 'Русский' },
	{ code: 'sk', name: 'Slovak', nativeName: 'Slovenčina' },
	{ code: 'es', name: 'Spanish', nativeName: 'Español' },
	{ code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
	{ code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
	{ code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
	{ code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
	{ code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
];

function detectSystemLanguage(): LanguageCode {
	if (typeof navigator !== 'undefined') {
		const browserLang = navigator.language.toLowerCase();
		if (browserLang.startsWith('zh')) {
			if (browserLang === 'zh-tw' || browserLang === 'zh-hk') return 'zh-TW';
			return 'zh-CN';
		}
		if (browserLang.startsWith('ja')) return 'ja';
		if (browserLang.startsWith('ko')) return 'ko';
		if (browserLang.startsWith('ru')) return 'ru';
		if (browserLang.startsWith('es')) return 'es';
		if (browserLang.startsWith('fr')) return 'fr';
		if (browserLang.startsWith('de')) return 'de';
		if (browserLang.startsWith('pt')) {
			if (browserLang === 'pt-br') return 'pt-BR';
			return 'pt';
		}
		if (browserLang.startsWith('it')) return 'it';
		if (browserLang.startsWith('pl')) return 'pl';
		if (browserLang.startsWith('nl')) return 'nl';
		if (browserLang.startsWith('sv')) return 'sv';
		if (browserLang.startsWith('vi')) return 'vi';
		if (browserLang.startsWith('ro')) return 'ro';
		if (browserLang.startsWith('hu')) return 'hu';
		if (browserLang.startsWith('cs')) return 'cs';
		if (browserLang.startsWith('sk')) return 'sk';
		if (browserLang.startsWith('el')) return 'el';
		if (browserLang.startsWith('fi')) return 'fi';
		if (browserLang.startsWith('da')) return 'da';
		if (browserLang.startsWith('no')) return 'no';
		if (browserLang.startsWith('id')) return 'id';
		if (browserLang.startsWith('tr')) return 'tr';
	}
	return 'en';
}

export interface DefaultFonts {
	editorFont: string;
	previewFont: string;
	codeFont: string;
}

export const DEFAULT_FONTS: Record<OSType, DefaultFonts> = {
	macos: {
		editorFont: 'Menlo',
		previewFont: 'Helvetica Neue',
		codeFont: 'Menlo',
	},
	windows: {
		editorFont: 'Consolas',
		previewFont: 'Segoe UI',
		codeFont: 'Consolas',
	},
	linux: {
		editorFont: 'Monospace',
		previewFont: 'system-ui',
		codeFont: 'Monospace',
	},
	unknown: {
		editorFont: 'Consolas',
		previewFont: 'Segoe UI',
		codeFont: 'Consolas',
	},
};

export class SettingsStore {
	minimap = $state(false);
	wordWrap = $state('on');
	lineNumbers = $state('on');
	vimMode = $state(false);
	statusBar = $state(true);
	wordCount = $state(false);
	renderLineHighlight = $state('line');
	highlightColor = $state('yellow');
	showTabs = $state(true);
	restoreStateOnReopen = $state(true);
	zenMode = $state(false);
	showToc = $state(false);
	preZenState = $state<{
		renderLineHighlight: string;
		showTabs: boolean;
		statusBar: boolean;
		minimap: boolean;
		lineNumbers: string;
		showToc: boolean;
	} | null>(null);
	occurrencesHighlight = $state(false);
	showWhitespace = $state(false);
	startInEditor = $state(false);
	newFileDefaultMode = $state(true);
	showRecentFiles = $state(true);
	editorMaxWidth = $state(80);
	pinnedToc = $state(false);
	tocSide = $state<'left' | 'right'>('left');
	tocWidth = $state(240);
	osType = $state<OSType>('unknown');
	imageDirectory = $state('img');
	macosImageScaling = $state(true);
	language = $state<LanguageCode>('en');
	editorToolbarOrder = $state<string[]>([...DEFAULT_EDITOR_TOOLBAR_ORDER]);
	editorToolbarHidden = $state<string[]>([]);
	titlebarToolbarOrder = $state<string[]>([...DEFAULT_TITLEBAR_TOOLBAR_ORDER]);
	titlebarToolbarHidden = $state<string[]>([]);
	titlebarToolbarPlacement = $state<Record<string, TitlebarToolbarPlacement>>({ ...DEFAULT_TITLEBAR_TOOLBAR_PLACEMENT });

	editorFont = $state('Consolas');
	editorFontSize = $state(14);
	previewFont = $state('Segoe UI');
	previewFontSize = $state(16);
	codeFont = $state('Consolas');
	codeFontSize = $state(14);

	// File-save behavior. autoSave = silently persist edits without Cmd+S.
	// confirmBeforeSave = if true, keep the unsaved-changes modals on close/toggle
	// (i.e. ask for confirmation) even when autoSave is on.
	autoSave = $state(true);
	confirmBeforeSave = $state(false);

	constructor() {
		if (typeof localStorage !== 'undefined') {
			const savedMinimap = localStorage.getItem('editor.minimap');
			const savedWordWrap = localStorage.getItem('editor.wordWrap');
			const savedLineNumbers = localStorage.getItem('editor.lineNumbers');
			const savedVimMode = localStorage.getItem('editor.vimMode');
			const savedStatusBar = localStorage.getItem('editor.statusBar');

			const savedWordCount = localStorage.getItem('editor.wordCount');
			const savedRenderLineHighlight = localStorage.getItem('editor.renderLineHighlight');
			const savedShowTabs = localStorage.getItem('editor.showTabs');
			const savedRestoreStateOnReopen = localStorage.getItem('editor.restoreStateOnReopen');
			const savedZenMode = localStorage.getItem('editor.zenMode');
			const savedPreZenState = localStorage.getItem('editor.preZenState');
			const savedOccurrencesHighlight = localStorage.getItem('editor.occurrencesHighlight');
			const savedShowWhitespace = localStorage.getItem('editor.showWhitespace');
			const savedShowToc = localStorage.getItem('editor.showToc');
			const savedHighlightColor = localStorage.getItem('editor.highlightColor');
			const savedStartInEditor = localStorage.getItem('editor.startInEditor');
			const savedNewFileDefaultMode = localStorage.getItem('editor.newFileDefaultMode');
			const savedShowRecentFiles = localStorage.getItem('editor.showRecentFiles');
			const savedEditorMaxWidth = localStorage.getItem('editor.maxWidth');
			const savedPinnedToc = localStorage.getItem('editor.pinnedToc');
			const savedTocSide = localStorage.getItem('editor.tocSide');
			const savedTocWidth = localStorage.getItem('editor.tocWidth');
			const savedImageDirectory = localStorage.getItem('editor.imageDirectory');
			const savedMacosImageScaling = localStorage.getItem('editor.macosImageScaling');
			const savedLanguage = localStorage.getItem('editor.language');
			const savedEditorToolbarOrder = localStorage.getItem('editor.toolbarOrder');
			const savedEditorToolbarHidden = localStorage.getItem('editor.toolbarHidden');
			const savedTitlebarToolbarOrder = localStorage.getItem('titlebar.toolbarOrder');
			const savedTitlebarToolbarHidden = localStorage.getItem('titlebar.toolbarHidden');
			const savedTitlebarToolbarPlacement = localStorage.getItem('titlebar.toolbarPlacement');

			const savedEditorFont = localStorage.getItem('editor.font');
			const savedEditorFontSize = localStorage.getItem('editor.fontSize');
			const savedPreviewFont = localStorage.getItem('preview.font');
			const savedPreviewFontSize = localStorage.getItem('preview.fontSize');
			const savedCodeFont = localStorage.getItem('preview.codeFont');
			const savedCodeFontSize = localStorage.getItem('preview.codeFontSize');

			const savedAutoSave = localStorage.getItem('editor.autoSave');
			const savedConfirmBeforeSave = localStorage.getItem('editor.confirmBeforeSave');
			if (savedAutoSave !== null) this.autoSave = savedAutoSave === 'true';
			if (savedConfirmBeforeSave !== null) this.confirmBeforeSave = savedConfirmBeforeSave === 'true';

			const parseFontSize = (value: string | null, fallback: number, min: number, max: number) => {
				if (value === null) return fallback;
				const parsed = Number.parseInt(value, 10);
				if (!Number.isFinite(parsed)) return fallback;
				return Math.min(max, Math.max(min, parsed));
			};
			const parseStringList = (value: string | null) => {
				if (value === null) return null;
				try {
					const parsed = JSON.parse(value);
					return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : null;
				} catch {
					return null;
				}
			};
			const parseRecord = (value: string | null) => {
				if (value === null) return null;
				try {
					const parsed = JSON.parse(value);
					return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
				} catch {
					return null;
				}
			};

			if (savedMinimap !== null) this.minimap = savedMinimap === 'true';
			if (savedWordWrap !== null) this.wordWrap = savedWordWrap;
			if (savedLineNumbers !== null) this.lineNumbers = savedLineNumbers;
			if (savedVimMode !== null) this.vimMode = savedVimMode === 'true';
			if (savedStatusBar !== null) this.statusBar = savedStatusBar === 'true';

			if (savedWordCount !== null) this.wordCount = savedWordCount === 'true';
			if (savedRenderLineHighlight !== null) this.renderLineHighlight = savedRenderLineHighlight;
			if (savedShowTabs !== null) this.showTabs = savedShowTabs === 'true';
			if (savedRestoreStateOnReopen !== null) this.restoreStateOnReopen = savedRestoreStateOnReopen === 'true';
			if (savedZenMode !== null) this.zenMode = savedZenMode === 'true';
			if (savedOccurrencesHighlight !== null) this.occurrencesHighlight = savedOccurrencesHighlight === 'true';
			if (savedShowWhitespace !== null) this.showWhitespace = savedShowWhitespace === 'true';
			if (savedShowToc !== null) this.showToc = savedShowToc === 'true';
			if (savedHighlightColor !== null) this.highlightColor = savedHighlightColor;
			if (savedStartInEditor !== null) this.startInEditor = savedStartInEditor === 'true';
			if (savedNewFileDefaultMode !== null) this.newFileDefaultMode = savedNewFileDefaultMode === 'true';
			if (savedShowRecentFiles !== null) this.showRecentFiles = savedShowRecentFiles === 'true';
			if (savedEditorMaxWidth !== null) this.editorMaxWidth = parseFontSize(savedEditorMaxWidth, 80, 20, 500);
			if (savedPinnedToc !== null) this.pinnedToc = savedPinnedToc === 'true';
			if (savedTocSide !== null) this.tocSide = savedTocSide as 'left' | 'right';
			if (savedTocWidth !== null) this.tocWidth = parseFontSize(savedTocWidth, 240, 180, 420);
			if (savedImageDirectory !== null) this.imageDirectory = savedImageDirectory;
			if (savedMacosImageScaling !== null) this.macosImageScaling = savedMacosImageScaling === 'true';
			this.editorToolbarOrder = normalizeEditorToolbarOrder(parseStringList(savedEditorToolbarOrder));
			this.editorToolbarHidden = normalizeEditorToolbarHidden(parseStringList(savedEditorToolbarHidden));
			this.titlebarToolbarOrder = normalizeTitlebarToolbarOrder(parseStringList(savedTitlebarToolbarOrder));
			this.titlebarToolbarHidden = normalizeTitlebarToolbarHidden(parseStringList(savedTitlebarToolbarHidden));
			this.titlebarToolbarPlacement = normalizeTitlebarToolbarPlacement(parseRecord(savedTitlebarToolbarPlacement));
			if (savedLanguage !== null) {
				const lang = savedLanguage as LanguageCode;
				const supportedCodes: LanguageCode[] = ['en', 'ja', 'zh-CN', 'zh-TW', 'ko', 'ru', 'es', 'fr', 'de', 'pt-BR', 'it', 'pl', 'nl', 'sv', 'vi', 'pt', 'ro', 'hu', 'cs', 'sk', 'el', 'fi', 'da', 'no', 'id', 'tr'];
				if (supportedCodes.includes(lang)) {
					this.language = lang;
				}
			} else {
				this.language = detectSystemLanguage();
			}
			if (savedPreZenState !== null) {
				try {
					this.preZenState = JSON.parse(savedPreZenState);
				} catch (e) {
					console.error('Failed to parse preZenState', e);
				}
			}

			this.initOSType().then(() => {
				const defaults = DEFAULT_FONTS[this.osType];

				if (savedEditorFont !== null) {
					this.editorFont = savedEditorFont;
				} else {
					this.editorFont = defaults.editorFont;
				}
				this.editorFontSize = parseFontSize(savedEditorFontSize, 14, 10, 24);

				if (savedPreviewFont !== null) {
					this.previewFont = savedPreviewFont;
				} else {
					this.previewFont = defaults.previewFont;
				}
				this.previewFontSize = parseFontSize(savedPreviewFontSize, 16, 12, 28);

				if (savedCodeFont !== null) {
					this.codeFont = savedCodeFont;
				} else {
					this.codeFont = defaults.codeFont;
				}
				this.codeFontSize = parseFontSize(savedCodeFontSize, 14, 10, 24);
			});

			$effect.root(() => {
				$effect(() => {
					localStorage.setItem('editor.minimap', String(this.minimap));
					localStorage.setItem('editor.wordWrap', this.wordWrap);
					localStorage.setItem('editor.lineNumbers', this.lineNumbers);
					localStorage.setItem('editor.vimMode', String(this.vimMode));
					localStorage.setItem('editor.statusBar', String(this.statusBar));

					localStorage.setItem('editor.wordCount', String(this.wordCount));
					localStorage.setItem('editor.renderLineHighlight', this.renderLineHighlight);
					localStorage.setItem('editor.showTabs', String(this.showTabs));
					localStorage.setItem('editor.restoreStateOnReopen', String(this.restoreStateOnReopen));
					localStorage.setItem('editor.zenMode', String(this.zenMode));
					localStorage.setItem('editor.occurrencesHighlight', String(this.occurrencesHighlight));
					localStorage.setItem('editor.showWhitespace', String(this.showWhitespace));
					localStorage.setItem('editor.showToc', String(this.showToc));
					localStorage.setItem('editor.highlightColor', this.highlightColor);
					localStorage.setItem('editor.startInEditor', String(this.startInEditor));
					localStorage.setItem('editor.newFileDefaultMode', String(this.newFileDefaultMode));
					localStorage.setItem('editor.showRecentFiles', String(this.showRecentFiles));
					localStorage.setItem('editor.maxWidth', String(this.editorMaxWidth));
					localStorage.setItem('editor.pinnedToc', String(this.pinnedToc));
					localStorage.setItem('editor.tocSide', this.tocSide);
					localStorage.setItem('editor.tocWidth', String(this.tocWidth));
					localStorage.setItem('editor.imageDirectory', this.imageDirectory);
					localStorage.setItem('editor.macosImageScaling', String(this.macosImageScaling));
					localStorage.setItem('editor.language', this.language);
					localStorage.setItem('editor.toolbarOrder', JSON.stringify(normalizeEditorToolbarOrder(this.editorToolbarOrder)));
					localStorage.setItem('editor.toolbarHidden', JSON.stringify(normalizeEditorToolbarHidden(this.editorToolbarHidden)));
					localStorage.setItem('titlebar.toolbarOrder', JSON.stringify(normalizeTitlebarToolbarOrder(this.titlebarToolbarOrder)));
					localStorage.setItem('titlebar.toolbarHidden', JSON.stringify(normalizeTitlebarToolbarHidden(this.titlebarToolbarHidden)));
					localStorage.setItem('titlebar.toolbarPlacement', JSON.stringify(normalizeTitlebarToolbarPlacement(this.titlebarToolbarPlacement)));
					localStorage.setItem('editor.font', this.editorFont);
					localStorage.setItem('editor.fontSize', String(this.editorFontSize));
					localStorage.setItem('preview.font', this.previewFont);
					localStorage.setItem('preview.fontSize', String(this.previewFontSize));
					localStorage.setItem('preview.codeFont', this.codeFont);
					localStorage.setItem('preview.codeFontSize', String(this.codeFontSize));
					localStorage.setItem('editor.autoSave', String(this.autoSave));
					localStorage.setItem('editor.confirmBeforeSave', String(this.confirmBeforeSave));
					if (this.preZenState) {
						localStorage.setItem('editor.preZenState', JSON.stringify(this.preZenState));
					} else {
						localStorage.removeItem('editor.preZenState');
					}
				});
			});
		}
	}

	toggleMinimap() {
		this.minimap = !this.minimap;
	}

	toggleWordWrap() {
		if (this.wordWrap === 'off') {
			this.wordWrap = 'on';
		} else if (this.wordWrap === 'on') {
			this.wordWrap = 'wordWrapColumn';
		} else {
			this.wordWrap = 'off';
		}
	}

	toggleLineNumbers() {
		this.lineNumbers = this.lineNumbers === 'on' ? 'off' : 'on';
	}

	toggleVimMode() {
		this.vimMode = !this.vimMode;
	}

	toggleStatusBar() {
		this.statusBar = !this.statusBar;
	}

	toggleWordCount() {
		this.wordCount = !this.wordCount;
	}

	toggleLineHighlight() {
		this.renderLineHighlight = this.renderLineHighlight === 'line' ? 'none' : 'line';
	}

	toggleTabs() {
		this.showTabs = !this.showTabs;
	}

	toggleRestoreStateOnReopen() {
		this.restoreStateOnReopen = !this.restoreStateOnReopen;
	}

	toggleShowRecentFiles() {
		this.showRecentFiles = !this.showRecentFiles;
	}

	toggleZenMode() {
		this.zenMode = !this.zenMode;
		if (this.zenMode) {
			this.preZenState = {
				renderLineHighlight: this.renderLineHighlight,
				showTabs: this.showTabs,
				statusBar: this.statusBar,
				minimap: this.minimap,
				lineNumbers: this.lineNumbers,
				showToc: this.showToc,
			};
			this.renderLineHighlight = 'none';
			this.showTabs = false;
			this.statusBar = false;
			this.minimap = false;
			this.lineNumbers = 'off';
			this.showToc = false;
		} else {
			if (this.preZenState) {
				this.renderLineHighlight = this.preZenState.renderLineHighlight;
				this.showTabs = this.preZenState.showTabs;
				this.statusBar = this.preZenState.statusBar;
				this.minimap = this.preZenState.minimap;
				this.lineNumbers = this.preZenState.lineNumbers;
				this.showToc = this.preZenState.showToc;
				this.preZenState = null;
			}
		}
	}

	toggleToc() {
		this.showToc = !this.showToc;
	}

	toggleOccurrencesHighlight() {
		this.occurrencesHighlight = !this.occurrencesHighlight;
	}

	toggleShowWhitespace() {
		this.showWhitespace = !this.showWhitespace;
	}

	toggleStartInEditor() {
		this.startInEditor = !this.startInEditor;
	}

	toggleNewFileDefaultMode() {
		this.newFileDefaultMode = !this.newFileDefaultMode;
	}

	togglePinnedToc() {
		this.pinnedToc = !this.pinnedToc;
	}

	toggleTocSide() {
		this.tocSide = this.tocSide === 'left' ? 'right' : 'left';
	}

	setTocWidth(width: number) {
		this.tocWidth = Math.min(420, Math.max(180, Math.round(width)));
	}

	toggleMacosImageScaling() {
		this.macosImageScaling = !this.macosImageScaling;
	}

	toggleAutoSave() {
		this.autoSave = !this.autoSave;
	}

	toggleConfirmBeforeSave() {
		this.confirmBeforeSave = !this.confirmBeforeSave;
	}

	setLanguage(lang: LanguageCode) {
		this.language = lang;
	}

	setEditorToolbarToolVisible(id: string, visible: boolean) {
		const hidden = normalizeEditorToolbarHidden(this.editorToolbarHidden);
		if (visible) {
			this.editorToolbarHidden = hidden.filter((hiddenId) => hiddenId !== id);
		} else if (!hidden.includes(id)) {
			this.editorToolbarHidden = normalizeEditorToolbarHidden([...hidden, id]);
		}
	}

	moveEditorToolbarTool(id: string, direction: 'up' | 'down') {
		const move = getEditorToolbarAdjacentMove(this.editorToolbarOrder, id, direction);
		if (!move) return;
		this.editorToolbarOrder = applyEditorToolbarMove(this.editorToolbarOrder, move);
	}

	reorderEditorToolbarTool(draggedId: string, targetId: string) {
		const move = getEditorToolbarReorderMove(this.editorToolbarOrder, draggedId, targetId);
		if (!move) return;
		this.editorToolbarOrder = applyEditorToolbarMove(this.editorToolbarOrder, move);
	}

	resetEditorToolbar() {
		this.editorToolbarOrder = [...DEFAULT_EDITOR_TOOLBAR_ORDER];
		this.editorToolbarHidden = [];
	}

	setTitlebarToolbarActionVisible(id: string, visible: boolean) {
		const hidden = normalizeTitlebarToolbarHidden(this.titlebarToolbarHidden);
		if (visible) {
			this.titlebarToolbarHidden = hidden.filter((hiddenId) => hiddenId !== id);
		} else if (!hidden.includes(id)) {
			this.titlebarToolbarHidden = normalizeTitlebarToolbarHidden([...hidden, id]);
		}
	}

	setTitlebarToolbarActionPlacement(id: string, placement: TitlebarToolbarPlacement) {
		this.titlebarToolbarPlacement = normalizeTitlebarToolbarPlacement({
			...this.titlebarToolbarPlacement,
			[id]: placement,
		});
	}

	moveTitlebarToolbarAction(id: string, direction: 'up' | 'down') {
		const move = getTitlebarToolbarAdjacentMove(this.titlebarToolbarOrder, id, direction);
		if (!move) return;
		this.titlebarToolbarOrder = applyTitlebarToolbarMove(this.titlebarToolbarOrder, move);
	}

	reorderTitlebarToolbarAction(draggedId: string, targetId: string) {
		const move = getTitlebarToolbarReorderMove(this.titlebarToolbarOrder, draggedId, targetId);
		if (!move) return;
		this.titlebarToolbarOrder = applyTitlebarToolbarMove(this.titlebarToolbarOrder, move);
	}

	resetTitlebarToolbar() {
		this.titlebarToolbarOrder = [...DEFAULT_TITLEBAR_TOOLBAR_ORDER];
		this.titlebarToolbarHidden = [];
		this.titlebarToolbarPlacement = { ...DEFAULT_TITLEBAR_TOOLBAR_PLACEMENT };
	}

	resetEditorMaxWidth() {
		this.editorMaxWidth = 80;
	}

	async initOSType() {
		try {
			const osType = await invoke<string>('get_os_type');
			this.osType = osType as OSType;
		} catch (e) {
			console.error('Failed to get OS type:', e);
			this.osType = 'unknown';
		}
	}

	resetEditorFont() {
		const defaults = DEFAULT_FONTS[this.osType];
		this.editorFont = defaults.editorFont;
		this.editorFontSize = 14;
	}

	resetPreviewFont() {
		const defaults = DEFAULT_FONTS[this.osType];
		this.previewFont = defaults.previewFont;
		this.previewFontSize = 16;
		this.codeFont = defaults.codeFont;
		this.codeFontSize = 14;
	}
}

export const settings = new SettingsStore();
