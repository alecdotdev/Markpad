<script lang="ts">
	import { fade } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { t } from '../utils/i18n.js';
	import { settings } from '../stores/settings.svelte.js';

	let { src, html, onclose } = $props<{
		src?: string;
		html?: string;
		onclose: () => void;
	}>();

	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isDragging = $state(false);
	let startX = 0;
	let startY = 0;

	const MIN_ZOOM = 0.1;
	const MAX_ZOOM = 10;

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const delta = -e.deltaY;
		const factor = delta > 0 ? 1.1 : 0.9;
		const newZoom = zoom * factor;
		if (newZoom >= MIN_ZOOM && newZoom <= MAX_ZOOM) {
			zoom = newZoom;
		}
	}

	function handleMouseDown(e: MouseEvent) {
		if (e.button !== 0) return;
		isDragging = true;
		startX = e.clientX - panX;
		startY = e.clientY - panY;
	}

	function handleMouseMove(e: MouseEvent) {
		if (!isDragging) return;
		panX = e.clientX - startX;
		panY = e.clientY - startY;
	}

	function handleMouseUp() {
		isDragging = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onclose();
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});
</script>

<div class="zoom-overlay" transition:fade={{ duration: 150 }} onclick={onclose} role="presentation">
	<button class="close-btn" onclick={onclose} aria-label={t('common.close', settings.language)}>
		<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<line x1="18" y1="6" x2="6" y2="18"></line>
			<line x1="6" y1="6" x2="18" y2="18"></line>
		</svg>
	</button>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div 
		class="zoom-content" 
		onclick={(e) => e.stopPropagation()} 
		onwheel={handleWheel}
		onmousedown={handleMouseDown}
		onmousemove={handleMouseMove}
		onmouseup={handleMouseUp}
		onmouseleave={handleMouseUp}
		style="transform: translate({panX}px, {panY}px) scale({zoom}); cursor: {isDragging ? 'grabbing' : 'grab'}"
	>
		{#if src}
			<img {src} alt="Zoomed view" />
		{:else if html}
			<div class="svg-container">{@html html}</div>
		{/if}
	</div>
</div>

<style>
	.zoom-overlay {
		position: fixed;
		top: 36px;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.9);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50000;
		overflow: hidden;
	}

	.close-btn {
		position: absolute;
		top: 24px;
		right: 24px;
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: white;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		z-index: 50001;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
	}

	.close-btn:hover {
		background: rgba(255, 255, 255, 0.2);
		transform: scale(1.05);
	}

	.close-btn:active {
		transform: scale(0.95);
	}

	.zoom-content {
		display: flex;
		align-items: center;
		justify-content: center;
		user-select: none;
		will-change: transform;
		transform-origin: center center;
	}

	img {
		max-width: 90vw;
		max-height: 85vh;
		object-fit: contain;
		pointer-events: none;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
		image-rendering: auto;
		border-radius: 4px;
	}

	.svg-container {
		background: var(--color-canvas-default);
		padding: 32px;
		border-radius: 8px;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}

	:global(.svg-container svg) {
		display: block;
		min-width: 400px;
		height: auto;
	}
</style>
