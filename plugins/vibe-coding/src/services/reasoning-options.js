/**
 * 从模型支持列表中解析会话可使用的推理强度。
 * @param {unknown} value 会话保存或正在运行的推理强度。
 * @param {Record<string, unknown>|null} modelOption 当前模型选择条目。
 * @returns {string} 合法的会话推理强度；没有推理能力时返回空字符串。
 */
export function resolveSupportedReasoningEffort(value, modelOption) {
  if (!modelOption) return "";
  const supported = (modelOption.reasoning?.efforts || []).map(
    (effort) => effort.id,
  );
  const requested =
    String(value || "") === "none" ? "off" : String(value || "");
  if (supported.includes(requested)) return requested;

  // 自定义能力只允许宿主明确公开的档位，旧空值优先迁移到模型默认强度。
  const configuredDefault = modelOption.reasoning?.defaultEffort;
  if (supported.includes(configuredDefault)) return configuredDefault;
  return supported[0] || "";
}

/**
 * 将宿主公开的自定义推理档位转换为选择器选项。
 * @param {Record<string, unknown>|null|undefined} reasoning 模型的公开推理能力。
 * @param {Record<string, string>} labels 标准档位的本地化标签。
 * @returns {Array<{value: string, label: string}>} 仅包含宿主明确公开档位的选项。
 */
export function createReasoningEffortOptions(reasoning, labels) {
  return (reasoning?.efforts || []).map((effort) => ({
    value: effort.id,
    label: labels[effort.id] || effort.label || effort.id,
  }));
}
