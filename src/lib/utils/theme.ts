import * as monaco from 'monaco-editor';

export async function parseAndApplyVscodeTheme(themeJsonStr: string, name: string) {
    const cleanJson = themeJsonStr.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
    let theme;
    try {
        theme = JSON.parse(cleanJson);
    } catch (e) {
        console.error("Failed to parse theme JSON:", e);
        return;
    }

    const isDark = theme.type !== 'light';

    const colors = theme.colors || {};
    
    const cssVars: Record<string, string> = {};
    
    cssVars['--color-canvas-default'] = colors['editor.background'] || colors['window.background'] || colors['sideBar.background'] || (isDark ? '#1e1e1e' : '#ffffff');
    cssVars['--color-canvas-subtle'] = colors['sideBar.background'] || colors['editorWidget.background'] || (isDark ? '#252526' : '#f3f3f3');
    cssVars['--color-canvas-overlay'] = colors['editorWidget.background'] || colors['dropdown.background'] || cssVars['--color-canvas-subtle'];
    cssVars['--tab-active-bg'] = colors['tab.activeBackground'] || colors['editorGroupHeader.tabsBackground'] || cssVars['--color-canvas-default'];
    
    cssVars['--color-fg-default'] = colors['editor.foreground'] || colors['sideBar.foreground'] || colors['foreground'] || (isDark ? '#d4d4d4' : '#333333');
    cssVars['--color-fg-muted'] = colors['descriptionForeground'] || colors['tab.inactiveForeground'] || (isDark ? '#999999' : '#666666');
    cssVars['--color-fg-subtle'] = colors['disabledForeground'] || cssVars['--color-fg-muted'];
    
    cssVars['--color-border-default'] = colors['activityBar.border'] || colors['editorGroup.border'] || colors['focusBorder'] || (isDark ? '#444444' : '#dddddd');
    cssVars['--color-border-muted'] = colors['sideBarSectionHeader.border'] || colors['widget.border'] || cssVars['--color-border-default'];
    cssVars['--color-window-border-top'] = colors['titleBar.activeBackground'] || cssVars['--color-border-default'];
    cssVars['--color-neutral-muted'] = colors['button.secondaryBackground'] || (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)');
    
    cssVars['--color-accent-fg'] = colors['textLink.foreground'] || colors['button.background'] || colors['focusBorder'] || '#007acc';
    cssVars['--color-accent-emphasis'] = colors['textLink.activeForeground'] || colors['button.hoverBackground'] || cssVars['--color-accent-fg'];
    
    cssVars['--color-btn-fg'] = colors['button.foreground'] || (isDark ? '#ffffff' : '#000000');
    cssVars['--color-btn-hover-bg'] = colors['button.hoverBackground'] || cssVars['--color-accent-emphasis'];
    cssVars['--color-tab-active-fg'] = colors['tab.activeForeground'] || cssVars['--color-btn-fg'];
    
    cssVars['--color-success-fg'] = colors['terminal.ansiGreen'] || colors['gitDecoration.addedResourceForeground'] || '#89d185';
    cssVars['--color-attention-fg'] = colors['terminal.ansiYellow'] || colors['gitDecoration.modifiedResourceForeground'] || '#cca700';
    cssVars['--color-danger-fg'] = colors['terminal.ansiRed'] || colors['gitDecoration.deletedResourceForeground'] || '#f14c4c';
    cssVars['--color-done-fg'] = colors['terminal.ansiMagenta'] || '#c586c0';
    
    cssVars['--hljs-bg'] = cssVars['--color-canvas-subtle'];
    cssVars['--hljs-comment'] = cssVars['--color-fg-muted'];
    cssVars['--hljs-keyword'] = cssVars['--color-accent-fg'];
    cssVars['--hljs-string'] = cssVars['--color-success-fg'];
    cssVars['--hljs-title'] = cssVars['--color-attention-fg'];
    cssVars['--hljs-variable'] = cssVars['--color-fg-default'];
    cssVars['--hljs-type'] = cssVars['--color-fg-default'];

    let styleTag = document.getElementById('vscode-theme-style');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'vscode-theme-style';
        document.head.appendChild(styleTag);
    }
    
    const rootStyles = Object.entries(cssVars).map(([k, v]) => `${k}: ${v};`).join('\n');
    styleTag.innerHTML = `:root[data-theme="vscode"] {\n${rootStyles}\n}`;
    document.documentElement.dataset.theme = 'vscode';
    document.documentElement.dataset.themeType = isDark ? 'dark' : 'light';

    const bgHex = (cssVars['--color-canvas-default'] || '').replace('#', '');
    if (bgHex.length === 6) {
        const r = parseInt(bgHex.slice(0, 2), 16) / 255;
        const g = parseInt(bgHex.slice(2, 4), 16) / 255;
        const b = parseInt(bgHex.slice(4, 6), 16) / 255;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const wsColor = luminance > 0.5 ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)';
        document.documentElement.style.setProperty('--color-whitespace', wsColor);
    }

    try {
        if (monaco) {
            const rules: any[] = [];
            const tokenColors = theme.tokenColors || [];
            
            for (const item of tokenColors) {
                if (!item.settings || (!item.settings.foreground && !item.settings.fontStyle)) continue;
                
                const scopes = Array.isArray(item.scope) ? item.scope : [item.scope];
                for (let scope of scopes) {
                    if (!scope) continue;
                    rules.push({
                        token: scope,
                        foreground: item.settings.foreground?.replace('#', ''),
                        fontStyle: item.settings.fontStyle
                    });
                }
            }
            
            monaco.editor.defineTheme('vscode-custom', {
                base: isDark ? 'vs-dark' : 'vs',
                inherit: true,
                rules: rules,
                colors: colors
            });
            
            monaco.editor.setTheme('vscode-custom');
        }
    } catch (e) {
        console.error("Monaco theme application failed:", e);
    }
}

export function clearVscodeTheme() {
    const styleTag = document.getElementById('vscode-theme-style');
    if (styleTag) styleTag.remove();
    document.documentElement.style.removeProperty('--color-whitespace');
}
