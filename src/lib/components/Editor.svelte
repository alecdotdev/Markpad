<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { tabManager } from '../stores/tabs.svelte.js';
	import { settings } from '../stores/settings.svelte.js';

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
		onnew,
		onopen,
		onclose,
		onreveal,
		ontoggleEdit,
		ontoggleLive,
		onhome,
		onnextTab,
		onprevTab,
		onundoClose,
		onscrollsync,
		zoomLevel = $bindable(100),
	} = $props<{
		value: string;
		language?: string;
		onsave?: () => void;
		onnew?: () => void;
		onopen?: () => void;
		onclose?: () => void;
		onreveal?: () => void;
		ontoggleEdit?: () => void;
		ontoggleLive?: () => void;
		onhome?: () => void;
		onnextTab?: () => void;
		onprevTab?: () => void;
		onundoClose?: () => void;
		onscrollsync?: (line: number, ratio?: number) => void;
		zoomLevel?: number;
	}>();

	let container: HTMLDivElement;
	let editor: monaco.editor.IStandaloneCodeEditor;
	const currentTabId = tabManager.activeTabId;

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
		const defineThemes = () => {
			monaco.editor.defineTheme('app-theme-dark', {
				base: 'vs-dark',
				inherit: true,
				rules: [],
				colors: {
					'editor.background': '#181818',
				},
			});

			monaco.editor.defineTheme('app-theme-light', {
				base: 'vs',
				inherit: true,
				rules: [],
				colors: {
					'editor.background': '#FDFDFD',
				},
			});
		};

		defineThemes();

		const getTheme = () => {
			return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'app-theme-dark' : 'app-theme-light';
		};

		editor = monaco.editor.create(container, {
			value: value,
			language: language,
			theme: getTheme(),
			dragAndDrop: true,
			automaticLayout: true,
			minimap: { enabled: settings.minimap },
			scrollBeyondLastLine: false,
			wordWrap: settings.wordWrap as 'on' | 'off' | 'wordWrapColumn' | 'bounded',
			lineNumbers: settings.lineNumbers as 'on' | 'off' | 'relative' | 'interval',
		});

		if (tabManager.activeTab?.editorViewState) {
			editor.restoreViewState(tabManager.activeTab.editorViewState);
		}

		let scrolled = false;
		if (tabManager.activeTab) {
			if (tabManager.activeTab.anchorLine > 0) {
				editor.revealLineNearTop(Math.max(1, tabManager.activeTab.anchorLine - 2), monaco.editor.ScrollType.Smooth);
				scrolled = true;
			}

			if (!scrolled) {
				const scrollHeight = editor.getScrollHeight();
				const clientHeight = editor.getLayoutInfo().height;
				if (scrollHeight > clientHeight) {
					const targetScroll = tabManager.activeTab.scrollPercentage * (scrollHeight - clientHeight);
					editor.setScrollTop(targetScroll);
				}
			}
		}

		editor.addAction({
			id: 'toggle-minimap',
			label: 'Toggle Minimap',
			run: () => {
				settings.toggleMinimap();
			},
		});

		editor.addAction({
			id: 'toggle-word-wrap',
			label: 'Toggle Word Wrap',
			run: () => {
				settings.toggleWordWrap();
			},
		});

		editor.addAction({
			id: 'toggle-line-numbers',
			label: 'Toggle Line Numbers',
			run: () => {
				settings.toggleLineNumbers();
			},
		});

		const updateTheme = (e: MediaQueryListEvent) => {
			monaco.editor.setTheme(e.matches ? 'app-theme-dark' : 'app-theme-light');
		};

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		mediaQuery.addEventListener('change', updateTheme);

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

		const insertTextAtCursor = (text: string) => {
			const selection = editor.getSelection();
			if (!selection) return;
			const id = { major: 1, minor: 1 };
			const op = { range: selection, text: text, forceMoveMarkers: true };
			editor.executeEdits('my-source', [op]);
		};

		const toggleFormat = (marker: string, type: 'wrap' | 'block' | 'tag' = 'wrap') => {
			const selection = editor.getSelection();
			if (!selection) return;

			const model = editor.getModel();
			if (!model) return;

			const text = model.getValueInRange(selection);

			if (type === 'wrap') {
				if (text.startsWith(marker) && text.endsWith(marker)) {
					const newText = text.slice(marker.length, -marker.length);
					editor.executeEdits('toggle-format', [{ range: selection, text: newText }]);
				} else {
					editor.executeEdits('toggle-format', [{ range: selection, text: `${marker}${text}${marker}` }]);
				}
			} else if (type === 'tag') {
				const [startTag, endTag] = marker.split('|');
				if (text.startsWith(startTag) && text.endsWith(endTag)) {
					const newText = text.slice(startTag.length, -endTag.length);
					editor.executeEdits('toggle-format', [{ range: selection, text: newText }]);
				} else {
					editor.executeEdits('toggle-format', [{ range: selection, text: `${startTag}${text}${endTag}` }]);
				}
			}
		};

		editor.addAction({
			id: 'fmt-bold',
			label: 'Format: Bold',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
			run: () => toggleFormat('**'),
		});

		editor.addAction({
			id: 'fmt-italic',
			label: 'Format: Italic',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
			run: () => toggleFormat('*'),
		});

		editor.addAction({
			id: 'fmt-underline',
			label: 'Format: Underline',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyU],
			run: () => toggleFormat('<u>|</u>', 'tag'),
		});

		editor.addAction({
			id: 'insert-table-simple',
			label: 'Insert Table',
			keybindings: [monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyCode.KeyT)],
			run: () => {
				const selection = editor.getSelection();
				if (!selection) return;

				const cols = 3;
				const rows = 2;
				let table = '\n';
				table += '| ' + Array(cols).fill('Header').join(' | ') + ' |\n';
				table += '| ' + Array(cols).fill('---').join(' | ') + ' |\n';
				for (let i = 0; i < rows; i++) {
					table += '| ' + Array(cols).fill('Cell').join(' | ') + ' |\n';
				}
				table += '\n';

				editor.executeEdits('insert-table', [
					{
						range: selection,
						text: table,
						forceMoveMarkers: true,
					},
				]);
			},
		});

		editor.addAction({
			id: 'file-new',
			label: 'New File',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT],
			run: () => onnew?.(),
		});

		editor.addAction({
			id: 'file-open',
			label: 'Open File',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO],
			run: () => onopen?.(),
		});

		editor.addAction({
			id: 'file-save',
			label: 'Save File',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
			run: () => onsave?.(),
		});

		editor.addAction({
			id: 'file-close',
			label: 'Close File',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW],
			run: () => onclose?.(),
		});

		editor.addAction({
			id: 'file-reveal',
			label: 'Open File Location',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR],
			run: () => onreveal?.(),
		});

		editor.addAction({
			id: 'view-toggle-edit',
			label: 'Toggle Edit Mode',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
			run: () => ontoggleEdit?.(),
		});

		editor.addAction({
			id: 'view-toggle-live',
			label: 'Toggle Live Mode',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
			run: () => ontoggleLive?.(),
		});

		editor.addAction({
			id: 'view-toggle-split',
			label: 'Toggle Split View',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
			run: () => {
				if (currentTabId) {
					tabManager.toggleSplit(currentTabId);
				}
			},
		});

		editor.addAction({
			id: 'tab-next',
			label: 'Next Tab',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Tab],
			run: () => onnextTab?.(),
		});

		editor.addAction({
			id: 'tab-prev',
			label: 'Previous Tab',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Tab],
			run: () => onprevTab?.(),
		});

		editor.addAction({
			id: 'tab-undo-close',
			label: 'Undo Close Tab',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyT],
			run: () => onundoClose?.(),
		});

		editor.addAction({
			id: 'app-command-palette',
			label: 'Command Palette',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP],
			run: (ed) => {
				ed.trigger('keyboard', 'editor.action.quickCommand', {});
			},
		});

		const wheelListener = (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				e.stopPropagation();
				if (e.deltaY < 0) {
					zoomLevel = Math.min(zoomLevel + 10, 500);
				} else {
					zoomLevel = Math.max(zoomLevel - 10, 25);
				}
			}
		};

		container.addEventListener('wheel', wheelListener, { capture: true });

		return () => {
			mediaQuery.removeEventListener('change', updateTheme);
			container.removeEventListener('wheel', wheelListener, { capture: true });

			if (editor && currentTabId) {
				const state = editor.saveViewState();
				tabManager.updateTabEditorState(currentTabId, state);

				const scrollHeight = editor.getScrollHeight();
				const clientHeight = editor.getLayoutInfo().height;
				if (scrollHeight > clientHeight) {
					const percentage = editor.getScrollTop() / (scrollHeight - clientHeight);
					tabManager.updateTabScrollPercentage(currentTabId, percentage);
				}

				const ranges = editor.getVisibleRanges();
				if (ranges.length > 0) {
					const startLine = ranges[0].startLineNumber;
					const anchorLine = startLine + 2;
					tabManager.updateTabAnchorLine(currentTabId, anchorLine);
				}
			}

			editor.dispose();
		};
	});

	$effect(() => {
		if (editor && onscrollsync) {
			const emitSync = () => {
				const position = editor.getPosition();
				if (position) {
					const top = editor.getTopForLineNumber(position.lineNumber);
					const scrollTop = editor.getScrollTop();
					const layout = editor.getLayoutInfo();
					const ratio = (top - scrollTop) / layout.height;
					onscrollsync?.(position.lineNumber, ratio);
				}
			};

			const d1 = editor.onDidChangeCursorPosition((e) => {
				emitSync();
			});
			const d2 = editor.onDidScrollChange((e) => {
				if (e.scrollTopChanged) {
					emitSync();
				}
			});
			return () => {
				d1.dispose();
				d2.dispose();
			};
		}
	});

	$effect(() => {
		if (editor && editor.getValue() !== value) {
			editor.setValue(value);
		}
	});

	$effect(() => {
		if (editor) {
			editor.updateOptions({
				minimap: { enabled: settings.minimap },
				wordWrap: settings.wordWrap as 'on' | 'off' | 'wordWrapColumn' | 'bounded',
				lineNumbers: settings.lineNumbers as 'on' | 'off' | 'relative' | 'interval',
				fontSize: 14 * (zoomLevel / 100),
			});
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
