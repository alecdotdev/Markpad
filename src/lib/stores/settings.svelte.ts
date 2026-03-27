import { invoke } from '@tauri-apps/api/core';

export type OSType = 'macos' | 'windows' | 'linux' | 'unknown';

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
	editorMaxWidth = $state(80);
	osType = $state<OSType>('unknown');

	editorFont = $state('Consolas');
	editorFontSize = $state(14);
	previewFont = $state('Segoe UI');
	previewFontSize = $state(16);
	codeFont = $state('Consolas');
	codeFontSize = $state(14);

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
			const savedEditorMaxWidth = localStorage.getItem('editor.maxWidth');

			const savedEditorFont = localStorage.getItem('editor.font');
			const savedEditorFontSize = localStorage.getItem('editor.fontSize');
			const savedPreviewFont = localStorage.getItem('preview.font');
			const savedPreviewFontSize = localStorage.getItem('preview.fontSize');
			const savedCodeFont = localStorage.getItem('preview.codeFont');
			const savedCodeFontSize = localStorage.getItem('preview.codeFontSize');

			const parseFontSize = (value: string | null, fallback: number, min: number, max: number) => {
				if (value === null) return fallback;
				const parsed = Number.parseInt(value, 10);
				if (!Number.isFinite(parsed)) return fallback;
				return Math.min(max, Math.max(min, parsed));
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
			if (savedEditorMaxWidth !== null) this.editorMaxWidth = parseFontSize(savedEditorMaxWidth, 80, 20, 500);
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
					localStorage.setItem('editor.maxWidth', String(this.editorMaxWidth));
					localStorage.setItem('editor.font', this.editorFont);
					localStorage.setItem('editor.fontSize', String(this.editorFontSize));
					localStorage.setItem('preview.font', this.previewFont);
					localStorage.setItem('preview.fontSize', String(this.previewFontSize));
					localStorage.setItem('preview.codeFont', this.codeFont);
					localStorage.setItem('preview.codeFontSize', String(this.codeFontSize));
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
