use base64::Engine;
use serde::{Deserialize, Serialize};
use std::error::Error;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PassportData {
    pub name_cn: String,
    pub gender: String,
    pub surname_en: String,
    pub given_en: String,
    pub doc_type: String,
    pub passport_no: String,
    pub client_type: String,
    pub nationality: String,
    pub dob: String,
    pub birth_place: String,
    pub issue_place: String,
    pub issue_date: String,
    pub expiry_date: String,
    pub country_code: String,
    pub phone: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Debug, Deserialize)]
struct Message {
    content: String,
}

pub async fn call_openai_vision(
    api_key: &str,
    api_url: &str,
    model: &str,
    base64_image: &str,
) -> Result<PassportData, Box<dyn Error>> {
    let prompt = r#"你是一个护照信息识别专家。请仔细分析这张护照图片（中国大陆护照），提取以下字段并以JSON格式返回（严格只返回JSON，不要额外文字）：

{
  "name_cn": "中文姓名",
  "gender": "性别（男/女）",
  "surname_en": "英文姓氏（大写）",
  "given_en": "英文名字（大写）",
  "doc_type": "护照",
  "passport_no": "护照号码",
  "client_type": "在职",
  "nationality": "中国大陆",
  "dob": "出生日期（YYYY-MM-DD格式）",
  "birth_place": "出生地（省市）",
  "issue_place": "签发地（省市）",
  "issue_date": "签发日期（YYYY-MM-DD格式）",
  "expiry_date": "有效期至（YYYY-MM-DD格式）",
  "country_code": "国家码（两位字母，如CHN）",
  "phone": ""
}

注意：
- 所有日期统一使用 YYYY-MM-DD 格式
- 英文姓和名使用大写字母
- 如果某个字段在护照上看不清，请留空字符串
- 证件类型固定为"护照"
- 客户类型固定为"在职"
- 国籍固定为"中国大陆"
- 联系电话留空"#;

    let image_data_url = format!("data:image/jpeg;base64,{}", base64_image);

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_data_url,
                            "detail": "high"
                        }
                    }
                ]
            }
        ],
        "max_tokens": 2000,
        "temperature": 0.1
    });

    let url = format!("{}/chat/completions", api_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(false)
        .build()?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API 请求失败 ({}): {}", status, error_text).into());
    }

    let openai_resp: OpenAiResponse = response.json().await?;

    if openai_resp.choices.is_empty() {
        return Err("API 返回空结果".into());
    }

    let content = &openai_resp.choices[0].message.content;

    // Try to extract JSON from the response
    let json_str = extract_json(content)?;
    let data: PassportData = serde_json::from_str(&json_str)?;

    Ok(data)
}

fn extract_json(text: &str) -> Result<String, Box<dyn Error>> {
    // Find the first { and last }
    let start = text.find('{').ok_or("未找到 JSON 起始位置")?;
    let end = text.rfind('}').ok_or("未找到 JSON 结束位置")?;
    Ok(text[start..=end].to_string())
}

/// Read a file and encode as base64
pub fn file_to_base64(path: &str) -> Result<String, Box<dyn Error>> {
    let bytes = std::fs::read(path)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}