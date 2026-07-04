fn main() {
    // Force release builds to use production mode
    if std::env::var("PROFILE").unwrap_or_default() == "release" {
        std::env::set_var("TAURI_ENV_DEBUG", "false");
    }
    tauri_build::build()
}