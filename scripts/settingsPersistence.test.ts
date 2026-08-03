import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { callbackBodies, sliceBetween } from './sourceTree.js';
// Plain TypeScript, no runes: safe to import statically, unlike the store below.
import { getSupportedLanguages, translations } from '../src/lib/utils/i18n.js';

/*
 * `settings.svelte.ts` is a runes module, so it cannot be imported the way the
 * other suites import plain utils. Node's test runner gives every file its own
 * process, so shimming the runes and the browser globals here cannot leak into
 * any other suite.
 *
 * The shims are deliberately dumb: `$state` is identity and `$effect` runs its
 * callback once and records it. That is enough to assert the *shape* of the
 * persistence layer (how many effects exist, which fields each one reads),
 * which is the property that actually decides the multi-window behaviour. No
 * assertion below depends on the shims re-running anything.
 */
type EffectFn = () => void | (() => void);

const runes = globalThis as unknown as {
	$state: unknown;
	$derived: unknown;
	$effect: unknown;
};

const registeredEffects: EffectFn[] = [];

const identity = (value: unknown) => value;
const stateRune = Object.assign(identity, { raw: identity, snapshot: identity });
const effectRune = Object.assign(
	(fn: EffectFn) => {
		registeredEffects.push(fn);
		fn();
	},
	{
		root: (fn: () => void) => {
			fn();
			return () => {};
		},
		pre: (fn: EffectFn) => {
			registeredEffects.push(fn);
			fn();
		},
		tracking: () => false,
	},
);

runes.$state = stateRune;
runes.$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
runes.$effect = effectRune;

const storageBacking = new Map<string, string>();
const storageListeners: ((event: unknown) => void)[] = [];

const localStorageShim = {
	getItem: (key: string) => (storageBacking.has(key) ? storageBacking.get(key)! : null),
	setItem: (key: string, value: string) => {
		storageBacking.set(key, String(value));
	},
	removeItem: (key: string) => {
		storageBacking.delete(key);
	},
	clear: () => storageBacking.clear(),
};

const windowShim = {
	__TAURI_INTERNALS__: { invoke: async () => 'macos' },
	addEventListener: (type: string, fn: (event: unknown) => void) => {
		if (type === 'storage') storageListeners.push(fn);
	},
	removeEventListener: (type: string, fn: (event: unknown) => void) => {
		if (type !== 'storage') return;
		const index = storageListeners.indexOf(fn);
		if (index >= 0) storageListeners.splice(index, 1);
	},
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageShim, configurable: true });
Object.defineProperty(globalThis, 'window', { value: windowShim, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true });

const settingsModule = await import('../src/lib/stores/settings.svelte.js');
const {
	CODE_FONT_SIZE_RANGE,
	EDITOR_FONT_SIZE_RANGE,
	EDITOR_MAX_WIDTH_RANGE,
	PREVIEW_FONT_SIZE_RANGE,
	SettingsStore,
	clampToRange,
	createSettingsPersistence,
	detectSystemLanguage,
	isSupportedLanguage,
	isWithinRange,
	parseStoredNumber,
	resolveLanguageTag,
	stepWithinRange,
	writeStoredSetting,
} = settingsModule;

type PersistedEntry = ReturnType<typeof createSettingsPersistence>[number];

const storeSource = readFileSync(new URL('../src/lib/stores/settings.svelte.ts', import.meta.url), 'utf8');
const componentSource = readFileSync(new URL('../src/lib/components/Settings.svelte', import.meta.url), 'utf8');

function resetStorage(seed: Record<string, string> = {}) {
	storageBacking.clear();
	for (const [key, value] of Object.entries(seed)) storageBacking.set(key, value);
}

/**
 * A stand-in store whose property reads are recorded. Values are plausible so
 * that the entries' normalizers behave, but only the *set of property names*
 * touched matters.
 */
function createRecordingStore(): { proxy: InstanceType<typeof SettingsStore>; reads: Set<string> } {
	const reads = new Set<string>();
	resetStorage();
	const real = new SettingsStore();
	const proxy = new Proxy(real, {
		get(target, property, receiver) {
			if (typeof property === 'string') reads.add(property);
			return Reflect.get(target, property, receiver);
		},
	});
	return { proxy, reads };
}

/*
 * ---------------------------------------------------------------------------
 * Task 1 — one localStorage entry per store field.
 * ---------------------------------------------------------------------------
 */

test('each persisted entry reads exactly one store field', () => {
	const entries = createSettingsPersistence();
	const { proxy, reads } = createRecordingStore();

	for (const entry of entries) {
		reads.clear();
		entry.read(proxy);
		assert.equal(
			reads.size,
			1,
			`entry "${entry.key}" reads ${reads.size} fields (${[...reads].join(', ')}); it must read exactly one`,
		);
	}
});

test('no store field is read by two persisted entries', () => {
	// Svelte's dependency tracking *is* "which properties did this effect read".
	// With one effect per entry, a field read by two entries would mean changing
	// it rewrites two keys — the multi-window clobbering bug in miniature. This
	// asserts the dependency graph is a bijection, not an approximation of one.
	const entries = createSettingsPersistence();
	const { proxy, reads } = createRecordingStore();
	const owner = new Map<string, string>();

	for (const entry of entries) {
		reads.clear();
		entry.read(proxy);
		for (const field of reads) {
			const previous = owner.get(field);
			assert.equal(
				previous,
				undefined,
				`field "${field}" is read by both "${previous}" and "${entry.key}"`,
			);
			owner.set(field, entry.key);
		}
	}

	assert.equal(owner.size, entries.length);
});

test('persisted keys are unique and cover the documented settings surface', () => {
	const entries = createSettingsPersistence();
	const keys = entries.map((entry) => entry.key);
	assert.equal(new Set(keys).size, keys.length, 'duplicate localStorage key');
	for (const key of ['editor.fontSize', 'editor.language', 'preview.maxWidth', 'editor.preZenState']) {
		assert.ok(keys.includes(key), `missing persisted key ${key}`);
	}
});

test('persistence installs one effect per key plus the storage listener', () => {
	// The regression this guards: a single effect that read every field, so any
	// one change rewrote all ~30 keys from a stale snapshot.
	resetStorage();
	storageListeners.length = 0;
	registeredEffects.length = 0;

	// Constructing the store is what installs the effects; the counts below are
	// the assertion. `assert.ok(store instanceof SettingsStore)` stood here and
	// could not fail — a constructor that throws fails the line above it, and
	// one that returns fails nothing.
	new SettingsStore();

	const entryCount = createSettingsPersistence().length;
	assert.equal(registeredEffects.length, entryCount + 1);
	assert.equal(storageListeners.length, 1);
});

test('changing one setting rewrites only that setting key', () => {
	const entries = createSettingsPersistence();
	resetStorage();
	const store = new SettingsStore();

	// Snapshot what each entry's effect last wrote, then re-run only the effects
	// whose single dependency actually changed — which is what Svelte does.
	const lastWritten = new Map(entries.map((entry) => [entry.key, entry.read(store)]));
	const flush = () => {
		const written: string[] = [];
		for (const entry of entries) {
			const next = entry.read(store);
			if (lastWritten.get(entry.key) === next) continue;
			lastWritten.set(entry.key, next);
			if (writeStoredSetting(entry.key, next)) written.push(entry.key);
		}
		return written;
	};

	flush();
	store.minimap = !store.minimap;
	assert.deepEqual(flush(), ['editor.minimap']);

	store.editorFontSize = 30;
	store.language = 'ja';
	assert.deepEqual(flush().sort(), ['editor.fontSize', 'editor.language']);
});

test('a second window no longer clobbers what the first window just changed', () => {
	// Window A and window B are separate webviews with separate store instances
	// over one shared localStorage.
	const entries = createSettingsPersistence();
	resetStorage();

	const windowA = new SettingsStore();
	const windowB = new SettingsStore(); // holds its own construction-time snapshot

	// A changes font size and language and persists just those two keys.
	windowA.editorFontSize = 30;
	windowA.language = 'ja';
	for (const entry of entries) writeStoredSetting(entry.key, entry.read(windowA));

	// B, still unaware, flips an unrelated toggle and persists only its own key.
	windowB.minimap = !windowB.minimap;
	const minimapEntry = entries.find((entry) => entry.key === 'editor.minimap') as PersistedEntry;
	writeStoredSetting(minimapEntry.key, minimapEntry.read(windowB));

	assert.equal(localStorageShim.getItem('editor.fontSize'), '30');
	assert.equal(localStorageShim.getItem('editor.language'), 'ja');

	// And a fresh window (a restart) sees A's changes intact.
	const restarted = new SettingsStore();
	assert.equal(restarted.editorFontSize, 30);
	assert.equal(restarted.language, 'ja');
});

test('storage events fold another window changes into this instance', () => {
	resetStorage();
	storageListeners.length = 0;
	const store = new SettingsStore();
	assert.equal(storageListeners.length, 1);
	const onStorage = storageListeners[0];

	// Another window wrote the value; localStorage already reflects it when the
	// event is delivered here.
	localStorageShim.setItem('editor.fontSize', '30');
	onStorage({ key: 'editor.fontSize', newValue: '30', storageArea: localStorageShim });
	assert.equal(store.editorFontSize, 30);

	localStorageShim.setItem('editor.language', 'ja');
	onStorage({ key: 'editor.language', newValue: 'ja', storageArea: localStorageShim });
	assert.equal(store.language, 'ja');
});

test('a value that arrived from localStorage is not written back', () => {
	// The anti-echo property. No flag is involved: the write-back is dropped
	// because compare-and-set finds the value already stored.
	const entries = createSettingsPersistence();
	resetStorage();
	storageListeners.length = 0;
	const store = new SettingsStore();
	const onStorage = storageListeners[0];
	const entry = entries.find((item) => item.key === 'editor.fontSize') as PersistedEntry;

	localStorageShim.setItem('editor.fontSize', '30');
	onStorage({ key: 'editor.fontSize', newValue: '30', storageArea: localStorageShim });

	// This is the follow-up effect run that a naive implementation would use to
	// echo the value straight back to the other window.
	assert.equal(writeStoredSetting(entry.key, entry.read(store)), false);
});

test('writeStoredSetting is compare-and-set and removes on null', () => {
	resetStorage();
	assert.equal(writeStoredSetting('demo.key', 'a'), true);
	assert.equal(writeStoredSetting('demo.key', 'a'), false);
	assert.equal(writeStoredSetting('demo.key', 'b'), true);
	assert.equal(writeStoredSetting('demo.key', null), true);
	assert.equal(localStorageShim.getItem('demo.key'), null);
	assert.equal(writeStoredSetting('demo.key', null), false);
});

test('a cleared localStorage is re-read rather than half-applied', () => {
	resetStorage({ 'editor.fontSize': '30' });
	storageListeners.length = 0;
	const store = new SettingsStore();
	assert.equal(store.editorFontSize, 30);

	storageBacking.clear();
	storageListeners[0]({ key: null, newValue: null, storageArea: localStorageShim });
	assert.equal(store.editorFontSize, EDITOR_FONT_SIZE_RANGE.default);
});

/*
 * ---------------------------------------------------------------------------
 * Task 2 — UI bounds and persisted bounds are the same constants.
 * ---------------------------------------------------------------------------
 */

test('font size ranges reach the maximum the UI already offers', () => {
	assert.equal(EDITOR_FONT_SIZE_RANGE.max, 48);
	assert.equal(PREVIEW_FONT_SIZE_RANGE.max, 48);
	assert.equal(CODE_FONT_SIZE_RANGE.max, 48);
	assert.equal(EDITOR_FONT_SIZE_RANGE.min, 10);
	assert.equal(PREVIEW_FONT_SIZE_RANGE.min, 12);
	assert.equal(CODE_FONT_SIZE_RANGE.min, 10);
	assert.deepEqual(
		{ min: EDITOR_MAX_WIDTH_RANGE.min, max: EDITOR_MAX_WIDTH_RANGE.max, default: EDITOR_MAX_WIDTH_RANGE.default },
		{ min: 20, max: 500, default: 80 },
	);
});

test('a size the UI allows survives a restart', () => {
	// Regression: 30 used to be clamped back to 24 (editor/code) or 28 (preview)
	// on load, so the value silently shrank on the next launch.
	resetStorage({
		'editor.fontSize': '30',
		'preview.fontSize': '40',
		'preview.codeFontSize': '48',
		'editor.maxWidth': '500',
	});
	const store = new SettingsStore();
	assert.equal(store.editorFontSize, 30);
	assert.equal(store.previewFontSize, 40);
	assert.equal(store.codeFontSize, 48);
	assert.equal(store.editorMaxWidth, 500);
});

test('values outside the shared range are still clamped on load', () => {
	resetStorage({ 'editor.fontSize': '900', 'preview.fontSize': '2', 'editor.maxWidth': '5000' });
	const store = new SettingsStore();
	assert.equal(store.editorFontSize, EDITOR_FONT_SIZE_RANGE.max);
	assert.equal(store.previewFontSize, PREVIEW_FONT_SIZE_RANGE.min);
	assert.equal(store.editorMaxWidth, EDITOR_MAX_WIDTH_RANGE.max);
});

test('the settings UI renders its bounds from the shared range constants', () => {
	for (const range of ['EDITOR_FONT_SIZE_RANGE', 'PREVIEW_FONT_SIZE_RANGE', 'CODE_FONT_SIZE_RANGE', 'EDITOR_MAX_WIDTH_RANGE']) {
		assert.match(componentSource, new RegExp(`min=\\{${range}\\.min\\}`), `${range} min not wired to the UI`);
		assert.match(componentSource, new RegExp(`max=\\{${range}\\.max\\}`), `${range} max not wired to the UI`);
	}
	assert.doesNotMatch(componentSource, /max="48"/, 'hard-coded UI bound left behind');
});

/*
 * ---------------------------------------------------------------------------
 * Task 3 — typed input is validated before it reaches the store.
 * ---------------------------------------------------------------------------
 */

test('an empty or unparseable field falls back to the default, never to null', () => {
	assert.equal(parseStoredNumber('', EDITOR_FONT_SIZE_RANGE), EDITOR_FONT_SIZE_RANGE.default);
	assert.equal(parseStoredNumber('   ', EDITOR_FONT_SIZE_RANGE), EDITOR_FONT_SIZE_RANGE.default);
	assert.equal(parseStoredNumber(null, EDITOR_FONT_SIZE_RANGE), EDITOR_FONT_SIZE_RANGE.default);
	assert.equal(parseStoredNumber('null', EDITOR_FONT_SIZE_RANGE), EDITOR_FONT_SIZE_RANGE.default);
	assert.equal(parseStoredNumber('abc', EDITOR_FONT_SIZE_RANGE), EDITOR_FONT_SIZE_RANGE.default);
	assert.equal(clampToRange(null, EDITOR_FONT_SIZE_RANGE), EDITOR_FONT_SIZE_RANGE.default);
	assert.equal(clampToRange(Number.NaN, EDITOR_FONT_SIZE_RANGE), EDITOR_FONT_SIZE_RANGE.default);
});

test('a half-typed value is neither accepted nor clamped mid-keystroke', () => {
	// Typing "18" passes through "1". Clamping there would jump the field to 10
	// and fight the user, so in-range is the acceptance test while typing.
	assert.equal(isWithinRange(1, EDITOR_FONT_SIZE_RANGE), false);
	assert.equal(isWithinRange(18, EDITOR_FONT_SIZE_RANGE), true);
	assert.equal(isWithinRange(4, EDITOR_MAX_WIDTH_RANGE), false);
	assert.equal(isWithinRange(40, EDITOR_MAX_WIDTH_RANGE), true);
	assert.equal(isWithinRange(Number.NaN, EDITOR_FONT_SIZE_RANGE), false);
	// ...and committing settles it inside the range.
	assert.equal(clampToRange(1, EDITOR_FONT_SIZE_RANGE), EDITOR_FONT_SIZE_RANGE.min);
	assert.equal(clampToRange(4, EDITOR_MAX_WIDTH_RANGE), EDITOR_MAX_WIDTH_RANGE.min);
});

test('spin buttons clamp with the same rules as typing', () => {
	assert.equal(stepWithinRange(EDITOR_FONT_SIZE_RANGE.max, 1, EDITOR_FONT_SIZE_RANGE), EDITOR_FONT_SIZE_RANGE.max);
	assert.equal(stepWithinRange(EDITOR_FONT_SIZE_RANGE.min, -1, EDITOR_FONT_SIZE_RANGE), EDITOR_FONT_SIZE_RANGE.min);
	assert.equal(stepWithinRange(47, 1, EDITOR_FONT_SIZE_RANGE), 48);
	assert.equal(stepWithinRange(490, 10, EDITOR_MAX_WIDTH_RANGE), 500);
	// A corrupt current value cannot escape the range either.
	assert.equal(stepWithinRange(Number.NaN, 1, EDITOR_FONT_SIZE_RANGE), EDITOR_FONT_SIZE_RANGE.default + 1);
});

test('numeric setting inputs are one-way bound and commit through the clamp', () => {
	const numericInputIds = ['editor-font-size', 'editor-max-width', 'preview-font-size', 'code-font-size'];
	for (const id of numericInputIds) {
		const input = sliceBetween(componentSource, `id="${id}"`, '/>');
		assert.doesNotMatch(input, /bind:value/, `${id} still uses a two-way number binding`);
		assert.match(input, /oninput=\{\(e\) => handleNumberInput\(/, `${id} does not validate input`);
		assert.match(input, /onchange=\{\(e\) => commitNumberInput\(/, `${id} does not clamp on change`);
		assert.match(input, /onblur=\{\(e\) => commitNumberInput\(/, `${id} does not clamp on blur`);
		assert.match(input, /onkeydown=\{\(e\) => handleNumberKeydown\(/, `${id} does not clamp on Enter`);
	}
	assert.match(componentSource, /function commitNumberInput[\s\S]{0,400}input\.value = String\(next\)/);
});

/*
 * ---------------------------------------------------------------------------
 * Task 4 — language tag resolution.
 * ---------------------------------------------------------------------------
 */

test('Norwegian BCP-47 tags resolve to the Norwegian catalogue entry', () => {
	// `no` is the macrolanguage; browsers report nb/nn.
	assert.equal(resolveLanguageTag('nb'), 'no');
	assert.equal(resolveLanguageTag('nb-NO'), 'no');
	assert.equal(resolveLanguageTag('nn'), 'no');
	assert.equal(resolveLanguageTag('nn-NO'), 'no');
	assert.equal(resolveLanguageTag('no'), 'no');
});

test('Dutch is not swallowed by the Norwegian rule', () => {
	assert.equal(resolveLanguageTag('nl'), 'nl');
	assert.equal(resolveLanguageTag('nl-NL'), 'nl');
	assert.equal(resolveLanguageTag('nl-BE'), 'nl');
});

test('Traditional Chinese is detected from the script subtag, not just the region', () => {
	assert.equal(resolveLanguageTag('zh-Hant'), 'zh-TW');
	assert.equal(resolveLanguageTag('zh-Hant-TW'), 'zh-TW');
	assert.equal(resolveLanguageTag('zh-Hant-HK'), 'zh-TW');
	assert.equal(resolveLanguageTag('zh-TW'), 'zh-TW');
	assert.equal(resolveLanguageTag('zh-HK'), 'zh-TW');
	assert.equal(resolveLanguageTag('zh-MO'), 'zh-TW');
	assert.equal(resolveLanguageTag('zh-Hans'), 'zh-CN');
	assert.equal(resolveLanguageTag('zh-Hans-CN'), 'zh-CN');
	assert.equal(resolveLanguageTag('zh'), 'zh-CN');
	assert.equal(resolveLanguageTag('zh-CN'), 'zh-CN');
});

test('regional variants and unsupported tags resolve predictably', () => {
	assert.equal(resolveLanguageTag('pt-BR'), 'pt-BR');
	assert.equal(resolveLanguageTag('pt'), 'pt');
	assert.equal(resolveLanguageTag('pt-PT'), 'pt');
	assert.equal(resolveLanguageTag('en_GB'), 'en');
	assert.equal(resolveLanguageTag('ar'), null);
	assert.equal(resolveLanguageTag('nog'), null); // used to match startsWith('no')
	assert.equal(resolveLanguageTag(''), null);
	assert.equal(resolveLanguageTag(null), null);
	assert.equal(resolveLanguageTag(undefined), null);
});

test('system detection falls back to English for unsupported locales', () => {
	Object.defineProperty(globalThis, 'navigator', { value: { language: 'ar-EG' }, configurable: true });
	assert.equal(detectSystemLanguage(), 'en');
	Object.defineProperty(globalThis, 'navigator', { value: { language: 'nb-NO' }, configurable: true });
	assert.equal(detectSystemLanguage(), 'no');
	Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true });
});

test('a stored language is validated against the catalogue', () => {
	resetStorage({ 'editor.language': 'klingon' });
	Object.defineProperty(globalThis, 'navigator', { value: { language: 'ja-JP' }, configurable: true });
	assert.equal(new SettingsStore().language, 'en'); // unchanged default, not the bogus code

	resetStorage();
	assert.equal(new SettingsStore().language, 'ja'); // nothing stored -> detect
	Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true });
});

test('the validator accepts exactly the languages the dialog offers', () => {
	// SUPPORTED_LANGUAGE_CODES is derived from getSupportedLanguages(), so the
	// first assertion is true by construction *today* — and that is the point.
	// It is the assertion that fails the moment someone re-forks the catalogue
	// into this module, which is how the two copies got here in the first place.
	// The `pt` drift the fork produced was in `name`/`nativeName`, which codes
	// cannot see; the `nativeName:` rule in singleImplementationConvention.test.ts
	// covers that half.
	const offered = getSupportedLanguages().map((entry) => entry.code);

	// Not by construction: `translations` and LANGUAGE_BY_PRIMARY_SUBTAG (via
	// resolveLanguageTag) are hand-maintained beside the catalogue. A language
	// offered in the <select> with no dictionary renders as raw English, and a
	// language the tag resolver can produce but the validator rejects makes
	// detectSystemLanguage's result unstorable.
	for (const code of offered) {
		assert.ok(translations[code], `${code} is offered by the language <select> but has no dictionary`);
	}
	assert.deepEqual(Object.keys(translations).sort(), [...offered].sort());

	for (const tag of ['nb', 'nn', 'pt-PT', 'pt-BR', 'zh-Hant', 'zh-Hans', 'en_GB']) {
		const resolved = resolveLanguageTag(tag);
		assert.ok(resolved && isSupportedLanguage(resolved), `${tag} resolves to ${resolved}, which will not survive a reload`);
	}
});

/*
 * ---------------------------------------------------------------------------
 * Task 5 — the settings dialog restores focus to whatever opened it.
 * ---------------------------------------------------------------------------
 */

test('the open effect neither reads the app version nor re-enters itself', () => {
	// The open effect is identified by what it reads, not by its indentation and
	// closing brace: the previous anchors were `'$effect(() => {\n\t\tif (show) {'`
	// and `'\n\t});'`, so reformatting the component silently moved this
	// assertion onto a different span of source.
	const openEffects = callbackBodies(componentSource, '$effect').filter((body) => /\bshow\b/.test(body));
	assert.equal(openEffects.length, 1, `expected exactly one $effect gated on show (got ${openEffects.length})`);
	const effectBody = openEffects[0];

	// Reading a state it also writes is what made the effect re-run and
	// re-capture the focus target from inside the dialog.
	assert.doesNotMatch(effectBody, /appVersion/, 'open effect still depends on appVersion');
	assert.match(componentSource, /function ensureAppVersion\(\)/);
	assert.match(componentSource, /let versionRequested = false;/);

	// `loaded` and `previousActiveElement` are read and written by this effect,
	// so they must not be reactive.
	assert.match(componentSource, /\n\tlet loaded = false;/);
	assert.match(componentSource, /\n\tlet previousActiveElement: HTMLElement \| null = null;/);
});

/*
 * ---------------------------------------------------------------------------
 * Structural guards on the store itself.
 * ---------------------------------------------------------------------------
 */

test('the store listens for cross-window storage events', () => {
	assert.match(storeSource, /addEventListener\('storage', onStorage\)/);
	assert.match(storeSource, /removeEventListener\('storage', onStorage\)/);
});

test('the store has no single effect that writes every key', () => {
	const setItemCalls = storeSource.match(/localStorage\.setItem\(/g) ?? [];
	assert.equal(setItemCalls.length, 1, 'localStorage writes must funnel through writeStoredSetting');
	assert.match(storeSource, /function writeStoredSetting[\s\S]{0,600}if \(current === value\) return false;/);
});
