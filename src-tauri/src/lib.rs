use comrak::{markdown_to_html, ComrakExtensionOptions, ComrakOptions};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use regex::{Captures, Regex};
use std::borrow::Cow;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

/// Write `bytes` to `target` atomically: write to a sibling temp file, fsync it,
/// then rename over the target. Falls back to a plain `fs::write` only if the
/// target has no parent directory (a path like "foo.md" with no leading dir),
/// which `fs::rename` would not be able to handle safely anyway.
///
/// On both Unix and Windows `fs::rename` is atomic when source and destination
/// live on the same filesystem; placing the temp next to the target guarantees
/// that. On crash mid-write the original file is left intact.
fn atomic_write(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = match target.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => return fs::write(target, bytes),
    };

    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "markpad".to_string());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let temp_name = format!(".{}.markpad-tmp-{}-{}", file_name, pid, nanos);
    let mut temp_path: PathBuf = parent;
    temp_path.push(temp_name);

    let write_result = (|| -> std::io::Result<()> {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        Ok(())
    })();

    if let Err(e) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(e);
    }

    if let Err(e) = fs::rename(&temp_path, target) {
        let _ = fs::remove_file(&temp_path);
        return Err(e);
    }

    Ok(())
}

struct WatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

mod setup;

#[tauri::command]
async fn show_window(window: tauri::Window) {
    window.show().unwrap();
}

fn process_internal_embeds(content: &str) -> Cow<'_, str> {
    let re = Regex::new(r"(?s)```.*?```|`.*?`|!\[\[(.*?)\]\]").unwrap();

    re.replace_all(content, |caps: &Captures| {
        let full_match = caps.get(0).unwrap().as_str();
        if full_match.starts_with('`') {
            return full_match.to_string();
        }

        let inner = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let mut parts = inner.split('|');
        let path = parts.next().unwrap_or("");
        let size = parts.next();

        let path_escaped = path.replace(" ", "%20");

        if let Some(size_str) = size {
            if size_str.contains('x') {
                let mut dims = size_str.split('x');
                let width = dims.next().unwrap_or("");
                let height = dims.next().unwrap_or("");
                format!(
                    "<img src=\"{}\" width=\"{}\" height=\"{}\" alt=\"{}\" />",
                    path_escaped, width, height, path
                )
            } else {
                format!(
                    "<img src=\"{}\" width=\"{}\" alt=\"{}\" />",
                    path_escaped, size_str, path
                )
            }
        } else {
            format!("<img src=\"{}\" alt=\"{}\" />", path_escaped, path)
        }
    })
}

fn process_wikilinks<'a>(content: &'a str) -> Cow<'a, str> {
    let mut processed = Cow::Borrowed(content);

    // 1. Process [[#target]] or [[#target|alias]]
    let re_links = Regex::new(r"(?s)```.*?```|`.*?`|\[\[#([^\|\]]+)(?:\|([^\]]+))?\]\]").unwrap();
    if re_links.is_match(&processed) {
        let replaced = re_links.replace_all(&processed, |caps: &Captures| {
            let full_match = caps.get(0).unwrap().as_str();
            if full_match.starts_with('`') {
                return full_match.to_string();
            }
            let target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let alias = caps.get(2).map(|m| m.as_str()).unwrap_or(target);
            let target_id = target.to_lowercase().replace(' ', "-");
            format!("[{}](#{})", alias, target_id)
        });
        processed = Cow::Owned(replaced.into_owned());
    }

    // 2. Process ^block-id at the end of lines
    // For block IDs, they are trailing. We skip code blocks but also need to be careful with inline code at EOL.
    let re_ids = Regex::new(r"(?s)```.*?```|`.*?`|(?m)\s+\^([a-zA-Z0-9_-]+)$").unwrap();
    if re_ids.is_match(&processed) {
        let replaced = re_ids.replace_all(&processed, |caps: &Captures| {
            let full_match = caps.get(0).unwrap().as_str();
            if full_match.starts_with('`') {
                return full_match.to_string();
            }
            let id = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            format!(
                " <a id=\"{}\" class=\"block-id-anchor\" data-label=\"{}\"></a>",
                id, id
            )
        });
        processed = Cow::Owned(replaced.into_owned());
    }

    // 3. Convert ==highlight== to <mark>highlight</mark>
    let re_highlight = Regex::new(r"(?s)```.*?```|`.*?`|==([^=\n]+)==").unwrap();
    if re_highlight.is_match(&processed) {
        let replaced = re_highlight.replace_all(&processed, |caps: &Captures| {
            let full_match = caps.get(0).unwrap().as_str();
            if full_match.starts_with('`') {
                return full_match.to_string();
            }
            format!("<mark>{}</mark>", caps.get(1).unwrap().as_str())
        });
        processed = Cow::Owned(replaced.into_owned());
    }

    // 4. Convert ^[inline footnote] to a footnote reference
    let re_inline_fn = Regex::new(r"(?s)```.*?```|`.*?`|\^\[([^\]]+)\]").unwrap();
    if re_inline_fn.is_match(&processed) {
        let mut footnote_defs = String::new();
        let mut fn_count = 0usize;
        let replaced = re_inline_fn.replace_all(&processed, |caps: &Captures| {
            let full_match = caps.get(0).unwrap().as_str();
            if full_match.starts_with('`') {
                return full_match.to_string();
            }
            fn_count += 1;
            let label = format!("ifn-{}", fn_count);
            footnote_defs.push_str(&format!(
                "\n[^{}]: {}\n",
                label,
                caps.get(1).unwrap().as_str()
            ));
            format!("[^{}]", label)
        });
        let mut out = replaced.into_owned();
        out.push_str(&footnote_defs);
        processed = Cow::Owned(out);
    }

    processed
}

#[tauri::command]
fn convert_markdown(content: &str) -> String {
    let processed_embeds = process_internal_embeds(content);
    let processed_links = process_wikilinks(&processed_embeds);

    let mut options = ComrakOptions {
        extension: ComrakExtensionOptions {
            strikethrough: true,
            table: true,
            autolink: true,
            tasklist: true,
            superscript: false,
            footnotes: true,
            description_lists: true,
            header_ids: Some(String::new()),
            ..ComrakExtensionOptions::default()
        },
        ..ComrakOptions::default()
    };
    options.render.unsafe_ = true;
    options.render.hardbreaks = true;
    options.render.sourcepos = true;

    markdown_to_html(&processed_links, &options)
}

#[tauri::command]
async fn open_markdown(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        Ok(convert_markdown(&content))
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command]
async fn open_markdown_preview(path: String, max_bytes: usize) -> Result<(String, String, bool), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let mut f = fs::File::open(&path).map_err(|e| e.to_string())?;
        
        let metadata = f.metadata().map_err(|e| e.to_string())?;
        if metadata.len() <= max_bytes as u64 {
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let html = convert_markdown(&content);
            return Ok((html, content, true));
        }

        let mut vec_buf = vec![0; max_bytes];
        let n = f.read(&mut vec_buf).map_err(|e| e.to_string())?;
        vec_buf.truncate(n);

        let preview_content = String::from_utf8_lossy(&vec_buf).into_owned();

        let html = convert_markdown(&preview_content);
        Ok((html, preview_content, false))
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command]
async fn render_markdown(content: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(convert_markdown(&content))
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_file_content(path: String, content: String) -> Result<(), String> {
    atomic_write(Path::new(&path), content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_file_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    atomic_write(Path::new(&path), &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_file_folder(path: String) -> Result<(), String> {
    opener::reveal(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn watch_file(
    handle: AppHandle,
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    let mut watcher_lock = state.watcher.lock().unwrap();

    *watcher_lock = None;

    let path_to_watch = path.clone();
    let app_handle = handle.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(_) = res {
                let _ = app_handle.emit("file-changed", ());
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path_to_watch), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    *watcher_lock = Some(watcher);

    Ok(())
}

#[tauri::command]
fn unwatch_file(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut watcher_lock = state.watcher.lock().unwrap();
    *watcher_lock = None;
    Ok(())
}

struct AppState {
    startup_file: Mutex<Option<String>>,
}

#[tauri::command]
fn send_markdown_path(state: State<'_, AppState>) -> Vec<String> {
    let mut files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with("-"))
        .collect();

    if let Some(startup_path) = state.startup_file.lock().unwrap().as_ref() {
        if !files.contains(startup_path) {
            files.insert(0, startup_path.clone());
        }
    }

    files
}

#[tauri::command]
fn save_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let theme_path = config_dir.join("theme.txt");
    fs::write(theme_path, theme).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_app_mode() -> String {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--uninstall") {
        return "uninstall".to_string();
    }

    let current_exe = std::env::current_exe().unwrap_or_default();
    let exe_name = current_exe
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    let is_installer_mode =
        args.iter().any(|arg| arg == "--install") || exe_name.contains("installer");

    if setup::is_installed() {
        "app".to_string()
    } else {
        if is_installer_mode {
            "installer".to_string()
        } else {
            "app".to_string()
        }
    }
}

#[tauri::command]
async fn fetch_vscode_theme(app: AppHandle, url: String) -> Result<String, String> {
    use std::io::{Cursor, Read};
    // Parse URL: e.g. https://vscodethemes.com/e/teabyii.ayu/ayu-dark-bordered
    let parts: Vec<&str> = url.split('/').collect();
    if parts.len() < 5 || parts[3] != "e" {
        return Err("Invalid vscodethemes.com URL".to_string());
    }
    let pub_ext = parts[4];
    let theme_name = parts
        .get(5)
        .unwrap_or(&"")
        .split('?')
        .next()
        .unwrap_or("")
        .to_string();
    let pe_parts: Vec<&str> = pub_ext.split('.').collect();
    if pe_parts.len() != 2 {
        return Err("Invalid extension format in URL".to_string());
    }
    let publisher = pe_parts[0];
    let extension = pe_parts[1];

    let vsix_url = format!("https://{publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/{publisher}/extension/{extension}/latest/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage");

    let response = reqwest::get(&vsix_url).await.map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    let reader = Cursor::new(bytes.as_ref());
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;

    let mut package_json_data = String::new();
    if let Ok(mut file) = archive.by_name("extension/package.json") {
        file.read_to_string(&mut package_json_data)
            .map_err(|e| e.to_string())?;
    } else {
        return Err("No package.json found in VSIX".to_string());
    }

    let package_json: serde_json::Value =
        serde_json::from_str(&package_json_data).map_err(|e| e.to_string())?;
    let themes = package_json
        .get("contributes")
        .and_then(|c| c.get("themes"))
        .and_then(|t| t.as_array())
        .ok_or("No themes found in extension")?;

    let mut theme_path = None;
    let mut matched_name_str = theme_name.clone();

    for t in themes {
        let label = t
            .get("label")
            .or(t.get("id"))
            .and_then(|l| l.as_str())
            .unwrap_or("");
        let path = t.get("path").and_then(|p| p.as_str()).unwrap_or("");

        let label_slug = label
            .to_lowercase()
            .replace(|c: char| !c.is_alphanumeric(), "-");

        // If theme_name is empty, just take the first one
        if theme_name.is_empty()
            || label_slug == theme_name.to_lowercase()
            || path.to_lowercase().contains(&theme_name.to_lowercase())
        {
            theme_path = Some(path.to_string());
            if theme_name.is_empty() {
                matched_name_str = label_slug;
            }
            break;
        }
    }

    if let Some(mut path) = theme_path {
        if path.starts_with("./") {
            path = path[2..].to_string();
        }
        let full_path = format!("extension/{}", path).replace("\\", "/");
        let mut theme_file = archive.by_name(&full_path).map_err(|e| e.to_string())?;
        let mut theme_json = String::new();
        theme_file
            .read_to_string(&mut theme_json)
            .map_err(|e| e.to_string())?;

        let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
        let themes_dir = config_dir.join("themes");
        fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;

        let dest_name = if matched_name_str.is_empty() {
            "downloaded_theme".to_string()
        } else {
            matched_name_str.clone()
        };
        let theme_file_path = themes_dir.join(format!("{}.json", dest_name));
        fs::write(&theme_file_path, &theme_json).map_err(|e| e.to_string())?;

        return Ok(dest_name);
    }

    Err("Theme name not found in extension".to_string())
}

#[tauri::command]
fn get_saved_vscode_themes(app: AppHandle) -> Result<Vec<String>, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let themes_dir = config_dir.join("themes");
    let mut themes = Vec::new();
    if let Ok(entries) = fs::read_dir(themes_dir) {
        for entry in entries.flatten() {
            if let Some(ext) = entry.path().extension() {
                if ext == "json" {
                    if let Some(name) = entry.path().file_stem().and_then(|n| n.to_str()) {
                        themes.push(name.to_string());
                    }
                }
            }
        }
    }
    Ok(themes)
}

#[tauri::command]
fn read_vscode_theme(app: AppHandle, name: String) -> Result<String, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let theme_file_path = config_dir.join("themes").join(format!("{}.json", name));
    fs::read_to_string(theme_file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_vscode_theme(app: AppHandle, name: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let theme_file_path = config_dir.join("themes").join(format!("{}.json", name));
    fs::remove_file(theme_file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn is_win11() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklim = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(current_version) =
            hklim.open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        {
            if let Ok(current_build) = current_version.get_value::<String, _>("CurrentBuild") {
                if let Ok(build_num) = current_build.parse::<u32>() {
                    return build_num >= 22000;
                }
            }
        }
    }
    false
}

#[tauri::command]
fn get_system_fonts() -> Vec<String> {
    use font_kit::source::SystemSource;
    let source = SystemSource::new();
    let mut families = source.all_families().unwrap_or_default();
    families.sort();
    families.dedup();
    families
}

#[tauri::command]
fn get_os_type() -> String {
    #[cfg(target_os = "macos")]
    {
        "macos".to_string()
    }
    #[cfg(target_os = "windows")]
    {
        "windows".to_string()
    }
    #[cfg(target_os = "linux")]
    {
        "linux".to_string()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "unknown".to_string()
    }
}


#[tauri::command]
fn clipboard_write_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn clipboard_read_text() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

#[tauri::command]
fn clipboard_read_image(macos_image_scaling: bool) -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let image = clipboard.get_image().map_err(|e| e.to_string())?;

    // encode as png
    let mut png_data = Vec::new();
    {
        let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
        use image::ImageEncoder;
        
        // Check if running on macOS and scale image if needed
        #[cfg(target_os = "macos")]
        {
            if macos_image_scaling {
                // Use image crate for high-quality scaling
                use image::{DynamicImage, ImageBuffer, Rgba};
                
                // Convert arboard Image to ImageBuffer
                let mut img_buffer = ImageBuffer::new(image.width as u32, image.height as u32);
                for (x, y, pixel) in img_buffer.enumerate_pixels_mut() {
                    let idx = (y * image.width as u32 + x) as usize * 4;
                    if idx + 3 < image.bytes.len() {
                        *pixel = Rgba([
                            image.bytes[idx],
                            image.bytes[idx + 1],
                            image.bytes[idx + 2],
                            image.bytes[idx + 3]
                        ]);
                    }
                }
                
                // Create DynamicImage
                let dynamic_image = DynamicImage::ImageRgba8(img_buffer);
                
                // Resize with high-quality Lanczos3 filter
                let resized = dynamic_image.resize(
                    (image.width / 2) as u32,
                    (image.height / 2) as u32,
                    image::imageops::FilterType::Lanczos3
                );
                
                // Write the resized image
                let resized_rgba = resized.to_rgba8();
                encoder
                    .write_image(
                        resized_rgba.as_raw(),
                        (image.width / 2) as u32,
                        (image.height / 2) as u32,
                        image::ExtendedColorType::Rgba8,
                    )
                    .map_err(|e| e.to_string())?;
            } else {
                // Use original image if scaling is disabled
                encoder
                    .write_image(
                        image.bytes.as_ref(),
                        image.width as u32,
                        image.height as u32,
                        image::ExtendedColorType::Rgba8,
                    )
                    .map_err(|e| e.to_string())?;
            }
        }
        
        #[cfg(not(target_os = "macos"))]
        {
            // For other platforms, use the original image
            encoder
                .write_image(
                    image.bytes.as_ref(),
                    image.width as u32,
                    image.height as u32,
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| e.to_string())?;
        }
    }

    use base64::{engine::general_purpose, Engine as _};
    Ok(general_purpose::STANDARD.encode(&png_data))
}

#[tauri::command]
fn save_image(parent_dir: String, filename: String, base64_data: String, image_directory: String) -> Result<String, String> {
    let img_dir = Path::new(&parent_dir).join(&image_directory);
    if !img_dir.exists() {
        fs::create_dir_all(&img_dir).map_err(|e| e.to_string())?;
    }

    let file_path = img_dir.join(&filename);

    // remove potential data:image/png;base64, prefix
    let b64 = if let Some(pos) = base64_data.find("base64,") {
        &base64_data[pos + 7..]
    } else {
        &base64_data
    };

    use base64::{engine::general_purpose, Engine as _};
    let bytes = general_purpose::STANDARD
        .decode(b64)
        .map_err(|e: base64::DecodeError| e.to_string())?;

    fs::write(&file_path, bytes).map_err(|e| e.to_string())?;

    let rel_path = if image_directory.is_empty() {
        filename
    } else {
        format!("{}/{}", image_directory, filename)
    };

    Ok(rel_path)
}

#[tauri::command]
fn copy_file_to_img(src_path: String, parent_dir: String, image_directory: String) -> Result<String, String> {
    let img_dir = Path::new(&parent_dir).join(&image_directory);
    if !img_dir.exists() {
        fs::create_dir_all(&img_dir).map_err(|e| e.to_string())?;
    }

    let src = Path::new(&src_path);
    if !src.exists() {
        return Err("Source file does not exist".to_string());
    }

    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid source filename".to_string())?;

    // Handle name conflicts by appending timestamp if exists
    let mut dest_name = file_name.to_string();
    let dest_path = img_dir.join(&dest_name);
    if dest_path.exists() {
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        dest_name = format!("{}_{}.{}", stem, chrono::Local::now().timestamp(), ext);
    }

    let final_dest = img_dir.join(&dest_name);
    fs::copy(src, &final_dest).map_err(|e| e.to_string())?;

    let rel_path = if image_directory.is_empty() {
        dest_name
    } else {
        format!("{}/{}", image_directory, dest_name)
    };

    Ok(rel_path)
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn copy_file(src: String, dest: String) -> Result<(), String> {
    fs::copy(src, dest).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn cleanup_empty_img_dir(parent_dir: String, image_directory: String) -> Result<(), String> {
    let img_dir = Path::new(&parent_dir).join(&image_directory);
    if img_dir.exists() && img_dir.is_dir() {
        if fs::read_dir(&img_dir)
            .map_err(|e| e.to_string())?
            .next()
            .is_none()
        {
            fs::remove_dir(img_dir).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn list_directory_contents(path: String) -> Result<Vec<String>, String> {
    let dir = Path::new(&path);
    if !dir.exists() || !dir.is_dir() {
        return Err("Not a directory".to_string());
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            entries.push(format!("{}/", name));
        } else {
            entries.push(name);
        }
    }
    Ok(entries)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    #[cfg(target_os = "windows")]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--enable-features=SmoothScrolling",
        );
    }

    tauri::Builder::default()
        .manage(AppState {
            startup_file: Mutex::new(None),
        })
        .manage(WatcherState {
            watcher: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            println!("Single Instance Args: {:?}", args);

            let path_str = args
                .iter()
                .skip(1)
                .find(|a| !a.starts_with("-"))
                .map(|a| a.as_str())
                .unwrap_or("");

            if !path_str.is_empty() {
                let path = std::path::Path::new(path_str);
                let resolved_path = if path.is_absolute() {
                    path_str.to_string()
                } else {
                    let cwd_path = std::path::Path::new(&cwd);
                    cwd_path.join(path).display().to_string()
                };

                let _ = app
                    .get_webview_window("main")
                    .expect("no main window")
                    .emit("file-path", resolved_path);
            }
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();
        }))
        .plugin(tauri_plugin_prevent_default::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::VISIBLE
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            println!("Setup Args: {:?}", args);

            let current_exe = std::env::current_exe().unwrap_or_default();
            let exe_name = current_exe
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            let is_installer_mode =
                args.iter().any(|arg| arg == "--install") || exe_name.contains("installer");

            let label = if is_installer_mode {
                "installer"
            } else {
                "main"
            };

            let mut window_builder = tauri::WebviewWindowBuilder::new(
                app,
                label,
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Markpad")
            .inner_size(900.0, 650.0)
            .min_inner_size(400.0, 300.0)
            .visible(false)
            .resizable(true)
            .shadow(false)
            .center();

            #[cfg(target_os = "macos")]
            {
                window_builder = window_builder
                    .decorations(true)
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true);
            }

            #[cfg(not(target_os = "macos"))]
            {
                window_builder = window_builder.decorations(false);
            }

            let _window = window_builder.build()?;

            let config_dir = app.path().app_config_dir()?;
            let theme_path = config_dir.join("theme.txt");
            let theme_pref =
                fs::read_to_string(theme_path).unwrap_or_else(|_| "system".to_string());

            let window = app.get_webview_window(label).unwrap();

            let bg_color = match theme_pref.as_str() {
                "dark" => Some(tauri::window::Color(24, 24, 24, 255)),
                "light" => Some(tauri::window::Color(253, 253, 253, 255)),
                _ => {
                    if let Ok(t) = window.theme() {
                        match t {
                            tauri::Theme::Dark => Some(tauri::window::Color(24, 24, 24, 255)),
                            _ => Some(tauri::window::Color(253, 253, 253, 255)),
                        }
                    } else {
                        Some(tauri::window::Color(253, 253, 253, 255))
                    }
                }
            };

            let _ = window.set_background_color(bg_color);

            let _ = _window.set_shadow(true);

            let window = app.get_webview_window(label).unwrap();

            let file_path = args.iter().skip(1).find(|arg| !arg.starts_with("-"));

            if let Some(path) = file_path {
                let _ = window.emit("file-path", path.as_str());
            }

            // If installer, force size (this will be saved to installer-state, not main-state)
            if is_installer_mode {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 450.0,
                    height: 650.0,
                }));
                let _ = window.center();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            clipboard_write_text,
            clipboard_read_text,
            clipboard_read_image,
            open_markdown,
            open_markdown_preview,
            render_markdown,
            send_markdown_path,
            read_file_content,
            save_file_content,
            save_file_binary,
            get_app_mode,
            setup::install_app,
            setup::uninstall_app,
            setup::check_install_status,
            is_win11,
            open_file_folder,
            rename_file,
            watch_file,
            unwatch_file,
            show_window,
            save_theme,
            get_system_fonts,
            get_os_type,
            fetch_vscode_theme,
            get_saved_vscode_themes,
            read_vscode_theme,
            delete_vscode_theme,
            save_image,
            copy_file_to_img,
            delete_file,
            copy_file,
            cleanup_empty_img_dir,
            list_directory_contents
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                if let Some(url) = urls.first() {
                    if let Ok(path_buf) = url.to_file_path() {
                        let path_str = path_buf.to_string_lossy().to_string();

                        let state = _app_handle.state::<AppState>();
                        *state.startup_file.lock().unwrap() = Some(path_str.clone());

                        if let Some(window) = _app_handle.get_webview_window("main") {
                            let _ = window.emit("file-path", path_str);
                            let _ = window.set_focus();
                        }
                    }
                }
            }
        });
}
