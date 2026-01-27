<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { onMount } from 'svelte';
	import iconUrl from '../assets/icon.png';

	let installing = $state(false);
	let error = $state('');

	// Maintenance Mode State
	let checking = $state(true);
	let isInstalled = $state(false);
	let installedVersion = $state('');
	let installedAllUsers = $state(false);

	let allUsers = $state(false);
	let registerMd = $state(true);
	let desktopShortcut = $state(true);
	let startMenu = $state(true);
	let launchAfter = $state(true);

	const appWindow = getCurrentWindow();

	interface InstallStatus {
		is_installed: boolean;
		all_users: boolean;
		version: string;
	}

	async function checkStatus() {
		try {
			const status = (await invoke('check_install_status')) as InstallStatus;
			isInstalled = status.is_installed;
			if (isInstalled) {
				installedAllUsers = status.all_users;
				installedVersion = status.version;
				// Pre-select the correct scope for update
				allUsers = status.all_users;
			}
		} catch (e) {
			console.error('Failed to check install status:', e);
		} finally {
			checking = false;
		}
	}

	async function handleInstall() {
		installing = true;
		error = '';
		try {
			// If updating, force the correct scope
			const targetAllUsers = isInstalled ? installedAllUsers : allUsers;

			await invoke('install_app', {
				allUsers: targetAllUsers,
				registerMd,
				desktopShortcut,
				startMenu,
				launchAfter,
			});
			// App will restart automatically via Rust logic
		} catch (e: any) {
			error = e.toString();
			installing = false;
			if (error.includes('Access is denied') && (isInstalled ? installedAllUsers : allUsers)) {
				error = 'Access denied. Please run as Administrator.';
			}
		}
	}

	async function handleUninstall() {
		installing = true; // Use same loading state
		error = '';
		try {
			await invoke('uninstall_app', { targetAllUsers: installedAllUsers });
		} catch (e: any) {
			error = e.toString();
			installing = false;
		}
	}

	async function closeApp() {
		await appWindow.close();
	}

	onMount(() => {
		checkStatus();
	});
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
			{#if isInstalled}
				<h1>Markdown Viewer</h1>
			{:else}
				<h1>Markdown Viewer</h1>
				<p class="subtitle">A simple markdown viewer</p>
			{/if}
		</div>

		{#if checking}
			<div class="spinner"></div>
		{:else if !installing}
			<div class="setup-box">
				{#if !isInstalled}
					<div class="scope-toggle">
						<button class:active={!allUsers} onclick={() => (allUsers = false)}>Just Me</button>
						<button class:active={allUsers} onclick={() => (allUsers = true)}>All Users</button>
					</div>
				{/if}

				<div class="options-container">
					{#if !isInstalled}
						<div class="options">
							<label class="checkbox-container">
								<input type="checkbox" bind:checked={registerMd} />
								<span class="checkmark"></span>
								Register as default for .md files
							</label>
							<label class="checkbox-container">
								<input type="checkbox" bind:checked={desktopShortcut} />
								<span class="checkmark"></span>
								Create desktop shortcut
							</label>
							<label class="checkbox-container">
								<input type="checkbox" bind:checked={startMenu} />
								<span class="checkmark"></span>
								Add to Start Menu
							</label>
							<label class="checkbox-container">
								<input type="checkbox" bind:checked={launchAfter} />
								<span class="checkmark"></span>
								Launch after installation
							</label>
						</div>
					{:else}
						<div class="maintenance-options">
							<p class="status-msg">
								Installed for: <strong>{installedAllUsers ? 'All Users' : 'Current User'}</strong>
							</p>
							<div class="options">
								<label class="checkbox-container">
									<input type="checkbox" bind:checked={registerMd} />
									<span class="checkmark"></span>
									Repair file associations
								</label>
								<label class="checkbox-container">
									<input type="checkbox" bind:checked={launchAfter} />
									<span class="checkmark"></span>
									Launch after update
								</label>
							</div>
						</div>
					{/if}
				</div>

				<div class="error-container">
					{#if error}
						<div class="error-msg">{error}</div>
					{/if}
				</div>

				<div class="actions">
					{#if isInstalled}
						<button class="uninstall-btn" onclick={handleUninstall}>Uninstall</button>
						<button class="install-btn" onclick={handleInstall}>Update / Repair</button>
					{:else}
						<button class="install-btn" onclick={handleInstall}>
							Install {allUsers ? 'for All Users' : 'Now'}
						</button>
					{/if}
				</div>

				<div class="notice-container">
					{#if allUsers || (isInstalled && installedAllUsers)}
						<p class="admin-notice">Requires Administrator privileges</p>
					{/if}
				</div>
			</div>
		{:else}
			<div class="installing-state">
				<div class="spinner"></div>
				<p>{isInstalled ? 'Updating' : 'Installing'} Markpad...</p>
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
		margin-bottom: 30px;
	}

	.app-icon {
		width: 70px;
		height: 70px;
		margin-bottom: 12px;
		filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.1));
	}

	h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.subtitle {
		margin: 4px 0 0;
		opacity: 0.6;
		font-size: 13px;
	}

	.setup-box {
		width: 100%;
		max-width: 400px;
		animation: slideUp 0.4s cubic-bezier(0.1, 0.9, 0.2, 1);
	}

	.scope-toggle {
		display: flex;
		background: var(--color-canvas-subtle);
		border: 1px solid var(--color-border-default);
		padding: 3px;
		border-radius: 20px;
		margin: 0 0 24px 0;
		height: 38px;
		box-sizing: border-box;
	}

	.scope-toggle button {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--color-fg-muted);
		padding: 6px 12px;
		border-radius: 17px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.scope-toggle button.active {
		background: var(--color-canvas-default);
		color: var(--color-fg-default);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.options-container {
		height: 140px; /* Fixed height to prevent layout shift */
		margin-bottom: 10px;
	}

	.options {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.checkbox-container {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 14px;
		cursor: pointer;
		user-select: none;
		opacity: 0.8;
		transition: opacity 0.2s;
	}

	.checkbox-container:hover {
		opacity: 1;
	}

	.checkbox-container input {
		display: none;
	}

	.checkmark {
		width: 18px;
		height: 18px;
		border: 2px solid var(--color-border-default);
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.checkbox-container input:checked + .checkmark {
		background: var(--color-accent-fg);
		border-color: var(--color-accent-fg);
	}

	.checkbox-container input:checked + .checkmark::after {
		content: '';
		width: 4px;
		height: 8px;
		border: solid white;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
		margin-bottom: 2px;
	}

	.error-container {
		height: 44px; /* Fixed space for potential error message */
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 0 10px 0;
	}

	.error-msg {
		color: #f85149;
		font-size: 12px;
		text-align: center;
		padding: 8px;
		background: rgba(248, 81, 73, 0.1);
		border-radius: 8px;
		line-height: 1.4;
		width: 100%;
	}

	.actions {
		display: flex;
		justify-content: center;
		gap: 16px;
		width: 100%;
	}

	.install-btn {
		background: var(--color-accent-fg);
		color: var(--color-fg-default);
		border: 1px solid var(--color-border-default);
		padding: 10px 24px;
		border-radius: 20px;
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
		transition: all 0.2s;
		width: 180px;
	}

	.install-btn:hover {
		background: var(--color-accent-fg-hover);
	}

	.uninstall-btn {
		background: var(--color-canvas-subtle);
		color: var(--color-fg-default);
		border: 1px solid var(--color-border-default);
		padding: 10px 24px;
		border-radius: 20px;
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
		transition: all 0.2s;
		width: 180px;
	}

	.uninstall-btn:hover {
		background: var(--color-neutral-muted);
	}

	.maintenance-options {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.status-msg {
		font-size: 13px;
		opacity: 0.8;
		margin: 0;
		text-align: center;
		background: var(--color-canvas-subtle);
		padding: 8px;
		border-radius: 6px;
	}

	.notice-container {
		height: 24px; /* Fixed height for admin notice */
		margin: 12px 0 0 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.admin-notice {
		font-size: 11px;
		opacity: 0.5;
		text-align: center;
		margin: 0;
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
		border-top-color: var(--color-accent-fg);
		border-radius: 50%;
		animation: spin 1s linear infinite;
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
