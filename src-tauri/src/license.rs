use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{Local, NaiveDate};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// 编译期由 build.rs 注入的内置授权码（Base64 编码的 JSON）
const BUILTIN_LICENSE: &str = env!("LICENSE_BUILTIN");

/// 授权码内部结构（Base64 解码后的 JSON）
#[derive(Debug, Deserialize, Serialize)]
struct LicenseInner {
    issued_at: String,
    expire_at: String,
    signature: String,
}

/// 对外暴露的授权状态信息
#[derive(Debug, Serialize, Clone)]
pub struct LicenseInfo {
    /// 授权是否有效
    pub valid: bool,
    /// 签发日期（YYYY-MM-DD）
    pub issued_at: String,
    /// 失效日期（YYYY-MM-DD）
    pub expire_at: String,
    /// 剩余有效天数（负数表示已过期）
    pub remaining_days: i64,
    /// 状态描述：ok / expired / invalid / damaged
    pub status: String,
    /// 友好提示信息
    pub message: String,
}

/// 获取内置授权码的校验结果
pub fn get_license_info() -> LicenseInfo {
    match parse_and_verify(BUILTIN_LICENSE) {
        Ok(inner) => {
            // 提前 clone 出需要的字段，避免后续 move 借用问题
            let issued_at = inner.issued_at.clone();
            let expire_at = inner.expire_at.clone();
            let today = Local::now().date_naive();
            let remaining = compute_remaining_days(&today, &inner.expire_at);

            // 先构建 message，避免 expire_at 在 LicenseInfo 中被 move 后再借用
            let (valid, status, message) = if remaining < 0 {
                (
                    false,
                    "expired",
                    format!(
                        "授权已过期：到期日 {}，已过期 {} 天，请联系开发者续期",
                        expire_at,
                        -remaining
                    ),
                )
            } else if remaining <= 7 {
                (
                    true,
                    "ok",
                    format!(
                        "授权即将到期：剩余 {} 天（到期日 {}），请及时续期",
                        remaining, expire_at
                    ),
                )
            } else {
                (
                    true,
                    "ok",
                    format!("授权有效：剩余 {} 天（到期日 {}）", remaining, expire_at),
                )
            };

            LicenseInfo {
                valid,
                issued_at,
                expire_at,
                remaining_days: remaining,
                status: status.to_string(),
                message,
            }
        }
        Err(msg) => LicenseInfo {
            valid: false,
            issued_at: String::new(),
            expire_at: String::new(),
            remaining_days: -1,
            status: "damaged".to_string(),
            message: format!("授权码无效：{}", msg),
        },
    }
}

/// 解析并验证授权码：Base64 解码 → JSON 解析 → 签名校验
fn parse_and_verify(encoded: &str) -> Result<LicenseInner, String> {
    let bytes = BASE64
        .decode(encoded.as_bytes())
        .map_err(|e| format!("Base64 解码失败: {}", e))?;
    let json_str = String::from_utf8(bytes).map_err(|e| format!("UTF-8 解码失败: {}", e))?;
    let inner: LicenseInner =
        serde_json::from_str(&json_str).map_err(|e| format!("JSON 解析失败: {}", e))?;

    // 签名密钥需要从配置文件中读取（运行时无法直接拿到 build.rs 的 secret）
    // 因此将签名密钥也内置到二进制中（编译期常量）
    // 注意：此处密钥与 license.config.json 中的 secret 必须保持一致
    let secret = builtin_secret();
    let expected = sign(&secret, &inner.issued_at, &inner.expire_at);
    if !signatures_equal(&expected, &inner.signature) {
        return Err("签名校验失败，授权码可能被篡改".to_string());
    }

    // 校验日期格式合法性
    NaiveDate::parse_from_str(&inner.issued_at, "%Y-%m-%d")
        .map_err(|e| format!("签发日期格式错误: {}", e))?;
    NaiveDate::parse_from_str(&inner.expire_at, "%Y-%m-%d")
        .map_err(|e| format!("失效日期格式错误: {}", e))?;

    Ok(inner)
}

/// 内置签名密钥（必须与 license.config.json 中的 secret 完全一致）
/// 修改时需同步修改配置文件，否则签名校验会失败
fn builtin_secret() -> String {
    // 通过 build.rs 额外注入的环境变量获取
    // 若未注入则回退到默认值（仅用于开发兜底，正式构建必定有值）
    option_env!("LICENSE_SECRET")
        .unwrap_or("passport-ocr-license-secret-2026-please-change-me")
        .to_string()
}

/// 计算从今天到失效日期的剩余天数
/// 失效日期当天仍视为有效（remaining_days = 0），次日才过期（remaining_days = -1）
fn compute_remaining_days(today: &NaiveDate, expire_at: &str) -> i64 {
    let expire = match NaiveDate::parse_from_str(expire_at, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return -1,
    };
    expire.signed_duration_since(*today).num_days()
}

/// 生成 HMAC-SHA256 签名（与 build.rs 中的算法保持一致）
fn sign(secret: &str, issued_at: &str, expire_at: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC 密钥长度错误");
    mac.update(issued_at.as_bytes());
    mac.update(b"|");
    mac.update(expire_at.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// 常量时间比较签名，避免时序攻击
fn signatures_equal(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}
