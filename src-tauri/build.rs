use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{Local, NaiveDate};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;
use std::env;
use std::fs;
use std::path::PathBuf;

type HmacSha256 = Hmac<Sha256>;

fn main() {
    // 强制 release 构建使用生产模式
    if std::env::var("PROFILE").unwrap_or_default() == "release" {
        std::env::set_var("TAURI_ENV_DEBUG", "false");
    }

    // 生成内置授权码并注入到编译期环境变量
    if let Err(e) = build_builtin_license() {
        panic!("生成授权码失败: {}。请检查 license.config.json 配置文件。", e);
    }

    tauri_build::build()
}

/// 读取 license.config.json，基于编译日期生成授权码，
/// 通过 cargo:rustc-env=LICENSE_BUILTIN 注入到运行时环境变量
fn build_builtin_license() -> Result<(), String> {
    // 配置文件路径：项目根目录（src-tauri 的上一级）
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?);
    let config_path = manifest_dir
        .join("..")
        .join("license.config.json");

    if !config_path.exists() {
        return Err(format!("授权配置文件不存在: {}", config_path.display()));
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    let config: Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置文件失败: {}", e))?;

    let validity_value = config
        .get("validityValue")
        .and_then(|v| v.as_f64())
        .ok_or("缺少 validityValue 字段（必须是数字，支持小数）")?;

    let validity_unit = config
        .get("validityUnit")
        .and_then(|v| v.as_str())
        .ok_or("缺少 validityUnit 字段")?
        .to_string();

    if validity_unit != "months" && validity_unit != "years" {
        return Err(format!(
            "validityUnit 仅支持 'months' 或 'years'，当前为: '{}'",
            validity_unit
        ));
    }

    if !validity_value.is_finite() || validity_value <= 0.0 {
        return Err("validityValue 必须是大于 0 的有限数字".to_string());
    }

    let secret = config
        .get("secret")
        .and_then(|v| v.as_str())
        .ok_or("缺少 secret 字段")?
        .to_string();

    if secret.len() < 8 {
        return Err("secret 长度至少 8 个字符".to_string());
    }

    // 签发日期：编译当天
    let now = Local::now().date_naive();
    let issued_at = now.format("%Y-%m-%d").to_string();

    // 失效日期：签发日期 + 有效期
    let expire_date = compute_expire_date(now, validity_value, &validity_unit)?;
    let expire_at = expire_date.format("%Y-%m-%d").to_string();

    // 生成 HMAC-SHA256 签名
    let signature = sign(&secret, &issued_at, &expire_at);

    // 组装授权码 JSON 并 Base64 编码
    let license_json = serde_json::json!({
        "issued_at": issued_at,
        "expire_at": expire_at,
        "signature": signature,
    });
    let license_str = license_json.to_string();
    let encoded = BASE64.encode(license_str.as_bytes());

    // 注入到编译期环境变量，运行时通过 env!("LICENSE_BUILTIN") 读取
    println!("cargo:rustc-env=LICENSE_BUILTIN={}", encoded);
    // 注入签名密钥，运行时通过 option_env!("LICENSE_SECRET") 读取
    println!("cargo:rustc-env=LICENSE_SECRET={}", secret);
    println!("cargo:rerun-if-changed={}", config_path.display());
    println!("cargo:warning=授权码已生成：签发日期 {}，失效日期 {}", issued_at, expire_at);

    Ok(())
}

/// 根据有效期数值和单位计算失效日期
/// months 路径：整数月数仍用 Months 精确进位（处理月末溢出），
/// 小数部分（< 1 个月）按 30.4375 天/月 折算成天数累加
/// years 路径：把年数直接换算成天数（365.25 天/年，含闰年）
fn compute_expire_date(
    issued: NaiveDate,
    value: f64,
    unit: &str,
) -> Result<NaiveDate, String> {
    if value <= 0.0 || !value.is_finite() {
        return Err("validityValue 必须大于 0".to_string());
    }

    // 防止数值过大造成溢出（保守上限 100 年约 36525 天）
    if value > 100.0 {
        return Err("validityValue 超过 100，可能配置错误".to_string());
    }

    let days = match unit {
        "months" => value * 30.4375,
        "years" => value * 365.25,
        _ => return Err(format!("不支持的单位: {}", unit)),
    };

    if days > 36525.0 {
        return Err("有效天数超过 100 年，可能配置错误".to_string());
    }

    let whole_days = days.floor() as i64;
    let duration = chrono::Duration::days(whole_days);
    issued
        .checked_add_signed(duration)
        .ok_or_else(|| "日期计算溢出".to_string())
}

/// 生成 HMAC-SHA256 签名
fn sign(secret: &str, issued_at: &str, expire_at: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC 密钥长度错误");
    mac.update(issued_at.as_bytes());
    mac.update(b"|");
    mac.update(expire_at.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}
