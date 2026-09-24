import { expect, test } from "playwright/test";
import {
  parseSearchRss,
  validateExternalHttpUrl,
} from "../../src/lib/notebook-ai/tools/web";

test("AI 网页工具只接受公开 HTTP/HTTPS 地址", () => {
  expect(validateExternalHttpUrl("https://example.com/article?q=1")).toBe(
    "https://example.com/article?q=1",
  );

  for (const url of [
    "file:///tmp/secret",
    "http://localhost/admin",
    "http://127.0.0.1/admin",
    "http://192.168.1.1/admin",
    "http://user:password@example.com/",
  ]) {
    expect(() => validateExternalHttpUrl(url)).toThrow();
  }
});

test("公开搜索 RSS 解析为紧凑来源列表", () => {
  const xml = `<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title><![CDATA[第一条 &amp; 标题]]></title>
        <link>https://example.com/one</link>
        <description><![CDATA[<b>第一条</b>摘要]]></description>
      </item>
      <item>
        <title>第二条</title>
        <link>https://example.com/two</link>
        <description>第二条摘要</description>
      </item>
    </channel></rss>`;

  expect(parseSearchRss(xml, 1)).toEqual([
    {
      title: "第一条 & 标题",
      url: "https://example.com/one",
      snippet: "第一条摘要",
    },
  ]);
});
