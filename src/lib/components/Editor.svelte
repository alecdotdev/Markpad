<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { tabManager } from "../stores/tabs.svelte.js";
	import { settings } from "../stores/settings.svelte.js";
	import { t } from '../utils/i18n.js';

	import * as monaco from "monaco-editor";
	import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
	import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
	import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
	import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
	import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
	import { initVimMode } from "monaco-vim";
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { invoke } from "@tauri-apps/api/core";

	let {
		value = $bindable(),
		language = "markdown",
		onsave,
		onnew,
		onopen,
		onclose,
		onreveal,
		ontoggleEdit,
		ontoggleLive,
		ontoggleSplit,
		onhome,
		onnextTab,
		onprevTab,
		onundoClose,
		onscrollsync,
		zoomLevel = $bindable(100),
		theme = "system",
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
		ontoggleSplit?: () => void;
		onhome?: () => void;
		onnextTab?: () => void;
		onprevTab?: () => void;
		onundoClose?: () => void;
		onscrollsync?: (line: number, ratio?: number) => void;
		zoomLevel?: number;
		isSplit?: boolean;
		theme?: string;
	}>();

	let container: HTMLDivElement;
	let vimStatusNode = $state<HTMLDivElement>();
	let editor: monaco.editor.IStandaloneCodeEditor;
	let isApplyingExternalScroll = false;
	const managedImages: {
		embed: string;
		filename: string;
		parentDir: string;
	}[] = $state([]);

	let cursorPosition = $state<monaco.Position | null>(null);
	let selectionCount = $state(0);
	let cursorCount = $state(0);
	let wordCount = $state(0);
	let currentLanguage = $state("markdown");
	let currentTabId = $state(tabManager.activeTabId);
	let uiLanguage = $state(settings.language);

	$effect(() => {
		uiLanguage = settings.language;
	});

	self.MonacoEnvironment = {
		getWorker: function (_moduleId: any, label: string) {
			if (label === "json") {
				return new jsonWorker();
			}
			if (label === "css" || label === "scss" || label === "less") {
				return new cssWorker();
			}
			if (label === "html" || label === "handlebars" || label === "razor") {
				return new htmlWorker();
			}
			if (label === "typescript" || label === "javascript") {
				return new tsWorker();
			}
			return new editorWorker();
		},
	};

	onMount(() => {
		const originalOpen = window.open;
		window.open = function (
			url?: string | URL,
			target?: string,
			features?: string,
		) {
			if (
				typeof url === "string" &&
				(url.startsWith("http://") || url.startsWith("https://"))
			) {
				openUrl(url);
				return null;
			}
			return originalOpen.apply(this, arguments as any);
		};

		const defineThemes = () => {
			monaco.editor.defineTheme("app-theme-dark", {
				base: "vs-dark",
				inherit: true,
				rules: [],
				colors: {
					"editor.background": "#181818",
					"menu.background": "#181818",
					"menu.foreground": "#cccccc",
					"menu.selectionBackground": "#2a2d2e",
					"menu.selectionForeground": "#ffffff",
					"menu.separatorBackground": "#454545",
					"editorWidget.background": "#181818",
					"editorWidget.border": "#454545",
				},
			});

			monaco.editor.defineTheme("app-theme-light", {
				base: "vs",
				inherit: true,
				rules: [],
				colors: {
					"editor.background": "#FDFDFD",
					"menu.background": "#FDFDFD",
					"menu.foreground": "#333333",
					"menu.selectionBackground": "#eeeeee",
					"menu.selectionForeground": "#000000",
					"menu.separatorBackground": "#cccccc",
					"editorWidget.background": "#FDFDFD",
					"editorWidget.border": "#cccccc",
				},
			});
		};

		defineThemes();

		const getTheme = () => {
			if (theme && theme.startsWith("vscode:")) return "vscode-custom";
			if (theme === "system") {
				return window.matchMedia("(prefers-color-scheme: dark)").matches
					? "app-theme-dark"
					: "app-theme-light";
			}
			return theme === "dark" ? "app-theme-dark" : "app-theme-light";
		};

		editor = monaco.editor.create(container, {
			value: value,
			language: language,
			theme: getTheme(),
			dragAndDrop: true,
			automaticLayout: true,
			minimap: { enabled: settings.minimap },
			scrollBeyondLastLine: true,
			wordWrap: settings.wordWrap as
				| "on"
				| "off"
				| "wordWrapColumn"
				| "bounded",
			wordWrapColumn: settings.editorMaxWidth,
			lineNumbers: settings.lineNumbers as
				| "on"
				| "off"
				| "relative"
				| "interval",
			renderLineHighlight: settings.renderLineHighlight ? "line" : "none",
			occurrencesHighlight: settings.occurrencesHighlight
				? "singleFile"
				: "off",
			fontSize: settings.editorFontSize,
			fontFamily: settings.editorFont,
			wordBasedSuggestions: "off",
			quickSuggestions: false,
			renderWhitespace: settings.showWhitespace ? "trailing" : "none",
			padding: { top: 20 },
			scrollbar: {
				vertical: "visible",
				horizontal: "visible",
				useShadows: false,
				verticalHasArrows: false,
				horizontalHasArrows: false,
				verticalScrollbarSize: 10,
				horizontalScrollbarSize: 10,
			},
		});

		if (tabManager.activeTab?.editorViewState) {
			editor.restoreViewState(tabManager.activeTab.editorViewState);
		}

		let scrolled = false;
		if (tabManager.activeTab) {
			if (tabManager.activeTab.anchorLine > 0) {
				editor.revealLineNearTop(
					Math.max(1, tabManager.activeTab.anchorLine - 2),
					monaco.editor.ScrollType.Smooth,
				);
				scrolled = true;
			}

			if (!scrolled) {
				const scrollHeight = editor.getScrollHeight();
				const clientHeight = editor.getLayoutInfo().height;
				if (scrollHeight > clientHeight) {
					const targetScroll =
						tabManager.activeTab.scrollPercentage *
						(scrollHeight - clientHeight);
					editor.setScrollTop(targetScroll);
				}
			}
		}

		editor.addAction({
			id: "toggle-minimap",
			label: t('settings.minimap', uiLanguage),
			run: () => {
				settings.toggleMinimap();
			},
		});

		editor.addAction({
			id: "toggle-word-wrap",
			label: t('settings.wordWrap', uiLanguage),
			run: () => {
				settings.toggleWordWrap();
			},
		});

		editor.addAction({
			id: "toggle-line-numbers",
			label: t('settings.lineNumbers', uiLanguage),
			run: () => {
				settings.toggleLineNumbers();
			},
		});

		editor.addAction({
			id: "toggle-vim-mode",
			label: t('settings.vimMode', uiLanguage),
			run: () => {
				settings.toggleVimMode();
			},
		});

		editor.addAction({
			id: "toggle-status-bar",
			label: t('settings.statusBar', uiLanguage),
			run: () => {
				settings.toggleStatusBar();
			},
		});

		editor.addAction({
			id: "toggle-word-count",
			label: t('settings.wordCount', uiLanguage),
			run: () => {
				settings.toggleWordCount();
			},
		});

		editor.addAction({
			id: "toggle-line-highlight",
			label: t('settings.lineHighlight', uiLanguage),
			run: () => {
				settings.toggleLineHighlight();
			},
		});

		editor.addAction({
			id: "toggle-occurrences-highlight",
			label: t('settings.showWhitespace', uiLanguage),
			run: () => {
				settings.toggleOccurrencesHighlight();
			},
		});

		editor.addAction({
			id: "toggle-whitespace",
			label: t('settings.showWhitespace', uiLanguage),
			run: () => {
				settings.toggleShowWhitespace();
			},
		});

		editor.addAction({
			id: "toggle-tabs",
			label: t('settings.showTabs', uiLanguage),
			keybindings: [
				monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyB,
			],
			run: () => {
				settings.toggleTabs();
			},
		});

		editor.addAction({
			id: "toggle-zen-mode",
			label: t('settings.zenMode', uiLanguage),
			keybindings: [
				monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
			],
			run: () => {
				settings.toggleZenMode();
			},
		});

		$effect(() => {
			if (editor) {
				editor.updateOptions({
					minimap: { enabled: settings.minimap },
					wordWrap: settings.wordWrap as any,
					wordWrapColumn: settings.editorMaxWidth,
					lineNumbers: settings.lineNumbers as any,
					renderLineHighlight: settings.renderLineHighlight as any,
					occurrencesHighlight: settings.occurrencesHighlight ? "singleFile" : "off",
					fontSize: settings.editorFontSize,
					fontFamily: settings.editorFont,
					renderWhitespace: settings.showWhitespace ? "trailing" : "none",
				});
			}
		});

		const updateTheme = () => {
			monaco.editor.setTheme(getTheme());
		};

		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		mediaQuery.addEventListener("change", updateTheme);

		editor.focus();

		editor.onDidChangeModelContent(() => {
			const newValue = editor.getValue();
			if (value !== newValue) {
				value = newValue;
				if (tabManager.activeTabId) {
					tabManager.updateTabRawContent(tabManager.activeTabId, newValue);
				}
			}

			const model = editor.getModel();
			if (model) {
				const text = model.getValue();
				wordCount = (text.match(/\S+/g) || []).filter((w) =>
					/\w/.test(w),
				).length;
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
				selectionCount = selections.reduce(
					(acc: number, selection: monaco.Selection) => {
						return acc + model.getValueInRange(selection).length;
					},
					0,
				);
			} else {
				selectionCount = 0;
			}
		});

		if (editor.getModel()) {
			currentLanguage = editor.getModel()?.getLanguageId() || "markdown";
			const text = editor.getModel()?.getValue() || "";
			wordCount = (text.match(/\S+/g) || []).filter((w) => /\w/.test(w)).length;
		}

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
			if (onsave) onsave();
		});

		const insertTextAtCursor = (text: string) => {
			const selection = editor.getSelection();
			if (!selection) return;
			const op = { range: selection, text: text, forceMoveMarkers: true };
			editor.executeEdits("my-source", [op]);
		};

		const toggleFormat = (
			marker: string,
			type: "wrap" | "block" | "tag" = "wrap",
		) => {
			const selection = editor.getSelection();
			if (!selection) return;

			const model = editor.getModel();
			if (!model) return;

			const text = model.getValueInRange(selection);

			if (type === "wrap") {
				if (text.startsWith(marker) && text.endsWith(marker)) {
					const newText = text.slice(marker.length, -marker.length);
					editor.executeEdits("toggle-format", [
						{ range: selection, text: newText },
					]);
				} else {
					editor.executeEdits("toggle-format", [
						{ range: selection, text: `${marker}${text}${marker}` },
					]);
				}
			} else if (type === "tag") {
				const [startTag, endTag] = marker.split("|");
				if (text.startsWith(startTag) && text.endsWith(endTag)) {
					const newText = text.slice(startTag.length, -endTag.length);
					editor.executeEdits("toggle-format", [
						{ range: selection, text: newText },
					]);
				} else {
					editor.executeEdits("toggle-format", [
						{ range: selection, text: `${startTag}${text}${endTag}` },
					]);
				}
			}
		};

		editor.addAction({
			id: "fmt-bold",
			label: t('menu.bold', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
			run: () => toggleFormat("**"),
		});

		editor.addAction({
			id: "fmt-italic",
			label: t('menu.italic', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
			run: () => toggleFormat("*"),
		});

		editor.addAction({
			id: "fmt-underline",
			label: t('menu.underline', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyU],
			run: () => toggleFormat("<u>|</u>", "tag"),
		});

		editor.addAction({
			id: "insert-table-simple",
			label: t('menu.insertTable', uiLanguage),
			keybindings: [
				monaco.KeyMod.chord(
					monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
					monaco.KeyCode.KeyT,
				),
			],
			run: () => {
				const selection = editor.getSelection();
				if (!selection) return;

				const cols = 3;
				const rows = 2;
				let table = "\n";
				table += "| " + Array(cols).fill("Header").join(" | ") + " |\n";
				table += "| " + Array(cols).fill("---").join(" | ") + " |\n";
				for (let i = 0; i < rows; i++) {
					table += "| " + Array(cols).fill("Cell").join(" | ") + " |\n";
				}
				table += "\n";

				editor.executeEdits("insert-table", [
					{
						range: selection,
						text: table,
						forceMoveMarkers: true,
					},
				]);
			},
		});

		editor.addAction({
			id: "file-new",
			label: t('menu.newFile', uiLanguage),
			keybindings: [
				monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN,
				monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT,
			],
			run: () => onnew?.(),
		});

		editor.addAction({
			id: "file-open",
			label: t('menu.openFile', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO],
			run: () => onopen?.(),
		});

		editor.addAction({
			id: "file-save",
			label: t('menu.save', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
			run: () => onsave?.(),
		});

		editor.addAction({
			id: "file-close",
			label: t('menu.closeFile', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW],
			run: () => onclose?.(),
		});

		editor.addAction({
			id: "file-reveal",
			label: t('menu.openLocation', uiLanguage),
			keybindings: [
				monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR,
			],
			run: () => onreveal?.(),
		});

		editor.addAction({
			id: "view-toggle-edit",
			label: t('menu.toggleEditMode', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
			run: () => ontoggleEdit?.(),
		});

		editor.addAction({
			id: "view-toggle-live",
			label: t('menu.toggleLiveMode', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
			run: () => ontoggleLive?.(),
		});

		editor.addAction({
			id: "view-toggle-split",
			label: t('menu.toggleSplitView', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
			run: () => ontoggleSplit?.(),
		});

		editor.addAction({
			id: "tab-next",
			label: t('menu.nextTab', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Tab],
			run: () => onnextTab?.(),
		});

		editor.addAction({
			id: "tab-prev",
			label: t('menu.previousTab', uiLanguage),
			keybindings: [
				monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Tab,
			],
			run: () => onprevTab?.(),
		});

		editor.addAction({
			id: "tab-undo-close",
			label: t('menu.undoCloseTab', uiLanguage),
			keybindings: [
				monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyT,
			],
			run: () => onundoClose?.(),
		});

		editor.addAction({
			id: "app-command-palette",
			label: t('menu.commandPalette', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP],
			run: (ed) => {
				ed.trigger("keyboard", "editor.action.quickCommand", {});
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

		container.addEventListener("wheel", wheelListener, { capture: true });

		const contentChangeListener = editor.onDidChangeModelContent((e) => {
			if (e.isUndoing && managedImages.length > 0) {
				const currentContent = editor.getValue();
				const last = managedImages[managedImages.length - 1];
				if (!currentContent.includes(last.embed)) {
					managedImages.pop();
					const imgPath = `${last.parentDir}\\img\\${last.filename}`;
					invoke("delete_file", { path: imgPath })
						.then(() => {
							invoke("cleanup_empty_img_dir", { parentDir: last.parentDir });
						})
						.catch(console.error);
				}
			}
		});

		const completionProvider = monaco.languages.registerCompletionItemProvider(
			"markdown",
			{
				triggerCharacters: ["(", "/", "\\", '"'],
				provideCompletionItems: async (model, position) => {
					const lineContent = model.getLineContent(position.lineNumber);
					const prefix = lineContent.substring(0, position.column - 1);

					const isEmbedContext = /(!?\[.*\]\(|<img.*src=["']|src=["'])$/.test(
						prefix,
					);
					if (!isEmbedContext) return { suggestions: [] };

					const tab = tabManager.activeTab;
					if (!tab?.path) return { suggestions: [] };

					const lastSlash = Math.max(
						tab.path.lastIndexOf("\\"),
						tab.path.lastIndexOf("/"),
					);
					const parentDir = tab.path.substring(0, lastSlash);

					try {
						const [currentEntries, imgEntries] = await Promise.all([
							invoke("list_directory_contents", { path: parentDir })
								.then((r) => r as string[])
								.catch(() => []),
							invoke("list_directory_contents", { path: parentDir + "/img" })
								.then((r) => r as string[])
								.catch(() => []),
						]);

						const word = model.getWordUntilPosition(position);
						const range = new monaco.Range(
							position.lineNumber,
							word.startColumn,
							position.lineNumber,
							word.endColumn,
						);

						const suggestions: monaco.languages.CompletionItem[] = [
							...currentEntries.map((e) => ({
								label: e,
								kind: e.endsWith("/")
									? monaco.languages.CompletionItemKind.Folder
									: monaco.languages.CompletionItemKind.File,
								insertText: e,
								range,
							})),
							...imgEntries.map((e) => ({
								label: `img/${e}`,
								kind: e.endsWith("/")
									? monaco.languages.CompletionItemKind.Folder
									: monaco.languages.CompletionItemKind.File,
								insertText: `img/${e}`,
								range,
							})),
						];

						return { suggestions };
					} catch (err) {
						return { suggestions: [] };
					}
				},
			},
		);

		// clipboard handling: override Ctrl+C and Ctrl+V to use Rust backend
		editor.addAction({
			id: "custom-copy",
			label: t('menu.copy', uiLanguage),
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC],
			run: async (ed) => {
				const selection = ed.getSelection();
				if (!selection || selection.isEmpty()) return;
				const model = ed.getModel();
				if (!model) return;
				const text = model.getValueInRange(selection);
				if (text) {
					await invoke("clipboard_write_text", { text }).catch(console.error);
				}
			},
		});

		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, async () => {
			try {
				// check for image in clipboard via Rust
				const base64Image = await invoke("clipboard_read_image").catch(() => null) as string | null;
				if (base64Image && tabManager.activeTab?.path) {
					const ext = "png"; // output of Rust command is always PNG
					const filename = `paste_${Date.now()}.${ext}`;

					const tabPath = tabManager.activeTab.path;
					const dirMatch = tabPath.match(/^(.*)[/\\][^/\\]+$/);
					if (dirMatch) {
						const parentDir = dirMatch[1];
						const relPath = (await invoke("save_image", {
							parentDir,
							filename,
							base64Data: base64Image,
						})) as string;
						const escapedPath = relPath.replace(/ /g, "%20");
						const embed = `![alt](${escapedPath})`;

						const position = editor.getPosition();
						if (position) {
							const selection = editor.getSelection();
							const range =
								selection && !selection.isEmpty()
									? selection
									: new monaco.Range(
											position.lineNumber,
											position.column,
											position.lineNumber,
											position.column,
										);

							editor.executeEdits("paste-image", [
								{
									range,
									text: embed,
									forceMoveMarkers: true,
								},
							]);

							managedImages.push({ embed, filename, parentDir });
							return;
						}
					}
				}

				// fall through to text paste via Rust
				const rawText = await invoke("clipboard_read_text").catch(() => "") as string;
				if (!rawText) return;
				
				const text = rawText.trim();
				const urlRegex = /^(?:(?:https?|file|tauri):\/\/|www\.)[^\s]{2,}$/i;
				const isUrl = urlRegex.test(text);

				const selections = editor.getSelections();
				const model = editor.getModel();
				if (!selections || selections.length === 0 || !model) {
					insertTextAtCursor(rawText);
					return;
				}

				// if it's not a URL or we have no multi-line selection/complex case, just insert
				const hasSelection = selections.some((s) => !s.isEmpty());
				const isMultiLine = selections.some((s) => s.startLineNumber !== s.endLineNumber);

				if (!isUrl || isMultiLine) {
					const edits = selections.map(s => ({
						range: s,
						text: rawText,
						forceMoveMarkers: true
					}));
					editor.executeEdits("paste-text", edits);
					return;
				}

				if (hasSelection) {
					const edits = selections.map((selection) => {
						const selectedText = model.getValueInRange(selection);
						const linkUrl = text.toLowerCase().startsWith("www.")
							? `http://${text}`
							: text;
						return {
							range: selection,
							text: `[${selectedText}](${linkUrl})`,
							forceMoveMarkers: true,
						};
					});
					editor.executeEdits("paste-link", edits);
				} else {
					const displayText = text.replace(
						/^(?:https?|file|tauri):\/\/|www\./i,
						"",
					);
					const linkUrl = text.toLowerCase().startsWith("www.")
						? `http://${text}`
						: text;
					const template = `[${displayText}](${linkUrl})`;
					const edits = selections.map((selection) => {
						return {
							range: selection,
							text: template,
							forceMoveMarkers: true,
						};
					});

					editor.executeEdits("paste-link", edits);

					let accumulatedShift = 0;
					let lastLine = -1;
					const newSelections = selections.map((s) => {
						if (s.startLineNumber !== lastLine) {
							accumulatedShift = 0;
							lastLine = s.startLineNumber;
						}
						const startColumn = s.startColumn + accumulatedShift + 1;
						const endColumn = startColumn + displayText.length;
						accumulatedShift += template.length;
						return new monaco.Selection(
							s.startLineNumber,
							startColumn,
							s.startLineNumber,
							endColumn,
						);
					});
					editor.setSelections(newSelections);
				}
			} catch (err) {
				console.error("Paste failed:", err);
			}
		});

		return () => {
			window.open = originalOpen;
			mediaQuery.removeEventListener("change", updateTheme);
			container.removeEventListener("wheel", wheelListener, { capture: true });
			contentChangeListener.dispose();
			completionProvider.dispose();

			if (editor && currentTabId) {
				const state = editor.saveViewState();
				tabManager.updateTabEditorState(currentTabId, state);

				const scrollHeight = editor.getScrollHeight();
				const clientHeight = editor.getLayoutInfo().height;
				if (scrollHeight > clientHeight) {
					const percentage =
						editor.getScrollTop() / (scrollHeight - clientHeight);
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

	export function syncScrollToLine(line: number, ratio: number = 0) {
		if (!editor) return;

		const model = editor.getModel();
		if (!model) return;

		const safeLine = Math.max(1, Math.min(model.getLineCount(), line));
		const layout = editor.getLayoutInfo();
		const targetScroll = Math.max(
			0,
			editor.getTopForLineNumber(safeLine) - layout.height * ratio,
		);

		if (Math.abs(editor.getScrollTop() - targetScroll) <= 5) return;

		isApplyingExternalScroll = true;
		editor.setScrollTop(targetScroll, monaco.editor.ScrollType.Smooth);

		requestAnimationFrame(() => {
			isApplyingExternalScroll = false;
		});
	}

	$effect(() => {
		if (editor && onscrollsync) {
			const emitSync = () => {
				if (isApplyingExternalScroll) return;

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
		const activeTabId = tabManager.activeTabId;
		const content = value;

		if (!editor) return;

		if (activeTabId !== currentTabId) {
			if (currentTabId) {
				const state = editor.saveViewState();
				tabManager.updateTabEditorState(currentTabId, state);
			}

			currentTabId = activeTabId;
			
			if (editor.getValue() !== content) {
				editor.setValue(content);
			}

			if (tabManager.activeTab?.editorViewState) {
				editor.restoreViewState(tabManager.activeTab.editorViewState);
			} else {
				editor.setScrollTop(0);
				editor.setPosition({ lineNumber: 1, column: 1 });
			}
		} else {
			if (editor.getValue() !== content) {
				editor.setValue(content);
			}
		}
	});

	$effect(() => {
		if (editor) {
			editor.updateOptions({
				minimap: { enabled: settings.minimap },
				wordWrap: settings.wordWrap as
					| "on"
					| "off"
					| "wordWrapColumn"
					| "bounded",
				lineNumbers: settings.lineNumbers as
					| "on"
					| "off"
					| "relative"
					| "interval",
				renderLineHighlight: settings.renderLineHighlight as "line" | "none",
				occurrencesHighlight: settings.occurrencesHighlight
					? "singleFile"
					: "off",
				fontSize: settings.editorFontSize * (zoomLevel / 100),
				fontFamily: settings.editorFont,
				renderWhitespace: settings.showWhitespace ? "trailing" : "none",
			});
		}
	});


	$effect(() => {
		if (editor && theme) {
			if (theme.startsWith("vscode:")) return;
			const targetTheme =
				theme === "system"
					? window.matchMedia("(prefers-color-scheme: dark)").matches
						? "app-theme-dark"
						: "app-theme-light"
					: theme === "dark"
						? "app-theme-dark"
						: "app-theme-light";
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
	export async function handleDroppedFile(path: string, x: number, y: number) {
		if (!editor || !tabManager.activeTab?.path) return;

		const target = (editor as any).getTargetAtClientPoint(x, y);
		const position = target?.position || editor.getPosition();
		if (!position) return;

		const tabPath = tabManager.activeTab.path;
		const match = tabPath.match(/^(.*)[/\\][^/\\]+$/);
		if (!match) return;
		const parentDir = match[1];

		try {
			const relPath = (await invoke("copy_file_to_img", {
				srcPath: path,
				parentDir,
			})) as string;
			const escapedPath = relPath.replace(/ /g, "%20");
			const embed = `![alt](${escapedPath})`;

			editor.executeEdits(
				"drop-image",
				[
					{
						range: new monaco.Range(
							position.lineNumber,
							position.column,
							position.lineNumber,
							position.column,
						),
						text: embed,
						forceMoveMarkers: true,
					},
				],
				[
					new monaco.Selection(
						position.lineNumber,
						position.column + embed.length,
						position.lineNumber,
						position.column + embed.length,
					),
				],
			);

			const actualFilename = path.split(/[/\\]/).pop() || "image";
			managedImages.push({ embed, filename: actualFilename, parentDir });
		} catch (err) {
			console.error("Failed to copy dropped file:", err);
		}
	}

	let dragCaretDecoration: string[] = [];
	export function updateDragCaret(x: number, y: number) {
		if (!editor) return;
		const target = (editor as any).getTargetAtClientPoint(x, y);
		const position = target?.position;
		if (!position) {
			hideDragCaret();
			return;
		}
		dragCaretDecoration = editor.deltaDecorations(dragCaretDecoration, [
			{
				range: new monaco.Range(
					position.lineNumber,
					position.column,
					position.lineNumber,
					position.column,
				),
				options: {
					className: "ghost-caret",
					isWholeLine: false,
				},
			},
		]);
	}
	export function hideDragCaret() {
		if (!editor) return;
		dragCaretDecoration = editor.deltaDecorations(dragCaretDecoration, []);
	}

	export function revealHeader(text: string) {
		if (!editor) return;
		const model = editor.getModel();
		if (!model) return;

		const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(`^#+\\s+.*${escapedText}.*$`, "m");
		
		const match = model.findNextMatch(regex.source, { lineNumber: 1, column: 1 }, true, false, null, true);
		
		if (match) {
			editor.revealLineInCenterIfOutsideViewport(match.range.startLineNumber, monaco.editor.ScrollType.Smooth);
			editor.setSelection(match.range);
			editor.focus();
		} else {
			const fallbackMatch = model.findNextMatch(escapedText, { lineNumber: 1, column: 1 }, false, false, null, false);
			if (fallbackMatch) {
				editor.revealLineInCenterIfOutsideViewport(fallbackMatch.range.startLineNumber, monaco.editor.ScrollType.Smooth);
				editor.setSelection(fallbackMatch.range);
				editor.focus();
			}
		}
	}

	export const undo = () => {
		editor?.focus();
		editor?.trigger("keyboard", "undo", null);
	}

	export const redo = () => {
		editor?.focus();
		editor?.trigger("keyboard", "redo", null);
	}

	export const getValue = () => editor?.getValue() || "";
	export const setValue = (val: string) => editor?.setValue(val);
	export const focus = () => editor?.focus();
	export const getViewState = () => editor?.saveViewState();
	export const restoreViewState = (state: any) => editor?.restoreViewState(state);
	export const revealLine = (line: number) => editor?.revealLineInCenter(line);
</script>

<div class="editor-outer">
	<div
		class="editor-container"
		bind:this={container}
	></div>
</div>

{#if settings.vimMode}
	<div class="vim-status-bar" bind:this={vimStatusNode}></div>
{/if}

{#if settings.statusBar}
	<div class="status-bar">
		<div class="status-item">
								{t('editor.status.lineCol', settings.language).replace('{{line}}', (cursorPosition?.lineNumber ?? 1).toString()).replace('{{col}}', (cursorPosition?.column ?? 1).toString())}
							</div>
		{#if selectionCount > 0}
			<div class="status-item">
				{t('editor.status.selected', settings.language).replace('{{count}}', selectionCount.toString())}
			</div>
		{:else if cursorCount > 1}
			<div class="status-item">
				{t('editor.status.selections', settings.language).replace('{{count}}', cursorCount.toString())}
			</div>
		{/if}
		{#if settings.wordCount}
			<div class="status-item">
				{t('editor.status.words', settings.language).replace('{{count}}', wordCount.toString())}
			</div>
		{/if}
		<div class="status-item">
			{zoomLevel}%
		</div>
		<div class="status-item">
			{currentLanguage}
		</div>
		<div class="status-item">{t('editor.status.crlf')}</div>
		<div class="status-item">{t('editor.status.utf8')}</div>
	</div>
{/if}

<style>
	.editor-outer {
		flex: 1;
		height: 100%;
		width: 100%;
		display: flex;
		background-color: var(--color-canvas-default);
		overflow: hidden;
	}

	.editor-container {
		height: 100%;
		width: 100%;
		min-width: 0;
	}

	:global(.ghost-caret) {
		border-left: 2px solid var(--color-accent-fg);
		margin-left: -1px;
		opacity: 0.6;
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
		font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
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
