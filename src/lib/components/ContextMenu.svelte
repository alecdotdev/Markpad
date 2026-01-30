<script lang="ts">
	let { show, x, y, currentFile, oncopy, onselectAll, onopenFileLocation, onopenInEditor, oncloseFile, onhide } = $props<{
		show: boolean;
		x: number;
		y: number;
		currentFile: string;
		oncopy: () => void;
		onselectAll: () => void;
		onopenFileLocation: () => void;
		onopenInEditor: () => void;
		oncloseFile: () => void;
		onhide: () => void;
	}>();
	let menuEl = $state<HTMLDivElement>();

	$effect(() => {
		if (show && menuEl) {
			// Small timeout to ensure element exists in DOM/transition starts
			setTimeout(() => {
				menuEl?.focus();
			}, 10);
		}
	});
</script>

{#if show}
	<div
		class="context-menu"
		bind:this={menuEl}
		style="left: {x}px; top: {y}px;"
		onclick={(e) => e.stopPropagation()}
		role="menu"
		tabindex="-1"
		onkeydown={(e) => e.key === 'Escape' && onhide()}>
		<button class="menu-item" onclick={oncopy}>Copy</button>
		<button class="menu-item" onclick={onselectAll}>Select All</button>
		<div class="menu-separator"></div>
		<button class="menu-item" onclick={onopenFileLocation} disabled={!currentFile}>Open file location</button>
		<button class="menu-item" onclick={onopenInEditor} disabled={!currentFile}>Open in Notepad</button>
		<div class="menu-separator"></div>
		<button class="menu-item" onclick={oncloseFile} disabled={!currentFile}>Close</button>
	</div>
{/if}

<style>
	.context-menu {
		position: fixed;
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		padding: 4px;
		min-width: 180px;
		z-index: 20000;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		font-family: var(--win-font);
		animation: menuFade 0.1s ease-out;
		outline: none;
	}

	@keyframes menuFade {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.menu-item {
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		color: var(--color-fg-default);
		padding: 6px 12px;
		font-size: 13px;
		border-radius: 4px;
		cursor: default;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.menu-item:hover:not(:disabled) {
		background: var(--color-neutral-muted);
	}

	.menu-item:disabled {
		opacity: 0.3;
	}

	.menu-separator {
		height: 1px;
		background: var(--color-border-muted);
		margin: 4px 0;
	}
</style>
