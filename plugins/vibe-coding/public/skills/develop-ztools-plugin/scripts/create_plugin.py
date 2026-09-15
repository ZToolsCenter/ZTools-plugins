#!/usr/bin/env python3
"""从 skill 内置模板创建一个 ZTools 插件项目。"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any


PLUGIN_NAME_PATTERN = re.compile(r"^[a-z0-9-]+$")
SUPPORTED_PLATFORMS = ("win32", "darwin", "linux")
TEMPLATE_DIRECTORIES = {"vue": "vue-vite"}
PLACEHOLDERS = {
    "{{PLUGIN_NAME}}": "name",
    "{{PLUGIN_TITLE}}": "title",
    "{{DESCRIPTION}}": "description",
    "{{AUTHOR}}": "author",
    "{{PROJECT_NAME}}": "name",
}
IGNORED_EMPTY_ENTRIES = {".DS_Store", ".gitkeep"}

MINIMAL_APP = """<script setup lang=\"ts\">
import { onMounted, ref } from 'vue'

const status = ref('等待插件指令')
const payload = ref<unknown>(null)

/**
 * 接收 ZTools 的功能入口事件并更新当前页面状态。
 * @param action 宿主传入的插件动作。
 * @returns 无返回值。
 */
function handlePluginEnter(action: Record<string, unknown>): void {
  status.value = typeof action.code === 'string' ? `已进入：${action.code}` : '已进入插件'
  payload.value = action
}

onMounted(() => {
  window.ztools.onPluginEnter(handlePluginEnter)
  window.ztools.onPluginOut(() => {
    status.value = '等待插件指令'
    payload.value = null
  })
})
</script>

<template>
  <main class=\"plugin-shell\">
    <h1>{{ status }}</h1>
    <pre v-if=\"payload\">{{ JSON.stringify(payload, null, 2) }}</pre>
  </main>
</template>

<style scoped>
.plugin-shell {
  min-height: 100vh;
  padding: 24px;
  box-sizing: border-box;
  color: var(--plugin-text, #222);
}

pre {
  overflow: auto;
  padding: 12px;
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 8%, transparent);
}
</style>
"""

MINIMAL_PRELOAD = """// 仅暴露插件实际需要的最小桥接能力。
window.services = Object.freeze({})
"""


def parse_args() -> argparse.Namespace:
    """解析模板创建参数。"""
    parser = argparse.ArgumentParser(description="从内置模板创建 ZTools 插件项目")
    parser.add_argument("project_dir", type=Path, help="新项目目录；允许已存在但必须为空")
    parser.add_argument(
        "--template",
        choices=("vue",),
        default="vue",
        help="项目模板，目前支持 vue（默认）",
    )
    parser.add_argument("--name", required=True, help="插件 ID，只允许小写字母、数字和中划线")
    parser.add_argument("--title", required=True, help="插件展示名称")
    parser.add_argument("--description", default="", help="插件描述")
    parser.add_argument("--author", default="", help="插件作者")
    parser.add_argument(
        "--examples",
        action="store_true",
        help="保留模板内的 Hello、读文件和写文件示例；默认生成精简项目",
    )
    parser.add_argument(
        "--platform",
        action="append",
        choices=SUPPORTED_PLATFORMS,
        help="限制支持平台，可重复传入，例如 --platform darwin --platform win32",
    )
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    """读取一个 JSON 对象。"""
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"模板 JSON 无效：{path}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"模板 JSON 根节点必须是对象：{path}")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    """以稳定、可读的格式写回 JSON。"""
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def replace_text_placeholders(project_dir: Path, values: dict[str, str]) -> None:
    """替换模板文档中的展示文本占位符，跳过二进制文件。"""
    replacements = {
        placeholder: values[field] for placeholder, field in PLACEHOLDERS.items()
    }
    for path in project_dir.rglob("*"):
        if not path.is_file() or path.name in {"package.json", "plugin.json"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        updated = text
        for placeholder, value in replacements.items():
            updated = updated.replace(placeholder, value)
        if updated != text:
            path.write_text(updated, encoding="utf-8")


def is_effectively_empty(project_dir: Path) -> bool:
    """判断已存在的工作区是否只包含允许保留的系统占位文件。"""
    return all(entry.name in IGNORED_EMPTY_ENTRIES for entry in project_dir.iterdir())


def strip_examples(project_dir: Path) -> None:
    """移除示例功能并写入精简入口和空的 preload 桥接。"""
    source_root = project_dir / "src"
    for example_name in ("Hello", "Read", "Write"):
        shutil.rmtree(source_root / example_name, ignore_errors=True)

    (source_root / "App.vue").write_text(MINIMAL_APP, encoding="utf-8")
    (project_dir / "src-ztools" / "preload" / "services.js").write_text(
        MINIMAL_PRELOAD,
        encoding="utf-8",
    )
    plugin_json_path = project_dir / "src-ztools" / "plugin.json"
    plugin_json = load_json(plugin_json_path)
    plugin_title = str(plugin_json.get("title") or "打开插件")
    plugin_json["features"] = [
        {
            "code": "open",
            "explain": f"打开{plugin_title}",
            "cmds": [plugin_title],
        }
    ]
    write_json(plugin_json_path, plugin_json)


def create_project(args: argparse.Namespace) -> Path:
    """复制模板并写入项目元数据。"""
    if not PLUGIN_NAME_PATTERN.fullmatch(args.name):
        raise ValueError("插件 ID 只允许小写字母、数字和中划线")
    if not args.title.strip():
        raise ValueError("插件展示名称不能为空")

    project_dir = args.project_dir.expanduser().resolve()
    if project_dir.exists():
        if not project_dir.is_dir():
            raise FileExistsError(f"目标路径不是目录，拒绝覆盖：{project_dir}")
        if not is_effectively_empty(project_dir):
            raise FileExistsError(f"目标目录非空，拒绝覆盖：{project_dir}")

    template_dir = (
        Path(__file__).resolve().parent.parent
        / "assets"
        / "templates"
        / TEMPLATE_DIRECTORIES[args.template]
    )
    if not template_dir.is_dir():
        raise FileNotFoundError(f"内置模板不存在：{template_dir}")

    project_dir.parent.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix=f".{project_dir.name}-", dir=project_dir.parent))
    try:
        shutil.copytree(template_dir, staging_dir, dirs_exist_ok=True)

        plugin_json_path = staging_dir / "src-ztools" / "plugin.json"
        package_json_path = staging_dir / "package.json"
        plugin_json = load_json(plugin_json_path)
        package_json = load_json(package_json_path)

        plugin_json.update(
            {
                "name": args.name,
                "title": args.title,
                "description": args.description,
                "author": args.author,
            }
        )
        if args.platform:
            plugin_json["platform"] = list(dict.fromkeys(args.platform))
        package_json.update({"name": args.name, "description": args.description})
        write_json(plugin_json_path, plugin_json)
        write_json(package_json_path, package_json)
        replace_text_placeholders(
            staging_dir,
            {
                "name": args.name,
                "title": args.title,
                "description": args.description,
                "author": args.author,
            },
        )
        if not args.examples:
            strip_examples(staging_dir)

        shutil.copytree(staging_dir, project_dir, dirs_exist_ok=True)
    except Exception:
        raise
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)

    return project_dir


def main() -> int:
    """创建项目并输出后续操作路径。"""
    args = parse_args()
    try:
        project_dir = create_project(args)
    except (FileExistsError, FileNotFoundError, OSError, ValueError) as error:
        print(f"创建失败：{error}", file=sys.stderr)
        return 1

    print(f"已创建 ZTools Vue 项目：{project_dir}")
    print(f"插件清单：{project_dir / 'src-ztools' / 'plugin.json'}")
    print("下一步（必须先完成）：根据插件定位生成独立 SVG 图标，并转换为 src-ztools/logo.png；模板 logo.png 只能作为临时占位资源")
    print("完成 Logo 替换并检查透明背景、尺寸和清晰度后，再运行 npm install && npm run build")
    print("交付前运行：python3 <skill-dir>/scripts/validate_plugin.py <project-dir>/src-ztools")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
