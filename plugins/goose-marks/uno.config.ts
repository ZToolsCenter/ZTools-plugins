import { defineConfig, presetUno } from 'unocss'

/** 与 Tailwind v4 并存；新原子类优先用现有 g- token / Tailwind，Uno 作补充。 */
export default defineConfig({
  presets: [presetUno()],
})