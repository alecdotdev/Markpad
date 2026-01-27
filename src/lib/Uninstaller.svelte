<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import iconUrl from '../assets/icon.png';

	let uninstalling = $state(false);
	let error = $state('');

	const appWindow = getCurrentWindow();

	async function handleUninstall() {
		uninstalling = true;
		error = '';
		try {
			await invoke('uninstall_app');
			// App will exit via Rust logic
		} catch (e: any) {
			error = e.toString();
			uninstalling = false;
		}
	}

	async function closeApp() {
		await appWindow.close();
	}
</script>

<div class="installer-container" data-tauri-drag-region>
	<div class="window-controls">
		<button class="control-btn close-btn" onclick={closeApp} aria-label="Close">
			<svg width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M11 1.7L10.3 1 6 5.3 1.7 1 1 1.7 5.3 6 1 10.3 1.7 11 6 6.7 10.3 11 11 10.3 6.7 6z" /></svg>
		</button>
	</div>

	<div class="content">
		<div class="header">
			<img src={iconUrl} alt="App Icon" class="app-icon" />
			<h1>Uninstall Markpad?</h1>
			<p class="subtitle">This will remove the application and all its shortcuts.</p>
		</div>

		{#if !uninstalling}
			<div class="setup-box">
				{#if error}
					<div class="error-msg">{error}</div>
				{/if}

				<div class="actions">
					<button class="cancel-btn" onclick={closeApp}>Cancel</button>
					<button class="uninstall-btn" onclick={handleUninstall}> Uninstall </button>
				</div>
			</div>
		{:else}
			<div class="installing-state">
				<div class="spinner"></div>
				<p>Removing Markpad...</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.installer-container {
		height: 100vh;
		width: 100%;
		display: flex;
		flex-direction: column;
		color: var(--color-fg-default);
		font-family: var(--win-font);
		box-sizing: border-box;
		overflow: hidden;
	}

	.window-controls {
		display: flex;
		justify-content: flex-end;
		padding: 4px;
		position: absolute;
		top: 0;
		right: 0;
		z-index: 10;
	}

	.control-btn {
		width: 46px;
		height: 32px;
		display: flex;
		justify-content: center;
		align-items: center;
		background: transparent;
		border: none;
		color: var(--color-fg-default);
		cursor: pointer;
		transition: all 0.1s;
	}

	.close-btn:hover {
		background: #e81123 !important;
		color: white;
	}

	.content {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 40px;
	}

	.header {
		text-align: center;
		margin-bottom: 40px;
	}

	.app-icon {
		width: 80px;
		height: 80px;
		margin-bottom: 16px;
		opacity: 0.6;
		filter: grayscale(0.5);
	}

	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.subtitle {
		margin: 8px 0 0;
		opacity: 0.6;
		font-size: 14px;
		max-width: 250px;
	}

	.setup-box {
		width: 100%;
		max-width: 320px;
		animation: slideUp 0.4s cubic-bezier(0.1, 0.9, 0.2, 1);
	}

	.actions {
		display: flex;
		justify-content: center;
		gap: 12px;
	}

	.uninstall-btn {
		background: #f85149;
		color: white;
		border: none;
		padding: 10px 24px;
		border-radius: 20px;
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
		transition:
			transform 0.2s,
			background 0.2s;
	}

	.uninstall-btn:hover {
		background: #da3633;
		transform: translateY(-1px);
	}

	.cancel-btn {
		background: var(--color-canvas-subtle);
		color: var(--color-fg-default);
		border: 1px solid var(--color-border-default);
		padding: 10px 24px;
		border-radius: 20px;
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
		transition: background 0.2s;
	}

	.cancel-btn:hover {
		background: var(--color-canvas-default);
	}

	.installing-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--color-border-muted);
		border-top-color: #f85149;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	.error-msg {
		color: #f85149;
		font-size: 13px;
		text-align: center;
		margin-bottom: 20px;
		padding: 10px;
		background: rgba(248, 81, 73, 0.1);
		border-radius: 8px;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
