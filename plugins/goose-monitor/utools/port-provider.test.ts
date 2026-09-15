import { describe, expect, test } from "bun:test";

const {
  parseLsof,
  parseNetstatWin,
  parseSsLinux,
  attachListenPorts,
  isServiceRuntime,
} = require("./port-provider.cjs") as {
  parseLsof: (text: string) => Map<number, number[]>;
  parseNetstatWin: (text: string) => Map<number, number[]>;
  parseSsLinux: (text: string) => Map<number, number[]>;
  attachListenPorts: (rows: any[], portsByPid: Map<number, number[]>) => any[];
  isServiceRuntime: (name: string, path?: string) => boolean;
};

describe("监听端口解析", () => {
  test("lsof 去重同端口的 IPv4/IPv6，并忽略非 LISTEN", () => {
    const text = [
      "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "node    4821 me    23u  IPv4 0x1      0t0  TCP *:5173 (LISTEN)",
      "node    4821 me    24u  IPv6 0x2      0t0  TCP [::]:5173 (LISTEN)",
      "node    4821 me    25u  IPv4 0x3      0t0  TCP 127.0.0.1:24678 (LISTEN)",
      "node    4821 me    26u  IPv4 0x4      0t0  TCP 127.0.0.1:5173 (ESTABLISHED)",
    ].join("\n");
    expect(parseLsof(text).get(4821)).toEqual([5173, 24678]);
  });

  test("Windows netstat 按 PID 归并 LISTENING", () => {
    const text = [
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       2201",
      "  TCP    [::]:8080              [::]:0                 LISTENING       2201",
      "  TCP    127.0.0.1:5432         0.0.0.0:0              LISTENING       690",
      "  TCP    127.0.0.1:5173         127.0.0.1:51234        ESTABLISHED     4821",
    ].join("\r\n");
    expect(parseNetstatWin(text).get(2201)).toEqual([8080]);
    expect(parseNetstatWin(text).get(690)).toEqual([5432]);
    expect(parseNetstatWin(text).has(4821)).toBe(false);
  });

  test("Linux ss 从 pid= 取属主", () => {
    const text = [
      "LISTEN 0 511 0.0.0.0:5173 0.0.0.0:* users:((\"node\",pid=4821,fd=23))",
      "LISTEN 0 511 [::]:5173 [::]:* users:((\"node\",pid=4821,fd=24))",
      "LISTEN 0 128 127.0.0.1:5432 0.0.0.0:* users:((\"postgres\",pid=690,fd=7))",
    ].join("\n");
    expect(parseSsLinux(text).get(4821)).toEqual([5173]);
    expect(parseSsLinux(text).get(690)).toEqual([5432]);
  });

  test("组合并组下所有成员端口，helper 只挂自己的", () => {
    const rows = [{
      name: "node",
      path: "/usr/local/bin/node",
      pid: 100,
      allPids: [100, 101],
      helpers: [{ pid: 100, name: "node" }, { pid: 101, name: "node" }],
    }];
    attachListenPorts(rows, new Map([[100, [8080]], [101, [8080, 9090]]]));
    expect(rows[0].ports).toEqual([8080, 9090]);
    expect(rows[0].helpers[0].ports).toEqual([8080]);
    expect(rows[0].helpers[1].ports).toEqual([8080, 9090]);
  });

  test("只给运行时/开发服务挂端口，微信这类 GUI 内部监听不展示", () => {
    expect(isServiceRuntime("node (vite)", "~/dev/app/node_modules/.bin/vite")).toBe(true);
    expect(isServiceRuntime("java", "/opt/homebrew/opt/openjdk/bin/java")).toBe(true);
    expect(isServiceRuntime("WeChat", "/Applications/WeChat.app/Contents/MacOS/WeChat")).toBe(false);
    const rows = [
      { name: "WeChat", path: "/Applications/WeChat.app", pid: 1, allPids: [1], helpers: [] },
      { name: "node", path: "/usr/local/bin/node", pid: 2, allPids: [2], helpers: [] },
    ];
    attachListenPorts(rows, new Map([[1, [14013, 14016, 14019]], [2, [5173]]]));
    expect(rows[0].ports).toEqual([]);
    expect(rows[1].ports).toEqual([5173]);
  });

  test("jar 显示名 diteng-im-server 仍挂端口，命令行声明也算服务", () => {
    const rows = [
      {
        name: "diteng-im-server",
        path: "java",
        pid: 1700,
        allPids: [1700],
        helpers: [],
        commandLine: "java -jar /opt/diteng-im-server-202409.01.jar --server.port=8101",
      },
      {
        name: "diteng-im-server",
        path: "/Users/me/diteng-im-server-202409.01.jar --server.port=8101",
        pid: 1701,
        allPids: [1701],
        helpers: [],
        commandLine: "java -Xms1g -jar /Users/me/diteng-im-server-202409.01.jar --server.port=8101",
      },
    ];
    attachListenPorts(rows, new Map([[1700, [8101]], [1701, [8101]]]));
    expect(rows[0].ports).toEqual([8101]);
    expect(rows[1].ports).toEqual([8101]);
    const wrapper = [{
      name: "SCREEN", path: "/usr/bin/screen", pid: 1689, allPids: [1689], helpers: [],
      commandLine: "SCREEN -dmS im bash -c java -jar diteng-im-server-202409.01.jar --server.port=8101",
    }];
    attachListenPorts(wrapper, new Map([[1689, [8101]]]));
    expect(wrapper[0].ports).toEqual([]);
  });
});
