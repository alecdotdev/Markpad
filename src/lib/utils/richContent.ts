import DOMPurify from 'dompurify';
import { rememberDiagramSource } from './mermaidPrint.js';

/**
 * The one implementation of "turn rendered Markdown into the thing the user
 * actually wants to look at": syntax highlighting, KaTeX, Mermaid diagrams.
 *
 * It used to live inside `MarkdownViewer.svelte`, closed over the component's
 * lazily imported libraries and the live preview element, and could therefore
 * only ever run on screen. The HTML export ran the same
 * `render_markdown → sanitize → processMarkdownHtml` pipeline and then stopped,
 * so an exported document arrived with `E = mc^2` as literal LaTeX, code blocks
 * with no highlighting, and diagrams as `<pre><code class="language-mermaid">`
 * source. The thing the export exists for — handing the document to somebody
 * who does not have Markpad — was exactly the case that got the raw text.
 *
 * There was a second copy of this in `markdown.ts` once. It drifted (it had
 * lost `rememberDiagramSource`, which the PDF path needs) and was deleted in
 * #397. So the fix is not another copy: it is this module, which the preview and
 * the export both call, on a live element and on a detached one respectively.
 * Nothing here reaches for a global element or a global document — everything
 * comes from `root` — because a detached `<div>` is a first-class caller.
 */

export interface RichContentLibraries {
	hljs: any;
	katex: any;
	renderMathInElement: any;
	mermaid: any;
}

let librariesPromise: Promise<RichContentLibraries> | null = null;

/**
 * Loads highlight.js, KaTeX and Mermaid once per window.
 *
 * The preview kicks this off on mount; the export awaits the same promise, so
 * an export never pays for a second copy and — more to the point — cannot end
 * up with a differently configured KaTeX or a different highlight.js language
 * registry than the preview the user was just looking at.
 */
export function loadRichContentLibraries(): Promise<RichContentLibraries> {
	if (librariesPromise) return librariesPromise;
	librariesPromise = (async () => {
		const [hljsModule, svelteModule, katexMainModule, mermaidModule] = await Promise.all([
			import('highlight.js'),
			import('highlightjs-svelte'),
			import('katex'),
			import('mermaid'),
		]);

		const hljs = (hljsModule as any).default;
		try {
			(svelteModule as any).default(hljs);
		} catch (e) {
			console.error('svelte hljs error', e);
		}

		const katex = (katexMainModule as any).default;
		// mhchem and copy-tex are KaTeX extensions that bind to the global.
		(window as any).katex = katex;

		const [autoRenderModule] = await Promise.all([
			import('katex/dist/contrib/auto-render.js'),
			import('katex/dist/contrib/mhchem.js'),
			import('katex/dist/contrib/copy-tex.js'),
		]);

		return {
			hljs,
			katex,
			renderMathInElement: (autoRenderModule as any).default,
			mermaid: (mermaidModule as any).default,
		};
	})().catch((error) => {
		// A failed load must not be cached as a permanent failure: the preview
		// retries on the next render, and the export falls back to shipping the
		// unrendered block rather than nothing at all.
		librariesPromise = null;
		throw error;
	});
	return librariesPromise;
}

/**
 * Mermaid puts diagram text inside `foreignObject` and ships the diagram's
 * colours as a `<style>` element inside the SVG, so diagrams need a more
 * permissive filter than the document-level `MARKDOWN_SANITIZE_CONFIG` (which
 * forbids `<style>` outright). Keeping the two policies distinct — and this one
 * in one place — is what stops a document author's `<style>` from being let
 * through by the back door: this filter is only ever applied to a string
 * Mermaid produced, never to the document.
 *
 * On why that `<style>` is acceptable inside an exported file, see
 * `renderExportRichContent` in `export.ts`.
 */
export function sanitizeDiagramSvg(svg: string): string {
	return DOMPurify.sanitize(svg, {
		ADD_TAGS: ['foreignObject'],
		ADD_ATTR: ['dominant-baseline', 'text-anchor'],
	});
}

export interface RenderRichContentOptions {
	/** The element holding processed Markdown. Live or detached, both work. */
	root: HTMLElement;
	libraries: RichContentLibraries;
	/** Mermaid's own theme name, from `resolveMermaidTheme`. */
	mermaidTheme: string;
	/**
	 * Wires the language label up as a copy button. Omitted by the export: an
	 * exported file cannot run script at all (its policy grants no script
	 * privilege), so a handler there would be a button that does nothing.
	 */
	onCopyCode?: (code: string, label: HTMLElement) => void;
	/** Injected so diagram ids are deterministic under test. */
	idFactory?: (index: number) => string;
	onError?: (error: unknown) => void;
}

function defaultIdFactory(index: number): string {
	return `mermaid-${Date.now()}-${index}-${Math.floor(Math.random() * 10000)}`;
}

const COPY_ICON_SVG =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

export async function renderRichContent(options: RenderRichContentOptions): Promise<void> {
	const { root, libraries } = options;
	if (!root) return;

	const { hljs, katex, renderMathInElement, mermaid } = libraries;
	if (!hljs || !renderMathInElement || !mermaid) return;

	const doc = root.ownerDocument ?? document;
	const idFactory = options.idFactory ?? defaultIdFactory;

	mermaid.initialize({ startOnLoad: false, theme: options.mermaidTheme });

	const codeBlocks = Array.from(root.querySelectorAll('pre code'));
	let diagramIndex = 0;
	for (const block of codeBlocks) {
		const codeEl = block as HTMLElement;
		const preEl = codeEl.parentElement as HTMLPreElement;

		if (codeEl.classList.contains('language-mermaid')) {
			const mermaidCode = codeEl.textContent || '';
			try {
				const { svg } = await mermaid.render(idFactory(diagramIndex++), mermaidCode);

				const container = doc.createElement('div');
				container.className = 'mermaid-diagram';
				// Kept so the PDF path can rebuild the diagram with a light theme
				// instead of recolouring Mermaid's output.
				rememberDiagramSource(container, mermaidCode);
				container.innerHTML = sanitizeDiagramSvg(svg);
				preEl.replaceWith(container);
			} catch (error) {
				options.onError?.(error);
				console.error('Failed to render Mermaid diagram:', error);
				const errorDiv = doc.createElement('div');
				errorDiv.className = 'mermaid-error';
				errorDiv.style.color = 'red';
				errorDiv.style.padding = '1em';
				errorDiv.textContent = `Error rendering Mermaid diagram: ${error}`;
				preEl.replaceWith(errorDiv);
			}
			continue; // Skip highlight.js for this block
		}

		// Check if language was explicitly specified BEFORE highlight.js runs
		const hasExplicitLang = Array.from(codeEl.classList).some((c) => c.startsWith('language-'));

		// Only highlight if explicit language is specified
		if (hasExplicitLang) {
			try {
				hljs.highlightElement(codeEl);
			} catch (error) {
				options.onError?.(error);
				console.error('Failed to highlight code block:', error);
			}
		}

		const langClass = Array.from(codeEl.classList).find((c) => c.startsWith('language-'));

		if (preEl && preEl.tagName === 'PRE') {
			preEl.querySelectorAll('.lang-label').forEach((l) => l.remove());
			const codeContent = codeEl.textContent || '';
			const existingWrapper = preEl.parentElement?.classList.contains('code-block-shell')
				? (preEl.parentElement as HTMLDivElement)
				: null;
			existingWrapper?.querySelectorAll(':scope > .lang-label').forEach((l) => l.remove());

			const wrapper = existingWrapper ?? doc.createElement('div');
			if (!existingWrapper) {
				wrapper.className = 'code-block-shell';
				preEl.replaceWith(wrapper);
				wrapper.appendChild(preEl);
			}

			const label = doc.createElement('button');
			label.className = 'lang-label';
			label.title = 'Click to copy code';
			const onCopyCode = options.onCopyCode;
			if (onCopyCode) label.onclick = () => onCopyCode(codeContent, label);

			if (hasExplicitLang && langClass) {
				label.textContent = langClass.replace('language-', '');
			} else {
				label.innerHTML = COPY_ICON_SVG;
			}
			wrapper.appendChild(label);
		}
	}

	// KaTeX math rendering
	if (katex) {
		const mathElements = root.querySelectorAll('[data-math]');
		for (const el of Array.from(mathElements)) {
			const isDisplay = el.getAttribute('data-math') === 'display';
			const mathSource = el.getAttribute('data-math-source') || el.textContent || '';
			try {
				katex.render(mathSource, el as HTMLElement, {
					displayMode: isDisplay,
					throwOnError: false,
				});
			} catch (e) {
				options.onError?.(e);
				console.error('KaTeX rendering error:', e);
			}
		}
	}

	if (renderMathInElement) {
		renderMathInElement(root, {
			delimiters: [
				{ left: '$$', right: '$$', display: true },
				{ left: '\\(', right: '\\)', display: false },
				{ left: '\\[', right: '\\]', display: true },
			],
			throwOnError: false,
		});
	}
}
