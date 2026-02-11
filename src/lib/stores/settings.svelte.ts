export class SettingsStore {
	minimap = $state(false);
	wordWrap = $state('on');
	lineNumbers = $state('on');
	vimMode = $state(false);
	statusBar = $state(true);
	wordCount = $state(false);
	renderLineHighlight = $state('none');
	showTabs = $state(true);
	zenMode = $state(false);
	preZenState = $state<{
		renderLineHighlight: string;
		showTabs: boolean;
		statusBar: boolean;
		minimap: boolean;
		lineNumbers: string;
	} | null>(null);
	occurrencesHighlight = $state(false);

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
			const savedZenMode = localStorage.getItem('editor.zenMode');
			const savedPreZenState = localStorage.getItem('editor.preZenState');
			const savedOccurrencesHighlight = localStorage.getItem('editor.occurrencesHighlight');

			if (savedMinimap !== null) this.minimap = savedMinimap === 'true';
			if (savedWordWrap !== null) this.wordWrap = savedWordWrap;
			if (savedLineNumbers !== null) this.lineNumbers = savedLineNumbers;
			if (savedVimMode !== null) this.vimMode = savedVimMode === 'true';
			if (savedStatusBar !== null) this.statusBar = savedStatusBar === 'true';

			if (savedWordCount !== null) this.wordCount = savedWordCount === 'true';
			if (savedRenderLineHighlight !== null) this.renderLineHighlight = savedRenderLineHighlight;
			if (savedShowTabs !== null) this.showTabs = savedShowTabs === 'true';
			if (savedZenMode !== null) this.zenMode = savedZenMode === 'true';
			if (savedOccurrencesHighlight !== null) this.occurrencesHighlight = savedOccurrencesHighlight === 'true';
			if (savedPreZenState !== null) {
				try {
					this.preZenState = JSON.parse(savedPreZenState);
				} catch (e) {
					console.error('Failed to parse preZenState', e);
				}
			}

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
					localStorage.setItem('editor.zenMode', String(this.zenMode));
					localStorage.setItem('editor.occurrencesHighlight', String(this.occurrencesHighlight));
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
		this.wordWrap = this.wordWrap === 'on' ? 'off' : 'on';
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

	toggleZenMode() {
		this.zenMode = !this.zenMode;
		if (this.zenMode) {
			this.preZenState = {
				renderLineHighlight: this.renderLineHighlight,
				showTabs: this.showTabs,
				statusBar: this.statusBar,
				minimap: this.minimap,
				lineNumbers: this.lineNumbers,
			};
			this.renderLineHighlight = 'none';
			this.showTabs = false;
			this.statusBar = false;
			this.minimap = false;
			this.lineNumbers = 'off';
		} else {
			if (this.preZenState) {
				this.renderLineHighlight = this.preZenState.renderLineHighlight;
				this.showTabs = this.preZenState.showTabs;
				this.statusBar = this.preZenState.statusBar;
				this.minimap = this.preZenState.minimap;
				this.lineNumbers = this.preZenState.lineNumbers;
				this.preZenState = null;
			}
		}
	}

	toggleOccurrencesHighlight() {
		this.occurrencesHighlight = !this.occurrencesHighlight;
	}
}

export const settings = new SettingsStore();
