use rust_xlsxwriter::*;
use std::path::Path;
use crate::openai::PassportData;

/// Generate Excel file from multiple passport data entries
pub fn generate_excel_batch(
    data_list: &[PassportData],
    output_dir: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    if data_list.is_empty() {
        return Err("没有数据可导出".into());
    }

    // Ensure output directory exists
    std::fs::create_dir_all(output_dir)?;

    // Generate output filename with timestamp
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let first_name = data_list.first().map(|d| d.name_cn.as_str()).unwrap_or("");
    let output_file = if data_list.len() == 1 && !first_name.is_empty() {
        format!("{}/{}_{}.xlsx", output_dir, first_name, timestamp)
    } else {
        format!("{}/护照信息_共{}条_{}.xlsx", output_dir, data_list.len(), timestamp)
    };
    let output_path = Path::new(&output_file);

    let mut workbook = Workbook::new();

    // ---- Sheet1: Main data ----
    let sheet1 = workbook.add_worksheet();
    sheet1.set_name("sheet1")?;

    // Define formats
    let header_format = Format::new()
        .set_bold()
        .set_border(FormatBorder::Thin)
        .set_background_color(Color::RGB(0xD9E1F2))
        .set_font_size(11);

    let cell_format = Format::new()
        .set_border(FormatBorder::Thin)
        .set_font_size(11);

    // Headers matching the template
    let headers = [
        "中文姓名", "性别", "英文姓", "英文名", "证件类型", "证件号",
        "客户类型", "国籍", "出生日期", "出生地", "签发地", "签发日期",
        "有效期", "国家码", "联系电话",
    ];

    // Write header row (row 0)
    for (col, header) in headers.iter().enumerate() {
        sheet1.write_string_with_format(0, col as u16, *header, &header_format)?;
    }

    // Set column widths
    let col_widths = [12.0, 6.0, 12.0, 14.0, 10.0, 16.0, 10.0, 10.0, 14.0, 12.0, 12.0, 14.0, 14.0, 10.0, 16.0];
    for (col, width) in col_widths.iter().enumerate() {
        sheet1.set_column_width(col as u16, *width)?;
    }

    // Write data rows (starting from row 1)
    for (row_idx, data) in data_list.iter().enumerate() {
        let row = (row_idx + 1) as u32;
        let values = [
            &data.name_cn, &data.gender, &data.surname_en, &data.given_en,
            &data.doc_type, &data.passport_no, &data.client_type, &data.nationality,
            &data.dob, &data.birth_place, &data.issue_place, &data.issue_date,
            &data.expiry_date, &data.country_code, &data.phone,
        ];

        for (col, value) in values.iter().enumerate() {
            sheet1.write_string_with_format(row, col as u16, value.as_str(), &cell_format)?;
        }
    }

    // If no data was provided for a field, leave it empty (already handled above)

    // ---- Hidden1: 证件类型 dropdown ----
    let hidden1 = workbook.add_worksheet();
    hidden1.set_name("hidden1")?;
    // Hide the sheet
    hidden1.set_hidden(true);

    let doc_types = [
        "身份证", "护照", "学生证", "军人证", "驾驶证", "回乡证",
        "台胞证", "港澳通行证", "国际海员证", "外国人永久居留证",
        "台湾通行证", "士兵证", "临时身份证", "户口簿", "警官证",
        "出生证明", "港澳台居民居住证", "其他",
    ];
    for (row, dt) in doc_types.iter().enumerate() {
        hidden1.write_string(row as u32, 0, *dt)?;
    }

    // ---- Hidden2: 客户类型 dropdown ----
    let hidden2 = workbook.add_worksheet();
    hidden2.set_name("hidden2")?;
    hidden2.set_hidden(true);

    let client_types = [
        "无", "自理签证", "在职", "自由职业", "在校学生", "退休",
        "学龄前儿童", "18周岁以下", "18周岁（含）至20周岁", "20周岁（含）及以上",
    ];
    for (row, ct) in client_types.iter().enumerate() {
        hidden2.write_string(row as u32, 0, *ct)?;
    }

    workbook.save(output_path)?;

    Ok(output_file)
}