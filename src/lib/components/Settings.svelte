<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { getVersion } from '@tauri-apps/api/app';
	import { settings } from '../stores/settings.svelte.js';
	import { fade, scale } from 'svelte/transition';

	let {
		show = false,
		theme = 'system',
		onSetTheme,
		onclose,
	} = $props<{ show?: boolean; theme?: 'system' | 'dark' | 'light'; onSetTheme?: (t: 'system' | 'dark' | 'light') => void; onclose: () => void }>();

	let activeCategory = $state<'editor' | 'preview' | 'appearance'>('editor');
	let systemFonts = $state<string[]>([]);
	let loaded = $state(false);
	let settingsModal = $state<HTMLDivElement>();
	let previousActiveElement = $state<HTMLElement | null>(null);
	let appVersion = $state<string>('');

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
			if (!appVersion) {
				getVersion()
					.then((v) => (appVersion = v))
					.catch(console.error);
			}
			previousActiveElement = document.activeElement as HTMLElement;
			setTimeout(() => {
				const firstFocusable = settingsModal?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') as HTMLElement | null;
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
		const focusableElements = settingsModal?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [];
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
			transition:scale={{ duration: 200, start: 0.95 }}
			role="dialog"
			aria-modal="true"
			aria-labelledby="settings-title"
			tabindex="-1"
			onkeydown={handleModalKeydown}>
			<div class="settings-header">
				<h1 id="settings-title">Settings</h1>
				<button class="close-btn" onclick={onclose} aria-label="Close">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>

			<div class="settings-content">
				<nav class="settings-nav">
					<button class="nav-item" class:active={activeCategory === 'editor'} onclick={() => (activeCategory = 'editor')}>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round">
							<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
							<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
						</svg>
						Editor
					</button>
					<button class="nav-item" class:active={activeCategory === 'preview'} onclick={() => (activeCategory = 'preview')}>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round">
							<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
							<circle cx="12" cy="12" r="3"></circle>
						</svg>
						Preview
					</button>
					<button class="nav-item" class:active={activeCategory === 'appearance'} onclick={() => (activeCategory = 'appearance')}>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round">
							<circle cx="12" cy="12" r="3"></circle>
							<path
								d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
							></path>
						</svg>
						Appearance
					</button>

					<div class="nav-footer">
						<button
							class="github-btn"
							onclick={() =>
								import('@tauri-apps/plugin-opener')
									.then((m) => m.openUrl('https://github.com/alecdotdev/Markpad'))
									.catch(() => window.open('https://github.com/alecdotdev/Markpad', '_blank'))}
							aria-label="GitHub">
							<svg viewBox="0 0 24 24" class="github-icon" fill="currentColor">
								<path
									d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z"
								></path>
							</svg>
							<span>GitHub</span>
							{#if appVersion}
								<span class="version-code">v{appVersion}</span>
							{/if}
						</button>
					</div>
				</nav>

				<div class="settings-panel">
					{#if activeCategory === 'editor'}
						<div class="settings-group">
							<div class="settings-group-header">
								<h2>Editor Settings</h2>
								<button
									class="reset-text-btn"
									class:disabled={settings.editorFont === 'Consolas' && settings.editorFontSize === 14}
									onclick={() => {
										settings.editorFont = 'Consolas';
										settings.editorFontSize = 14;
									}}>
									Reset font settings
								</button>
							</div>

							<div class="setting-item">
								<label for="editor-font">Font</label>
								<div class="select-wrapper">
									<select id="editor-font" bind:value={settings.editorFont}>
										{#each systemFonts as font}
											<option value={font}>{font === 'Consolas' ? font + ' (Default)' : font}</option>
										{/each}
									</select>
									<svg
										class="select-arrow"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
								</div>
							</div>

							<div class="setting-item">
								<label for="editor-font-size">Font Size</label>
								<div class="slider-container">
									<div class="number-input-wrapper horizontal">
										<button class="spin-btn minus" onclick={() => (settings.editorFontSize = Math.max(10, settings.editorFontSize - 1))} aria-label="Decrease">
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
										<input type="number" id="editor-font-size" min="10" max="48" bind:value={settings.editorFontSize} class="number-input" />
										<button class="spin-btn plus" onclick={() => (settings.editorFontSize = Math.min(48, settings.editorFontSize + 1))} aria-label="Increase">
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
									</div>
									<span class="slider-value">px</span>
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
							<div class="settings-group-header">
								<h2>Preview Settings</h2>
								<button
									class="reset-text-btn"
									class:disabled={settings.previewFont === 'Segoe UI' && settings.previewFontSize === 16 && settings.codeFont === 'Consolas' && settings.codeFontSize === 14}
									onclick={() => {
										settings.previewFont = 'Segoe UI';
										settings.previewFontSize = 16;
										settings.codeFont = 'Consolas';
										settings.codeFontSize = 14;
									}}>
									Reset font settings
								</button>
							</div>

							<div class="setting-item">
								<label for="preview-font">Font</label>
								<div class="select-wrapper">
									<select id="preview-font" bind:value={settings.previewFont}>
										{#each systemFonts as font}
											<option value={font}>{font === 'Segoe UI' ? font + ' (Default)' : font}</option>
										{/each}
									</select>
									<svg
										class="select-arrow"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
								</div>
							</div>

							<div class="setting-item">
								<label for="preview-font-size">Font Size</label>
								<div class="slider-container">
									<div class="number-input-wrapper horizontal">
										<button class="spin-btn minus" onclick={() => (settings.previewFontSize = Math.max(12, settings.previewFontSize - 1))} aria-label="Decrease">
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
										<input type="number" id="preview-font-size" min="12" max="48" bind:value={settings.previewFontSize} class="number-input" />
										<button class="spin-btn plus" onclick={() => (settings.previewFontSize = Math.min(48, settings.previewFontSize + 1))} aria-label="Increase">
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
									</div>
									<span class="slider-value">px</span>
								</div>
							</div>

							<div class="setting-item">
								<label for="code-font">Code Font</label>
								<div class="select-wrapper">
									<select id="code-font" bind:value={settings.codeFont}>
										{#each systemFonts as font}
											<option value={font}>{font === 'Consolas' ? font + ' (Default)' : font}</option>
										{/each}
									</select>
									<svg
										class="select-arrow"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
								</div>
							</div>

							<div class="setting-item">
								<label for="code-font-size">Code Font Size</label>
								<div class="slider-container">
									<div class="number-input-wrapper horizontal">
										<button class="spin-btn minus" onclick={() => (settings.codeFontSize = Math.max(10, settings.codeFontSize - 1))} aria-label="Decrease">
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
										<input type="number" id="code-font-size" min="10" max="48" bind:value={settings.codeFontSize} class="number-input" />
										<button class="spin-btn plus" onclick={() => (settings.codeFontSize = Math.min(48, settings.codeFontSize + 1))} aria-label="Increase">
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
									</div>
									<span class="slider-value">px</span>
								</div>
							</div>
						</div>
					{:else if activeCategory === 'appearance'}
						<div class="settings-group">
							<h2>Appearance Settings</h2>

							<div class="setting-item">
								<label for="appearance-theme">Theme</label>
								<div class="select-wrapper">
									<select id="appearance-theme" value={theme} onchange={(e) => onSetTheme?.(e.currentTarget.value as any)}>
										<option value="system">System</option>
										<option value="light">Light</option>
										<option value="dark">Dark</option>
									</select>
									<svg
										class="select-arrow"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
								</div>
							</div>

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
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
		width: 560px;
		max-width: 90vw;
		height: 420px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		font-family: var(--win-font);
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
		line-height: 1;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 6px;
		font-size: 13px;
		color: var(--color-fg-default);
		text-align: left;
	}

	.nav-item svg {
		width: 16px;
		height: 16px;
	}

	.nav-item:hover {
		background: var(--color-neutral-muted);
	}

	.nav-item.active {
		background: var(--color-accent-fg);
		color: white;
	}

	.nav-footer {
		margin-top: auto;
		display: flex;
		flex-direction: column;
	}

	.github-btn {
		display: flex;
		align-items: center;
		padding: 8px 12px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 6px;
		opacity: 0.5;
		font-size: 13px;
		color: var(--color-fg-default);
		text-align: left;
		transition: all 0.1s;
		gap: 8px;
	}

	.github-btn:hover {
		opacity: 1;
	}

	.github-btn .github-icon {
		width: 16px;
		height: 16px;
	}

	.github-btn span {
		margin-top: 1px;
	}

	.github-btn .version-code {
		margin-left: auto;
		font-size: 11px;
		color: var(--color-fg-muted);
		margin-top: 2px;
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

	.settings-group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}

	.settings-group-header h2 {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
		color: var(--color-fg-default);
	}

	.reset-text-btn {
		background: transparent;
		border: none;
		color: var(--color-fg-muted);
		font-size: 13px;
		cursor: pointer;
		padding: 0;
		transition: all 0.1s;
		text-decoration: none;
	}

	.reset-text-btn:hover:not(.disabled) {
		color: var(--color-accent-fg);
	}

	.reset-text-btn.disabled {
		opacity: 0.5;
		cursor: default;
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
		display: flex;
		align-items: center;
		height: 100%;
	}

	.select-wrapper {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.select-arrow {
		position: absolute;
		right: 10px;
		pointer-events: none;
		color: var(--color-fg-muted);
	}

	.setting-item select {
		padding: 6px 32px 6px 12px;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		background-color: var(--color-canvas-default);
		color: var(--color-fg-default);
		font-size: 13px;
		min-width: 160px;
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
		-moz-appearance: none;
	}

	.setting-item select option {
		background-color: var(--color-canvas-default);
		color: var(--color-fg-default);
	}

	.setting-item select:focus {
		outline: none;
		border-color: var(--color-accent-fg);
	}

	.slider-container {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.number-input-wrapper {
		display: flex;
		align-items: stretch;
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 4px;
		overflow: hidden;
		transition: border-color 0.1s;
	}

	.number-input-wrapper:focus-within {
		border-color: var(--color-accent-fg);
	}

	.number-input {
		width: 40px;
		padding: 4px 8px;
		background: transparent;
		border: none;
		color: var(--color-fg-default);
		font-family: inherit;
		font-size: 13px;
		text-align: right;
		-moz-appearance: textfield;
		outline: none;
	}

	.number-input::-webkit-outer-spin-button,
	.number-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	.number-input-wrapper.horizontal {
		align-items: center;
		height: 28px;
	}

	.number-input-wrapper.horizontal .number-input {
		text-align: center;
		width: 36px;
		padding: 4px 0;
		height: 100%;
		border-radius: 0;
	}

	.spin-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		width: 28px;
		background: transparent;
		border: none;
		color: var(--color-fg-subtle);
		cursor: pointer;
		padding: 0;
		transition: all 0.1s;
	}

	.spin-btn:hover {
		background: var(--color-canvas-subtle);
		color: var(--color-fg-default);
	}

	.spin-btn:active {
		background: var(--color-border-muted);
	}

	.spin-btn.minus {
		border-right: 1px solid var(--color-border-default);
	}

	.spin-btn.plus {
		border-left: 1px solid var(--color-border-default);
	}

	.slider-value {
		font-size: 12px;
		color: var(--color-fg-muted);
	}

	.toggle {
		position: relative;
		display: inline-block;
		width: 40px;
		height: 20px;
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
		background-color: transparent;
		border: 1px solid var(--color-fg-muted);
		transition:
			background-color 0.2s,
			border-color 0.2s;
		border-radius: 20px;
	}

	.toggle-slider:before {
		position: absolute;
		content: '';
		height: 12px;
		width: 12px;
		left: 3px;
		bottom: 3px;
		background-color: var(--color-fg-muted);
		transition:
			transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
			height 0.2s,
			width 0.2s,
			left 0.2s,
			bottom 0.2s,
			background-color 0.2s;
		border-radius: 50%;
	}

	.toggle input:checked + .toggle-slider {
		background-color: var(--color-accent-fg);
		border-color: var(--color-accent-fg);
	}

	.toggle input:checked + .toggle-slider:before {
		transform: translateX(20px);
		background-color: white;
	}
</style>
