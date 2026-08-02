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

	/**
	 * Hand the claim back so the source can recover its tab. A claimed
	 * transfer is deliberately immune to the source's timeout — otherwise a
	 * slow render would race it — which means the destination is the only
	 * party that can end a claim it cannot finish. Skipping this is what
	 * left the tab present in both windows.
	 */
	async function releaseClaim(token: string) {
		try {
			await invoke('cancel_detached_tab', { token });
		} catch (error) {
			options.onError('Failed to release tab transfer claim', error);
		}
	}

	async function acceptOfferedTransfer(token: string): Promise<boolean> {
		let claimed = false;
		try {
			const payload = (await invoke('claim_detached_tab', { token })) as string | null;
			// Distinguish "no such token" from a claim that succeeded: only the
			// latter leaves something to release.
			if (payload === null) {
				options.onWarning('Tab transfer claim failed; opening empty window');
				return false;
			}
			claimed = true;
			const tab = validateTransferPayload(payload);
			if (!tab) {
				options.onWarning('Tab transfer payload invalid; opening empty window');
				await releaseClaim(token);
				return false;
			}
			if (!(await options.acceptTransferredTab(tab))) {
				await releaseClaim(token);
				return false;
			}
			await invoke('complete_detached_tab', { token });
			return true;
		} catch (error) {
			options.onError('Tab transfer claim error', error);
			if (claimed) await releaseClaim(token);
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

	// A transfer stays open until the destination claims it or the timeout
	// gives up, so the menu entry that started it is clickable again long
	// before it resolves. Starting a second transfer for the same tab stages a
	// second payload: two windows each claim one, both build the tab, and the
	// source only removes it once -- leaving the same document open twice,
	// each copy with its own auto-save timer.
	const transfersInFlight = new Set<string>();

	async function transfer(tabId: string, deliver: (token: string) => Promise<void>): Promise<boolean> {
		if (!options.canTransfer(tabId)) return false;
		if (transfersInFlight.has(tabId)) return false;
		transfersInFlight.add(tabId);
		try {
			return await stageTransfer(tabId, deliver);
		} finally {
			transfersInFlight.delete(tabId);
		}
	}

	async function stageTransfer(tabId: string, deliver: (token: string) => Promise<void>): Promise<boolean> {
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
			// The timeout is a guess about the destination, so it asks rather
			// than assumes. `claimed` means the payload is already gone into
			// the other window and only slow to render: giving up here would
			// leave the same document open in both, and whichever auto-saves
			// last wins. Keep waiting for `tab-transfer-claimed`; the
			// destination releases the claim itself if it cannot finish.
			const cancel = async () => {
				if (settled) return;
				try {
					const outcome = (await invoke('cancel_detached_tab', { token })) as {
						cancelled: boolean;
						claimed: boolean;
					};
					if (!outcome.cancelled && outcome.claimed) return;
				} catch (error) {
					options.onError('Failed to cancel tab transfer', error);
				}
				if (settled) return;
				settled = true;
				unlisten();
				resolve(false);
			};
			setTimeout(cancel, 15_000);
			deliver(token).catch((error) => {
				options.onError('Failed to deliver tab transfer', error);
				void cancel();
			});
		});
	}

	async function detach(tabId: string) {
		if (!options.canDetach(tabId)) return false;
		return transfer(tabId, (token) => invoke('create_transfer_window', { token }));
	}

	return { discardPersistedState, persistState, restore, claimTransferredTab, acceptOfferedTransfer, detach, transfer };
}
