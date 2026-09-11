import { expect, test } from "playwright/test";
import {
  resolveErrorReportingConfig,
  shouldReportErrors,
} from "../../src/error-reporting/config";

test("缺文件或 enabled 非 true 不上报", () => {
  expect(shouldReportErrors(resolveErrorReportingConfig(null))).toBe(false);
  expect(shouldReportErrors(resolveErrorReportingConfig({ enabled: false }))).toBe(
    false,
  );
  expect(
    shouldReportErrors(
      resolveErrorReportingConfig({
        enabled: true,
        projects: { "goose-note": "" },
      }),
    ),
  ).toBe(false);
});

test("enabled 且 goose-note 有 DSN 才上报", () => {
  const config = resolveErrorReportingConfig({
    enabled: true,
    environment: "dev",
    projects: {
      "goose-note": "https://example.invalid/dsn",
      "goose-marks": "https://other.invalid/dsn",
    },
  });
  expect(config.enabled).toBe(true);
  expect(config.environment).toBe("dev");
  expect(config.dsn).toBe("https://example.invalid/dsn");
  expect(shouldReportErrors(config)).toBe(true);
});

test("只取 goose-note 的 DSN", () => {
  const config = resolveErrorReportingConfig({
    enabled: true,
    projects: { "goose-marks": "https://other.invalid/dsn" },
  });
  expect(config.dsn).toBeNull();
  expect(shouldReportErrors(config)).toBe(false);
});

test("兼容 projects[id]={enabled,dsn}", () => {
  const config = resolveErrorReportingConfig({
    environment: "prod",
    projects: {
      "goose-note": { enabled: true, dsn: "https://example.invalid/obj" },
      "goose-marks": { enabled: true, dsn: "https://other.invalid/obj" },
    },
  });
  expect(config.enabled).toBe(true);
  expect(config.environment).toBe("prod");
  expect(config.dsn).toBe("https://example.invalid/obj");
  expect(shouldReportErrors(config)).toBe(true);
});

test("对象形状 enabled false 即使有 dsn 也不上报", () => {
  const config = resolveErrorReportingConfig({
    enabled: true,
    projects: {
      "goose-note": { enabled: false, dsn: "https://example.invalid/obj" },
    },
  });
  expect(config.enabled).toBe(false);
  expect(shouldReportErrors(config)).toBe(false);
});
