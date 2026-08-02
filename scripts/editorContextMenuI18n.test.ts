import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getSupportedLanguages, t, type LanguageCode } from '../src/lib/utils/i18n.js';

// WHAT THIS FILE COVERS, AND WHAT IT DOES NOT
//
// Covered for real: the translation table. `t()` is imported and called, so the
// key-exists / falls-back / distinct-label assertions are genuine behaviour.
//
// Not covered: Monaco's runtime. Editor.svelte is a Svelte component and cannot
// be imported here, so "the context menu is rebuilt when the language changes"
// and "no action id is registered twice" are pinned by reading the component's
// source. Those assertions prove the code is *written* that way, not that
// Monaco behaves that way when the effect re-runs — verifying that needs a
// running editor.

const editor = readFileSync('src/lib/components/Editor.svelte', 'utf8');

const supported = getSupportedLanguages().map((l) => l.code);

function count(source: string, pattern: RegExp): number {
	return source.match(pattern)?.length ?? 0;
}

// The markdown formatting entries that used to be English string literals.
const FORMATTING_ACTIONS: ReadonlyArray<[actionId: string, key: string, englishLabel: string]> = [
	['fmt-inline-code', 'menu.inlineCode', 'Inline Code'],
	['fmt-code-block', 'menu.codeBlock', 'Code Block'],
	['fmt-quote', 'menu.quote', 'Quote'],
	['fmt-heading-1', 'menu.heading1', 'Heading 1'],
	['fmt-heading-2', 'menu.heading2', 'Heading 2'],
	['fmt-heading-3', 'menu.heading3', 'Heading 3'],
	['fmt-bullet-list', 'menu.bulletList', 'Bullet List'],
	['fmt-numbered-list', 'menu.numberedList', 'Numbered List'],
	['fmt-checklist', 'menu.checklist', 'Checklist'],
	['fmt-link', 'menu.link', 'Link'],
];

test('every context-menu label is translated, none is an English literal', () => {
	for (const [actionId, key, englishLabel] of FORMATTING_ACTIONS) {
		assert.doesNotMatch(
			editor,
			new RegExp(`id: "${actionId}",\\s*\\n\\s*label: "${englishLabel}"`),
			`${actionId} must not hard-code "${englishLabel}"`,
		);
		assert.match(
			editor,
			new RegExp(`id: "${actionId}",\\s*\\n\\s*label: t\\('${key.replace('.', '\\.')}', lang\\)`),
			`${actionId} takes its label from ${key}`,
		);
	}

	// No `addAction` anywhere in the component may carry a bare string label.
	assert.equal(
		count(editor, /addAction\(\{\s*\n\s*id: "[^"]+",\s*\n\s*label: "/g),
		0,
		'no action label is a raw string literal',
	);
});

test('the formatting labels exist in English and resolve in every language', () => {
	for (const [, key, englishLabel] of FORMATTING_ACTIONS) {
		assert.equal(t(key, 'en'), englishLabel, `${key} is defined for English`);
		for (const lang of supported) {
			const label = t(key, lang as LanguageCode);
			assert.notEqual(label, key, `${key} resolves for ${lang} instead of echoing the key`);
			assert.ok(label.length > 0, `${key} is non-empty for ${lang}`);
		}
	}
});

test('toggle-occurrences-highlight has its own label, not Show Whitespace', () => {
	// The two actions shared `settings.showWhitespace`, so the context menu
	// listed the same entry twice and one of them silently toggled the other
	// setting.
	assert.match(
		editor,
		/id: "toggle-occurrences-highlight",\s*\n\s*label: t\('settings\.occurrencesHighlight', lang\)/,
	);
	assert.match(
		editor,
		/id: "toggle-whitespace",\s*\n\s*label: t\('settings\.showWhitespace', lang\)/,
	);
	assert.equal(
		count(editor, /label: t\('settings\.showWhitespace', lang\)/g),
		1,
		'settings.showWhitespace labels exactly one action',
	);

	for (const lang of supported) {
		const occurrences = t('settings.occurrencesHighlight', lang as LanguageCode);
		const whitespace = t('settings.showWhitespace', lang as LanguageCode);
		assert.notEqual(occurrences, 'settings.occurrencesHighlight', `defined for ${lang}`);
		assert.notEqual(
			occurrences,
			whitespace,
			`the two context-menu entries are distinguishable in ${lang}`,
		);
	}
});

test('no two actions share a label within a language', () => {
	// A duplicated label is indistinguishable from a duplicated menu entry from
	// the user's side, which is exactly how ED-6 presented.
	const labelKeys = [...editor.matchAll(/label: t\('([^']+)', lang\)/g)].map((m) => m[1]);
	assert.ok(labelKeys.length > 30, 'the localized action set was found');
	assert.equal(new Set(labelKeys).size, labelKeys.length, 'each action uses a distinct key');

	for (const lang of supported) {
		const labels = labelKeys.map((key) => t(key, lang as LanguageCode));
		const seen = new Map<string, string>();
		for (const [index, label] of labels.entries()) {
			const previous = seen.get(label);
			assert.equal(
				previous,
				undefined,
				`${lang}: "${label}" is used by both ${previous} and ${labelKeys[index]}`,
			);
			seen.set(label, labelKeys[index]);
		}
	}
});

test('actions are re-registered when the UI language changes', () => {
	// The labels used to be baked in at mount, so switching language left the
	// editor's context menu in the previous one until the app restarted.
	assert.match(
		editor,
		/function registerLocalizedActions\(lang: LanguageCode\)/,
		'registration is a function of the language, not of mount time',
	);
	assert.match(
		editor,
		/\$effect\(\(\) => \{\s*\n\s*const lang = settings\.language;/,
		'an effect tracks settings.language',
	);
	assert.match(
		editor,
		/registerLocalizedActions\(lang\);\s*\n\s*return disposeLocalizedActions;/,
		'the effect cleanup disposes the previous registration',
	);

	// `addAction` returns an IDisposable; re-registering an id without disposing
	// leaves a duplicate entry in the context menu.
	assert.match(
		editor,
		/function disposeLocalizedActions\(\) \{[\s\S]*?for \(const action of localizedActions\) action\.dispose\(\);/,
		'every disposable is released',
	);
	assert.match(
		editor,
		/function registerLocalizedActions\(lang: LanguageCode\) \{[\s\S]{0,400}?disposeLocalizedActions\(\);/,
		'registration disposes before it rebuilds',
	);
	assert.match(editor, /onDestroy\(disposeLocalizedActions\)/, 'teardown releases them too');

	// The old design read a `uiLanguage` snapshot captured inside onMount.
	assert.doesNotMatch(editor, /uiLanguage/, 'no captured language snapshot remains');
	assert.equal(
		count(editor, /label: t\('[^']+', uiLanguage\)/g),
		0,
		'no label is still bound to the snapshot',
	);
});

test('no action id is registered more than once', () => {
	const ids = [...editor.matchAll(/addAction\(\{\s*\n\s*id: "([^"]+)"/g)].map((m) => m[1]);
	assert.ok(ids.length > 30, 'the action set was found');
	assert.equal(new Set(ids).size, ids.length, 'action ids are unique');
});
