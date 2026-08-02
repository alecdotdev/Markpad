import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync('src/styles.css', 'utf8');
const findBar = readFileSync('src/lib/components/FindBar.svelte', 'utf8');

/** The `@media print` block only — not everything that follows it in the file. */
function extractPrintBlock(source: string): string {
	const start = source.indexOf('@media print {');
	assert.notEqual(start, -1, 'src/styles.css must keep an @media print block');
	let depth = 0;
	for (let i = source.indexOf('{', start); i < source.length; i += 1) {
		if (source[i] === '{') depth += 1;
		else if (source[i] === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(start, i + 1);
		}
	}
	throw new Error('unterminated @media print block');
}

const printBlock = extractPrintBlock(styles);

// A declaration lookup that cannot be satisfied by a vendor-prefixed or
// longhand-extended neighbour: `box-shadow` must not match
// `-webkit-box-shadow`, `background` must not match `background-color`.
const declaration = (name: string) => new RegExp(`(?<![\\w-])${name}:\\s*([^;]+);`);

function printRuleBody(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = printBlock.match(new RegExp(`${escaped}[^{}]*\\{([^}]*)\\}`));
	assert.ok(match, `expected a print rule for ${selector}`);
	return match[1];
}

test('the find bar itself stays out of the export', () => {
	assert.match(printBlock, /\.find-bar[\s\S]{0,40}\{[\s\S]*?display:\s*none\s*!important;/);
});

test('find highlights are neutralised on paper, not deleted from it', () => {
	// The mark wraps document text. Hiding it would drop the matched words
	// from the PDF, so only its decoration may go.
	const body = printRuleBody('.markdown-body mark.markpad-find-match');

	assert.equal(body.match(declaration('background-color'))?.[1].trim(), 'transparent !important');
	assert.equal(body.match(declaration('box-shadow'))?.[1].trim(), 'none !important');
	assert.doesNotMatch(body, /(?<![\w-])display:\s*none/);
	assert.doesNotMatch(body, /(?<![\w-])visibility:\s*hidden/);
	assert.doesNotMatch(body, /(?<![\w-])content:/);
	assert.doesNotMatch(body, /(?<![\w-])font-size:\s*0/);
});

test('the active find highlight is neutralised too', () => {
	// `.active` carries its own background, colour and ring, and outranks the
	// base selector, so the print rule has to name it explicitly.
	assert.match(findBar, /mark\.markpad-find-match\.active/);
	assert.match(
		printBlock,
		/mark\.markpad-find-match\.active[^{}]*\{[^}]*(?<![\w-])background-color:\s*transparent\s*!important;/,
	);
	assert.match(
		printBlock,
		/mark\.markpad-find-match\.active[^{}]*\{[^}]*(?<![\w-])box-shadow:\s*none\s*!important;/,
	);
});

test('the neutralising rule outranks the component styles it overrides', () => {
	// FindBar.svelte styles the mark from a `:global()` rule of equal
	// specificity, and stylesheet order between a component style and
	// styles.css is not guaranteed, so `!important` is what decides.
	const body = printRuleBody('.markdown-body mark.markpad-find-match');
	const findBarRule = findBar.slice(findBar.indexOf(':global(.markdown-body mark.markpad-find-match)'));

	assert.doesNotMatch(findBarRule.slice(0, findBarRule.indexOf('</style>')), /!important/);
	for (const property of ['background-color', 'box-shadow']) {
		assert.match(body, new RegExp(`(?<![\\w-])${property}:[^;]*!important;`));
	}
});

test('find highlights are not added to the print display:none list', () => {
	const hiddenRule = printBlock.match(/([^{}]*)\{[^}]*display:\s*none\s*!important;[^}]*\}/);
	assert.ok(hiddenRule, 'expected the print display:none group');
	assert.doesNotMatch(hiddenRule[1], /markpad-find-match/);
});

test('document ==highlight== marks still print', () => {
	// Only the find marks lose their background. The authored `==highlight==`
	// is content, so the print block must not blanket-reset every <mark>.
	assert.doesNotMatch(printRuleBody('.markdown-body mark.markpad-find-match'), /--highlight-color/);
	assert.doesNotMatch(printBlock, /\.markdown-body mark\s*\{/);
	assert.doesNotMatch(printBlock, /\.markdown-body mark,/);
});
