export type TabFileActionId = 'copy-path' | 'open-location';

export type TabFileAction = {
	id: TabFileActionId;
	labelKey: string;
	disabled: boolean;
};

export function hasRealFilePath(path: string): boolean {
	return path !== '' && path !== 'HOME';
}

export function getTabFileActions(path: string): TabFileAction[] {
	const disabled = !hasRealFilePath(path);

	return [
		{ id: 'copy-path', labelKey: 'menu.copyFullPath', disabled },
		{ id: 'open-location', labelKey: 'menu.openFileLocation', disabled },
	];
}
