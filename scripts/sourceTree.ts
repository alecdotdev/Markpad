import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Shared plumbing for the few tests that have to read `src/` as text.
//
// They exist because some contracts are invisible to the compiler: a Tauri
// command name is a string, `.svelte` files cannot be imported by the Node test
// runner, and "this behaviour has exactly one implementation" is not a type.
// Everything else belongs in a test that imports the real function and runs it.
//
// Three copies of `walk()` used to live in singleImplementationConvention,
// renderPipelineConvention and previewSanitize; the DOMPurify allowlist was
// maintained twice. One copy each, here.

export type SourceFile = { path: string; text: string };

/** Every compilable source file under `dir`, with forward-slash paths. */
export function walkSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...walkSourceFiles(path));
		else if (/\.(ts|svelte|js)$/.test(name)) out.push(path.replace(/\\/g, '/'));
	}
	return out;
}

export function readSourceFiles(dir: string): SourceFile[] {
	return walkSourceFiles(dir).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}

/** src-relative paths of the files that contain `marker`, sorted. */
export function filesMatching(sources: SourceFile[], marker: RegExp): string[] {
	return sources
		.filter(({ text }) => new RegExp(marker.source, marker.flags.replace('g', '')).test(text))
		.map(({ path }) => path)
		.sort();
}

/**
 * The only files allowed to hand DOMPurify a configuration.
 *
 * `sanitize.ts` owns the document policy; `richContent.ts` sanitizes Mermaid's
 * own SVG output, which needs `foreignObject` and the inline `<style>` the
 * document policy forbids — a different input under a deliberately different
 * config. Both `previewSanitize.test.ts` (call sites) and
 * `singleImplementationConvention.test.ts` (imports) key off this one list, so
 * adding a sanitizer is one edit and one decision instead of two.
 */
export const SANITIZER_FILES = ['src/lib/utils/richContent.ts', 'src/lib/utils/sanitize.ts'];

/**
 * The name of the top-level `<script>`/module function whose body contains
 * `index`, or null if the offset sits outside every function.
 *
 * Used instead of "the two strings appear within N characters of each other":
 * a proximity window silently stops guarding when the function grows, and it
 * cannot see a *second* call site that escaped the wrapper entirely. Both files
 * this serves declare their functions at one level of indentation, which is
 * what makes the enclosing function findable without parsing braces (and
 * without being fooled by braces inside strings, regexes or Svelte templates).
 */
export function enclosingFunctionName(text: string, index: number): string | null {
	const declarations = [...text.matchAll(/\n\t(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)];
	let enclosing: string | null = null;
	for (const declaration of declarations) {
		if (declaration.index! > index) break;
		enclosing = declaration[1];
	}
	return enclosing;
}

/** Byte offsets of every `name(` call in `text`, skipping import statements. */
export function callSiteOffsets(text: string, name: string): number[] {
	const offsets: number[] = [];
	const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'g');
	for (const match of text.matchAll(pattern)) {
		const lineStart = text.lastIndexOf('\n', match.index!) + 1;
		if (/^\s*import\b/.test(text.slice(lineStart, match.index!))) continue;
		offsets.push(match.index!);
	}
	return offsets;
}
