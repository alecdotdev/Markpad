export type FileHistoryState = {
	history: string[];
	historyIndex: number;
};

export type FileHistoryNavigationState = FileHistoryState & {
	currentPath: string;
};

export type FileHistoryNavigationResult = FileHistoryState & {
	path: string | null;
};

export function createFileHistory(path: string, _content = ''): FileHistoryState {
	return {
		history: [path],
		historyIndex: 0,
	};
}

export function replaceCurrentHistoryEntry({
	targetPath,
	history,
	historyIndex,
}: FileHistoryNavigationState & { targetPath: string }): FileHistoryState {
	const nextHistory = history.length > 0 ? [...history] : [targetPath];
	const nextIndex = Math.max(0, Math.min(historyIndex, nextHistory.length - 1));
	nextHistory[nextIndex] = targetPath;

	return {
		history: nextHistory,
		historyIndex: nextIndex,
	};
}

export function navigateFileHistory({
	currentPath,
	targetPath,
	history,
	historyIndex,
}: FileHistoryNavigationState & { targetPath: string }): FileHistoryState {
	if (currentPath === targetPath) {
		return { history, historyIndex };
	}

	const baseHistory = history.length > 0 ? history : [currentPath];
	const nextHistory = baseHistory.slice(0, historyIndex + 1);
	nextHistory.push(targetPath);

	return {
		history: nextHistory,
		historyIndex: nextHistory.length - 1,
	};
}

export function canGoBackInHistory({ historyIndex }: FileHistoryState): boolean {
	return historyIndex > 0;
}

export function canGoForwardInHistory({ history, historyIndex }: FileHistoryState): boolean {
	return historyIndex < history.length - 1;
}

export function goBackInHistory(state: FileHistoryState): FileHistoryNavigationResult {
	if (!canGoBackInHistory(state)) {
		return { history: state.history, historyIndex: state.historyIndex, path: null };
	}

	const historyIndex = state.historyIndex - 1;
	return {
		history: state.history,
		historyIndex,
		path: state.history[historyIndex],
	};
}

export function goForwardInHistory(state: FileHistoryState): FileHistoryNavigationResult {
	if (!canGoForwardInHistory(state)) {
		return { history: state.history, historyIndex: state.historyIndex, path: null };
	}

	const historyIndex = state.historyIndex + 1;
	return {
		history: state.history,
		historyIndex,
		path: state.history[historyIndex],
	};
}
