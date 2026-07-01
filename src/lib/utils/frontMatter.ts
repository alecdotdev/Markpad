import { parseDocument } from 'yaml';

export type FrontMatterValueKind = 'string' | 'number' | 'boolean' | 'list' | 'object' | 'null';

export type FrontMatterField = {
	key: string;
	value: unknown;
	kind: FrontMatterValueKind;
	displayValue: string;
	editableValue: string;
	editable: boolean;
};

export type FrontMatterParseResult = {
	exists: boolean;
	valid: boolean;
	raw: string;
	body: string;
	fields: FrontMatterField[];
	data: Record<string, unknown>;
	error?: string;
	lineEnding: '\n' | '\r\n';
};

type FrontMatterRange = {
	raw: string;
	body: string;
	lineEnding: '\n' | '\r\n';
};

function detectLineEnding(content: string): '\n' | '\r\n' {
	return content.includes('\r\n') ? '\r\n' : '\n';
}

function findFrontMatterRange(content: string): FrontMatterRange | null {
	const lineEnding = detectLineEnding(content);
	const firstLineMatch = content.match(/^(?:\uFEFF)?---[ \t]*(?:\r?\n|$)/);
	if (!firstLineMatch) return null;

	let cursor = firstLineMatch[0].length;
	while (cursor <= content.length) {
		const nextNewline = content.indexOf('\n', cursor);
		const lineEnd = nextNewline === -1 ? content.length : nextNewline + 1;
		const line = content.slice(cursor, lineEnd).replace(/\r?\n$/, '');
		if (line.trim() === '---') {
			const raw = content.slice(firstLineMatch[0].length, cursor);
			let bodyStart = lineEnd;
			if (content.startsWith('\r\n', bodyStart)) {
				bodyStart += 2;
			} else if (content.startsWith('\n', bodyStart)) {
				bodyStart += 1;
			}

			return {
				raw,
				body: content.slice(bodyStart),
				lineEnding,
			};
		}

		if (nextNewline === -1) break;
		cursor = lineEnd;
	}

	return null;
}

function getValueKind(value: unknown): FrontMatterValueKind {
	if (value === null || value === undefined) return 'null';
	if (Array.isArray(value)) return 'list';
	if (typeof value === 'boolean') return 'boolean';
	if (typeof value === 'number') return 'number';
	if (typeof value === 'string') return 'string';
	return 'object';
}

function stringifyDisplayValue(value: unknown): string {
	if (Array.isArray(value)) {
		return value.map((item) => stringifyDisplayValue(item)).join(', ');
	}
	if (value === null || value === undefined) return '';
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

function toPlainRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function toField([key, value]: [string, unknown]): FrontMatterField {
	const kind = getValueKind(value);
	return {
		key,
		value,
		kind,
		displayValue: stringifyDisplayValue(value),
		editableValue: Array.isArray(value) ? value.map((item) => stringifyDisplayValue(item)).join(', ') : stringifyDisplayValue(value),
		editable: kind !== 'object',
	};
}

export function parseFrontMatter(content: string): FrontMatterParseResult {
	const range = findFrontMatterRange(content);
	const lineEnding = range?.lineEnding ?? detectLineEnding(content);
	if (!range) {
		return {
			exists: false,
			valid: true,
			raw: '',
			body: content,
			fields: [],
			data: {},
			lineEnding,
		};
	}

	const doc = parseDocument(range.raw, { prettyErrors: false });
	if (doc.errors.length > 0) {
		return {
			exists: true,
			valid: false,
			raw: range.raw,
			body: range.body,
			fields: [],
			data: {},
			error: doc.errors.map((error) => error.message).join('\n'),
			lineEnding,
		};
	}

	const data = toPlainRecord(doc.toJSON());
	return {
		exists: true,
		valid: true,
		raw: range.raw,
		body: range.body,
		fields: Object.entries(data).map(toField),
		data,
		lineEnding,
	};
}

export function getMarkdownBodyWithoutFrontMatter(content: string): string {
	return parseFrontMatter(content).body;
}

export function parseFrontMatterEditableValue(field: FrontMatterField, value: string): unknown {
	const trimmed = value.trim();
	switch (field.kind) {
		case 'boolean':
			return trimmed.toLowerCase() === 'true';
		case 'number': {
			const parsed = Number(trimmed);
			return Number.isFinite(parsed) ? parsed : value;
		}
		case 'list':
			return parseFrontMatterTagInput(value);
		case 'null':
			return trimmed === '' ? null : value;
		case 'string':
		default:
			return value;
	}
}

export function updateFrontMatterField(content: string, key: string, value: unknown): string {
	const parsed = parseFrontMatter(content);
	if (!parsed.exists) return content;
	if (!parsed.valid) throw new Error(parsed.error || 'Invalid front matter');

	const doc = parseDocument(parsed.raw, { prettyErrors: false });
	if (doc.errors.length > 0) throw new Error(doc.errors.map((error) => error.message).join('\n'));

	doc.set(key, value);
	let serialized = doc.toString({ lineWidth: 0 }).trimEnd();
	if (parsed.lineEnding === '\r\n') serialized = serialized.replace(/\n/g, '\r\n');

	return `---${parsed.lineEnding}${serialized}${parsed.lineEnding}---${parsed.lineEnding}${parsed.lineEnding}${parsed.body}`;
}

export function parseFrontMatterTagInput(value: string): string[] {
	return value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

export function getFrontMatterListItems(field: FrontMatterField): string[] {
	if (!Array.isArray(field.value)) return [];
	return field.value
		.map((item) => stringifyDisplayValue(item).trim())
		.filter(Boolean);
}

export function addFrontMatterListItems(items: string[], values: string[]): string[] {
	const next = [...items];
	for (const value of values.flatMap(parseFrontMatterTagInput)) {
		if (!next.includes(value)) next.push(value);
	}
	return next;
}

export function addFrontMatterListItem(items: string[], value: string): string[] {
	return addFrontMatterListItems(items, [value]);
}

export function removeFrontMatterListItem(items: string[], index: number): string[] {
	if (index < 0 || index >= items.length) return items;
	return items.filter((_, itemIndex) => itemIndex !== index);
}

export function updateFrontMatterListItem(items: string[], index: number, value: string): string[] {
	if (index < 0 || index >= items.length) return items;

	const trimmed = value.trim();
	if (!trimmed || items.some((item, itemIndex) => itemIndex !== index && item === trimmed)) return items;

	const next = [...items];
	next[index] = trimmed;
	return next;
}
