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
	import { initVimMode } from 'monaco-vim';

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
		theme = 'system',
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
		theme?: 'system' | 'light' | 'dark';
	}>();

	let container: HTMLDivElement;
	let vimStatusNode = $state<HTMLDivElement>();
	let editor: monaco.editor.IStandaloneCodeEditor;

	let cursorPosition = $state<monaco.Position | null>(null);
	let selectionCount = $state(0);
	let cursorCount = $state(0);
	let wordCount = $state(0);
	let currentLanguage = $state('markdown');
	const currentTabId = tabManager.activeTabId;

	const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	const getEditorContext = () => {
		if (!editor) return null;
		const model = editor.getModel();
		const selection = editor.getSelection();
		if (!model || !selection) return null;
		return { model, selection };
	};

	const isEscaped = (line: string, index: number) => index > 0 && line[index - 1] === '\\';

	const findInlineFormatRange = (model: monaco.editor.ITextModel, position: monaco.Position, marker: string): monaco.Range | null => {
		const line = model.getLineContent(position.lineNumber);
		const markerLen = marker.length;
		const cursorIndex = position.column - 1;

		let start = -1;
		for (let i = Math.min(cursorIndex - markerLen, line.length - markerLen); i >= 0; i--) {
			if (line.slice(i, i + markerLen) === marker && !isEscaped(line, i)) {
				start = i;
				break;
			}
		}

		let end = -1;
		for (let i = Math.max(cursorIndex, 0); i <= line.length - markerLen; i++) {
			if (line.slice(i, i + markerLen) === marker && !isEscaped(line, i)) {
				end = i + markerLen;
				break;
			}
		}

		if (start !== -1 && end !== -1 && start < end) {
			return new monaco.Range(position.lineNumber, start + 1, position.lineNumber, end + 1);
		}
		return null;
	};

	const tryExpandToFormatBoundary = (
		model: monaco.editor.ITextModel,
		selection: monaco.Selection,
		marker: string,
	): monaco.Range | null => {
		if (selection.startLineNumber !== selection.endLineNumber) return null;

		const line = model.getLineContent(selection.startLineNumber);
		const markerLen = marker.length;
		const startIndex = selection.startColumn - 1;
		const endIndex = selection.endColumn - 1;

		let start = -1;
		for (let i = Math.min(startIndex - markerLen, line.length - markerLen); i >= 0; i--) {
			if (line.slice(i, i + markerLen) === marker && !isEscaped(line, i)) {
				start = i;
				break;
			}
		}

		let end = -1;
		for (let i = Math.max(endIndex, 0); i <= line.length - markerLen; i++) {
			if (line.slice(i, i + markerLen) === marker && !isEscaped(line, i)) {
				end = i + markerLen;
				break;
			}
		}

		if (start !== -1 && end !== -1 && start < end) {
			return new monaco.Range(selection.startLineNumber, start + 1, selection.startLineNumber, end + 1);
		}
		return null;
	};

	const findTagRange = (model: monaco.editor.ITextModel, position: monaco.Position, startTag: string, endTag: string): monaco.Range | null => {
		const line = model.getLineContent(position.lineNumber);
		const cursorIndex = position.column - 1;
		const startIndex = line.lastIndexOf(startTag, cursorIndex);
		const endIndex = line.indexOf(endTag, cursorIndex);
		if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
			return new monaco.Range(position.lineNumber, startIndex + 1, position.lineNumber, endIndex + endTag.length + 1);
		}
		return null;
	};

	const tryExpandToTagBoundary = (
		model: monaco.editor.ITextModel,
		selection: monaco.Selection,
		startTag: string,
		endTag: string,
	): monaco.Range | null => {
		if (selection.startLineNumber !== selection.endLineNumber) return null;
		const line = model.getLineContent(selection.startLineNumber);
		const startIndex = line.lastIndexOf(startTag, selection.startColumn - 1);
		const endIndex = line.indexOf(endTag, selection.endColumn - 1);
		if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
			return new monaco.Range(selection.startLineNumber, startIndex + 1, selection.startLineNumber, endIndex + endTag.length + 1);
		}
		return null;
	};

	const handleInlineFormat = (model: monaco.editor.ITextModel, selection: monaco.Selection, marker: string) => {
		const text = model.getValueInRange(selection);
		const markerLen = marker.length;

		if (!selection.isEmpty()) {
			if (selection.startLineNumber !== selection.endLineNumber) {
				const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
				for (let line = selection.startLineNumber; line <= selection.endLineNumber; line++) {
					const lineContent = model.getLineContent(line);
					const startColumn = line === selection.startLineNumber ? selection.startColumn : 1;
					const endColumn = line === selection.endLineNumber ? selection.endColumn : lineContent.length + 1;
					const range = new monaco.Range(line, startColumn, line, endColumn);
					const segment = model.getValueInRange(range);
					if (segment === '') continue;

					if (segment.startsWith(marker) && segment.endsWith(marker) && segment.length >= markerLen * 2) {
						const unwrapped = segment.slice(markerLen, -markerLen);
						edits.push({ range, text: unwrapped, forceMoveMarkers: true });
					} else {
						edits.push({ range, text: `${marker}${segment}${marker}`, forceMoveMarkers: true });
					}
				}

				if (edits.length > 0) editor.executeEdits('format-inline', edits);
				return;
			}

			if (text.startsWith(marker) && text.endsWith(marker) && text.length >= markerLen * 2) {
				const unwrapped = text.slice(markerLen, -markerLen);
				editor.executeEdits('format-inline', [{ range: selection, text: unwrapped, forceMoveMarkers: true }]);
				return;
			}

			const expandedRange = tryExpandToFormatBoundary(model, selection, marker);
			if (expandedRange) {
				const fullText = model.getValueInRange(expandedRange);
				if (fullText.startsWith(marker) && fullText.endsWith(marker)) {
					const inner = fullText.slice(markerLen, -markerLen);
					editor.executeEdits('format-inline', [{ range: expandedRange, text: inner, forceMoveMarkers: true }]);
					return;
				}
			}

			editor.executeEdits('format-inline', [
				{
					range: selection,
					text: `${marker}${text}${marker}`,
					forceMoveMarkers: true,
				},
			]);
			return;
		}

		const cursorPos = selection.getPosition();
		const formatRange = findInlineFormatRange(model, cursorPos, marker);
		if (formatRange) {
			const formattedText = model.getValueInRange(formatRange);
			const inner = formattedText.slice(markerLen, -markerLen);
			editor.executeEdits('format-inline', [{ range: formatRange, text: inner, forceMoveMarkers: true }]);
			return;
		}

		editor.executeEdits('format-inline', [
			{
				range: selection,
				text: `${marker}${marker}`,
				forceMoveMarkers: true,
			},
		]);

		const newPos = new monaco.Position(cursorPos.lineNumber, cursorPos.column + markerLen);
		editor.setPosition(newPos);
	};

	const handleTagFormat = (model: monaco.editor.ITextModel, selection: monaco.Selection, startTag: string, endTag: string) => {
		const text = model.getValueInRange(selection);

		if (!selection.isEmpty()) {
			if (text.startsWith(startTag) && text.endsWith(endTag)) {
				const unwrapped = text.slice(startTag.length, -endTag.length);
				editor.executeEdits('format-tag', [{ range: selection, text: unwrapped, forceMoveMarkers: true }]);
				return;
			}

			const expandedRange = tryExpandToTagBoundary(model, selection, startTag, endTag);
			if (expandedRange) {
				const fullText = model.getValueInRange(expandedRange);
				if (fullText.startsWith(startTag) && fullText.endsWith(endTag)) {
					const inner = fullText.slice(startTag.length, -endTag.length);
					editor.executeEdits('format-tag', [{ range: expandedRange, text: inner, forceMoveMarkers: true }]);
					return;
				}
			}

			editor.executeEdits('format-tag', [
				{
					range: selection,
					text: `${startTag}${text}${endTag}`,
					forceMoveMarkers: true,
				},
			]);
			return;
		}

		const cursorPos = selection.getPosition();
		const tagRange = findTagRange(model, cursorPos, startTag, endTag);
		if (tagRange) {
			const formattedText = model.getValueInRange(tagRange);
			const inner = formattedText.slice(startTag.length, -endTag.length);
			editor.executeEdits('format-tag', [{ range: tagRange, text: inner, forceMoveMarkers: true }]);
			return;
		}

		editor.executeEdits('format-tag', [
			{
				range: selection,
				text: `${startTag}${endTag}`,
				forceMoveMarkers: true,
			},
		]);

		const newPos = new monaco.Position(cursorPos.lineNumber, cursorPos.column + startTag.length);
		editor.setPosition(newPos);
	};

	const handleLineFormat = (model: monaco.editor.ITextModel, selection: monaco.Selection, prefix: string) => {
		const startLine = selection.startLineNumber;
		const endLine = selection.endLineNumber;

		let allHavePrefix = true;
		const prefixTrimmed = prefix.trim();

		for (let i = startLine; i <= endLine; i++) {
			const line = model.getLineContent(i);
			if (!line.trimStart().startsWith(prefixTrimmed)) {
				allHavePrefix = false;
				break;
			}
		}

		const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
		const prefixRegex = new RegExp(`^(\\s*)${escapeRegex(prefixTrimmed)}\\s?`);

		for (let i = startLine; i <= endLine; i++) {
			const line = model.getLineContent(i);
			const lineRange = new monaco.Range(i, 1, i, line.length + 1);

			if (allHavePrefix) {
				const prefixMatch = line.match(prefixRegex);
				if (prefixMatch) {
					const newLine = line.slice(prefixMatch[0].length);
					edits.push({ range: lineRange, text: newLine });
				}
			} else {
				const leadingWs = line.match(/^(\s*)/)?.[1] || '';
				const content = line.slice(leadingWs.length);
				const cleanContent = prefixTrimmed.startsWith('#') ? content.replace(/^#{1,6}\s*/, '') : content;
				edits.push({ range: lineRange, text: `${leadingWs}${prefix}${cleanContent}` });
			}
		}

		if (edits.length > 0) {
			editor.executeEdits('line-format', edits);
		}
	};

	const cycleHeading = (direction: 'up' | 'down' = 'down') => {
		const context = getEditorContext();
		if (!context) return;
		const { model, selection } = context;

		const line = model.getLineContent(selection.startLineNumber);
		const headingMatch = line.match(/^(#{1,6})\s/);
		const currentLevel = headingMatch ? headingMatch[1].length : 0;
		let newLevel = currentLevel;

		if (direction === 'down') {
			newLevel = currentLevel >= 6 ? 0 : currentLevel + 1;
		} else {
			newLevel = currentLevel <= 0 ? 6 : currentLevel - 1;
		}

		const lineRange = new monaco.Range(selection.startLineNumber, 1, selection.startLineNumber, line.length + 1);
		const cleanLine = line.replace(/^#{1,6}\s*/, '');
		const newLine = newLevel > 0 ? `${'#'.repeat(newLevel)} ${cleanLine}` : cleanLine;
		editor.executeEdits('heading-cycle', [{ range: lineRange, text: newLine }]);
		editor.focus();
	};

	const toggleUnorderedList = () => {
		const context = getEditorContext();
		if (!context) return;
		handleLineFormat(context.model, context.selection, '- ');
		editor.focus();
	};

	const toggleOrderedList = () => {
		const context = getEditorContext();
		if (!context) return;
		const { model, selection } = context;

		const startLine = selection.startLineNumber;
		const endLine = selection.endLineNumber;

		let isOrderedList = true;
		for (let i = startLine; i <= endLine; i++) {
			const line = model.getLineContent(i);
			if (!line.match(/^\s*\d+\.\s/)) {
				isOrderedList = false;
				break;
			}
		}

		const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
		for (let i = startLine; i <= endLine; i++) {
			const line = model.getLineContent(i);
			const lineRange = new monaco.Range(i, 1, i, line.length + 1);

			if (isOrderedList) {
				const newLine = line.replace(/^\s*\d+\.\s/, '');
				edits.push({ range: lineRange, text: newLine });
			} else {
				const leadingWs = line.match(/^(\s*)/)?.[1] || '';
				const content = line.slice(leadingWs.length).replace(/^[-*]\s/, '');
				const num = i - startLine + 1;
				edits.push({ range: lineRange, text: `${leadingWs}${num}. ${content}` });
			}
		}

		if (edits.length > 0) editor.executeEdits('list-toggle', edits);
		editor.focus();
	};

	const toggleTaskList = () => {
		const context = getEditorContext();
		if (!context) return;
		const { model, selection } = context;

		const startLine = selection.startLineNumber;
		const endLine = selection.endLineNumber;
		const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];

		for (let i = startLine; i <= endLine; i++) {
			const line = model.getLineContent(i);
			const lineRange = new monaco.Range(i, 1, i, line.length + 1);

			if (line.match(/^\s*-\s\[x\]\s/i)) {
				const newLine = line.replace(/^\s*-\s\[x\]\s/i, '');
				edits.push({ range: lineRange, text: newLine });
			} else if (line.match(/^\s*-\s\[\s?\]\s/)) {
				const newLine = line.replace(/^\s*-\s\[\s?\]\s/, (match) => match.replace(/\[\s?\]/, '[x]'));
				edits.push({ range: lineRange, text: newLine });
			} else {
				const leadingWs = line.match(/^(\s*)/)?.[1] || '';
				const content = line.slice(leadingWs.length).replace(/^[-*]\s/, '');
				edits.push({ range: lineRange, text: `${leadingWs}- [ ] ${content}` });
			}
		}

		if (edits.length > 0) editor.executeEdits('task-toggle', edits);
		editor.focus();
	};

	const insertLink = (url?: string, text?: string) => {
		const context = getEditorContext();
		if (!context) return;
		const { model, selection } = context;
		const selectedText = model.getValueInRange(selection);
		let linkText = text || selectedText || 'link text';
		let linkUrl = url || '';

		if (!url) {
			if (!selectedText && !text) {
				const promptText = window.prompt('Link text:', linkText);
				if (promptText === null) return;
				linkText = promptText || 'link text';
			}
			const promptUrl = window.prompt('Link URL:', 'https://');
			if (promptUrl === null) return;
			linkUrl = promptUrl || 'https://';
		}

		if (!linkUrl) linkUrl = 'https://';
		const markdown = `[${linkText}](${linkUrl})`;

		editor.executeEdits('insert-link', [{ range: selection, text: markdown, forceMoveMarkers: true }]);

		if (!url && selection.startLineNumber === selection.endLineNumber) {
			const startCol = selection.startColumn + linkText.length + 3;
			const endCol = startCol + linkUrl.length;
			editor.setSelection(new monaco.Selection(selection.startLineNumber, startCol, selection.startLineNumber, endCol));
		}
		editor.focus();
	};

	const insertImage = (url?: string, alt?: string) => {
		const context = getEditorContext();
		if (!context) return;
		const { model, selection } = context;
		const selectedText = model.getValueInRange(selection);
		let altText = alt || selectedText || 'image';
		let imgUrl = url || '';

		if (!url) {
			if (!selectedText && !alt) {
				const promptAlt = window.prompt('Image alt text:', altText);
				if (promptAlt === null) return;
				altText = promptAlt || 'image';
			}
			const promptUrl = window.prompt('Image URL:', 'https://');
			if (promptUrl === null) return;
			imgUrl = promptUrl || 'https://';
		}

		if (!imgUrl) imgUrl = 'https://';
		const markdown = `![${altText}](${imgUrl})`;

		editor.executeEdits('insert-image', [{ range: selection, text: markdown, forceMoveMarkers: true }]);

		if (!url && selection.startLineNumber === selection.endLineNumber) {
			const startCol = selection.startColumn + altText.length + 4;
			const endCol = startCol + imgUrl.length;
			editor.setSelection(new monaco.Selection(selection.startLineNumber, startCol, selection.startLineNumber, endCol));
		}
		editor.focus();
	};

	const getFullLineRange = (model: monaco.editor.ITextModel, lineNumber: number) => {
		if (lineNumber < model.getLineCount()) {
			return new monaco.Range(lineNumber, 1, lineNumber + 1, 1);
		}
		return new monaco.Range(lineNumber, 1, lineNumber, model.getLineMaxColumn(lineNumber));
	};

	const insertCodeBlock = (language: string = '') => {
		const context = getEditorContext();
		if (!context) return;
		const { model, selection } = context;
		const selectedText = model.getValueInRange(selection);

		const startLine = selection.startLineNumber;
		let codeBlockStart = -1;
		let codeBlockEnd = -1;

		for (let i = startLine; i >= 1; i--) {
			const line = model.getLineContent(i);
			if (line.startsWith('```')) {
				codeBlockStart = i;
				break;
			}
		}

		if (codeBlockStart !== -1) {
			for (let i = startLine; i <= model.getLineCount(); i++) {
				const line = model.getLineContent(i);
				if (line.startsWith('```') && i !== codeBlockStart) {
					codeBlockEnd = i;
					break;
				}
			}
		}

		const inCodeBlock = codeBlockStart !== -1 && codeBlockEnd !== -1 && codeBlockStart < startLine && codeBlockEnd > startLine;

		if (inCodeBlock) {
			const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [
				{ range: getFullLineRange(model, codeBlockEnd), text: '' },
				{ range: getFullLineRange(model, codeBlockStart), text: '' },
			];
			editor.executeEdits('code-block-remove', edits);
			editor.focus();
			return;
		}

		const codeBlock = selectedText
			? `\`\`\`${language}\n${selectedText}\n\`\`\``
			: `\`\`\`${language}\n\n\`\`\``;

		editor.executeEdits('code-block-insert', [{ range: selection, text: codeBlock, forceMoveMarkers: true }]);

		if (!selectedText) {
			const newPos = new monaco.Position(selection.startLineNumber + 1, 1);
			editor.setPosition(newPos);
		}
		editor.focus();
	};

	const insertHorizontalRule = () => {
		const context = getEditorContext();
		if (!context) return;
		const { model, selection } = context;
		const currentLine = model.getLineContent(selection.startLineNumber);
		const isEmptyLine = currentLine.trim() === '';
		const hr = isEmptyLine ? '---\n' : '\n---\n';

		const insertPos = isEmptyLine
			? new monaco.Range(selection.startLineNumber, 1, selection.startLineNumber, 1)
			: new monaco.Range(selection.startLineNumber, currentLine.length + 1, selection.startLineNumber, currentLine.length + 1);

		editor.executeEdits('insert-hr', [{ range: insertPos, text: hr, forceMoveMarkers: true }]);
		const targetLine = selection.startLineNumber + (isEmptyLine ? 1 : 2);
		editor.setPosition(new monaco.Position(targetLine, 1));
		editor.focus();
	};

	const insertTable = () => {
		const context = getEditorContext();
		if (!context) return;
		const { selection } = context;

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
		editor.focus();
	};

	const formatInline = (marker: string) => {
		const context = getEditorContext();
		if (!context) return;
		handleInlineFormat(context.model, context.selection, marker);
		editor.focus();
	};

	const formatTag = (startTag: string, endTag: string) => {
		const context = getEditorContext();
		if (!context) return;
		handleTagFormat(context.model, context.selection, startTag, endTag);
		editor.focus();
	};

	const formatLine = (prefix: string) => {
		const context = getEditorContext();
		if (!context) return;
		handleLineFormat(context.model, context.selection, prefix);
		editor.focus();
	};

	const getFormattingAPI = () => ({
		bold: () => formatInline('**'),
		italic: () => formatInline('*'),
		strikethrough: () => formatInline('~~'),
		inlineCode: () => formatInline('`'),
		underline: () => formatTag('<u>', '</u>'),
		heading1: () => formatLine('# '),
		heading2: () => formatLine('## '),
		heading3: () => formatLine('### '),
		heading4: () => formatLine('#### '),
		heading5: () => formatLine('##### '),
		heading6: () => formatLine('###### '),
		cycleHeading: () => cycleHeading('down'),
		blockquote: () => formatLine('> '),
		unorderedList: () => toggleUnorderedList(),
		orderedList: () => toggleOrderedList(),
		taskList: () => toggleTaskList(),
		insertLink: () => insertLink(),
		insertImage: () => insertImage(),
		insertCodeBlock: () => insertCodeBlock(),
		insertTable: () => insertTable(),
		insertHorizontalRule: () => insertHorizontalRule(),
		focus: () => editor?.focus(),
	});

	export function format(action: string, params?: any) {
		const api = getFormattingAPI() as Record<string, (args?: any) => void>;
		const fn = api[action];
		if (typeof fn === 'function') {
			params ? fn(params) : fn();
		}
	}

	export function focusEditor() {
		editor?.focus();
	}

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
			if (theme === 'system') {
				return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'app-theme-dark' : 'app-theme-light';
			}
			return theme === 'dark' ? 'app-theme-dark' : 'app-theme-light';
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
			renderLineHighlight: settings.renderLineHighlight ? 'line' : 'none',
			occurrencesHighlight: settings.occurrencesHighlight ? 'singleFile' : 'off',
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

		editor.addAction({
			id: 'toggle-vim-mode',
			label: 'Toggle Vim Mode',
			run: () => {
				settings.toggleVimMode();
			},
		});

		editor.addAction({
			id: 'toggle-status-bar',
			label: 'Toggle Status Bar',
			run: () => {
				settings.toggleStatusBar();
			},
		});

		editor.addAction({
			id: 'toggle-word-count',
			label: 'Toggle Word Count',
			run: () => {
				settings.toggleWordCount();
			},
		});

		editor.addAction({
			id: 'toggle-line-highlight',
			label: 'Toggle Line Highlight',
			run: () => {
				settings.toggleLineHighlight();
			},
		});

		editor.addAction({
			id: 'toggle-occurrences-highlight',
			label: 'Toggle Occurrences Highlight',
			run: () => {
				settings.toggleOccurrencesHighlight();
			},
		});

		editor.addAction({
			id: 'toggle-tabs',
			label: 'Toggle Tabs',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyB],
			run: () => {
				settings.toggleTabs();
			},
		});

		editor.addAction({
			id: 'toggle-zen-mode',
			label: 'Toggle Zen Mode',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ],
			run: () => {
				settings.toggleZenMode();
			},
		});

		const updateTheme = () => {
			monaco.editor.setTheme(getTheme());
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

			// Update word count
			const model = editor.getModel();
			if (model) {
				const text = model.getValue();
				wordCount = (text.match(/\S+/g) || []).filter((w) => /\w/.test(w)).length;
			}
		});

		editor.onDidChangeCursorPosition((e) => {
			cursorPosition = e.position;
		});

		editor.onDidChangeCursorSelection((e) => {
			const selections = editor.getSelections() || [];
			cursorCount = selections.length;
			const model = editor.getModel();

			if (model && selections.length > 0) {
				selectionCount = selections.reduce((acc: number, selection: monaco.Selection) => {
					return acc + model.getValueInRange(selection).length;
				}, 0);
			} else {
				selectionCount = 0;
			}
		});

		// Initialize values
		if (editor.getModel()) {
			currentLanguage = editor.getModel()?.getLanguageId() || 'markdown';
			const text = editor.getModel()?.getValue() || '';
			wordCount = (text.match(/\S+/g) || []).filter((w) => /\w/.test(w)).length;
		}

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			if (onsave) onsave();
		});

		editor.addAction({
			id: 'fmt-bold',
			label: 'Format: Bold',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
			run: () => formatInline('**'),
		});

		editor.addAction({
			id: 'fmt-italic',
			label: 'Format: Italic',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
			run: () => formatInline('*'),
		});

		editor.addAction({
			id: 'fmt-underline',
			label: 'Format: Underline',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyU],
			run: () => formatTag('<u>', '</u>'),
		});

		editor.addAction({
			id: 'fmt-strikethrough',
			label: 'Format: Strikethrough',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS],
			run: () => formatInline('~~'),
		});

		editor.addAction({
			id: 'fmt-inline-code',
			label: 'Format: Inline Code',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backquote],
			run: () => formatInline('`'),
		});

		editor.addAction({
			id: 'fmt-heading-1',
			label: 'Format: Heading 1',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit1],
			run: () => formatLine('# '),
		});

		editor.addAction({
			id: 'fmt-heading-2',
			label: 'Format: Heading 2',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit2],
			run: () => formatLine('## '),
		});

		editor.addAction({
			id: 'fmt-heading-3',
			label: 'Format: Heading 3',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit3],
			run: () => formatLine('### '),
		});

		editor.addAction({
			id: 'fmt-blockquote',
			label: 'Format: Blockquote',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Period],
			run: () => formatLine('> '),
		});

		editor.addAction({
			id: 'fmt-unordered-list',
			label: 'Format: Bullet List',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Digit8],
			run: () => toggleUnorderedList(),
		});

		editor.addAction({
			id: 'fmt-ordered-list',
			label: 'Format: Numbered List',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Digit7],
			run: () => toggleOrderedList(),
		});

		editor.addAction({
			id: 'fmt-task-list',
			label: 'Format: Task List',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Digit9],
			run: () => toggleTaskList(),
		});

		editor.addAction({
			id: 'fmt-code-block',
			label: 'Format: Code Block',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK],
			run: () => insertCodeBlock(),
		});

		editor.addAction({
			id: 'insert-link',
			label: 'Insert Link',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
			run: () => insertLink(),
		});

		editor.addAction({
			id: 'insert-image',
			label: 'Insert Image',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI],
			run: () => insertImage(),
		});

		editor.addAction({
			id: 'insert-hr',
			label: 'Insert Horizontal Rule',
			run: () => insertHorizontalRule(),
		});

		editor.addAction({
			id: 'insert-table-simple',
			label: 'Insert Table',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyT],
			run: () => {
				insertTable();
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
			// Clean up listeners
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
				renderLineHighlight: settings.renderLineHighlight as 'line' | 'none',
				occurrencesHighlight: settings.occurrencesHighlight ? 'singleFile' : 'off',
				fontSize: 14 * (zoomLevel / 100),
			});
		}
	});

	$effect(() => {
		if (editor && theme) {
			const targetTheme =
				theme === 'system'
					? window.matchMedia('(prefers-color-scheme: dark)').matches
						? 'app-theme-dark'
						: 'app-theme-light'
					: theme === 'dark'
						? 'app-theme-dark'
						: 'app-theme-light';
			monaco.editor.setTheme(targetTheme);
		}
	});

	$effect(() => {
		if (editor && settings.vimMode && vimStatusNode) {
			const vim = initVimMode(editor, vimStatusNode);
			return () => {
				vim.dispose();
			};
		}
	});
</script>

<div class="editor-container" bind:this={container}></div>

{#if settings.vimMode}
	<div class="vim-status-bar" bind:this={vimStatusNode}></div>
{/if}

{#if settings.statusBar}
	<div class="status-bar">
		<div class="status-item">
			Ln {cursorPosition?.lineNumber ?? 1}, Col {cursorPosition?.column ?? 1}
		</div>
		{#if selectionCount > 0}
			<div class="status-item">
				{selectionCount} selected
			</div>
		{:else if cursorCount > 1}
			<div class="status-item">
				{cursorCount} selections
			</div>
		{/if}
		{#if settings.wordCount}
			<div class="status-item">
				{wordCount} words
			</div>
		{/if}
		<div class="status-item">
			{zoomLevel}%
		</div>
		<div class="status-item">
			{currentLanguage}
		</div>
		<div class="status-item">CRLF</div>
		<div class="status-item">UTF-8</div>
	</div>
{/if}

<style>
	.editor-container {
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	.vim-status-bar {
		padding: 0 10px;
		font-family: monospace;
		font-size: 12px;
		background: var(--bg-tertiary);
		border-top: 1px solid var(--color-border-muted);
		color: var(--text-primary);
		display: flex;
		align-items: center;
		min-height: 20px;
	}

	.status-bar {
		padding: 0 10px;
		font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
		font-size: 12px;
		background: var(--bg-tertiary);
		border-top: 1px solid var(--color-border-muted);
		color: var(--text-primary);
		display: flex;
		align-items: center;
		justify-content: flex-end;
		min-height: 22px;
		gap: 20px;
		user-select: none;
	}

	.status-item {
		opacity: 0.8;
	}
</style>
