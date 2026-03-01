<script lang="ts">
	import { invoke, convertFileSrc } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { onMount, tick, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { open, save, ask } from '@tauri-apps/plugin-dialog';
	import Installer from './Installer.svelte';
	import Uninstaller from './Uninstaller.svelte';
	import Settings from './components/Settings.svelte';
	import TitleBar from './components/TitleBar.svelte';
	import Editor from './components/Editor.svelte';
	import Modal from './components/Modal.svelte';
	import ContextMenu, { type ContextMenuItem } from './components/ContextMenu.svelte';

	const appWindow = getCurrentWindow();

	import DOMPurify from 'dompurify';
	import HomePage from './components/HomePage.svelte';
	import { tabManager } from './stores/tabs.svelte.js';
	import { settings } from './stores/settings.svelte.js';

	// syntax highlighting & latex
	let hljs: any = $state(null);
	let renderMathInElement: any = $state(null);
	let mermaid: any = $state(null);

	import 'highlight.js/styles/github-dark.css';
	import 'katex/dist/katex.min.css';

	let mode = $state<'loading' | 'app' | 'installer' | 'uninstall'>('loading');

	let showSettings = $state(false);

	let recentFiles = $state<string[]>([]);
	let isFocused = $state(true);
	let markdownBody = $state<HTMLElement | null>(null);
	let editorPane = $state<{ syncScrollToLine: (line: number, ratio?: number) => void } | null>(null);
	let liveMode = $state(false);

	let isDragging = $state(false);
	let isProgrammaticScroll = false;

	// derived from tab manager
	let activeTab = $derived(tabManager.activeTab);
	let isEditing = $derived(activeTab?.isEditing ?? false);
	let rawContent = $derived(activeTab?.rawContent ?? '');
	let isSplit = $derived(activeTab?.isSplit ?? false);

	// derived from tab manager
	let currentFile = $derived(tabManager.activeTab?.path ?? '');
	let editorLanguage = $derived(getLanguage(currentFile));
	let htmlContent = $derived(tabManager.activeTab?.content ?? '');
	let sanitizedHtml = $derived(DOMPurify.sanitize(htmlContent));
	let scrollTop = $derived(tabManager.activeTab?.scrollTop ?? 0);
	let isScrolled = $derived(scrollTop > 0);
	let windowTitle = $derived(tabManager.activeTab?.title ?? 'Markpad');
	let isScrollSynced = $derived(tabManager.activeTab?.isScrollSynced ?? false);

	let showHome = $state(false);
	let isFullWidth = $state(localStorage.getItem('isFullWidth') === 'true');

	$effect(() => {
		localStorage.setItem('isFullWidth', String(isFullWidth));
	});

	// Theme State
	let theme = $state<'system' | 'dark' | 'light'>('system');

	onMount(() => {
		const storedTheme = localStorage.getItem('theme') as 'system' | 'dark' | 'light' | null;
		if (storedTheme) theme = storedTheme;
		// Clear the forced background color from app.html
		document.documentElement.style.removeProperty('background-color');
	});

	$effect(() => {
		localStorage.setItem('theme', theme);
		invoke('save_theme', { theme }).catch(console.error);

		if (theme === 'system') {
			delete document.documentElement.dataset.theme;
		} else {
			document.documentElement.dataset.theme = theme;
		}

		// Re-initialize mermaid or trigger update if needed
		// Note: Mermaid 10+ usually doesn't support dynamic re-init easily but we can try re-rendering rich content
		if (markdownBody && !isEditing) renderRichContent();
	});

	// ui state
	let tooltip = $state({ show: false, text: '', x: 0, y: 0 });
	let caretEl: HTMLElement;
	let caretAbsoluteTop = 0;
	let modalState = $state<{
		show: boolean;
		title: string;
		message: string;
		kind: 'info' | 'warning' | 'error';
		showSave: boolean;
		resolve: ((v: 'save' | 'discard' | 'cancel') => void) | null;
	}>({
		show: false,
		title: '',
		message: '',
		kind: 'info',
		showSave: false,
		resolve: null,
	});

	let docContextMenu = $state<{
		show: boolean;
		x: number;
		y: number;
		items: ContextMenuItem[];
	}>({
		show: false,
		x: 0,
		y: 0,
		items: [],
	});

	function askCustom(message: string, options: { title: string; kind: 'info' | 'warning' | 'error'; showSave?: boolean }): Promise<'save' | 'discard' | 'cancel'> {
		return new Promise((resolve) => {
			modalState = {
				show: true,
				title: options.title,
				message,
				kind: options.kind,
				showSave: options.showSave ?? false,
				resolve,
			};
		});
	}

	function handleModalSave() {
		if (modalState.resolve) modalState.resolve('save');
		modalState.show = false;
	}

	function handleModalConfirm() {
		if (modalState.resolve) modalState.resolve('discard');
		modalState.show = false;
	}

	function handleModalCancel() {
		if (modalState.resolve) modalState.resolve('cancel');
		modalState.show = false;
	}

	function getLanguage(path: string) {
		if (!path) return 'markdown';
		const ext = path.split('.').pop()?.toLowerCase();
		switch (ext) {
			case 'js':
			case 'jsx':
				return 'javascript';
			case 'ts':
			case 'tsx':
				return 'typescript';
			case 'html':
				return 'html';
			case 'css':
				return 'css';
			case 'json':
				return 'json';
			case 'md':
			case 'markdown':
			case 'mdown':
			case 'mkd':
				return 'markdown';
			default:
				return 'plaintext';
		}
	}

	$effect(() => {
		const _ = tabManager.activeTabId;
		showHome = false;
	});

	function processMarkdownHtml(html: string, filePath: string): string {
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, 'text/html');

		// resolve relative image paths
		for (const img of doc.querySelectorAll('img')) {
			const src = img.getAttribute('src');
			let finalSrc = src;
			if (src && !src.startsWith('http') && !src.startsWith('data:')) {
				finalSrc = convertFileSrc(resolvePath(filePath, src));
				img.setAttribute('src', finalSrc);
			}

			if (src) {
				const ext = src.split('.').pop()?.toLowerCase();
				const isVideo = ['mp4', 'webm', 'ogg', 'mov'].includes(ext || '');
				const isAudio = ['mp3', 'wav', 'aac', 'flac', 'm4a'].includes(ext || '');

				if (isVideo || isAudio) {
					const media = doc.createElement(isVideo ? 'video' : 'audio');
					media.setAttribute('controls', '');
					media.setAttribute('src', finalSrc || '');
					media.style.maxWidth = '100%';

					// Copy attributes
					if (img.hasAttribute('width')) media.setAttribute('width', img.getAttribute('width')!);
					if (img.hasAttribute('height')) media.setAttribute('height', img.getAttribute('height')!);
					if (img.hasAttribute('alt')) media.setAttribute('aria-label', img.getAttribute('alt')!);
					if (img.hasAttribute('title')) media.setAttribute('title', img.getAttribute('title')!);

					img.replaceWith(media);
					continue;
				}

				if (isYoutubeLink(src)) {
					const videoId = getYoutubeId(src);
					if (videoId) replaceWithYoutubeEmbed(img, videoId);
				}
			}
		}

		// convert youtube links to embeds
		for (const a of doc.querySelectorAll('a')) {
			const href = a.getAttribute('href');
			if (href && isYoutubeLink(href)) {
				const parent = a.parentElement;
				if (parent && (parent.tagName === 'P' || parent.tagName === 'DIV') && parent.childNodes.length === 1) {
					const videoId = getYoutubeId(href);
					if (videoId) replaceWithYoutubeEmbed(a, videoId);
				}
			}
		}

		// parse gfm alerts
		for (const bq of doc.querySelectorAll('blockquote')) {
			const firstP = bq.querySelector('p');
			if (firstP) {
				const text = firstP.textContent || '';
				const match = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
				if (match) {
					const alertIcons: Record<string, string> = {
						note: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
						tip: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.21c-.044-.312-.18-.692-.41-1.025-.23-.333-.524-.681-.797-1.004l-.213-.252C2.962 7.325 2.5 6.395 2.5 5.25c0-2.978 2.304-5.25 5.5-5.25S13.5 2.272 13.5 5.25c0 1.145-.462 2.075-1.087 2.819l-.213.252c-.273.323-.567.671-.797 1.004-.23.333-.366.713-.41 1.025a.75.75 0 0 1-1.484-.21c.084-.594.337-1.079.621-1.49.203-.292.45-.584.673-.848l.214-.253c.56-.679.984-1.32.984-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6.25 14.5h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5Z"></path></svg>',
						important:
							'<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>',
						warning:
							'<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.03 11.315a1.75 1.75 0 0 1-1.543 2.573H1.97a1.75 1.75 0 0 1-1.543-2.573ZM9 4.25a.75.75 0 0 0-1.5 0V9a.75.75 0 0 0 1.5 0ZM9 11a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z"></path></svg>',
						caution:
							'<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .39.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.39.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
					};

					const type = match[1].toLowerCase();
					const alertDiv = doc.createElement('div');
					alertDiv.className = `markdown-alert markdown-alert-${type}`;

					const titleP = doc.createElement('p');
					titleP.className = 'markdown-alert-title';
					titleP.innerHTML = `${alertIcons[type] || ''} <span>${type.charAt(0).toUpperCase() + type.slice(1)}</span>`;

					alertDiv.appendChild(titleP);

					firstP.textContent = text.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i, '').trim() || '';
					if (firstP.textContent === '' && firstP.nextSibling) firstP.remove();

					while (bq.firstChild) alertDiv.appendChild(bq.firstChild);
					bq.replaceWith(alertDiv);
				}
			}
		}

		return doc.body.innerHTML;
	}

	async function loadMarkdown(filePath: string, options: { navigate?: boolean; skipTabManagement?: boolean } = {}) {
		showHome = false;
		try {
			if (options.navigate && tabManager.activeTab) {
				tabManager.navigate(tabManager.activeTab.id, filePath);
			} else if (!options.skipTabManagement) {
				const existing = tabManager.tabs.find((t) => t.path === filePath);
				if (existing) {
					tabManager.setActive(existing.id);
				} else if (tabManager.activeTab && tabManager.activeTab.path === '') {
					tabManager.updateTabPath(tabManager.activeTab.id, filePath);
				} else {
					tabManager.addTab(filePath);
				}
			}
			const activeId = tabManager.activeTabId;
			if (!activeId) return;

			const ext = filePath.split('.').pop()?.toLowerCase();
			const isMarkdown = ['md', 'markdown', 'mdown', 'mkd'].includes(ext || '');
			const tab = tabManager.tabs.find((t) => t.id === activeId);

			if (isMarkdown) {
				if (tab) tab.isEditing = false;
				const html = (await invoke('open_markdown', { path: filePath })) as string;
				const processedInfo = processMarkdownHtml(html, filePath);
				tabManager.updateTabContent(activeId, processedInfo);
			} else {
				if (tab) tab.isEditing = true;
				const content = (await invoke('read_file_content', { path: filePath })) as string;
				tabManager.setTabRawContent(activeId, content);
			}

			if (liveMode) invoke('watch_file', { path: filePath }).catch(console.error);

			await tick();
			if (filePath) saveRecentFile(filePath);
		} catch (error) {
			console.error('Error loading file:', error);
			const errStr = String(error);
			if (errStr.includes('The system cannot find the file specified') || errStr.includes('No such file or directory')) {
				deleteRecentFile(filePath);
				if (tabManager.activeTab && tabManager.activeTab.path === filePath) {
					tabManager.closeTab(tabManager.activeTab.id);
				}
			}
		}
	}

	async function renderRichContent() {
		if (!markdownBody) return;

		if (!hljs || !renderMathInElement || !mermaid) return;

		// Initialize Mermaid with theme based on system preference or override
		const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const effectiveTheme = theme === 'system' ? (isSystemDark ? 'dark' : 'neutral') : theme === 'dark' ? 'dark' : 'neutral';
		mermaid.initialize({ startOnLoad: false, theme: effectiveTheme });

		// Process code blocks
		const codeBlocks = Array.from(markdownBody.querySelectorAll('pre code'));
		for (const block of codeBlocks) {
			const codeEl = block as HTMLElement;
			const preEl = codeEl.parentElement as HTMLPreElement;

			// Check for Mermaid blocks
			if (codeEl.classList.contains('language-mermaid')) {
				try {
					const mermaidCode = codeEl.textContent || '';
					const id = `mermaid-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

					// Render the diagram
					const { svg } = await mermaid.render(id, mermaidCode);

					// Create container and replace the <pre> block
					const container = document.createElement('div');
					container.className = 'mermaid-diagram';
					// Allow foreignObject for Mermaid text rendering
					container.innerHTML = DOMPurify.sanitize(svg, {
						ADD_TAGS: ['foreignObject'],
						ADD_ATTR: ['dominant-baseline', 'text-anchor'],
					});
					preEl.replaceWith(container);
				} catch (error) {
					console.error('Failed to render Mermaid diagram:', error);
					// Display error in place of diagram
					const errorDiv = document.createElement('div');
					errorDiv.className = 'mermaid-error';
					errorDiv.style.color = 'red';
					errorDiv.style.padding = '1em';
					errorDiv.textContent = `Error rendering Mermaid diagram: ${error}`;
					preEl.replaceWith(errorDiv);
				}
				continue; // Skip highlight.js for this block
			}

			// Existing highlight.js logic
			// Check if language was explicitly specified BEFORE highlight.js runs
			const hasExplicitLang = Array.from(codeEl.classList).some((c) => c.startsWith('language-'));
			
			// Only highlight if explicit language is specified
			if (hasExplicitLang) {
				hljs.highlightElement(codeEl);
			}

			const langClass = Array.from(codeEl.classList).find((c) => c.startsWith('language-'));

			if (preEl && preEl.tagName === 'PRE') {
				preEl.querySelectorAll('.lang-label').forEach((l) => l.remove());
				const codeContent = codeEl.textContent || '';
				const existingWrapper = preEl.parentElement?.classList.contains('code-block-shell') ? preEl.parentElement as HTMLDivElement : null;
				existingWrapper?.querySelectorAll(':scope > .lang-label').forEach((l) => l.remove());

				const wrapper = existingWrapper ?? document.createElement('div');
				if (!existingWrapper) {
					wrapper.className = 'code-block-shell';
					preEl.replaceWith(wrapper);
					wrapper.appendChild(preEl);
				}

				const copyCode = () => {
					const codeToCopy = codeContent.replace(/\n$/, '');
					navigator.clipboard.writeText(codeToCopy).then(() => {
						const originalContent = label.innerHTML;
						label.innerHTML = 'Copied!';
						label.classList.add('copied');
						setTimeout(() => {
							label.innerHTML = originalContent;
							label.classList.remove('copied');
						}, 1500);
					}).catch((err) => {
						console.error('Failed to copy code:', err);
					});
				};

				const label = document.createElement('button');
				label.className = 'lang-label';
				label.title = 'Click to copy code';
				label.onclick = copyCode;

				if (hasExplicitLang && langClass) {
					label.textContent = langClass.replace('language-', '');
					wrapper.appendChild(label);
				} else {
					label.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
					wrapper.appendChild(label);
				}
			}
		}

		// KaTeX math rendering
		renderMathInElement(markdownBody, {
			delimiters: [
				{ left: '$$', right: '$$', display: true },
				{ left: '$', right: '$', display: false },
				{ left: '\\(', right: '\\)', display: false },
				{ left: '\\[', right: '\\]', display: true },
			],
			throwOnError: false,
		});
	}

	$effect(() => {
		if (htmlContent && markdownBody && !isEditing && hljs && renderMathInElement && mermaid) renderRichContent();
	});

	$effect(() => {
		// Depend on the ID and body existence to trigger restore
		const id = tabManager.activeTabId;
		const body = markdownBody;

		if (id && body) {
			untrack(() => {
				const tab = tabManager.tabs.find((t) => t.id === id);
				if (tab) {
					let scrolled = false;

					if (tab.anchorLine > 0) {
						// Interpolated Restore
						// Find element containing the anchor line
						const children = Array.from(body.children) as HTMLElement[];
						for (const el of children) {
							const sourcepos = el.dataset.sourcepos;
							if (sourcepos) {
								const [start, end] = sourcepos.split('-');
								const startLine = parseInt(start.split(':')[0]);
								const endLine = parseInt(end.split(':')[0]);

								if (!isNaN(startLine) && !isNaN(endLine)) {
									if (tab.anchorLine >= startLine && tab.anchorLine <= endLine) {
										// Found the container
										const totalLines = endLine - startLine; // Can be 0 for single line
										let ratio = 0;
										if (totalLines > 0) {
											ratio = (tab.anchorLine - startLine) / totalLines;
										}

										// Calculate target pixel position
										// We want the anchor line to be roughly at offset 60
										const targetOffset = el.offsetTop + el.offsetHeight * ratio - 60;
										body.scrollTop = Math.max(0, targetOffset);
										scrolled = true;
										break;
									}
								}
							}
						}
					}

					if (!scrolled) {
						if (body.scrollHeight > body.clientHeight && tab.scrollPercentage > 0) {
							const targetScroll = tab.scrollPercentage * (body.scrollHeight - body.clientHeight);
							body.scrollTop = targetScroll;
						} else {
							body.scrollTop = tab.scrollTop;
						}
					}
				}
			});
		}
	});

	$effect(() => {
		if (markdownBody && !isEditing && tabManager.activeTabId) {
			tick().then(() => {
				markdownBody?.focus({ preventScroll: true });
			});
		}
	});

	function scrollToLine(line: number, ratio: number = 0) {
		if (!markdownBody) return;

		const children = Array.from(markdownBody.children) as HTMLElement[];
		for (const el of children) {
			const sourcepos = el.dataset.sourcepos;
			if (sourcepos) {
				const [start, end] = sourcepos.split('-');
				const startLine = parseInt(start.split(':')[0]);
				const endLine = parseInt(end.split(':')[0]);

				if (!isNaN(startLine) && !isNaN(endLine)) {
					if (line >= startLine && line <= endLine) {
						const totalLines = endLine - startLine;
						let lineRatio = 0;
						if (totalLines > 0) {
							lineRatio = (line - startLine) / totalLines;
						}
						lineRatio = Math.max(0, Math.min(1, lineRatio));

						const elementTop = el.offsetTop + el.offsetHeight * lineRatio;

						const viewportHeight = markdownBody.clientHeight;
						const targetScroll = elementTop - viewportHeight * ratio;

						if (Math.abs(markdownBody.scrollTop - targetScroll) > 5) {
							isProgrammaticScroll = true;
							markdownBody.scrollTop = Math.max(0, targetScroll);
						}
						return;
					}
				}
			}
		}
	}

	function handleEditorScrollSync(line: number, ratio: number = 0) {
		if (tabManager.activeTab?.isScrollSynced) {
			scrollToLine(line, ratio);
		}
	}

	function syncEditorToPreviewScroll(target: HTMLElement) {
		if (!tabManager.activeTab?.isScrollSynced || !editorPane) return;

		const anchorOffset = target.scrollTop + 60;
		const viewportRatio = target.clientHeight > 0 ? Math.min(1, 60 / target.clientHeight) : 0;
		const children = Array.from(markdownBody?.children || []);

		for (const child of children) {
			const el = child as HTMLElement;
			if (el.offsetTop <= anchorOffset && el.offsetTop + el.offsetHeight > anchorOffset) {
				const sourcepos = el.dataset.sourcepos;
				if (!sourcepos) break;

				const [start, end] = sourcepos.split('-');
				const startLine = parseInt(start.split(':')[0]);
				const endLine = parseInt(end.split(':')[0]);

				if (!isNaN(startLine) && !isNaN(endLine)) {
					const relativeOffset = anchorOffset - el.offsetTop;
					const elementRatio = el.offsetHeight > 0 ? relativeOffset / el.offsetHeight : 0;
					const totalLines = endLine - startLine;
					const estimatedLine = startLine + Math.round(totalLines * elementRatio);

					editorPane.syncScrollToLine(estimatedLine, viewportRatio);
				}
				break;
			}
		}
	}

	function handleScroll(e: Event) {
		const target = e.target as HTMLElement;

		if (isProgrammaticScroll) {
			isProgrammaticScroll = false;
			if (tabManager.activeTabId) {
				tabManager.updateTabScroll(tabManager.activeTabId, target.scrollTop);
			}
			return;
		}

		if (tabManager.activeTabId) {
			// Update raw scroll pos
			tabManager.updateTabScroll(tabManager.activeTabId, target.scrollTop);

			// Percentage fallback
			if (target.scrollHeight > target.clientHeight) {
				const percentage = target.scrollTop / (target.scrollHeight - target.clientHeight);
				tabManager.updateTabScrollPercentage(tabManager.activeTabId, percentage);
			}

			// Interpolated Anchor Calculation
			const anchorOffset = target.scrollTop + 60;
			const children = Array.from(markdownBody?.children || []);

			for (const child of children) {
				const el = child as HTMLElement;
				// Check intersection
				if (el.offsetTop <= anchorOffset && el.offsetTop + el.offsetHeight > anchorOffset) {
					const sourcepos = el.dataset.sourcepos;
					if (sourcepos) {
						const [start, end] = sourcepos.split('-');
						const startLine = parseInt(start.split(':')[0]);
						const endLine = parseInt(end.split(':')[0]);

						if (!isNaN(startLine) && !isNaN(endLine)) {
							// Calculate relative position within element
							const relativeOffset = anchorOffset - el.offsetTop;
							const ratio = relativeOffset / el.offsetHeight;

							const totalLines = endLine - startLine;
							const estimatedLine = startLine + Math.round(totalLines * ratio);

							tabManager.updateTabAnchorLine(tabManager.activeTabId, estimatedLine);
						}
					}
					break;
				}
			}
		}

		syncEditorToPreviewScroll(target);
	}

	function saveRecentFile(path: string) {
		let files = [...recentFiles].filter((f) => f !== path);
		files.unshift(path);
		recentFiles = files.slice(0, 9);
		localStorage.setItem('recent-files', JSON.stringify(recentFiles));
	}

	function loadRecentFiles() {
		const stored = localStorage.getItem('recent-files');
		if (stored) {
			try {
				recentFiles = JSON.parse(stored);
			} catch (e) {
				console.error('Error parsing recent files:', e);
			}
		}
	}

	function deleteRecentFile(path: string) {
		recentFiles = recentFiles.filter((f) => f !== path);
		localStorage.setItem('recent-files', JSON.stringify(recentFiles));
	}

	function removeRecentFile(path: string, event: MouseEvent) {
		event.stopPropagation();
		deleteRecentFile(path);
		if (currentFile === path) tabManager.closeTab(tabManager.activeTabId!);
	}

	function resolvePath(basePath: string, relativePath: string) {
		if (relativePath.match(/^[a-zA-Z]:/) || relativePath.startsWith('/')) return relativePath;
		const parts = basePath.split(/[/\\]/);
		parts.pop();
		for (const p of relativePath.split(/[/\\]/)) {
			if (p === '.') continue;
			if (p === '..') parts.pop();
			else parts.push(p);
		}
		return parts.join('/');
	}

	function isYoutubeLink(url: string) {
		return url.includes('youtube.com/watch') || url.includes('youtu.be/');
	}

	function getYoutubeId(url: string) {
		const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
		return match && match[2].length === 11 ? match[2] : null;
	}

	function replaceWithYoutubeEmbed(element: Element, videoId: string) {
		const container = element.ownerDocument.createElement('div');
		container.className = 'video-container';
		const iframe = element.ownerDocument.createElement('iframe');
		iframe.src = `https://www.youtube.com/embed/${videoId}`;
		iframe.title = 'YouTube video player';
		iframe.frameBorder = '0';
		iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
		iframe.allowFullscreen = true;
		container.appendChild(iframe);
		element.replaceWith(container);
	}

	async function canCloseTab(tabId: string): Promise<boolean> {
		const tab = tabManager.tabs.find((t) => t.id === tabId);
		if (!tab || (!tab.isDirty && tab.path !== '')) return true;

		if (!tab.isDirty) return true;

		const response = await askCustom(`You have unsaved changes in "${tab.title}". Do you want to save them before closing?`, {
			title: 'Unsaved Changes',
			kind: 'warning',
			showSave: true,
		});

		if (response === 'cancel') return false;
		if (response === 'save') {
			return await saveContent();
		}

		return true; // discard
	}

	async function toggleEdit(autoSave = false) {
		const tab = tabManager.activeTab;
		if (!tab || tab.path === undefined) return;

		if (isEditing) {
			// Switch back to view
			if (tab.isDirty && tab.path !== '') {
				if (autoSave) {
					const success = await saveContent();
					if (!success) return; // If save fails, stay in edit mode?
				} else {
					const response = await askCustom('You have unsaved changes. Do you want to save them before returning to view mode?', {
						title: 'Unsaved Changes',
						kind: 'warning',
						showSave: true,
					});

					if (response === 'cancel') return;
					if (response === 'save') {
						const success = await saveContent();
						if (!success) return;
					} else if (response === 'discard') {
						tab.rawContent = tab.originalContent;
					}
				}
			}
			tab.isEditing = false;
			if (tab.path !== '') {
				tab.isDirty = false;
				await loadMarkdown(tab.path);
			} else {
				try {
					const html = (await invoke('render_markdown', { content: tab.rawContent })) as string;
					const processedInfo = processMarkdownHtml(html, '');
					tabManager.updateTabContent(tab.id, processedInfo);
				} catch (e) {
					console.error('Failed to render markdown for unsaved file', e);
				}
			}
		} else {
			// Switch to edit
			if (tab.path !== '') {
				try {
					const content = (await invoke('read_file_content', { path: tab.path })) as string;
					tab.rawContent = content;
					tab.isEditing = true;
					tab.isDirty = false;
				} catch (e) {
					console.error('Failed to read file for editing', e);
				}
			} else {
				tab.isEditing = true;
			}
		}
	}

	async function saveContent(): Promise<boolean> {
		const tab = tabManager.activeTab;
		if (!tab || (!tab.isEditing && !tab.isSplit)) return false;

		let targetPath = tab.path;

		if (!targetPath) {
			// Special handling for new (untitled) files
			const selected = await save({
				filters: [
					{ name: 'Markdown', extensions: ['md'] },
					{ name: 'All Files', extensions: ['*'] },
				],
			});
			if (selected) {
				targetPath = selected;
			} else {
				return false; // User cancelled save dialog
			}
		}

		try {
			await invoke('save_file_content', { path: targetPath, content: tab.rawContent });
			if (tab.path === '') {
				// We just saved an untitled tab for the first time
				tabManager.updateTabPath(tab.id, targetPath);
				saveRecentFile(targetPath);
			}
			tab.isDirty = false;
			tab.originalContent = tab.rawContent;
			return true;
		} catch (e) {
			console.error('Failed to save file', e);
			return false;
		}
	}

	async function saveContentAs(): Promise<boolean> {
		const tab = tabManager.activeTab;
		if (!tab) return false;

		const selected = await save({
			filters: [
				{ name: 'Markdown', extensions: ['md'] },
				{ name: 'All Files', extensions: ['*'] },
			],
			defaultPath: tab.path || undefined,
		});

		if (selected) {
			try {
				await invoke('save_file_content', { path: selected, content: tab.rawContent });
				tabManager.updateTabPath(tab.id, selected);
				saveRecentFile(selected);
				tab.isDirty = false;
				tab.originalContent = tab.rawContent;
				return true;
			} catch (e) {
				console.error('Failed to save file as', e);
				return false;
			}
		}
		return false;
	}

	function handleNewFile() {
		tabManager.addNewTab();
		showHome = false;
	}

	async function selectFile() {
		const selected = await open({
			multiple: false,
			filters: [
				{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
				{ name: 'All Files', extensions: ['*'] },
			],
		});
		if (selected && typeof selected === 'string') loadMarkdown(selected);
	}

	function toggleHome() {
		showHome = !showHome;
	}

	async function closeFile() {
		if (tabManager.activeTabId) {
			if (await canCloseTab(tabManager.activeTabId)) {
				tabManager.closeTab(tabManager.activeTabId);
			}
		}
		if (liveMode && tabManager.tabs.length === 0) invoke('unwatch_file').catch(console.error);
	}

	async function openFileLocation() {
		if (currentFile) await invoke('open_file_folder', { path: currentFile });
	}

	async function toggleLiveMode() {
		liveMode = !liveMode;
		if (liveMode && currentFile) {
			await invoke('watch_file', { path: currentFile });
			if (tabManager.activeTabId) await loadMarkdown(currentFile);
		} else {
			await invoke('unwatch_file');
		}
	}

	function handleContextMenu(e: MouseEvent) {
		if (mode !== 'app') return;
		e.preventDefault();

		const selection = window.getSelection();
		const hasSelection = selection ? selection.toString().length > 0 : false;

		docContextMenu = {
			show: true,
			x: e.clientX,
			y: e.clientY,
			items: [
				...(hasSelection ? [{ label: 'Copy', onClick: () => document.execCommand('copy') }] : []),
				{ label: 'Select All', onClick: () => document.execCommand('selectAll') },
				{ separator: true },
				{ label: 'Open File Location', onClick: openFileLocation, disabled: !currentFile },
				{ label: 'Edit', onClick: () => toggleEdit() },
				{ separator: true },
				{ label: 'Close File', onClick: closeFile },
			],
		};
	}

	function handleMouseOver(event: MouseEvent) {
		if (mode !== 'app') return;
		let target = event.target as HTMLElement;
		while (target && target.tagName !== 'A' && target !== document.body) target = target.parentElement as HTMLElement;
		if (target?.tagName === 'A') {
			const anchor = target as HTMLAnchorElement;
			if (anchor.href) {
				const rect = anchor.getBoundingClientRect();
				tooltip = { show: true, text: anchor.href, x: rect.left + rect.width / 2, y: rect.top - 8 };
			}
		}
	}

	function handleMouseOut(event: MouseEvent) {
		let target = event.target as HTMLElement;
		while (target && target.tagName !== 'A' && target !== document.body) target = target.parentElement as HTMLElement;
		if (target?.tagName === 'A') tooltip.show = false;
	}

	async function handleDocumentClick(event: MouseEvent) {
		if (mode !== 'app') return;
		let target = event.target as HTMLElement;
		while (target && target.tagName !== 'A' && target !== document.body) target = target.parentElement as HTMLElement;
		if (target?.tagName === 'A') {
			const anchor = target as HTMLAnchorElement;
			const rawHref = anchor.getAttribute('href');
			if (!rawHref) return;

			if (rawHref.startsWith('#')) return;
			const isMarkdown = ['.md', '.markdown', '.mdown', '.mkd'].some((ext) => {
				const urlNoHash = rawHref.split('#')[0].split('?')[0];
				return urlNoHash.toLowerCase().endsWith(ext);
			});

			if (isMarkdown && !rawHref.match(/^[a-z]+:\/\//i)) {
				event.preventDefault();
				const urlNoHash = rawHref.split('#')[0].split('?')[0];
				const resolved = resolvePath(currentFile, urlNoHash);
				await loadMarkdown(resolved, { navigate: true });
				return;
			}

			if (anchor.href) {
				event.preventDefault();
				await openUrl(anchor.href);
			}
		}
	}

	let zoomLevel = $state(parseInt(localStorage.getItem('zoomLevel') || '100', 10));

	$effect(() => {
		localStorage.setItem('zoomLevel', String(zoomLevel));
	});

	function handleWheel(e: WheelEvent) {
		if (e.ctrlKey || e.metaKey) {
			if (e.deltaY < 0) {
				zoomLevel = Math.min(zoomLevel + 10, 500);
			} else {
				zoomLevel = Math.max(zoomLevel - 10, 25);
			}
		}
	}

	let debounceTimer: number;

	$effect(() => {
		const tab = tabManager.activeTab;
		if (tab && tab.isSplit && tab.rawContent !== undefined) {
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				invoke('render_markdown', { content: tab.rawContent })
					.then((html) => {
						const processed = processMarkdownHtml(html as string, tab.path);
						tabManager.updateTabContent(tab.id, processed);
						tick().then(renderRichContent);
					})
					.catch(console.error);
			}, 16);
		}
	});

	async function toggleSplitView(tabId: string, autoSave = false) {
		const tab = tabManager.tabs.find((t) => t.id === tabId);
		if (!tab) return;

		if (!tab.isSplit) {
			if (!tab.isEditing && !tab.rawContent && tab.path) {
				try {
					const content = (await invoke('read_file_content', { path: tab.path })) as string;
					tab.rawContent = content;
					tab.originalContent = content;
				} catch (e) {
					console.error('Failed to load raw content for split view', e);
				}
			}
			tab.isSplit = true;
			if (liveMode) toggleLiveMode();
		} else {
			if (tab.isDirty && tab.path !== '') {
				if (autoSave) {
					const success = await saveContent();
					if (!success) return;
				} else {
					const response = await askCustom('You have unsaved changes. Do you want to save them before closing split view?', {
						title: 'Unsaved Changes',
						kind: 'warning',
						showSave: true,
					});

					if (response === 'cancel') return;
					if (response === 'save') {
						const success = await saveContent();
						if (!success) return;
					} else if (response === 'discard') {
						tab.rawContent = tab.originalContent;
					}
				}
			}
			tab.isSplit = false;
			if (tab.path !== '') {
				tab.isDirty = false;
				await loadMarkdown(tab.path);
			} else {
			}
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (mode !== 'app') return;

		const cmdOrCtrl = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();
		const code = e.code;

		const isSplit = tabManager.activeTab?.isSplit;

		if (cmdOrCtrl && key === 'w') {
			e.preventDefault();
			closeFile();
		}
		if (cmdOrCtrl && !e.shiftKey && key === 't') {
			e.preventDefault();
			tabManager.addHomeTab();
		}
		if (cmdOrCtrl && key === 'q') {
			e.preventDefault();
			import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
				getCurrentWindow().close();
			});
		}
		if (cmdOrCtrl && key === 'h') {
			e.preventDefault();
			if (tabManager.activeTabId) toggleSplitView(tabManager.activeTabId);
		}
		if (cmdOrCtrl && key === 'e') {
			e.preventDefault();
			if (!isSplit) toggleEdit(true);
		}
		if (cmdOrCtrl && key === 's') {
			if (isEditing || isSplit) {
				e.preventDefault();
				saveContent();
			}
		}

		if (cmdOrCtrl && e.shiftKey && key === 't') {
			e.preventDefault();
			handleUndoCloseTab();
		}
		if (cmdOrCtrl && code === 'Tab') {
			e.preventDefault();
			tabManager.cycleTab(e.shiftKey ? 'prev' : 'next');
		}
		if (cmdOrCtrl && (key === '=' || key === '+')) {
			e.preventDefault();
			zoomLevel = Math.min(zoomLevel + 10, 500);
		}
		if (cmdOrCtrl && key === '-') {
			e.preventDefault();
			zoomLevel = Math.max(zoomLevel - 10, 25);
		}
		if (cmdOrCtrl && key === '0') {
			e.preventDefault();
			zoomLevel = 100;
		}
	}

	function handleMouseUp(e: MouseEvent) {
		if (e.button === 3) {
			// Back
			e.preventDefault();
			if (tabManager.activeTabId) {
				const path = tabManager.goBack(tabManager.activeTabId);
				if (path) loadMarkdown(path, { skipTabManagement: true });
			}
		} else if (e.button === 4) {
			// Forward
			e.preventDefault();
			if (tabManager.activeTabId) {
				const path = tabManager.goForward(tabManager.activeTabId);
				if (path) loadMarkdown(path, { skipTabManagement: true });
			}
		}
	}

	async function handleUndoCloseTab() {
		const path = tabManager.popRecentlyClosed();
		if (path) {
			await loadMarkdown(path);
		}
	}

	async function handleDetach(tabId: string) {
		if (!(await canCloseTab(tabId))) return;
		const tab = tabManager.tabs.find((t) => t.id === tabId);
		if (!tab || !tab.path) return;

		const path = tab.path;
		tabManager.closeTab(tabId);

		const label = 'window-' + Date.now();
		const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
		const webview = new WebviewWindow(label, {
			url: 'index.html?file=' + encodeURIComponent(path),
			title: 'Markpad - ' + path.split(/[/\\]/).pop(),
			width: 1000,
			height: 800,
		});
	}

	function startDrag(e: MouseEvent, tabId: string | null) {
		if (!tabId) return;
		e.preventDefault();
		const startX = e.clientX;
		const tab = tabManager.tabs.find((t) => t.id === tabId);
		if (!tab) return;

		const startRatio = tab.splitRatio ?? 0.5;
		const containerWidth = window.innerWidth;

		const onMove = (moveEvent: MouseEvent) => {
			const deltaX = moveEvent.clientX - startX;
			const deltaRatio = deltaX / containerWidth;
			tabManager.setSplitRatio(tabId, startRatio + deltaRatio);
		};

		const onUp = () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			document.body.style.cursor = '';
		};

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		document.body.style.cursor = 'col-resize';
	}

	function getSplitTransition(node: Element, { isEditing, side }: { isEditing: boolean; side: 'left' | 'right' }) {
		let shouldAnimate = false;
		let x = 0;

		if (side === 'left') {
			if (!isEditing) {
				shouldAnimate = true;
				x = -50;
			}
		} else {
			if (isEditing) {
				shouldAnimate = true;
				x = 50;
			}
		}

		if (shouldAnimate) {
			return fly(node, { x, duration: 250 });
		}
		return { duration: 0 };
	}

	onMount(() => {
		loadRecentFiles();

		// @ts-ignore
		Promise.all([import('highlight.js'), import('katex/dist/contrib/auto-render'), import('mermaid')]).then(([hljsModule, katexModule, mermaidModule]) => {
			hljs = hljsModule.default;
			renderMathInElement = katexModule.default;
			mermaid = mermaidModule.default;
		});

		let unlisteners: (() => void)[] = [];

		invoke('show_window').catch(console.error);

		const init = async () => {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			const appWindow = getCurrentWindow();
			const appMode = (await invoke('get_app_mode')) as any;

			const urlParams = new URLSearchParams(window.location.search);
			const fileParam = urlParams.get('file');
			if (fileParam) {
				const decodedPath = decodeURIComponent(fileParam);
				await loadMarkdown(decodedPath);
			}

			unlisteners.push(
				await appWindow.onFocusChanged(({ payload: focused }) => {
					isFocused = focused;
				}),
			);
			unlisteners.push(
				await listen('file-changed', () => {
					if (liveMode && currentFile) loadMarkdown(currentFile);
				}),
			);

			unlisteners.push(
				await listen('file-path', (event) => {
					const filePath = event.payload as string;
					if (filePath) loadMarkdown(filePath);
				}),
			);
			unlisteners.push(
				await listen('menu-close-file', () => {
					closeFile();
				}),
			);
			unlisteners.push(
				await listen('menu-edit-file', () => {
					toggleEdit();
				}),
			);
			unlisteners.push(
				await listen('menu-tab-rename', async (event) => {
					const tabId = event.payload as string;
					const tab = tabManager.tabs.find((t) => t.id === tabId);
					if (!tab || !tab.path) return;

					const newName = window.prompt('Rename file:', tab.title);
					if (newName && newName !== tab.title) {
						const oldPath = tab.path;
						const newPath = oldPath.replace(/[/\\][^/\\]+$/, (m) => m.charAt(0) + newName);
						try {
							await invoke('rename_file', { oldPath, newPath });
							tabManager.renameTab(tabId, newPath);
							// Update recent files if needed
							recentFiles = recentFiles.map((f) => (f === oldPath ? newPath : f));
							localStorage.setItem('recent-files', JSON.stringify(recentFiles));
						} catch (e) {
							console.error('Failed to rename file', e);
							await askCustom(`Failed to rename file: ${e}`, { title: 'Error', kind: 'error' });
						}
					}
				}),
			);
			unlisteners.push(
				await listen('menu-tab-new', () => {
					tabManager.addNewTab();
				}),
			);
			unlisteners.push(
				await listen('menu-tab-undo', () => {
					console.log('Received menu-tab-undo event');
					handleUndoCloseTab();
				}),
			);
			unlisteners.push(
				await listen('menu-tab-close', async (event) => {
					const tabId = event.payload as string;
					if (await canCloseTab(tabId)) {
						tabManager.closeTab(tabId);
					}
				}),
			);
			unlisteners.push(
				await listen('menu-tab-close-others', (event) => {
					const tabId = event.payload as string;
					const tabsToClose = tabManager.tabs.filter((t) => t.id !== tabId).map((t) => t.id);
					tabsToClose.forEach((id) => tabManager.closeTab(id));
				}),
			);
			unlisteners.push(
				await listen('menu-tab-close-right', (event) => {
					const tabId = event.payload as string;
					const index = tabManager.tabs.findIndex((t) => t.id === tabId);
					if (index !== -1) {
						const tabsToClose = tabManager.tabs.slice(index + 1).map((t) => t.id);
						tabsToClose.forEach((id) => tabManager.closeTab(id));
					}
				}),
			);
			unlisteners.push(
				await appWindow.onCloseRequested(async (event) => {
					console.log('onCloseRequested triggered');
					const dirtyTabs = tabManager.tabs.filter((t) => t.isDirty);
					console.log('Dirty tabs:', dirtyTabs.length);
					if (dirtyTabs.length > 0) {
						console.log('Preventing default close');
						event.preventDefault();
						const response = await askCustom(`You have ${dirtyTabs.length} unsaved file(s). Do you want to save your changes?`, {
							title: 'Unsaved Changes',
							kind: 'warning',
							showSave: true,
						});

						if (response === 'save') {
							// Attempt to save all dirty tabs
							for (const tab of dirtyTabs) {
								tabManager.setActive(tab.id);
								await tick();
								const saved = await saveContent();
								if (!saved) return; // Cancelled or failed
							}
							// If all saved successfully, close the app
							appWindow.close();
						} else if (response === 'discard') {
							// Force close by removing this listener or skipping check?
							// Since we are inside the event handler, we can't easily remove "this" listener specifically
							// without refactoring how unlisteners are stored/accessed relative to this callback.
							// However, if we just want to exit, we can use exit() from rust or just appWindow.destroy()?
							// WebviewWindow.close() triggers this event again.
							// Solution: invoke a command to exit forcefully or set a flag.
							// The simplest might be to just clear the dirty flags and close.
							tabManager.tabs.forEach((t) => (t.isDirty = false));
							appWindow.close();
						}
					}
				}),
			);

			unlisteners.push(
				await appWindow.onDragDropEvent((event) => {
					if (isEditing) {
						isDragging = false;
						return;
					}

					if (event.payload.type === 'enter' || event.payload.type === 'over') {
						isDragging = true;
					} else if (event.payload.type === 'drop') {
						isDragging = false;
						event.payload.paths.forEach((path) => loadMarkdown(path));
					} else {
						isDragging = false;
					}
				}),
			);

			try {
				const args: string[] = await invoke('send_markdown_path');
				if (args?.length > 0) {
					await loadMarkdown(args[0]);
				}
			} catch (error) {
				console.error('Error receiving Markdown file path:', error);
			}

			mode = appMode;
		};

		init();

		return () => {
			unlisteners.forEach((u) => u());
		};
	});
</script>

<svelte:document
	onclick={handleDocumentClick}
	oncontextmenu={handleContextMenu}
	onmouseover={handleMouseOver}
	onmouseout={handleMouseOut}
	onkeydown={handleKeyDown}
	onmouseup={handleMouseUp} />

{#if mode === 'loading'}
	<TitleBar
		{isFocused}
		isScrolled={false}
		currentFile={''}
		{liveMode}
		windowTitle="Markpad"
		showHome={false}
		{zoomLevel}
		onselectFile={selectFile}
		onnewFile={handleNewFile}
		onopenFile={selectFile}
		onsaveFile={saveContent}
		onsaveFileAs={saveContentAs}
		onexit={() => {
			appWindow.close();
		}}
		ontoggleHome={toggleHome}
		ononpenFileLocation={openFileLocation}
		ontoggleLiveMode={toggleLiveMode}
		ontoggleEdit={() => toggleEdit()}
		ontoggleSplit={() => tabManager.activeTabId && toggleSplitView(tabManager.activeTabId)}
		{isEditing}
		ondetach={handleDetach}
		ontabclick={() => (showHome = false)}
		onresetZoom={() => (zoomLevel = 100)}
		{isFullWidth}
		ontoggleFullWidth={() => (isFullWidth = !isFullWidth)}
		{theme}
		onSetTheme={(t) => (theme = t)}
		onopenSettings={() => (showSettings = true)}
		oncloseTab={(id) => {
			canCloseTab(id).then((can) => {
				if (can) tabManager.closeTab(id);
			});
		}} />
	<div class="loading-screen">
		<svg class="spinner" viewBox="0 0 50 50">
			<circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
		</svg>
	</div>
{:else if mode === 'installer'}
	<Installer />
{:else if mode === 'uninstall'}
	<Uninstaller />
{:else}
	<TitleBar
		{isFocused}
		{isScrolled}
		{currentFile}
		{liveMode}
		{windowTitle}
		{showHome}
		{zoomLevel}
		onselectFile={selectFile}
		onnewFile={handleNewFile}
		onopenFile={selectFile}
		onsaveFile={saveContent}
		onsaveFileAs={saveContentAs}
		onexit={() => {
			appWindow.close();
		}}
		ontoggleHome={toggleHome}
		ononpenFileLocation={openFileLocation}
		ontoggleLiveMode={toggleLiveMode}
		ontoggleEdit={() => toggleEdit()}
		ontoggleSplit={() => tabManager.activeTabId && toggleSplitView(tabManager.activeTabId)}
		{isEditing}
		ondetach={handleDetach}
		ontabclick={() => (showHome = false)}
		onresetZoom={() => (zoomLevel = 100)}
		{isScrollSynced}
		ontoggleSync={() => tabManager.activeTabId && tabManager.toggleScrollSync(tabManager.activeTabId)}
		{isFullWidth}
		ontoggleFullWidth={() => (isFullWidth = !isFullWidth)}
		{theme}
		onSetTheme={(t) => (theme = t)}
		onopenSettings={() => (showSettings = true)}
		oncloseTab={(id) => {
			canCloseTab(id).then((can) => {
				if (can) tabManager.closeTab(id);
			});
		}} />

	<Settings show={showSettings} {theme} onSetTheme={(t) => (theme = t)} onclose={() => (showSettings = false)} />

	{#if tabManager.activeTab && (tabManager.activeTab.path !== '' || tabManager.activeTab.title !== 'Recents') && !showHome}
		{#key tabManager.activeTabId}
			<div
				class="markdown-container"
				style="zoom: {isEditing && !isSplit ? 1 : zoomLevel / 100}; --code-font: {settings.codeFont}, monospace; --code-font-size: {settings.codeFontSize}px"
				onwheel={handleWheel}
				role="presentation">
				<div class="layout-container" class:split={isSplit} class:editing={isEditing}>
					<!-- Editor Pane -->
					<div class="pane editor-pane" class:active={isEditing || isSplit} style="flex: {isSplit ? tabManager.activeTab.splitRatio : isEditing ? 1 : 0}">
						{#if isEditing || isSplit}
							<Editor
								bind:this={editorPane}
								bind:value={tabManager.activeTab.rawContent}
								language={editorLanguage}
								{theme}
								onsave={saveContent}
								bind:zoomLevel
								onnew={handleNewFile}
								onopen={selectFile}
								onclose={closeFile}
								onreveal={openFileLocation}
								ontoggleEdit={() => toggleEdit()}
								ontoggleLive={toggleLiveMode}
								onhome={() => (showHome = true)}
								onnextTab={() => tabManager.cycleTab('next')}
								onprevTab={() => tabManager.cycleTab('prev')}
								onundoClose={handleUndoCloseTab}
								onscrollsync={handleEditorScrollSync} />
						{/if}
					</div>

					<!-- Splitter -->
					{#if isSplit}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div class="split-bar" onmousedown={(e) => startDrag(e, tabManager.activeTabId)} role="separator" aria-orientation="vertical" tabindex="0"></div>
					{/if}

					<!-- Viewer Pane -->
					<div class="pane viewer-pane" class:active={!isEditing || isSplit} style="flex: {isSplit ? 1 - tabManager.activeTab.splitRatio : !isEditing ? 1 : 0}">
						<article
							bind:this={markdownBody}
							contenteditable="false"
							class="markdown-body {isFullWidth ? 'full-width' : ''}"
							bind:innerHTML={htmlContent}
							onscroll={handleScroll}
							tabindex="-1"
							style="outline: none; font-family: {settings.previewFont}, sans-serif; font-size: {settings.previewFontSize}px;">
						</article>
					</div>
				</div>
			</div>
		{/key}
	{:else}
		<HomePage {recentFiles} onselectFile={selectFile} onloadFile={loadMarkdown} onremoveRecentFile={removeRecentFile} onnewFile={handleNewFile} />
	{/if}

	{#if tooltip.show}
		<div class="tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
			{tooltip.text}
		</div>
	{/if}

	<Modal
		show={modalState.show}
		title={modalState.title}
		message={modalState.message}
		kind={modalState.kind}
		showSave={modalState.showSave}
		onconfirm={handleModalConfirm}
		onsave={handleModalSave}
		oncancel={handleModalCancel} />

	{#if isDragging && !isEditing}
		<div class="drag-overlay" role="presentation">
			<div class="drag-message">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="48"
					height="48"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
					<polyline points="17 8 12 3 7 8" />
					<line x1="12" y1="3" x2="12" y2="15" />
				</svg>
				<span>Drop to open Markdown files</span>
			</div>
		</div>
	{/if}
{/if}

<ContextMenu {...docContextMenu} onhide={() => (docContextMenu.show = false)} />

<style>
	:root {
		--animation: cubic-bezier(0.05, 0.95, 0.05, 0.95);
		scroll-behavior: smooth !important;
		background-color: var(--color-canvas-default);
	}

	:global(body) {
		background-color: var(--color-canvas-default);
		margin: 0;
		padding: 0;
		color: var(--color-fg-default);
		overflow: hidden;
	}

	.markdown-body {
		box-sizing: border-box;
		min-width: 200px;
		margin: 0;
		padding: 50px clamp(calc(calc(50% - 390px)), 5vw, 50px);
		height: 100%;
		overflow-y: auto;
		transform: translate3d(0, 0, 0);
	}

	.markdown-container :global(.markdown-body pre),
	.markdown-container :global(.markdown-body pre code),
	.markdown-container :global(.markdown-body pre tt),
	.markdown-container :global(.markdown-body code) {
		font-family: var(--code-font, Consolas, monospace) !important;
		font-size: var(--code-font-size, 14px) !important;
	}

	.markdown-body.full-width {
		padding: 50px;
		max-width: 100%;
	}

	.caret-indicator {
		position: absolute;
		height: 2px;
		background-color: #0078d4;
		width: 100%;
		left: 0;
		right: 0;
		pointer-events: none;
		z-index: 100;
		opacity: 0.8;
		transform: translateY(2px); /* visual adjustment */
	}

	/* Disable animation in split view to prevent jumpiness */
	.split-view .markdown-body {
		animation: none;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	:global(.video-container) {
		position: relative;
		padding-bottom: 56.25%;
		height: 0;
		overflow: hidden;
		max-width: 100%;
		margin: 1em 0;
	}

	:global(.video-container iframe) {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		border-radius: 8px;
	}

	:global(.mermaid-diagram) {
		margin: 1em 0;
		display: flex;
		justify-content: center;
		overflow-x: auto;
	}

	:global(.mermaid-diagram svg) {
		max-width: 100%;
		height: auto;
	}

	.tooltip {
		position: fixed;
		background: var(--color-canvas-default);
		color: var(--color-fg-default);
		padding: 6px 10px;
		border-radius: 4px;
		font-size: 12px;
		pointer-events: none;
		z-index: 10000;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		border: 1px solid var(--color-border-default);
		font-family: var(--win-font);
		white-space: nowrap;
		max-width: 400px;
		overflow: hidden;
		text-overflow: ellipsis;
		transform: translate(-50%, -100%);
		transition: opacity 0.15s ease-out;
		opacity: 1;
	}

	.tooltip::after {
		content: '';
		position: absolute;
		bottom: -6px;
		left: 50%;
		transform: translateX(-50%);
		border-left: 6px solid transparent;
		border-right: 6px solid transparent;
		border-top: 6px solid var(--color-canvas-default);
	}

	.editor-wrapper {
		width: 100%;
		height: 100%;
		position: absolute;
		top: 0;
		left: 0;
		padding-top: 36px;
		box-sizing: border-box;
	}

	.drag-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 120, 212, 0.15);
		backdrop-filter: blur(4px);
		border: 3px dashed #0078d4;
		margin: 12px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 40000;
		pointer-events: none;
		animation: fadeIn 0.15s ease-out;
	}

	.drag-message {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		color: #0078d4;
		font-family: var(--win-font);
		font-weight: 500;
		font-size: 18px;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: scale(0.98);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.loading-screen {
		position: fixed;
		top: 36px;
		left: 0;
		width: 100%;
		height: calc(100% - 36px);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-canvas-default);
		z-index: 5000;
	}

	.spinner {
		animation: rotate 2s linear infinite;
		z-index: 2;
		width: 50px;
		height: 50px;
	}

	.spinner .path {
		stroke: var(--color-accent-fg);
		stroke-linecap: round;
		animation: dash 1.5s ease-in-out infinite;
	}

	@keyframes rotate {
		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes dash {
		0% {
			stroke-dasharray: 1, 150;
			stroke-dashoffset: 0;
		}
		50% {
			stroke-dasharray: 90, 150;
			stroke-dashoffset: -35;
		}
		100% {
			stroke-dasharray: 90, 150;
			stroke-dashoffset: -124;
		}
	}
	/* Layout System */
	.layout-container {
		display: flex;
		width: 100%;
		height: 100%;
		position: absolute;
		top: 0;
		left: 0;
		padding-top: 36px;
		box-sizing: border-box;
		overflow: hidden;
	}

	.pane {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		transition:
			flex 0.3s cubic-bezier(0.16, 1, 0.3, 1),
			transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		min-width: 0;
	}

	.pane.editor-pane {
		background: var(--color-canvas-default);
	}

	.pane.viewer-pane {
		background: var(--color-canvas-default);
	}

	/* View Mode */
	.layout-container:not(.split):not(.editing) .editor-pane {
		width: 0 !important;
		flex: 0 !important;
		opacity: 0;
	}

	.layout-container:not(.split):not(.editing) .viewer-pane {
		width: 100%;
		flex: 1 !important;
	}

	/* Edit Mode */
	.layout-container:not(.split).editing .editor-pane {
		width: 100%;
		flex: 1 !important;
	}

	.layout-container:not(.split).editing .viewer-pane {
		width: 0 !important;
		flex: 0 !important;
		opacity: 0;
	}

	/* Split Mode Transition Logic */
	/* Editor slides in from left */
	/* Viewer slides right */

	.pane {
		height: 100%;
		position: relative;
	}

	.split-bar {
		width: 4px;
		background: var(--color-border-default);
		cursor: col-resize;
		position: relative;
		z-index: 100;
		transition: background 0.2s;
	}

	.split-bar:hover {
		background: var(--color-accent-fg);
	}

	.editor-wrapper {
		/* Legacy mapping */
		width: 100%;
		height: 100%;
	}
</style>
