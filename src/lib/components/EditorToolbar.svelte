<script lang="ts">
	import { getVisibleEditorToolbarTools } from '../utils/editorToolbar.js';

	let {
		modifier = 'Ctrl',
		toolbarOrder = [],
		toolbarHidden = [],
		onaction,
	} = $props<{
		modifier?: 'Ctrl' | 'Cmd';
		toolbarOrder?: string[];
		toolbarHidden?: string[];
		onaction: (actionId: string) => void;
	}>();

	const tools = $derived.by(() => getVisibleEditorToolbarTools(toolbarOrder, toolbarHidden));
</script>

<div class="editor-toolbar" role="toolbar" aria-label="Markdown formatting">
	{#each tools as tool, index (tool.id)}
		{#if index > 0 && tools[index - 1].group !== tool.group}
			<span class="toolbar-separator" aria-hidden="true"></span>
		{/if}
		<button
			type="button"
			class:inline-style={tool.id === 'fmt-italic'}
			class:underline-style={tool.id === 'fmt-underline'}
			aria-label={tool.shortcut ? `${tool.name} (${tool.shortcut(modifier)})` : tool.name}
			title={tool.shortcut ? `${tool.name} (${tool.shortcut(modifier)})` : tool.name}
			onclick={() => onaction(tool.id)}>
			{tool.label}
		</button>
	{/each}
</div>

<style>
	.editor-toolbar {
		display: flex;
		align-items: center;
		gap: 2px;
		min-height: 34px;
		padding: 4px 8px;
		border-bottom: 1px solid var(--color-border-muted);
		background: var(--color-canvas-subtle, var(--color-canvas-default));
		overflow-x: auto;
		overflow-y: hidden;
		box-sizing: border-box;
		scrollbar-width: thin;
	}

	button {
		width: 28px;
		height: 26px;
		flex: 0 0 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		color: var(--color-fg-default);
		font: 600 12px/1 var(--win-font, system-ui, sans-serif);
		cursor: pointer;
		padding: 0;
	}

	button:hover {
		background: var(--color-neutral-muted, rgba(175, 184, 193, 0.2));
		border-color: var(--color-border-muted);
	}

	button:focus-visible {
		outline: 2px solid var(--color-accent-fg);
		outline-offset: 1px;
	}

	.inline-style {
		font-style: italic;
	}

	.underline-style {
		text-decoration: underline;
	}

	.toolbar-separator {
		width: 1px;
		height: 18px;
		margin: 0 5px;
		flex: 0 0 1px;
		background: var(--color-border-muted);
	}
</style>
