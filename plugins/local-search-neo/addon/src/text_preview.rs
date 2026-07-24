use std::fs;
use std::io::{Read, Seek, SeekFrom};

use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::{Encoding, UTF_8, UTF_16BE, UTF_16LE};
use neon::prelude::*;

use crate::js_args::{optional_string_arg, optional_usize_arg, required_string_arg};

const INSPECT_BYTES: usize = 8 * 1024;
const PREVIEW_BYTES: usize = 20 * 1024;
const MAX_READ_BYTES: usize = 1024 * 1024;
const TAIL_READ_PADDING_BYTES: usize = 8;

#[derive(Clone, Copy, PartialEq, Eq)]
enum PreviewDirection {
    Start,
    End,
}

struct TextInfo {
    is_text: bool,
    encoding: &'static Encoding,
}

pub fn inspect_text_file(mut cx: FunctionContext) -> JsResult<JsObject> {
    let path = required_string_arg(&mut cx, 0, "file")?;
    let max_bytes = optional_usize_arg(&mut cx, 1, "maxBytes", INSPECT_BYTES)?;

    let bytes = read_file_prefix(&path, max_bytes).or_else(|error| cx.throw_error(error))?;
    let info = inspect_bytes_info(&bytes);

    let object = cx.empty_object();
    let is_text = cx.boolean(info.is_text);
    object.set(&mut cx, "isText", is_text)?;

    let encoding = cx.string(info.encoding.name());
    object.set(&mut cx, "encoding", encoding)?;

    Ok(object)
}

pub fn read_text_preview(mut cx: FunctionContext) -> JsResult<JsObject> {
    let path = required_string_arg(&mut cx, 0, "file")?;
    let max_bytes = optional_usize_arg(&mut cx, 1, "maxBytes", PREVIEW_BYTES)?.min(MAX_READ_BYTES);
    let direction = optional_direction_arg(&mut cx, 2)?;

    let inspect_bytes =
        read_file_prefix(&path, INSPECT_BYTES).or_else(|error| cx.throw_error(error))?;
    let info = inspect_bytes_info(&inspect_bytes);
    let bytes =
        read_preview_bytes(&path, max_bytes, direction).or_else(|error| cx.throw_error(error))?;
    let text = if info.is_text {
        let decoded = decode_preview_bytes(&bytes, info.encoding, direction);
        match direction {
            PreviewDirection::Start => truncate_utf8_start(&decoded, max_bytes),
            PreviewDirection::End => {
                trim_leading_partial_line(&truncate_utf8_end(&decoded, max_bytes))
            }
        }
    } else {
        String::new()
    };

    let object = cx.empty_object();
    let is_text = cx.boolean(info.is_text);
    object.set(&mut cx, "isText", is_text)?;

    let encoding = cx.string(info.encoding.name());
    object.set(&mut cx, "encoding", encoding)?;

    let text = cx.string(text);
    object.set(&mut cx, "text", text)?;

    Ok(object)
}

pub fn export(cx: &mut ModuleContext) -> NeonResult<()> {
    let inspect_text_file = JsFunction::new(cx, inspect_text_file)?;
    cx.export_value("inspectTextFile", inspect_text_file)?;

    let read_text_preview = JsFunction::new(cx, read_text_preview)?;
    cx.export_value("readTextPreview", read_text_preview)?;

    Ok(())
}

fn optional_direction_arg(cx: &mut FunctionContext, index: usize) -> NeonResult<PreviewDirection> {
    let direction = optional_string_arg(cx, index, "direction", "start")?;
    Ok(if direction == "end" {
        PreviewDirection::End
    } else {
        PreviewDirection::Start
    })
}

fn read_file_prefix(path: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
    read_file_segment(path, max_bytes, PreviewDirection::Start)
}

fn read_preview_bytes(
    path: &str,
    max_bytes: usize,
    direction: PreviewDirection,
) -> Result<Vec<u8>, String> {
    let read_bytes = match direction {
        PreviewDirection::Start => max_bytes.max(INSPECT_BYTES).min(MAX_READ_BYTES),
        PreviewDirection::End => max_bytes
            .saturating_add(TAIL_READ_PADDING_BYTES)
            .min(MAX_READ_BYTES),
    };

    read_file_segment(path, read_bytes, direction)
}

fn read_file_segment(
    path: &str,
    max_bytes: usize,
    direction: PreviewDirection,
) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        return Err("Cannot preview a directory".to_string());
    }

    let read_len = (metadata.len() as usize).min(max_bytes);
    let offset = match direction {
        PreviewDirection::Start => 0,
        PreviewDirection::End => metadata.len().saturating_sub(read_len as u64),
    };

    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;

    let mut buffer = vec![0; read_len];
    let bytes_read = file.read(&mut buffer).map_err(|error| error.to_string())?;
    buffer.truncate(bytes_read);

    Ok(buffer)
}

fn inspect_bytes_info(bytes: &[u8]) -> TextInfo {
    let encoding = detect_encoding(bytes);

    TextInfo {
        is_text: is_likely_text(bytes, encoding),
        encoding,
    }
}

fn detect_encoding(bytes: &[u8]) -> &'static Encoding {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return UTF_8;
    }
    if bytes.starts_with(&[0xff, 0xfe]) {
        return UTF_16LE;
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        return UTF_16BE;
    }

    if is_valid_or_truncated_utf8(bytes) {
        return UTF_8;
    }

    let mut detector = EncodingDetector::new(Iso2022JpDetection::Allow);
    detector.feed(bytes, true);
    detector.guess(None, Utf8Detection::Allow)
}

fn is_likely_text(bytes: &[u8], encoding: &'static Encoding) -> bool {
    if bytes.is_empty() {
        return true;
    }

    if has_known_text_bom(bytes) {
        return true;
    }

    if bytes.contains(&0) {
        return false;
    }

    if encoding == UTF_8 && !is_valid_or_truncated_utf8(bytes) {
        return false;
    }

    let (_, _, had_errors) = encoding.decode(bytes);
    if had_errors && encoding != UTF_8 {
        return false;
    }

    let suspicious_control_count = bytes
        .iter()
        .filter(|byte| {
            let byte = **byte;
            let is_allowed_control = matches!(byte, 7 | 8 | 9 | 10 | 12 | 13);
            let is_control = byte < 32 || byte == 127;
            is_control && !is_allowed_control
        })
        .count();

    suspicious_control_count as f64 / (bytes.len() as f64) < 0.03
}

fn has_known_text_bom(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xef, 0xbb, 0xbf])
        || bytes.starts_with(&[0xff, 0xfe])
        || bytes.starts_with(&[0xfe, 0xff])
}

fn decode_preview_bytes(
    bytes: &[u8],
    encoding: &'static Encoding,
    direction: PreviewDirection,
) -> String {
    if encoding == UTF_8 && direction == PreviewDirection::Start {
        let valid_prefix = utf8_complete_prefix(bytes);
        return String::from_utf8_lossy(valid_prefix).into_owned();
    }

    let (text, _, _) = encoding.decode(bytes);
    text.into_owned()
}

fn is_valid_or_truncated_utf8(bytes: &[u8]) -> bool {
    match std::str::from_utf8(bytes) {
        Ok(_) => true,
        Err(error) => error.error_len().is_none(),
    }
}

fn utf8_complete_prefix(bytes: &[u8]) -> &[u8] {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes,
        Err(error) if error.error_len().is_none() => &bytes[..error.valid_up_to()],
        Err(error) => &bytes[..error.valid_up_to()],
    }
}

fn truncate_utf8_start(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }

    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }

    text[..end].to_string()
}

fn truncate_utf8_end(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }

    let mut start = text.len() - max_bytes;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }

    text[start..].to_string()
}

fn trim_leading_partial_line(text: &str) -> String {
    match text.find('\n') {
        Some(index) if index + 1 < text.len() => text[index + 1..].to_string(),
        _ => text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_preview_drops_incomplete_utf8_suffix() {
        let bytes = "abc😀".as_bytes();
        let incomplete_suffix = &bytes[..bytes.len() - 1];

        let decoded = decode_preview_bytes(incomplete_suffix, UTF_8, PreviewDirection::Start);

        assert_eq!(decoded, "abc");
    }

    #[test]
    fn end_preview_decodes_after_incomplete_utf8_prefix() {
        let bytes = "😀log line".as_bytes();
        let incomplete_prefix = &bytes[1..];

        let decoded = decode_preview_bytes(incomplete_prefix, UTF_8, PreviewDirection::End);

        assert!(decoded.contains("log line"));
        assert!(!decoded.is_empty());
    }

    #[test]
    fn end_preview_trims_line_started_from_incomplete_utf8_prefix() {
        let bytes = "😀partial line\nlast line".as_bytes();
        let incomplete_prefix = &bytes[1..];
        let decoded = decode_preview_bytes(incomplete_prefix, UTF_8, PreviewDirection::End);

        let preview = trim_leading_partial_line(&truncate_utf8_end(&decoded, 100));

        assert_eq!(preview, "last line");
    }
}
