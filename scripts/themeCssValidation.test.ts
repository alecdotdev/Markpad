import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { isHexColor, isSafeCssColor, sanitizeThemeColors } from '../src/lib/utils/theme.js';

// P1-C-3: an imported VS Code theme's colour values are interpolated into a
// global <style> block that is replayed on every launch (the theme name is
// persisted in theme.txt), so an unvalidated value is a permanent UI takeover
// that can only be undone by deleting the config file by hand.

const injectionPoc = '#fff; } * { display:none; background-image:url(https://evil.tld/beacon) } :root {';

test('[P1-C-3] the theme.json injection PoC is rejected', () => {
	assert.equal(isSafeCssColor(injectionPoc), false);

	const safe = sanitizeThemeColors({
		'editor.background': injectionPoc,
		'editor.foreground': '#d4d4d4',
	});

	assert.deepEqual(safe, { 'editor.foreground': '#d4d4d4' });
	assert.equal(Object.prototype.hasOwnProperty.call(safe, 'editor.background'), false);
});

test('[P1-C-3] every shape that can escape a declaration block is rejected', () => {
	for (const value of [
		injectionPoc,
		'#fff;}*{display:none',
		'red; }',
		'url(https://evil.tld/beacon)',
		'#fff /* } */',
		'var(--x)',
		'expression(alert(1))',
		'#fff\n}',
		'#ggg',
		'#12345',
		'rgb(0,0,0);}',
		'rgba(0,0,0,0) !important',
		'',
		'   ',
		'#'.repeat(200),
	]) {
		assert.equal(isSafeCssColor(value), false, `must reject ${JSON.stringify(value)}`);
	}

	for (const value of [null, undefined, 42, {}, [], true]) {
		assert.equal(isSafeCssColor(value), false, `must reject ${String(value)}`);
	}
});

test('[P1-C-3] real VS Code theme colour values still pass', () => {
	for (const value of [
		'#fff',
		'#FFFA',
		'#1e1e1e',
		'#1E1E1EFF',
		'rgb(30, 30, 30)',
		'rgba(255, 255, 255, 0.1)',
		'rgba(0,0,0,.35)',
		'rgb(0 0 0 / 50%)',
		'transparent',
		'Black',
	]) {
		assert.equal(isSafeCssColor(value), true, `must allow ${value}`);
	}
});

test('[P1-C-3] Monaco only receives hex colours', () => {
	assert.equal(isHexColor('#1e1e1e'), true);
	assert.equal(isHexColor('#1e1e1eff'), true);
	assert.equal(isHexColor('rgba(0, 0, 0, 0.1)'), false);
	assert.equal(isHexColor('transparent'), false);
	assert.equal(isHexColor(injectionPoc), false);
});

test('[P1-C-3] sanitizeThemeColors survives a hostile theme.json shape', () => {
	assert.deepEqual(sanitizeThemeColors(null), {});
	assert.deepEqual(sanitizeThemeColors(undefined), {});
	assert.deepEqual(sanitizeThemeColors('#fff'), {});
	assert.deepEqual(
		sanitizeThemeColors({ a: '  #fff  ', b: 12, c: { toString: () => '#fff' }, d: ['#fff'] }),
		{ a: '#fff' },
	);
});

test('[P1-C-3] the injected style tag is built only from validated values', () => {
	const source = readFileSync('src/lib/utils/theme.ts', 'utf8');

	assert.match(source, /const colors = sanitizeThemeColors\(theme\.colors\)/);
	assert.match(
		source,
		/\.filter\(\(\[, v\]\) => isSafeCssColor\(v\)\)/,
		'the final interpolation must re-check each value',
	);
	assert.doesNotMatch(
		source,
		/styleTag\.innerHTML\s*=/,
		'use textContent so the style tag can never be parsed as markup',
	);
});
