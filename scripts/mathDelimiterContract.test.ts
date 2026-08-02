/**
 * The cross-language math-delimiter contract — frontend half.
 *
 * Correctness of the math pipeline rests on one invariant that lives in two
 * languages at once:
 *
 *     the spans `src-tauri/src/lib.rs` hides from comrak
 *   ≡ the spans `src/lib/utils/markdown.ts` renders with KaTeX
 *
 *   backend ⊂ frontend → comrak rewrites the formula before KaTeX ever sees
 *                        it. That is issues #174, #177 and #197.
 *   backend ⊃ frontend → the text is withheld from Markdown and then rendered
 *                        by nobody; the reader gets dead text that is neither
 *                        prose nor a formula.
 *
 * Neither side is the reference. Both are asserted against one hand-authored
 * table, `mathDelimiterCorpus.json`; the Rust half is
 * `the_backend_recognises_exactly_the_math_the_contract_lists`. Loosen a
 * condition in `findInlineMathEnd` — say, drop "a closer may not be followed
 * by a digit" — and this file goes red on its own, without anyone remembering
 * that a second implementation exists.
 *
 * Nothing here re-implements the delimiter rule. The frontend's decision is
 * read back only from artefacts the frontend itself produces: `\(…\)`, which
 * only `convertInlineMathDelimiters` emits, and `data-math-source`, which only
 * `processDisplayMathBlocks` sets. An extractor that parsed `$…$` on its own
 * could agree with a broken implementation, which would defeat the point.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
	installShimDom,
	parseHtml,
	NODE_ELEMENT,
	NODE_TEXT,
	type ShimElement,
	type ShimNode,
	type ShimText,
} from './renderProtocolDom.ts';

installShimDom();

const { processMarkdownHtml } = await import('../src/lib/utils/markdown.ts');

type ContractSpan = { kind: 'inline' | 'display'; source: string };
type ContractCase = {
	name: string;
	markdown: string;
	/** Real `convert_markdown` output; kept live by the Rust half. */
	html: string;
	math: ContractSpan[];
};

const corpus: { cases: ContractCase[] } = JSON.parse(
	readFileSync(fileURLToPath(new URL('./mathDelimiterCorpus.json', import.meta.url)), 'utf8'),
);

const FILE_PATH = '/documents/notes.md';

/** Only `convertInlineMathDelimiters` ever writes `\(`…`\)` into a text node. */
const INLINE_MATH_RE = /\\\(([\s\S]*?)\\\)/g;

/** What the frontend decided, in document order, in the corpus's vocabulary. */
function recognisedMath(body: ShimElement): ContractSpan[] {
	const found: ContractSpan[] = [];

	const visit = (node: ShimNode): void => {
		if (node.nodeType === NODE_ELEMENT) {
			const element = node as ShimElement;
			if (element.getAttribute('data-math') === 'display') {
				found.push({ kind: 'display', source: element.getAttribute('data-math-source') ?? '' });
				return;
			}
			for (const child of [...element.childNodes]) visit(child);
			return;
		}
		if (node.nodeType === NODE_TEXT) {
			const text = (node as ShimText).nodeValue ?? '';
			INLINE_MATH_RE.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = INLINE_MATH_RE.exec(text)) !== null) {
				found.push({ kind: 'inline', source: match[1] });
			}
		}
	};

	for (const child of [...body.childNodes]) visit(child);
	return found;
}

test('the frontend renders exactly the math the contract lists', () => {
	for (const testCase of corpus.cases) {
		const body = parseHtml(processMarkdownHtml(testCase.html, FILE_PATH, new Set())).body;
		assert.deepEqual(
			recognisedMath(body),
			testCase.math,
			`${testCase.name}: the frontend and the contract disagree about what is math\n` +
				`  input: ${JSON.stringify(testCase.markdown)}`,
		);
	}
});

test('the corpus covers both directions of the invariant', () => {
	// A corpus of nothing but negatives would stay green under an
	// implementation that recognises no math at all, and a corpus of nothing
	// but positives would stay green under one that recognises everything.
	const negatives = corpus.cases.filter((one) => one.math.length === 0);
	const positives = corpus.cases.filter((one) => one.math.length > 0);
	assert.ok(negatives.length >= 10, `only ${negatives.length} must-not-be-math cases`);
	assert.ok(positives.length >= 10, `only ${positives.length} must-be-math cases`);
	assert.ok(
		positives.some((one) => one.math.some((span) => span.kind === 'display')),
		'no display-math case',
	);
	assert.ok(
		positives.some((one) => one.math.some((span) => span.kind === 'inline')),
		'no inline-math case',
	);
});
