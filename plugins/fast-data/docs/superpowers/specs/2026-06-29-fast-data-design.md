# Fast Data ZTools Plugin Design

## Goal

Build a ZTools plugin feature named `快速处理数据` for quickly transforming pasted text data. The feature is triggered by `fast` or `快速处理数据`, opens with an empty input area, and lets users click operation buttons to immediately generate transformed output.

## Scope

### In Scope

- A single `fast` ZTools feature in the current Vue 3 + Vite project.
- Text-only transformations in the renderer process.
- Button-driven immediate processing based on the current input text.
- Output copy-to-clipboard flow.
- Reset behavior for all UI state.
- Build validation with the existing project command.

### Out of Scope

- Multi-step pipelines or saved presets.
- History, import/export, file processing, or preload Node.js services.
- Default clipboard population on open.
- Automatic plugin exit after copy.
- Regex-based replacement.

## Architecture

### Plugin Configuration

`public/plugin.json` should expose the main feature:

- `code`: `fast`
- `explain`: `快速处理数据`
- `cmds`: `fast`, `快速处理数据`

Template demo features can be removed from the active feature list to avoid confusing the plugin search results.

### Vue Entry

`src/App.vue` keeps the existing `window.ztools.onPluginEnter` routing pattern. It renders the new Fast component when `action.code === 'fast'`.

### Fast Component

`src/Fast/index.vue` owns:

- input text state
- output text state
- replacement fields
- prefix and suffix fields
- operation button handlers
- copy and reset actions
- user feedback through ZTools tips or browser fallback behavior

### Text Transformers

`src/Fast/transformers.ts` owns all pure text manipulation functions. The component calls these functions and does not embed transformation logic directly in the template handlers.

This keeps the transformation behavior easy to test, review, and extend.

## User Interface

The UI follows the provided screenshot structure:

1. Large input textarea at the top.
2. Operation groups in the middle:
   - 换行符: 删除, 增加, 转逗号, 去重
   - 逗号: 删除, 增加, 转换行
   - 引号: 删除, 加单, 加双
   - 去除: 两边空, 所有空, 注释
   - 转换: 小写, 大写
   - 替换: find input, replacement input, regex toggle
   - 两边拼: prefix input, `+ value +` label, suffix input
3. Output textarea below the operations.
4. Bottom action bar:
   - 重置设置
   - 处理数据

## Interaction Rules

- The plugin opens with empty input.
- Operation buttons process immediately.
- Every operation reads from the input textarea, not from the previous output.
- Operations write only to the output textarea.
- Input text is never overwritten automatically.
- Bottom `处理数据` copies the current output to the clipboard.
- Bottom `重置设置` clears input, output, replacement fields, prefix, and suffix.

## Transformation Rules

Line-based operations use non-empty input lines and preserve the first-seen order unless otherwise stated.

### 换行符

- 删除: remove all CRLF, LF, and CR characters.
- 增加: add a blank line between each non-empty line.
- 转逗号: convert non-empty lines to an English comma-separated string.
- 去重: deduplicate non-empty lines and keep the first occurrence.

### 逗号

- 删除: remove all English commas.
- 增加: append an English comma after each non-empty line.
- 转换行: split by English commas, trim each segment, skip empty segments, and output one segment per line.

### 引号

- 删除: remove English single quotes and double quotes.
- 加单: wrap each non-empty line as `'value'`.
- 加双: wrap each non-empty line as `"value"`.

### 去除

- 两边空: trim each line.
- 所有空: remove all whitespace characters, including spaces, tabs, and line breaks.
- 注释: remove full comment lines that start with `//`, `#`, or `--` after leading whitespace.

### 转换

- 小写: convert the whole input to lowercase.
- 大写: convert the whole input to uppercase.

### 替换

- If the find field is empty, do not transform and show a prompt.
- Replacement is plain string global replacement by default.
- When regex mode is enabled, replacement uses a global `RegExp`; `/pattern/flags` syntax is accepted and `g` is added automatically when omitted.

### 两边拼

- When either prefix or suffix is filled, output `prefix + value + suffix` for each non-empty line.

## Feedback and Error Handling

- Empty input plus operation button: clear output and show `请输入要处理的数据`.
- Empty find field means replacement is skipped.
- Invalid regex pattern clears output and shows regex error feedback on the find input.
- Empty output plus copy action: show `请先处理数据`.
- Copy success: show `已复制到剪贴板`.
- Copy failure: show `复制失败，请手动复制`.

Use `window.ztools.showNotification` when available. If unavailable during browser development, use a minimal fallback that does not crash. Copy output with `window.ztools.copyText` first, then browser clipboard fallbacks.

## Testing and Validation

- Keep transformations in pure functions so behavior can be verified independently.
- If a test framework already exists, add focused tests for transformer behavior.
- If no test framework exists, do not introduce one for this feature.
- Validate with `npm run build`.
- Manual smoke test:
  - run `npm run dev`
  - open the plugin with `fast`
  - paste multiline text
  - click representative buttons from each group
  - confirm output and copy behavior

## Implementation Notes

- Do not add preload services for this feature.
- Keep changes focused to plugin config, app routing, the new Fast component, and optional CSS.
- Preserve TypeScript strictness settings as configured by the project.
- Match the existing Vue single-file component style.
