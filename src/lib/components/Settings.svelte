<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { settings } from '../stores/settings.svelte.js';
	import { fade, scale } from 'svelte/transition';

	let { show = false, onclose } = $props<{ show?: boolean; onclose: () => void }>();

	let activeCategory = $state<'editor' | 'preview' | 'appearance'>('editor');
	let systemFonts = $state<string[]>([]);
	let loaded = $state(false);
	let settingsModal = $state<HTMLDivElement>();
	let previousActiveElement = $state<HTMLElement | null>(null);

	async function loadFonts() {
		if (loaded) return;
		try {
			systemFonts = (await invoke('get_system_fonts')) as string[];
			loaded = true;
		} catch (e) {
			console.error('Failed to load system fonts:', e);
			systemFonts = ['Consolas', 'Courier New', 'Monaco', 'Menlo', 'Segoe UI'];
		}
	}

	$effect(() => {
		if (show) {
			loadFonts();
			previousActiveElement = document.activeElement as HTMLElement;
			setTimeout(() => {
				const firstFocusable = settingsModal?.querySelector(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				) as HTMLElement | null;
				if (firstFocusable) {
					firstFocusable.focus();
				} else {
					settingsModal?.focus();
				}
			}, 50);
		} else if (previousActiveElement) {
			previousActiveElement.focus();
		}
	});

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onclose();
		}
	}

	function handleModalKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
			return;
		}

		if (e.key !== 'Tab') return;
		const focusableElements =
			settingsModal?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [];
		if (focusableElements.length === 0) return;

		const first = focusableElements[0] as HTMLElement;
		const last = focusableElements[focusableElements.length - 1] as HTMLElement;

		if (e.shiftKey) {
			if (document.activeElement === first) {
				e.preventDefault();
				last.focus();
			}
		} else if (document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

{#if show}
<div class="settings-backdrop" transition:fade={{ duration: 150 }} onclick={handleBackdropClick} role="presentation">
	<div
		class="settings-modal"
		bind:this={settingsModal}
		transition:scale={{ duration: 150, start: 0.95 }}
		role="dialog"
		aria-modal="true"
		aria-labelledby="settings-title"
		tabindex="-1"
		onkeydown={handleModalKeydown}>
		<div class="settings-header">
			<h1 id="settings-title">Settings</h1>
			<button class="close-btn" onclick={onclose} aria-label="Close">
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			</button>
		</div>

		<div class="settings-content">
			<nav class="settings-nav">
				<button class="nav-item" class:active={activeCategory === 'editor'} onclick={() => (activeCategory = 'editor')}>
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
						<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
					</svg>
					Editor
				</button>
				<button class="nav-item" class:active={activeCategory === 'preview'} onclick={() => (activeCategory = 'preview')}>
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
						<circle cx="12" cy="12" r="3"></circle>
					</svg>
					Preview
				</button>
				<button class="nav-item" class:active={activeCategory === 'appearance'} onclick={() => (activeCategory = 'appearance')}>
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="3"></circle>
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
					</svg>
					Appearance
				</button>
			</nav>

			<div class="settings-panel">
				{#if activeCategory === 'editor'}
				<div class="settings-group">
					<h2>Editor Settings</h2>

					<div class="setting-item">
						<label for="editor-font">Font</label>
						<select id="editor-font" bind:value={settings.editorFont}>
							{#each systemFonts as font}
								<option value={font}>{font}</option>
							{/each}
						</select>
					</div>

					<div class="setting-item">
						<label for="editor-font-size">Font Size</label>
						<div class="slider-container">
							<input type="range" id="editor-font-size" min="10" max="24" bind:value={settings.editorFontSize} />
							<span class="slider-value">{settings.editorFontSize}px</span>
						</div>
					</div>

					<div class="setting-item">
						<label for="editor-word-wrap">Word Wrap</label>
						<label class="toggle">
							<input id="editor-word-wrap" type="checkbox" checked={settings.wordWrap === 'on'} onchange={() => settings.toggleWordWrap()} />
							<span class="toggle-slider"></span>
						</label>
					</div>

					<div class="setting-item">
						<label for="editor-line-numbers">Line Numbers</label>
						<label class="toggle">
							<input id="editor-line-numbers" type="checkbox" checked={settings.lineNumbers === 'on'} onchange={() => settings.toggleLineNumbers()} />
							<span class="toggle-slider"></span>
						</label>
					</div>

					<div class="setting-item">
						<label for="editor-minimap">Minimap</label>
						<label class="toggle">
							<input id="editor-minimap" type="checkbox" checked={settings.minimap} onchange={() => settings.toggleMinimap()} />
							<span class="toggle-slider"></span>
						</label>
					</div>

					<div class="setting-item">
						<label for="editor-vim-mode">Vim Mode</label>
						<label class="toggle">
							<input id="editor-vim-mode" type="checkbox" checked={settings.vimMode} onchange={() => settings.toggleVimMode()} />
							<span class="toggle-slider"></span>
						</label>
					</div>

					<div class="setting-item">
						<label for="editor-status-bar">Status Bar</label>
						<label class="toggle">
							<input id="editor-status-bar" type="checkbox" checked={settings.statusBar} onchange={() => settings.toggleStatusBar()} />
							<span class="toggle-slider"></span>
						</label>
					</div>

					<div class="setting-item">
						<label for="editor-word-count">Word Count</label>
						<label class="toggle">
							<input id="editor-word-count" type="checkbox" checked={settings.wordCount} onchange={() => settings.toggleWordCount()} />
							<span class="toggle-slider"></span>
						</label>
					</div>
				</div>
				{:else if activeCategory === 'preview'}
				<div class="settings-group">
					<h2>Preview Settings</h2>

					<div class="setting-item">
						<label for="preview-font">Font</label>
						<select id="preview-font" bind:value={settings.previewFont}>
							{#each systemFonts as font}
								<option value={font}>{font}</option>
							{/each}
						</select>
					</div>

					<div class="setting-item">
						<label for="preview-font-size">Font Size</label>
						<div class="slider-container">
							<input type="range" id="preview-font-size" min="12" max="28" bind:value={settings.previewFontSize} />
							<span class="slider-value">{settings.previewFontSize}px</span>
						</div>
					</div>

					<div class="setting-item">
						<label for="code-font">Code Font</label>
						<select id="code-font" bind:value={settings.codeFont}>
							{#each systemFonts as font}
								<option value={font}>{font}</option>
							{/each}
						</select>
					</div>

					<div class="setting-item">
						<label for="code-font-size">Code Font Size</label>
						<div class="slider-container">
							<input type="range" id="code-font-size" min="10" max="24" bind:value={settings.codeFontSize} />
							<span class="slider-value">{settings.codeFontSize}px</span>
						</div>
					</div>
				</div>
				{:else if activeCategory === 'appearance'}
				<div class="settings-group">
					<h2>Appearance Settings</h2>

					<div class="setting-item">
						<label for="appearance-tabs">Show Tabs</label>
						<label class="toggle">
							<input id="appearance-tabs" type="checkbox" checked={settings.showTabs} onchange={() => settings.toggleTabs()} />
							<span class="toggle-slider"></span>
						</label>
					</div>

					<div class="setting-item">
						<label for="appearance-line-highlight">Line Highlight</label>
						<label class="toggle">
							<input id="appearance-line-highlight" type="checkbox" checked={settings.renderLineHighlight === 'line'} onchange={() => settings.toggleLineHighlight()} />
							<span class="toggle-slider"></span>
						</label>
					</div>

					<div class="setting-item">
						<label for="appearance-zen-mode">Zen Mode</label>
						<label class="toggle">
							<input id="appearance-zen-mode" type="checkbox" checked={settings.zenMode} onchange={() => settings.toggleZenMode()} />
							<span class="toggle-slider"></span>
						</label>
					</div>
				</div>
				{/if}
			</div>
		</div>
	</div>
</div>
{/if}

<style>
	.settings-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
	}

	.settings-modal {
		background: var(--color-canvas-default);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
		width: 560px;
		max-width: 90vw;
		height: 420px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.settings-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--color-border-default);
	}

	.settings-header h1 {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 4px;
		color: var(--color-fg-default);
	}

	.close-btn:hover {
		background: var(--color-neutral-muted);
	}

	.settings-content {
		display: flex;
		flex: 1;
		overflow: hidden;
	}

	.settings-nav {
		width: 140px;
		padding: 12px 8px;
		border-right: 1px solid var(--color-border-default);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 6px;
		font-size: 13px;
		color: var(--color-fg-default);
		text-align: left;
	}

	.nav-item:hover {
		background: var(--color-neutral-muted);
	}

	.nav-item.active {
		background: var(--color-accent-fg);
		color: white;
	}

	.settings-panel {
		flex: 1;
		padding: 20px;
		overflow-y: auto;
		min-height: 0;
	}

	.settings-group h2 {
		font-size: 16px;
		font-weight: 600;
		margin: 0 0 16px 0;
		color: var(--color-fg-default);
	}

	.setting-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 0;
		border-bottom: 1px solid var(--color-border-muted);
	}

	.setting-item label:first-child {
		font-size: 13px;
		color: var(--color-fg-default);
	}

	.setting-item select {
		padding: 6px 10px;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		background: var(--color-canvas-default);
		color: var(--color-fg-default);
		font-size: 13px;
		min-width: 160px;
		cursor: pointer;
	}

	.setting-item select:focus {
		outline: none;
		border-color: var(--color-accent-fg);
	}

	.slider-container {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.slider-container input[type='range'] {
		width: 120px;
		cursor: pointer;
	}

	.slider-value {
		font-size: 12px;
		color: var(--color-fg-muted);
		min-width: 40px;
		text-align: right;
	}

	.toggle {
		position: relative;
		display: inline-block;
		width: 40px;
		height: 22px;
		cursor: pointer;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-slider {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: var(--color-border-default);
		transition: 0.2s;
		border-radius: 22px;
	}

	.toggle-slider:before {
		position: absolute;
		content: '';
		height: 16px;
		width: 16px;
		left: 3px;
		bottom: 3px;
		background-color: white;
		transition: 0.2s;
		border-radius: 50%;
	}

	.toggle input:checked + .toggle-slider {
		background-color: var(--color-accent-fg);
	}

	.toggle input:checked + .toggle-slider:before {
		transform: translateX(18px);
	}
</style>
