use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::net::{TcpListener, TcpStream};
use std::io::{BufReader, BufRead, Write};

/// A simple synchronous HTTP file server.
/// Serves files from `serve_dir` on a random port.
/// Returns the port number, or 0 on failure.
pub fn start_file_server_sync(serve_dir: String) -> u16 {
    // Convert to PathBuf for the directory
    let serve_dir = Arc::new(PathBuf::from(serve_dir));

    // Try to bind to a random port
    let listener = match TcpListener::bind("127.0.0.1:0") {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind TCP listener: {}", e);
            return 0;
        }
    };
    let port = match listener.local_addr() {
        Ok(a) => a.port(),
        Err(_) => return 0,
    };

    // Wrap listener in Arc<Mutex> so the spawned thread can use it
    let listener = Arc::new(Mutex::new(listener));

    eprintln!("Embedded server starting on port {}", port);
    eprintln!("Serving from: {}", serve_dir.display());

    // Spawn a thread that runs the server
    thread::spawn(move || {
        loop {
            // Try to accept a connection
            let stream = {
                let guard = match listener.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                match guard.accept() {
                    Ok((s, _)) => s,
                    Err(_) => break,
                }
            };

            let dir = serve_dir.clone();
            thread::spawn(move || {
                if let Err(e) = handle_connection(stream, &dir) {
                    eprintln!("HTTP server error: {}", e);
                }
            });
        }
    });

    // Give the thread time to start accepting connections
    thread::sleep(std::time::Duration::from_millis(200));

    port
}

fn handle_connection(
    mut stream: TcpStream,
    serve_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;

    // Read remaining headers
    loop {
        let mut header = String::new();
        reader.read_line(&mut header)?;
        if header.trim().is_empty() {
            break;
        }
    }

    // Parse the request path
    let path = request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("/");

    // Map path to file
    let file_path = if path == "/" {
        serve_dir.join("index.html")
    } else {
        let decoded = urlencoding_decode(path);
        let clean_path = decoded.trim_start_matches('/');
        serve_dir.join(clean_path)
    };

    // Security: prevent path traversal
    if let Ok(canonical) = file_path.canonicalize() {
        let serve_canonical = serve_dir.canonicalize()?;
        if !canonical.starts_with(&serve_canonical) {
            let body = "403 Forbidden";
            write!(stream, "HTTP/1.1 403 Forbidden\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body)?;
            return Ok(());
        }
    }

    if file_path.exists() && file_path.is_file() {
        let content = std::fs::read(&file_path)?;
        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let content_type = mime_type(ext);

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
            content_type,
            content.len()
        );

        stream.write_all(response.as_bytes())?;
        stream.write_all(&content)?;
    } else {
        let body = "404 Not Found";
        stream.write_all(format!(
            "HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ).as_bytes())?;
    }

    stream.flush()?;
    Ok(())
}

fn urlencoding_decode(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            }
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }
    result
}

fn mime_type(ext: &str) -> &'static str {
    match ext {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

/// Resolve the dist directory path relative to the executable
pub fn resolve_dist_dir() -> String {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let mut search_paths: Vec<PathBuf> = vec![
                exe_dir.join("../../../dist"),          // from release/
                exe_dir.join("../../dist"),             // from target/
                exe_dir.join("../dist"),                // from src-tauri/
            ];

            if let Some(parent) = exe_dir.parent() {
                search_paths.push(parent.join("dist"));
            }
            if let Ok(cwd) = std::env::current_dir() {
                search_paths.push(cwd.join("dist"));
            }

            for path in search_paths {
                if path.join("index.html").exists() {
                    return path.to_string_lossy().to_string();
                }
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let dist = cwd.join("dist");
        if dist.join("index.html").exists() {
            return dist.to_string_lossy().to_string();
        }
    }

    "D:\\LeStoreDownload\\Reasonix\\global-workspace\\passport-ocr\\dist".to_string()
}