import * as monaco from "monaco-editor";

export const Json5LanguageDef: monaco.languages.IMonarchLanguage = {
  defaultToken: "invalid",
  tokenPostfix: ".json5",

  // 转义字符
  escapes: /\\(?:[bfnrtv\\"\/]|u[0-9A-Fa-f]{4})/,

  // JSON5 支持的标记符号
  tokenizer: {
    root: [
      // 支持单行注释
      [/\/\/.*$/, "comment"],
      // 支持多行注释
      [/\/\*/, "comment", "@comment"],
      // 字符串
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/'([^'\\]|\\.)*$/, "string.invalid"], // JSON5 支持单引号
      [/"/, "string", "@string_double"],
      [/'/, "string", "@string_single"], // JSON5 支持单引号
      // 数字
      [/[+-]?\d+\.\d+([eE][+-]?\d+)?/, "number.float"],
      [/[+-]?\d+[eE][+-]?\d+/, "number.float"],
      [/[+-]?\d+/, "number"],
      [/[+-]?Infinity/, "number"], // JSON5 支持 Infinity
      [/NaN/, "number"], // JSON5 支持 NaN
      // 布尔值
      [/true|false/, "keyword"],
      [/null/, "keyword"],
      [/undefined/, "keyword"], // JSON5 支持 undefined
      // 对象
      [/[{}]/, "delimiter.bracket"],
      [/[[\]]/, "delimiter.square"],
      [/,/, "delimiter.comma"],
      [/:/, "delimiter.colon"],
      // JSON5 支持标识符作为键名
      [/[a-zA-Z_$][\w$]*/, "identifier"],
      // 空白
      [/\s+/, "white"],
    ],
    string_double: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, "string", "@pop"],
    ],
    string_single: [
      [/[^\\']+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/'/, "string", "@pop"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
  },
};
