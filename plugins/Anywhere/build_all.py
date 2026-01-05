#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动化构建脚本
按顺序构建：backend -> Anywhere_main -> Anywhere_window
"""

import subprocess
import sys
import os
from pathlib import Path


def run_command(command, cwd):
    """
    执行命令并实时输出结果

    Args:
        command: 要执行的命令（列表形式）
        cwd: 工作目录

    Returns:
        bool: 成功返回True，失败返回False
    """
    print(f"\n{'='*60}")
    print(f"📂 进入目录: {cwd}")
    print(f"🔨 执行命令: {' '.join(command)}")
    print(f"{'='*60}\n")

    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )

        # 实时输出
        for line in process.stdout:
            print(line, end='')

        process.wait()

        if process.returncode == 0:
            print(f"\n✅ {cwd} 构建成功!\n")
            return True
        else:
            print(f"\n❌ {cwd} 构建失败! (退出码: {process.returncode})\n")
            return False

    except Exception as e:
        print(f"\n❌ 执行命令时出错: {e}\n")
        return False


def main():
    """主函数"""
    # 获取脚本所在目录（项目根目录）
    root_dir = Path(__file__).parent.absolute()
    print(f"🏠 项目根目录: {root_dir}\n")

    # 定义构建任务
    build_tasks = [
        {
            "name": "Backend",
            "path": root_dir / "backend",
            "command": ["pnpm", "build"]
        },
        {
            "name": "Anywhere Main",
            "path": root_dir / "Anywhere_main",
            "command": ["pnpm", "build"]
        },
        {
            "name": "Anywhere Window",
            "path": root_dir / "Anywhere_window",
            "command": ["pnpm", "build"]
        }
    ]

    # 检查所有目录是否存在
    for task in build_tasks:
        if not task["path"].exists():
            print(f"❌ 错误: 目录不存在 - {task['path']}")
            sys.exit(1)

    # 依次执行构建
    print("🚀 开始构建流程...\n")
    start_time = __import__('time').time()

    for i, task in enumerate(build_tasks, 1):
        print(f"\n{'#'*60}")
        print(f"# 步骤 {i}/{len(build_tasks)}: 构建 {task['name']}")
        print(f"{'#'*60}")

        success = run_command(task["command"], task["path"])

        if not success:
            print(f"\n💔 构建流程中断于: {task['name']}")
            print(f"❌ 总体构建失败!\n")
            sys.exit(1)

    # 全部成功
    elapsed_time = __import__('time').time() - start_time
    print(f"\n{'='*60}")
    print(f"🎉 所有构建任务完成!")
    print(f"⏱️  总耗时: {elapsed_time:.2f} 秒")
    print(f"{'='*60}\n")
    sys.exit(0)


if __name__ == "__main__":
    main()
