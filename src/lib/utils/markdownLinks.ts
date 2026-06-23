export type MarkdownLinkTarget = {
	path: string;
	hash: string;
};

export function decodeLinkPath(path: string): string {
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

export function hasMarkdownLinkExtension(path: string): boolean {
	return /\.(md|markdown|mdown|mkd|txt)$/i.test(path);
}

export function isAbsoluteMarkdownPath(path: string): boolean {
	return path.startsWith('/') || path.startsWith('\\') || /^[a-z]:/i.test(path);
}

export function getMarkdownLinkTarget(href: string): MarkdownLinkTarget | null {
	const pathWithoutHash = href.split('#')[0].split('?')[0];
	const isMarkdownTarget = hasMarkdownLinkExtension(pathWithoutHash);
	const isWindowsDrivePath = /^[a-z]:/i.test(href);
	const isProtocolRelativeExternal = href.startsWith('//');
	const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(href);
	if (!isMarkdownTarget || isProtocolRelativeExternal || (hasScheme && !isWindowsDrivePath)) return null;

	const hashIndex = href.indexOf('#');
	return {
		path: decodeLinkPath(pathWithoutHash),
		hash: hashIndex === -1 ? '' : href.slice(hashIndex + 1),
	};
}

export function resolvePath(base: string, relative: string): string {
	if (relative.startsWith('/') || /^[a-z]:/i.test(relative)) return relative;

	const normalizedBase = base.replace(/\\/g, '/');
	const baseDir = normalizedBase.substring(0, normalizedBase.lastIndexOf('/'));
	const stack = baseDir.split('/');
	const parts = relative.split('/');

	for (const part of parts) {
		if (part === '..') stack.pop();
		else if (part !== '.' && part !== '') stack.push(part);
	}

	return stack.join('/');
}

export function resolveMarkdownTargetPath(currentFile: string, target: MarkdownLinkTarget): string | null {
	if (isAbsoluteMarkdownPath(target.path)) return target.path;
	if (!currentFile) return null;
	return resolvePath(currentFile, target.path);
}

export function isOpenInNewTabMarkdownTarget(href: string, currentFile: string): boolean {
	const target = getMarkdownLinkTarget(href);
	if (!target) return false;
	return resolveMarkdownTargetPath(currentFile, target) !== null;
}

export function normalizeComparableMarkdownPath(path: string, osType: string): string {
	const normalized = path.replace(/\\/g, '/');
	const comparable = normalized.startsWith('//')
		? `//${normalized.slice(2).replace(/\/+/g, '/')}`
		: normalized.replace(/\/+/g, '/');
	if (osType === 'windows' || /^[a-z]:/i.test(comparable) || comparable.startsWith('//')) {
		return comparable.toLowerCase();
	}
	return comparable;
}
