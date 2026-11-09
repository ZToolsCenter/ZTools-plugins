import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  extractHtmlMetadata,
  isPrivateHost,
  isSensitiveUrl,
  normalizeCandidateUrl,
  shouldFetchUrlMetadata,
} from "../preload/url-metadata-service";

describe("url-metadata-service", () => {
  describe("isPrivateHost", () => {
    it("identifies localhost and single-word hosts", () => {
      expect(isPrivateHost("localhost")).toBe(true);
      expect(isPrivateHost("0.0.0.0")).toBe(true);
      expect(isPrivateHost("router")).toBe(true);
      expect(isPrivateHost("nas")).toBe(true);
    });

    it("identifies private IPv4 addresses", () => {
      expect(isPrivateHost("127.0.0.1")).toBe(true);
      expect(isPrivateHost("10.0.1.25")).toBe(true);
      expect(isPrivateHost("192.168.1.1")).toBe(true);
      expect(isPrivateHost("172.16.0.1")).toBe(true);
      expect(isPrivateHost("172.31.255.255")).toBe(true);
      expect(isPrivateHost("169.254.1.1")).toBe(true);
      expect(isPrivateHost("100.64.0.1")).toBe(true);
      expect(isPrivateHost("100.127.255.255")).toBe(true);
    });

    it("allows public IPv4 and domain names", () => {
      expect(isPrivateHost("8.8.8.8")).toBe(false);
      expect(isPrivateHost("1.1.1.1")).toBe(false);
      expect(isPrivateHost("github.com")).toBe(false);
      expect(isPrivateHost("www.bilibili.com")).toBe(false);
      expect(isPrivateHost("git.meitu.com")).toBe(false);
    });

    it("identifies internal TLDs", () => {
      expect(isPrivateHost("my-service.local")).toBe(true);
      expect(isPrivateHost("api.corp")).toBe(true);
      expect(isPrivateHost("cluster.internal")).toBe(true);
      expect(isPrivateHost("printer.lan")).toBe(true);
    });

    it("identifies IPv6 loopback and private", () => {
      expect(isPrivateHost("::1")).toBe(true);
      expect(isPrivateHost("fe80::1")).toBe(true);
      expect(isPrivateHost("fc00::1")).toBe(true);
      expect(isPrivateHost("::ffff:127.0.0.1")).toBe(true);
    });
  });

  describe("isSensitiveUrl", () => {
    it("detects sensitive query parameters", () => {
      expect(isSensitiveUrl(new URL("https://example.com/login?token=abc1234567890abcdef"))).toBe(true);
      expect(isSensitiveUrl(new URL("https://example.com/api?access_token=secret"))).toBe(true);
      expect(isSensitiveUrl(new URL("https://example.com/auth?sig=9999999999"))).toBe(true);
      expect(isSensitiveUrl(new URL("https://example.com?ticket=TICKET-1234"))).toBe(true);
      expect(isSensitiveUrl(new URL("https://example.com?verify=code123"))).toBe(true);
      expect(isSensitiveUrl(new URL("https://example.com?api_key=SECRET"))).toBe(true);
    });

    it("detects sensitive paths", () => {
      expect(isSensitiveUrl(new URL("https://example.com/reset-password/uuid-here"))).toBe(true);
      expect(isSensitiveUrl(new URL("https://example.com/verify-email?id=123"))).toBe(true);
      expect(isSensitiveUrl(new URL("https://example.com/magic-link/test"))).toBe(true);
      expect(isSensitiveUrl(new URL("https://example.com/invite/group123"))).toBe(true);
    });

    it("detects embedded credentials", () => {
      expect(isSensitiveUrl(new URL("https://user:password@example.com/path"))).toBe(true);
    });

    it("allows regular public URLs", () => {
      expect(isSensitiveUrl(new URL("https://github.com/vuejs/core"))).toBe(false);
      expect(isSensitiveUrl(new URL("https://www.bilibili.com/video/BV1xx411c7xx?spm_id_from=333.337"))).toBe(false);
      expect(isSensitiveUrl(new URL("https://news.ycombinator.com/item?id=1234567"))).toBe(false);
    });
  });

  describe("normalizeCandidateUrl", () => {
    it("preserves explicit web schemes", () => {
      expect(normalizeCandidateUrl("https://git.meitu.com")).toBe("https://git.meitu.com");
      expect(normalizeCandidateUrl("http://example.com/page")).toBe("http://example.com/page");
    });

    it("prepends https:// to bare domains", () => {
      expect(normalizeCandidateUrl("git.meitu.com")).toBe("https://git.meitu.com");
      expect(normalizeCandidateUrl("www.apple.com.cn")).toBe("https://www.apple.com.cn");
      expect(normalizeCandidateUrl("github.com/vuejs/core")).toBe("https://github.com/vuejs/core");
    });

    it("rejects non-url text", () => {
      expect(normalizeCandidateUrl("hello world")).toBeUndefined();
      expect(normalizeCandidateUrl("style.css")).toBeUndefined();
      expect(normalizeCandidateUrl("README.md")).toBeUndefined();
      expect(normalizeCandidateUrl("")).toBeUndefined();
    });
  });

  describe("shouldFetchUrlMetadata", () => {
    it("returns false for non-http/https, private hosts, and sensitive URLs", () => {
      expect(shouldFetchUrlMetadata("ftp://ftp.example.com/file")).toBe(false);
      expect(shouldFetchUrlMetadata("javascript:alert(1)")).toBe(false);
      expect(shouldFetchUrlMetadata("http://192.168.1.1/admin")).toBe(false);
      expect(shouldFetchUrlMetadata("http://localhost:3000/api")).toBe(false);
      expect(shouldFetchUrlMetadata("https://site.com/auth?token=123")).toBe(false);
      expect(shouldFetchUrlMetadata("https://admin:secret@example.com/")).toBe(false);
    });

    it("returns true for valid public web URLs", () => {
      expect(shouldFetchUrlMetadata("https://vuejs.org/guide/introduction.html")).toBe(true);
      expect(shouldFetchUrlMetadata("https://developer.mozilla.org/zh-CN/docs/Web")).toBe(true);
      expect(shouldFetchUrlMetadata("git.meitu.com")).toBe(true);
      expect(shouldFetchUrlMetadata("www.apple.com.cn/macbook-pro")).toBe(true);
    });
  });

  describe("decodeHtmlEntities", () => {
    it("decodes named entities and numeric entities", () => {
      expect(decodeHtmlEntities("Vue &amp; React &lt;3 &quot;Web&quot; &#39;app&#39;")).toBe(
        "Vue & React <3 \"Web\" 'app'",
      );
      expect(decodeHtmlEntities("&#20013;&#25991;")).toBe("中文");
      expect(decodeHtmlEntities("&#x4e2d;&#x6587;")).toBe("中文");
    });
  });

  describe("extractHtmlMetadata", () => {
    it("prefers og:title over <title>", () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Old Title</title>
            <meta property="og:title" content="Awesome Open Graph Title &amp; More" />
            <link rel="icon" href="/favicon.png" />
          </head>
        </html>
      `;
      const meta = extractHtmlMetadata(html, "https://example.com/page");
      expect(meta.title).toBe("Awesome Open Graph Title & More");
      expect(meta.favicon).toBe("https://example.com/favicon.png");
    });

    it("extracts apple-touch-icon when available", () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Standard Title</title>
            <link rel="icon" href="/small.ico" />
            <link rel="apple-touch-icon" href="/touch-icon-180.png" />
          </head>
        </html>
      `;
      const meta = extractHtmlMetadata(html, "https://example.com/sub/dir");
      expect(meta.title).toBe("Standard Title");
      expect(meta.favicon).toBe("https://example.com/touch-icon-180.png");
    });

    it("extracts and validates data URI favicon", () => {
      const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="icon" href="${dataUri}" />
          </head>
        </html>
      `;
      const meta = extractHtmlMetadata(html, "https://example.com/");
      expect(meta.favicon).toBe(dataUri);
    });

    it("rejects malicious javascript: link favicon", () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <link rel="icon" href="javascript:alert(1)" />
          </head>
        </html>
      `;
      const meta = extractHtmlMetadata(html, "https://example.com/");
      expect(meta.favicon).toBe("https://example.com/favicon.ico");
    });

    it("falls back to /favicon.ico when no link tag is found", () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head><title>No Icon Page</title></head>
        </html>
      `;
      const meta = extractHtmlMetadata(html, "https://sub.domain.com/path/test");
      expect(meta.title).toBe("No Icon Page");
      expect(meta.favicon).toBe("https://sub.domain.com/favicon.ico");
    });
  });
});
