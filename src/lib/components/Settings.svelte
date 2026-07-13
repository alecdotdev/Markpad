<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { getVersion } from '@tauri-apps/api/app';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { settings, DEFAULT_FONTS, type OSType } from '../stores/settings.svelte.js';
	import { updateStore } from '../stores/update.svelte.js';
	import { fade, scale, fly } from 'svelte/transition';
	import { t, getSupportedLanguages } from '../utils/i18n.js';
	import type { LanguageCode } from '../utils/i18n.js';
	import { getEditorToolbarTools } from '../utils/editorToolbar.js';
	import { getTitlebarToolbarActions, type TitlebarToolbarPlacement } from '../utils/titlebarToolbar.js';

	let {
		show = false,
		theme = 'system',
		onSetTheme,
		onclose,
	} = $props<{ show?: boolean; theme?: string; onSetTheme?: (t: string) => void; onclose: () => void }>();

	let activeCategory = $state<'editor' | 'preview' | 'appearance' | 'toolbars' | 'files'>('editor');
	let highlightMenuOpen = $state(false);
	const highlightColors = [
		{ value: 'default', color: 'var(--color-accent-fg)' },
		{ value: 'yellow', color: '#ffd000' },
		{ value: 'orange', color: '#ff8c00' },
		{ value: 'red', color: '#ff3c3c' },
		{ value: 'pink', color: '#ff69b4' },
		{ value: 'purple', color: '#a46cf4' },
		{ value: 'blue', color: '#438af3' },
		{ value: 'cyan', color: '#2bb9b2' },
		{ value: 'green', color: '#4db158' }
	];

	type SettingsModalFrame = {
		width: number;
		height: number;
		left: number | null;
		top: number | null;
	};

	type ConcreteSettingsModalFrame = {
		width: number;
		height: number;
		left: number;
		top: number;
	};

	type SettingsModalDragState = {
		pointerId: number;
		clientX: number;
		clientY: number;
		left: number;
		top: number;
		width: number;
		height: number;
	};

	type SettingsResizeEdge = 'top' | 'right' | 'bottom' | 'left';

	type SettingsResizeHandle = {
		className: string;
		edges: SettingsResizeEdge[];
	};

	const settingsResizeHandles: SettingsResizeHandle[] = [
		{ className: 'resize-n', edges: ['top'] },
		{ className: 'resize-ne', edges: ['top', 'right'] },
		{ className: 'resize-e', edges: ['right'] },
		{ className: 'resize-se', edges: ['bottom', 'right'] },
		{ className: 'resize-s', edges: ['bottom'] },
		{ className: 'resize-sw', edges: ['bottom', 'left'] },
		{ className: 'resize-w', edges: ['left'] },
		{ className: 'resize-nw', edges: ['top', 'left'] },
	];

	let systemFonts = $state<string[]>([]);
	let loaded = $state(false);
	let settingsModal = $state<HTMLDivElement>();
	let previousActiveElement = $state<HTMLElement | null>(null);
	let appVersion = $state<string>('');
	let osType = $state<OSType>('unknown');
	let defaultFonts = $derived(DEFAULT_FONTS[osType] || DEFAULT_FONTS.unknown);
	let savedVscodeThemes = $state<string[]>([]);
	let themeImportUrl = $state('');
	let importingTheme = $state(false);
	let editorToolbarDraggingId = $state<string | null>(null);
	let editorToolbarDragOverId = $state<string | null>(null);
	let editorToolbarDragState = $state<ToolbarSettingsDragState | null>(null);
	let titlebarToolbarDraggingId = $state<string | null>(null);
	let titlebarToolbarDragOverId = $state<string | null>(null);
	let titlebarToolbarDragState = $state<ToolbarSettingsDragState | null>(null);
	let settingsModalFrame = $state<SettingsModalFrame>({
		width: 560,
		height: 420,
		left: null,
		top: null,
	});
	let settingsModalDragStart = $state<SettingsModalDragState | null>(null);
	let settingsResizeStart = $state<{
		pointerId: number;
		clientX: number;
		clientY: number;
		width: number;
		height: number;
		left: number;
		top: number;
		edges: SettingsResizeEdge[];
	} | null>(null);
	let settingsModalIsDragging = $state(false);
	let settingsModalIsResizing = $state(false);
	let editorToolbarSettingsTools = $derived(getEditorToolbarTools(settings.editorToolbarOrder));
	let titlebarToolbarSettingsActions = $derived(getTitlebarToolbarActions(settings.titlebarToolbarOrder));
	let settingsModalFrameStyle = $derived.by(() => {
		if (settingsModalFrame.left === null || settingsModalFrame.top === null) return '';
		return [
			'position: absolute',
			`left: ${settingsModalFrame.left}px`,
			`top: ${settingsModalFrame.top}px`,
			`width: ${settingsModalFrame.width}px`,
			`height: ${settingsModalFrame.height}px`,
		].join('; ');
	});

	type ToolbarSettingsDragState = {
		id: string;
		startY: number;
		pointerId: number;
		isDragging: boolean;
		lastTargetId: string | null;
	};

	function isEditorToolbarToolVisible(id: string) {
		return !settings.editorToolbarHidden.includes(id);
	}

	function isTitlebarToolbarActionVisible(id: string) {
		return !settings.titlebarToolbarHidden.includes(id);
	}

	function getTitlebarToolbarActionPlacement(id: string): TitlebarToolbarPlacement {
		return settings.titlebarToolbarPlacement[id] ?? 'menu';
	}

	function getToolbarDragTargetId(e: PointerEvent, selector: string, attributeName: string) {
		const target = document.elementFromPoint(e.clientX, e.clientY);
		const row = target instanceof HTMLElement ? target.closest<HTMLElement>(selector) : null;
		return row?.getAttribute(attributeName) ?? null;
	}

	function createToolbarDragState(e: PointerEvent, id: string): ToolbarSettingsDragState | null {
		if (e.button !== 0) return null;
		e.preventDefault();
		e.stopPropagation();
		return {
			id,
			startY: e.clientY,
			pointerId: e.pointerId,
			isDragging: false,
			lastTargetId: null,
		};
	}

	function handleEditorToolbarDragPointerDown(e: PointerEvent, id: string) {
		const dragState = createToolbarDragState(e, id);
		if (!dragState) return;
		editorToolbarDragState = dragState;
		window.addEventListener('pointermove', handleEditorToolbarWindowPointerMove);
		window.addEventListener('pointerup', handleEditorToolbarWindowPointerUp);
		window.addEventListener('pointercancel', handleEditorToolbarWindowPointerCancel);
	}

	function handleEditorToolbarWindowPointerMove(e: PointerEvent) {
		if (!editorToolbarDragState || e.pointerId !== editorToolbarDragState.pointerId) return;
		e.preventDefault();

		if (!editorToolbarDragState.isDragging) {
			if (Math.abs(e.clientY - editorToolbarDragState.startY) <= 4) return;
			editorToolbarDragState.isDragging = true;
			editorToolbarDraggingId = editorToolbarDragState.id;
		}

		const targetId = getToolbarDragTargetId(e, '[data-editor-toolbar-tool-id]', 'data-editor-toolbar-tool-id');
		if (!targetId || targetId === editorToolbarDragState.id) {
			editorToolbarDragOverId = null;
			editorToolbarDragState.lastTargetId = null;
			return;
		}

		editorToolbarDragOverId = targetId;
		if (targetId === editorToolbarDragState.lastTargetId) return;
		editorToolbarDragState.lastTargetId = targetId;
		settings.reorderEditorToolbarTool(editorToolbarDragState.id, targetId);
	}

	function clearEditorToolbarDragState() {
		editorToolbarDraggingId = null;
		editorToolbarDragOverId = null;
		editorToolbarDragState = null;
		window.removeEventListener('pointermove', handleEditorToolbarWindowPointerMove);
		window.removeEventListener('pointerup', handleEditorToolbarWindowPointerUp);
		window.removeEventListener('pointercancel', handleEditorToolbarWindowPointerCancel);
	}

	function handleEditorToolbarWindowPointerUp(e: PointerEvent) {
		if (!editorToolbarDragState || e.pointerId !== editorToolbarDragState.pointerId) return;
		if (editorToolbarDragState.isDragging) e.preventDefault();
		clearEditorToolbarDragState();
	}

	function handleEditorToolbarWindowPointerCancel(e: PointerEvent) {
		if (!editorToolbarDragState || e.pointerId !== editorToolbarDragState.pointerId) return;
		clearEditorToolbarDragState();
	}

	function handleTitlebarToolbarDragPointerDown(e: PointerEvent, id: string) {
		const dragState = createToolbarDragState(e, id);
		if (!dragState) return;
		titlebarToolbarDragState = dragState;
		window.addEventListener('pointermove', handleTitlebarToolbarWindowPointerMove);
		window.addEventListener('pointerup', handleTitlebarToolbarWindowPointerUp);
		window.addEventListener('pointercancel', handleTitlebarToolbarWindowPointerCancel);
	}

	function handleTitlebarToolbarWindowPointerMove(e: PointerEvent) {
		if (!titlebarToolbarDragState || e.pointerId !== titlebarToolbarDragState.pointerId) return;
		e.preventDefault();

		if (!titlebarToolbarDragState.isDragging) {
			if (Math.abs(e.clientY - titlebarToolbarDragState.startY) <= 4) return;
			titlebarToolbarDragState.isDragging = true;
			titlebarToolbarDraggingId = titlebarToolbarDragState.id;
		}

		const targetId = getToolbarDragTargetId(e, '[data-titlebar-toolbar-action-id]', 'data-titlebar-toolbar-action-id');
		if (!targetId || targetId === titlebarToolbarDragState.id) {
			titlebarToolbarDragOverId = null;
			titlebarToolbarDragState.lastTargetId = null;
			return;
		}

		titlebarToolbarDragOverId = targetId;
		if (targetId === titlebarToolbarDragState.lastTargetId) return;
		titlebarToolbarDragState.lastTargetId = targetId;
		settings.reorderTitlebarToolbarAction(titlebarToolbarDragState.id, targetId);
	}

	function clearTitlebarToolbarDragState() {
		titlebarToolbarDraggingId = null;
		titlebarToolbarDragOverId = null;
		titlebarToolbarDragState = null;
		window.removeEventListener('pointermove', handleTitlebarToolbarWindowPointerMove);
		window.removeEventListener('pointerup', handleTitlebarToolbarWindowPointerUp);
		window.removeEventListener('pointercancel', handleTitlebarToolbarWindowPointerCancel);
	}

	function handleTitlebarToolbarWindowPointerUp(e: PointerEvent) {
		if (!titlebarToolbarDragState || e.pointerId !== titlebarToolbarDragState.pointerId) return;
		if (titlebarToolbarDragState.isDragging) e.preventDefault();
		clearTitlebarToolbarDragState();
	}

	function handleTitlebarToolbarWindowPointerCancel(e: PointerEvent) {
		if (!titlebarToolbarDragState || e.pointerId !== titlebarToolbarDragState.pointerId) return;
		clearTitlebarToolbarDragState();
	}

	function clampNumber(value: number, min: number, max: number) {
		return Math.min(max, Math.max(min, value));
	}

	function getSettingsModalLimits() {
		const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
		const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
		return {
			viewportWidth,
			viewportHeight,
			minWidth: Math.min(520, viewportWidth * 0.9),
			maxWidth: viewportWidth * 0.9,
			minHeight: Math.min(360, viewportHeight * 0.9),
			maxHeight: viewportHeight * 0.9,
		};
	}

	function getCurrentSettingsModalFrame(): ConcreteSettingsModalFrame | null {
		if (!settingsModal) return null;
		const rect = settingsModal.getBoundingClientRect();
		const limits = getSettingsModalLimits();
		const width = clampNumber(rect.width, limits.minWidth, limits.maxWidth);
		const height = clampNumber(rect.height, limits.minHeight, limits.maxHeight);
		return {
			width,
			height,
			left: clampNumber(rect.left, 0, Math.max(0, limits.viewportWidth - width)),
			top: clampNumber(rect.top, 0, Math.max(0, limits.viewportHeight - height)),
		};
	}

	function clampSettingsModalFrame(frame: ConcreteSettingsModalFrame): ConcreteSettingsModalFrame {
		const limits = getSettingsModalLimits();
		const width = clampNumber(frame.width, limits.minWidth, limits.maxWidth);
		const height = clampNumber(frame.height, limits.minHeight, limits.maxHeight);
		return {
			width,
			height,
			left: clampNumber(frame.left, 0, Math.max(0, limits.viewportWidth - width)),
			top: clampNumber(frame.top, 0, Math.max(0, limits.viewportHeight - height)),
		};
	}

	function isSettingsHeaderInteractiveTarget(target: EventTarget | null) {
		if (!(target instanceof HTMLElement)) return false;
		return Boolean(target.closest('button, a, input, select, textarea, [role="button"]'));
	}

	function handleSettingsModalDragPointerDown(e: PointerEvent) {
		if (e.button !== 0 || isSettingsHeaderInteractiveTarget(e.target)) return;
		const frame = getCurrentSettingsModalFrame();
		if (!frame) return;

		e.preventDefault();
		e.stopPropagation();
		settingsModalFrame = frame;
		settingsModalDragStart = {
			pointerId: e.pointerId,
			clientX: e.clientX,
			clientY: e.clientY,
			left: frame.left,
			top: frame.top,
			width: frame.width,
			height: frame.height,
		};
		settingsModalIsDragging = true;
		window.addEventListener('pointermove', handleSettingsModalDragWindowPointerMove);
		window.addEventListener('pointerup', handleSettingsModalDragWindowPointerUp);
		window.addEventListener('pointercancel', handleSettingsModalDragWindowPointerCancel);
	}

	function handleSettingsModalDragWindowPointerMove(e: PointerEvent) {
		if (!settingsModalDragStart || e.pointerId !== settingsModalDragStart.pointerId) return;
		e.preventDefault();
		const left = settingsModalDragStart.left + e.clientX - settingsModalDragStart.clientX;
		const top = settingsModalDragStart.top + e.clientY - settingsModalDragStart.clientY;
		settingsModalFrame = clampSettingsModalFrame({
			width: settingsModalDragStart.width,
			height: settingsModalDragStart.height,
			left,
			top,
		});
	}

	function completeSettingsModalDrag(e?: PointerEvent) {
		if (!settingsModalDragStart) return;
		e?.preventDefault();
		e?.stopPropagation();
		settingsModalDragStart = null;
		settingsModalIsDragging = false;
		window.removeEventListener('pointermove', handleSettingsModalDragWindowPointerMove);
		window.removeEventListener('pointerup', handleSettingsModalDragWindowPointerUp);
		window.removeEventListener('pointercancel', handleSettingsModalDragWindowPointerCancel);
	}

	function handleSettingsModalDragWindowPointerUp(e: PointerEvent) {
		if (!settingsModalDragStart || e.pointerId !== settingsModalDragStart.pointerId) return;
		completeSettingsModalDrag(e);
	}

	function handleSettingsModalDragWindowPointerCancel(e: PointerEvent) {
		if (!settingsModalDragStart || e.pointerId !== settingsModalDragStart.pointerId) return;
		completeSettingsModalDrag(e);
	}

	function completeSettingsResize(e?: PointerEvent) {
		if (!settingsResizeStart) return;
		e?.preventDefault();
		e?.stopPropagation();
		settingsResizeStart = null;
		settingsModalIsResizing = false;
		window.removeEventListener('pointermove', handleSettingsResizeWindowPointerMove);
		window.removeEventListener('pointerup', handleSettingsResizeWindowPointerUp);
		window.removeEventListener('pointercancel', handleSettingsResizeWindowPointerCancel);
	}

	function handleSettingsResizePointerDown(e: PointerEvent, edges: SettingsResizeEdge[]) {
		const frame = getCurrentSettingsModalFrame();
		if (!frame) return;

		e.preventDefault();
		e.stopPropagation();
		settingsResizeStart = {
			pointerId: e.pointerId,
			clientX: e.clientX,
			clientY: e.clientY,
			width: frame.width,
			height: frame.height,
			left: frame.left,
			top: frame.top,
			edges,
		};
		settingsModalFrame = frame;
		settingsModalIsResizing = true;
		window.addEventListener('pointermove', handleSettingsResizeWindowPointerMove);
		window.addEventListener('pointerup', handleSettingsResizeWindowPointerUp);
		window.addEventListener('pointercancel', handleSettingsResizeWindowPointerCancel);
	}

	function handleSettingsResizeWindowPointerMove(e: PointerEvent) {
		if (!settingsResizeStart || e.pointerId !== settingsResizeStart.pointerId) return;
		e.preventDefault();
		e.stopPropagation();

		const deltaX = e.clientX - settingsResizeStart.clientX;
		const deltaY = e.clientY - settingsResizeStart.clientY;
		let width = settingsResizeStart.width;
		let height = settingsResizeStart.height;
		let left = settingsResizeStart.left;
		let top = settingsResizeStart.top;

		if (settingsResizeStart.edges.includes('right')) {
			width = settingsResizeStart.width + deltaX;
		}
		if (settingsResizeStart.edges.includes('bottom')) {
			height = settingsResizeStart.height + deltaY;
		}
		if (settingsResizeStart.edges.includes('left')) {
			width = settingsResizeStart.width - deltaX;
			left = settingsResizeStart.left + deltaX;
		}
		if (settingsResizeStart.edges.includes('top')) {
			height = settingsResizeStart.height - deltaY;
			top = settingsResizeStart.top + deltaY;
		}

		const limits = getSettingsModalLimits();
		if (width < limits.minWidth && settingsResizeStart.edges.includes('left')) {
			left = settingsResizeStart.left + settingsResizeStart.width - limits.minWidth;
		}
		if (width > limits.maxWidth && settingsResizeStart.edges.includes('left')) {
			left = settingsResizeStart.left + settingsResizeStart.width - limits.maxWidth;
		}
		if (height < limits.minHeight && settingsResizeStart.edges.includes('top')) {
			top = settingsResizeStart.top + settingsResizeStart.height - limits.minHeight;
		}
		if (height > limits.maxHeight && settingsResizeStart.edges.includes('top')) {
			top = settingsResizeStart.top + settingsResizeStart.height - limits.maxHeight;
		}

		settingsModalFrame = clampSettingsModalFrame({ width, height, left, top });
	}

	function handleSettingsResizeWindowPointerUp(e: PointerEvent) {
		if (!settingsResizeStart || e.pointerId !== settingsResizeStart.pointerId) return;
		completeSettingsResize(e);
	}

	function handleSettingsResizeWindowPointerCancel(e: PointerEvent) {
		if (!settingsResizeStart || e.pointerId !== settingsResizeStart.pointerId) return;
		completeSettingsResize(e);
	}

	async function loadVscodeThemes() {
		try {
			savedVscodeThemes = await invoke('get_saved_vscode_themes');
		} catch (e) {
			console.error('Failed to load vscode themes:', e);
		}
	}

	async function loadFonts() {
		if (loaded) return;
		try {
			const [fonts, os] = await Promise.all([
				invoke('get_system_fonts') as Promise<string[]>,
				invoke('get_os_type') as Promise<string>
			]);
			systemFonts = fonts;
			osType = os as OSType;
			loaded = true;
		} catch (e) {
			console.error('Failed to load system fonts:', e);
			systemFonts = ['Consolas', 'Courier New', 'Monaco', 'Menlo', 'Segoe UI'];
			try {
				osType = await invoke('get_os_type') as OSType;
			} catch (e2) {
				console.error('Failed to get OS type:', e2);
				osType = 'unknown';
			}
		}
	}

	$effect(() => {
		if (show) {
			loadFonts();
			if (!appVersion) {
				getVersion()
					.then((v) => (appVersion = v))
					.catch(console.error);
			}
			loadVscodeThemes();
			previousActiveElement = document.activeElement as HTMLElement;
			setTimeout(() => {
				const firstFocusable = settingsModal?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') as HTMLElement | null;
				if (firstFocusable) {
					firstFocusable.focus();
				} else {
					settingsModal?.focus();
				}
			}, 50);
		} else if (previousActiveElement) {
			previousActiveElement.focus();
		}
	});

	function handleModalKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
			return;
		}

		if (e.key !== 'Tab') return;
		const focusableElements = settingsModal?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [];
		if (focusableElements.length === 0) return;

		const first = focusableElements[0] as HTMLElement;
		const last = focusableElements[focusableElements.length - 1] as HTMLElement;

		if (e.shiftKey) {
			if (document.activeElement === first) {
				e.preventDefault();
				last.focus();
			}
		} else if (document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}

	async function importVscodeTheme() {
		if (!themeImportUrl) return;
		importingTheme = true;
		try {
			const name = await invoke('fetch_vscode_theme', { url: themeImportUrl });
			themeImportUrl = '';
			await loadVscodeThemes();
			onSetTheme?.(`vscode:${name}` as any);
		} catch (e) {
			console.error('Failed to import theme:', e);
			alert(`Failed to import theme: ${e}`);
		} finally {
			importingTheme = false;
		}
	}

	async function deleteTheme(name: string) {
		try {
			await invoke('delete_vscode_theme', { name });
			if (theme === `vscode:${name}`) onSetTheme?.('system');
			await loadVscodeThemes();
		} catch (e) {
			console.error('Failed to delete theme:', e);
		}
	}
</script>

{#if show}
	<div class="settings-backdrop" transition:fade={{ duration: 150 }} role="presentation">
		<div
			class="settings-modal"
			class:dragging={settingsModalIsDragging}
			class:resizing={settingsModalIsResizing}
			bind:this={settingsModal}
			style={settingsModalFrameStyle}
			transition:scale={{ duration: 200, start: 0.95 }}
			role="dialog"
			aria-modal="true"
			aria-labelledby="settings-title"
			tabindex="-1"
			onkeydown={handleModalKeydown}>
			<div class="settings-header" onpointerdown={handleSettingsModalDragPointerDown}>
				<h1 id="settings-title">{t('settings.title', settings.language)}</h1>
				<button class="close-btn" onclick={onclose} aria-label={t('common.close', settings.language)}>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>

			<div class="settings-content">
				<nav class="settings-nav">
					<button class="nav-item" class:active={activeCategory === 'editor'} onclick={() => (activeCategory = 'editor')}>
						<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round">
								<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
								<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
							</svg>
							{t('settings.editor', settings.language)}
					</button>
					<button class="nav-item" class:active={activeCategory === 'preview'} onclick={() => (activeCategory = 'preview')}>
						<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round">
								<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
								<circle cx="12" cy="12" r="3"></circle>
							</svg>
							{t('settings.preview', settings.language)}
					</button>
					<button class="nav-item" class:active={activeCategory === 'appearance'} onclick={() => (activeCategory = 'appearance')}>
						<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round">
								<circle cx="12" cy="12" r="3"></circle>
								<path
									d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
								></path>
							</svg>
							{t('settings.appearance', settings.language)}
					</button>
					<button class="nav-item" class:active={activeCategory === 'toolbars'} onclick={() => (activeCategory = 'toolbars')}>
						<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round">
								<rect x="3" y="4" width="18" height="5" rx="1"></rect>
								<rect x="3" y="15" width="18" height="5" rx="1"></rect>
								<path d="M7 9v6"></path>
								<path d="M17 9v6"></path>
							</svg>
							{t('settings.toolbars', settings.language)}
					</button>
					<button class="nav-item" class:active={activeCategory === 'files'} onclick={() => (activeCategory = 'files')}>
						<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round">
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
								<polyline points="14 2 14 8 20 8"></polyline>
								<line x1="9" y1="13" x2="15" y2="13"></line>
								<line x1="9" y1="17" x2="13" y2="17"></line>
							</svg>
							{t('settings.files', settings.language)}
					</button>

					<div class="nav-footer">
						<button
							class="check-updates-btn"
							onclick={() => updateStore.openDialog()}
							aria-label={t('menu.checkForUpdates', settings.language)}>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round">
								<polyline points="23 4 23 10 17 10"></polyline>
								<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
							</svg>
							<span>{t('menu.checkForUpdates', settings.language)}</span>
						</button>
						<button
							class="github-btn"
							onclick={() =>
								openUrl('https://github.com/alecdotdev/Markpad')
									.catch(() => window.open('https://github.com/alecdotdev/Markpad', '_blank'))}
							aria-label="GitHub">
							<svg viewBox="0 0 24 24" class="github-icon" fill="currentColor">
									<path
										d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z"
										></path>
								</svg>
								<span>{t('menu.github', settings.language)}</span>
							{#if appVersion}
								<span class="version-code">v{appVersion}</span>
							{/if}
						</button>
					</div>
				</nav>

					<div class="settings-panel" role="presentation" onclick={() => { highlightMenuOpen = false; }}>
						{#if activeCategory === 'editor'}
						<div class="settings-group">
							<div class="settings-group-header">
								<h2>{t('settings.editorSettings', settings.language)}</h2>
								<button
									class="reset-text-btn"
									class:disabled={settings.editorFont === defaultFonts.editorFont && settings.editorFontSize === 14 && settings.editorMaxWidth === 80}
									onclick={() => { settings.resetEditorFont(); settings.resetEditorMaxWidth(); }}>
									{t('settings.resetEditorSettings', settings.language)}
								</button>
							</div>

							<div class="setting-item">
								<label for="editor-font">{t('settings.font', settings.language)}</label>
								<div class="select-wrapper">
									<select id="editor-font" bind:value={settings.editorFont}>
										{#each systemFonts as font}
											<option value={font}>{font === defaultFonts.editorFont ? font + ' (' + t('settings.default', settings.language) + ')' : font}</option>
										{/each}
									</select>
									<svg
										class="select-arrow"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
								</div>
							</div>

							<div class="setting-item">
								<label for="editor-font-size">{t('settings.fontSize', settings.language)}</label>
								<div class="slider-container">
									<div class="number-input-wrapper horizontal">
										<button class="spin-btn minus" onclick={() => (settings.editorFontSize = Math.max(10, settings.editorFontSize - 1))} aria-label={t('common.decrease', settings.language)}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
										<input type="number" id="editor-font-size" min="10" max="48" bind:value={settings.editorFontSize} class="number-input" />
										<button class="spin-btn plus" onclick={() => (settings.editorFontSize = Math.min(48, settings.editorFontSize + 1))} aria-label={t('common.increase', settings.language)}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
									</div>
									<span class="slider-value">px</span>
								</div>
							</div>

							<div class="setting-item">
								<label for="editor-max-width">{t('settings.wrapColumn', settings.language)}</label>
								<div class="slider-container">
									<div class="number-input-wrapper horizontal">
										<button class="spin-btn minus" onclick={() => (settings.editorMaxWidth = Math.max(20, settings.editorMaxWidth - 10))} aria-label={t('common.decrease', settings.language)}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
										<input type="number" id="editor-max-width" min="20" max="500" step="10" bind:value={settings.editorMaxWidth} class="number-input" style="width: 50px" />
										<button class="spin-btn plus" onclick={() => (settings.editorMaxWidth = Math.min(500, settings.editorMaxWidth + 10))} aria-label={t('common.increase', settings.language)}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
									</div>
									<span class="slider-value">chars</span>
								</div>
							</div>

							<div class="setting-item">
								<label for="editor-word-wrap">{t('settings.wordWrap', settings.language)}</label>
								<div class="select-wrapper">
									<select id="editor-word-wrap" bind:value={settings.wordWrap}>
										<option value="off">{t('menu.wordWrapOff', settings.language)}</option>
										<option value="on">{t('menu.wordWrapOn', settings.language)}</option>
										<option value="wordWrapColumn">{t('menu.wordWrapColumn', settings.language)}</option>
									</select>
									<svg class="select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
								</div>
							</div>

							<div class="setting-item">
								<label for="editor-line-numbers">{t('settings.lineNumbers', settings.language)}</label>
								<label class="toggle">
									<input id="editor-line-numbers" type="checkbox" checked={settings.lineNumbers === 'on'} onchange={() => settings.toggleLineNumbers()} />
									<span class="toggle-slider"></span>
								</label>
							</div>

							<div class="setting-item">
								<label for="editor-minimap">{t('settings.minimap', settings.language)}</label>
								<label class="toggle">
									<input id="editor-minimap" type="checkbox" checked={settings.minimap} onchange={() => settings.toggleMinimap()} />
									<span class="toggle-slider"></span>
								</label>
							</div>

							<div class="setting-item">
								<label for="editor-vim-mode">{t('settings.vimMode', settings.language)}</label>
								<label class="toggle">
									<input id="editor-vim-mode" type="checkbox" checked={settings.vimMode} onchange={() => settings.toggleVimMode()} />
									<span class="toggle-slider"></span>
								</label>
							</div>

							<div class="setting-item">
								<label for="editor-status-bar">{t('settings.statusBar', settings.language)}</label>
								<label class="toggle">
									<input id="editor-status-bar" type="checkbox" checked={settings.statusBar} onchange={() => settings.toggleStatusBar()} />
									<span class="toggle-slider"></span>
								</label>
							</div>

							<div class="setting-item">
								<label for="editor-word-count">{t('settings.wordCount', settings.language)}</label>
								<label class="toggle">
									<input id="editor-word-count" type="checkbox" checked={settings.wordCount} onchange={() => settings.toggleWordCount()} />
									<span class="toggle-slider"></span>
								</label>
							</div>

							<div class="setting-item">
								<label for="editor-show-whitespace">{t('settings.showWhitespace', settings.language)}</label>
								<label class="toggle">
									<input id="editor-show-whitespace" type="checkbox" checked={settings.showWhitespace} onchange={() => settings.toggleShowWhitespace()} />
									<span class="toggle-slider"></span>
								</label>
							</div>

						<div class="setting-item">
							<label for="editor-line-highlight">{t('settings.lineHighlight', settings.language)}</label>
							<label class="toggle">
								<input id="editor-line-highlight" type="checkbox" checked={settings.renderLineHighlight === 'line'} onchange={() => settings.toggleLineHighlight()} />
								<span class="toggle-slider"></span>
							</label>
						</div>

						<div class="setting-item">
							<label for="image-directory">{t('settings.imageDirectory', settings.language)}</label>
							<input
								type="text"
								id="image-directory"
								class="text-input"
								style="width: 120px;"
								bind:value={settings.imageDirectory}
								placeholder="img"
							/>
							<span class="slider-value" style="margin-left: 8px;">{t('settings.default', settings.language)}: img</span>
						</div>

						{#if settings.osType === 'macos'}
							<div class="setting-item">
								<label for="macos-image-scaling">{t('settings.scaleMacOSScreenshots', settings.language)}</label>
								<label class="toggle">
									<input id="macos-image-scaling" type="checkbox" checked={settings.macosImageScaling} onchange={() => settings.toggleMacosImageScaling()} />
									<span class="toggle-slider"></span>
								</label>
								<span class="slider-value" style="margin-left: 8px;">{t('settings.reduceSizeBy50', settings.language)}</span>
							</div>
						{/if}
					</div>
					{:else if activeCategory === 'preview'}
						<div class="settings-group">
							<div class="settings-group-header">
								<h2>{t('settings.previewSettings', settings.language)}</h2>
								<button
									class="reset-text-btn"
									class:disabled={settings.previewFont === defaultFonts.previewFont && settings.previewFontSize === 16 && settings.codeFont === defaultFonts.codeFont && settings.codeFontSize === 14}
									onclick={() => settings.resetPreviewFont()}>
									{t('settings.resetFontSettings', settings.language)}
								</button>
							</div>

							<div class="setting-item">
								<label for="preview-font">{t('settings.font', settings.language)}</label>
								<div class="select-wrapper">
									<select id="preview-font" bind:value={settings.previewFont}>
										{#each systemFonts as font}
											<option value={font}>{font === defaultFonts.previewFont ? font + ' (' + t('settings.default', settings.language) + ')' : font}</option>
										{/each}
									</select>
									<svg
										class="select-arrow"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
								</div>
							</div>

							<div class="setting-item">
								<label for="preview-font-size">{t('settings.fontSize', settings.language)}</label>
								<div class="slider-container">
									<div class="number-input-wrapper horizontal">
										<button class="spin-btn minus" onclick={() => (settings.previewFontSize = Math.max(12, settings.previewFontSize - 1))} aria-label={t('common.decrease', settings.language)}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
										<input type="number" id="preview-font-size" min="12" max="48" bind:value={settings.previewFontSize} class="number-input" />
										<button class="spin-btn plus" onclick={() => (settings.previewFontSize = Math.min(48, settings.previewFontSize + 1))} aria-label={t('common.increase', settings.language)}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
									</div>
									<span class="slider-value">px</span>
								</div>
							</div>

							<div class="setting-item">
								<label for="code-font">{t('settings.font', settings.language)}</label>
								<div class="select-wrapper">
									<select id="code-font" bind:value={settings.codeFont}>
										{#each systemFonts as font}
											<option value={font}>{font === defaultFonts.codeFont ? font + ' (' + t('settings.default', settings.language) + ')' : font}</option>
										{/each}
									</select>
									<svg
										class="select-arrow"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
								</div>
							</div>

							<div class="setting-item">
								<label for="code-font-size">{t('settings.fontSize', settings.language)}</label>
								<div class="slider-container">
									<div class="number-input-wrapper horizontal">
										<button class="spin-btn minus" onclick={() => (settings.codeFontSize = Math.max(10, settings.codeFontSize - 1))} aria-label={t('common.decrease', settings.language)}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
										<input type="number" id="code-font-size" min="10" max="48" bind:value={settings.codeFontSize} class="number-input" />
										<button class="spin-btn plus" onclick={() => (settings.codeFontSize = Math.min(48, settings.codeFontSize + 1))} aria-label={t('common.increase', settings.language)}>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
												><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
										</button>
									</div>
									<span class="slider-value">px</span>
								</div>
							</div>
						</div>
					{:else if activeCategory === 'appearance'}
						<div class="settings-group">
						<h2>{t('settings.appearanceSettings', settings.language)}</h2>

						<div class="setting-item">
							<label for="appearance-language">{t('settings.language', settings.language)}</label>
							<div class="select-wrapper">
								<select id="appearance-language" value={settings.language} onchange={(e) => settings.setLanguage(e.currentTarget.value as LanguageCode)}>
									{#each getSupportedLanguages() as lang}
										<option value={lang.code}>{lang.nativeName}</option>
									{/each}
								</select>
								<svg
									class="select-arrow"
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
							</div>
						</div>

						<div class="setting-item" style="align-items: flex-start; padding-top: 16px;">
							<label for="appearance-theme" style="margin-top: 6px;">{t('settings.theme', settings.language)}</label>
								<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
									<div class="select-wrapper">
										<select id="appearance-theme" value={theme} onchange={(e) => onSetTheme?.(e.currentTarget.value as any)}>
											<option value="system">{t('settings.themeFollowSystem', settings.language)}</option>
											<option value="light">{t('settings.themeDefaultLight', settings.language)}</option>
											<option value="dark">{t('settings.themeDefaultDark', settings.language)}</option>
											{#if savedVscodeThemes.length > 0}
												<optgroup label={t('settings.vsCodeThemes', settings.language)}>
													{#each savedVscodeThemes as themeOption}
														<option value={`vscode:${themeOption}`}>{themeOption}</option>
													{/each}
												</optgroup>
											{/if}
										</select>
										<svg
											class="select-arrow"
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
									</div>
									{#if theme.startsWith('vscode:')}
										<button class="reset-text-btn" style="color: var(--color-danger-fg); font-size: 12px; padding: 0;" onclick={() => deleteTheme(theme.replace('vscode:', ''))}>
										{t('settings.deleteSelectedTheme', settings.language)}
									</button>
									{/if}
								</div>
							</div>

							<div class="setting-item" style="flex-direction: column; align-items: flex-start; gap: 8px;">
								<div style="display: flex; justify-content: space-between; width: 100%;">
									<label for="theme-import">{t('settings.importVSCodeTheme', settings.language)}</label>
									<button
										class="reset-text-btn"
										onclick={() =>
											openUrl('https://vscodethemes.com/')
												.catch(() => window.open('https://vscodethemes.com/', '_blank'))}
									>
										{t('settings.browseThemes', settings.language)}
									</button>
								</div>
								<div style="display: flex; gap: 8px; width: 100%;">
									<input 
										type="text" 
										id="theme-import" 
										class="text-input" 
										style="flex: 1;" 
										placeholder="https://vscodethemes.com/e/..." 
										bind:value={themeImportUrl} 
										onkeydown={e => e.key === 'Enter' && importVscodeTheme()}
									/>
									<button class="import-btn" onclick={importVscodeTheme} disabled={importingTheme || !themeImportUrl}>
										{importingTheme ? t('settings.importing', settings.language) : t('settings.import', settings.language)}
									</button>
								</div>
							</div>

							<div class="setting-item">
								<label for="appearance-tabs">{t('settings.showTabs', settings.language)}</label>
								<label class="toggle">
									<input id="appearance-tabs" type="checkbox" checked={settings.showTabs} onchange={() => settings.toggleTabs()} />
									<span class="toggle-slider"></span>
								</label>
							</div>

							<div class="setting-item">
								<label for="appearance-restore-state">{t('settings.restoreStateOnReopen', settings.language)}</label>
								<label class="toggle">
									<input id="appearance-restore-state" type="checkbox" checked={settings.restoreStateOnReopen} onchange={() => settings.toggleRestoreStateOnReopen()} />
									<span class="toggle-slider"></span>
								</label>
							</div>

							<div class="setting-item">
								<label for="appearance-start-editor">{t('settings.startInEditor', settings.language)}</label>
								<label class="toggle">
									<input id="appearance-start-editor" type="checkbox" checked={settings.startInEditor} onchange={() => settings.toggleStartInEditor()} />
									<span class="toggle-slider"></span>
								</label>
							</div>
							<div class="setting-item">
								<label for="appearance-new-file-mode">{t('settings.newFileDefaultMode', settings.language)}</label>
								<label class="toggle">
									<input id="appearance-new-file-mode" type="checkbox" checked={settings.newFileDefaultMode} onchange={() => settings.toggleNewFileDefaultMode()} />
									<span class="toggle-slider"></span>
								</label>
							</div>
							<div class="setting-item">
								<label for="appearance-recent-files">{t('settings.showRecentFiles', settings.language)}</label>
								<label class="toggle">
									<input id="appearance-recent-files" type="checkbox" checked={settings.showRecentFiles} onchange={() => settings.toggleShowRecentFiles()} />
									<span class="toggle-slider"></span>
								</label>
							</div>
							<div class="setting-item">
							<label for="appearance-toc">{t('settings.showTableOfContents', settings.language)}</label>
							<label class="toggle">
								<input id="appearance-toc" type="checkbox" checked={settings.showToc} onchange={() => settings.toggleToc()} />
								<span class="toggle-slider"></span>
							</label>
						</div>

						<div class="setting-item">
							<label for="appearance-highlight-color">{t('settings.highlightColor', settings.language)}</label>
							<div class="custom-dropdown-wrapper">
								<button 
									class="custom-dropdown-btn" 
									onclick={(e) => { e.stopPropagation(); highlightMenuOpen = !highlightMenuOpen; }}>
										<div style="display: flex; align-items: center; gap: 8px;">
										<div class="color-circle" style="background-color: {highlightColors.find(c => c.value === settings.highlightColor)?.color || 'var(--color-accent-fg)'}"></div>
										<span>{t(`colors.${settings.highlightColor || 'default'}`, settings.language)}</span>
									</div>
										<svg class="select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
								</button>
								{#if highlightMenuOpen}
									<div
										class="custom-dropdown-menu"
										role="menu"
										tabindex="-1"
										transition:fly={{ y: 5, duration: 150 }}
										onclick={(e) => e.stopPropagation()}
										onkeydown={(e) => {
											if (e.key === 'Escape') highlightMenuOpen = false;
										}}>
										{#each highlightColors as color, index}
											{#if index === 1}
												<div class="theme-menu-divider" style="height: 1px; background-color: var(--color-border-muted); margin: 4px 0; transform: scaleY(0.5);"></div>
											{/if}
											<button 
													class="custom-dropdown-option {settings.highlightColor === color.value ? 'selected' : ''}" 
													onclick={() => {
														settings.highlightColor = color.value;
														highlightMenuOpen = false;
													}}
												>
													<div class="color-circle" style="background-color: {color.color}"></div>
													<span>{t(`colors.${color.value}`, settings.language)}</span>
												</button>
										{/each}
									</div>
								{/if}
							</div>
					</div>

					<div class="setting-item">
						<label for="appearance-zen-mode">{t('settings.zenMode', settings.language)}</label>
						<label class="toggle">
							<input id="appearance-zen-mode" type="checkbox" checked={settings.zenMode} onchange={() => settings.toggleZenMode()} />
							<span class="toggle-slider"></span>
						</label>
					</div>
					</div>
					{:else if activeCategory === 'toolbars'}
					<div class="settings-group">
						<div class="settings-group-header">
							<h2>{t('settings.toolbarsSettings', settings.language)}</h2>
						</div>

						<details class="toolbar-settings toolbar-settings-accordion">
							<summary class="toolbar-settings-summary">
								<span class="toolbar-settings-chevron" aria-hidden="true"></span>
								<span>{t('settings.applicationToolbar', settings.language)}</span>
							</summary>
							<div class="toolbar-settings-body">
								<div class="toolbar-settings-header">
									<button
										type="button"
										class="reset-text-btn"
										onclick={() => settings.resetTitlebarToolbar()}>
										{t('settings.resetToolbar', settings.language)}
									</button>
								</div>
								<div class="toolbar-settings-list" role="list">
									{#each titlebarToolbarSettingsActions as action, index (action.id)}
										{@const actionName = t(action.labelKey, settings.language) === action.labelKey ? action.fallbackName : t(action.labelKey, settings.language)}
										<div
											class="toolbar-tool-row titlebar-toolbar-row"
											class:drag-source={titlebarToolbarDraggingId === action.id}
											class:drag-over={titlebarToolbarDragOverId === action.id}
											role="listitem"
											data-titlebar-toolbar-action-id={action.id}>
											<button
												type="button"
												class="toolbar-drag-handle"
												aria-label={`${t('settings.move', settings.language)}: ${actionName}`}
												onpointerdown={(e) => handleTitlebarToolbarDragPointerDown(e, action.id)}>
												::
											</button>
											<label class="toolbar-tool-toggle" for={`titlebar-toolbar-action-${action.id}`}>
												<input
													id={`titlebar-toolbar-action-${action.id}`}
													type="checkbox"
													checked={isTitlebarToolbarActionVisible(action.id)}
													disabled={action.required}
													onchange={(e) => settings.setTitlebarToolbarActionVisible(action.id, e.currentTarget.checked)}
												/>
												<span class="toolbar-tool-name">{actionName}</span>
												<span class="toolbar-tool-sample">{action.sample}</span>
											</label>
											<div class="toolbar-placement-controls" role="group" aria-label={`${t('settings.toolbarPlacement', settings.language)}: ${actionName}`}>
												<button
													type="button"
													class:active={getTitlebarToolbarActionPlacement(action.id) === 'bar'}
													onclick={() => settings.setTitlebarToolbarActionPlacement(action.id, 'bar')}>
													{t('settings.toolbarOnBar', settings.language)}
												</button>
												<button
													type="button"
													class:active={getTitlebarToolbarActionPlacement(action.id) === 'menu'}
													onclick={() => settings.setTitlebarToolbarActionPlacement(action.id, 'menu')}>
													{t('settings.toolbarInMenu', settings.language)}
												</button>
											</div>
											<div class="toolbar-order-controls">
												<button
													type="button"
													disabled={index === 0}
													aria-label={`${t('settings.moveUp', settings.language)}: ${actionName}`}
													onclick={() => settings.moveTitlebarToolbarAction(action.id, 'up')}>
													{t('settings.moveUp', settings.language)}
												</button>
												<button
													type="button"
													disabled={index === titlebarToolbarSettingsActions.length - 1}
													aria-label={`${t('settings.moveDown', settings.language)}: ${actionName}`}
													onclick={() => settings.moveTitlebarToolbarAction(action.id, 'down')}>
													{t('settings.moveDown', settings.language)}
												</button>
											</div>
										</div>
									{/each}
								</div>
							</div>
						</details>

						<details class="toolbar-settings toolbar-settings-accordion">
							<summary class="toolbar-settings-summary">
								<span class="toolbar-settings-chevron" aria-hidden="true"></span>
								<span>{t('settings.editorToolbar', settings.language)}</span>
							</summary>
							<div class="toolbar-settings-body">
								<div class="toolbar-settings-header">
									<button
										type="button"
										class="reset-text-btn"
										onclick={() => settings.resetEditorToolbar()}>
										{t('settings.resetToolbar', settings.language)}
									</button>
								</div>
								<div class="toolbar-settings-list" role="list">
									{#each editorToolbarSettingsTools as tool, index (tool.id)}
										<div
											class="toolbar-tool-row"
											class:drag-source={editorToolbarDraggingId === tool.id}
											class:drag-over={editorToolbarDragOverId === tool.id}
											role="listitem"
											data-editor-toolbar-tool-id={tool.id}>
											<button
												type="button"
												class="toolbar-drag-handle"
												aria-label={`${t('settings.move', settings.language)}: ${tool.name}`}
												onpointerdown={(e) => handleEditorToolbarDragPointerDown(e, tool.id)}>
												::
											</button>
											<label class="toolbar-tool-toggle" for={`editor-toolbar-tool-${tool.id}`}>
												<input
													id={`editor-toolbar-tool-${tool.id}`}
													type="checkbox"
													checked={isEditorToolbarToolVisible(tool.id)}
													onchange={(e) => settings.setEditorToolbarToolVisible(tool.id, e.currentTarget.checked)}
												/>
												<span class="toolbar-tool-name">{tool.name}</span>
												<span class="toolbar-tool-sample">{tool.label}</span>
											</label>
											<div class="toolbar-order-controls">
												<button
													type="button"
													disabled={index === 0}
													aria-label={`${t('settings.moveUp', settings.language)}: ${tool.name}`}
													onclick={() => settings.moveEditorToolbarTool(tool.id, 'up')}>
													{t('settings.moveUp', settings.language)}
												</button>
												<button
													type="button"
													disabled={index === editorToolbarSettingsTools.length - 1}
													aria-label={`${t('settings.moveDown', settings.language)}: ${tool.name}`}
													onclick={() => settings.moveEditorToolbarTool(tool.id, 'down')}>
													{t('settings.moveDown', settings.language)}
												</button>
											</div>
										</div>
									{/each}
								</div>
							</div>
						</details>
					</div>
					{:else if activeCategory === 'files'}
					<div class="settings-group">
						<div class="settings-group-header">
							<h2>{t('settings.fileSettings', settings.language)}</h2>
						</div>

						<div class="setting-item">
							<label for="files-auto-save">{t('settings.autoSave', settings.language)}</label>
							<label class="toggle">
								<input id="files-auto-save" type="checkbox" checked={settings.autoSave} onchange={() => settings.toggleAutoSave()} />
								<span class="toggle-slider"></span>
							</label>
						</div>

						<div class="setting-item">
							<label for="files-confirm-before-save">{t('settings.confirmBeforeSave', settings.language)}</label>
							<label class="toggle">
								<input id="files-confirm-before-save" type="checkbox" checked={settings.confirmBeforeSave} onchange={() => settings.toggleConfirmBeforeSave()} />
								<span class="toggle-slider"></span>
							</label>
						</div>
					</div>
					{/if}
				</div>
			</div>
			{#each settingsResizeHandles as handle}
				<button
					type="button"
					tabindex="-1"
					class="settings-resize-handle {handle.className}"
					aria-label={t('settings.resizeWindow', settings.language)}
					onclick={(e) => e.stopPropagation()}
					onpointerdown={(e) => handleSettingsResizePointerDown(e, handle.edges)}></button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.settings-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
	}

	.settings-modal {
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
		width: min(560px, 90vw);
		max-width: 90vw;
		min-width: min(520px, 90vw);
		height: 420px;
		max-height: 90vh;
		min-height: min(360px, 90vh);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
		font-family: var(--win-font);
	}

	.settings-modal.dragging,
	.settings-modal.resizing {
		user-select: none;
	}

	.settings-resize-handle {
		position: absolute;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-fg-muted);
		z-index: 2;
	}

	.settings-resize-handle.resize-n,
	.settings-resize-handle.resize-s {
		left: 12px;
		right: 12px;
		height: 6px;
		cursor: ns-resize;
	}

	.settings-resize-handle.resize-n {
		top: -2px;
	}

	.settings-resize-handle.resize-s {
		bottom: -2px;
	}

	.settings-resize-handle.resize-e,
	.settings-resize-handle.resize-w {
		top: 12px;
		bottom: 12px;
		width: 6px;
		cursor: ew-resize;
	}

	.settings-resize-handle.resize-e {
		right: -2px;
	}

	.settings-resize-handle.resize-w {
		left: -2px;
	}

	.settings-resize-handle.resize-ne,
	.settings-resize-handle.resize-se,
	.settings-resize-handle.resize-sw,
	.settings-resize-handle.resize-nw {
		width: 18px;
		height: 18px;
	}

	.settings-resize-handle.resize-ne {
		top: -2px;
		right: -2px;
		cursor: nesw-resize;
	}

	.settings-resize-handle.resize-se {
		right: -2px;
		bottom: -2px;
		cursor: nwse-resize;
	}

	.settings-resize-handle.resize-sw {
		left: -2px;
		bottom: -2px;
		cursor: nesw-resize;
	}

	.settings-resize-handle.resize-nw {
		top: -2px;
		left: -2px;
		cursor: nwse-resize;
	}

	.settings-resize-handle.resize-se::before {
		content: '';
		position: absolute;
		right: 4px;
		bottom: 4px;
		width: 9px;
		height: 9px;
		border-right: 1px solid currentColor;
		border-bottom: 1px solid currentColor;
		opacity: 0.7;
	}

	.settings-resize-handle.resize-se::after {
		content: '';
		position: absolute;
		right: 8px;
		bottom: 8px;
		width: 5px;
		height: 5px;
		border-right: 1px solid currentColor;
		border-bottom: 1px solid currentColor;
		opacity: 0.55;
	}

	.settings-resize-handle:hover {
		color: var(--color-fg-default);
	}

	.settings-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--color-border-default);
		cursor: grab;
		user-select: none;
	}

	.settings-modal.dragging .settings-header {
		cursor: grabbing;
	}

	.settings-header h1 {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 4px;
		color: var(--color-fg-default);
	}

	.close-btn:hover {
		background: var(--color-neutral-muted);
	}

	.settings-content {
		display: flex;
		flex: 1;
		overflow: hidden;
	}

	.settings-nav {
		width: 140px;
		padding: 12px 8px;
		border-right: 1px solid var(--color-border-default);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		line-height: 1;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 6px;
		font-size: 13px;
		color: var(--color-fg-default);
		text-align: left;
	}

	.nav-item svg {
		width: 16px;
		height: 16px;
	}

	.nav-item:hover {
		background: var(--color-neutral-muted);
	}

	.nav-item.active {
		background: var(--color-accent-fg);
		color: var(--color-btn-fg);
	}

	.nav-footer {
		margin-top: auto;
		display: flex;
		flex-direction: column;
	}

	.github-btn,
	.check-updates-btn {
		display: flex;
		align-items: center;
		padding: 8px 12px;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 6px;
		opacity: 0.5;
		font-size: 13px;
		color: var(--color-fg-default);
		text-align: left;
		transition: all 0.1s;
		gap: 8px;
		font-family: inherit;
	}

	.github-btn:hover,
	.check-updates-btn:hover {
		opacity: 1;
	}

	.check-updates-btn svg {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.check-updates-btn span {
		margin-top: 1px;
	}

	.github-btn .github-icon {
		width: 16px;
		height: 16px;
	}

	.github-btn span {
		margin-top: 1px;
	}

	.github-btn .version-code {
		margin-left: auto;
		font-size: 11px;
		color: var(--color-fg-muted);
		margin-top: 2px;
	}

	.settings-panel {
		flex: 1;
		padding: 20px;
		overflow-y: auto;
		min-height: 0;
	}

	.settings-group h2 {
		font-size: 16px;
		font-weight: 600;
		margin: 0 0 16px 0;
		color: var(--color-fg-default);
	}

	.settings-group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}

	.settings-group-header h2 {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
		color: var(--color-fg-default);
	}

	.reset-text-btn {
		background: transparent;
		border: none;
		color: var(--color-fg-muted);
		font-size: 13px;
		cursor: pointer;
		padding: 0;
		transition: all 0.1s;
		text-decoration: none;
	}

	.reset-text-btn:hover:not(.disabled) {
		color: var(--color-accent-fg);
	}

	.reset-text-btn.disabled {
		opacity: 0.5;
		cursor: default;
	}

	.setting-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 0;
		border-bottom: 1px solid var(--color-border-muted);
	}

	.setting-item label:first-child {
		font-size: 13px;
		color: var(--color-fg-default);
		display: flex;
		align-items: center;
		height: 100%;
	}

	.toolbar-settings {
		padding: 0;
		border-bottom: 1px solid var(--color-border-muted);
	}

	.toolbar-settings-summary {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 0;
		list-style: none;
		color: var(--color-fg-default);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		user-select: none;
	}

	.toolbar-settings-summary::-webkit-details-marker {
		display: none;
	}

	.toolbar-settings-summary::marker {
		content: '';
	}

	.toolbar-settings-chevron {
		width: 7px;
		height: 7px;
		border-right: 1.5px solid var(--color-fg-muted);
		border-bottom: 1.5px solid var(--color-fg-muted);
		transform: rotate(-45deg);
		transition: transform 0.12s ease;
	}

	.toolbar-settings[open] .toolbar-settings-chevron {
		transform: rotate(45deg);
	}

	.toolbar-settings-body {
		padding-bottom: 12px;
	}

	.toolbar-settings-header {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		margin-bottom: 8px;
	}

	.toolbar-settings-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.toolbar-tool-row {
		display: grid;
		grid-template-columns: 18px minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		min-height: 34px;
		padding: 4px 6px;
		border: 1px solid var(--color-border-muted);
		border-radius: 6px;
		background: var(--color-canvas-subtle);
	}

	.titlebar-toolbar-row {
		grid-template-columns: 18px minmax(0, 1fr) auto auto;
	}

	.toolbar-tool-row.drag-source {
		opacity: 0.55;
	}

	.toolbar-tool-row.drag-over {
		border-color: var(--color-accent-fg);
		background: var(--color-neutral-muted);
	}

	.toolbar-drag-handle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 26px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-fg-muted);
		cursor: grab;
		font-family: inherit;
		font-size: 12px;
		line-height: 1;
		text-align: center;
		user-select: none;
	}

	.toolbar-drag-handle:active,
	.toolbar-tool-row.drag-source .toolbar-drag-handle {
		cursor: grabbing;
	}

	.toolbar-tool-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		font-size: 13px;
		color: var(--color-fg-default);
	}

	.toolbar-tool-toggle input {
		flex: 0 0 auto;
	}

	.toolbar-tool-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toolbar-tool-sample {
		flex: 0 0 28px;
		width: 28px;
		height: 24px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border-muted);
		border-radius: 4px;
		color: var(--color-fg-muted);
		background: var(--color-canvas-default);
		font-size: 12px;
		font-weight: 600;
	}

	.toolbar-order-controls {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.toolbar-placement-controls {
		display: inline-flex;
		align-items: center;
		padding: 2px;
		border: 1px solid var(--color-border-default);
		border-radius: 5px;
		background: var(--color-canvas-default);
	}

	.toolbar-placement-controls button {
		height: 22px;
		padding: 0 7px;
		border: none;
		border-radius: 3px;
		background: transparent;
		color: var(--color-fg-muted);
		font-size: 11px;
		cursor: pointer;
	}

	.toolbar-placement-controls button.active {
		background: var(--color-accent-fg);
		color: var(--color-btn-fg);
	}

	.toolbar-placement-controls button:not(.active):hover {
		background: var(--color-neutral-muted);
		color: var(--color-fg-default);
	}

	.toolbar-order-controls button {
		height: 24px;
		padding: 0 8px;
		border: 1px solid var(--color-border-default);
		border-radius: 4px;
		background: var(--color-canvas-default);
		color: var(--color-fg-default);
		font-size: 11px;
		cursor: pointer;
	}

	.toolbar-order-controls button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.toolbar-order-controls button:not(:disabled):hover {
		background: var(--color-neutral-muted);
	}

	.select-wrapper {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	.select-arrow {
		position: absolute;
		right: 10px;
		pointer-events: none;
		color: var(--color-fg-muted);
	}

	.setting-item select {
		padding: 6px 32px 6px 12px;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		background-color: var(--color-canvas-default);
		color: var(--color-fg-default);
		font-size: 13px;
		min-width: 160px;
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
		-moz-appearance: none;
	}

	.setting-item select option {
		background-color: var(--color-canvas-default);
		color: var(--color-fg-default);
	}

	.setting-item select:focus {
		outline: none;
		border-color: var(--color-accent-fg);
	}

	.slider-container {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.number-input-wrapper {
		display: flex;
		align-items: stretch;
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 4px;
		overflow: hidden;
		transition: border-color 0.1s;
	}

	.number-input-wrapper:focus-within {
		border-color: var(--color-accent-fg);
	}

	.number-input {
		width: 40px;
		padding: 4px 8px;
		background: transparent;
		border: none;
		color: var(--color-fg-default);
		font-family: inherit;
		font-size: 13px;
		text-align: right;
		appearance: textfield;
		-moz-appearance: textfield;
		outline: none;
	}

	.number-input::-webkit-outer-spin-button,
	.number-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	.number-input-wrapper.horizontal {
		align-items: center;
		height: 28px;
	}

	.number-input-wrapper.horizontal .number-input {
		text-align: center;
		width: 36px;
		padding: 4px 0;
		height: 100%;
		border-radius: 0;
	}

	.spin-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		width: 28px;
		background: transparent;
		border: none;
		color: var(--color-fg-subtle);
		cursor: pointer;
		padding: 0;
		transition: all 0.1s;
	}

	.spin-btn:hover {
		background: var(--color-canvas-subtle);
		color: var(--color-fg-default);
	}

	.spin-btn:active {
		background: var(--color-border-muted);
	}

	.text-input {
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-fg-default);
		padding: 6px 10px;
		font-size: 13px;
		outline: none;
	}

	.text-input:focus {
		border-color: var(--color-accent-fg);
	}

	.import-btn {
		background: var(--color-canvas-subtle);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-fg-default);
		padding: 6px 12px;
		font-size: 13px;
		cursor: pointer;
		outline: none;
		transition: all 0.1s;
	}

	.import-btn:hover:not(:disabled) {
		background: var(--color-border-default);
	}

	.import-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spin-btn.minus {
		border-right: 1px solid var(--color-border-default);
	}

	.spin-btn.plus {
		border-left: 1px solid var(--color-border-default);
	}

	.slider-value {
		font-size: 12px;
		color: var(--color-fg-muted);
	}

	.toggle {
		position: relative;
		display: inline-block;
		width: 40px;
		height: 20px;
		cursor: pointer;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-slider {
		position: absolute;
		cursor: pointer;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: transparent;
		border: 1px solid var(--color-fg-muted);
		transition:
			background-color 0.2s,
			border-color 0.2s;
		border-radius: 20px;
	}

	.toggle-slider:before {
		position: absolute;
		content: '';
		height: 12px;
		width: 12px;
		left: 3px;
		bottom: 3px;
		background-color: #abb2bf; 
		transition:
			transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
			height 0.2s,
			width 0.2s,
			left 0.2s,
			bottom 0.2s,
			background-color 0.2s;
		border-radius: 50%;
	}

	.toggle input:checked + .toggle-slider {
		background-color: var(--color-accent-fg);
		border-color: var(--color-accent-fg);
	}

	.toggle input:checked + .toggle-slider:before {
		transform: translateX(20px);
		background-color: #fff;
	}
	.custom-dropdown-wrapper {
		position: relative;
		min-width: 140px;
	}

	.custom-dropdown-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 8px;
		background-color: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 4px;
		color: var(--color-fg-default);
		font-size: 13px;
		font-family: inherit;
		cursor: pointer;
		outline: none;
	}
	.custom-dropdown-btn:hover {
		background-color: var(--color-canvas-subtle);
	}

	.custom-dropdown-menu {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 4px;
		background-color: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
		padding: 4px;
		display: flex;
		flex-direction: column;
		min-width: 140px;
		z-index: 10005;
		gap: 1px;
	}

	.custom-dropdown-option {
		display: flex;
		align-items: center;
		gap: 8px;
		background: transparent;
		border: none;
		text-align: left;
		padding: 6px 12px;
		font-size: 13px;
		color: var(--color-fg-default);
		cursor: pointer;
		border-radius: 4px;
		font-family: inherit;
		width: 100%;
	}

	.custom-dropdown-option:hover {
		background-color: var(--color-canvas-subtle);
	}

	.custom-dropdown-option.selected {
		background-color: var(--color-canvas-subtle);
		font-weight: 500;
	}

	.color-circle {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
		border: 1px solid rgba(128, 128, 128, 0.4);
	}
</style>
