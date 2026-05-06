import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

export type UpdatePhase =
	| 'idle'
	| 'checking'
	| 'up-to-date'
	| 'available'
	| 'downloading'
	| 'error';

class UpdateStore {
	phase = $state<UpdatePhase>('idle');
	show = $state(false);
	current = $state('');
	latest = $state('');
	downloaded = $state(0);
	total = $state(0);
	errorMsg = $state('');
	notes = $state('');
	#pending: Update | null = null;

	async openDialog() {
		this.show = true;
		await this.runCheck();
	}

	close() {
		this.show = false;
		this.phase = 'idle';
		this.errorMsg = '';
		this.notes = '';
		this.downloaded = 0;
		this.total = 0;
		this.#pending = null;
	}

	async runCheck() {
		this.phase = 'checking';
		this.errorMsg = '';
		this.downloaded = 0;
		this.total = 0;
		try {
			this.current = await getVersion();
			const u = await check();
			if (u) {
				this.#pending = u;
				this.latest = u.version;
				this.notes = u.body ?? '';
				this.phase = 'available';
			} else {
				this.phase = 'up-to-date';
			}
		} catch (e) {
			this.errorMsg = e instanceof Error ? e.message : String(e);
			this.phase = 'error';
		}
	}

	async startDownload() {
		if (!this.#pending) return;
		this.phase = 'downloading';
		this.downloaded = 0;
		this.total = 0;
		try {
			await this.#pending.downloadAndInstall((event) => {
				if (event.event === 'Started') {
					this.total = event.data.contentLength ?? 0;
				} else if (event.event === 'Progress') {
					this.downloaded += event.data.chunkLength;
				}
			});
			await relaunch();
		} catch (e) {
			this.errorMsg = e instanceof Error ? e.message : String(e);
			this.phase = 'error';
		}
	}
}

export const updateStore = new UpdateStore();
