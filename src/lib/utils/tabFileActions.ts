import { isHomePath } from './homeTab.js';

export type TabFileActionId = 'copy-path' | 'open-location';

export type TabFileAction = {
	id: TabFileActionId;
	labelKey: string;
	disabled: boolean;
};

/**
 * True when `path` names a file on disk — false for an untitled buffer and for
 * the home tab's sentinel. Expressed in terms of `isHomePath` rather than
 * repeating the sentinel, so the two predicates cannot disagree about what the
 * home tab is.
 */
export function hasRealFilePath(path: string): boolean {
	return path !== '' && !isHomePath(path);
}

export function getTabFileActions(path: string): TabFileAction[] {
	const disabled = !hasRealFilePath(path);

	return [
		{ id: 'copy-path', labelKey: 'menu.copyFullPath', disabled },
		{ id: 'open-location', labelKey: 'menu.openFileLocation', disabled },
	];
}
