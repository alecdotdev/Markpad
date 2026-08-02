import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync('src/styles.css', 'utf8');

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

// Paper geometry the cap has to satisfy. `@page { margin: 0 }` makes the page
// box the whole sheet, and `.markdown-body` supplies 0.75in of padding top and
// bottom, so the printable column is the sheet height minus 1.5in.
const LETTER_PRINTABLE_IN = 11 - 1.5;
const A4_PRINTABLE_IN = 11.69 - 1.5;

/** Print rules whose body sets `property` (never a vendor-prefixed variant). */
function printRulesSetting(property: string): { selector: string; body: string }[] {
	const declaration = new RegExp(`(?<![\\w-])${property}:\\s*([^;]+);`);
	const rules: { selector: string; body: string }[] = [];
	const pattern = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(printBlock)) !== null) {
		if (declaration.test(match[2])) rules.push({ selector: match[1].trim(), body: match[2] });
	}
	return rules;
}

function capInInches(body: string): number {
	const raw = body.match(/(?<![\w-])max-height:\s*([\d.]+)in/);
	assert.ok(raw, `the cap must be an absolute length in inches, not: ${body.trim()}`);
	return Number(raw[1]);
}

test('the print block caps media height at a size both papers can hold', () => {
	// A replaced element cannot be fragmented, so `break-inside: avoid` on its
	// own turns anything taller than the printable column into a cropped
	// image rather than a page break.
	const capped = printRulesSetting('max-height');
	assert.ok(capped.length > 0, 'nothing in the print block caps media height');

	for (const rule of capped) {
		const inches = capInInches(rule.body);
		assert.ok(inches <= LETTER_PRINTABLE_IN, `${inches}in overflows Letter (${LETTER_PRINTABLE_IN}in)`);
		assert.ok(inches <= A4_PRINTABLE_IN, `${inches}in overflows A4 (${A4_PRINTABLE_IN}in)`);
		assert.ok(inches >= 6, `${inches}in shrinks every full-page figure needlessly`);
		assert.match(rule.body, /(?<![\w-])max-height:[^;]*!important;/);
	}
});

test('oversized images are scaled to a page instead of being clipped', () => {
	const capped = printRulesSetting('max-height').filter((rule) => /(?<![\w-])img(?![\w-])/.test(rule.selector));
	assert.equal(capped.length, 1, 'images need exactly one print height cap');
});

test('oversized mermaid diagrams are scaled to a page too', () => {
	const capped = printRulesSetting('max-height').filter((rule) => /\.mermaid-diagram svg/.test(rule.selector));
	assert.equal(capped.length, 1, 'diagrams need exactly one print height cap');
});

test('the cap preserves aspect ratio rather than squashing', () => {
	assert.match(printBlock, /(?<![\w-])object-fit:\s*contain\s*!important;/);
	// `height: auto` from the existing rhythm rule is what lets the cap scale
	// the width down proportionally; it must stay.
	assert.match(printBlock, /\.markdown-body img\s*\{[\s\S]*?height:\s*auto\s*!important;/);
	assert.match(printBlock, /\.markdown-body img\s*\{[\s\S]*?max-width:\s*100%\s*!important;/);
});

test('the diagram container does not clip the capped diagram', () => {
	// `.mermaid-diagram` carries `overflow-x: auto` for the screen, which
	// computes overflow-y to `auto` as well and would crop on paper.
	assert.match(printBlock, /\.markdown-body \.mermaid-diagram\s*\{[^}]*overflow:\s*visible\s*!important;/);
});

test('the media caps do not undo the existing print handling', () => {
	// #359 moved diagram colours out of CSS into a light-theme re-render
	// (utils/mermaidPrint.ts); the cap must not smuggle paint rules back in.
	assert.doesNotMatch(printBlock, /\.mermaid-diagram svg[^{]*\{[^}]*fill:/);
	assert.doesNotMatch(printBlock, /\.mermaid-diagram[^{]*\{[^}]*(?<![\w-])stroke:/);

	// Now that they fit, `break-inside: avoid` can do its job and move them
	// to the next page instead of cropping them.
	assert.match(
		printBlock,
		/\.markdown-body img,\s*\n\s*\.markdown-body \.mermaid-diagram,[\s\S]*?break-inside:\s*avoid;/,
	);
});
