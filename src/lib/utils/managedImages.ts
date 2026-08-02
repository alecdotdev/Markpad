/**
 * A pasted or dropped image is copied into the document's image directory
 * before the embed is written, so undoing the insert has to remove the file
 * too or the directory fills with orphans.
 *
 * That deletion is the only place the editor destroys something outside the
 * buffer, which makes "is this image still wanted?" a question worth
 * answering precisely rather than approximately.
 */
export type ManagedImage = {
	/** The tab whose buffer the embed was written into. */
	tabId: string;
	embed: string;
	parentDir: string;
	imageDirectory: string;
	filename: string;
};

export function managedImageFromCopy({
	tabId,
	embed,
	parentDir,
	imageDirectory,
	relativePath,
}: {
	tabId: string;
	embed: string;
	parentDir: string;
	imageDirectory: string;
	relativePath: string;
}): ManagedImage {
	const filename = relativePath.split('/').pop();
	if (!filename) throw new Error('Copied image path has no filename');

	return { tabId, embed, parentDir, imageDirectory, filename };
}

export function imagePathOf(image: ManagedImage): string {
	return `${image.parentDir}/${image.imageDirectory}/${image.filename}`;
}

/**
 * The link target of an embed: `![alt](img/a.png)` -> `img/a.png`.
 *
 * Matching the whole embed string treats an edited caption as a removed
 * image. Renaming `![alt]` to `![logo]` and then pressing undo once deleted a
 * file the document was still pointing at, leaving a broken image the user
 * never touched. The target is what actually binds the buffer to the file.
 */
export function embedTarget(embed: string): string | null {
	const match = /!\[[^\]]*\]\(([^)]*)\)/.exec(embed);
	return match ? match[1] : null;
}

export function contentReferencesImage(content: string, image: ManagedImage): boolean {
	const target = embedTarget(image.embed);
	// An embed we cannot parse falls back to the literal string: keeping a
	// file that is no longer referenced beats deleting one that still is.
	if (target === null) return content.includes(image.embed);
	return content.includes(`](${target})`);
}

/**
 * Decide what an undo in `tabId` should delete.
 *
 * Only the tab that owns an image can orphan it. The editor keeps one
 * component instance across tab switches, so without this scope an undo in
 * any tab inspected the newest entry from *any* tab, found its embed absent
 * from the buffer it happened to be looking at -- of course it was, a
 * different document -- and deleted a file another tab was still using.
 */
export function resolveManagedImageUndo(
	images: ManagedImage[],
	tabId: string,
	content: string,
): { removed: ManagedImage | null; remaining: ManagedImage[] } {
	for (let index = images.length - 1; index >= 0; index -= 1) {
		const candidate = images[index];
		if (candidate.tabId !== tabId) continue;
		if (contentReferencesImage(content, candidate)) break;
		return { removed: candidate, remaining: images.filter((_, i) => i !== index) };
	}
	return { removed: null, remaining: images };
}

/**
 * A redo puts the embed back, so the entry returns to the managed list and
 * cannot be deleted a second time.
 *
 * The file itself is already gone -- deletion on undo is immediate and this
 * does not resurrect it. Restoring the bookkeeping is still worth doing: it
 * stops a later undo from targeting an entry that no longer exists on disk.
 */
export function resolveManagedImageRedo(
	undone: ManagedImage[],
	tabId: string,
	content: string,
): { restored: ManagedImage | null; remaining: ManagedImage[] } {
	for (let index = undone.length - 1; index >= 0; index -= 1) {
		const candidate = undone[index];
		if (candidate.tabId !== tabId) continue;
		if (!contentReferencesImage(content, candidate)) continue;
		return { restored: candidate, remaining: undone.filter((_, i) => i !== index) };
	}
	return { restored: null, remaining: undone };
}

/** Drop bookkeeping for tabs that are gone, so the list cannot grow forever. */
export function forgetClosedTabs(images: ManagedImage[], openTabIds: Set<string>): ManagedImage[] {
	return images.filter((image) => openTabIds.has(image.tabId));
}
