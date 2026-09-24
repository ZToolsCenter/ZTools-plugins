import { describe, expect, test } from "bun:test";

const { NETTOP_ARGS, parseCsv, parseNettop, collectNettop, aggregateNetworkUsage } = require("./network-provider.cjs");

const FIXTURE = [
  "time,,bytes_in,bytes_out,\r",
  '10:00:00.000000,"App, 中文.123",9007199254740993000,100,\r',
  '10:00:00.250000,"Helper.Name.456",10,20,\r',
  "time,,bytes_in,bytes_out,\r",
  '10:00:01.250000,"App, 中文.123",1250,625,\r',
  '10:00:01.500000,"Helper.Name.456",0,0,\r',
].join("\n");

describe("nettop provider", () => {
  test("CSV 支持引号逗号、中文、CRLF 与尾逗号", () => {
    const rows = parseCsv(FIXTURE);
    expect(rows[1][1]).toBe("App, 中文.123");
    expect(rows[1].at(-1)).toBe("");
  });

  test("丢弃首帧累计，只读第二帧 delta，按 1.25s 换算且 BigInt 安全", () => {
    const result = parseNettop(FIXTURE);
    expect(result.find((item: any) => item.pid === 123)).toEqual({ pid: 123, downloadBps: 1000, uploadBps: 500 });
    expect(result.find((item: any) => item.pid === 456)).toEqual({ pid: 456, downloadBps: 0, uploadBps: 0 });
  });

  test("重复 header 取最后两帧，缺帧和非法 delta 不伪造速率", () => {
    expect(() => parseNettop("time,,bytes_in,bytes_out,\n00:00:00,a.1,1,2,")).toThrow("two frames");
    const invalid = "time,,bytes_in,bytes_out,\n00:00:00,a.1,10,10,\ntime,,bytes_in,bytes_out,\n00:00:01,a.1,-1,-2,";
    expect(parseNettop(invalid)).toEqual([]);
  });

  test("固定 execFile 参数、timeout 和 8MiB maxBuffer", async () => {
    const calls: any[] = [];
    const fake = (command: string, args: string[], options: object, callback: Function) => {
      calls.push({ command, args, options }); callback(null, FIXTURE);
    };
    expect((await collectNettop(fake)).length).toBe(2);
    expect(calls[0].command).toBe("/usr/bin/nettop");
    expect(calls[0].args).toEqual(NETTOP_ARGS);
    expect(calls[0].options).toMatchObject({ timeout: 2500, maxBuffer: 8 * 1024 * 1024 });
  });

  test("多 PID 聚合，并丢弃已退出或 startedAt 变化的 PID", () => {
    const app = { id: "app", allPids: [1, 2, 3] };
    const rates = [
      { pid: 1, downloadBps: 10, uploadBps: 2 },
      { pid: 2, downloadBps: 20, uploadBps: 3 },
      { pid: 3, downloadBps: 999, uploadBps: 999 },
    ];
    const before = [{ pid: 1, startedAt: "a" }, { pid: 2, startedAt: "b" }, { pid: 3, startedAt: "old" }];
    const after = [{ pid: 1, startedAt: "a" }, { pid: 2, startedAt: "b" }, { pid: 3, startedAt: "new" }];
    expect(aggregateNetworkUsage([app], rates, before, after)).toEqual([{
      app, activePids: [1, 2], downloadBps: 30, uploadBps: 5,
    }]);
  });
});
