use std::{
    cmp::Reverse,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const URL_WAIT_ATTEMPTS: usize = 150;
const URL_WAIT_DELAY: Duration = Duration::from_millis(200);

#[derive(Clone, Debug)]
struct LauncherRuntime {
    resource_app_root: PathBuf,
    build_root: PathBuf,
    app_root: PathBuf,
    run_root: PathBuf,
    instance_run_root: PathBuf,
    stdout_log_path: PathBuf,
    stderr_log_path: PathBuf,
    url_file_path: PathBuf,
    bootstrap_log_path: PathBuf,
    latest_instance_path: PathBuf,
    startup_trace_path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct BuildInfo {
    #[serde(rename = "buildId")]
    build_id: String,
}

#[derive(Default)]
struct AppState {
    child: Mutex<Option<CommandChild>>,
    child_exited: AtomicBool,
}

impl AppState {
    fn store_child(&self, child: CommandChild) {
        if let Ok(mut slot) = self.child.lock() {
            *slot = Some(child);
        }
        self.child_exited.store(false, Ordering::SeqCst);
    }

    fn mark_child_exited(&self) {
        self.child_exited.store(true, Ordering::SeqCst);
        if let Ok(mut slot) = self.child.lock() {
            slot.take();
        }
    }

    fn kill_child(&self) {
        if let Ok(mut slot) = self.child.lock() {
            if let Some(child) = slot.take() {
                let _ = child.kill();
            }
        }
        self.child_exited.store(true, Ordering::SeqCst);
    }
}

impl LauncherRuntime {
    fn create(app: &tauri::AppHandle) -> Result<Self, String> {
        let install_root = app
            .path()
            .app_local_data_dir()
            .map_err(|err| err.to_string())?;
        let build_root = install_root.join("builds");
        let run_root = install_root.join("run");
        let startup_trace_path = install_root.join("startup-trace.log");

        fs::create_dir_all(&build_root).map_err(|err| err.to_string())?;
        fs::create_dir_all(&run_root).map_err(|err| err.to_string())?;
        let resource_app_root = resolve_resource_app_root(app, &startup_trace_path)?;
        let _ = append_line(
            &startup_trace_path,
            &format!("resource_app_root={}", resource_app_root.display()),
        );

        let build_info_path = resource_app_root.join("BUILD-INFO.json");
        let _ = append_line(
            &startup_trace_path,
            &format!("build_info_path={}", build_info_path.display()),
        );
        let build_id = read_build_id(&build_info_path)?;
        let app_root = build_root.join(build_id);
        let instance_id = format!("{}-{}", unix_millis(), std::process::id());
        let instance_run_root = run_root.join(&instance_id);
        fs::create_dir_all(&instance_run_root).map_err(|err| err.to_string())?;

        let latest_instance_path = run_root.join("latest-instance.txt");
        fs::write(
            &latest_instance_path,
            instance_run_root.display().to_string(),
        )
        .map_err(|err| err.to_string())?;

        Ok(Self {
            resource_app_root,
            build_root,
            app_root,
            run_root,
            instance_run_root: instance_run_root.clone(),
            stdout_log_path: instance_run_root.join("stdout.log"),
            stderr_log_path: instance_run_root.join("stderr.log"),
            url_file_path: instance_run_root.join("viewer-url.txt"),
            bootstrap_log_path: instance_run_root.join("bootstrap.log"),
            latest_instance_path,
            startup_trace_path,
        })
    }

    fn ensure_payload_extracted(&self) -> Result<(), String> {
        let launcher_path = self.app_root.join("server").join("launcher.js");
        let public_index_path = self
            .app_root
            .join("server")
            .join("public")
            .join("index.html");
        let _ = append_line(
            &self.startup_trace_path,
            &format!(
                "ensure_payload_extracted app_root={}",
                self.app_root.display()
            ),
        );

        if launcher_path.exists() && public_index_path.exists() {
            let _ = append_line(
                &self.startup_trace_path,
                "packaged payload already available in app_root",
            );
            return Ok(());
        }

        if self.app_root.exists() {
            fs::remove_dir_all(&self.app_root).map_err(|err| err.to_string())?;
        }

        copy_dir_all(&self.resource_app_root, &self.app_root).map_err(|err| err.to_string())?;
        let _ = append_line(
            &self.startup_trace_path,
            "copied packaged payload into app_root",
        );
        Ok(())
    }

    fn cleanup_old_builds(&self) -> Result<(), String> {
        cleanup_old_directories(&self.build_root, Some(&self.app_root), 2)
            .map_err(|err| err.to_string())
    }

    fn cleanup_old_runs(&self) -> Result<(), String> {
        cleanup_old_directories(&self.run_root, Some(&self.instance_run_root), 5)
            .map_err(|err| err.to_string())
    }

    fn write_bootstrap_log(&self, message: &str) {
        let _ = fs::write(&self.bootstrap_log_path, message);
        let _ = fs::write(
            &self.latest_instance_path,
            self.instance_run_root.display().to_string(),
        );
        let _ = append_line(
            &self.startup_trace_path,
            &format!("bootstrap failure: {message}"),
        );
    }
}

fn resolve_resource_app_root(
    app: &tauri::AppHandle,
    startup_trace_path: &Path,
) -> Result<PathBuf, String> {
    let candidates = ["app", "resources/app"];

    for candidate in candidates {
        let resolved = app
            .path()
            .resolve(candidate, tauri::path::BaseDirectory::Resource)
            .map_err(|err| err.to_string())?;
        let build_info_path = resolved.join("BUILD-INFO.json");
        let _ = append_line(
            startup_trace_path,
            &format!("checking resource candidate {}", build_info_path.display()),
        );

        if build_info_path.exists() {
            return Ok(resolved);
        }
    }

    Err("Could not locate packaged app resources (BUILD-INFO.json).".to_string())
}

fn read_build_id(build_info_path: &Path) -> Result<String, String> {
    let file = File::open(build_info_path)
        .map_err(|err| format!("Could not read build metadata: {err}"))?;
    let info: BuildInfo = serde_json::from_reader(file)
        .map_err(|err| format!("Could not parse build metadata: {err}"))?;
    Ok(info.build_id)
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn append_log(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(bytes)
}

fn append_line(path: &Path, line: &str) -> io::Result<()> {
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{line}")
}

fn copy_dir_all(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let entry_path = entry.path();
        let target_path = destination.join(entry.file_name());
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            copy_dir_all(&entry_path, &target_path)?;
        } else {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&entry_path, &target_path)?;
        }
    }
    Ok(())
}

fn cleanup_old_directories(
    root: &Path,
    keep_current: Option<&Path>,
    keep_count: usize,
) -> io::Result<()> {
    if !root.exists() {
        return Ok(());
    }

    let mut directories = fs::read_dir(root)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter(|path| keep_current.map(|current| current != path).unwrap_or(true))
        .collect::<Vec<_>>();

    directories.sort_by_key(|path| {
        let modified = fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        Reverse(modified)
    });

    for old_path in directories.into_iter().skip(keep_count) {
        let _ = fs::remove_dir_all(old_path);
    }

    Ok(())
}

fn start_node_process(
    app: &tauri::AppHandle,
    runtime: &LauncherRuntime,
    state: Arc<AppState>,
) -> Result<(), String> {
    let launcher_path = runtime.app_root.join("server").join("launcher.js");
    let launcher_arg = launcher_path
        .to_str()
        .ok_or_else(|| "The packaged launcher path contains invalid UTF-8.".to_string())?;

    let sidecar_command = app
        .shell()
        .sidecar("rewind-node")
        .map_err(|err| err.to_string())?
        .args([launcher_arg])
        .current_dir(&runtime.app_root)
        .env("CCODE_VIEWER_NO_OPEN", "1")
        .env("CCODE_VIEWER_URL_FILE", &runtime.url_file_path);
    let _ = append_line(
        &runtime.startup_trace_path,
        &format!("starting node sidecar with launcher={launcher_arg}"),
    );

    let (mut rx, child) = sidecar_command.spawn().map_err(|err| err.to_string())?;
    state.store_child(child);

    let stdout_log_path = runtime.stdout_log_path.clone();
    let stderr_log_path = runtime.stderr_log_path.clone();
    let state_for_events = state.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let _ = append_log(&stdout_log_path, &bytes);
                }
                CommandEvent::Stderr(bytes) => {
                    let _ = append_log(&stderr_log_path, &bytes);
                }
                CommandEvent::Error(message) => {
                    let _ = append_line(&stderr_log_path, &format!("shell error: {message}"));
                }
                CommandEvent::Terminated(payload) => {
                    if let Some(code) = payload.code {
                        let _ = append_line(
                            &stderr_log_path,
                            &format!("node sidecar exited with code {code}"),
                        );
                    } else {
                        let _ = append_line(&stderr_log_path, "node sidecar terminated");
                    }
                    state_for_events.mark_child_exited();
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn wait_for_url(runtime: &LauncherRuntime, state: Arc<AppState>) -> Result<String, String> {
    let _ = append_line(
        &runtime.startup_trace_path,
        &format!("waiting for url file {}", runtime.url_file_path.display()),
    );
    for _ in 0..URL_WAIT_ATTEMPTS {
        if let Ok(url) = fs::read_to_string(&runtime.url_file_path) {
            let trimmed = url.trim();
            if !trimmed.is_empty() {
                let _ = append_line(
                    &runtime.startup_trace_path,
                    &format!("received viewer url {trimmed}"),
                );
                return Ok(trimmed.to_string());
            }
        }

        if state.child_exited.load(Ordering::SeqCst) {
            return Err(format!(
                "The embedded server exited early. See {}.",
                runtime.stderr_log_path.display()
            ));
        }

        std::thread::sleep(URL_WAIT_DELAY);
    }

    Err(format!(
        "Timed out waiting for the local viewer URL. See {} and {}.",
        runtime.stdout_log_path.display(),
        runtime.stderr_log_path.display()
    ))
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn failure_script(message: &str, logs_dir: &Path) -> String {
    let escaped_message = escape_html(message);
    let escaped_logs_dir = escape_html(&logs_dir.display().to_string());

    format!(
    "document.title = 'Rewind — Startup failed';\
     document.body.innerHTML = `<main class=\"startup\"><div class=\"card error\"><h1>Rewind failed to start</h1><p>{escaped_message}</p><p><strong>Logs:</strong> <code>{escaped_logs_dir}</code></p></div></main>`;"
  )
}

fn bootstrap(window: tauri::WebviewWindow, app: tauri::AppHandle, state: Arc<AppState>) {
    std::thread::spawn(move || {
        let mut runtime_for_error = None;

        let startup_result = (|| -> Result<String, String> {
            if let Ok(install_root) = app.path().app_local_data_dir() {
                let _ = append_line(
                    &install_root.join("startup-trace.log"),
                    "bootstrap thread started",
                );
            }
            let runtime = LauncherRuntime::create(&app)?;
            runtime_for_error = Some(runtime.clone());

            runtime.ensure_payload_extracted()?;
            runtime.cleanup_old_builds()?;
            runtime.cleanup_old_runs()?;
            start_node_process(&app, &runtime, state.clone())?;
            wait_for_url(&runtime, state)
        })();

        match startup_result {
            Ok(url) => match url.parse() {
                Ok(parsed_url) => {
                    let _ = window.navigate(parsed_url);
                }
                Err(err) => {
                    if let Some(runtime) = runtime_for_error {
                        let message = format!("The embedded server returned an invalid URL: {err}");
                        runtime.write_bootstrap_log(&message);
                        let _ = window.eval(&failure_script(&message, &runtime.instance_run_root));
                    }
                }
            },
            Err(message) => {
                if let Some(runtime) = runtime_for_error {
                    runtime.write_bootstrap_log(&message);
                    let _ = window.eval(&failure_script(&message, &runtime.instance_run_root));
                }
            }
        }
    });
}

#[tauri::command]
fn open_in_browser(url: String, app: tauri::AppHandle) -> Result<(), String> {
    app.shell().open(&url, None).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_in_browser])
        .setup(|app| {
            let state = Arc::new(AppState::default());
            app.manage(state.clone());

            let window = app
                .get_webview_window("main")
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "main window not found"))?;

            bootstrap(window, app.handle().clone(), state);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                app.state::<Arc<AppState>>().kill_child();
            }
        });
}
