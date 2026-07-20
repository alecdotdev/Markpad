<script lang="ts">
	import { fly } from 'svelte/transition';
	import { tick } from 'svelte';
	import { t } from '../utils/i18n.js';
	import type { LanguageCode } from '../utils/i18n.js';

	let {
		open = $bindable(false),
		markdownBody,
		language = 'en' as LanguageCode,
	} = $props<{
		open: boolean;
		markdownBody: HTMLElement | null;
		language?: LanguageCode;
	}>();

	const FIND_MARK_CLASS = 'markpad-find-match';
	const FIND_MARK_ACTIVE_CLASS = 'active';
	const MAX_MATCHES = 5000;
	const DEBOUNCE_MS = 80;

	let inputEl = $state<HTMLInputElement>();
	let query = $state('');
	let caseSensitive = $state(false);
	let wholeWord = $state(false);
	let matchCount = $state(0);
	let activeIndex = $state(-1);
	let truncated = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingActiveRange: Range | null = null;
	let pendingActiveTop: number | null = null;
	let pendingActiveIndex: number | null = null;
	let appliedQuery = '';

	function isHostElement(el: Element | null): boolean {
		if (!el) return false;
		// Skip elements whose text is not user-visible (script/style/noscript)
		// and our own find marks (to avoid re-walking already-highlighted text).
		// CODE and PRE intentionally NOT skipped: code blocks contain real
		// content the user expects to be searchable, even when highlight.js
		// has wrapped tokens in nested <span>s.
		const tag = el.tagName;
		return (
			tag === 'SCRIPT' ||
			tag === 'STYLE' ||
			tag === 'NOSCRIPT' ||
			el.classList.contains(FIND_MARK_CLASS)
		);
	}

	function isInsideHost(node: Node, root: Element): boolean {
		let curr: Node | null = node.parentNode;
		while (curr && curr !== root) {
			if (curr.nodeType === Node.ELEMENT_NODE && isHostElement(curr as Element)) return true;
			curr = curr.parentNode;
		}
		return false;
	}

	export function clearHighlights() {
		const root = markdownBody as HTMLElement | null;
		if (!root) return;
		const marks = Array.from(
			root.querySelectorAll(`mark.${FIND_MARK_CLASS}`),
		) as HTMLElement[];
		for (const mark of marks) {
			const parent = mark.parentNode;
			if (!parent) continue;
			while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
			parent.removeChild(mark);
			parent.normalize();
		}
	}

	function findInTextNode(text: string, needle: string): number[] {
		// returns array of start indices for non-overlapping matches
		const indices: number[] = [];
		if (!needle) return indices;
		const haystack = caseSensitive ? text : text.toLowerCase();
		const search = caseSensitive ? needle : needle.toLowerCase();
		let from = 0;
		while (from <= haystack.length - search.length) {
			const i = haystack.indexOf(search, from);
			if (i === -1) break;
			if (wholeWord) {
				const before = i === 0 ? '' : haystack.charAt(i - 1);
				const after = haystack.charAt(i + search.length);
				const isBoundary = (c: string) => c === '' || !/[\p{L}\p{N}_]/u.test(c);
				if (!isBoundary(before) || !isBoundary(after)) {
					from = i + 1;
					continue;
				}
			}
			indices.push(i);
			from = i + search.length;
		}
		return indices;
	}

	function matchesRange(range: Range, textNode: Text, index: number): boolean {
		const doc = textNode.ownerDocument || document;
		const matchRange = doc.createRange();
		try {
			matchRange.setStart(textNode, index);
			matchRange.setEnd(textNode, index + query.length);
			return range.compareBoundaryPoints(Range.START_TO_END, matchRange) > 0
				&& range.compareBoundaryPoints(Range.END_TO_START, matchRange) < 0;
		} catch {
			return false;
		} finally {
			matchRange.detach();
		}
	}

	function getRangeMatchIndex(range: Range): number | null {
		const root = markdownBody;
		if (!root || !query) return null;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode(node: Node) {
				const text = (node as Text).nodeValue;
				if (!text || isInsideHost(node, root)) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		let total = 0;
		let textNode = walker.nextNode() as Text | null;
		while (textNode) {
			for (const index of findInTextNode(textNode.nodeValue || '', query)) {
				if (total >= MAX_MATCHES) return null;
				if (matchesRange(range, textNode, index)) return total;
				total++;
			}
			textNode = walker.nextNode() as Text | null;
		}
		return null;
	}

	function getRangeTop(range: Range): number | null {
		const rect = range.getBoundingClientRect();
		if (rect.height > 0 || rect.width > 0) return rect.top;
		const firstRect = range.getClientRects()[0];
		return firstRect ? firstRect.top : null;
	}

	function getClosestMarkIndex(top: number): number | null {
		const marks = getMarks();
		if (marks.length === 0) return null;
		let closestIndex = 0;
		let closestDistance = Number.POSITIVE_INFINITY;
		for (const [index, mark] of marks.entries()) {
			const distance = Math.abs(mark.getBoundingClientRect().top - top);
			if (distance < closestDistance) {
				closestIndex = index;
				closestDistance = distance;
			}
		}
		return closestIndex;
	}

	function applyHighlights(options: { preserveScroll?: boolean; preferredActiveIndex?: number | null } = {}) {
		if (!markdownBody) {
			matchCount = 0;
			activeIndex = -1;
			truncated = false;
			return;
		}
		clearHighlights();
		if (!query) {
			matchCount = 0;
			activeIndex = -1;
			truncated = false;
			appliedQuery = '';
			return;
		}

		const root = markdownBody;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode(node: Node) {
				const text = (node as Text).nodeValue;
				if (!text) return NodeFilter.FILTER_REJECT;
				if (isInsideHost(node, root)) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});

		let total = 0;
		let hitCap = false;
		let requestedActiveIndex = pendingActiveIndex;
		const shouldPreserveScroll = pendingActiveRange !== null;
		const requestedTop = pendingActiveTop;

		// Walk and process in a single pass. We advance the walker BEFORE
		// mutating each text node so its internal currentNode never points
		// at a detached node — replaceChild on the previous text node would
		// otherwise leave the walker in an undefined state.
		let textNode = walker.nextNode() as Text | null;
		while (textNode) {
			const next = walker.nextNode() as Text | null;

			const text = textNode.nodeValue || '';
			const indices = findInTextNode(text, query);
			if (indices.length > 0) {
				const parent = textNode.parentNode;
				if (parent) {
					const doc = textNode.ownerDocument || document;
					const frag = doc.createDocumentFragment();
					let cursor = 0;
					let breakOut = false;
					for (const i of indices) {
						if (total >= MAX_MATCHES) {
							hitCap = true;
							breakOut = true;
							break;
						}
						if (requestedActiveIndex === null && pendingActiveRange && matchesRange(pendingActiveRange, textNode, i)) {
							requestedActiveIndex = total;
						}
						if (i > cursor) frag.appendChild(doc.createTextNode(text.slice(cursor, i)));
						const mark = doc.createElement('mark');
						mark.className = FIND_MARK_CLASS;
						mark.textContent = text.slice(i, i + query.length);
						frag.appendChild(mark);
						cursor = i + query.length;
						total++;
					}
					if (cursor < text.length) frag.appendChild(doc.createTextNode(text.slice(cursor)));
					parent.replaceChild(frag, textNode);
					if (breakOut) break;
				}
			}
			textNode = next;
		}

		pendingActiveRange = null;
		pendingActiveTop = null;
		pendingActiveIndex = null;
		matchCount = total;
		truncated = hitCap;
		appliedQuery = query;
		if (total === 0) {
			activeIndex = -1;
		} else {
			const closestActiveIndex = requestedTop === null ? null : getClosestMarkIndex(requestedTop);
			const preferredActiveIndex =
				options.preferredActiveIndex !== null
				&& options.preferredActiveIndex !== undefined
				&& options.preferredActiveIndex >= 0
				&& options.preferredActiveIndex < total
					? options.preferredActiveIndex
					: null;
			const nextActiveIndex = requestedActiveIndex ?? closestActiveIndex ?? preferredActiveIndex ?? 0;
			activeIndex = nextActiveIndex;
			setActive(nextActiveIndex, !shouldPreserveScroll && !options.preserveScroll);
		}
	}

	function getMarks(): HTMLElement[] {
		const root = markdownBody as HTMLElement | null;
		if (!root) return [];
		return Array.from(
			root.querySelectorAll(`mark.${FIND_MARK_CLASS}`),
		) as HTMLElement[];
	}

	function setActive(index: number, scroll: boolean = true) {
		const marks = getMarks();
		if (marks.length === 0) {
			activeIndex = -1;
			return;
		}
		const safe = ((index % marks.length) + marks.length) % marks.length;
		marks.forEach((m, i) => m.classList.toggle(FIND_MARK_ACTIVE_CLASS, i === safe));
		activeIndex = safe;
		if (scroll) {
			marks[safe].scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	}

	export function next() {
		if (matchCount === 0) return;
		setActive(activeIndex + 1);
	}

	export function prev() {
		if (matchCount === 0) return;
		setActive(activeIndex - 1);
	}

	function cancelPendingApply() {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
	}

	function scheduleApply() {
		cancelPendingApply();
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			// Guard against a stale timer firing after the bar has closed
			// (e.g. parent flips `open` to false on tab switch without
			// going through close()).
			if (!open) return;
			applyHighlights({ preferredActiveIndex: appliedQuery === query ? activeIndex : null });
		}, DEBOUNCE_MS);
	}

	export function reapply() {
		// Public hook for parent: call after the preview HTML is replaced
		// so existing matches survive across re-renders.
		applyHighlights({ preserveScroll: true, preferredActiveIndex: activeIndex });
	}

	function focusInput() {
		tick().then(() => {
			inputEl?.focus();
			inputEl?.select();
		});
	}

	export function focus() {
		focusInput();
	}

	export function setQuery(value: string, activeRange?: Range | null) {
		pendingActiveRange = activeRange ? activeRange.cloneRange() : null;
		pendingActiveTop = activeRange ? getRangeTop(activeRange) : null;
		query = value;
		pendingActiveIndex = activeRange ? getRangeMatchIndex(activeRange) : null;
		if (open) scheduleApply();
		focusInput();
	}

	function close() {
		cancelPendingApply();
		clearHighlights();
		query = '';
		matchCount = 0;
		activeIndex = -1;
		truncated = false;
		open = false;
	}

	$effect(() => {
		// Re-run search when query/options change.
		// Touch reactive dependencies explicitly so $effect tracks them.
		query;
		caseSensitive;
		wholeWord;
		if (!open) return;
		scheduleApply();
	});

	$effect(() => {
		if (!open) {
			// External close (e.g. parent flipping `open` on tab switch).
			// Drop any pending debounced re-search so it can't fire after
			// we've already cleared the DOM.
			cancelPendingApply();
			clearHighlights();
			return;
		}
		// On open, focus and select the input so typing replaces.
		focusInput();
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			if (e.shiftKey) prev();
			else next();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
			e.preventDefault();
			e.stopPropagation();
			if (e.shiftKey) prev();
			else next();
		}
	}

	function countLabel(): string {
		if (!query) return '';
		if (matchCount === 0) return t('find.noMatches', language);
		const total = truncated ? `${MAX_MATCHES}+` : String(matchCount);
		return t('find.matchCount', language)
			.replace('{{current}}', String(activeIndex + 1))
			.replace('{{total}}', total);
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="find-bar"
		role="search"
		transition:fly={{ y: -8, duration: 120 }}
		onkeydown={handleKeydown}>
		<div class="find-input-wrap">
			<svg class="find-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
				stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
				aria-hidden="true">
				<circle cx="11" cy="11" r="7"></circle>
				<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
			</svg>
			<input
				bind:this={inputEl}
				bind:value={query}
				type="text"
				class="find-input"
				placeholder={t('find.placeholder', language)}
				aria-label={t('find.placeholder', language)}
				spellcheck="false"
				autocomplete="off" />
			<span class="find-count" class:no-matches={!!query && matchCount === 0}>
				{countLabel()}
			</span>
		</div>

		<button
			type="button"
			class="find-toggle"
			class:active={caseSensitive}
			title={t('find.caseSensitive', language)}
			aria-label={t('find.caseSensitive', language)}
			aria-pressed={caseSensitive}
			onclick={() => (caseSensitive = !caseSensitive)}>
			Aa
		</button>
		<button
			type="button"
			class="find-toggle"
			class:active={wholeWord}
			title={t('find.wholeWord', language)}
			aria-label={t('find.wholeWord', language)}
			aria-pressed={wholeWord}
			onclick={() => (wholeWord = !wholeWord)}>
			ab|
		</button>

		<div class="find-divider"></div>

		<button
			type="button"
			class="find-btn"
			title={t('find.previous', language)}
			aria-label={t('find.previous', language)}
			disabled={matchCount === 0}
			onclick={prev}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
				stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<polyline points="18 15 12 9 6 15"></polyline>
			</svg>
		</button>
		<button
			type="button"
			class="find-btn"
			title={t('find.next', language)}
			aria-label={t('find.next', language)}
			disabled={matchCount === 0}
			onclick={next}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
				stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		</button>
		<button
			type="button"
			class="find-btn"
			title={t('find.close', language)}
			aria-label={t('find.close', language)}
			onclick={close}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
				stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<line x1="18" y1="6" x2="6" y2="18"></line>
				<line x1="6" y1="6" x2="18" y2="18"></line>
			</svg>
		</button>
	</div>
{/if}

<style>
	.find-bar {
		position: absolute;
		top: 8px;
		right: 16px;
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px;
		background: var(--bg-tertiary, var(--color-canvas-subtle));
		border: 1px solid var(--color-border-muted);
		border-radius: 6px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
		font-size: 12px;
		color: var(--text-primary, var(--color-fg-default));
		user-select: none;
	}

	.find-input-wrap {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 6px;
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-muted);
		border-radius: 4px;
		min-width: 220px;
	}

	.find-input-wrap:focus-within {
		border-color: var(--color-accent-fg);
	}

	.find-icon {
		flex-shrink: 0;
		opacity: 0.6;
	}

	.find-input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		color: inherit;
		font: inherit;
		padding: 4px 0;
	}

	.find-count {
		flex-shrink: 0;
		font-size: 11px;
		opacity: 0.7;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.find-count.no-matches {
		color: #d73a49;
		opacity: 1;
	}

	.find-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 24px;
		height: 24px;
		padding: 0 4px;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 11px;
		cursor: pointer;
		font-family: inherit;
	}

	.find-toggle:hover {
		background: var(--color-neutral-muted, rgba(128, 128, 128, 0.15));
	}

	.find-toggle.active {
		background: var(--color-accent-subtle, rgba(67, 138, 243, 0.25));
		border-color: var(--color-accent-fg);
		color: var(--color-accent-fg);
	}

	.find-divider {
		width: 1px;
		height: 18px;
		background: var(--color-border-muted);
		margin: 0 2px;
	}

	.find-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.find-btn:hover:not(:disabled) {
		background: var(--color-neutral-muted, rgba(128, 128, 128, 0.15));
	}

	.find-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	:global(.markdown-body mark.markpad-find-match) {
		background-color: var(--highlight-color, rgba(255, 208, 0, 0.4));
		color: inherit;
		padding: 0;
		border-radius: 2px;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.05);
	}

	:global(.markdown-body mark.markpad-find-match.active) {
		background-color: #ff8c00;
		color: #000;
		box-shadow: 0 0 0 1px #ff8c00, 0 0 0 3px rgba(255, 140, 0, 0.25);
	}
</style>
