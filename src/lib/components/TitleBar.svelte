<script lang="ts">
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { fly, slide } from 'svelte/transition';
	import iconUrl from '../../assets/icon.png';
	import TabList from './TabList.svelte';
	import { tabManager } from '../stores/tabs.svelte.js';

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
		isEditing,
		ondetach,
		ontabclick,
		zoomLevel,
		onresetZoom,
		oncloseTab,
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
		isEditing: boolean;
		ondetach: (tabId: string) => void;
		ontabclick?: () => void;
		zoomLevel?: number;
		onresetZoom?: () => void;
		oncloseTab?: (id: string) => void;
	}>();

	const appWindow = getCurrentWindow();

	// DEBUG: Set this to true to simulate macOS traffic lights on Windows
	const DEBUG_MACOS = false;

	const isMac = typeof navigator !== 'undefined' && (navigator.userAgent.includes('Macintosh') || DEBUG_MACOS);
</script>

<div class="custom-title-bar {isScrolled ? 'scrolled' : ''} {!isMac ? 'windows' : ''}">
	{#if !isMac}
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
		<button class="icon-home-btn {showHome ? 'active' : ''}" onclick={ontoggleHome} aria-label="Go to Home" title="Go to home">
			<img src={iconUrl} alt="icon" class="window-icon" />
		</button>
	</div>

	{#if tabManager.tabs.length > 0}
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
		{#if zoomLevel && zoomLevel !== 100}
			<button class="zoom-indicator" onclick={onresetZoom} transition:fly={{ y: -10, duration: 150 }} aria-label="Reset Zoom" title="Reset zoom">
				{zoomLevel}%
			</button>
		{/if}
		{#if currentFile}
			{@const ext = currentFile.split('.').pop()?.toLowerCase() || ''}
			{@const isMarkdown = ['md', 'markdown', 'mdown', 'mkd'].includes(ext)}
			<div class="actions-wrapper" transition:slide={{ axis: 'x', duration: 200 }}>
				<button class="title-action-btn" onclick={ononpenFileLocation} aria-label="Open File Location" title="Open folder" transition:fly={{ x: 10, duration: 100, delay: 0 }}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
						><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><polyline points="15 13 18 13 18 10"></polyline><line
							x1="14"
							y1="14"
							x2="18"
							y2="10"></line
						></svg>
				</button>
				{#if isMarkdown}
					<button
						class="title-action-btn {liveMode ? 'active' : ''}"
						onclick={ontoggleLiveMode}
						aria-label="Toggle Live Mode"
						title="Live update mode"
						transition:fly={{ x: 20, duration: 100, delay: 50 }}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
							><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" /><circle cx="12" cy="12" r="3" /></svg>
					</button>
					<button
						class="title-action-btn {isEditing ? 'active' : ''}"
						onclick={ontoggleEdit}
						aria-label="Edit File"
						title="Edit file"
						transition:fly={{ x: 30, duration: 100, delay: 100 }}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
							><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
					</button>
				{/if}
			</div>
		{/if}
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
		overflow: hidden; /* Essential for slide to work */
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
</style>
