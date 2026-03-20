<div align="center">
  <img src="src-tauri/icons/128x128.png" width="128" alt="Markpad Icon" />
  <h1>Markpad</h1>
  <p><b>The Notepad equivalent for Markdown</b></p>
  
  [![GitHub Release](https://img.shields.io/github/v/release/alecdotdev/Markpad?style=flat-square)](https://github.com/alecdotdev/Markpad/releases/latest)

  <p>A lightweight, minimalist Markdown viewer and text editor built for productivity across Windows, macOS, and Linux.</p>

  <a href="https://markpad.dev">Website</a> // <a href="https://github.com/alecdotdev/Markpad/releases/latest">Download Latest Release</a> // <a href="https://github.com/alecdotdev/Markpad/issues">Report a Bug</a>
</div>

<br />

![demo](pics/demo.gif)
## Features

- Tabbed interface
- Monaco editor (VS Code)
- Split view
- Syntax highlighting both in editor and code blocks
- Math equation support (KaTeX)
- Mermaid diagram support
- Vim mode
- Auto-reload
- Zen mode
- Table of contents
- Custom themes
- Paste images into editor
- Custom typography and font settings
- Content zooming
- Image and YouTube embeds
- Familiar GitHub styled markdown rendering
- Tiny memory usage (~10MB)
- No telemetry or bloat
- Free and open-source
- Lightweight native UI
- Cross-platform (Windows, macOS, Linux)

## Installation

### Package Managers

#### Windows (Chocolatey)

```powershell
choco install markpad-app --version=2.5.0 # version flag is temporary for now
```

#### Linux (Snap)

```bash
sudo snap install markpad 
```

### Direct Download

Download the latest executable or installer from the [releases page](https://github.com/alecdotdev/Markpad/releases/latest) or from [markpad.sftwr.dev](https://markpad.sftwr.dev)

## Installation from source

- Clone the repository
- Run `npm install` to install dependencies
- Run `npm run tauri build` to build the executable 
- [Optional] Rename to `MarkpadInstaller.exe` to run as installer

## Issues & Feedback

If you find a bug, have a feature request, or just want to leave some feedback, please [open an issue](https://github.com/alecdotdev/Markpad/issues/new/choose). I'm actively developing Markpad and love hearing from users!

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
#### Home page
![home page](pics/home.png)
#### Split view minimal
![split view minimal](pics/splitview-minimal.png)
#### Code blocks
![code block](pics/codeblock.png)
#### Light mode
![light mode](pics/lightmode.png)
#### Settings
![settings](pics/settings.png)
#### Zen mode
![zen mode](pics/zenmode-view.png)
#### Theme settings
![theme setting](pics/theme-setting.png)
#### Table of contents
![toc](pics/toc.png)
#### Theme example
![theme example](pics/theme-example.png)
#### Drag and drop
![drag and drop](pics/drag-and-drop.png)