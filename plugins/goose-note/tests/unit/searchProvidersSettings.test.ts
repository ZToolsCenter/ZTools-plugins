import { expect, test } from "playwright/test";
import {
  DEFAULT_SEARCH_PROVIDERS,
  getSearchProviderTemplateError,
  mergeSearchProvidersWithDefaults,
  type SearchProvider,
} from "../../src/stores/settings/types";

test("搜索网址模板只接受一个 http(s) 占位符", () => {
  expect(
    getSearchProviderTemplateError("https://www.zhihu.com/search?q=%s"),
  ).toBeNull();
  expect(getSearchProviderTemplateError("https://example.com/search")).toBe(
    "搜索网址需要包含一个 %s",
  );
  expect(
    getSearchProviderTemplateError("https://example.com/search?q=%s&copy=%s"),
  ).toBe("搜索网址需要包含一个 %s");
  expect(getSearchProviderTemplateError("javascript:alert(%s)")).toBe(
    "搜索网址仅支持 http 或 https",
  );
});

test("恢复设置时保留自定义搜索和用户排序", () => {
  const stored: SearchProvider[] = [
    {
      id: "custom-search-zhihu",
      name: " 知乎 ",
      urlTemplate: " https://www.zhihu.com/search?q=%s ",
      isEnabled: true,
      isCustom: true,
    },
    {
      ...DEFAULT_SEARCH_PROVIDERS[0],
      isEnabled: false,
    },
  ];

  const merged = mergeSearchProvidersWithDefaults(stored);

  expect(merged[0]).toEqual({
    id: "custom-search-zhihu",
    name: "知乎",
    urlTemplate: "https://www.zhihu.com/search?q=%s",
    isEnabled: true,
    isCustom: true,
  });
  expect(merged[1].id).toBe("baidu");
  expect(merged[1].isEnabled).toBe(false);
  expect(merged).toHaveLength(DEFAULT_SEARCH_PROVIDERS.length + 1);
});

test("恢复设置时丢弃无效的未知搜索项", () => {
  const merged = mergeSearchProvidersWithDefaults([
    {
      id: "custom-search-invalid",
      name: "无效搜索",
      urlTemplate: "file:///tmp/search?q=%s",
      isEnabled: true,
      isCustom: true,
    },
  ]);

  expect(merged).toEqual(DEFAULT_SEARCH_PROVIDERS);
});
