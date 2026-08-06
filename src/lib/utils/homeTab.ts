/**
 * The home screen is not a document, but it lives in a tab — and a tab
 * identifies itself by `path`. So the home tab carries a sentinel string where
 * every other tab carries a filesystem path.
 *
 * The sentinel is spelled here and nowhere else. It used to be spelled at ten
 * separate comparison sites, and the one place that mattered most — the render
 * gate in MarkdownViewer.svelte — was not among them: it recognised the home
 * tab as `path === '' && title === 'Recents'`, which described the home tab as
 * it was first written and nothing since (#392). A literal that only some of
 * its readers know about is a literal that can fall out of step in silence, so
 * `singleImplementationConvention.test.ts` pins the string to this file.
 *
 * A tab kind is not really a path, and nothing stops a document from being
 * opened at a relative path spelled exactly `HOME`. Neither is fixed here, but
 * both are now a single edit rather than a search-and-replace.
 *
 * Nothing in the app constructs such a tab any more. `TabManager.addHomeTab`
 * was the only constructor, its only caller was the Ctrl+T branch in
 * MarkdownViewer.svelte, and that branch now opens a new file instead (#480) —
 * so the method went with it.
 *
 * The sentinel and its reader stay, because a tab carrying it can still arrive
 * from outside this build. Snapshots written before #401 have `HOME` in them
 * and are sitting on users' disks; what turns those away is `hasRealFilePath`
 * in tabFileActions.ts, and that predicate is spelled in terms of `isHomePath`.
 * The recognition IS the rejection — drop it and the sentinel is readmitted as
 * a phantom tab pointing at a file that can never be read (#401). The gate in
 * MarkdownViewer.svelte and the tab-strip guards keep reading it for the same
 * reason: they are what a stray home tab would run into (#429).
 */
export const HOME_TAB_PATH = 'HOME';

/**
 * True for the tab that holds the home screen.
 *
 * Distinct from `!hasRealFilePath(path)`, which is also true of an untitled
 * buffer: an untitled tab has no file but is still a document, and every
 * document surface — the editor, the preview, saving — applies to it.
 */
export function isHomePath(path: string): boolean {
	return path === HOME_TAB_PATH;
}
