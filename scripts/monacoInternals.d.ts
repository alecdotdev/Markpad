// Types for the two Monaco internals `editorOptionWiring.test.ts` drives
// directly.
//
// Monaco ships declarations for its public API surface (`monaco-editor`) only.
// The option registry and the Unicode highlighter are plain ESM modules that
// resolve at runtime — Editor.svelte already deep-imports `monaco-editor/esm/…`
// for its five workers — but they carry no `.d.ts`, so `npm run check` reads
// them as implicit `any`.
//
// They are declared here rather than left as `any` because the test asserts on
// what comes back out of them: `ambiguousCharacterCount` silently becoming
// `undefined` after a Monaco upgrade would turn `assert.equal(count, 0)` into a
// test that passes while checking nothing. Narrow declarations make that a type
// error instead. A module that moves outright fails loudly at import time.
//
// Only the members the test calls are declared. This is not an attempt to type
// Monaco's internals in general.

declare module 'monaco-editor/esm/vs/editor/common/config/editorOptions.js' {
	/** Sentinel default for the options gated on workspace trust. */
	export const inUntrustedWorkspace: 'inUntrustedWorkspace';

	export interface UnicodeHighlightOptions {
		nonBasicASCII: boolean | 'inUntrustedWorkspace';
		invisibleCharacters: boolean;
		ambiguousCharacters: boolean;
		includeComments: boolean | 'inUntrustedWorkspace';
		includeStrings: boolean | 'inUntrustedWorkspace';
		allowedCharacters: Record<string, boolean>;
		allowedLocales: Record<string, boolean>;
	}

	export const EditorOptions: {
		unicodeHighlight: {
			readonly defaultValue: UnicodeHighlightOptions;
			/** Merges a partial option object over `value`, as `editor.create` does. */
			applyUpdate(
				value: UnicodeHighlightOptions,
				update: unknown,
			): { newValue: UnicodeHighlightOptions };
		};
	};
}

declare module 'monaco-editor/esm/vs/editor/common/services/unicodeTextModelHighlighter.js' {
	export interface UnicodeHighlightRange {
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
	}

	export interface UnicodeHighlightResult {
		ranges: UnicodeHighlightRange[];
		ambiguousCharacterCount: number;
		invisibleCharacterCount: number;
		nonBasicAsciiCharacterCount: number;
		hasMore: boolean;
	}

	/** The minimum of `ITextModel` the highlighter reads. */
	export interface HighlightableModel {
		getLineCount(): number;
		getLineContent(lineNumber: number): string;
	}

	/**
	 * Resolved form of `UnicodeHighlightOptions`: the workspace-trust sentinels
	 * are already collapsed to booleans, and the two allow-maps are flattened to
	 * lists by the caller.
	 */
	export interface ResolvedUnicodeHighlightOptions {
		nonBasicASCII: boolean;
		ambiguousCharacters: boolean;
		invisibleCharacters: boolean;
		includeComments: boolean;
		includeStrings: boolean;
		allowedCodePoints: (number | undefined)[];
		allowedLocales: string[];
	}

	export const UnicodeTextModelHighlighter: {
		computeUnicodeHighlights(
			model: HighlightableModel,
			options: ResolvedUnicodeHighlightOptions,
		): UnicodeHighlightResult;
	};
}

// The four modules formatShortcutKeymap.test.ts drives to turn Markpad's
// keybinding numbers back into chords.
//
// `KeyMod` and `KeyCode` are re-exported by the `monaco-editor` entry point with
// full declarations, but that entry point evaluates Monaco's whole browser-side
// graph on import and cannot run under Node. These are the same two objects,
// reached at the modules that define them, plus the decoder that reads what they
// produce.

declare module 'monaco-editor/esm/vs/editor/common/services/editorBaseApi.js' {
	/** Modifier bits, and the chord-sequence packer. Identical to `monaco.KeyMod`. */
	export const KeyMod: {
		readonly CtrlCmd: number;
		readonly Shift: number;
		readonly Alt: number;
		readonly WinCtrl: number;
		chord(firstPart: number, secondPart: number): number;
	};
}

declare module 'monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js' {
	/**
	 * Typed as an index rather than member by member: the test reads
	 * `KeyCode.KeyA + n` and `KeyCode.Digit0 + n` to build its key table, and
	 * enumerating 100 members here would add a second place for them to be wrong.
	 * A member that disappears in a Monaco upgrade surfaces as a NaN keybinding,
	 * which every assertion in that file fails on.
	 */
	export const KeyCode: Record<string, number>;
}

declare module 'monaco-editor/esm/vs/base/common/keyCodes.js' {
	export const KeyCodeUtils: {
		/** The printable name Monaco gives a KeyCode — `KeyE` -> "E", `Period` -> ".". */
		toString(keyCode: number): string;
	};
}

declare module 'monaco-editor/esm/vs/base/common/keybindings.js' {
	/** One keystroke of a resolved keybinding. */
	export interface KeyCodeChord {
		readonly ctrlKey: boolean;
		readonly shiftKey: boolean;
		readonly altKey: boolean;
		readonly metaKey: boolean;
		readonly keyCode: number;
	}

	/**
	 * Splits a `KeyMod`/`KeyCode` number into the chords it means on `os`, which
	 * is where `CtrlCmd` becomes Meta or Ctrl. Null for a number that decodes to
	 * nothing, so callers must check.
	 */
	export function decodeKeybinding(
		keybinding: number,
		os: 1 | 2 | 3,
	): { readonly chords: readonly KeyCodeChord[] } | null;
}
