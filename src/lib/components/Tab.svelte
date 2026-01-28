<script lang="ts">
	import type { Tab } from '../stores/tabs.svelte.js';

	let { tab, isActive, isLast, onclick, onclose } = $props<{
		tab: Tab;
		isActive: boolean;
		isLast?: boolean;
		onclick: () => void;
		onclose: (e: MouseEvent) => void;
	}>();

	function handleClose(e: MouseEvent) {
		e.stopPropagation();
		onclose(e);
	}

	function handleMiddleClick(e: MouseEvent) {
		if (e.button === 1) {
			e.preventDefault();
			e.stopPropagation();
			onclose(e);
		}
	}

	async function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();

		const { invoke } = await import('@tauri-apps/api/core');
		invoke('show_context_menu', {
			menuType: 'tab',
			path: tab.path || null,
			tabId: tab.id,
			hasSelection: false,
		}).catch(console.error);
	}

	// home tab has empty path
	let isHomeTab = $derived(tab.path === '');
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tab {isActive ? 'active' : ''}" class:last={isLast} role="group" title={tab.path || 'Recents'} oncontextmenu={handleContextMenu}>
	<button class="tab-content-btn" {onclick} onmousedown={handleMiddleClick}>
		<span class="tab-label">
			{tab.title}
		</span>
	</button>
	<div class="tab-actions">
		<button class="tab-close" class:dirty={tab.isDirty} onclick={handleClose} title="Close (Ctrl+W)">
			{#if tab.isDirty}
				<span class="dirty-dot"></span>
			{/if}
			<svg class="close-icon" width="12" height="12" viewBox="0 0 12 12"
				><path fill="currentColor" d="M11 1.7L10.3 1 6 5.3 1.7 1 1 1.7 5.3 6 1 10.3 1.7 11 6 6.7 10.3 11 11 10.3 6.7 6z" /></svg>
		</button>
	</div>
</div>

<style>
	.tab {
		display: flex;
		align-items: center;
		height: 28px;
		min-width: 100px;
		max-width: 200px;
		padding: 0;
		margin: 0;
		background: transparent;
		color: var(--color-fg-muted);
		user-select: none;
		position: relative;
		font-size: 12px;
		font-family: var(--win-font, 'Segoe UI', sans-serif);
		border-radius: 8px;
		transition:
			background-color 0.25s cubic-bezier(0.05, 0.95, 0.05, 0.95),
			color 0.25s cubic-bezier(0.05, 0.95, 0.05, 0.95);
	}

	.tab.last {
		border-right: none;
	}

	/* wrapper styles */
	.tab:hover {
		background-color: var(--color-neutral-muted);
	}

	.tab.active {
		background-color: var(--tab-active-bg, #dee1e6);
		color: var(--color-fg-default);
	}

	@media (prefers-color-scheme: dark) {
		.tab.active {
			--tab-active-bg: #2d2e30;
		}
	}

	.tab-content-btn {
		appearance: none;
		background: transparent;
		border: none;
		color: inherit;
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		width: 100%;
		height: 100%;
		padding: 0 4px 0 12px;
		overflow: hidden;
		cursor: pointer;
		font-family: inherit;
		font-size: inherit;
		text-align: left;
	}

	.tab-status-icon {
		display: flex;
		opacity: 0.8;
		flex-shrink: 0;
		color: var(--color-accent-fg);
		margin-right: 4px;
	}

	.tab-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tab-actions {
		display: flex;
		align-items: center;
		padding-right: 4px;
		opacity: 0;
	}

	.tab:hover .tab-actions,
	.tab.active .tab-actions,
	.tab-actions:has(.dirty) {
		opacity: 1;
	}

	.tab-close {
		width: 18px;
		height: 18px;
		border-radius: 4px;
		display: flex;
		scale: 0.8;
		justify-content: center;
		align-items: center;
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		padding: 0;
		transition: background 0.1s;
		position: relative;
	}

	.close-icon {
		display: none;
	}

	.tab:hover .close-icon {
		display: block;
	}

	.tab:hover .dirty-dot {
		display: none;
	}

	.dirty-dot {
		width: 8px;
		height: 8px;
		background-color: var(--color-fg-default);
		border-radius: 50%;
		display: block;
	}

	.tab-close:hover {
		background-color: var(--color-neutral-muted);
	}
</style>
