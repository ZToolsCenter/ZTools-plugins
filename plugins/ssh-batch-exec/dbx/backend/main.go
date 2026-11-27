// 作者：木子
// DBX CLI 只识别 Go/Rust backend。这里用极薄的 Go launcher 启动 Node Sidecar，
// 所有业务逻辑仍由 Node + ssh2 实现。
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func main() {
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "dbx backend: resolve executable failed:", err)
		os.Exit(1)
	}

	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		fmt.Fprintln(os.Stderr, "dbx backend: resolve symlink failed:", err)
		os.Exit(1)
	}

	// dbx-plugin package 会把二进制放到插件根目录的 bin/<target>/backend。
	pluginRoot := filepath.Dir(filepath.Dir(filepath.Dir(exe)))
	serverPath := filepath.Join(pluginRoot, "backend", "server.js")

	node := os.Getenv("DBX_PLUGIN_NODE")
	if node == "" {
		if found, err := exec.LookPath("node"); err == nil {
			node = found
		} else {
			for _, candidate := range []string{"/opt/homebrew/bin/node", "/usr/local/bin/node"} {
				if _, err := os.Stat(candidate); err == nil {
					node = candidate
					break
				}
			}
		}
	}
	if node == "" {
		fmt.Fprintln(os.Stderr, "dbx backend: node not found; set DBX_PLUGIN_NODE to a Node.js executable")
		os.Exit(127)
	}

	if err := syscall.Exec(node, []string{node, serverPath}, os.Environ()); err != nil {
		fmt.Fprintln(os.Stderr, "dbx backend: start node failed:", err)
		os.Exit(1)
	}
}
