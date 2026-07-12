const FOLD_WRAPPER_SELECTOR = '.foldable-content-wrapper';
const FOLD_CONTENT_SELECTOR = ':scope > .content-inner';

function updateFoldHeights(root: HTMLElement) {
	// Innermost wrappers first so a parent measures its child's freshly
	// written height rather than a stale one.
	const wrappers = Array.from(
		root.querySelectorAll<HTMLElement>(FOLD_WRAPPER_SELECTOR),
	).reverse();

	// Reflow-driven height writes must land instantly. The `height` transition
	// exists only to animate fold/unfold; letting it also animate every resize
	// leaves the expanded wrapper shorter than its content for ~0.25s, so the
	// following section overlaps the still-visible overflow. Suppress the
	// transition around the write, force one layout to commit it, then restore
	// the stylesheet transition for the next fold toggle.
	const written: HTMLElement[] = [];
	for (const wrapper of wrappers) {
		const content = wrapper.querySelector<HTMLElement>(FOLD_CONTENT_SELECTOR);
		if (!content) continue;

		wrapper.style.transition = 'none';
		wrapper.style.setProperty('--fold-content-height', `${Math.ceil(content.scrollHeight)}px`);
		written.push(wrapper);
	}

	if (written.length === 0) return;

	// Single forced reflow commits every suppressed height write at once.
	void root.offsetHeight;

	for (const wrapper of written) {
		wrapper.style.transition = '';
	}
}

export function observeFoldLayout(root: HTMLElement): () => void {
	let frame: number | null = null;

	const scheduleUpdate = () => {
		if (frame !== null) return;
		frame = requestAnimationFrame(() => {
			frame = null;
			updateFoldHeights(root);
		});
	};

	const observer = new ResizeObserver(scheduleUpdate);
	for (const content of root.querySelectorAll<HTMLElement>(
		`${FOLD_WRAPPER_SELECTOR} > .content-inner`,
	)) {
		observer.observe(content);
	}

	window.addEventListener('resize', scheduleUpdate);
	scheduleUpdate();

	return () => {
		observer.disconnect();
		window.removeEventListener('resize', scheduleUpdate);
		if (frame !== null) cancelAnimationFrame(frame);
	};
}
