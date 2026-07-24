export type EditorToolbarGroup = 'inline' | 'block' | 'list' | 'insert';

export type EditorToolbarTool = {
	id: string;
	label: string;
	name: string;
	nameKey: string;
	shortcut?: (modifier: 'Ctrl' | 'Cmd') => string;
	group: EditorToolbarGroup;
};

export type EditorToolbarMove = {
	fromIndex: number;
	toIndex: number;
};

export const EDITOR_TOOLBAR_TOOLS: EditorToolbarTool[] = [
	{ id: 'fmt-bold', label: 'B', name: 'Bold', nameKey: 'settings.toolbarToolBold', shortcut: (modifier) => `${modifier}+B`, group: 'inline' },
	{ id: 'fmt-italic', label: 'I', name: 'Italic', nameKey: 'settings.toolbarToolItalic', shortcut: (modifier) => `${modifier}+I`, group: 'inline' },
	{ id: 'fmt-underline', label: 'U', name: 'Underline', nameKey: 'settings.toolbarToolUnderline', shortcut: (modifier) => `${modifier}+U`, group: 'inline' },
	{ id: 'fmt-inline-code', label: '`', name: 'Inline Code', nameKey: 'settings.toolbarToolInlineCode', group: 'inline' },
	{ id: 'fmt-code-block', label: '{}', name: 'Code Block', nameKey: 'settings.toolbarToolCodeBlock', group: 'block' },
	{ id: 'fmt-quote', label: '>', name: 'Quote', nameKey: 'settings.toolbarToolQuote', group: 'block' },
	{ id: 'fmt-heading-1', label: 'H1', name: 'Heading 1', nameKey: 'settings.toolbarToolHeading1', group: 'block' },
	{ id: 'fmt-heading-2', label: 'H2', name: 'Heading 2', nameKey: 'settings.toolbarToolHeading2', group: 'block' },
	{ id: 'fmt-heading-3', label: 'H3', name: 'Heading 3', nameKey: 'settings.toolbarToolHeading3', group: 'block' },
	{ id: 'fmt-bullet-list', label: '-', name: 'Bullet List', nameKey: 'settings.toolbarToolBulletList', group: 'list' },
	{ id: 'fmt-numbered-list', label: '1.', name: 'Numbered List', nameKey: 'settings.toolbarToolNumberedList', group: 'list' },
	{ id: 'fmt-checklist', label: '[ ]', name: 'Checklist', nameKey: 'settings.toolbarToolChecklist', group: 'list' },
	{ id: 'fmt-link', label: '[]', name: 'Link', nameKey: 'settings.toolbarToolLink', group: 'insert' },
	{ id: 'insert-table-simple', label: '#', name: 'Table', nameKey: 'settings.toolbarToolTable', shortcut: (modifier) => `${modifier}+K T`, group: 'insert' },
];

export const DEFAULT_EDITOR_TOOLBAR_ORDER = EDITOR_TOOLBAR_TOOLS.map((tool) => tool.id);

const knownToolbarIds = new Set(DEFAULT_EDITOR_TOOLBAR_ORDER);

export function normalizeEditorToolbarOrder(order: readonly string[] | null | undefined): string[] {
	const normalized: string[] = [];

	for (const id of order ?? []) {
		if (!knownToolbarIds.has(id) || normalized.includes(id)) continue;
		normalized.push(id);
	}

	for (const id of DEFAULT_EDITOR_TOOLBAR_ORDER) {
		if (!normalized.includes(id)) normalized.push(id);
	}

	return normalized;
}

export function normalizeEditorToolbarHidden(hidden: readonly string[] | null | undefined): string[] {
	const normalized: string[] = [];

	for (const id of hidden ?? []) {
		if (!knownToolbarIds.has(id) || normalized.includes(id)) continue;
		normalized.push(id);
	}

	return normalized;
}

export function getEditorToolbarTools(order: readonly string[] | null | undefined): EditorToolbarTool[] {
	const byId = new Map(EDITOR_TOOLBAR_TOOLS.map((tool) => [tool.id, tool]));
	return normalizeEditorToolbarOrder(order).map((id) => byId.get(id)!).filter(Boolean);
}

export function getVisibleEditorToolbarTools(
	order: readonly string[] | null | undefined,
	hidden: readonly string[] | null | undefined,
): EditorToolbarTool[] {
	const hiddenIds = new Set(normalizeEditorToolbarHidden(hidden));
	return getEditorToolbarTools(order).filter((tool) => !hiddenIds.has(tool.id));
}

export function getEditorToolbarReorderMove(
	order: readonly string[],
	draggedId: string,
	targetId: string,
): EditorToolbarMove | null {
	const normalized = normalizeEditorToolbarOrder(order);
	const fromIndex = normalized.indexOf(draggedId);
	const toIndex = normalized.indexOf(targetId);

	if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return null;
	return { fromIndex, toIndex };
}

export function getEditorToolbarAdjacentMove(
	order: readonly string[],
	id: string,
	direction: 'up' | 'down',
): EditorToolbarMove | null {
	const normalized = normalizeEditorToolbarOrder(order);
	const fromIndex = normalized.indexOf(id);
	if (fromIndex === -1) return null;

	const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
	if (toIndex < 0 || toIndex >= normalized.length) return null;

	return { fromIndex, toIndex };
}

export function applyEditorToolbarMove(order: readonly string[], move: EditorToolbarMove): string[] {
	const normalized = normalizeEditorToolbarOrder(order);
	if (
		move.fromIndex < 0 ||
		move.fromIndex >= normalized.length ||
		move.toIndex < 0 ||
		move.toIndex >= normalized.length ||
		move.fromIndex === move.toIndex
	) {
		return normalized;
	}

	const next = [...normalized];
	const [moved] = next.splice(move.fromIndex, 1);
	next.splice(move.toIndex, 0, moved);
	return next;
}
