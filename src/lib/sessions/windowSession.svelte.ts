import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { validateTransferPayload, type TransferableTab } from '../utils/tabTransfer.js';

type RestoredTab = {
	id: string;
	path: string;
};

type WindowSessionOptions = {
	isMainWindow: boolean;
	windowStateKey: string;
	legacyStateKey: string;
	restoreInProgressKey: string;
	serializeState: () => string;
	shouldRestoreState: () => boolean;
	isDisposed: () => boolean;
	restoreState: (json: string) => void;
	restoredTabs: () => RestoredTab[];
	applyRestoredContent: (tabId: string, raw: string) => Promise<void>;
	dropRestoredTab: (tabId: string) => void;
	canTransfer: (tabId: string) => boolean;
	canDetach: (tabId: string) => boolean;
	transferPayload: (tabId: string) => string;
	onTransferClaimed: (tabId: string) => void;
	acceptTransferredTab: (tab: TransferableTab) => Promise<boolean>;
	onError: (message: string, error: unknown) => void;
	onWarning: (message: string, error?: unknown) => void;
};

export function createWindowSession(options: WindowSessionOptions) {
	const appWindow = getCurrentWindow();

	async function discardPersistedState() {
		localStorage.removeItem(options.windowStateKey);
		localStorage.removeItem(options.legacyStateKey);
		if (!options.isMainWindow) return;
		try {
			await invoke('clear_window_state');
		} catch (error) {
			options.onError('Failed to clear window state', error);
		}
	}

	async function persistState() {
		if (!options.isMainWindow) return;
		try {
			await invoke('save_window_state', { json: options.serializeState() });
			localStorage.removeItem(options.windowStateKey);
			localStorage.removeItem(options.legacyStateKey);
		} catch (error) {
			options.onError('Failed to save window state on close', error);
		}
	}

	async function restore() {
		if (!options.isMainWindow || options.isDisposed()) return;
		if (!options.shouldRestoreState()) {
			localStorage.removeItem(options.windowStateKey);
			localStorage.removeItem(options.legacyStateKey);
			return;
		}
		const savedData =
			localStorage.getItem(options.windowStateKey) ??
			localStorage.getItem(options.legacyStateKey) ??
			((await invoke('load_window_state').catch(() => null)) as string | null);
		if (localStorage.getItem(options.restoreInProgressKey)) {
			options.onWarning('Skipping interrupted Markpad session restore');
			await discardPersistedState();
			localStorage.removeItem(options.restoreInProgressKey);
			return;
		}
		if (savedData) {
			localStorage.setItem(options.restoreInProgressKey, 'true');
			try {
				options.restoreState(savedData);
				for (const tab of options.restoredTabs()) {
					try {
						const raw = (await invoke('read_file_content', { path: tab.path })) as string;
						if (options.isDisposed()) return;
						await options.applyRestoredContent(tab.id, raw);
						if (options.isDisposed()) return;
					} catch (error) {
						if (options.isDisposed()) return;
						options.onWarning('Restore: dropping tab for unreadable file', error);
						options.dropRestoredTab(tab.id);
					}
				}
			} catch (error) {
				options.onError('Failed to restore Markpad session', error);
				await discardPersistedState();
			} finally {
				localStorage.removeItem(options.restoreInProgressKey);
			}
		}
		if (options.isDisposed()) return;
		if (options.restoredTabs().length > 0) await persistState();
		localStorage.removeItem(options.windowStateKey);
		localStorage.removeItem(options.legacyStateKey);
	}

	async function acceptOfferedTransfer(token: string): Promise<boolean> {
		try {
			const payload = (await invoke('claim_detached_tab', { token })) as string | null;
			const tab = payload ? validateTransferPayload(payload) : null;
			if (!tab) {
				options.onWarning('Tab transfer claim failed or payload invalid; opening empty window');
				return false;
			}
			if (await options.acceptTransferredTab(tab)) {
				await invoke('complete_detached_tab', { token });
				return true;
			}
			return false;
		} catch (error) {
			options.onError('Tab transfer claim error', error);
			return false;
		}
	}

	async function claimTransferredTab() {
		const claimToken = appWindow.label.startsWith('window-')
			? appWindow.label.slice('window-'.length)
			: null;
		if (!claimToken) return;
		await acceptOfferedTransfer(claimToken);
	}

	async function transfer(tabId: string, deliver: (token: string) => Promise<void>): Promise<boolean> {
		if (!options.canTransfer(tabId)) return false;
		const token = (await invoke('stage_detached_tab', {
			payload: options.transferPayload(tabId),
		})) as string;
		let settled = false;
		let resolveTransfer: (moved: boolean) => void;
		const unlisten = await appWindow.listen<string>('tab-transfer-claimed', (event) => {
			if (settled || event.payload !== token) return;
			settled = true;
			unlisten();
			options.onTransferClaimed(tabId);
			resolveTransfer(true);
		});
		return new Promise<boolean>((resolve) => {
			resolveTransfer = resolve;
			const cancel = () => {
				if (settled) return;
				settled = true;
				unlisten();
				invoke('cancel_detached_tab', { token }).catch((error) => {
					options.onError('Failed to cancel tab transfer', error);
				});
				resolve(false);
			};
			setTimeout(cancel, 15_000);
			deliver(token).catch((error) => {
				options.onError('Failed to deliver tab transfer', error);
				cancel();
			});
		});
	}

	async function detach(tabId: string) {
		if (!options.canDetach(tabId)) return false;
		return transfer(tabId, (token) => invoke('create_transfer_window', { token }));
	}

	return { discardPersistedState, persistState, restore, claimTransferredTab, acceptOfferedTransfer, detach, transfer };
}
