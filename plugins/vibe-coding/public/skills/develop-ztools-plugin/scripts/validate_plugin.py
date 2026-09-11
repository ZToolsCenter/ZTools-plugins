#!/usr/bin/env python3
"""验证 ZTools 插件构建产物及其源码侧清单契约。"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import struct
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


class ValidationResult:
    """收集校验错误和警告，并在结束时统一报告。"""

    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, message: str) -> None:
        """记录一个校验错误。"""
        self.errors.append(message)

    def warn(self, message: str) -> None:
        """记录一个不阻止通过的校验警告。"""
        self.warnings.append(message)


def template_logo_hashes() -> set[str]:
    """读取 Skill 内置模板 Logo 的哈希，用于阻止占位图标进入交付产物。"""
    templates_root = Path(__file__).resolve().parent.parent / "assets" / "templates"
    hashes: set[str] = set()
    if not templates_root.is_dir():
        return hashes
    for path in templates_root.glob("*/src-ztools/logo.png"):
        try:
            hashes.add(hashlib.sha256(path.read_bytes()).hexdigest())
        except OSError:
            continue
    return hashes


def png_has_alpha(content: bytes) -> bool:
    """读取 PNG chunk，准确判断是否包含 Alpha 或 tRNS 透明信息。"""
    offset = 8
    while offset + 12 <= len(content):
        chunk_length = struct.unpack(">I", content[offset : offset + 4])[0]
        chunk_start = offset + 8
        chunk_end = chunk_start + chunk_length
        if chunk_end + 4 > len(content):
            return False
        if content[chunk_start : chunk_start + 4] == b"tRNS":
            return True
        if content[chunk_start : chunk_start + 4] == b"IEND":
            return False
        offset = chunk_end + 4
    return False


def validate_logo_file(path: Path, result: ValidationResult, label: str) -> None:
    """校验 Logo 不是模板占位图，并检查 PNG 的尺寸和透明通道。"""
    try:
        content = path.read_bytes()
    except OSError as error:
        result.error(f"{label} Logo 无法读取：{path}：{error}")
        return

    digest = hashlib.sha256(content).hexdigest()
    if digest in template_logo_hashes():
        result.error(f"{label} Logo 仍是内置模板占位图：{path}；请先生成并转换独立图标")

    if path.suffix.lower() != ".png":
        return

    png_signature = b"\x89PNG\r\n\x1a\n"
    if len(content) < 26 or content[:8] != png_signature or content[12:16] != b"IHDR":
        result.error(f"{label} Logo 不是有效 PNG：{path}")
        return

    width, height, _bit_depth, color_type = struct.unpack(">IIBB", content[16:26])
    if width < 32 or height < 32:
        result.error(f"{label} Logo 尺寸过小：{width}x{height}；至少需要 32x32")

    # RGBA、灰度 Alpha 或带 tRNS 块的调色板 PNG 才能保留透明背景。
    has_alpha = color_type in {4, 6} or png_has_alpha(content)
    if not has_alpha:
        result.error(f"{label} Logo 没有透明通道：{path}")


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="验证 ZTools 插件项目")
    parser.add_argument("plugin_path", type=Path, help="插件项目或构建产物目录")
    parser.add_argument(
        "--build-dir",
        default="dist",
        help="相对于插件项目的构建目录，默认值为 dist",
    )
    return parser.parse_args()


def load_json(path: Path, result: ValidationResult) -> dict[str, Any] | None:
    """读取 JSON 对象，并报告解析或结构错误。"""
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        result.error(f"缺少 JSON 文件：{path}")
        return None
    except json.JSONDecodeError as error:
        result.error(f"JSON 文件无效：{path}：{error}")
        return None

    if not isinstance(value, dict):
        result.error(f"JSON 根节点必须是对象：{path}")
        return None
    return value


def require_string(manifest: dict[str, Any], key: str, result: ValidationResult) -> None:
    """要求清单字段为非空字符串。"""
    value = manifest.get(key)
    if not isinstance(value, str) or not value.strip():
        result.error(f"plugin.json 字段 '{key}' 必须是非空字符串")


def validate_features(manifest: dict[str, Any], result: ValidationResult) -> None:
    """校验功能 code 和宽泛指令的输入边界。"""
    features = manifest.get("features", [])
    if not isinstance(features, list):
        result.error("plugin.json 字段 'features' 必须是数组")
        return

    seen_codes: set[str] = set()
    for index, feature in enumerate(features):
        if not isinstance(feature, dict):
            result.error(f"features[{index}] 必须是对象")
            continue

        code = feature.get("code")
        if not isinstance(code, str) or not code.strip():
            result.error(f"features[{index}].code 必须是非空字符串")
        elif code in seen_codes:
            result.error(f"功能 code 重复：{code}")
        else:
            seen_codes.add(code)

        if "platform" in feature:
            result.error(f"features[{index}].platform 无效；请将 platform 放在 plugin.json 顶层")

        commands = feature.get("cmds", [])
        if not isinstance(commands, list):
            result.error(f"features[{index}].cmds 必须是数组")
            continue
        for command_index, command in enumerate(commands):
            if not isinstance(command, dict) or command.get("type") != "over":
                continue
            if not isinstance(command.get("minLength"), int):
                result.warn(f"features[{index}].cmds[{command_index}] 的 over 指令缺少 minLength")
            if not isinstance(command.get("maxLength"), int):
                result.warn(f"features[{index}].cmds[{command_index}] 的 over 指令缺少 maxLength")


def validate_development_url(manifest: dict[str, Any], result: ValidationResult) -> None:
    """校验可选的开发页面 URL。"""
    development = manifest.get("development")
    if development is None:
        return
    if not isinstance(development, dict):
        result.error("plugin.json 字段 'development' 必须是对象")
        return

    main = development.get("main")
    if main is None:
        return
    if not isinstance(main, str) or urlparse(main).scheme not in {"http", "https"}:
        result.error("development.main 必须是 http(s) URL")


def validate_manifest(manifest: dict[str, Any], result: ValidationResult) -> None:
    """校验 ZTools 清单的核心字段及其关系。"""
    if "pluginName" in manifest:
        result.error("plugin.json 使用了旧字段 'pluginName'；请改为 'name' 和 'title'")
    require_string(manifest, "name", result)
    require_string(manifest, "title", result)
    require_string(manifest, "logo", result)
    if not any(isinstance(manifest.get(key), str) and manifest[key].strip() for key in ("main", "preload")):
        result.error("plugin.json 必须定义至少一个非空入口：main 或 preload")
    if not manifest.get("features") and not manifest.get("tools"):
        result.error("plugin.json 的 features 和 tools 不能同时为空")
    validate_features(manifest, result)
    validate_development_url(manifest, result)


def validate_entry_files(
    manifest_root: Path,
    manifest: dict[str, Any],
    result: ValidationResult,
    label: str,
    keys: tuple[str, ...] = ("main", "logo", "preload"),
) -> None:
    """确认指定清单根目录引用的文件存在，并检查真实 preload 入口。"""
    for key in keys:
        value = manifest.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        if urlparse(value).scheme in {"http", "https"}:
            if key == "main":
                result.warn("生产环境 main 使用远程地址；建议改用本地构建后的 HTML 入口")
            continue
        target = manifest_root / value
        if not target.is_file():
            result.error(f"{label}中的 {key} 不存在：{target}")

    logo_name = manifest.get("logo")
    if isinstance(logo_name, str) and logo_name.strip() and urlparse(logo_name).scheme not in {"http", "https"}:
        logo_path = manifest_root / logo_name
        if logo_path.is_file():
            validate_logo_file(logo_path, result, label)

    preload_name = manifest.get("preload")
    if not isinstance(preload_name, str) or not preload_name.strip():
        return
    preload_path = manifest_root / preload_name
    if not preload_path.is_file():
        return

    preload_text = preload_path.read_text(encoding="utf-8", errors="replace")
    if "window.exports" in preload_text and isinstance(manifest.get("main"), str):
        result.warn("页面插件的 preload 包含 window.exports；请确认没有使用 mode: 'none'")

    try:
        check = subprocess.run(
            ["node", "--check", str(preload_path)],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        result.error("无法检查 preload 语法：当前环境未找到 node")
        return
    if check.returncode != 0:
        detail = check.stderr.strip() or check.stdout.strip()
        result.error(f"preload 语法检查失败：{detail}")

    if "require(" in preload_text:
        # 支持将 CommonJS 声明放在 preload 子目录的模板结构。
        package_candidates = [manifest_root / "package.json", preload_path.parent / "package.json"]
        package_path = next((candidate for candidate in package_candidates if candidate.is_file()), None)
        if package_path is None:
            result.error(
                f"使用 require() 的 preload 缺少 CommonJS package.json：{preload_path.parent}"
            )
        else:
            package = load_json(package_path, result)
            if package is not None and package.get("type") != "commonjs":
                result.error(f"使用 require() 的 preload 要求 {package_path} 声明 type=commonjs")


def resolve_roots(plugin_path: Path, build_dir: str) -> tuple[Path, Path]:
    """解析源码项目或构建目录对应的项目根目录与构建根目录。"""
    resolved = plugin_path.expanduser().resolve()
    nested_build = resolved / build_dir
    if nested_build.is_dir():
        return resolved, nested_build
    return resolved, resolved


def normalize_source_manifest_for_build(
    source_manifest: dict[str, Any],
    build_dir: str,
) -> dict[str, Any]:
    """将源码清单转换为生产清单允许出现的标准形式。"""
    normalized = copy.deepcopy(source_manifest)
    normalized.pop("development", None)

    main = normalized.get("main")
    build_prefix = build_dir.strip("/\\") + "/"
    if isinstance(main, str) and main.startswith(build_prefix):
        normalized["main"] = main[len(build_prefix):]
    return normalized


def validate_manifest_alignment(
    source_manifest: dict[str, Any],
    built_manifest: dict[str, Any],
    build_dir: str,
    result: ValidationResult,
) -> None:
    """要求生产清单只包含打包阶段允许产生的确定性差异。"""
    if source_manifest == built_manifest:
        return

    expected_manifest = normalize_source_manifest_for_build(source_manifest, build_dir)
    if expected_manifest == built_manifest:
        return

    changed_keys = sorted(
        key
        for key in set(expected_manifest) | set(built_manifest)
        if expected_manifest.get(key) != built_manifest.get(key)
    )
    detail = "、".join(changed_keys) if changed_keys else "未知字段"
    result.error(f"源码与构建产物中的 plugin.json 不一致：{detail}；请重新构建")


def report(result: ValidationResult, build_root: Path) -> int:
    """输出校验结果并返回进程退出码。"""
    for warning in result.warnings:
        print(f"警告：{warning}")
    for error in result.errors:
        print(f"错误：{error}", file=sys.stderr)

    if result.errors:
        print(
            f"ZTools 插件校验失败，共 {len(result.errors)} 个错误",
            file=sys.stderr,
        )
        return 1

    print(f"ZTools 插件校验通过：{build_root}")
    if result.warnings:
        print(f"校验完成，共 {len(result.warnings)} 个警告")
    return 0


def main() -> int:
    """验证 ZTools 插件项目并返回状态码。"""
    args = parse_args()
    project_root, build_root = resolve_roots(args.plugin_path, args.build_dir)
    result = ValidationResult()

    source_manifest_path = project_root / "public" / "plugin.json"
    if not source_manifest_path.is_file():
        source_manifest_path = project_root / "plugin.json"
    source_manifest = load_json(source_manifest_path, result)
    if source_manifest is not None:
        validate_manifest(source_manifest, result)
        validate_entry_files(
            source_manifest_path.parent,
            source_manifest,
            result,
            "源码清单",
            keys=("preload",),
        )

    built_manifest_path = build_root / "plugin.json"
    if built_manifest_path.is_file() and built_manifest_path != source_manifest_path:
        # 兼容清单确实随页面进入独立构建目录的旧项目结构。
        built_manifest = load_json(built_manifest_path, result)
        if built_manifest is not None:
            validate_manifest(built_manifest, result)
            validate_entry_files(build_root, built_manifest, result, "构建产物")
            if source_manifest is not None:
                validate_manifest_alignment(
                    source_manifest,
                    built_manifest,
                    args.build_dir,
                    result,
                )
        return report(result, build_root)

    if source_manifest is not None:
        # src-ztools 本身是插件根目录，dist 只承载清单 main 引用的页面结果。
        validate_entry_files(source_manifest_path.parent, source_manifest, result, "插件目录")
    return report(result, source_manifest_path.parent)


if __name__ == "__main__":
    raise SystemExit(main())
