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

export const OFFICE_AI_TOOL = {
  type: "function" as const,
  function: {
    name: "office_document",
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
  }
};

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
