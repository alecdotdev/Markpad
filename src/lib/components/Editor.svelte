<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { tabManager } from "../stores/tabs.svelte.js";
	import { settings } from "../stores/settings.svelte.js";
	import { t, type LanguageCode } from '../utils/i18n.js';
	import { managedImageFromCopy, type ManagedImage } from '../utils/managedImages.js';
	import { MARKDOWN_LANGUAGE_ID, shouldLinkifyPastedUrl } from '../utils/pasteContext.js';

	import * as monaco from "monaco-editor";
	import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
	import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
	import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
	import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
	import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { invoke } from "@tauri-apps/api/core";

	type ScrollSyncPosition = {
		section: 'frontmatter' | 'body';
		ratio: number;
	};

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
		onscrollsync?: (position: ScrollSyncPosition) => void;
		zoomLevel?: number;
		isSplit?: boolean;
		theme?: string;
	}>();

	let container: HTMLDivElement;
	let vimStatusNode = $state<HTMLDivElement>();
	let editor: monaco.editor.IStandaloneCodeEditor;
	let isApplyingExternalScroll = false;
	const managedImages: ManagedImage[] = $state([]);

	let cursorPosition = $state<monaco.Position | null>(null);
	let selectionCount = $state(0);
	let cursorCount = $state(0);
	let wordCount = $state(0);
	let currentLanguage = $state("markdown");
	let currentTabId = tabManager.activeTabId;

	// A Monaco action captures its label when it is registered, so actions built
	// once at mount keep whatever language they were built with — switching the
	// UI language used to leave the editor's context menu in the old one until
	// the app was restarted. `addAction` returns an `IDisposable` for exactly
	// this case: the registration below is re-run on every language change, and
	// the previous disposables are released first so ids are never registered
	// twice (a duplicate id leaves a duplicate context-menu entry behind).
	//
	// `editorReady` has to be `$state` rather than a plain `if (editor)` guard:
	// `editor` is assigned inside `onMount` and is not reactive, so an effect
	// that bailed out on it would never re-run once the editor appeared.
	let editorReady = $state(false);
	let localizedActions: monaco.IDisposable[] = [];

	// `settings.osType` is resolved asynchronously from the Rust side, so it can
	// still be 'unknown' while the editor registers its keybindings. Fall back to
	// the synchronous browser hint in that window.
	//
	// The fallback reads a deprecated API on purpose, and the deprecation is
	// precisely what makes it reliable here: we are asking "is this macOS?", not
	// "which architecture is this?". `navigator.platform` still reports
	// "MacIntel" on Apple silicon — measured on an M5 (arm64), where the user
	// agent likewise still claims "Intel Mac OS X 10_15_7". Both values are
	// frozen deliberately by WebKit and Chromium: years of sites compare
	// `navigator.platform === 'MacIntel'` exactly, so changing it during the 2020
	// ARM transition would have made every Mac look like an unknown platform
	// overnight, and the capped Catalina version exists to limit fingerprinting.
	// So the string lies about the CPU while staying permanently correct about
	// the vendor — the only axis this function queries. The fallback therefore
	// cannot reach a different macOS verdict than `settings.osType` does, and the
	// keybindings never need re-registering once `osType` resolves.
	//
	// `navigator.userAgentData` is not used instead: only its coarse `platform`
	// field is synchronous, and architecture and platform version sit behind the
	// asynchronous high-entropy request. Waiting on that would reintroduce the
	// very delay `settings.osType` already has, which defeats the point of
	// having a synchronous fallback at all.
	function isMacPlatform(): boolean {
		if (settings.osType !== 'unknown') return settings.osType === 'macos';
		return /^(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || '');
	}

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
			renderLineHighlight: settings.renderLineHighlight as "line" | "none",
			occurrencesHighlight: settings.occurrencesHighlight
				? "singleFile"
				: "off",
			fontSize: settings.editorFontSize,
			fontFamily: settings.editorFont,
			wordBasedSuggestions: "off",
			quickSuggestions: false,
			renderWhitespace: settings.showWhitespace ? "all" : "none",
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
		} else if (tabManager.activeTab) {
			let scrolled = false;
			if (tabManager.activeTab.anchorLine > 0) {
				editor.revealLineNearTop(
					Math.max(1, tabManager.activeTab.anchorLine - 2),
					monaco.editor.ScrollType.Immediate,
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
						const imgPath = `${last.parentDir}/${last.imageDirectory}/${last.filename}`;
						invoke("delete_file", { path: imgPath })
							.then(() => {
								invoke("cleanup_empty_img_dir", { parentDir: last.parentDir, imageDirectory: last.imageDirectory });
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
					const imgDirName = settings.imageDirectory || "img";

					try {
						const [currentEntries, imgEntries] = await Promise.all([
							invoke("list_directory_contents", { path: parentDir })
								.then((r) => r as string[])
								.catch(() => []),
							invoke("list_directory_contents", { path: `${parentDir}/${imgDirName}` })
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
								label: `${imgDirName}/${e}`,
								kind: e.endsWith("/")
									? monaco.languages.CompletionItemKind.Folder
									: monaco.languages.CompletionItemKind.File,
								insertText: `${imgDirName}/${e}`,
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

		// clipboard handling: Ctrl+C is a localized action (see
		// `registerLocalizedActions`); Ctrl+V is a plain command with no label,
		// so it has nothing to re-register on a language change.
		editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, async () => {
			try {
				// check for image in clipboard via Rust
				const base64Image = await invoke("clipboard_read_image", { macosImageScaling: settings.macosImageScaling }).catch(() => null) as string | null;
				if (base64Image && tabManager.activeTab?.path) {
					const ext = "png"; // output of Rust command is always PNG
					const filename = `paste_${Date.now()}.${ext}`;

					const tabPath = tabManager.activeTab.path;
					const dirMatch = tabPath.match(/^(.*)[/\\][^/\\]+$/);
					if (dirMatch) {
						const parentDir = dirMatch[1];
						const imgDirName = settings.imageDirectory || "img";
						const relPath = (await invoke("save_image", {
							parentDir,
							filename,
							base64Data: base64Image,
							imageDirectory: imgDirName,
						})) as string;
						// Remove leading slash if imageDirectory was empty, to ensure relative path
						const escapedPath = relPath.replace(/ /g, "%20").replace(/^\//, "");
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

							managedImages.push(managedImageFromCopy({ embed, parentDir, imageDirectory: imgDirName, relativePath: relPath }));
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

				if (!isUrl || isMultiLine || !isLinkifyPasteTarget(model, selections[0])) {
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
						// Pasting a URL over a URL replaces it. Wrapping would
						// nest the old URL as the link text — and inside
						// existing link syntax like ![](url) it produces
						// broken nesting: ![]([old](new)).
						if (urlRegex.test(selectedText.trim())) {
							return {
								range: selection,
								text,
								forceMoveMarkers: true,
							};
						}
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
		}, "editorTextFocus");

		editorReady = true;

		return () => {
			editorReady = false;
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

	// Editing primitives used by the context-menu actions. They live at
	// component scope, not inside `onMount`, because the actions that call them
	// are torn down and rebuilt whenever the UI language changes.

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

	const transformSelectedLines = (
		source: string,
		transform: (lines: string[]) => string[],
	) => {
		const selection = editor.getSelection();
		const model = editor.getModel();
		if (!selection || !model) return;

		let endLine = selection.endLineNumber;
		if (selection.endColumn === 1 && endLine > selection.startLineNumber) {
			endLine -= 1;
		}

		const range = new monaco.Range(
			selection.startLineNumber,
			1,
			endLine,
			model.getLineMaxColumn(endLine),
		);
		const lines = model.getValueInRange(range).split(/\r?\n/);
		editor.executeEdits(source, [
			{
				range,
				text: transform(lines).join(model.getEOL()),
				forceMoveMarkers: true,
			},
		]);
	};

	const toggleLinePrefix = (source: string, prefix: string, pattern: RegExp) => {
		transformSelectedLines(source, (lines) => {
			const contentLines = lines.filter((line) => line.trim().length > 0);
			const shouldRemove = contentLines.length > 0 && contentLines.every((line) => pattern.test(line));
			return lines.map((line) => {
				if (!line.trim()) return line;
				if (shouldRemove) return line.replace(pattern, "");
				return `${prefix}${line}`;
			});
		});
	};

	const toggleHeading = (level: number) => {
		const heading = "#".repeat(level);
		transformSelectedLines(`fmt-heading-${level}`, (lines) => {
			const pattern = new RegExp(`^${heading}\\s+`);
			const contentLines = lines.filter((line) => line.trim().length > 0);
			const shouldRemove = contentLines.length > 0 && contentLines.every((line) => pattern.test(line));
			return lines.map((line) => {
				if (!line.trim()) return line;
				const withoutHeading = line.replace(/^#{1,6}\s+/, "");
				return shouldRemove ? withoutHeading : `${heading} ${withoutHeading}`;
			});
		});
	};

	const toggleNumberedList = () => {
		transformSelectedLines("fmt-numbered-list", (lines) => {
			const contentLines = lines.filter((line) => line.trim().length > 0);
			const shouldRemove = contentLines.length > 0 && contentLines.every((line) => /^\d+\.\s+/.test(line));
			let itemIndex = 1;
			return lines.map((line) => {
				if (!line.trim()) return line;
				if (shouldRemove) return line.replace(/^\d+\.\s+/, "");
				return `${itemIndex++}. ${line.replace(/^(?:[-*+]|\d+\.)\s+/, "")}`;
			});
		});
	};

	const wrapAsCodeBlock = () => {
		const selection = editor.getSelection();
		const model = editor.getModel();
		if (!selection || !model) return;

		const text = model.getValueInRange(selection);
		const block = text.startsWith("```\n") && text.endsWith("\n```")
			? text.slice(4, -4).replace(/\n$/, "")
			: `\`\`\`\n${text}\n\`\`\``;
		editor.executeEdits("fmt-code-block", [
			{ range: selection, text: block, forceMoveMarkers: true },
		]);
	};

	const insertLink = () => {
		const selection = editor.getSelection();
		const model = editor.getModel();
		if (!selection || !model) return;

		const text = model.getValueInRange(selection);
		const label = text || "link text";
		const link = `[${label}](url)`;
		editor.executeEdits("fmt-link", [
			{ range: selection, text: link, forceMoveMarkers: true },
		]);
	};

	/**
	 * Pasting a URL only turns into `[label](url)` where markdown links mean
	 * something. Inside a fenced or indented code block, inside inline code, or
	 * inside YAML front matter, the user wants the bare URL they copied.
	 *
	 * The decision is taken once per paste, from the primary selection: a paste
	 * is a single user action, and re-tokenizing for every cursor of a large
	 * multi-cursor selection would cost far more than the edge case is worth.
	 */
	function isLinkifyPasteTarget(
		model: monaco.editor.ITextModel,
		selection: monaco.Selection,
	): boolean {
		return shouldLinkifyPastedUrl({
			languageId: model.getLanguageId(),
			content: model.getValue(),
			linesUpToCaret: model.getLinesContent().slice(0, selection.startLineNumber),
			column: selection.startColumn,
			tokenize: (text) => monaco.editor.tokenize(text, MARKDOWN_LANGUAGE_ID),
		});
	}

	function disposeLocalizedActions() {
		for (const action of localizedActions) action.dispose();
		localizedActions = [];
	}

	/**
	 * Every action whose label comes from `t()` is registered here, so the whole
	 * set can be rebuilt in one place when the UI language changes. Actions with
	 * no user-visible label (the Ctrl+V command) stay in `onMount`.
	 */
	function registerLocalizedActions(lang: LanguageCode) {
		// Belt and braces: Svelte runs the effect cleanup before a re-run, but
		// re-registering an id without disposing the old action would leave a
		// duplicate entry in the context menu, so never assume it happened.
		disposeLocalizedActions();

		// macOS reserves Cmd+Tab for the system application switcher, so a
		// CtrlCmd-based binding never reaches the editor there. VS Code binds the
		// real Ctrl key (KeyMod.WinCtrl) on macOS for its own Tab cycling.
		const tabCycleModifier = isMacPlatform()
			? monaco.KeyMod.WinCtrl
			: monaco.KeyMod.CtrlCmd;

		localizedActions = [
			// Replaces Monaco's native copy so the text goes through the Rust
			// clipboard command.
			editor.addAction({
				id: "custom-copy",
				label: t('menu.copy', lang),
				keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC],
				keybindingContext: "editorTextFocus",
				run: async (ed) => {
					const selection = ed.getSelection();
					if (!selection) return;
					const model = ed.getModel();
					if (!model) return;
					// This action replaces Monaco's native copy, so it has to carry
					// Monaco's own `emptySelectionClipboard` default (also VS Code's and
					// Sublime Text's): with nothing selected, copy the whole current
					// line including its line ending.
					const text = selection.isEmpty()
						? model.getLineContent(selection.startLineNumber) + model.getEOL()
						: model.getValueInRange(selection);
					if (text) {
						await invoke("clipboard_write_text", { text }).catch(console.error);
					}
				},
			}),

			editor.addAction({
				id: "toggle-minimap",
				label: t('settings.minimap', lang),
				run: () => {
					settings.toggleMinimap();
				},
			}),

			editor.addAction({
				id: "toggle-word-wrap",
				label: t('settings.wordWrap', lang),
				run: () => {
					settings.toggleWordWrap();
				},
			}),

			editor.addAction({
				id: "toggle-line-numbers",
				label: t('settings.lineNumbers', lang),
				run: () => {
					settings.toggleLineNumbers();
				},
			}),

			editor.addAction({
				id: "toggle-vim-mode",
				label: t('settings.vimMode', lang),
				run: () => {
					settings.toggleVimMode();
				},
			}),

			editor.addAction({
				id: "toggle-status-bar",
				label: t('settings.statusBar', lang),
				run: () => {
					settings.toggleStatusBar();
				},
			}),

			editor.addAction({
				id: "toggle-word-count",
				label: t('settings.wordCount', lang),
				run: () => {
					settings.toggleWordCount();
				},
			}),

			editor.addAction({
				id: "toggle-line-highlight",
				label: t('settings.lineHighlight', lang),
				run: () => {
					settings.toggleLineHighlight();
				},
			}),

			editor.addAction({
				id: "toggle-occurrences-highlight",
				label: t('settings.occurrencesHighlight', lang),
				run: () => {
					settings.toggleOccurrencesHighlight();
				},
			}),

			editor.addAction({
				id: "toggle-whitespace",
				label: t('settings.showWhitespace', lang),
				run: () => {
					settings.toggleShowWhitespace();
				},
			}),

			editor.addAction({
				id: "toggle-tabs",
				label: t('settings.showTabs', lang),
				keybindings: [
					monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyB,
				],
				run: () => {
					settings.toggleTabs();
				},
			}),

			editor.addAction({
				id: "toggle-zen-mode",
				label: t('settings.zenMode', lang),
				keybindings: [
					monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
				],
				run: () => {
					settings.toggleZenMode();
				},
			}),

			editor.addAction({
				id: "fmt-bold",
				label: t('menu.bold', lang),
				keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
				run: () => toggleFormat("**"),
			}),

			editor.addAction({
				id: "fmt-italic",
				label: t('menu.italic', lang),
				keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
				run: () => toggleFormat("*"),
			}),

			editor.addAction({
				id: "fmt-underline",
				label: t('menu.underline', lang),
				keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyU],
				run: () => toggleFormat("<u>|</u>", "tag"),
			}),

			editor.addAction({
				id: "fmt-inline-code",
				label: t('menu.inlineCode', lang),
				run: () => toggleFormat("`"),
			}),

			editor.addAction({
				id: "fmt-code-block",
				label: t('menu.codeBlock', lang),
				run: () => wrapAsCodeBlock(),
			}),

			editor.addAction({
				id: "fmt-quote",
				label: t('menu.quote', lang),
				run: () => toggleLinePrefix("fmt-quote", "> ", /^>\s+/),
			}),

			editor.addAction({
				id: "fmt-heading-1",
				label: t('menu.heading1', lang),
				run: () => toggleHeading(1),
			}),

			editor.addAction({
				id: "fmt-heading-2",
				label: t('menu.heading2', lang),
				run: () => toggleHeading(2),
			}),

			editor.addAction({
				id: "fmt-heading-3",
				label: t('menu.heading3', lang),
				run: () => toggleHeading(3),
			}),

			editor.addAction({
				id: "fmt-bullet-list",
				label: t('menu.bulletList', lang),
				run: () => toggleLinePrefix("fmt-bullet-list", "- ", /^[-*+]\s+/),
			}),

			editor.addAction({
				id: "fmt-numbered-list",
				label: t('menu.numberedList', lang),
				run: () => toggleNumberedList(),
			}),

			editor.addAction({
				id: "fmt-checklist",
				label: t('menu.checklist', lang),
				run: () => toggleLinePrefix("fmt-checklist", "- [ ] ", /^[-*+]\s+\[[ xX]\]\s+/),
			}),

			editor.addAction({
				id: "fmt-link",
				label: t('menu.link', lang),
				run: () => insertLink(),
			}),

			editor.addAction({
				id: "insert-table-simple",
				label: t('menu.insertTable', lang),
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
			}),

			editor.addAction({
				id: "file-new",
				label: t('menu.newFile', lang),
				keybindings: [
					monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN,
					monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT,
				],
				run: () => onnew?.(),
			}),

			editor.addAction({
				id: "file-open",
				label: t('menu.openFile', lang),
				keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO],
				run: () => onopen?.(),
			}),

			editor.addAction({
				id: "file-save",
				label: t('menu.save', lang),
				keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
				run: () => onsave?.(),
			}),

			editor.addAction({
				id: "file-close",
				label: t('menu.closeFile', lang),
				keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW],
				run: () => onclose?.(),
			}),

			editor.addAction({
				id: "file-reveal",
				label: t('menu.openLocation', lang),
				keybindings: [
					monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR,
				],
				run: () => onreveal?.(),
			}),

			editor.addAction({
				id: "view-toggle-edit",
				label: t('menu.toggleEditMode', lang),
				keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
				run: () => ontoggleEdit?.(),
			}),

			editor.addAction({
				id: "view-toggle-live",
				label: t('menu.toggleLiveMode', lang),
				keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL],
				run: () => ontoggleLive?.(),
			}),

			editor.addAction({
				id: "view-toggle-split",
				label: t('menu.toggleSplitView', lang),
				keybindings: [
					monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backslash,
					monaco.KeyMod.CtrlCmd | monaco.KeyCode.IntlBackslash,
				],
				run: () => ontoggleSplit?.(),
			}),

			editor.addAction({
				id: "tab-next",
				label: t('menu.nextTab', lang),
				keybindings: [tabCycleModifier | monaco.KeyCode.Tab],
				run: () => onnextTab?.(),
			}),

			editor.addAction({
				id: "tab-prev",
				label: t('menu.previousTab', lang),
				keybindings: [
					tabCycleModifier | monaco.KeyMod.Shift | monaco.KeyCode.Tab,
				],
				run: () => onprevTab?.(),
			}),

			editor.addAction({
				id: "tab-undo-close",
				label: t('menu.undoCloseTab', lang),
				keybindings: [
					monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyT,
				],
				run: () => onundoClose?.(),
			}),

			editor.addAction({
				id: "app-command-palette",
				label: t('menu.commandPalette', lang),
				keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP],
				run: (ed) => {
					ed.trigger("keyboard", "editor.action.quickCommand", {});
				},
			}),

		];
	}

	$effect(() => {
		const lang = settings.language;
		if (!editorReady) return;

		registerLocalizedActions(lang);
		return disposeLocalizedActions;
	});

	onDestroy(disposeLocalizedActions);

	function clampScrollRatio(value: number) {
		if (!Number.isFinite(value)) return 0;
		return Math.max(0, Math.min(1, value));
	}

	function getScrollSyncPositionFromPixels(scrollTop: number, scrollMax: number, frontMatterEnd: number): ScrollSyncPosition {
		const safeMax = Math.max(0, scrollMax);
		const safeFrontMatterEnd = Math.max(0, Math.min(safeMax, frontMatterEnd));
		const safeScrollTop = Math.max(0, Math.min(safeMax, scrollTop));

		if (safeFrontMatterEnd > 0 && safeScrollTop < safeFrontMatterEnd) {
			return {
				section: 'frontmatter',
				ratio: clampScrollRatio(safeScrollTop / safeFrontMatterEnd),
			};
		}

		const bodyRange = Math.max(0, safeMax - safeFrontMatterEnd);
		return {
			section: 'body',
			ratio: bodyRange > 0 ? clampScrollRatio((safeScrollTop - safeFrontMatterEnd) / bodyRange) : 0,
		};
	}

	function getScrollTopForSyncPosition(position: ScrollSyncPosition, scrollMax: number, frontMatterEnd: number) {
		const safeMax = Math.max(0, scrollMax);
		const safeFrontMatterEnd = Math.max(0, Math.min(safeMax, frontMatterEnd));
		const ratio = clampScrollRatio(position.ratio);

		if (position.section === 'frontmatter') {
			return safeFrontMatterEnd * ratio;
		}

		const bodyRange = Math.max(0, safeMax - safeFrontMatterEnd);
		return safeFrontMatterEnd + bodyRange * ratio;
	}

	function getFrontMatterBodyStartLine(content: string) {
		const lines = content.split(/\r\n|\n|\r/);
		if (lines.length === 0 || lines[0].replace(/^\uFEFF/, '').trim() !== '---') return 1;

		for (let index = 1; index < lines.length; index += 1) {
			if (lines[index].trim() !== '---') continue;

			let bodyStartLine = index + 2;
			if (lines[bodyStartLine - 1]?.trim() === '') bodyStartLine += 1;
			return bodyStartLine;
		}

		return 1;
	}

	function getEditorScrollMax() {
		if (!editor) return 0;

		const layout = editor.getLayoutInfo();
		return Math.max(0, editor.getScrollHeight() - layout.height);
	}

	function getEditorContentScrollMax() {
		if (!editor) return 0;

		const layout = editor.getLayoutInfo();
		return Math.max(0, editor.getContentHeight() - layout.height);
	}

	function getEditorFrontMatterScrollEnd() {
		if (!editor) return 0;

		const model = editor.getModel();
		if (!model) return 0;

		const bodyStartLine = getFrontMatterBodyStartLine(model.getValue());
		if (bodyStartLine <= 1) return 0;

		const safeBodyStartLine = Math.max(1, Math.min(model.getLineCount(), bodyStartLine));
		return Math.max(0, Math.min(getEditorContentScrollMax(), editor.getTopForLineNumber(safeBodyStartLine)));
	}

	function getEditorScrollSyncPosition() {
		if (!editor) {
			return { section: 'body', ratio: 0 } satisfies ScrollSyncPosition;
		}

		return getScrollSyncPositionFromPixels(
			editor.getScrollTop(),
			getEditorContentScrollMax(),
			getEditorFrontMatterScrollEnd(),
		);
	}

	export function syncScrollToPosition(position: ScrollSyncPosition) {
		if (!editor) return;

		const targetScroll = getScrollTopForSyncPosition(
			position,
			getEditorContentScrollMax(),
			getEditorFrontMatterScrollEnd(),
		);

		if (Math.abs(editor.getScrollTop() - targetScroll) <= 5) return;

		isApplyingExternalScroll = true;
		editor.setScrollTop(targetScroll, monaco.editor.ScrollType.Immediate);

		requestAnimationFrame(() => {
			isApplyingExternalScroll = false;
		});
	}

	$effect(() => {
		if (editor && onscrollsync) {
			const emitSync = () => {
				if (isApplyingExternalScroll) return;

				onscrollsync?.(getEditorScrollSyncPosition());
			};

			const scrollListener = editor.onDidScrollChange((e) => {
				if (e.scrollTopChanged) {
					emitSync();
				}
			});
			return () => {
				scrollListener.dispose();
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
				wordWrapColumn: settings.editorMaxWidth,
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
				renderWhitespace: settings.showWhitespace ? "all" : "none",
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
			let disposed = false;
			let vim: { dispose: () => void } | null = null;
			const currentEditor = editor;
			const currentStatusNode = vimStatusNode;
			import("monaco-vim").then(({ initVimMode }) => {
				if (disposed) return;
				vim = initVimMode(currentEditor, currentStatusNode);
			});
			return () => {
				disposed = true;
				vim?.dispose();
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
			const imgDirName = settings.imageDirectory || "img";
			const relPath = (await invoke("copy_file_to_img", {
				srcPath: path,
				parentDir,
				imageDirectory: imgDirName,
			})) as string;
			// Remove leading slash if imageDirectory was empty
			const escapedPath = relPath.replace(/ /g, "%20").replace(/^\//, "");
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

			managedImages.push(managedImageFromCopy({ embed, parentDir, imageDirectory: imgDirName, relativePath: relPath }));
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

	export function revealHeader(sourceLine: number | null, text: string) {
		if (!editor) return;
		const model = editor.getModel();
		if (!model) return;
		const lineNumber = sourceLine ?? 0;
		if (Number.isInteger(lineNumber) && lineNumber > 0) {
			editor.revealLineInCenterIfOutsideViewport(lineNumber, monaco.editor.ScrollType.Smooth);
			editor.setSelection({
				startLineNumber: lineNumber,
				startColumn: 1,
				endLineNumber: lineNumber,
				endColumn: model.getLineMaxColumn(lineNumber),
			});
			editor.focus();
			return;
		}

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

	export const triggerFind = () => {
		if (!editor) return;
		editor.focus();
		editor.getAction("actions.find")?.run();
	}

	export function insertTableCustom(rows: number, cols: number) {
		if (!editor) return;
		editor.focus();
		const selection = editor.getSelection();
		if (!selection) return;

		const c = Math.max(1, cols);
		const r = Math.max(1, rows);

		let table = "\n";
		const headers = Array.from({ length: c }, (_, i) => `Header ${i + 1}`);
		table += "| " + headers.join(" | ") + " |\n";

		const dividers = Array(c).fill("---");
		table += "| " + dividers.join(" | ") + " |\n";

		const dataRowCount = Math.max(1, r - 1);
		for (let row = 0; row < dataRowCount; row++) {
			const cells = Array.from({ length: c }, (_, col) => `Cell ${row + 1}.${col + 1}`);
			table += "| " + cells.join(" | ") + " |\n";
		}
		table += "\n";

		editor.executeEdits("insert-table", [
			{
				range: selection,
				text: table,
				forceMoveMarkers: true,
			},
		]);
	}

	export function runEditorAction(actionId: string, payload?: any) {
		if (!editor) return;
		editor.focus();
		if (actionId === 'insert-table-grid' && payload && typeof payload === 'object') {
			insertTableCustom(payload.rows ?? 2, payload.cols ?? 3);
			return;
		}
		editor.getAction(actionId)?.run();
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
