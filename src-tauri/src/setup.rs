//! Windows install/uninstall chain.
//!
//! Error convention for the frontend: every failure that can only be fixed
//! by re-running elevated is reported as `Err("ELEVATION_REQUIRED: ...")`.
//! The installer UI must branch on that prefix instead of matching localized
//! Windows error text such as "Access is denied", which does not exist on a
//! Chinese or Japanese Windows.
use serde::Serialize;
#[cfg(any(target_os = "windows", test))]
use std::collections::hash_map::RandomState;
#[cfg(target_os = "windows")]
use std::env;
#[cfg(target_os = "windows")]
use std::fs;
#[cfg(any(target_os = "windows", test))]
use std::hash::{BuildHasher, Hasher};
#[cfg(any(target_os = "windows", test))]
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[cfg(target_os = "windows")]
use mslnk::ShellLink;
#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

#[cfg(any(target_os = "windows", test))]
const APP_NAME: &str = "Markpad";
#[cfg(any(target_os = "windows", test))]
const EXE_NAME: &str = "Markpad.exe";

/// Prefix that tells the frontend "this failed only because we are not
/// running elevated". Kept as a constant so both the installer and the
/// uninstaller emit exactly the same, locale-independent marker.
#[cfg(any(target_os = "windows", test))]
const ELEVATION_REQUIRED: &str = "ELEVATION_REQUIRED";

#[derive(Serialize)]
pub struct InstallStatus {
    pub is_installed: bool,
    pub all_users: bool,
    pub version: String,
}

#[cfg(target_os = "windows")]
fn uninstall_key_path() -> String {
    format!(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{}",
        APP_NAME
    )
}

// ---------------------------------------------------------------------------
// Platform-independent decision logic
//
// The Windows branches below cannot run on macOS/Linux CI, so every decision
// they make lives in a pure function that `mod tests` exercises everywhere.
// ---------------------------------------------------------------------------

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, PartialEq, Eq)]
enum AssociationRestore<'a> {
    KeepCurrent,
    SetPrevious(&'a str),
    Clear,
}

#[cfg(any(target_os = "windows", test))]
fn association_restore_action<'a>(
    current: Option<&str>,
    had_previous: bool,
    previous: Option<&'a str>,
) -> AssociationRestore<'a> {
    if current != Some("Markpad.File") {
        AssociationRestore::KeepCurrent
    } else if had_previous {
        previous
            .map(AssociationRestore::SetPrevious)
            .unwrap_or(AssociationRestore::Clear)
    } else {
        AssociationRestore::Clear
    }
}

/// A step of the install that already succeeded. The installer records these
/// as it goes so a later failure can be undone in reverse order instead of
/// leaving a half-installed copy that `is_installed()` reports as installed
/// while no uninstall entry exists (P1-D-2).
#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
enum InstallStep {
    /// The install directory did not exist and we created it.
    CreatedDir(PathBuf),
    CopiedExe { path: PathBuf, existed_before: bool },
    CreatedShortcut { path: PathBuf, existed_before: bool },
    WroteUninstallKey { all_users: bool, existed_before: bool },
    RegisteredAssociations { all_users: bool, existed_before: bool },
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
enum RollbackAction {
    RemoveFile(PathBuf),
    /// Non-recursive on purpose: we only ever remove a directory we created
    /// ourselves and only if it is empty again.
    RemoveDir(PathBuf),
    DeleteUninstallKey { all_users: bool },
    UnregisterAssociations { all_users: bool },
}

/// Undo plan for a failed install: completed steps in reverse order, skipping
/// anything that was already there before this run (an update/repair must not
/// delete the previous installation's files or registry entries).
#[cfg(any(target_os = "windows", test))]
fn rollback_actions(steps: &[InstallStep]) -> Vec<RollbackAction> {
    let mut actions = Vec::new();
    for step in steps.iter().rev() {
        match step {
            InstallStep::CreatedDir(path) => actions.push(RollbackAction::RemoveDir(path.clone())),
            InstallStep::CopiedExe {
                path,
                existed_before,
            }
            | InstallStep::CreatedShortcut {
                path,
                existed_before,
            } => {
                if !existed_before {
                    actions.push(RollbackAction::RemoveFile(path.clone()));
                }
            }
            InstallStep::WroteUninstallKey {
                all_users,
                existed_before,
            } => {
                if !existed_before {
                    actions.push(RollbackAction::DeleteUninstallKey {
                        all_users: *all_users,
                    });
                }
            }
            InstallStep::RegisteredAssociations {
                all_users,
                existed_before,
            } => {
                if !existed_before {
                    actions.push(RollbackAction::UnregisterAssociations {
                        all_users: *all_users,
                    });
                }
            }
        }
    }
    actions
}

/// All-users installs write to `%ProgramFiles%` and HKLM; both need admin.
/// Checked up front so we never start copying files we cannot finish.
#[cfg(any(target_os = "windows", test))]
fn elevation_error(
    all_users: bool,
    install_dir_writable: bool,
    hklm_writable: bool,
) -> Option<String> {
    if !all_users || (install_dir_writable && hklm_writable) {
        return None;
    }
    let mut blocked = Vec::new();
    if !install_dir_writable {
        blocked.push("the Program Files install directory");
    }
    if !hklm_writable {
        blocked.push("HKEY_LOCAL_MACHINE");
    }
    Some(format!(
        "{ELEVATION_REQUIRED}: installing for all users needs administrator rights ({} not writable). \
Restart Markpad as administrator, or install for the current user only.",
        blocked.join(" and ")
    ))
}

/// Uninstall refuses to touch the registry unless the installed files can
/// actually be removed. Without this, an unelevated uninstall of a Program
/// Files install deleted the Add/Remove Programs entry while every `del`
/// failed, leaving files on disk with no supported way to remove them (P1-D-1).
#[cfg(any(target_os = "windows", test))]
fn uninstall_precheck_error(install_dir: &str, deletable: bool) -> Option<String> {
    if deletable {
        return None;
    }
    Some(format!(
        "{ELEVATION_REQUIRED}: cannot delete the installed files in {install_dir}. \
Nothing was removed. Restart the uninstaller as administrator."
    ))
}

/// Turns an io error into a message the frontend can branch on: a permission
/// failure (Windows ERROR_ACCESS_DENIED maps to `PermissionDenied`) becomes
/// the locale-independent elevation marker.
#[cfg(any(target_os = "windows", test))]
fn io_error_message(context: &str, error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        format!("{ELEVATION_REQUIRED}: {context}: {error}")
    } else {
        format!("{context}: {error}")
    }
}

#[cfg(any(target_os = "windows", test))]
fn nearest_existing_ancestor(path: &Path, exists: impl Fn(&Path) -> bool) -> Option<&Path> {
    path.ancestors().find(|candidate| exists(candidate))
}

/// The levels that have to be created for `dir` to exist, shallowest first.
///
/// Returned as a list rather than deferring to `create_dir_all` so each level
/// becomes its own rollback step: creating `...\Start Menu\Programs` on a
/// profile that has neither folder must not leave an orphaned `Start Menu`
/// behind when a later install step fails.
#[cfg(any(target_os = "windows", test))]
fn missing_directories(dir: &Path, exists: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
    let mut missing: Vec<PathBuf> = dir
        .ancestors()
        .take_while(|candidate| !exists(candidate))
        .map(Path::to_path_buf)
        .collect();
    // `ancestors()` runs deepest first; creation has to go the other way.
    missing.reverse();
    missing
}

/// Creates every missing level of `dir` and records the ones we created.
///
/// The filesystem is reached through `exists`/`create` so this, and not a
/// Windows-only branch, holds the whole decision: which levels to create,
/// which to hand to the rollback, and what to do when one of them turns up
/// underneath us. `mod tests` drives it against a real temporary directory on
/// whatever OS runs `cargo test`.
///
/// A failure is returned, never swallowed. The caller asked for this shortcut
/// explicitly (it is a checkbox in the installer UI), and #364 gave the
/// install exactly two outcomes: complete, or rolled back. Skipping a
/// shortcut and reporting success would add a third one in which the user is
/// told the install worked and then finds no icon -- the same symptom as
/// #122, minus the error message that says what to do about it.
#[cfg(any(target_os = "windows", test))]
fn ensure_directory(
    dir: &Path,
    exists: impl Fn(&Path) -> bool,
    create: impl Fn(&Path) -> std::io::Result<()>,
    steps: &mut Vec<InstallStep>,
) -> std::io::Result<()> {
    for missing in missing_directories(dir, exists) {
        match create(&missing) {
            Ok(()) => steps.push(InstallStep::CreatedDir(missing)),
            // Something else got there first. It is now not ours to remove,
            // so it must not become a rollback step.
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

/// A per-user install and an all-users install keep their own hive. Only wipe
/// the *other* hive's file associations when no installation is registered
/// there; otherwise an all-users uninstall would break a coexisting per-user
/// install. When nothing is registered there, the leftover HKCU `.md` entry
/// would point at a `Markpad.File` ProgID we just deleted, so `.md` files stop
/// opening on double click (I-5).
#[cfg(any(target_os = "windows", test))]
fn should_clean_other_hive(other_hive_has_installation: bool) -> bool {
    !other_hive_has_installation
}

/// Full path into System32. `Command::new("wscript")` searched the
/// application and current directory first, which is hijackable and may run
/// elevated during an uninstall (I-6).
#[cfg(any(target_os = "windows", test))]
fn system32_tool(system_root: Option<&str>, tool: &str) -> String {
    let root = system_root.unwrap_or("C:\\Windows");
    let root = root.trim_end_matches('\\');
    format!("{root}\\System32\\{tool}")
}

/// Unpredictable suffix for temp file names. The uninstaller used fixed names
/// in the shared temp directory, so a pre-planted file was silently
/// overwritten (or, with `create_new`, could block the uninstall) (I-6).
#[cfg(any(target_os = "windows", test))]
fn random_suffix() -> String {
    let mut suffix = String::with_capacity(16);
    for round in 0..2u64 {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(round);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        hasher.write_u128(nanos);
        let probe = 0u8;
        hasher.write_usize(std::ptr::addr_of!(probe) as usize);
        suffix.push_str(&format!("{:08x}", hasher.finish() as u32));
    }
    suffix
}

#[cfg(any(target_os = "windows", test))]
struct UninstallScript<'a> {
    /// The id of the process being uninstalled. The script waits for exactly
    /// this process to exit; matching on the image name would also terminate a
    /// portable copy, another user's session, or a second window holding
    /// unsaved work (#358).
    process_id: u32,
    exe_path: &'a str,
    install_dir: &'a str,
    log_path: &'a str,
    system_root: Option<&'a str>,
    registry_hive: &'a str,
    registry_key: &'a str,
    display_name: &'a str,
}

/// The detached batch file that removes the files after the app exits.
///
/// Three deliberate properties:
///  * it waits for *this* process id to disappear and never matches on the
///    image name, so a portable copy or another user's session survives an
///    uninstall (#358);
///  * `del`/`rmdir` failures are appended to a log file instead of being
///    swallowed by `> nul 2>&1`, so a failed uninstall leaves evidence;
///  * if the files survive, the Add/Remove Programs entry is written back, so
///    the app can never disappear from the uninstall list while still on disk.
#[cfg(any(target_os = "windows", test))]
fn uninstall_batch_script(script: &UninstallScript) -> String {
    let reg = system32_tool(script.system_root, "reg.exe");
    let tasklist = system32_tool(script.system_root, "tasklist.exe");
    let find = system32_tool(script.system_root, "find.exe");
    let timeout = system32_tool(script.system_root, "timeout.exe");
    let key = format!("{}\\{}", script.registry_hive, script.registry_key);
    let process_id = script.process_id;
    let exe_path = script.exe_path;
    let install_dir = script.install_dir;
    let log_path = script.log_path;
    let display_name = script.display_name;
    format!(
        "@echo off\r\n\
set \"MARKPAD_LOG={log_path}\"\r\n\
> \"%MARKPAD_LOG%\" echo Markpad uninstall started\r\n\
set /a waits=0\r\n\
:waitloop\r\n\
\"{tasklist}\" /FI \"PID eq {process_id}\" | \"{find}\" \"{process_id}\" > nul\r\n\
if errorlevel 1 goto delete\r\n\
set /a waits+=1\r\n\
if %waits% geq 30 goto delete\r\n\
\"{timeout}\" /t 1 /nobreak > nul\r\n\
goto waitloop\r\n\
:delete\r\n\
set /a retries=0\r\n\
:loop\r\n\
del /f /q \"{exe_path}\" >> \"%MARKPAD_LOG%\" 2>&1\r\n\
if not exist \"{exe_path}\" goto removedir\r\n\
set /a retries+=1\r\n\
if %retries% geq 20 goto failed\r\n\
\"{timeout}\" /t 1 /nobreak > nul\r\n\
goto loop\r\n\
:removedir\r\n\
rmdir /s /q \"{install_dir}\" >> \"%MARKPAD_LOG%\" 2>&1\r\n\
if exist \"{install_dir}\" goto failed\r\n\
>> \"%MARKPAD_LOG%\" echo RESULT=OK\r\n\
del /f /q \"%MARKPAD_LOG%\" > nul 2>&1\r\n\
goto cleanup\r\n\
:failed\r\n\
>> \"%MARKPAD_LOG%\" echo RESULT=FAILED files remain in {install_dir}\r\n\
\"{reg}\" add \"{key}\" /v DisplayName /t REG_SZ /d \"{display_name}\" /f >> \"%MARKPAD_LOG%\" 2>&1\r\n\
\"{reg}\" add \"{key}\" /v UninstallString /t REG_SZ /d \"\\\"{exe_path}\\\" --uninstall\" /f >> \"%MARKPAD_LOG%\" 2>&1\r\n\
\"{reg}\" add \"{key}\" /v DisplayIcon /t REG_SZ /d \"{exe_path}\" /f >> \"%MARKPAD_LOG%\" 2>&1\r\n\
\"{reg}\" add \"{key}\" /v InstallLocation /t REG_SZ /d \"{install_dir}\" /f >> \"%MARKPAD_LOG%\" 2>&1\r\n\
:cleanup\r\n\
del \"%~f0\" > nul 2>&1\r\n"
    )
}

// ---------------------------------------------------------------------------
// Windows implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn user_profile() -> String {
    env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string())
}

#[cfg(target_os = "windows")]
fn roaming_app_data() -> String {
    env::var("APPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Roaming", user_profile()))
}

#[cfg(target_os = "windows")]
pub fn get_install_path(all_users: bool) -> PathBuf {
    if all_users {
        // Program Files
        let program_files =
            env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        PathBuf::from(program_files).join(APP_NAME)
    } else {
        // AppData/Local/Markpad
        let local_app_data =
            env::var("LOCALAPPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Local", user_profile()));
        PathBuf::from(local_app_data).join(APP_NAME)
    }
}

#[cfg(target_os = "windows")]
pub fn is_installed() -> bool {
    let Ok(current_exe) = env::current_exe() else {
        return false;
    };

    // Check both potential locations
    let user_path = get_install_path(false).join(EXE_NAME);
    let machine_path = get_install_path(true).join(EXE_NAME);

    let current_str = current_exe.to_string_lossy().to_lowercase();
    let user_str = user_path.to_string_lossy().to_lowercase();
    let machine_str = machine_path.to_string_lossy().to_lowercase();

    // Direct comparison first
    if current_str == user_str || current_str == machine_str {
        return true;
    }

    // Try canonicalize if they exist
    if let Ok(c_exe) = fs::canonicalize(&current_exe) {
        let c_str = c_exe.to_string_lossy().to_lowercase();

        if user_path.exists() {
            if let Ok(i_exe) = fs::canonicalize(&user_path) {
                if c_str == i_exe.to_string_lossy().to_lowercase() {
                    return true;
                }
            }
        }

        if machine_path.exists() {
            if let Ok(i_exe) = fs::canonicalize(&machine_path) {
                if c_str == i_exe.to_string_lossy().to_lowercase() {
                    return true;
                }
            }
        }
    }

    false
}

#[cfg(not(target_os = "windows"))]
pub fn is_installed() -> bool {
    // On macOS/Linux, assume installed or running from bundle
    true
}

/// Can we create (and therefore later delete) files in `dir`? Probes the
/// nearest existing ancestor when the directory itself is not there yet.
#[cfg(target_os = "windows")]
fn can_write_dir(dir: &Path) -> bool {
    let Some(existing) = nearest_existing_ancestor(dir, |candidate| candidate.exists()) else {
        return false;
    };
    let probe = existing.join(format!(".markpad-write-probe-{}", random_suffix()));
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

#[cfg(target_os = "windows")]
fn hklm_writable() -> bool {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
            KEY_WRITE,
        )
        .is_ok()
}

#[cfg(target_os = "windows")]
fn write_new_file(path: &Path, contents: &str) -> Result<(), String> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| io_error_message(&format!("Failed to create {}", path.display()), &e))?;
    file.write_all(contents.as_bytes())
        .map_err(|e| io_error_message(&format!("Failed to write {}", path.display()), &e))
}

#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn check_install_status() -> InstallStatus {
    println!("Checking install status...");

    // Check HKCU
    println!("Checking HKCU...");
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey_with_flags(uninstall_key_path(), KEY_READ) {
        if let Ok(version) = key.get_value::<String, _>("DisplayVersion") {
            println!("Found in HKCU: {}", version);
            return InstallStatus {
                is_installed: true,
                all_users: false,
                version,
            };
        }
    }

    // Check HKLM
    println!("Checking HKLM...");
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(key) = hklm.open_subkey_with_flags(uninstall_key_path(), KEY_READ) {
        if let Ok(version) = key.get_value::<String, _>("DisplayVersion") {
            println!("Found in HKLM: {}", version);
            return InstallStatus {
                is_installed: true,
                all_users: true,
                version,
            };
        }
    }

    println!("Not found.");

    InstallStatus {
        is_installed: false,
        all_users: false,
        version: String::new(),
    }
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub async fn check_install_status() -> InstallStatus {
    InstallStatus {
        is_installed: true,
        all_users: false,
        version: "0.0.0".to_string(),
    }
}

#[cfg(target_os = "windows")]
fn hive(all_users: bool) -> winreg::HKEY {
    if all_users {
        HKEY_LOCAL_MACHINE
    } else {
        HKEY_CURRENT_USER
    }
}

#[cfg(target_os = "windows")]
struct InstallRequest {
    all_users: bool,
    register_md: bool,
    desktop_shortcut: bool,
    start_menu: bool,
}

#[cfg(target_os = "windows")]
fn create_shortcut(
    target_exe: &Path,
    directory: &str,
    steps: &mut Vec<InstallStep>,
) -> Result<(), String> {
    let dir = PathBuf::from(directory);
    let lnk = dir.join(format!("{}.lnk", APP_NAME));
    let existed_before = lnk.exists();
    let describe = |error: String| -> String {
        if can_write_dir(&dir) {
            format!("Failed to create the shortcut in {}: {error}", dir.display())
        } else {
            format!(
                "{ELEVATION_REQUIRED}: cannot write the shortcut to {}: {error}",
                dir.display()
            )
        }
    };
    // mslnk writes the .lnk with a plain file create and will not build the
    // path leading to it. A trimmed or freshly provisioned profile can be
    // missing the per-user `...\Start Menu\Programs` folder, and a redirected
    // %PUBLIC% or %USERPROFILE% can leave `\Desktop` absent, so the install
    // failed for a directory we are perfectly able to create (#122).
    //
    // Classified through `io_error_message` rather than `describe`: this is a
    // real io::Error, so ERROR_ACCESS_DENIED can be read off its kind instead
    // of being guessed at with another write probe.
    ensure_directory(
        &dir,
        |candidate| candidate.exists(),
        // A closure, not `fs::create_dir` itself: the generic function item
        // binds one concrete lifetime and does not satisfy the higher-ranked
        // `Fn(&Path)` bound.
        |candidate| fs::create_dir(candidate),
        steps,
    )
    .map_err(|e| {
        io_error_message(
            &format!("Failed to create the shortcut directory {}", dir.display()),
            &e,
        )
    })?;
    let sl = ShellLink::new(target_exe).map_err(|e| describe(e.to_string()))?;
    sl.create_lnk(&lnk).map_err(|e| describe(e.to_string()))?;
    steps.push(InstallStep::CreatedShortcut {
        path: lnk,
        existed_before,
    });
    Ok(())
}

/// Every step appends to `steps` so the caller can undo the ones that already
/// landed when a later one fails.
#[cfg(target_os = "windows")]
fn perform_install(
    handle: &AppHandle,
    request: &InstallRequest,
    current_exe: &Path,
    install_dir: &Path,
    target_exe: &Path,
    steps: &mut Vec<InstallStep>,
) -> Result<(), String> {
    // 1. Create directory
    if !install_dir.exists() {
        fs::create_dir_all(install_dir).map_err(|e| {
            io_error_message(
                &format!("Failed to create {}", install_dir.display()),
                &e,
            )
        })?;
        steps.push(InstallStep::CreatedDir(install_dir.to_path_buf()));
    }

    // 2. Copy executable
    println!("Copying executable...");
    let exe_existed_before = target_exe.exists();
    // Retry loop in case the app is closing slowly during update
    let mut retries = 0;
    while retries < 5 {
        match fs::copy(current_exe, target_exe) {
            Ok(_) => {
                println!("Copy success.");
                break;
            }
            Err(e) => {
                println!("Copy failed (attempt {}): {}", retries, e);
                if retries == 4 {
                    return Err(io_error_message("Failed to copy executable", &e));
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
                retries += 1;
            }
        }
    }
    steps.push(InstallStep::CopiedExe {
        path: target_exe.to_path_buf(),
        existed_before: exe_existed_before,
    });

    // 3. Shortcuts
    println!("Creating shortcuts...");
    if request.desktop_shortcut {
        let desktop = if request.all_users {
            env::var("PUBLIC").unwrap_or_else(|_| "C:\\Users\\Public".to_string()) + "\\Desktop"
        } else {
            user_profile() + "\\Desktop"
        };
        create_shortcut(target_exe, &desktop, steps)?;
    }

    if request.start_menu {
        let start_menu_path = if request.all_users {
            env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string())
                + "\\Microsoft\\Windows\\Start Menu\\Programs"
        } else {
            roaming_app_data() + "\\Microsoft\\Windows\\Start Menu\\Programs"
        };
        create_shortcut(target_exe, &start_menu_path, steps)?;
    }

    // 4. Registry - Uninstaller
    println!("Updating registry...");
    let hk = RegKey::predef(hive(request.all_users));
    let key_existed_before = hk.open_subkey(uninstall_key_path()).is_ok();
    let (key, _) = hk
        .create_subkey(uninstall_key_path())
        .map_err(|e| io_error_message("Failed to write the uninstall registry key", &e))?;
    steps.push(InstallStep::WroteUninstallKey {
        all_users: request.all_users,
        existed_before: key_existed_before,
    });

    let set = |name: &str, result: std::io::Result<()>| -> Result<(), String> {
        result.map_err(|e| io_error_message(&format!("Failed to write {name}"), &e))
    };
    set("DisplayName", key.set_value("DisplayName", &APP_NAME))?;
    set(
        "UninstallString",
        key.set_value(
            "UninstallString",
            &format!("\"{}\" --uninstall", target_exe.display()),
        ),
    )?;
    set(
        "QuietUninstallString",
        key.set_value(
            "QuietUninstallString",
            &format!("\"{}\" --uninstall", target_exe.display()),
        ),
    )?;
    let target_exe_string = target_exe.to_string_lossy().into_owned();
    set("DisplayIcon", key.set_value("DisplayIcon", &target_exe_string))?;
    set("Publisher", key.set_value("Publisher", &"alecdotdev"))?;

    let version = handle.package_info().version.to_string();
    set("DisplayVersion", key.set_value("DisplayVersion", &version))?;

    let install_dir_string = install_dir.to_string_lossy().into_owned();
    set(
        "InstallLocation",
        key.set_value("InstallLocation", &install_dir_string),
    )?;
    set("NoModify", key.set_value("NoModify", &1u32))?;
    set("NoRepair", key.set_value("NoRepair", &1u32))?;

    // Install Date (YYYYMMDD)
    let date = chrono::Local::now().format("%Y%m%d").to_string();
    set("InstallDate", key.set_value("InstallDate", &date))?;

    // Estimated Size (KB)
    if let Ok(meta) = fs::metadata(target_exe) {
        let size_kb = (meta.len() / 1024) as u32;
        set("EstimatedSize", key.set_value("EstimatedSize", &size_kb))?;
    }

    // 5. File Associations
    println!("Registering file associations...");
    if request.register_md {
        let root = RegKey::predef(hive(request.all_users));
        let existed_before = root.open_subkey("Software\\Classes\\Markpad.File").is_ok();
        register_file_association(target_exe, request.all_users)
            .map_err(|e| io_error_message("Failed to register file associations", &e))?;
        steps.push(InstallStep::RegisteredAssociations {
            all_users: request.all_users,
            existed_before,
        });
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_rollback(actions: &[RollbackAction]) {
    for action in actions {
        match action {
            RollbackAction::RemoveFile(path) => {
                if let Err(e) = fs::remove_file(path) {
                    println!("Rollback: could not remove {}: {}", path.display(), e);
                }
            }
            RollbackAction::RemoveDir(path) => {
                if let Err(e) = fs::remove_dir(path) {
                    println!("Rollback: could not remove {}: {}", path.display(), e);
                }
            }
            RollbackAction::DeleteUninstallKey { all_users } => {
                let _ = RegKey::predef(hive(*all_users)).delete_subkey(uninstall_key_path());
            }
            RollbackAction::UnregisterAssociations { all_users } => {
                let _ = unregister_file_associations(&RegKey::predef(hive(*all_users)));
            }
        }
    }
}

#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn install_app(
    handle: AppHandle,
    all_users: bool,
    register_md: bool,
    desktop_shortcut: bool,
    start_menu: bool,
    launch_after: bool,
) -> Result<(), String> {
    let current_exe =
        env::current_exe().map_err(|e| io_error_message("Failed to locate the running app", &e))?;
    let install_dir = get_install_path(all_users);
    let target_exe = install_dir.join(EXE_NAME);

    println!("Installing to: {}", install_dir.display());

    // 0. Refuse before touching anything if we cannot finish (P1-D-2).
    // Both probes are only meaningful for an all-users install; skip them
    // (and the temp file they create) otherwise.
    if let Some(error) = elevation_error(
        all_users,
        !all_users || can_write_dir(&install_dir),
        !all_users || hklm_writable(),
    ) {
        return Err(error);
    }

    let request = InstallRequest {
        all_users,
        register_md,
        desktop_shortcut,
        start_menu,
    };
    let mut steps: Vec<InstallStep> = Vec::new();
    if let Err(error) = perform_install(
        &handle,
        &request,
        &current_exe,
        &install_dir,
        &target_exe,
        &mut steps,
    ) {
        println!("Install failed, rolling back: {}", error);
        apply_rollback(&rollback_actions(&steps));
        return Err(error);
    }

    // 6. Launch and Exit
    println!("Launching app...");
    if launch_after {
        // The install itself is complete; a failure to relaunch is not worth
        // undoing it.
        if let Err(e) = std::process::Command::new(&target_exe).spawn() {
            println!("Failed to launch the installed app: {}", e);
        }
    }
    handle.exit(0);

    Ok(())
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub async fn install_app(
    _handle: AppHandle,
    _all_users: bool,
    _register_md: bool,
    _desktop_shortcut: bool,
    _start_menu: bool,
    _launch_after: bool,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn uninstall_app(
    handle: AppHandle,
    target_all_users: Option<bool>,
) -> Result<(), String> {
    let current_exe =
        env::current_exe().map_err(|e| io_error_message("Failed to locate the running app", &e))?;

    let all_users = if let Some(all_users) = target_all_users {
        all_users
    } else {
        // Auto-detect based on running location
        let machine_path = get_install_path(true);
        let current_str = current_exe.to_string_lossy().to_lowercase();
        let machine_str = machine_path.to_string_lossy().to_lowercase();
        current_str.starts_with(&machine_str)
    };
    let install_dir = get_install_path(all_users);

    // 1. Prove the files can be removed before deleting anything the user
    //    needs in order to retry (P1-D-1). If the directory is already gone
    //    there is nothing to verify and the registry cleanup should proceed.
    let install_dir_string = install_dir.to_string_lossy().into_owned();
    let deletable = !install_dir.exists() || can_write_dir(&install_dir);
    if let Some(error) = uninstall_precheck_error(&install_dir_string, deletable) {
        return Err(error);
    }

    // 2. Stage the self-destruct scripts. Done before the registry cleanup so
    //    a failure here still leaves a working uninstall entry behind.
    let temp_dir = env::temp_dir();
    let suffix = random_suffix();
    let batch_path = temp_dir.join(format!("markpad_uninstall_{suffix}.bat"));
    let vbs_path = temp_dir.join(format!("markpad_uninstall_{suffix}.vbs"));
    let log_path = temp_dir.join(format!("markpad_uninstall_{suffix}.log"));

    let system_root = env::var("SystemRoot").ok();
    let exe_path_string = install_dir.join(EXE_NAME).to_string_lossy().into_owned();
    let log_path_string = log_path.to_string_lossy().into_owned();
    let registry_key = uninstall_key_path();
    let batch_content = uninstall_batch_script(&UninstallScript {
        process_id: std::process::id(),
        exe_path: &exe_path_string,
        install_dir: &install_dir_string,
        log_path: &log_path_string,
        system_root: system_root.as_deref(),
        registry_hive: if all_users { "HKLM" } else { "HKCU" },
        registry_key: &registry_key,
        display_name: APP_NAME,
    });
    write_new_file(&batch_path, &batch_content)?;

    // VBScript to run the batch file invisibly
    let vbs_content = format!(
        "CreateObject(\"Wscript.Shell\").Run \"\"\"{}\"\"\", 0, False\r\n\
        Set fso = CreateObject(\"Scripting.FileSystemObject\")\r\n\
        fso.DeleteFile WScript.ScriptFullName",
        batch_path.display()
    );
    write_new_file(&vbs_path, &vbs_content)?;

    // 3. Delete shortcuts
    let desktop_user = user_profile() + "\\Desktop";
    let desktop_public =
        env::var("PUBLIC").unwrap_or_else(|_| "C:\\Users\\Public".to_string()) + "\\Desktop";
    let _ = fs::remove_file(PathBuf::from(desktop_user).join(format!("{}.lnk", APP_NAME)));
    let _ = fs::remove_file(PathBuf::from(desktop_public).join(format!("{}.lnk", APP_NAME)));

    let start_user = roaming_app_data() + "\\Microsoft\\Windows\\Start Menu\\Programs";
    let start_machine = env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string())
        + "\\Microsoft\\Windows\\Start Menu\\Programs";
    let _ = fs::remove_file(PathBuf::from(start_user).join(format!("{}.lnk", APP_NAME)));
    let _ = fs::remove_file(PathBuf::from(start_machine).join(format!("{}.lnk", APP_NAME)));

    // 4. Delete only this installation's registry entries. Preserve an
    // association another application chose after Markpad was installed.
    let root = RegKey::predef(hive(all_users));
    let _ = root.delete_subkey(uninstall_key_path());
    let _ = unregister_file_associations(&root);

    // The other hive may hold a stale per-user (or per-machine) association
    // pointing at the Markpad.File ProgID we just deleted.
    let other = RegKey::predef(hive(!all_users));
    if should_clean_other_hive(other.open_subkey(uninstall_key_path()).is_ok()) {
        let _ = unregister_file_associations(&other);
    }

    // 5. Self-destruction: full System32 path, never a bare command name.
    //    Spawning has to come last, because the batch file kills this process
    //    within a second of starting.
    if let Err(e) = std::process::Command::new(system32_tool(
        system_root.as_deref(),
        "wscript.exe",
    ))
    .arg(&vbs_path)
    .spawn()
    {
        // Nothing will delete the files (Windows Script Host can be disabled
        // by policy), so put the Add/Remove Programs entry back instead of
        // orphaning an installation that can no longer be uninstalled.
        restore_uninstall_entry(all_users, &exe_path_string, &install_dir_string);
        let _ = fs::remove_file(&batch_path);
        let _ = fs::remove_file(&vbs_path);
        return Err(io_error_message("Failed to start the uninstall helper", &e));
    }

    handle.exit(0);
    Ok(())
}

/// Minimal Add/Remove Programs entry, written back when an uninstall could
/// not go through. It is deliberately just enough to run the uninstaller
/// again; the file associations stay removed (a broken `.md` double click is
/// recoverable, an uninstallable installation is not).
#[cfg(target_os = "windows")]
fn restore_uninstall_entry(all_users: bool, target_exe: &str, install_dir: &str) {
    let Ok((key, _)) = RegKey::predef(hive(all_users)).create_subkey(uninstall_key_path()) else {
        return;
    };
    let uninstall_string = format!("\"{target_exe}\" --uninstall");
    let _ = key.set_value("DisplayName", &APP_NAME);
    let _ = key.set_value("UninstallString", &uninstall_string);
    let _ = key.set_value("QuietUninstallString", &uninstall_string);
    let _ = key.set_value("DisplayIcon", &target_exe);
    let _ = key.set_value("InstallLocation", &install_dir);
    let _ = key.set_value("NoModify", &1u32);
    let _ = key.set_value("NoRepair", &1u32);
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub async fn uninstall_app(
    _handle: AppHandle,
    _target_all_users: Option<bool>,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn register_file_association(exe_path: &Path, all_users: bool) -> Result<(), std::io::Error> {
    let root = RegKey::predef(hive(all_users));

    backup_file_association(&root, ".md")?;
    backup_file_association(&root, ".markdown")?;

    // .md
    let (md_key, _) = root.create_subkey("Software\\Classes\\.md")?;
    md_key.set_value("", &"Markpad.File")?;

    // .markdown
    let (markdown_key, _) = root.create_subkey("Software\\Classes\\.markdown")?;
    markdown_key.set_value("", &"Markpad.File")?;

    // Markpad.File
    let (file_key, _) = root.create_subkey("Software\\Classes\\Markpad.File")?;
    file_key.set_value("", &"Markpad File")?;
    file_key.set_value("MarkpadOwner", &1u32)?;

    let (icon_key, _) = file_key.create_subkey("DefaultIcon")?;
    icon_key.set_value("", &format!("\"{}\",0", exe_path.display()))?;

    let (shell_key, _) = file_key.create_subkey("shell\\open\\command")?;
    shell_key.set_value("", &format!("\"{}\" \"%1\"", exe_path.display()))?;

    Ok(())
}

#[cfg(target_os = "windows")]
const CLASSES_PREFIX: &str = "Software\\Classes\\";

#[cfg(target_os = "windows")]
const MARKPAD_PROG_ID: &str = "Markpad.File";

#[cfg(target_os = "windows")]
const ASSOCIATION_BACKUP_KEY: &str = "Software\\Classes\\Markpad.File\\PreviousAssociations";

#[cfg(target_os = "windows")]
fn association_backup_name(extension: &str) -> &str {
    extension.trim_start_matches('.')
}

#[cfg(target_os = "windows")]
fn extension_key_path(extension: &str) -> String {
    format!("{CLASSES_PREFIX}{extension}")
}

#[cfg(target_os = "windows")]
fn backup_file_association(root: &RegKey, extension: &str) -> Result<(), std::io::Error> {
    let association = root
        .open_subkey(extension_key_path(extension))
        .ok()
        .and_then(|key| key.get_value::<String, _>("").ok());
    // An update/reinstall sees Markpad as the current owner. Keep the first
    // backup instead of replacing it with our own ProgID.
    if association.as_deref() == Some(MARKPAD_PROG_ID) {
        return Ok(());
    }
    let (backup, _) = root.create_subkey(ASSOCIATION_BACKUP_KEY)?;
    let name = association_backup_name(extension);
    backup.set_value(&format!("{name}.present"), &(association.is_some() as u32))?;
    if let Some(association) = association {
        backup.set_value(name, &association)?;
    } else {
        let _ = backup.delete_value(name);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn unregister_file_associations(root: &RegKey) -> Result<(), std::io::Error> {
    for extension in [".md", ".markdown"] {
        restore_file_association(root, extension)?;
    }

    let Ok(file_key) = root.open_subkey("Software\\Classes\\Markpad.File") else {
        return Ok(());
    };
    let owned_by_markpad = file_key.get_value::<u32, _>("MarkpadOwner").ok() == Some(1);
    drop(file_key);
    if owned_by_markpad {
        let _ = root.delete_subkey_all("Software\\Classes\\Markpad.File");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn restore_file_association(root: &RegKey, extension: &str) -> Result<(), std::io::Error> {
    let key_path = extension_key_path(extension);
    // Opening with create_subkey used to *create* the very key we are trying
    // to clean up, inventing an empty `.md` entry in a hive Markpad never
    // registered in (I-5). Read/modify only, and bail out when it is absent.
    let Ok(key) = root.open_subkey_with_flags(&key_path, KEY_READ | KEY_SET_VALUE) else {
        return Ok(());
    };
    let current = key.get_value::<String, _>("").ok();
    let name = association_backup_name(extension);
    let backup = root.open_subkey(ASSOCIATION_BACKUP_KEY).ok();
    let had_previous = backup
        .as_ref()
        .and_then(|key| key.get_value::<u32, _>(&format!("{name}.present")).ok())
        == Some(1);
    let previous = backup.and_then(|key| key.get_value::<String, _>(name).ok());
    match association_restore_action(current.as_deref(), had_previous, previous.as_deref()) {
        AssociationRestore::KeepCurrent => {}
        AssociationRestore::SetPrevious(previous) => key.set_value("", &previous)?,
        AssociationRestore::Clear => {
            let _ = key.delete_value("");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- file associations ---------------------------------------------------

    #[test]
    fn restores_the_previous_association_when_markpad_still_owns_it() {
        assert_eq!(
            association_restore_action(Some("Markpad.File"), true, Some("Other.Editor")),
            AssociationRestore::SetPrevious("Other.Editor"),
        );
    }

    #[test]
    fn preserves_an_association_taken_over_after_markpad_installation() {
        assert_eq!(
            association_restore_action(Some("Other.Editor"), true, Some("Earlier.Editor")),
            AssociationRestore::KeepCurrent,
        );
    }

    #[test]
    fn clears_markpad_association_when_there_was_no_previous_owner() {
        assert_eq!(
            association_restore_action(Some("Markpad.File"), false, None),
            AssociationRestore::Clear,
        );
    }

    // I-5: the other hive keeps a `.md` -> Markpad.File entry that would point
    // at a ProgID this uninstall deletes.
    #[test]
    fn cleans_the_other_hive_only_when_no_installation_lives_there() {
        assert!(should_clean_other_hive(false));
        assert!(!should_clean_other_hive(true));
    }

    // -- install rollback (P1-D-2) -------------------------------------------

    fn fresh_install_steps() -> Vec<InstallStep> {
        vec![
            InstallStep::CreatedDir(PathBuf::from("C:\\Program Files\\Markpad")),
            InstallStep::CopiedExe {
                path: PathBuf::from("C:\\Program Files\\Markpad\\Markpad.exe"),
                existed_before: false,
            },
        ]
    }

    #[test]
    fn rollback_undoes_completed_steps_in_reverse_order() {
        let mut steps = fresh_install_steps();
        steps.push(InstallStep::CreatedShortcut {
            path: PathBuf::from("C:\\Users\\Public\\Desktop\\Markpad.lnk"),
            existed_before: false,
        });

        assert_eq!(
            rollback_actions(&steps),
            vec![
                RollbackAction::RemoveFile(PathBuf::from(
                    "C:\\Users\\Public\\Desktop\\Markpad.lnk"
                )),
                RollbackAction::RemoveFile(PathBuf::from(
                    "C:\\Program Files\\Markpad\\Markpad.exe"
                )),
                RollbackAction::RemoveDir(PathBuf::from("C:\\Program Files\\Markpad")),
            ],
        );
    }

    // The exact P1-D-2 scenario: the exe is copied, the Public Desktop
    // shortcut fails, and nothing else ran. Without rollback the leftover exe
    // made is_installed() true forever while no uninstall entry existed.
    #[test]
    fn rollback_removes_the_copied_exe_when_the_shortcut_step_fails() {
        assert_eq!(
            rollback_actions(&fresh_install_steps()),
            vec![
                RollbackAction::RemoveFile(PathBuf::from(
                    "C:\\Program Files\\Markpad\\Markpad.exe"
                )),
                RollbackAction::RemoveDir(PathBuf::from("C:\\Program Files\\Markpad")),
            ],
        );
    }

    #[test]
    fn rollback_keeps_everything_an_update_found_already_installed() {
        let steps = vec![
            InstallStep::CopiedExe {
                path: PathBuf::from("C:\\Program Files\\Markpad\\Markpad.exe"),
                existed_before: true,
            },
            InstallStep::CreatedShortcut {
                path: PathBuf::from("C:\\Users\\Public\\Desktop\\Markpad.lnk"),
                existed_before: true,
            },
            InstallStep::WroteUninstallKey {
                all_users: true,
                existed_before: true,
            },
            InstallStep::RegisteredAssociations {
                all_users: true,
                existed_before: true,
            },
        ];
        assert!(
            rollback_actions(&steps).is_empty(),
            "an update must never delete the installation it was updating"
        );
    }

    #[test]
    fn rollback_removes_registry_work_before_files() {
        let mut steps = fresh_install_steps();
        steps.push(InstallStep::WroteUninstallKey {
            all_users: false,
            existed_before: false,
        });
        steps.push(InstallStep::RegisteredAssociations {
            all_users: false,
            existed_before: false,
        });

        let actions = rollback_actions(&steps);
        assert_eq!(
            actions[0],
            RollbackAction::UnregisterAssociations { all_users: false }
        );
        assert_eq!(
            actions[1],
            RollbackAction::DeleteUninstallKey { all_users: false }
        );
        assert!(matches!(actions[2], RollbackAction::RemoveFile(_)));
        assert!(matches!(actions[3], RollbackAction::RemoveDir(_)));
    }

    // -- elevation precheck (P1-D-2 / I-3) -----------------------------------

    #[test]
    fn per_user_install_never_requires_elevation() {
        assert_eq!(elevation_error(false, false, false), None);
    }

    #[test]
    fn all_users_install_requires_both_program_files_and_hklm() {
        assert_eq!(elevation_error(true, true, true), None);
        for (dir, hklm) in [(false, true), (true, false), (false, false)] {
            let error = elevation_error(true, dir, hklm).expect("should refuse to start");
            assert!(
                error.starts_with("ELEVATION_REQUIRED: "),
                "frontend branches on this prefix, not on localized text: {error}"
            );
        }
    }

    #[test]
    fn elevation_error_names_the_blocking_resource() {
        let error = elevation_error(true, false, true).unwrap();
        assert!(error.contains("install directory"));
        assert!(!error.contains("HKEY_LOCAL_MACHINE"));
        let error = elevation_error(true, true, false).unwrap();
        assert!(error.contains("HKEY_LOCAL_MACHINE"));
    }

    // -- uninstall precheck (P1-D-1) -----------------------------------------

    #[test]
    fn uninstall_refuses_when_the_files_cannot_be_deleted() {
        let error = uninstall_precheck_error("C:\\Program Files\\Markpad", false)
            .expect("must not touch the registry first");
        assert!(error.starts_with("ELEVATION_REQUIRED: "));
        assert!(error.contains("Nothing was removed"));
        assert!(error.contains("C:\\Program Files\\Markpad"));
    }

    #[test]
    fn uninstall_proceeds_when_the_files_can_be_deleted() {
        assert_eq!(
            uninstall_precheck_error("C:\\Users\\me\\AppData\\Local\\Markpad", true),
            None
        );
    }

    // -- error classification (I-3) ------------------------------------------

    #[test]
    fn permission_errors_carry_the_elevation_prefix() {
        let denied = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "Access is denied");
        let message = io_error_message("Failed to copy executable", &denied);
        assert!(message.starts_with("ELEVATION_REQUIRED: "));
        assert!(message.contains("Failed to copy executable"));
    }

    #[test]
    fn other_errors_do_not_claim_elevation_would_help() {
        let missing = std::io::Error::new(std::io::ErrorKind::NotFound, "not found");
        let message = io_error_message("Failed to copy executable", &missing);
        assert!(!message.contains("ELEVATION_REQUIRED"));
    }

    // -- writability probe target -------------------------------------------

    #[test]
    fn write_probe_targets_the_nearest_existing_ancestor() {
        let existing = ["/a", "/a/b"];
        let exists = |path: &Path| existing.contains(&path.to_string_lossy().as_ref());
        assert_eq!(
            nearest_existing_ancestor(Path::new("/a/b/c/d"), exists),
            Some(Path::new("/a/b"))
        );
        assert_eq!(
            nearest_existing_ancestor(Path::new("/a/b"), exists),
            Some(Path::new("/a/b"))
        );
        assert_eq!(nearest_existing_ancestor(Path::new("/x/y"), exists), None);
    }

    // -- helper process launch (I-6) -----------------------------------------

    #[test]
    fn helper_processes_are_launched_by_absolute_path() {
        assert_eq!(
            system32_tool(Some("C:\\Windows"), "wscript.exe"),
            "C:\\Windows\\System32\\wscript.exe"
        );
        // A trailing separator in %SystemRoot% must not double up.
        assert_eq!(
            system32_tool(Some("D:\\Win\\"), "reg.exe"),
            "D:\\Win\\System32\\reg.exe"
        );
        // Missing %SystemRoot% still yields an absolute path, never a bare
        // name that CreateProcessW would resolve from the current directory.
        assert!(system32_tool(None, "wscript.exe").starts_with("C:\\Windows\\System32\\"));
    }

    #[test]
    fn temp_script_names_are_unpredictable() {
        let mut seen = Vec::new();
        for _ in 0..32 {
            let suffix = random_suffix();
            assert_eq!(suffix.len(), 16);
            assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(!seen.contains(&suffix), "temp file names must not repeat");
            seen.push(suffix);
        }
    }

    // -- uninstall batch script (P1-D-1 / I-6) -------------------------------

    fn script_for_tests() -> String {
        uninstall_batch_script(&UninstallScript {
            process_id: 4567,
            exe_path: "C:\\Program Files\\Markpad\\Markpad.exe",
            install_dir: "C:\\Program Files\\Markpad",
            log_path: "C:\\Temp\\markpad_uninstall_dead.log",
            system_root: Some("C:\\Windows"),
            registry_hive: "HKLM",
            registry_key: "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Markpad",
            display_name: APP_NAME,
        })
    }

    #[test]
    fn uninstall_script_does_not_suppress_deletion_failures() {
        let script = script_for_tests();
        for line in script.lines() {
            let line = line.trim();
            if line.starts_with("del /f /q \"C:\\Program Files")
                || line.starts_with("rmdir")
            {
                assert!(
                    line.ends_with(">> \"%MARKPAD_LOG%\" 2>&1"),
                    "deletion failures must be logged, not swallowed: {line}"
                );
            }
        }
        assert!(script.contains("RESULT=FAILED"));
        assert!(script.contains("RESULT=OK"));
    }

    // The disaster case: files survive but the Add/Remove Programs entry was
    // already gone, leaving no supported way to uninstall.
    #[test]
    fn uninstall_script_restores_the_uninstall_entry_when_deletion_fails() {
        let script = script_for_tests();
        let failed = &script[script.find(":failed").expect("failure branch")..];
        assert!(failed.contains(
            "\"C:\\Windows\\System32\\reg.exe\" add \"HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Markpad\" /v UninstallString"
        ));
        assert!(failed.contains("/v DisplayName"));
        // ...and only on the failure path.
        let ok_branch = &script[..script.find(":failed").unwrap()];
        assert!(!ok_branch.contains("reg.exe\" add"));
    }

    #[test]
    fn uninstall_script_uses_absolute_paths_for_windows_tools() {
        let script = script_for_tests();
        assert!(script.contains("\"C:\\Windows\\System32\\tasklist.exe\" /FI"));
        assert!(script.contains("\"C:\\Windows\\System32\\find.exe\""));
        assert!(script.contains("\"C:\\Windows\\System32\\timeout.exe\" /t 1"));
        assert!(!script.contains("\ntasklist"));
        assert!(!script.contains("\nfind"));
        assert!(!script.contains("\ntimeout"));
    }

    #[test]
    fn uninstall_script_waits_for_its_own_process_instead_of_killing_all_markpad_processes() {
        // #358. Matching on the image name also terminated a portable copy,
        // an instance in another user's session, and any second window with
        // unsaved work. The script waits for the pid that spawned it.
        let script = script_for_tests();
        assert!(script.contains("/FI \"PID eq 4567\""));
        assert!(!script.contains("/IM"));
        assert!(!script.to_lowercase().contains("taskkill"));
    }

    #[test]
    fn uninstall_script_stops_waiting_rather_than_spinning_forever() {
        // If the pid never clears, reaching the deletion attempt is better
        // than an invisible batch file looping indefinitely: the attempt logs
        // its failure and restores the Add/Remove Programs entry.
        let script = script_for_tests();
        assert!(script.contains("if %waits% geq 30 goto delete"));
        let wait_block = &script[..script.find(":delete").unwrap()];
        assert!(!wait_block.contains("del /f /q"));
    }

    // -- shortcut target directory (#122) ------------------------------------
    //
    // `create_shortcut` cannot run here: it is `cfg(target_os = "windows")`
    // and builds a real `.lnk` through `mslnk`. The section is therefore split
    // in two, and neither half was run on Windows for this change.
    //
    //  * `missing_directories` / `ensure_directory` carry every decision the
    //    fix makes -- which levels to create, which of them the rollback owns,
    //    what happens when one appears underneath us, and whether a failure
    //    stops the install. They take the filesystem as closures, so the tests
    //    below drive them against a real temporary directory on the machine
    //    running `cargo test`. On macOS/Linux CI that is a genuine
    //    create-and-record run against the OS, not a mock.
    //
    //  * what cannot be reached from here is whether `create_shortcut` calls
    //    them at all. That single fact is asserted against the source text of
    //    this file. It proves the call exists and precedes `create_lnk`; it
    //    proves nothing about how Windows behaves when %USERPROFILE%\Desktop
    //    or `...\Start Menu\Programs` is missing, and nothing about mslnk.

    /// A temporary directory that does not exist yet, so a test can watch it
    /// being created. Uses `random_suffix` for the same reason the uninstaller
    /// does: no fixed name in a shared temp directory.
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("markpad-setup-test-{}", random_suffix()));
            std::fs::create_dir(&path).expect("temp root");
            Self(path)
        }

        fn join(&self, tail: &str) -> PathBuf {
            self.0.join(tail)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn create_dir_on_disk(path: &Path) -> std::io::Result<()> {
        std::fs::create_dir(path)
    }

    fn on_disk(path: &Path) -> bool {
        path.exists()
    }

    #[test]
    fn missing_directories_lists_the_levels_to_create_shallowest_first() {
        let existing = ["/users/me"];
        let exists = |path: &Path| existing.contains(&path.to_string_lossy().as_ref());
        assert_eq!(
            missing_directories(Path::new("/users/me/start menu/programs"), exists),
            vec![
                PathBuf::from("/users/me/start menu"),
                PathBuf::from("/users/me/start menu/programs"),
            ],
        );
    }

    #[test]
    fn missing_directories_creates_nothing_for_a_directory_that_is_there() {
        let exists = |path: &Path| path == Path::new("/users/me/desktop");
        assert!(missing_directories(Path::new("/users/me/desktop"), exists).is_empty());
    }

    // The #122 case, on a real filesystem: the shortcut directory is absent
    // and nothing but this code is going to create it.
    #[test]
    fn ensure_directory_creates_a_missing_shortcut_directory() {
        let root = TempRoot::new();
        let programs = root.join("Start Menu").join("Programs");
        assert!(!programs.exists(), "precondition: nothing there yet");

        let mut steps = Vec::new();
        ensure_directory(&programs, on_disk, create_dir_on_disk, &mut steps)
            .expect("the installer can create this directory");

        assert!(programs.is_dir(), "the .lnk needs a directory to go into");
    }

    #[test]
    fn ensure_directory_hands_every_level_it_created_to_the_rollback() {
        let root = TempRoot::new();
        let programs = root.join("Start Menu").join("Programs");
        let mut steps = Vec::new();
        ensure_directory(&programs, on_disk, create_dir_on_disk, &mut steps).unwrap();

        assert_eq!(
            steps,
            vec![
                InstallStep::CreatedDir(root.join("Start Menu")),
                InstallStep::CreatedDir(programs.clone()),
            ],
        );
        // #364's rollback walks the steps backwards, so the deepest level goes
        // first and `remove_dir` finds each one empty.
        assert_eq!(
            rollback_actions(&steps),
            vec![
                RollbackAction::RemoveDir(programs),
                RollbackAction::RemoveDir(root.join("Start Menu")),
            ],
        );
    }

    #[test]
    fn ensure_directory_never_offers_an_existing_directory_to_the_rollback() {
        let root = TempRoot::new();
        let desktop = root.join("Desktop");
        std::fs::create_dir(&desktop).unwrap();

        let mut steps = Vec::new();
        ensure_directory(&desktop, on_disk, create_dir_on_disk, &mut steps).unwrap();

        assert!(
            steps.is_empty(),
            "a rolled back install must not delete the user's own Desktop"
        );
        assert!(desktop.is_dir());
    }

    #[test]
    fn ensure_directory_does_not_claim_a_directory_that_appeared_underneath_it() {
        let root = TempRoot::new();
        let desktop = root.join("Desktop");
        // Only the leaf is reported missing, which is what
        // `candidate.exists()` reports in `create_shortcut`. A blanket
        // `|_| false` instead walks the ancestors all the way to the
        // filesystem root and asks us to create *that* -- and creating a root
        // that is already there is `AlreadyExists` on Unix but
        // ERROR_ACCESS_DENIED on Windows, so the run died on a level this test
        // never meant to exercise.
        let only_the_leaf_is_missing = |candidate: &Path| candidate != desktop;
        // Reports missing, then exists by the time we create it.
        let mut steps = Vec::new();
        ensure_directory(
            &desktop,
            only_the_leaf_is_missing,
            |path| {
                std::fs::create_dir(path)?;
                std::fs::create_dir(path)
            },
            &mut steps,
        )
        .expect("losing the race is not an install failure");

        assert!(desktop.is_dir());
        assert!(
            steps.is_empty(),
            "we did not create it, so we must not remove it"
        );
    }

    // The judgement call: a directory we cannot create fails the install (and
    // #364 unwinds it) instead of quietly dropping a shortcut the user ticked.
    #[test]
    fn ensure_directory_fails_the_install_rather_than_skipping_the_shortcut() {
        let mut steps = Vec::new();
        let error = ensure_directory(
            Path::new("/users/me/Desktop"),
            |_| false,
            |_| {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "Access is denied",
                ))
            },
            &mut steps,
        )
        .expect_err("must not report success without the shortcut");

        assert!(steps.is_empty(), "a failed create is not a rollback step");
        // The installer routes this through io_error_message, so the frontend
        // still gets the locale-independent elevation marker.
        assert!(io_error_message("Failed to create the shortcut directory", &error)
            .starts_with("ELEVATION_REQUIRED: "));
    }

    /// The body of `create_shortcut`, so the source assertion below cannot be
    /// satisfied by its own text further down this file.
    fn create_shortcut_source() -> String {
        const SOURCE: &str = include_str!("setup.rs");
        // The repo has no `.gitattributes`, so the Windows runner checks this
        // file out through `core.autocrlf=true` and `include_str!` hands back
        // CRLF. Every `\n`-anchored search below would then miss. Normalise
        // once, up front, rather than teaching each search about `\r`.
        let source = SOURCE.replace("\r\n", "\n");
        let start = source
            .find("fn create_shortcut(")
            .expect("create_shortcut must exist");
        let body = &source[start..];
        let end = body
            .find("\n}\n")
            .expect("create_shortcut must be brace-terminated")
            + 2;
        body[..end].to_string()
    }

    #[test]
    fn create_shortcut_creates_the_target_directory_before_writing_the_lnk() {
        let body = create_shortcut_source();
        let ensured = body.find("ensure_directory").unwrap_or_else(|| {
            panic!(
                "create_shortcut must create its target directory first: on a \
                 trimmed image the per-user Start Menu \\Programs folder and \
                 even %USERPROFILE%\\Desktop can be absent, and mslnk will not \
                 create them (#122)"
            )
        });
        let written = body
            .find("create_lnk")
            .expect("create_shortcut must write a .lnk");
        assert!(
            ensured < written,
            "the directory has to exist before the .lnk is written into it"
        );
    }

    #[test]
    fn uninstall_script_retry_counter_is_read_outside_a_parenthesised_block() {
        // %retries% inside `if exist (...)` expands at parse time; keeping the
        // increment and the test on their own lines keeps the bound at 20.
        let script = script_for_tests();
        assert!(script.contains("if not exist \"C:\\Program Files\\Markpad\\Markpad.exe\" goto removedir"));
        assert!(script.contains("if %retries% geq 20 goto failed"));
        assert!(
            script.lines().all(|line| !line.trim_end().ends_with('(')),
            "no parenthesised block: %retries% would expand at parse time"
        );
    }
}
