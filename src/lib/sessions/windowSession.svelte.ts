import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

type WindowSessionOptions = {
	isMainWindow: boolean;
	windowStateKey: string;
	legacyStateKey: string;
	serializeState: () => string;
	canDetach: (tabId: string) => boolean;
	transferPayload: (tabId: string) => string;
	onTransferClaimed: (tabId: string) => void;
	onError: (message: string, error: unknown) => void;
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

	async function detach(tabId: string) {
		if (!options.canDetach(tabId)) return;
		const token = (await invoke('stage_detached_tab', {
			payload: options.transferPayload(tabId),
		})) as string;
		let settled = false;
		const unlisten = await appWindow.listen<string>('tab-transfer-claimed', (event) => {
			if (settled || event.payload !== token) return;
			settled = true;
			unlisten();
			options.onTransferClaimed(tabId);
		});
		const cancel = () => {
			if (settled) return;
			settled = true;
			unlisten();
			invoke('cancel_detached_tab', { token }).catch((error) => {
				options.onError('Failed to cancel tab transfer', error);
			});
		};
		setTimeout(cancel, 15_000);
		try {
			await invoke('create_transfer_window', { token });
		} catch (error) {
			options.onError('Failed to open new window', error);
			cancel();
		}
	}

	return { discardPersistedState, persistState, detach };
}
