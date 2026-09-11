import { describe, expect, test } from "bun:test";

const {
  inferRole,
  isGpuProcessCommand,
  linuxExecutableFromCommand,
  findExecutableTreeRootPid,
  serviceDisplayName,
  isRewrittenHelperTitle,
  macProcessFields,
  inheritBundleExecutables,
} = require("./process-role.cjs") as {
  inferRole: (name: string, commandLine: string, isMain: boolean) => string;
  isGpuProcessCommand: (commandLine: string) => boolean;
  linuxExecutableFromCommand: (name: string, commandLine: string) => string;
  findExecutableTreeRootPid: (
    proc: { pid: number; ppid: number; exe: string },
    byPid: Map<number, { pid: number; ppid: number; exe: string }>,
  ) => number;
  serviceDisplayName: (name: string, commandLine: string) => string;
  isRewrittenHelperTitle: (text: string) => boolean;
  macProcessFields: (comm: string, commandLine: string) => { exe: string; name: string; commandLine: string };
  inheritBundleExecutables: (list: Array<{ pid: number; ppid: number; exe: string; name: string; commandLine?: string }>) => unknown;
};

describe("uTools GPU 进程角色识别", () => {
  test("识别大小写不同的 Chromium GPU 参数", () => {
    expect(isGpuProcessCommand('"C:\\Chrome\\chrome.exe" --TYPE=GPU-PROCESS')).toBe(true);
    expect(inferRole("chrome.exe", "chrome.exe --type=gpu-process", false)).toBe("GPU");
  });

  test("缺少命令行和普通 Chrome 不会误判", () => {
    expect(inferRole("chrome.exe", "", false)).toBe("子进程");
    expect(inferRole("chrome.exe", "chrome.exe --type=renderer", false)).toBe("子进程");
    expect(isGpuProcessCommand("chrome.exe --type=gpu-process-old")).toBe(false);
  });

  test("GPU 信号优先于按内存推断的主进程，macOS 名称识别保持不变", () => {
    expect(inferRole("chrome.exe", "chrome.exe --type=gpu-process", true)).toBe("GPU");
    expect(inferRole("Chrome Helper (GPU)", "", false)).toBe("GPU");
  });
});

describe("Linux Chromium 进程归并", () => {
  test("不同 args 保留同一 exe 和根进程；图形子进程仍正确归组", () => {
    const mainCommand = "/opt/google/chrome/chrome --profile-directory=Default";
    const gpuCommand = "/opt/google/chrome/chrome --type=gpu-process --gpu-preferences=abc";
    const main = {
      pid: 100, ppid: 1, name: "chrome", commandLine: mainCommand,
      exe: linuxExecutableFromCommand("chrome", mainCommand),
    };
    const gpu = {
      pid: 101, ppid: 100, name: "chrome", commandLine: gpuCommand,
      exe: linuxExecutableFromCommand("chrome", gpuCommand),
    };
    const byPid = new Map([[main.pid, main], [gpu.pid, gpu]]);
    expect(main.exe).toBe("/opt/google/chrome/chrome");
    expect(gpu.exe).toBe(main.exe);
    expect(findExecutableTreeRootPid(gpu, byPid)).toBe(main.pid);

    const helpers = [main, gpu].map((proc, index) => ({
      name: proc.name,
      role: inferRole(proc.name, proc.commandLine, index === 0),
      cpu: index ? 3 : 1,
      mem: index ? 120 : 240,
      pid: proc.pid,
    }));
    expect(helpers.map((helper) => helper.role)).toEqual(["主进程", "GPU"]);
  });

  test("带引号路径只取可执行文件，macOS 名称角色识别不回归", () => {
    expect(linuxExecutableFromCommand("chrome", "'/opt/Chrome Stable/chrome' --type=gpu-process"))
      .toBe("/opt/Chrome Stable/chrome");
    expect(inferRole("Chrome Helper (GPU)", "", false)).toBe("GPU");
  });

  test("mac args 里带空格的 .app 路径不被拆开，java -jar 里的 .app 不误当 exe", () => {
    expect(linuxExecutableFromCommand("", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --type=gpu-process"))
      .toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(linuxExecutableFromCommand("", "/usr/bin/java -jar /Applications/Foo.app/lib/app.jar --server.port=8101"))
      .toBe("/usr/bin/java");
  });

  test("fileWatcher / 窗口 id 不会被吃进 .app 可执行路径", () => {
    const helper = "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper.app/Contents/MacOS/Cursor Helper";
    expect(linuxExecutableFromCommand("", `${helper} fileWatcher [1:empty-window]`)).toBe(helper);
    expect(linuxExecutableFromCommand(
      "Cursor Helper: fileWatcher [1:empty-window]",
      "Cursor Helper: fileWatcher [1:empty-window]",
    )).toBe("Cursor");
    const title = macProcessFields(
      "Cursor Helper: fileWatcher [1:empty-window]",
      "Cursor Helper: fileWatcher [1:empty-window]",
    );
    expect(title.name).toBe("Cursor");
    expect(title.name).not.toContain("fileWatcher");
    expect(title.name).not.toContain("empty-window");
    expect(title.commandLine).toContain("fileWatcher");
  });
});

describe("服务显示名", () => {
  test("mac 命令行 -jar 显示 jar 名并去掉版本后缀", () => {
    const cmd = "/opt/homebrew/opt/openjdk/bin/java -jar /Users/me/diteng-im-server-202409.01.jar --server.port=8101";
    expect(serviceDisplayName("java", cmd)).toBe("diteng-im-server");
    expect(serviceDisplayName("java", 'java -jar "C:\\svc\\diteng-im-server-202409.01.jar"')).toBe("diteng-im-server");
    expect(linuxExecutableFromCommand("", cmd)).toBe("/opt/homebrew/opt/openjdk/bin/java");
  });

  test("非 jar 进程仍用原 name", () => {
    expect(serviceDisplayName("node", "node server.js")).toBe("node");
    expect(serviceDisplayName("python", "python -m http.server 8000")).toBe("python");
    expect(serviceDisplayName("java", "")).toBe("java");
    expect(serviceDisplayName("Cursor Helper", "Cursor Helper: fileWatcher [1:empty-window]")).toBe("Cursor Helper");
    expect(serviceDisplayName("SCREEN", "SCREEN -dmS im bash -c java -jar diteng-im-server-202409.01.jar")).toBe("SCREEN");
    expect(serviceDisplayName("login", "login -pflq me /bin/bash -c java -jar app.jar --server.port=8101")).toBe("login");
  });
});

describe("mac comm + args 身份", () => {
  test("带空格的 .app comm 整段当 exe，args 只进 commandLine", () => {
    const comm = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const args = `${comm} --type=gpu-process`;
    expect(macProcessFields(comm, args)).toEqual({
      exe: comm,
      name: "Google Chrome",
      commandLine: args,
    });
  });

  test("java 短 comm 保留 java，-jar 显示名另算", () => {
    const args = "java -Xms1g -jar /Users/me/diteng-im-server-202409.01.jar --server.port=8101";
    const fields = macProcessFields("java", args);
    expect(fields).toEqual({ exe: "java", name: "java", commandLine: args });
    expect(serviceDisplayName(fields.name, fields.commandLine)).toBe("diteng-im-server");
    expect(isRewrittenHelperTitle("Cursor Helper: fileWatcher [1:empty-window]")).toBe(true);
    expect(isRewrittenHelperTitle("java")).toBe(false);
  });

  test("改写过的 Cursor Helper 标题不单独成行，挂回父 bundle", () => {
    const cursor = "/Applications/Cursor.app/Contents/MacOS/Cursor";
    const list = [
      { pid: 10, ppid: 1, exe: cursor, name: "Cursor", commandLine: cursor },
      {
        pid: 20, ppid: 10, exe: "Cursor", name: "Cursor",
        commandLine: "Cursor Helper: fileWatcher [1:empty-window]",
      },
      {
        pid: 21, ppid: 10, exe: "Cursor", name: "Cursor",
        commandLine: "Cursor Helper: fileWatcher [1:04e9b907d81bcdf4d829214c5226c161]",
      },
      {
        pid: 30, ppid: 1, exe: "java", name: "java",
        commandLine: "java -jar /opt/diteng-im-server-202409.01.jar --server.port=8101",
      },
    ];
    inheritBundleExecutables(list);
    expect(list[1].exe).toBe(cursor);
    expect(list[1].name).toBe("Cursor");
    expect(list[2].exe).toBe(cursor);
    expect(list[3].exe).toBe("java");
    expect(list[3].name).toBe("java");
  });
});
