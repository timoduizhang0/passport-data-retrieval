mod excel;
mod openai;
mod server;

use openai::PassportData;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

struct AppState {
    export_count: Mutex<u32>,
}

#[tauri::command]
async fn recognize_passport(
    image_path: String,
    api_key: String,
    api_url: String,
    model: String,
    state: State<'_, AppState>,
) -> Result<PassportData, String> {
    let base64 = openai::file_to_base64(&image_path).map_err(|e| format!("读取图片失败: {}", e))?;
    let data = openai::call_openai_vision(&api_key, &api_url, &model, &base64)
        .await
        .map_err(|e| format!("识别失败: {}", e))?;
    let mut count = state.export_count.lock().map_err(|e| e.to_string())?;
    *count += 1;
    Ok(data)
}

#[tauri::command]
async fn recognize_passport_base64(
    image_base64: String,
    api_key: String,
    api_url: String,
    model: String,
) -> Result<PassportData, String> {
    let data = openai::call_openai_vision(&api_key, &api_url, &model, &image_base64)
        .await
        .map_err(|e| format!("识别失败: {}", e))?;
    Ok(data)
}

#[tauri::command]
async fn export_excel_batch(
    data_list: Vec<PassportData>,
) -> Result<String, String> {
    let cwd = std::env::current_dir()
        .map_err(|e| format!("获取当前目录失败: {}", e))?;
    let output_dir = PathBuf::from(cwd).join("护照导出");
    let output_path = excel::generate_excel_batch(&data_list, &output_dir.to_string_lossy())
        .map_err(|e| format!("导出失败: {}", e))?;
    Ok(output_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Start embedded HTTP server
    let server_port = Arc::new(AtomicU16::new(0));
    let sp = server_port.clone();
    let dist_dir = server::resolve_dist_dir();
    let port = server::start_file_server_sync(dist_dir);
    sp.store(port, Ordering::SeqCst);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            export_count: Mutex::new(0),
        })
        .setup(move |app| {
            let port = server_port.load(Ordering::SeqCst);
            if port > 0 {
                let url = format!("http://127.0.0.1:{}/index.html", port);
                eprintln!("Navigating to: {}", url);
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(url) = url.parse::<url::Url>() {
                        let _ = window.navigate(url);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            recognize_passport,
            recognize_passport_base64,
            export_excel_batch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}