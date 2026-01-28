<script lang="ts">
	import { type Tab as TabData, tabManager } from '../stores/tabs.svelte.js';
	import Tab from './Tab.svelte';

	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';

	let {
		onnewTab,
		ondetach,
		showHome = false,
		ontabclick,
		oncloseTab,
	} = $props<{
		onnewTab: () => void;
		ondetach?: (tabId: string) => void;
		showHome?: boolean;
		ontabclick?: () => void;
		oncloseTab?: (id: string) => void;
	}>();

	$effect(() => {
		const activeId = tabManager.activeTabId;
		if (activeId && scrollContainer && !draggingId) {
			// Find the active tab element index
			const index = tabManager.tabs.findIndex((t) => t.id === activeId);
			if (index !== -1) {
				// Use tick to wait for DOM update, and setTimeout to account for transition
				tick().then(() => {
					setTimeout(() => {
						if (!scrollContainer) return;
						const tabElements = scrollContainer.children;
						if (tabElements[index]) {
							const el = tabElements[index] as HTMLElement;
							el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
						}
					}, 150); // Wait slightly longer than transition (150ms)
				});
			}
		}
	});

	let draggingId = $state<string | null>(null);
	let scrollContainer = $state<HTMLElement | null>(null);
	let showLeftArrow = $state(false);
	let showRightArrow = $state(false);

	function handleDragStart(e: DragEvent, id: string) {
		e.stopPropagation();
		draggingId = id;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			// Must set data to be valid drag
			e.dataTransfer.setData('text/plain', id);
		}
	}

	function handleDragEnter(e: DragEvent, targetId: string) {
		if (!draggingId || draggingId === targetId) return;
		e.preventDefault();

		const fromIndex = tabManager.tabs.findIndex((t) => t.id === draggingId);
		const toIndex = tabManager.tabs.findIndex((t) => t.id === targetId);

		if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
			tabManager.reorderTabs(fromIndex, toIndex);
		}
	}

	function handleDragOver(e: DragEvent) {
		// Crucial for allowing drop events and drag functionality
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';
	}

	function handleDragEnd(e: DragEvent) {
		draggingId = null;
		// Detach functionality removed for now
	}

	$effect(() => {
		const _ = tabManager.tabs;
	});

	$effect(() => {
		const activeId = tabManager.activeTabId;
		if (activeId && scrollContainer && !draggingId) {
			// Find the active tab element index
			const index = tabManager.tabs.findIndex((t) => t.id === activeId);
			if (index !== -1) {
				// Use tick to wait for DOM update, and setTimeout to account for transition
				tick().then(() => {
					setTimeout(() => {
						if (!scrollContainer) return;

						// If it's the last tab, just scroll to the very end to be safe
						if (index === tabManager.tabs.length - 1) {
							scrollContainer.scrollTo({ left: 99999, behavior: 'smooth' });
							return;
						}

						const tabElements = scrollContainer.children;
						if (tabElements[index]) {
							const el = tabElements[index] as HTMLElement;
							el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
						}
					}, 150); // Wait slightly longer than transition (150ms)
				});
			}
		}
	});

	async function handleContainerContextMenu(e: MouseEvent) {
		if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('tab-list-spacer')) return;
		e.preventDefault();

		const { invoke } = await import('@tauri-apps/api/core');
		invoke('show_context_menu', {
			menuType: 'tab_bar',
			path: null,
			tabId: null,
			hasSelection: false,
		}).catch(console.error);
	}
</script>

<div class="tab-list-wrapper">
	<div class="scroll-viewport">
		<div class="scroll-shadow left" class:visible={showLeftArrow}></div>

		<div
			bind:this={scrollContainer}
			class="tab-list-container"
			data-tauri-drag-region={tabManager.tabs.length === 0}
			role="tablist"
			tabindex="-1"
			oncontextmenu={handleContainerContextMenu}
			onwheel={(e) => {
				if (e.deltaY !== 0) {
					e.preventDefault();
					e.currentTarget.scrollLeft += e.deltaY;
				}
			}}>
			{#each tabManager.tabs as tab, i (tab.id)}
				<div
					animate:flip={{ duration: draggingId ? 0 : 200 }}
					transition:slide={{ axis: 'x', duration: 150 }}
					draggable={true}
					ondragstart={(e) => handleDragStart(e, tab.id)}
					ondragenter={(e) => handleDragEnter(e, tab.id)}
					ondragover={handleDragOver}
					ondragend={(e) => handleDragEnd(e)}
					role="listitem">
					<Tab
						{tab}
						isActive={!showHome && tabManager.activeTabId === tab.id}
						isLast={i === tabManager.tabs.length - 1}
						onclick={() => {
							tabManager.setActive(tab.id);
							ontabclick?.();
						}}
						onclose={() => oncloseTab?.(tab.id)} />
				</div>
			{/each}
		</div>

		<div class="scroll-shadow right" class:visible={showRightArrow}></div>
	</div>

	<button class="new-tab-btn" onclick={onnewTab} title="New tab (Ctrl+T)">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
			><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
	</button>

	<div class="tab-list-spacer" data-tauri-drag-region></div>
</div>

<style>
	.tab-list-wrapper {
		display: flex;
		align-items: center;
		height: 100%;
		overflow: hidden;
		flex: 1; /* Take all available space */
		min-width: 0;
	}

	.scroll-viewport {
		position: relative;
		display: flex;
		flex: 0 1 auto;
		height: 100%;
		overflow: hidden;
		min-width: 0;
		max-width: 100%;
	}

	.scroll-shadow {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 40px;
		z-index: 20;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.scroll-shadow.visible {
		opacity: 1;
	}

	.scroll-shadow.left {
		left: 0;
		background: linear-gradient(to right, var(--color-canvas-default), transparent);
	}

	.scroll-shadow.right {
		right: 0;
		background: linear-gradient(to left, var(--color-canvas-default), transparent);
	}

	.tab-list-container {
		display: flex;
		flex-direction: row;
		align-items: center;
		overflow-x: auto;
		overflow-y: hidden;
		gap: 4px;
		height: 100%;
		padding-left: 10px;
		scroll-behavior: smooth;
		/* width: 100%; Removed to allow shrink */

		/* Hide scrollbar */
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	.tab-list-container::-webkit-scrollbar {
		display: none;
	}

	.new-tab-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		margin: 4px 4px 4px 4px;
		border: none;
		background: transparent;
		color: var(--color-fg-muted);
		border-radius: 8px;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			background 0.1s,
			color 0.1s;
		z-index: 21;
	}

	.new-tab-btn:hover {
		background: var(--color-neutral-muted);
		color: var(--color-fg-default);
	}

	.tab-list-spacer {
		flex: 1;
		height: 100%;
		min-width: 20px;
	}
</style>
