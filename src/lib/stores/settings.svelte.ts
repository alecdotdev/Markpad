import { invoke } from '@tauri-apps/api/core';
import {
	DEFAULT_EDITOR_TOOLBAR_ORDER,
	applyEditorToolbarMove,
	getEditorToolbarAdjacentMove,
	getEditorToolbarReorderMove,
	normalizeEditorToolbarHidden,
	normalizeEditorToolbarOrder,
} from '../utils/editorToolbar.js';
import {
	DEFAULT_TITLEBAR_TOOLBAR_ORDER,
	DEFAULT_TITLEBAR_TOOLBAR_PLACEMENT,
	applyTitlebarToolbarMove,
	getTitlebarToolbarAdjacentMove,
	getTitlebarToolbarReorderMove,
	normalizeTitlebarToolbarHidden,
	normalizeTitlebarToolbarOrder,
	normalizeTitlebarToolbarPlacement,
	type TitlebarToolbarPlacement,
} from '../utils/titlebarToolbar.js';
import {
	DEFAULT_PREVIEW_MAX_WIDTH,
	normalizePreviewMaxWidth,
} from '../utils/previewWidth.js';

export type OSType = 'macos' | 'windows' | 'linux' | 'unknown';
export type LanguageCode =
	| 'en' // English
	| 'ja' // Japanese
	| 'zh-CN' // Chinese (Simplified)
	| 'zh-TW' // Chinese (Traditional)
	| 'ko' // Korean
	| 'ru' // Russian
	| 'es' // Spanish
	| 'fr' // French
	| 'de' // German
	| 'pt-BR' // Portuguese (Brazil)
	| 'it' // Italian
	| 'pl' // Polish
	| 'nl' // Dutch
	| 'sv' // Swedish
	| 'vi' // Vietnamese
	| 'pt' // Portuguese (European)
	| 'ro' // Romanian
	| 'hu' // Hungarian
	| 'cs' // Czech
	| 'sk' // Slovak
	| 'el' // Greek
	| 'fi' // Finnish
	| 'da' // Danish
	| 'no' // Norwegian
	| 'id' // Indonesian
	| 'tr'; // Turkish

const SUPPORTED_LANGUAGES: { code: LanguageCode; name: string; nativeName: string }[] = [
	{ code: 'cs', name: 'Czech', nativeName: 'Čeština' },
	{ code: 'da', name: 'Danish', nativeName: 'Dansk' },
	{ code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
	{ code: 'en', name: 'English', nativeName: 'English' },
	{ code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
	{ code: 'fr', name: 'French', nativeName: 'Français' },
	{ code: 'de', name: 'German', nativeName: 'Deutsch' },
	{ code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
	{ code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
	{ code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
	{ code: 'it', name: 'Italian', nativeName: 'Italiano' },
	{ code: 'ja', name: 'Japanese', nativeName: '日本語' },
	{ code: 'ko', name: 'Korean', nativeName: '한국어' },
	{ code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
	{ code: 'pl', name: 'Polish', nativeName: 'Polski' },
	{ code: 'pt', name: 'Portuguese (European)', nativeName: 'Português (Europeu)' },
	{ code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
	{ code: 'ro', name: 'Romanian', nativeName: 'Română' },
	{ code: 'ru', name: 'Russian', nativeName: 'Русский' },
	{ code: 'sk', name: 'Slovak', nativeName: 'Slovenčina' },
	{ code: 'es', name: 'Spanish', nativeName: 'Español' },
	{ code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
	{ code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
	{ code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
	{ code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
	{ code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
];

const SUPPORTED_LANGUAGE_CODES: readonly LanguageCode[] = SUPPORTED_LANGUAGES.map((entry) => entry.code);

function isSupportedLanguage(value: unknown): value is LanguageCode {
	return typeof value === 'string' && (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(value);
}

/**
 * Maps a BCP-47 *primary language subtag* to one of our catalogue entries.
 *
 * Matching is on the exact primary subtag rather than a `startsWith()` prefix:
 * prefix matching silently confuses distinct languages that share leading
 * letters (`nl` Dutch vs. `nn`/`nb` Norwegian), and it also matches unrelated
 * tags such as `nog` (Nogai).
 */
const LANGUAGE_BY_PRIMARY_SUBTAG: Readonly<Record<string, LanguageCode>> = {
	cs: 'cs',
	da: 'da',
	de: 'de',
	el: 'el',
	en: 'en',
	es: 'es',
	fi: 'fi',
	fr: 'fr',
	hu: 'hu',
	id: 'id',
	it: 'it',
	ja: 'ja',
	ko: 'ko',
	nl: 'nl',
	// Our catalogue is keyed by the `no` macrolanguage, but BCP-47 tags in the
	// wild are `nb` (Bokmål) or `nn` (Nynorsk); browsers essentially never
	// report a bare `no`. Accept all three.
	nb: 'no',
	nn: 'no',
	no: 'no',
	pl: 'pl',
	ro: 'ro',
	ru: 'ru',
	sk: 'sk',
	sv: 'sv',
	tr: 'tr',
	vi: 'vi',
};

/**
 * Resolves a BCP-47 language tag to a supported catalogue code, or `null` when
 * we have no translation for it. Pure so it can be unit-tested directly.
 */
export function resolveLanguageTag(tag: string | null | undefined): LanguageCode | null {
	if (typeof tag !== 'string') return null;
	const subtags = tag.trim().toLowerCase().split(/[-_]/).filter(Boolean);
	const primary = subtags[0];
	if (!primary) return null;
	const rest = subtags.slice(1);

	if (primary === 'zh') {
		// The script subtag is authoritative when present: `zh-Hant` and
		// `zh-Hant-TW` are Traditional even without a Traditional region, and
		// `zh-Hans-HK` is Simplified despite the Hong Kong region.
		if (rest.includes('hant')) return 'zh-TW';
		if (rest.includes('hans')) return 'zh-CN';
		if (rest.some((subtag) => subtag === 'tw' || subtag === 'hk' || subtag === 'mo')) return 'zh-TW';
		return 'zh-CN';
	}
	if (primary === 'pt') {
		return rest.includes('br') ? 'pt-BR' : 'pt';
	}
	return LANGUAGE_BY_PRIMARY_SUBTAG[primary] ?? null;
}

export function detectSystemLanguage(): LanguageCode {
	if (typeof navigator === 'undefined') return 'en';
	return resolveLanguageTag(navigator.language) ?? 'en';
}

export interface DefaultFonts {
	editorFont: string;
	previewFont: string;
	codeFont: string;
}

export const DEFAULT_FONTS: Record<OSType, DefaultFonts> = {
	macos: {
		editorFont: 'Menlo',
		previewFont: 'Helvetica Neue',
		codeFont: 'Menlo',
	},
	windows: {
		editorFont: 'Consolas',
		previewFont: 'Segoe UI',
		codeFont: 'Consolas',
	},
	linux: {
		editorFont: 'Monospace',
		previewFont: 'system-ui',
		codeFont: 'Monospace',
	},
	unknown: {
		editorFont: 'Consolas',
		previewFont: 'Segoe UI',
		codeFont: 'Consolas',
	},
};

/**
 * The allowed range of a numeric setting. Single source of truth: the settings
 * UI renders `min`/`max`/`step` from it and every write path (typing, spin
 * buttons, reset, load from localStorage) clamps against the same object, so
 * the UI can never offer a value that persistence would silently shrink.
 */
export interface NumericSettingRange {
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly default: number;
}

// Upper bound is 48 across all three font sizes: the spin buttons already let
// users reach 48, so profiles in the wild contain sizes above the old clamp of
// 24/28. Aligning persistence up to the UI keeps those settings; aligning the
// UI down to persistence would shrink an existing user's editor on upgrade.
export const EDITOR_FONT_SIZE_RANGE: NumericSettingRange = { min: 10, max: 48, step: 1, default: 14 };
export const PREVIEW_FONT_SIZE_RANGE: NumericSettingRange = { min: 12, max: 48, step: 1, default: 16 };
export const CODE_FONT_SIZE_RANGE: NumericSettingRange = { min: 10, max: 48, step: 1, default: 14 };
export const EDITOR_MAX_WIDTH_RANGE: NumericSettingRange = { min: 20, max: 500, step: 10, default: 80 };
export const TOC_WIDTH_RANGE: NumericSettingRange = { min: 180, max: 420, step: 1, default: 240 };

/** True when `value` is a finite number the user is allowed to commit as-is. */
export function isWithinRange(value: unknown, range: NumericSettingRange): boolean {
	return typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max;
}

/**
 * Coerces anything to an in-range integer, falling back to the range default.
 *
 * "No value" (null/undefined/empty) is the default rather than the minimum:
 * `Number(null)` is 0, so clamping it blindly would turn a cleared input into
 * the smallest legal font size instead of the one the user started with.
 */
export function clampToRange(value: unknown, range: NumericSettingRange): number {
	if (value === null || value === undefined || value === '') return range.default;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) return range.default;
	return Math.min(range.max, Math.max(range.min, Math.round(parsed)));
}

/** Parses a persisted string. Missing/blank/garbage all fall back to the default. */
export function parseStoredNumber(raw: string | null, range: NumericSettingRange): number {
	if (raw === null || raw.trim() === '') return range.default;
	return clampToRange(raw, range);
}

/** Spin-button helper: nudge by `delta` steps and clamp with the same rules. */
export function stepWithinRange(current: unknown, delta: number, range: NumericSettingRange): number {
	return clampToRange(clampToRange(current, range) + delta, range);
}

function parseStoredStringList(value: string | null): string[] | null {
	if (value === null) return null;
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : null;
	} catch {
		return null;
	}
}

function parseStoredRecord(value: string | null): Record<string, unknown> | null {
	if (value === null) return null;
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
	} catch {
		return null;
	}
}

/**
 * One persisted localStorage entry.
 *
 * `read` must touch **exactly one** field of the target. That is not a style
 * rule: `read` runs inside the entry's own `$effect`, so whatever it reads
 * becomes that effect's dependency set, and every dependency is a field whose
 * change rewrites this key. A `read` that touched two fields would resurrect
 * the multi-window bug this shape exists to fix.
 */
export interface PersistedSetting<T> {
	readonly key: string;
	/** Serializes this entry's single field. `null` means "remove the key". */
	readonly read: (target: T) => string | null;
	/** Applies a stored (or remotely changed) raw value back onto that field. */
	readonly load: (target: T, raw: string | null) => void;
}

/**
 * Compare-and-set write. Returns true when localStorage actually changed.
 *
 * This is the whole anti-echo mechanism for cross-window sync, and it is why no
 * "I am currently applying a remote change" flag is involved. Such a flag
 * cannot work here: Svelte flushes effects asynchronously, so a flag raised and
 * lowered synchronously inside a `storage` handler is long gone by the time the
 * dependent effect runs — and holding it up until the next flush would also
 * swallow genuine local edits made in the same tick.
 *
 * Reading before writing needs no timing assumption at all. A value that
 * arrived *from* localStorage is by definition already equal to what is stored,
 * so the write-back is dropped at its source and the
 * `storage` -> state -> effect -> write -> `storage` loop terminates after one
 * hop. It also makes redundant writes free in the ordinary single-window case.
 */
export function writeStoredSetting(key: string, value: string | null): boolean {
	if (typeof localStorage === 'undefined') return false;
	const current = localStorage.getItem(key);
	if (value === null) {
		if (current === null) return false;
		localStorage.removeItem(key);
		return true;
	}
	if (current === value) return false;
	localStorage.setItem(key, value);
	return true;
}

/** Applies everything currently in localStorage onto `target`. */
function loadPersistedSettings<T>(target: T, entries: readonly PersistedSetting<T>[]): void {
	if (typeof localStorage === 'undefined') return;
	for (const entry of entries) {
		entry.load(target, localStorage.getItem(entry.key));
	}
}

/**
 * Wires `entries` up to localStorage. Must be called inside an effect root.
 *
 * One effect per key, instead of one effect reading every field: a change to
 * setting A then rewrites only A's key. Markpad opens several windows, each a
 * separate webview with its own store instance, all sharing one localStorage —
 * with a single all-fields effect, any change in window B rewrote all ~30 keys
 * from B's construction-time snapshot and threw away whatever window A had just
 * changed.
 *
 * The `storage` listener closes the other half: localStorage fires it in every
 * *other* same-origin document, so each window folds its siblings' changes into
 * its own state instead of drifting until the next restart.
 */
function installPersistedSettings<T>(target: T, entries: readonly PersistedSetting<T>[]): void {
	for (const entry of entries) {
		$effect(() => {
			writeStoredSetting(entry.key, entry.read(target));
		});
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));
		const onStorage = (event: StorageEvent) => {
			if (event.storageArea && typeof localStorage !== 'undefined' && event.storageArea !== localStorage) return;
			// A null key means the whole store was cleared; re-read everything.
			if (event.key === null) {
				loadPersistedSettings(target, entries);
				return;
			}
			const entry = entriesByKey.get(event.key);
			if (entry) entry.load(target, event.newValue);
		};
		window.addEventListener('storage', onStorage);
		return () => window.removeEventListener('storage', onStorage);
	});
}

export class SettingsStore {
	minimap = $state(false);
	wordWrap = $state('on');
	lineNumbers = $state('on');
	vimMode = $state(false);
	statusBar = $state(true);
	wordCount = $state(false);
	renderLineHighlight = $state('line');
	highlightColor = $state('yellow');
	showTabs = $state(true);
	restoreStateOnReopen = $state(true);
	zenMode = $state(false);
	showToc = $state(false);
	preZenState = $state<{
		renderLineHighlight: string;
		showTabs: boolean;
		statusBar: boolean;
		minimap: boolean;
		lineNumbers: string;
		showToc: boolean;
	} | null>(null);
	occurrencesHighlight = $state(false);
	showWhitespace = $state(false);
	startInEditor = $state(false);
	newFileDefaultMode = $state(true);
	showRecentFiles = $state(true);
	editorMaxWidth = $state(80);
	previewMaxWidth = $state(DEFAULT_PREVIEW_MAX_WIDTH);
	pinnedToc = $state(false);
	tocSide = $state<'left' | 'right'>('left');
	tocWidth = $state(240);
	osType = $state<OSType>('unknown');
	imageDirectory = $state('img');
	macosImageScaling = $state(true);
	language = $state<LanguageCode>('en');
	showEditorToolbar = $state(true);
	editorToolbarOrder = $state<string[]>([...DEFAULT_EDITOR_TOOLBAR_ORDER]);
	editorToolbarHidden = $state<string[]>([]);
	titlebarToolbarOrder = $state<string[]>([...DEFAULT_TITLEBAR_TOOLBAR_ORDER]);
	titlebarToolbarHidden = $state<string[]>([]);
	titlebarToolbarPlacement = $state<Record<string, TitlebarToolbarPlacement>>({ ...DEFAULT_TITLEBAR_TOOLBAR_PLACEMENT });

	editorFont = $state('Consolas');
	editorFontSize = $state(14);
	previewFont = $state('Segoe UI');
	previewFontSize = $state(16);
	codeFont = $state('Consolas');
	codeFontSize = $state(14);

	// File-save behavior. autoSave = silently persist edits without Cmd+S.
	// confirmBeforeSave = if true, keep the unsaved-changes modals on close/toggle
	// (i.e. ask for confirmation) even when autoSave is on.
	autoSave = $state(true);
	confirmBeforeSave = $state(false);

	constructor() {
		if (typeof localStorage === 'undefined') return;

		const entries = createSettingsPersistence();

		// Whether a font *family* was ever chosen has to be sampled before the
		// write effects run, because those effects seed every key with the
		// current value; asking localStorage later would always find something.
		const hasStoredFontFamily = {
			editorFont: localStorage.getItem('editor.font') !== null,
			previewFont: localStorage.getItem('preview.font') !== null,
			codeFont: localStorage.getItem('preview.codeFont') !== null,
		};

		loadPersistedSettings(this, entries);

		// Font families default per OS, and the OS is only known once the
		// backend answers. Re-apply just the ones the user never picked.
		this.initOSType().then(() => {
			const defaults = DEFAULT_FONTS[this.osType];
			if (!hasStoredFontFamily.editorFont) this.editorFont = defaults.editorFont;
			if (!hasStoredFontFamily.previewFont) this.previewFont = defaults.previewFont;
			if (!hasStoredFontFamily.codeFont) this.codeFont = defaults.codeFont;
		});

		$effect.root(() => {
			installPersistedSettings(this, entries);
		});
	}

	toggleMinimap() {
		this.minimap = !this.minimap;
	}

	toggleWordWrap() {
		if (this.wordWrap === 'off') {
			this.wordWrap = 'on';
		} else if (this.wordWrap === 'on') {
			this.wordWrap = 'wordWrapColumn';
		} else {
			this.wordWrap = 'off';
		}
	}

	toggleLineNumbers() {
		this.lineNumbers = this.lineNumbers === 'on' ? 'off' : 'on';
	}

	toggleVimMode() {
		this.vimMode = !this.vimMode;
	}

	toggleStatusBar() {
		this.statusBar = !this.statusBar;
	}

	toggleWordCount() {
		this.wordCount = !this.wordCount;
	}

	toggleLineHighlight() {
		this.renderLineHighlight = this.renderLineHighlight === 'line' ? 'none' : 'line';
	}

	toggleTabs() {
		this.showTabs = !this.showTabs;
	}

	toggleRestoreStateOnReopen() {
		this.restoreStateOnReopen = !this.restoreStateOnReopen;
	}

	toggleShowRecentFiles() {
		this.showRecentFiles = !this.showRecentFiles;
	}

	toggleZenMode() {
		this.zenMode = !this.zenMode;
		if (this.zenMode) {
			this.preZenState = {
				renderLineHighlight: this.renderLineHighlight,
				showTabs: this.showTabs,
				statusBar: this.statusBar,
				minimap: this.minimap,
				lineNumbers: this.lineNumbers,
				showToc: this.showToc,
			};
			this.renderLineHighlight = 'none';
			this.showTabs = false;
			this.statusBar = false;
			this.minimap = false;
			this.lineNumbers = 'off';
			this.showToc = false;
		} else {
			if (this.preZenState) {
				this.renderLineHighlight = this.preZenState.renderLineHighlight;
				this.showTabs = this.preZenState.showTabs;
				this.statusBar = this.preZenState.statusBar;
				this.minimap = this.preZenState.minimap;
				this.lineNumbers = this.preZenState.lineNumbers;
				this.showToc = this.preZenState.showToc;
				this.preZenState = null;
			}
		}
	}

	toggleToc() {
		this.showToc = !this.showToc;
	}

	toggleOccurrencesHighlight() {
		this.occurrencesHighlight = !this.occurrencesHighlight;
	}

	toggleShowWhitespace() {
		this.showWhitespace = !this.showWhitespace;
	}

	toggleStartInEditor() {
		this.startInEditor = !this.startInEditor;
	}

	toggleNewFileDefaultMode() {
		this.newFileDefaultMode = !this.newFileDefaultMode;
	}

	togglePinnedToc() {
		this.pinnedToc = !this.pinnedToc;
	}

	toggleTocSide() {
		this.tocSide = this.tocSide === 'left' ? 'right' : 'left';
	}

	setTocWidth(width: number) {
		this.tocWidth = clampToRange(width, TOC_WIDTH_RANGE);
	}

	toggleMacosImageScaling() {
		this.macosImageScaling = !this.macosImageScaling;
	}

	toggleAutoSave() {
		this.autoSave = !this.autoSave;
	}

	toggleConfirmBeforeSave() {
		this.confirmBeforeSave = !this.confirmBeforeSave;
	}

	setLanguage(lang: LanguageCode) {
		this.language = lang;
	}

	toggleEditorToolbar() {
		this.showEditorToolbar = !this.showEditorToolbar;
	}

	setEditorToolbarToolVisible(id: string, visible: boolean) {
		const hidden = normalizeEditorToolbarHidden(this.editorToolbarHidden);
		if (visible) {
			this.editorToolbarHidden = hidden.filter((hiddenId) => hiddenId !== id);
		} else if (!hidden.includes(id)) {
			this.editorToolbarHidden = normalizeEditorToolbarHidden([...hidden, id]);
		}
	}

	moveEditorToolbarTool(id: string, direction: 'up' | 'down') {
		const move = getEditorToolbarAdjacentMove(this.editorToolbarOrder, id, direction);
		if (!move) return;
		this.editorToolbarOrder = applyEditorToolbarMove(this.editorToolbarOrder, move);
	}

	reorderEditorToolbarTool(draggedId: string, targetId: string) {
		const move = getEditorToolbarReorderMove(this.editorToolbarOrder, draggedId, targetId);
		if (!move) return;
		this.editorToolbarOrder = applyEditorToolbarMove(this.editorToolbarOrder, move);
	}

	resetEditorToolbar() {
		this.editorToolbarOrder = [...DEFAULT_EDITOR_TOOLBAR_ORDER];
		this.editorToolbarHidden = [];
	}

	setTitlebarToolbarActionVisible(id: string, visible: boolean) {
		const hidden = normalizeTitlebarToolbarHidden(this.titlebarToolbarHidden);
		if (visible) {
			this.titlebarToolbarHidden = hidden.filter((hiddenId) => hiddenId !== id);
		} else if (!hidden.includes(id)) {
			this.titlebarToolbarHidden = normalizeTitlebarToolbarHidden([...hidden, id]);
		}
	}

	setTitlebarToolbarActionPlacement(id: string, placement: TitlebarToolbarPlacement) {
		this.titlebarToolbarPlacement = normalizeTitlebarToolbarPlacement({
			...this.titlebarToolbarPlacement,
			[id]: placement,
		});
	}

	moveTitlebarToolbarAction(id: string, direction: 'up' | 'down') {
		const move = getTitlebarToolbarAdjacentMove(this.titlebarToolbarOrder, id, direction);
		if (!move) return;
		this.titlebarToolbarOrder = applyTitlebarToolbarMove(this.titlebarToolbarOrder, move);
	}

	reorderTitlebarToolbarAction(draggedId: string, targetId: string) {
		const move = getTitlebarToolbarReorderMove(this.titlebarToolbarOrder, draggedId, targetId);
		if (!move) return;
		this.titlebarToolbarOrder = applyTitlebarToolbarMove(this.titlebarToolbarOrder, move);
	}

	resetTitlebarToolbar() {
		this.titlebarToolbarOrder = [...DEFAULT_TITLEBAR_TOOLBAR_ORDER];
		this.titlebarToolbarHidden = [];
		this.titlebarToolbarPlacement = { ...DEFAULT_TITLEBAR_TOOLBAR_PLACEMENT };
	}

	resetEditorMaxWidth() {
		this.editorMaxWidth = EDITOR_MAX_WIDTH_RANGE.default;
	}

	resetPreviewMaxWidth() {
		this.previewMaxWidth = DEFAULT_PREVIEW_MAX_WIDTH;
	}

	async initOSType() {
		try {
			const osType = await invoke<string>('get_os_type');
			this.osType = osType as OSType;
		} catch (e) {
			console.error('Failed to get OS type:', e);
			this.osType = 'unknown';
		}
	}

	resetEditorFont() {
		const defaults = DEFAULT_FONTS[this.osType];
		this.editorFont = defaults.editorFont;
		this.editorFontSize = EDITOR_FONT_SIZE_RANGE.default;
	}

	resetPreviewFont() {
		const defaults = DEFAULT_FONTS[this.osType];
		this.previewFont = defaults.previewFont;
		this.previewFontSize = PREVIEW_FONT_SIZE_RANGE.default;
		this.codeFont = defaults.codeFont;
		this.codeFontSize = CODE_FONT_SIZE_RANGE.default;
	}
}

function booleanSetting(
	key: string,
	read: (target: SettingsStore) => boolean,
	load: (target: SettingsStore, value: boolean) => void,
): PersistedSetting<SettingsStore> {
	return {
		key,
		read: (target) => String(read(target)),
		load: (target, raw) => {
			if (raw !== null) load(target, raw === 'true');
		},
	};
}

function stringSetting(
	key: string,
	read: (target: SettingsStore) => string,
	load: (target: SettingsStore, value: string) => void,
): PersistedSetting<SettingsStore> {
	return {
		key,
		read,
		load: (target, raw) => {
			if (raw !== null) load(target, raw);
		},
	};
}

function numberSetting(
	key: string,
	range: NumericSettingRange,
	read: (target: SettingsStore) => number,
	load: (target: SettingsStore, value: number) => void,
): PersistedSetting<SettingsStore> {
	return {
		key,
		read: (target) => String(read(target)),
		load: (target, raw) => load(target, parseStoredNumber(raw, range)),
	};
}

/**
 * The complete localStorage contract of {@link SettingsStore}: one entry per
 * key, and — by construction — one store field per entry.
 *
 * Adding a setting means adding one entry here; load and save then cannot drift
 * apart, and cross-window sync comes for free because
 * {@link installPersistedSettings} reuses `load` for incoming `storage` events.
 */
export function createSettingsPersistence(): PersistedSetting<SettingsStore>[] {
	return [
		booleanSetting('editor.minimap', (s) => s.minimap, (s, v) => { s.minimap = v; }),
		stringSetting('editor.wordWrap', (s) => s.wordWrap, (s, v) => { s.wordWrap = v; }),
		stringSetting('editor.lineNumbers', (s) => s.lineNumbers, (s, v) => { s.lineNumbers = v; }),
		booleanSetting('editor.vimMode', (s) => s.vimMode, (s, v) => { s.vimMode = v; }),
		booleanSetting('editor.statusBar', (s) => s.statusBar, (s, v) => { s.statusBar = v; }),
		booleanSetting('editor.wordCount', (s) => s.wordCount, (s, v) => { s.wordCount = v; }),
		stringSetting('editor.renderLineHighlight', (s) => s.renderLineHighlight, (s, v) => { s.renderLineHighlight = v; }),
		booleanSetting('editor.showTabs', (s) => s.showTabs, (s, v) => { s.showTabs = v; }),
		booleanSetting('editor.restoreStateOnReopen', (s) => s.restoreStateOnReopen, (s, v) => { s.restoreStateOnReopen = v; }),
		booleanSetting('editor.zenMode', (s) => s.zenMode, (s, v) => { s.zenMode = v; }),
		booleanSetting('editor.occurrencesHighlight', (s) => s.occurrencesHighlight, (s, v) => { s.occurrencesHighlight = v; }),
		booleanSetting('editor.showWhitespace', (s) => s.showWhitespace, (s, v) => { s.showWhitespace = v; }),
		booleanSetting('editor.showToc', (s) => s.showToc, (s, v) => { s.showToc = v; }),
		stringSetting('editor.highlightColor', (s) => s.highlightColor, (s, v) => { s.highlightColor = v; }),
		booleanSetting('editor.startInEditor', (s) => s.startInEditor, (s, v) => { s.startInEditor = v; }),
		booleanSetting('editor.newFileDefaultMode', (s) => s.newFileDefaultMode, (s, v) => { s.newFileDefaultMode = v; }),
		booleanSetting('editor.showRecentFiles', (s) => s.showRecentFiles, (s, v) => { s.showRecentFiles = v; }),
		numberSetting('editor.maxWidth', EDITOR_MAX_WIDTH_RANGE, (s) => s.editorMaxWidth, (s, v) => { s.editorMaxWidth = v; }),
		{
			key: 'preview.maxWidth',
			read: (s) => String(s.previewMaxWidth),
			load: (s, savedPreviewMaxWidth) => { s.previewMaxWidth = normalizePreviewMaxWidth(savedPreviewMaxWidth); },
		},
		booleanSetting('editor.pinnedToc', (s) => s.pinnedToc, (s, v) => { s.pinnedToc = v; }),
		{
			key: 'editor.tocSide',
			read: (s) => s.tocSide,
			load: (s, raw) => {
				if (raw === 'left' || raw === 'right') s.tocSide = raw;
			},
		},
		numberSetting('editor.tocWidth', TOC_WIDTH_RANGE, (s) => s.tocWidth, (s, v) => { s.tocWidth = v; }),
		stringSetting('editor.imageDirectory', (s) => s.imageDirectory, (s, v) => { s.imageDirectory = v; }),
		booleanSetting('editor.macosImageScaling', (s) => s.macosImageScaling, (s, v) => { s.macosImageScaling = v; }),
		{
			key: 'editor.language',
			read: (s) => s.language,
			load: (s, raw) => {
				if (raw === null) {
					s.language = detectSystemLanguage();
				} else if (isSupportedLanguage(raw)) {
					s.language = raw;
				}
			},
		},
		booleanSetting('editor.showEditorToolbar', (s) => s.showEditorToolbar, (s, v) => { s.showEditorToolbar = v; }),
		{
			key: 'editor.toolbarOrder',
			read: (s) => JSON.stringify(normalizeEditorToolbarOrder(s.editorToolbarOrder)),
			load: (s, raw) => { s.editorToolbarOrder = normalizeEditorToolbarOrder(parseStoredStringList(raw)); },
		},
		{
			key: 'editor.toolbarHidden',
			read: (s) => JSON.stringify(normalizeEditorToolbarHidden(s.editorToolbarHidden)),
			load: (s, raw) => { s.editorToolbarHidden = normalizeEditorToolbarHidden(parseStoredStringList(raw)); },
		},
		{
			key: 'titlebar.toolbarOrder',
			read: (s) => JSON.stringify(normalizeTitlebarToolbarOrder(s.titlebarToolbarOrder)),
			load: (s, raw) => { s.titlebarToolbarOrder = normalizeTitlebarToolbarOrder(parseStoredStringList(raw)); },
		},
		{
			key: 'titlebar.toolbarHidden',
			read: (s) => JSON.stringify(normalizeTitlebarToolbarHidden(s.titlebarToolbarHidden)),
			load: (s, raw) => { s.titlebarToolbarHidden = normalizeTitlebarToolbarHidden(parseStoredStringList(raw)); },
		},
		{
			key: 'titlebar.toolbarPlacement',
			read: (s) => JSON.stringify(normalizeTitlebarToolbarPlacement(s.titlebarToolbarPlacement)),
			load: (s, raw) => { s.titlebarToolbarPlacement = normalizeTitlebarToolbarPlacement(parseStoredRecord(raw)); },
		},
		stringSetting('editor.font', (s) => s.editorFont, (s, v) => { s.editorFont = v; }),
		numberSetting('editor.fontSize', EDITOR_FONT_SIZE_RANGE, (s) => s.editorFontSize, (s, v) => { s.editorFontSize = v; }),
		stringSetting('preview.font', (s) => s.previewFont, (s, v) => { s.previewFont = v; }),
		numberSetting('preview.fontSize', PREVIEW_FONT_SIZE_RANGE, (s) => s.previewFontSize, (s, v) => { s.previewFontSize = v; }),
		stringSetting('preview.codeFont', (s) => s.codeFont, (s, v) => { s.codeFont = v; }),
		numberSetting('preview.codeFontSize', CODE_FONT_SIZE_RANGE, (s) => s.codeFontSize, (s, v) => { s.codeFontSize = v; }),
		booleanSetting('editor.autoSave', (s) => s.autoSave, (s, v) => { s.autoSave = v; }),
		booleanSetting('editor.confirmBeforeSave', (s) => s.confirmBeforeSave, (s, v) => { s.confirmBeforeSave = v; }),
		{
			key: 'editor.preZenState',
			read: (s) => (s.preZenState ? JSON.stringify(s.preZenState) : null),
			load: (s, raw) => {
				if (raw === null) {
					s.preZenState = null;
					return;
				}
				try {
					s.preZenState = JSON.parse(raw);
				} catch (e) {
					console.error('Failed to parse preZenState', e);
				}
			},
		},
	];
}

export const settings = new SettingsStore();
