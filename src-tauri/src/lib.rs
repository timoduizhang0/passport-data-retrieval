mod excel;
mod openai;

use openai::PassportData;
use std::sync::Mutex;
use tauri::State;

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
    output_dir: String,
) -> Result<String, String> {
    let dir = if output_dir.is_empty() {
        let cwd = std::env::current_dir()
            .map_err(|e| format!("获取当前目录失败: {}", e))?;
        std::path::PathBuf::from(cwd).join("护照导出").to_string_lossy().to_string()
    } else {
        output_dir
    };
    let output_path = excel::generate_excel_batch(&data_list, &dir)
        .map_err(|e| format!("导出失败: {}", e))?;
    Ok(output_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            export_count: Mutex::new(0),
        })
        .invoke_handler(tauri::generate_handler![
            recognize_passport,
            recognize_passport_base64,
            export_excel_batch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}