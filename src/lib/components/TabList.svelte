<script lang="ts">
	import { type Tab as TabData, tabManager } from '../stores/tabs.svelte.js';
	import Tab from './Tab.svelte';

	import { flip } from 'svelte/animate';
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

	let scrollContainer = $state<HTMLElement | null>(null);
	let showLeftArrow = $state(false);
	let showRightArrow = $state(false);

	// Drag state
	let draggingId = $state<string | null>(null);
	let justDragged = false;
	let dragState = $state<{
		startX: number;
		currentX: number;
		currentY: number;
		initialRect: DOMRect;
		tab: TabData;
		isDragging: boolean;
	} | null>(null);

	function handleMouseDown(e: MouseEvent, tab: TabData, element: HTMLElement) {
		if (e.button !== 0) return; // Only left click
		// e.preventDefault(); // allow click to propagate
		e.stopPropagation(); // Stop window drag from triggering

		const rect = element.getBoundingClientRect();
		// Don't set draggingId yet
		dragState = {
			startX: e.clientX,
			currentX: e.clientX,
			currentY: e.clientY,
			initialRect: rect,
			tab: tab,
			isDragging: false,
		};

		window.addEventListener('mousemove', handleWindowMouseMove);
		window.addEventListener('mouseup', handleWindowMouseUp);
	}

	function handleWindowMouseMove(e: MouseEvent) {
		if (!dragState || !scrollContainer) return;

		// Check threshold
		if (!dragState.isDragging) {
			if (Math.abs(e.clientX - dragState.startX) > 5) {
				dragState.isDragging = true;
				draggingId = dragState.tab.id;
			} else {
				return;
			}
		}

		dragState.currentX = e.clientX;
		dragState.currentY = e.clientY;

		// Auto scroll logic
		const containerRect = scrollContainer.getBoundingClientRect();
		const scrollZone = 50;
		if (e.clientX < containerRect.left + scrollZone) {
			scrollContainer.scrollLeft -= 10;
		} else if (e.clientX > containerRect.right - scrollZone) {
			scrollContainer.scrollLeft += 10;
		}

		// Reorder logic
		// We iterate through tabs to find the best fit position
		const children = Array.from(scrollContainer.children) as HTMLElement[];
		let closestIndex = -1;
		let minDist = Infinity;

		children.forEach((child, index) => {
			// Check if child corresponds to a tab (it should)
			if (!child.classList.contains('tab-item-wrapper')) return;

			const rect = child.getBoundingClientRect();
			const center = rect.left + rect.width / 2;
			const dist = Math.abs(e.clientX - center);

			if (dist < minDist) {
				minDist = dist;
				closestIndex = index;
			}
		});

		if (closestIndex !== -1) {
			const currentIndex = tabManager.tabs.findIndex((t) => t.id === draggingId);
			// We only reorder if the index actually changed
			if (currentIndex !== -1 && currentIndex !== closestIndex) {
				tabManager.reorderTabs(currentIndex, closestIndex);
			}
		}
	}

	function handleWindowMouseUp() {
		if (dragState?.isDragging) {
			justDragged = true;
			setTimeout(() => {
				justDragged = false;
			}, 50);
		}

		draggingId = null;
		dragState = null;
		window.removeEventListener('mousemove', handleWindowMouseMove);
		window.removeEventListener('mouseup', handleWindowMouseUp);
	}

	// Scroll active tab into view logic
	$effect(() => {
		const activeId = tabManager.activeTabId;
		// Don't scroll while dragging to avoid fighting the user
		if (activeId && scrollContainer && !draggingId) {
			const index = tabManager.tabs.findIndex((t) => t.id === activeId);
			if (index !== -1) {
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
					}, 150);
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

		<!-- 
			data-tauri-drag-region allows dragging the window.
			Because we stopPropagation in handleMouseDown, dragging tabs won't drag the window.
			But clicking in the empty space between tabs will drag the window.
		-->
		<div
			bind:this={scrollContainer}
			class="tab-list-container"
			data-tauri-drag-region
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
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="tab-item-wrapper"
					animate:flip={{ duration: 200 }}
					role="listitem"
					class:drag-opacity={draggingId === tab.id}
					onmousedown={(e) => handleMouseDown(e, tab, e.currentTarget as HTMLElement)}>
					<Tab
						{tab}
						isActive={!showHome && tabManager.activeTabId === tab.id}
						isLast={i === tabManager.tabs.length - 1}
						onclick={() => {
							if (justDragged) return;
							tabManager.setActive(tab.id);
							ontabclick?.();
						}}
						onclose={() => oncloseTab?.(tab.id)} />
				</div>
			{/each}
		</div>

		{#if draggingId && dragState}
			<div class="drag-proxy" style:left="{dragState.initialRect.left + (dragState.currentX - dragState.startX)}px" style:top="{dragState.initialRect.top}px">
				<Tab tab={dragState.tab} isActive={!showHome && tabManager.activeTabId === dragState.tab.id} onclick={() => {}} onclose={() => {}} />
			</div>
		{/if}

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

	/* Drag styles */
	.tab-item-wrapper {
		transition: opacity 0.1s;
	}

	.tab-item-wrapper.drag-opacity {
		opacity: 0;
		pointer-events: none;
	}

	.drag-proxy {
		position: fixed;
		z-index: 10000;
		pointer-events: none;
		opacity: 0.9;
		/* Ensure smooth movement */
		will-change: left, top;
	}
</style>
