use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::Path;

use flate2::read::GzDecoder;
use neon::prelude::*;
use tar::Archive;

use crate::js_args::{
    is_nullish, optional_usize_property, required_string_arg, type_error_for_value,
};
use zip::ZipArchive;

const DEFAULT_MAX_DEPTH: usize = 2;
const DEFAULT_LEVEL_LIMITS: [usize; 2] = [50, 20];

#[derive(Clone, Debug)]
struct TreeOptions {
    max_depth: usize,
    max_items_per_level: Vec<usize>,
}

#[derive(Clone, Debug, Default)]
struct TreeNode {
    name: String,
    is_dir: bool,
    children: Vec<TreeNode>,
}

#[derive(Clone, Debug, Default)]
struct TreeBuildNode {
    name: String,
    is_dir: bool,
    children: BTreeMap<String, TreeBuildNode>,
}

struct RenderedTree {
    text: String,
    truncated: bool,
}

pub fn print_directory_tree(mut cx: FunctionContext) -> JsResult<JsObject> {
    let path = required_string_arg(&mut cx, 0, "directory")?;
    let options = parse_tree_options(&mut cx, 1)?;
    let root =
        read_directory_tree(Path::new(&path), &options).or_else(|error| cx.throw_error(error))?;
    let rendered = render_tree(&root, &options);

    rendered_tree_to_js(&mut cx, rendered)
}

pub fn print_archive_tree(mut cx: FunctionContext) -> JsResult<JsObject> {
    let path = required_string_arg(&mut cx, 0, "file")?;
    let options = parse_tree_options(&mut cx, 1)?;
    let root = read_archive_tree(Path::new(&path)).or_else(|error| cx.throw_error(error))?;
    let rendered = render_tree(&root, &options);

    rendered_tree_to_js(&mut cx, rendered)
}

pub fn export(cx: &mut ModuleContext) -> NeonResult<()> {
    let print_directory_tree = JsFunction::new(cx, print_directory_tree)?;
    cx.export_value("printDirectoryTree", print_directory_tree)?;

    let print_archive_tree = JsFunction::new(cx, print_archive_tree)?;
    cx.export_value("printArchiveTree", print_archive_tree)?;

    Ok(())
}

fn parse_tree_options(cx: &mut FunctionContext, index: usize) -> NeonResult<TreeOptions> {
    let default_options = TreeOptions::default();
    let Some(value) = cx.argument_opt(index) else {
        return Ok(default_options);
    };

    if is_nullish(cx, value) {
        return Ok(default_options);
    }
    if !value.is_a::<JsObject, _>(cx) {
        return type_error_for_value(cx, "options", "an object", value);
    }

    let object = value.downcast_or_throw::<JsObject, _>(cx)?;
    let max_depth = optional_usize_property(cx, object, "maxDepth")?.unwrap_or(DEFAULT_MAX_DEPTH);
    let max_items_per_level = optional_level_limits_property(cx, object, "maxItemsPerLevel")?
        .unwrap_or_else(|| DEFAULT_LEVEL_LIMITS.to_vec());

    Ok(TreeOptions {
        max_depth,
        max_items_per_level: normalize_level_limits(max_items_per_level),
    })
}

fn optional_level_limits_property(
    cx: &mut FunctionContext,
    object: Handle<JsObject>,
    key: &str,
) -> NeonResult<Option<Vec<usize>>> {
    let value = object.get::<JsValue, _, _>(cx, key)?;
    if is_nullish(cx, value) {
        return Ok(None);
    }

    if value.is_a::<JsNumber, _>(cx) {
        let limit = value
            .downcast_or_throw::<JsNumber, _>(cx)?
            .value(cx)
            .max(0.0) as usize;
        return Ok(Some(vec![limit]));
    }

    if !value.is_a::<JsArray, _>(cx) {
        return type_error_for_value(cx, key, "a number or an array", value);
    }

    let array = value.downcast_or_throw::<JsArray, _>(cx)?;
    let mut limits = Vec::new();
    for index in 0..array.len(cx) {
        let item = array.get::<JsValue, _, _>(cx, index)?;
        if is_nullish(cx, item) {
            continue;
        }
        if !item.is_a::<JsNumber, _>(cx) {
            let item_name = format!("{key}[{index}]");
            return type_error_for_value(cx, &item_name, "a number", item);
        }
        limits.push(
            item.downcast_or_throw::<JsNumber, _>(cx)?
                .value(cx)
                .max(0.0) as usize,
        );
    }

    Ok(Some(limits))
}

fn normalize_level_limits(mut limits: Vec<usize>) -> Vec<usize> {
    limits.retain(|limit| *limit > 0);
    if limits.is_empty() {
        DEFAULT_LEVEL_LIMITS.to_vec()
    } else {
        limits
    }
}

impl Default for TreeOptions {
    fn default() -> Self {
        Self {
            max_depth: DEFAULT_MAX_DEPTH,
            max_items_per_level: DEFAULT_LEVEL_LIMITS.to_vec(),
        }
    }
}

fn read_directory_tree(path: &Path, options: &TreeOptions) -> Result<TreeNode, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_str().unwrap_or("/"));

    read_directory_node(path, name.to_string(), 0, options)
}

fn read_directory_node(
    path: &Path,
    name: String,
    depth: usize,
    options: &TreeOptions,
) -> Result<TreeNode, String> {
    let mut node = TreeNode {
        name,
        is_dir: true,
        children: Vec::new(),
    };

    if depth >= options.max_depth {
        return Ok(node);
    }

    let child_level = depth + 1;
    let read_limit = level_limit(options, child_level).saturating_add(1);
    let entries = fs::read_dir(path).map_err(|error| error.to_string())?;
    let mut children = Vec::new();

    for entry in entries.take(read_limit) {
        let entry = entry.map_err(|error| error.to_string())?;
        let child_name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;

        if file_type.is_dir() {
            let child =
                read_directory_node(&entry.path(), child_name.clone(), child_level, options)
                    .unwrap_or_else(|_| TreeNode {
                        name: child_name,
                        is_dir: true,
                        children: Vec::new(),
                    });
            children.push(child);
        } else {
            children.push(TreeNode {
                name: child_name,
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    sort_children(&mut children);
    node.children = children;
    Ok(node)
}

fn read_archive_tree(path: &Path) -> Result<TreeNode, String> {
    let mut root = TreeBuildNode {
        name: archive_root_name(path),
        is_dir: true,
        children: BTreeMap::new(),
    };

    let extension = archive_extension(path);
    match extension.as_deref() {
        Some("zip") => read_zip_archive(path, &mut root)?,
        Some("tar") => read_tar_archive(path, &mut root)?,
        Some("tar.gz" | "tgz") => read_tar_gz_archive(path, &mut root)?,
        Some("gz") => read_gz_archive(path, &mut root)?,
        _ => return Err("Unsupported archive format".to_string()),
    }

    Ok(root.into_tree_node())
}

fn archive_root_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("archive")
        .to_string()
}

fn archive_extension(path: &Path) -> Option<String> {
    let file_name = path.file_name()?.to_str()?.to_ascii_lowercase();
    if file_name.ends_with(".tar.gz") {
        return Some("tar.gz".to_string());
    }
    if file_name.ends_with(".tgz") {
        return Some("tgz".to_string());
    }
    if file_name.ends_with(".tar") {
        return Some("tar".to_string());
    }
    if file_name.ends_with(".gz") {
        return Some("gz".to_string());
    }
    if file_name.ends_with(".zip") {
        return Some("zip".to_string());
    }
    None
}

fn read_zip_archive(path: &Path, root: &mut TreeBuildNode) -> Result<(), String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;

    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|error| error.to_string())?;
        insert_archive_path(root, file.name(), file.is_dir());
    }

    Ok(())
}

fn read_tar_archive(path: &Path, root: &mut TreeBuildNode) -> Result<(), String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut archive = Archive::new(file);
    read_tar_entries(&mut archive, root)
}

fn read_tar_gz_archive(path: &Path, root: &mut TreeBuildNode) -> Result<(), String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    read_tar_entries(&mut archive, root)
}

fn read_gz_archive(path: &Path, root: &mut TreeBuildNode) -> Result<(), String> {
    validate_gzip_file(path)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("compressed.gz");
    let preview_name = file_name.strip_suffix(".gz").unwrap_or(file_name);
    insert_archive_path(root, preview_name, false);
    Ok(())
}

fn validate_gzip_file(path: &Path) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut magic = [0; 2];
    file.read_exact(&mut magic)
        .map_err(|error| error.to_string())?;
    if magic == [0x1f, 0x8b] {
        Ok(())
    } else {
        Err("Unsupported archive format".to_string())
    }
}

fn read_tar_entries<R: Read>(
    archive: &mut Archive<R>,
    root: &mut TreeBuildNode,
) -> Result<(), String> {
    for entry in archive.entries().map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let is_dir = entry.header().entry_type().is_dir();
        let path = entry.path().map_err(|error| error.to_string())?;
        insert_archive_path(root, &path_to_archive_path(&path), is_dir);
    }

    Ok(())
}

fn path_to_archive_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| component.as_os_str().to_str())
        .filter(|component| !component.is_empty() && *component != ".")
        .collect::<Vec<_>>()
        .join("/")
}

fn insert_archive_path(root: &mut TreeBuildNode, path: &str, is_dir: bool) {
    let parts: Vec<&str> = path
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    if parts.is_empty() {
        return;
    }

    let mut current = root;
    let last_index = parts.len() - 1;
    for (index, part) in parts.iter().enumerate() {
        let is_last = index == last_index;
        let child_is_dir = !is_last || is_dir;
        current = current
            .children
            .entry((*part).to_string())
            .or_insert_with(|| TreeBuildNode {
                name: (*part).to_string(),
                is_dir: child_is_dir,
                children: BTreeMap::new(),
            });
        if child_is_dir {
            current.is_dir = true;
        }
    }
}

impl TreeBuildNode {
    fn into_tree_node(self) -> TreeNode {
        let mut children = self
            .children
            .into_values()
            .map(TreeBuildNode::into_tree_node)
            .collect::<Vec<_>>();
        sort_children(&mut children);

        TreeNode {
            name: self.name,
            is_dir: self.is_dir,
            children,
        }
    }
}

fn sort_children(children: &mut [TreeNode]) {
    children.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
}

fn render_tree(root: &TreeNode, options: &TreeOptions) -> RenderedTree {
    let mut lines = vec![format_node_name(root)];
    let mut truncated = false;
    if options.max_depth > 0 {
        render_children(root, "", 1, options, &mut lines, &mut truncated);
    } else if !root.children.is_empty() {
        truncated = true;
    }

    RenderedTree {
        text: lines.join("\n"),
        truncated,
    }
}

fn render_children(
    node: &TreeNode,
    prefix: &str,
    level: usize,
    options: &TreeOptions,
    lines: &mut Vec<String>,
    truncated: &mut bool,
) {
    if node.children.is_empty() || level > options.max_depth {
        return;
    }

    let limit = level_limit(options, level);
    let visible_count = node.children.len().min(limit);
    let has_more = node.children.len() > visible_count;
    if has_more {
        *truncated = true;
    }

    for (index, child) in node.children.iter().take(visible_count).enumerate() {
        let is_last = !has_more && index + 1 == visible_count;
        let branch = if is_last { "└── " } else { "├── " };
        lines.push(format!("{}{}{}", prefix, branch, format_node_name(child)));

        if child.is_dir && level < options.max_depth {
            let child_prefix = format!("{}{}", prefix, if is_last { "    " } else { "│   " });
            render_children(child, &child_prefix, level + 1, options, lines, truncated);
        }
    }

    if has_more {
        lines.push(format!("{}└── ...", prefix));
    }
}

fn format_node_name(node: &TreeNode) -> String {
    if node.is_dir {
        format!("{}/", node.name)
    } else {
        node.name.clone()
    }
}

fn level_limit(options: &TreeOptions, level: usize) -> usize {
    options
        .max_items_per_level
        .get(level.saturating_sub(1))
        .copied()
        .or_else(|| options.max_items_per_level.last().copied())
        .unwrap_or(DEFAULT_LEVEL_LIMITS[DEFAULT_LEVEL_LIMITS.len() - 1])
}

fn rendered_tree_to_js<'a>(
    cx: &mut FunctionContext<'a>,
    rendered: RenderedTree,
) -> JsResult<'a, JsObject> {
    let object = cx.empty_object();

    let text = cx.string(rendered.text);
    object.set(cx, "text", text)?;

    let truncated = cx.boolean(rendered.truncated);
    object.set(cx, "truncated", truncated)?;

    Ok(object)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(name: &str, is_dir: bool, children: Vec<TreeNode>) -> TreeNode {
        TreeNode {
            name: name.to_string(),
            is_dir,
            children,
        }
    }

    #[test]
    fn render_tree_limits_each_level() {
        let root = node(
            "root",
            true,
            vec![
                node(
                    "src",
                    true,
                    vec![
                        node("a.ts", false, vec![]),
                        node("b.ts", false, vec![]),
                        node("c.ts", false, vec![]),
                    ],
                ),
                node("README.md", false, vec![]),
                node("package.json", false, vec![]),
            ],
        );
        let options = TreeOptions {
            max_depth: 2,
            max_items_per_level: vec![2, 2],
        };

        let rendered = render_tree(&root, &options);

        assert!(rendered.truncated);
        assert_eq!(
            rendered.text,
            "root/\n├── src/\n│   ├── a.ts\n│   ├── b.ts\n│   └── ...\n├── README.md\n└── ..."
        );
    }

    #[test]
    fn archive_extension_detects_supported_formats() {
        assert_eq!(
            archive_extension(Path::new("archive.zip")).as_deref(),
            Some("zip")
        );
        assert_eq!(
            archive_extension(Path::new("source.tar")).as_deref(),
            Some("tar")
        );
        assert_eq!(
            archive_extension(Path::new("source.tar.gz")).as_deref(),
            Some("tar.gz")
        );
        assert_eq!(
            archive_extension(Path::new("source.tgz")).as_deref(),
            Some("tgz")
        );
        assert_eq!(
            archive_extension(Path::new("single.gz")).as_deref(),
            Some("gz")
        );
        assert_eq!(archive_extension(Path::new("archive.rar")), None);
    }

    #[test]
    fn archive_path_insertion_builds_virtual_directories() {
        let mut root = TreeBuildNode {
            name: "archive.zip".to_string(),
            is_dir: true,
            children: BTreeMap::new(),
        };

        insert_archive_path(&mut root, "src/main.ts", false);
        insert_archive_path(&mut root, "src/components/", true);

        let rendered = render_tree(&root.into_tree_node(), &TreeOptions::default());

        assert_eq!(
            rendered.text,
            "archive.zip/\n└── src/\n    ├── components/\n    └── main.ts"
        );
    }
}
