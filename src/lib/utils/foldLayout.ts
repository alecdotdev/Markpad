const FOLD_WRAPPER_SELECTOR = '.foldable-content-wrapper';
const FOLD_CONTENT_SELECTOR = ':scope > .content-inner';

function updateFoldHeights(root: HTMLElement) {
	const wrappers = Array.from(root.querySelectorAll<HTMLElement>(FOLD_WRAPPER_SELECTOR));

	for (const wrapper of wrappers.reverse()) {
		const content = wrapper.querySelector<HTMLElement>(FOLD_CONTENT_SELECTOR);
		if (!content) continue;

		wrapper.style.setProperty('--fold-content-height', `${Math.ceil(content.scrollHeight)}px`);
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
