import { HostAdapter } from "../../types/typora";

export function createHostAdapter(): HostAdapter {
  if (typeof window === "undefined") {
    return createMockHostAdapter("web");
  }

  // 1. Check for ATools (Rust / Tauri ecosystem)
  const isAtools = Boolean(
    window.atools ||
      window.__TAURI__ ||
      (window as unknown as { __ATOOLS_RUST_IPC__?: boolean }).__ATOOLS_RUST_IPC__
  );

  if (isAtools) {
    const atoolsApi = (window.atools || {}) as Record<string, unknown>;
    const tauriApi = window.__TAURI__ as
      | { core?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } }
      | undefined;

    return {
      platform: "atools",
      isAtools: true,
      hasAi: typeof atoolsApi.ai === "function" || Boolean(tauriApi?.core?.invoke),
      ai: (options, onChunk) => {
        const messages: Array<{ role: "system" | "user"; content: string }> = [];
        if (options.systemPrompt) {
          messages.push({ role: "system", content: options.systemPrompt });
        }
        messages.push({ role: "user", content: options.prompt });

        const aiPayload = {
          model: options.model || undefined,
          messages,
          prompt: options.prompt
        };

        if (typeof atoolsApi.ai === "function") {
          return (atoolsApi.ai as Function)(aiPayload, onChunk);
        }
        if (tauriApi?.core?.invoke) {
          let aborted = false;
          const promise = tauriApi.core
            .invoke("atools_ai_chat", aiPayload)
            .then((res) => {
              if (aborted) return "";
              const text =
                typeof res === "string"
                  ? res
                  : (res as { content?: string })?.content ?? String(res ?? "");
              onChunk?.(text);
              return text;
            }) as Promise<string> & { abort?: () => void };

          promise.abort = () => {
            aborted = true;
          };
          return promise;
        }
        return unavailableAi("ATools AI API is not available.");
      },
      allAiModels: async () => {
        if (typeof atoolsApi.allAiModels === "function") {
          const list = await (atoolsApi.allAiModels as Function)();
          return Array.isArray(list) ? list.map((item: any) => ({
            id: item.id || item.model || String(item),
            name: item.name || item.label || item.id || String(item),
            description: item.description || ""
          })) : [];
        }
        return [];
      },
      dbStorage: {
        getItem: (key: string) => {
          try {
            return localStorage.getItem(`atools_${key}`);
          } catch {
            return null;
          }
        },
        setItem: (key: string, value: string) => {
          try {
            localStorage.setItem(`atools_${key}`, value);
          } catch {
            // ignore
          }
        },
        removeItem: (key: string) => {
          try {
            localStorage.removeItem(`atools_${key}`);
          } catch {
            // ignore
          }
        }
      },
      rustBridge: {
        isAvailable: true,
        parseMarkdownAst: async (raw: string) => {
          if (tauriApi?.core?.invoke) {
            return tauriApi.core.invoke("atools_parse_markdown_ast", { raw });
          }
          return null;
        },
        computeMyersDiff: async (a: string, b: string) => {
          if (tauriApi?.core?.invoke) {
            return tauriApi.core.invoke("atools_myers_diff", { a, b });
          }
          return null;
        }
      }
    };
  }

  // 2. Check for ZTools (Electron ecosystem)
  const ztools = (window.ztools || {}) as Record<string, unknown>;
  const isZtools = Boolean(
    window.ztools &&
      (typeof ztools.setExpendHeight === "function" ||
        typeof ztools.ai === "function" ||
        typeof ztools.allAiModels === "function" ||
        typeof ztools.dbStorage === "object" ||
        typeof ztools.onPluginEnter === "function")
  );

  if (isZtools) {
    const rawStorage = (ztools.dbStorage || {}) as {
      getItem?: (k: string) => string | null;
      setItem?: (k: string, v: string) => void;
      removeItem?: (k: string) => void;
    };

    return {
      platform: "ztools",
      isAtools: false,
      hasAi: typeof ztools.ai === "function",
      ai: (options, onChunk) => {
        if (typeof ztools.ai === "function") {
          // ZTools requires options.messages to be an iterable array of chat messages!
          const messages: Array<{ role: "system" | "user"; content: string }> = [];
          if (options.systemPrompt) {
            messages.push({ role: "system", content: options.systemPrompt });
          }
          messages.push({ role: "user", content: options.prompt });

          const aiPayload = {
            model: options.model || undefined,
            messages,
            prompt: options.prompt
          };

          let fullText = "";
          let hostPromise: any = null;

          try {
            hostPromise = (ztools.ai as Function)(aiPayload, (chunk: unknown) => {
              const delta =
                typeof chunk === "string"
                  ? chunk
                  : ((chunk as { content?: string; delta?: string })?.content ??
                     (chunk as { content?: string; delta?: string })?.delta ??
                     "");
              if (delta) {
                fullText += delta;
                onChunk?.(delta);
              }
            });
          } catch (invokeErr) {
            return Promise.reject(invokeErr) as Promise<string> & { abort?: () => void };
          }

          const wrappedPromise = Promise.resolve(hostPromise).then((res: unknown) => {
            if (typeof res === "string" && res.trim()) return res;
            if (fullText.trim()) return fullText;
            if (res && typeof res === "object") {
              const content =
                (res as { content?: string; text?: string }).content ??
                (res as { content?: string; text?: string }).text;
              if (content) return content;
            }
            return fullText || (typeof res === "string" ? res : JSON.stringify(res));
          }) as Promise<string> & { abort?: () => void };

          wrappedPromise.abort = () => {
            if (hostPromise && typeof hostPromise.abort === "function") {
              hostPromise.abort();
            }
          };

          return wrappedPromise;
        }
        return unavailableAi("ZTools AI API is not available.");
      },
      redirectAiModelsSetting: () => {
        if (typeof (ztools as any).redirectAiModelsSetting === "function") {
          (ztools as any).redirectAiModelsSetting();
        }
      },
      allAiModels: async () => {
        if (typeof ztools.allAiModels === "function") {
          try {
            const list = await (ztools.allAiModels as Function)();
            if (Array.isArray(list) && list.length > 0) {
              return list.map((item: any) => ({
                id: item.id || item.model || String(item),
                name: item.name || item.label || item.id || "未命名模型",
                description: item.description || ""
              }));
            }
          } catch {
            // ignore
          }
        }
        return [];
      },
      dbStorage: {
        getItem: (key: string) => {
          if (typeof rawStorage.getItem === "function") {
            return rawStorage.getItem(key);
          }
          try {
            return localStorage.getItem(key);
          } catch {
            return null;
          }
        },
        setItem: (key: string, value: string) => {
          if (typeof rawStorage.setItem === "function") {
            rawStorage.setItem(key, value);
            return;
          }
          try {
            localStorage.setItem(key, value);
          } catch {
            // ignore
          }
        },
        removeItem: (key: string) => {
          if (typeof rawStorage.removeItem === "function") {
            rawStorage.removeItem(key);
            return;
          }
          try {
            localStorage.removeItem(key);
          } catch {
            // ignore
          }
        }
      },
      rustBridge: {
        isAvailable: false
      }
    };
  }

  // 3. Fallback Web / Mock environment
  return createMockHostAdapter("web");
}

function createMockHostAdapter(platform: "web"): HostAdapter {
  return {
    platform,
    isAtools: false,
    hasAi: false,
    ai: () => unavailableAi("No AI provider is available in this environment."),
    allAiModels: async () => [],
    dbStorage: {
      getItem: (key: string) => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key: string, value: string) => {
        try {
          localStorage.setItem(key, value);
        } catch {}
      },
      removeItem: (key: string) => {
        try {
          localStorage.removeItem(key);
        } catch {}
      }
    },
    rustBridge: {
      isAvailable: false
    }
  };
}

function unavailableAi(message: string): Promise<string> & { abort?: () => void } {
  const request = Promise.reject(new Error(message)) as Promise<string> & { abort?: () => void };
  request.abort = () => undefined;
  return request;
}
