<div align="center">
  <img src="src-tauri/icons/128x128.png" width="128" alt="Markpad Icon" />
  <h1>Markpad</h1>
  <p><b>The Notepad equivalent for Markdown</b></p>
  
  [![GitHub Release](https://img.shields.io/github/v/release/sftwrdotdev/Markpad?style=flat-square)](https://github.com/sftwrdotdev/Markpad/releases/latest)

  <p>A lightweight, minimalist Markdown viewer and text editor built for productivity across Windows, macOS, and Linux.</p>

  <a href="https://markpad.dev">Website</a> // <a href="#download">Download</a> // <a href="samples/markdown-syntax.md">Markdown support</a> // <a href="https://github.com/sftwrdotdev/Markpad/issues">Report a Bug</a> // <a href="README.zh-CN.md">简体中文</a>
</div>

<br />

![demo](pics/demo.gif)
## Features

**Reading**
- GitHub-styled rendering, with syntax highlighting in code blocks
- Maths (KaTeX) and diagrams (Mermaid)
- Table of contents that follows wherever you scroll
- Folding by heading, and a Zen mode with everything else out of the way
- Content zoom, custom typography, custom themes (VS Code themes import)

**Editing**
- Monaco — the editor from VS Code — with Vim mode
- Split view, kept in sync line for line
- Heading completion for links, and a customisable formatting toolbar
- Paste an image straight into the document; drag files in to open them

**Documents**
- Tabs, multiple windows, window tags, and a session that comes back
- Auto-reload when a file changes on disk
- Export to HTML, print to PDF
- Wikilinks, embeds and callouts alongside standard Markdown — see
  **[Markdown support](samples/markdown-syntax.md)** for exactly what renders,
  and what happens to it elsewhere

**The rest**
- Windows, macOS and Linux
- ~10MB of memory, no telemetry, free and open source
- 26 interface languages

## Download

### Package Managers

#### Windows (Chocolatey)

```powershell
choco install markpad-app
```

#### Linux (Snap)

```bash
sudo snap install markpad 
```

### Direct download

Every file below is on the [latest release](https://github.com/sftwrdotdev/Markpad/releases/latest) page, and on [markpad.sftwr.dev](https://markpad.sftwr.dev).

| System | Chip | File | |
|---|---|---|---|
| **Windows** | Intel / AMD | `Markpad_x.y.z_x64-setup.exe` | installer |
| | Intel / AMD | `Markpad_x.y.z_x64.exe` | portable, no installation |
| | ARM64 | `Markpad_x.y.z_arm64-setup.exe` | installer |
| | ARM64 | `Markpad_x.y.z_arm64.exe` | portable |
| **macOS** | Intel **and** Apple Silicon | `Markpad_x.y.z_universal.dmg` | one file for both |
| **Linux** | x86-64 | `Markpad_x.y.z_amd64.AppImage` | portable, no installation |
| | x86-64 | `Markpad_x.y.z_amd64.deb` | Debian, Ubuntu |
| | x86-64 | `Markpad-x.y.z-1.x86_64.rpm` | Fedora, RHEL, openSUSE |

The two Windows files differ only in that one installs and one does not — `-setup.exe` puts Markpad in Program Files and the Start menu; the plain `.exe` runs from wherever you put it.

> After a direct `.dmg` (macOS), `*-setup.exe` (Windows NSIS) or `.AppImage` (Linux) install, Markpad self-updates from GitHub releases via the in-app *Check for Updates…* entry (macOS app menu, or Settings elsewhere). Snap, Chocolatey, `.deb` and `.rpm` users continue to update through their distribution channels.

## Installation from source

- Clone the repository
- Run `npm install` to install dependencies
- Run `npm run tauri build` to build the executable 

### Isolated macOS test bundle

For local verification without opening or replacing `/Applications/Markpad.app`, build an unsigned test-only app with an independent identifier:

```bash
MARKPAD_TEST_BUNDLE_ID=dev.example.markpad.test npm run build:test-bundle
```

The result is placed in `dist/test-bundle/`. It is not a distributable release: it has no Developer ID notarization or Windows Authenticode signature.

## Issues & Feedback

If you find a bug, have a feature request, or just want to leave some feedback, please [open an issue](https://github.com/sftwrdotdev/Markpad/issues/new/choose). I'm actively developing Markpad and love hearing from users!

## Contributing

Contributions are always welcome! Markpad is built with SvelteKit and Tauri. 

1. **Fork & Clone** the repository
2. **Install dependencies**: `npm install`
3. **Run the dev server**: `npm run tauri dev` (to run the Tauri app locally)
4. **Make your changes** and ensure type checking passes: `npm run check`
5. **Open a Pull Request**!

Please ensure your code follows the existing style and that you add descriptions for any new features.

## Screenshots

#### Split view
![split view](pics/splitview.png)
#### Editor toolbar
![editor toolbar](pics/2.7.0/editor-toolbar.png)
#### Home page
![home page](pics/home.png)
#### Split view minimal
![split view minimal](pics/splitview-minimal.png)
#### Code blocks
![code block](pics/codeblock.png)
#### Light mode
![light mode](pics/lightmode.png)
#### Settings
![settings](pics/2.7.0/editor-settings.png)
#### Zen mode
![zen mode](pics/zenmode-view.png)
#### Theme settings
![theme setting](pics/theme-setting.png)
#### Table of Contents
![table of contents](pics/2.7.0/floating-toc.png)
#### Theme example
![theme example](pics/theme-example.png)
#### Window tag
![window tag](pics/2.7.0/window-tag.png)
#### Drag and drop
![drag and drop](pics/drag-and-drop.png)
