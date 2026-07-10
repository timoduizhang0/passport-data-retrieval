use reqwest::Client;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::AsyncWriteExt;

/// 下载安装包到用户 Downloads 目录
/// 通过 `app_handle.emit_str("update:progress", json)` 向所有窗口发送进度事件
#[tauri::command]
pub async fn download_update(
    app_handle: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败: {}", e))?;

    // 先 HEAD 获取文件大小
    let resp = client
        .head(&url)
        .send()
        .await
        .map_err(|e| format!("获取文件信息失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("远程文件返回错误状态: {}", resp.status()));
    }

    let total_bytes = resp
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok().and_then(|s| s.parse::<u64>().ok()))
        .unwrap_or(0);

    if total_bytes == 0 {
        return Err("无法获取文件大小，请检查下载链接".into());
    }

    // 下载到用户 Downloads 目录
    let download_dir = dirs::download_dir().unwrap_or_else(|| PathBuf::from("./Downloads"));
    let dest_path = download_dir.join(&filename);

    let mut resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;

    let mut downloaded = 0u64;
    let mut file = tokio::fs::File::create(&dest_path)
        .await
        .map_err(|e| format!("无法创建下载文件: {}", e))?;

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("下载中断: {}", e))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入失败: {}", e))?;
        downloaded += chunk.len() as u64;

        let progress = (downloaded as f64 / total_bytes as f64 * 100.0).round() as u32;
        // 发送进度事件给前端（JSON 字符串）
        let payload = serde_json::json!({
            "progress": progress,
            "downloaded": downloaded,
            "total": total_bytes,
        })
        .to_string();
        let _ = app_handle.emit_str("update:progress", payload);
    }

    file.flush().await.map_err(|e| format!("刷新失败: {}", e))?;

    Ok(dest_path.to_string_lossy().to_string())
}
