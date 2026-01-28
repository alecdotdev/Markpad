<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { tabManager } from '../stores/tabs.svelte.js';
	import * as monaco from 'monaco-editor';
	import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
	import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
	import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
	import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
	import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

	let {
		value = $bindable(),
		language = 'markdown',
		onsave,
	} = $props<{
		value: string;
		language?: string;
		onsave?: () => void;
	}>();

	let container: HTMLDivElement;
	let editor: monaco.editor.IStandaloneCodeEditor;

	self.MonacoEnvironment = {
		getWorker: function (_moduleId: any, label: string) {
			if (label === 'json') {
				return new jsonWorker();
			}
			if (label === 'css' || label === 'scss' || label === 'less') {
				return new cssWorker();
			}
			if (label === 'html' || label === 'handlebars' || label === 'razor') {
				return new htmlWorker();
			}
			if (label === 'typescript' || label === 'javascript') {
				return new tsWorker();
			}
			return new editorWorker();
		},
	};

	onMount(() => {
		monaco.editor.defineTheme('app-theme', {
			base: 'vs-dark',
			inherit: true,
			rules: [],
			colors: {
				'editor.background': '#181818',
			},
		});

		editor = monaco.editor.create(container, {
			value: value,
			language: language,
			theme: 'app-theme',
			dragAndDrop: true,
			automaticLayout: true,
			minimap: { enabled: true },
			scrollBeyondLastLine: true,
			wordWrap: 'on',
		});

		editor.focus();

		editor.onDidChangeModelContent(() => {
			const newValue = editor.getValue();
			if (value !== newValue) {
				value = newValue;
				if (tabManager.activeTabId) {
					tabManager.updateTabRawContent(tabManager.activeTabId, newValue);
				}
			}
		});

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			if (onsave) onsave();
		});

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
			editor.trigger('keyboard', 'editor.action.quickCommand', {});
		});

		return () => {
			editor.dispose();
		};
	});

	$effect(() => {
		if (editor && editor.getValue() !== value) {
			editor.setValue(value);
		}
	});
</script>

<div class="editor-container" bind:this={container}></div>

<style>
	.editor-container {
		width: 100%;
		height: 100%;
		overflow: hidden;
	}
</style>
