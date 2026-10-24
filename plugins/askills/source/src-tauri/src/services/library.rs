use crate::domain::{AppError, ImportPreview, Result};
use crate::platform::fs::{assert_safe_path, check_cancel, inspect_tree, read_text};
use pulldown_cmark::{Event, Options, Parser, Tag};
use serde_yaml_ng::{Mapping, Value};
use std::path::{Component, Path};
use std::sync::atomic::AtomicBool;

fn text_field(mapping: &Mapping, key: &str, required: bool) -> Result<Option<String>> {
    match mapping.get(Value::String(key.to_string())) {
        Some(Value::String(value)) if !value.trim().is_empty() => {
            Ok(Some(value.trim().to_string()))
        }
        None if !required => Ok(None),
        _ => Err(AppError::new(
            "InvalidSkill",
            format!("frontmatter 的 {key} 必须是非空字符串"),
        )),
    }
}

pub fn parse_frontmatter(markdown: &str) -> Result<(String, String, Option<String>)> {
    let text = markdown.trim_start_matches('\u{feff}');
    let mut lines = text.lines();
    if lines.next() != Some("---") {
        return Err(AppError::new(
            "InvalidSkill",
            "SKILL.md 必须以 YAML frontmatter（---）开头",
        ));
    }
    let mut yaml = String::new();
    let mut closed = false;
    for line in lines {
        if line == "---" {
            closed = true;
            break;
        }
        yaml.push_str(line);
        yaml.push('\n');
        if yaml.len() > 64 * 1024 {
            return Err(AppError::new("LimitExceeded", "frontmatter 超过 64 KiB"));
        }
    }
    if !closed {
        return Err(AppError::new(
            "InvalidSkill",
            "frontmatter 缺少结束分隔符 ---",
        ));
    }
    let parsed: Value = serde_yaml_ng::from_str(&yaml)
        .map_err(|error| AppError::new("InvalidSkill", format!("YAML 解析失败：{error}")))?;
    let mapping = parsed
        .as_mapping()
        .ok_or_else(|| AppError::new("InvalidSkill", "frontmatter 必须为键值对象"))?;
    let name = text_field(mapping, "name", true)?.unwrap_or_default();
    let description = text_field(mapping, "description", true)?.unwrap_or_default();
    if name.chars().count() > 64
        || name.starts_with('-')
        || name.ends_with('-')
        || name.contains("--")
        || !name
            .chars()
            .all(|c| c == '-' || (c.is_alphanumeric() && !c.is_uppercase()))
    {
        return Err(AppError::new(
            "InvalidSkill",
            "name 必须为 1–64 个小写字母、数字或连字符，且不能以连字符开头/结尾或包含连续连字符",
        ));
    }
    if description.chars().count() > 1024 {
        return Err(AppError::new(
            "InvalidSkill",
            "description 不能超过 1,024 个字符",
        ));
    }
    if let Some(compatibility) = text_field(mapping, "compatibility", false)?
        && compatibility.chars().count() > 500
    {
        return Err(AppError::new(
            "InvalidSkill",
            "compatibility 不能超过 500 个字符",
        ));
    }
    if let Some(metadata) = mapping.get(Value::String("metadata".into()))
        && !metadata.as_mapping().is_some_and(|items| {
            items
                .iter()
                .all(|(key, value)| key.is_string() && value.is_string())
        })
    {
        return Err(AppError::new(
            "InvalidSkill",
            "metadata 必须是字符串到字符串的映射",
        ));
    }
    Ok((name, description, text_field(mapping, "license", false)?))
}

fn decode_path(text: &str) -> Result<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let value = bytes
                .get(index + 1..index + 3)
                .and_then(|pair| std::str::from_utf8(pair).ok())
                .and_then(|pair| u8::from_str_radix(pair, 16).ok())
                .ok_or_else(|| {
                    AppError::new("InvalidReference", "Markdown 链接包含无效百分号编码")
                })?;
            decoded.push(value);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded)
        .map_err(|_| AppError::new("InvalidReference", "链接路径不是有效 UTF-8"))
}

fn validate_references(
    root: &Path,
    document: &Path,
    markdown: &str,
    warnings: &mut Vec<String>,
    cancel: &AtomicBool,
) -> Result<()> {
    for event in Parser::new_ext(markdown, Options::empty()) {
        check_cancel(cancel)?;
        let destination = match event {
            Event::Start(Tag::Link { dest_url, .. })
            | Event::Start(Tag::Image { dest_url, .. }) => dest_url,
            Event::Html(_) | Event::InlineHtml(_) => {
                if warnings.len() < 100
                    && !warnings
                        .iter()
                        .any(|warning| warning.starts_with("文档包含 HTML"))
                {
                    warnings
                        .push("文档包含 HTML；阅读器会清洗内容，HTML 内资源引用不自动加载".into());
                }
                continue;
            }
            _ => continue,
        };
        let target = destination.trim();
        if target.is_empty() || target.starts_with('#') {
            continue;
        }
        if target.starts_with("https://")
            || target.starts_with("http://")
            || target.starts_with("mailto:")
        {
            continue;
        }
        if target.contains("://")
            || target.starts_with("data:")
            || target.starts_with("javascript:")
            || target.starts_with("file:")
        {
            return Err(AppError::new(
                "InvalidReference",
                format!("不支持的 Markdown 链接协议：{target}"),
            ));
        }
        let encoded_path = target.split(['#', '?']).next().unwrap_or(target);
        let decoded = decode_path(encoded_path)?.replace('\\', "/");
        if decoded.contains('\0') || decoded.contains(':') || decoded.starts_with('/') {
            return Err(AppError::new(
                "InvalidReference",
                format!("本地引用必须位于 skill 内：{target}"),
            ));
        }
        let mut relative = document.parent().unwrap_or(Path::new("")).to_path_buf();
        for component in Path::new(&decoded).components() {
            match component {
                Component::Normal(value) => relative.push(value),
                Component::CurDir => {}
                Component::ParentDir => {
                    if !relative.pop() {
                        return Err(AppError::new(
                            "ReferenceEscape",
                            format!("Markdown 引用越出 skill：{target}"),
                        ));
                    }
                }
                _ => {
                    return Err(AppError::new(
                        "ReferenceEscape",
                        format!("不安全的 Markdown 引用：{target}"),
                    ));
                }
            }
        }
        let actual = root.join(&relative);
        assert_safe_path(&actual)?;
        if !actual.exists() {
            return Err(AppError::new(
                "MissingReference",
                format!(
                    "{} 引用了不存在的本地文件：{}",
                    document.display(),
                    relative.display()
                ),
            ));
        }
    }
    Ok(())
}

pub fn inspect_skill(path: &Path, cancel: &AtomicBool) -> Result<ImportPreview> {
    check_cancel(cancel)?;
    let tree = inspect_tree(path, cancel)?;
    if !tree.files.iter().any(|file| file == Path::new("SKILL.md")) {
        return Err(AppError::new(
            "InvalidSkill",
            "所选目录根部缺少 SKILL.md（区分大小写）",
        ));
    }
    let markdown = read_text(&path.join("SKILL.md"))?;
    let (name, description, declared_license) = parse_frontmatter(&markdown)?;
    let mut warnings = Vec::new();
    if path.file_name().and_then(|name| name.to_str()) != Some(name.as_str()) {
        warnings.push(format!(
            "来源目录名与 name 不同；项目安装目录将使用 {name}，原文件保持不变"
        ));
    }
    let license_file = tree.files.iter().find(|file| {
        file.components().count() == 1
            && file
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| {
                    matches!(
                        value.to_ascii_uppercase().as_str(),
                        "LICENSE" | "LICENSE.MD" | "LICENSE.TXT" | "COPYING"
                    )
                })
    });
    let license = declared_license
        .or_else(|| license_file.map(|file| format!("见 {}（未自动判定协议）", file.display())));
    if license.is_none() {
        warnings.push("未发现许可证声明；请核对上游授权后再分发".into());
    }
    for file in &tree.files {
        check_cancel(cancel)?;
        if file
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            let text = if file == Path::new("SKILL.md") {
                markdown.clone()
            } else {
                read_text(&path.join(file))?
            };
            validate_references(path, file, &text, &mut warnings, cancel)?;
        }
    }
    if tree.files.iter().any(|file| file.starts_with("scripts")) {
        warnings.push("包含 scripts；Askills 不执行脚本，安装后 Agent 可能按指令调用它们".into());
    }
    Ok(ImportPreview {
        name,
        description,
        license,
        hash: tree.hash,
        file_count: tree.file_count,
        total_bytes: tree.total_bytes,
        markdown,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture(root: &Path, body: &str) -> PathBuf {
        let skill = root.join("sample");
        fs::create_dir(&skill).unwrap();
        fs::write(
            skill.join("SKILL.md"),
            format!("---\nname: sample\ndescription: 用于测试\n---\n{body}"),
        )
        .unwrap();
        skill
    }

    #[test]
    fn yaml_and_unicode_are_validated_without_rewriting() {
        let temp = tempfile::tempdir().unwrap();
        let path = fixture(temp.path(), "# 内容\n");
        let before = fs::read(path.join("SKILL.md")).unwrap();
        let result = inspect_skill(&path, &AtomicBool::new(false)).unwrap();
        assert_eq!(result.name, "sample");
        assert_eq!(fs::read(path.join("SKILL.md")).unwrap(), before);
        assert!(parse_frontmatter("---\nname: Upper\ndescription: ok\n---").is_err());
        assert!(parse_frontmatter("---\nname: sample\ndescription: 123\n---").is_err());
    }

    #[test]
    fn missing_and_escaping_references_fail() {
        let temp = tempfile::tempdir().unwrap();
        let path = fixture(temp.path(), "[missing](references/missing.md)");
        assert_eq!(
            inspect_skill(&path, &AtomicBool::new(false))
                .unwrap_err()
                .code,
            "MissingReference"
        );
        fs::write(
            path.join("SKILL.md"),
            "---\nname: sample\ndescription: ok\n---\n[outside](%2e%2e/secret.txt)",
        )
        .unwrap();
        assert_eq!(
            inspect_skill(&path, &AtomicBool::new(false))
                .unwrap_err()
                .code,
            "ReferenceEscape"
        );
    }

    #[test]
    fn code_blocks_are_not_treated_as_local_file_links() {
        let temp = tempfile::tempdir().unwrap();
        let path = fixture(
            temp.path(),
            "```markdown\n[example](missing.md)\n```\n[site](https://example.com)",
        );
        inspect_skill(&path, &AtomicBool::new(false)).unwrap();
    }
}
