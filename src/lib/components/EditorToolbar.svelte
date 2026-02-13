<script lang="ts">
	import { fly } from 'svelte/transition';

	let {
		onformat,
		disabled = false,
	} = $props<{
		onformat: (action: string, params?: any) => void;
		disabled?: boolean;
	}>();

	const toolbarGroups = [
		{
			id: 'text',
			buttons: [
				{ id: 'bold', icon: 'B', label: 'Bold', shortcut: 'Ctrl+B', style: 'font-weight: 700' },
				{ id: 'italic', icon: 'I', label: 'Italic', shortcut: 'Ctrl+I', style: 'font-style: italic' },
				{ id: 'underline', icon: 'U', label: 'Underline', shortcut: 'Ctrl+U', style: 'text-decoration: underline' },
				{ id: 'strikethrough', icon: 'S', label: 'Strikethrough', shortcut: 'Ctrl+Shift+S', style: 'text-decoration: line-through' },
				{ id: 'inlineCode', icon: '<>', label: 'Inline Code', shortcut: 'Ctrl+`', style: '' },
			],
		},
		{
			id: 'heading',
			buttons: [
				{ id: 'heading1', icon: 'H1', label: 'Heading 1', shortcut: 'Ctrl+1' },
				{ id: 'heading2', icon: 'H2', label: 'Heading 2', shortcut: 'Ctrl+2' },
				{ id: 'heading3', icon: 'H3', label: 'Heading 3', shortcut: 'Ctrl+3' },
				{ id: 'heading4', icon: 'H4', label: 'Heading 4' },
				{ id: 'heading5', icon: 'H5', label: 'Heading 5' },
				{ id: 'heading6', icon: 'H6', label: 'Heading 6' },
			],
		},
		{
			id: 'list',
			buttons: [
				{ id: 'unorderedList', icon: '•', label: 'Bullet List', shortcut: 'Ctrl+Shift+8' },
				{ id: 'orderedList', icon: '1.', label: 'Numbered List', shortcut: 'Ctrl+Shift+7' },
				{ id: 'taskList', icon: '☐', label: 'Task List', shortcut: 'Ctrl+Shift+9' },
			],
		},
		{
			id: 'block',
			buttons: [
				{ id: 'blockquote', icon: '❝', label: 'Quote', shortcut: 'Ctrl+Shift+.' },
				{ id: 'insertCodeBlock', icon: '{ }', label: 'Code Block', shortcut: 'Ctrl+Shift+K' },
				{ id: 'insertHorizontalRule', icon: '—', label: 'Horizontal Rule' },
			],
		},
		{
			id: 'insert',
			buttons: [
				{ id: 'insertLink', icon: '🔗', label: 'Insert Link', shortcut: 'Ctrl+K' },
				{ id: 'insertImage', icon: '🖼', label: 'Insert Image', shortcut: 'Ctrl+Shift+I' },
				{ id: 'insertTable', icon: '▦', label: 'Insert Table', shortcut: 'Ctrl+Alt+T' },
			],
		},
	];

	let tooltip = $state({ show: false, text: '', shortcut: '', x: 0, y: 0 });

	function showTooltip(e: MouseEvent, label: string, shortcut?: string) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		tooltip = {
			show: true,
			text: label,
			shortcut: shortcut || '',
			x: rect.left + rect.width / 2,
			y: rect.bottom + 8,
		};
	}

	function hideTooltip() {
		tooltip.show = false;
	}

	function handleClick(action: string) {
		if (disabled) return;
		onformat(action);
	}

	function handleMouseDown(event: MouseEvent) {
		event.preventDefault();
	}
</script>

<div class="editor-toolbar" transition:fly={{ y: -8, duration: 150 }}>
	{#each toolbarGroups as group}
		<div class="toolbar-group">
			{#each group.buttons as btn}
				<button
					type="button"
					class="toolbar-btn"
					class:disabled
					disabled={disabled}
					onmousedown={handleMouseDown}
					onclick={() => handleClick(btn.id)}
					onmouseenter={(e) => showTooltip(e, btn.label, btn.shortcut)}
					onmouseleave={hideTooltip}
					aria-label={btn.label}
					style={'style' in btn ? btn.style : ''}>
					{#if btn.icon.length <= 2}
						<span class="btn-text">{btn.icon}</span>
					{:else}
						<span class="btn-icon">{btn.icon}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/each}
</div>

{#if tooltip.show}
	<div class="toolbar-tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;" transition:fly={{ y: -4, duration: 100 }}>
		<span class="tooltip-label">{tooltip.text}</span>
		{#if tooltip.shortcut}
			<span class="tooltip-shortcut">{tooltip.shortcut}</span>
		{/if}
	</div>
{/if}

<style>
	.editor-toolbar {
		display: flex;
		gap: 4px;
		padding: 4px 8px;
		background: var(--color-canvas-subtle);
		border-bottom: 1px solid var(--color-border-muted);
		height: 32px;
		align-items: center;
		user-select: none;
		flex-shrink: 0;
		z-index: 10;
	}

	.toolbar-group {
		display: flex;
		gap: 2px;
		padding: 0 4px;
		border-right: 1px solid var(--color-border-muted);
	}

	.toolbar-group:last-child {
		border-right: none;
	}

	.toolbar-btn {
		width: 28px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--color-fg-muted);
		font-family: var(--font-mono, monospace);
		font-size: 12px;
		transition: all 0.1s;
		padding: 0;
	}

	.toolbar-btn:hover:not(.disabled) {
		background: var(--color-canvas-default);
		color: var(--color-fg-default);
	}

	.toolbar-btn:active:not(.disabled) {
		background: var(--color-canvas-inset);
	}

	.toolbar-btn.disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-text {
		font-weight: 600;
	}

	.btn-icon {
		font-size: 14px;
	}

	.toolbar-tooltip {
		position: fixed;
		background: var(--color-canvas-default);
		color: var(--color-fg-default);
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 11px;
		font-family: var(--win-font);
		pointer-events: none;
		z-index: 10005;
		transform: translateX(-50%);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		border: 1px solid var(--color-border-default);
		display: flex;
		flex-direction: column;
		align-items: center;
		white-space: nowrap;
		gap: 2px;
	}

	.tooltip-shortcut {
		color: var(--color-fg-muted);
		font-size: 10px;
	}
</style>
