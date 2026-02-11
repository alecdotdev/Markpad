<script lang="ts">
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { invoke } from '@tauri-apps/api/core';
	import { fly, slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import iconUrl from '../../assets/icon.png';
	import TabList from './TabList.svelte';
	import { tabManager } from '../stores/tabs.svelte.js';
	import { settings } from '../stores/settings.svelte.js';

	let {
		isFocused,
		isScrolled,
		currentFile,
		liveMode,

		windowTitle,
		showHome,
		onselectFile,
		ontoggleHome,
		ononpenFileLocation,
		ontoggleLiveMode,

		ontoggleEdit,
		ontoggleSplit,
		isEditing,
		ondetach,
		ontabclick,
		zoomLevel,
		onresetZoom,
		oncloseTab,
		isScrollSynced,
		ontoggleSync,
		isFullWidth,
		ontoggleFullWidth,
		theme = 'system',
		onSetTheme,
	} = $props<{
		isFocused: boolean;
		isScrolled: boolean;
		currentFile: string;
		liveMode: boolean;

		windowTitle: string;
		showHome: boolean;
		onselectFile: () => void;
		ontoggleHome: () => void;
		ononpenFileLocation: () => void;
		ontoggleLiveMode: () => void;

		ontoggleEdit: () => void;
		ontoggleSplit?: () => void;
		isEditing: boolean;
		ondetach: (tabId: string) => void;
		ontabclick?: () => void;
		zoomLevel?: number;
		onresetZoom?: () => void;

		oncloseTab?: (id: string) => void;
		isScrollSynced?: boolean;
		ontoggleSync?: () => void;

		isFullWidth?: boolean;
		ontoggleFullWidth?: () => void;
		theme?: 'system' | 'dark' | 'light';
		onSetTheme?: (theme: 'system' | 'dark' | 'light') => void;
	}>();

	const appWindow = getCurrentWindow();

	// DEBUG: Set this to true to simulate macOS traffic lights on Windows
	const DEBUG_MACOS = false;

	const isMac = typeof navigator !== 'undefined' && (navigator.userAgent.includes('Macintosh') || DEBUG_MACOS);

	let isWin11 = $state(false);

	$effect(() => {
		invoke('is_win11')
			.then((res) => {
				isWin11 = res as boolean;
			})
			.catch(() => {
				isWin11 = false;
			});
	});

	let tooltip = $state({
		visible: false,
		text: '',
		shortcut: '',
		x: 0,
		y: 0,
		align: 'center' as 'left' | 'center' | 'right',
	});

	function showTooltip(e: MouseEvent, text: string, shortcutKey: string = '') {
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const modifier = isMac ? 'Cmd' : 'Ctrl';
		const windowWidth = window.innerWidth;
		const edgeThreshold = 100;

		tooltip.text = text;
		tooltip.shortcut = shortcutKey ? `${modifier}+${shortcutKey}` : '';

		if (rect.left < edgeThreshold) {
			tooltip.align = 'left';
			tooltip.x = rect.left;
		} else if (rect.right > windowWidth - edgeThreshold) {
			tooltip.align = 'right';
			tooltip.x = rect.right;
		} else {
			tooltip.align = 'center';
			tooltip.x = rect.left + rect.width / 2;
		}

		tooltip.y = rect.bottom + 8;
		tooltip.visible = true;
	}

	function hideTooltip() {
		tooltip.visible = false;
	}

	let visibleActionIds = $derived.by(() => {
		const list: string[] = [];
		if (zoomLevel && zoomLevel !== 100) list.push('zoom');
		list.push('theme');

		if (currentFile && !showHome) {
			list.push('open_loc');
			const ext = currentFile.split('.').pop()?.toLowerCase() || '';
			const isMarkdown = ['md', 'markdown', 'mdown', 'mkd'].includes(ext);

			if (isMarkdown) {
				list.push('split');
				if (tabManager.activeTab?.isSplit) {
					list.push('sync');
				} else {
					list.push('fullWidth');
					if (!isEditing) {
						list.push('live');
					}
				}
				if (!tabManager.activeTab?.isSplit) {
					list.push('edit');
				}
			}
		}
		return list;
	});

	let themeMenuOpen = $state(false);

	function handleSetTheme(t: 'system' | 'dark' | 'light') {
		if (onSetTheme) onSetTheme(t);
		themeMenuOpen = false;
	}

	$effect(() => {
		const handleGlobalClick = () => {
			themeMenuOpen = false;
		};
		if (themeMenuOpen) {
			window.addEventListener('click', handleGlobalClick);
		}
		return () => {
			window.removeEventListener('click', handleGlobalClick);
		};
	});
</script>

<div class="custom-title-bar {isScrolled ? 'scrolled' : ''} {!isMac ? 'windows' : ''}">
	{#if !isMac && !isWin11}
		<div class="window-top-border"></div>
	{/if}
	<div class="window-controls-left" data-tauri-drag-region>
		{#if isMac}
			<div class="macos-traffic-lights" class:visible={isMac}>
				<button class="mac-btn mac-close" onclick={() => appWindow.close()} aria-label="Close">
					<svg width="6" height="6" viewBox="0 0 6 6" class="mac-icon"
						><path d="M0.5 0.5L5.5 5.5M5.5 0.5L0.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
				</button>
				<button class="mac-btn mac-minimize" onclick={() => appWindow.minimize()} aria-label="Minimize">
					<svg width="6" height="6" viewBox="0 0 6 6" class="mac-icon"><path d="M0.5 3H5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
				</button>
				<button class="mac-btn mac-maximize" onclick={() => appWindow.toggleMaximize()} aria-label="Maximize">
					<svg width="6" height="6" viewBox="0 0 6 6" class="mac-icon"><path d="M0.5 3H5.5M3 0.5V5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
				</button>
			</div>
		{/if}
		<button class="icon-home-btn {showHome ? 'active' : ''}" onclick={ontoggleHome} aria-label="Home" onmouseenter={(e) => showTooltip(e, 'Home')} onmouseleave={hideTooltip}>
			<img
				src={iconUrl}
				alt="icon"
				class="window-icon"
				style:filter={theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'none' : 'invert(0.7)'} />
		</button>
	</div>

	{#if tabManager.tabs.length > 0 && settings.showTabs}
		<div class="tab-area">
			<TabList onnewTab={() => tabManager.addNewTab()} {ondetach} {showHome} {ontabclick} {oncloseTab} />
		</div>
	{:else}
		<div class="window-title-container" data-tauri-drag-region>
			<div class="window-title {isFocused ? 'focused' : 'unfocused'}" data-tauri-drag-region>
				<span class="title-text" data-tauri-drag-region>
					{windowTitle}
				</span>
			</div>
		</div>
	{/if}

	<div class="title-actions" data-tauri-drag-region>
		{#each visibleActionIds as id (id)}
			<div animate:flip={{ duration: 250 }} class="action-btn-wrapper">
				{#if id === 'zoom'}
					<button
						class="zoom-indicator"
						onclick={onresetZoom}
						transition:fly={{ y: -10, duration: 150 }}
						aria-label="Reset Zoom"
						onmouseenter={(e) => showTooltip(e, 'Reset zoom')}
						onmouseleave={hideTooltip}>
						{zoomLevel}%
					</button>
				{:else if id === 'open_loc'}
					<button
						class="title-action-btn"
						onclick={ononpenFileLocation}
						aria-label="Open File Location"
						onmouseenter={(e) => showTooltip(e, 'Open file location')}
						onmouseleave={hideTooltip}
						transition:fly={{ x: 10, duration: 200 }}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
							><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><polyline points="15 13 18 13 18 10"></polyline><line
								x1="14"
								y1="14"
								x2="18"
								y2="10"></line
							></svg>
					</button>
				{:else if id === 'split'}
					<button
						class="title-action-btn {tabManager.activeTab?.isSplit ? 'active' : ''}"
						onclick={() => ontoggleSplit?.()}
						aria-label="Toggle Split View"
						onmouseenter={(e) => showTooltip(e, 'Split view', 'H')}
						onmouseleave={hideTooltip}
						transition:fly={{ x: 10, duration: 200 }}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
							><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line><rect
								x="13"
								y="2"
								width="9"
								height="20"
								rx="2"
								ry="2"
								transform="rotate(0 13 2)"></rect
							></svg>
					</button>
				{:else if id === 'sync'}
					<button
						class="title-action-btn {isScrollSynced ? 'active' : ''}"
						onclick={() => ontoggleSync?.()}
						aria-label="Toggle Scroll Sync"
						onmouseenter={(e) => showTooltip(e, 'Scroll sync')}
						onmouseleave={hideTooltip}
						transition:fly={{ x: 10, duration: 200 }}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
							><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
					</button>
				{:else if id === 'fullWidth'}
					<button
						class="title-action-btn {isFullWidth ? 'active' : ''}"
						onclick={() => ontoggleFullWidth?.()}
						aria-label="Toggle Full Width"
						onmouseenter={(e) => showTooltip(e, 'Toggle full width')}
						onmouseleave={hideTooltip}
						transition:fly={{ x: 10, duration: 200 }}>
						<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"
							><path
								d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm640-560H160v480h640v-480Zm-640 0v480-480Zm200 360v-240L240-480l120 120Zm360-120L600-600v240l120-120Z" /></svg>
					</button>
				{:else if id === 'live'}
					<button
						class="title-action-btn {liveMode ? 'active' : ''}"
						onclick={ontoggleLiveMode}
						aria-label="Toggle Auto-Reload"
						onmouseenter={(e) => showTooltip(e, 'Auto-Reload')}
						onmouseleave={hideTooltip}
						transition:fly={{ x: 10, duration: 200 }}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
							><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path
								d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path
							></svg>
					</button>
				{:else if id === 'edit'}
					<button
						class="title-action-btn {isEditing ? 'active' : ''}"
						onclick={ontoggleEdit}
						aria-label="Edit File (Ctrl+E)"
						onmouseenter={(e) => showTooltip(e, 'Edit file', 'E')}
						onmouseleave={hideTooltip}
						transition:fly={{ x: 10, duration: 200 }}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
							><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
					</button>
				{:else if id === 'theme'}
					<div class="theme-dropdown-container">
						<button
							class="title-action-btn {themeMenuOpen ? 'active' : ''}"
							onclick={(e) => {
								e.stopPropagation();
								themeMenuOpen = !themeMenuOpen;
								if (themeMenuOpen) hideTooltip();
							}}
							aria-label="Change Theme"
							onmouseenter={(e) => {
								if (!themeMenuOpen) showTooltip(e, 'Change Theme');
							}}
							onmouseleave={hideTooltip}
							transition:fly={{ x: 10, duration: 200 }}>
							{#if theme === 'light'}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
									><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line
										x1="4.22"
										y1="4.22"
										x2="5.64"
										y2="5.64"></line
									><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line
										x1="4.22"
										y1="19.78"
										x2="5.64"
										y2="18.36"></line
									><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
							{:else if theme === 'dark'}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
									><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
							{:else}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
									><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
							{/if}
						</button>
						{#if themeMenuOpen}
							<div class="theme-menu" transition:fly={{ y: 5, duration: 150 }} onclick={(e) => e.stopPropagation()}>
								<button class="theme-option {theme === 'system' ? 'selected' : ''}" onclick={() => handleSetTheme('system')}> Follow System </button>
								<button class="theme-option {theme === 'light' ? 'selected' : ''}" onclick={() => handleSetTheme('light')}> Light </button>
								<button class="theme-option {theme === 'dark' ? 'selected' : ''}" onclick={() => handleSetTheme('dark')}> Dark </button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<div class="window-controls-right" data-tauri-drag-region>
		{#if !isMac}
			<button class="control-btn" onclick={() => appWindow.minimize()} aria-label="Minimize">
				<svg width="12" height="12" viewBox="0 0 12 12"><rect fill="currentColor" width="10" height="1" x="1" y="6" /></svg>
			</button>
			<button class="control-btn" onclick={() => appWindow.toggleMaximize()} aria-label="Maximize">
				<svg width="12" height="12" viewBox="0 0 12 12"><rect fill="none" stroke="currentColor" stroke-width="1" width="9" height="9" x="1.5" y="1.5" /></svg>
			</button>
			<button
				class="control-btn close-btn"
				onclick={() => {
					console.log('Close button clicked');
					appWindow.close();
				}}
				aria-label="Close">
				<svg width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M11 1.7L10.3 1 6 5.3 1.7 1 1 1.7 5.3 6 1 10.3 1.7 11 6 6.7 10.3 11 11 10.3 6.7 6z" /></svg>
			</button>
		{/if}
	</div>
</div>

<div class="custom-tooltip {tooltip.visible ? 'visible' : ''} align-{tooltip.align}" style="left: {tooltip.x}px; top: {tooltip.y}px;">
	<span class="tooltip-text">{tooltip.text}</span>
	{#if tooltip.shortcut}
		<span class="tooltip-shortcut">{tooltip.shortcut}</span>
	{/if}
</div>

<style>
	.custom-title-bar {
		height: 36px;
		background-color: var(--color-canvas-default);
		display: flex;
		justify-content: space-between;
		align-items: center;
		user-select: none;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 9999;
		font-family: var(--win-font);
		border-bottom: 1px solid transparent;
		transition: border-color 0.2s;
	}

	.window-top-border {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 1px;
		background-color: var(--color-window-border-top);
		z-index: 10002;
		pointer-events: none;
	}

	.custom-title-bar.scrolled {
		border-bottom-color: var(--color-border-muted);
	}

	.tab-area {
		display: flex;
		flex: 1;
		height: 100%;
		overflow: hidden;
		min-width: 0;
	}

	.window-controls-left {
		display: flex;
		align-items: center;
		padding-left: 10px;
		gap: 12px;
		position: relative;
		z-index: 10000;
	}

	.title-actions {
		display: flex;
		gap: 4px;
		margin-right: 8px;
		margin-left: auto;
		z-index: 10000;
	}

	.actions-wrapper {
		display: flex;
		gap: 4px;
	}

	.title-action-btn {
		width: 28px;
		height: 28px;
		display: flex;
		justify-content: center;
		align-items: center;
		background: transparent;
		border: none;
		color: var(--color-fg-muted);
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.1s;
	}

	.title-action-btn.active {
		color: var(--color-accent-fg);
		background: var(--color-canvas-subtle);
	}

	.title-action-btn:hover {
		background: var(--color-canvas-subtle);
		color: var(--color-fg-default);
	}

	.window-icon {
		width: 16px;
		height: 16px;
		opacity: 0.8;
	}

	@media (prefers-color-scheme: light) {
		.window-icon {
			filter: grayscale(1) brightness(0.2);
			opacity: 0.6;
		}
	}

	.icon-home-btn {
		background: transparent;
		border: none;
		padding: 4px;
		margin: -4px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 0.1s;
	}

	.icon-home-btn:hover,
	.icon-home-btn.active {
		background: var(--color-canvas-subtle);
	}

	.window-title-container {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		bottom: 0;
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 5;
	}

	.window-title {
		font-size: 12px;
		transition: opacity 0.2s;
		white-space: nowrap;
		overflow: hidden;
		max-width: 50%;
		display: flex;
	}

	.window-title.focused {
		opacity: 0.8;
		color: var(--color-fg-default);
	}

	.window-title.unfocused {
		opacity: 0.4;
		color: var(--color-fg-default);
	}

	.window-controls-right {
		display: flex;
		height: 100%;
		position: relative;
		z-index: 10000;
	}

	.control-btn {
		width: 46px;
		height: 32px;
		display: flex;
		justify-content: center;
		align-items: center;
		background: transparent;
		border: none;
		color: var(--color-fg-default);
		opacity: 0.8;
		cursor: default;
		transition: all 0.1s;
	}

	.control-btn:hover {
		background: var(--color-canvas-subtle);
		opacity: 1;
	}

	.close-btn:hover {
		background: #e81123 !important;
	}

	.zoom-indicator {
		background: var(--color-canvas-subtle);
		color: var(--color-fg-muted);
		border: 1px solid var(--color-border-default);
		border-radius: 4px;
		padding: 2px 8px;
		font-size: 11px;
		cursor: pointer;
		margin-right: 8px;
		display: flex;
		align-items: center;
		height: 24px;
		align-self: center;
		transition: all 0.1s;
	}

	.zoom-indicator:hover {
		background: var(--color-btn-hover-bg);
		color: var(--color-fg-default);
		border-color: var(--color-border-muted);
	}

	/* macOS Traffic Lights */
	.macos-traffic-lights {
		display: flex;
		gap: 8px;
		margin-right: 12px;
		align-items: center;
		padding-left: 2px;
	}

	.mac-btn {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 1px solid rgba(0, 0, 0, 0.1);
		display: flex;
		justify-content: center;
		align-items: center;
		padding: 0;
		cursor: default;
		outline: none;
		position: relative;
		overflow: hidden;
	}

	.mac-close {
		background-color: #ff5f57;
		border-color: #e0443e;
	}

	.mac-minimize {
		background-color: #febc2e;
		border-color: #d3a125;
	}

	.mac-maximize {
		background-color: #28c840;
		border-color: #1ca431;
	}

	.mac-icon {
		opacity: 0;
		color: #4d0000;
		transition: opacity 0.1s;
	}

	.mac-minimize .mac-icon {
		color: #995700;
	}

	.mac-maximize .mac-icon {
		color: #006500;
	}

	.macos-traffic-lights:hover .mac-icon {
		opacity: 0.6;
	}

	.mac-btn:active {
		filter: brightness(0.9);
	}

	.custom-tooltip {
		position: fixed;
		background: var(--color-canvas-overlay);
		color: var(--color-fg-default);
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 11px;
		font-family: var(--win-font), 'Segoe UI', sans-serif;
		pointer-events: none;
		z-index: 10005;
		transform: translateX(-50%) translateY(-4px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		border: 1px solid var(--color-border-default);
		display: flex;
		flex-direction: column;
		align-items: center;
		white-space: nowrap;
		gap: 2px;
		opacity: 0;
		transition:
			opacity 0.15s ease,
			transform 0.15s ease,
			width 0.2s cubic-bezier(0.2, 0, 0.2, 1),
			height 0.2s cubic-bezier(0.2, 0, 0.2, 1);
	}

	/* Alignment Base Transforms (Hidden State) */
	.custom-tooltip.align-center {
		transform: translateX(-50%) translateY(-4px);
	}
	.custom-tooltip.align-left {
		transform: translateX(0) translateY(-4px);
		align-items: flex-start;
	}
	.custom-tooltip.align-right {
		transform: translateX(-100%) translateY(-4px);
		align-items: flex-end;
	}

	/* Alignment Visible Transforms */
	.custom-tooltip.visible {
		opacity: 1;
	}
	.custom-tooltip.visible.align-center {
		transform: translateX(-50%) translateY(0);
	}
	.custom-tooltip.visible.align-left {
		transform: translateX(0) translateY(0);
	}
	.custom-tooltip.visible.align-right {
		transform: translateX(-100%) translateY(0);
	}

	.tooltip-shortcut {
		color: var(--color-fg-muted);
		font-size: 10px;
		font-family: inherit;
	}

	.theme-dropdown-container {
		position: relative;
	}

	.theme-menu {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 4px;
		background-color: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
		padding: 4px;
		display: flex;
		flex-direction: column;
		width: 120px;
		z-index: 10005;
	}

	.theme-option {
		background: transparent;
		border: none;
		text-align: left;
		padding: 6px 12px;
		font-size: 12px;
		color: var(--color-fg-default);
		cursor: pointer;
		border-radius: 4px;
		font-family: var(--win-font);
	}

	.theme-option:hover {
		background-color: var(--color-canvas-subtle);
	}

	.theme-option.selected {
		color: var(--color-accent-fg);
		font-weight: 600;
	}
</style>
