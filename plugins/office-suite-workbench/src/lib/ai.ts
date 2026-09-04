import type { AiCancelResult, ApiResult, OfficeCliRunOutput, ZToolsAiOptions } from "../types";

const OFFICE_AI_OPERATIONS = [
  "add",
  "batch",
  "close",
  "create",
  "dump",
  "get",
  "help",
  "load_skill",
  "move",
  "query",
  "raw",
  "refresh",
  "remove",
  "save",
  "set",
  "swap",
  "validate",
  "view"
] as const;

const OFFICE_AI_OPERATION_SET = new Set<string>(OFFICE_AI_OPERATIONS);
const FILELESS_OPERATIONS = new Set(["help", "load_skill"]);
const OFFICE_AI_TOOL_BASE_NAME = "office_document";
export const AI_CANCEL_UNSETTLED_MESSAGE = "上一次 OfficeCLI 进程在 2.5 秒内未完全退出；已到等待上限，新请求可能与仍在退出的旧进程短暂重叠。";

export interface OfficeAiTurn {
  readonly generation: number;
  readonly token: symbol;
  readonly toolName: string;
}

interface OfficeAiTurnToolHandlerOptions {
  turn: OfficeAiTurn;
  getActiveTurn(): OfficeAiTurn | null;
  selectedFile: string;
  allowWrite: boolean;
  runForAi(
    command: string | string[],
    options: { allowWrite: boolean }
  ): Promise<ApiResult<OfficeCliRunOutput>>;
  onResult?(
    command: string | string[] | null,
    result: ApiResult<OfficeCliRunOutput>
  ): void;
}

const AI_TOOL_INACTIVE_ERROR = Object.freeze({
  code: "AI_TOOL_INACTIVE" as const,
  message: "The AI turn is no longer active; this OfficeCLI call was not started."
});

export function createOfficeAiTurn(sessionNonce: string, generation: number): OfficeAiTurn {
  const safeNonce = sessionNonce.replace(/[^A-Za-z0-9_]/gu, "").slice(0, 24);
  if (!safeNonce) throw new Error("An AI tool session nonce is required.");
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error("AI tool generation must be a positive safe integer.");
  }
  const toolName = `${OFFICE_AI_TOOL_BASE_NAME}_${safeNonce}_${generation}`;
  return Object.freeze({
    generation,
    token: Symbol(toolName),
    toolName
  });
}

export function normalizeAiCancelResult(value: unknown): AiCancelResult {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return { cancelled: value, settled: true };
  }
  if (value && typeof value === "object") {
    const result = value as Partial<AiCancelResult>;
    if (Number.isSafeInteger(result.cancelled) && Number(result.cancelled) >= 0 && typeof result.settled === "boolean") {
      return { cancelled: Number(result.cancelled), settled: result.settled };
    }
  }
  return { cancelled: 0, settled: false };
}

export function aiToolInactiveError(
  activeTurn: OfficeAiTurn | null | undefined,
  expectedTurn: OfficeAiTurn
): { code: "AI_TOOL_INACTIVE"; message: string } | null {
  return activeTurn?.token === expectedTurn.token ? null : AI_TOOL_INACTIVE_ERROR;
}

const OFFICE_AI_TOOL_FUNCTION = {
  description: "Run one safe OfficeCLI operation. For reading use operation=view with args=[\"text\"], args=[\"stats\"], args=[\"issues\",\"--json\"], or operation=get. Never use read as an operation. filePath must be absolute; omit it only to use the currently selected document.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      operation: {
        type: "string",
        enum: OFFICE_AI_OPERATIONS,
        description: "An exact OfficeCLI operation name. Use view, not read."
      },
      filePath: {
        type: "string",
        description: "Absolute .docx, .xlsx, or .pptx path. Omit to use the selected document."
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Arguments after the document path. Example for reading text: [\"text\"]."
      }
    },
    required: ["operation"]
  }
} as const;

export function officeAiToolForTurn(turn: OfficeAiTurn): NonNullable<ZToolsAiOptions["tools"]>[number] {
  return {
    type: "function",
    function: {
      name: turn.toolName,
      description: OFFICE_AI_TOOL_FUNCTION.description,
      parameters: OFFICE_AI_TOOL_FUNCTION.parameters
    }
  };
}

export const OFFICE_AI_TOOL = {
  type: "function" as const,
  function: {
    name: OFFICE_AI_TOOL_BASE_NAME,
    ...OFFICE_AI_TOOL_FUNCTION
  }
};

export function createOfficeAiTurnToolHandler({
  turn,
  getActiveTurn,
  selectedFile,
  allowWrite,
  runForAi,
  onResult
}: OfficeAiTurnToolHandlerOptions): (input: Record<string, unknown>) => Promise<unknown> {
  return async (input: Record<string, unknown>) => {
    const inactiveError = aiToolInactiveError(getActiveTurn(), turn);
    if (inactiveError) {
      return { ok: false, error: inactiveError } satisfies ApiResult<OfficeCliRunOutput>;
    }

    let command: string | string[];
    try {
      command = normalizeOfficeAiToolInput(input, selectedFile);
    } catch (error) {
      const failure: ApiResult<OfficeCliRunOutput> = {
        ok: false,
        error: {
          code: "AI_TOOL_INPUT_INVALID",
          message: error instanceof Error ? error.message : "Invalid office_document input."
        }
      };
      onResult?.(null, failure);
      return failure;
    }

    const result = await runForAi(command, { allowWrite });
    const staleError = aiToolInactiveError(getActiveTurn(), turn);
    if (staleError) {
      return { ok: false, error: staleError } satisfies ApiResult<OfficeCliRunOutput>;
    }
    onResult?.(command, result);
    if (!result.ok) return result;
    const { previewImages: _previewImages, ...safeOutput } = result.data;
    return { ok: true, ...safeOutput };
  };
}

function normalizedArgs(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new Error("office_document args must be an array of strings.");
  }
  return value.slice();
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\");
}

function normalizeLegacyCommand(value: unknown, selectedFile: string): string | string[] | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    if (!value.length || value.some(item => typeof item !== "string")) {
      throw new Error("office_document command must contain strings.");
    }
    const argv = value as string[];
    if (isAbsolutePath(argv[0])) return ["view", argv[0], ...(argv.slice(1).length ? argv.slice(1) : ["text"])];
    if (argv[0].toLowerCase() === "read") {
      const filePath = argv[1] && isAbsolutePath(argv[1]) ? argv[1] : selectedFile;
      if (!filePath) throw new Error("A selected document or absolute filePath is required for read.");
      return ["view", filePath, ...(argv.slice(filePath === argv[1] ? 2 : 1).length
        ? argv.slice(filePath === argv[1] ? 2 : 1)
        : ["text"])];
    }
    return argv.slice();
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("office_document command must be a non-empty string or argv array.");
  }
  const command = value.trim();
  if (isAbsolutePath(command)) return ["view", command, "text"];
  if (command.toLowerCase() === "read") {
    if (!selectedFile) throw new Error("A selected document or absolute filePath is required for read.");
    return ["view", selectedFile, "text"];
  }
  return command;
}

export function normalizeOfficeAiToolInput(
  input: Record<string, unknown>,
  selectedFile = ""
): string | string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("office_document input must be an object.");
  }

  const legacy = normalizeLegacyCommand(input.command, selectedFile);
  if (legacy) return legacy;

  const rawOperation = typeof input.operation === "string" ? input.operation.trim() : "";
  let operation = rawOperation.toLowerCase();
  let filePath = typeof input.filePath === "string" ? input.filePath.trim() : "";
  const args = normalizedArgs(input.args);

  if (isAbsolutePath(rawOperation)) {
    filePath = rawOperation;
    operation = "view";
    if (!args.length) args.push("text");
  }
  if (operation === "read") {
    operation = "view";
    if (!args.length) args.push("text");
  }
  if (!OFFICE_AI_OPERATION_SET.has(operation)) {
    throw new Error(`Unsupported office_document operation: ${operation || "(empty)"}. Use view to read a document.`);
  }
  if (FILELESS_OPERATIONS.has(operation)) return [operation, ...args];

  filePath ||= selectedFile;
  if (!filePath || !isAbsolutePath(filePath)) {
    throw new Error(`office_document ${operation} requires an absolute filePath or a selected document.`);
  }
  if (operation === "view" && !args.length) args.push("text");
  return [operation, filePath, ...args];
}
