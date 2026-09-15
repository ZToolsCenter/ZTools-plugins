/**
 * 将插件可选温度参数规范化为宿主可接受的数值。
 * @param {unknown} value 调用方传入的温度配置。
 * @returns {number|undefined} 显式有效数值；未配置或无效时返回 undefined。
 */
function normalizeOptionalTemperature(value) {
  // 空值表示沿用宿主和模型默认采样策略，不能擅自补充固定温度。
  if (value === undefined || value === null || value === "") return undefined;
  const temperature = Number(value);
  return Number.isFinite(temperature) ? temperature : undefined;
}

module.exports = { normalizeOptionalTemperature };
