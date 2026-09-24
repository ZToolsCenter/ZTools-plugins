/**
 * BlackHole —— 《星际穿越》Gargantua 风格黑洞渲染组件
 * ==========================================================================
 * 零依赖、可移植单文件组件。只 import react，复制这一个文件到任意 React 项目即可用。
 *
 * 渲染技术：原生 WebGL1，全屏三角形 + GLSL fragment shader，
 * 史瓦西度规近似光线步进（geodesic ray marching）。
 *
 * 使用示例：
 * ```tsx
 * // 作为深色背景彩蛋（铺满父容器，pointer-events 不干扰上层交互）
 * <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
 *   <BlackHole brightness={0.7} interactive />
 *   <YourContent style={{ position: 'relative', zIndex: 1 }} />
 * </div>
 *
 * // 嵌入卡片
 * <BlackHole
 *   style={{ borderRadius: 16 }}
 *   resolutionScale={0.5}
 *   speed={0.8}
 *   paused={!isVisible}
 * />
 * ```
 *
 * @prop className     - 透传给最外层 div 的 className
 * @prop style         - 透传给最外层 div 的 inline style（与内置 style 合并）
 * @prop resolutionScale - 内部渲染分辨率缩放比，默认 1（满物理分辨率）。
 *                       >1 时为 SSAA 超采样（如 1.5 ≈ 2.25 倍像素量，浏览器下采样
 *                       滤波可消除 shader 单采样的高频纹理混叠锯齿）；
 *                       低性能设备可降到 0.5~0.7 换性能，代价是 CSS 放大锯齿
 * @prop speed         - 吸积盘旋转速度倍率，默认 1
 * @prop brightness    - 整体亮度 0~2，默认 1；作背景时可调低（0.6~0.8）避免喧宾夺主
 * @prop interactive   - 开启后鼠标位置对相机做 ±0.15 rad 缓动倾斜，默认 false
 * @prop paused        - 暂停渲染循环（保留最后一帧），默认 false
 * @prop maxFps        - 渲染帧率上限。不传则跟随画质档位（low30/medium45/high60）。
 *                       传入则覆盖档位值；0 = 不限帧（跟随显示器刷新率）
 * @prop quality       - 画质档位，默认 'auto'：探测设备性能定初判档 + 运行时实测
 *                       帧率兜底降档（办公电脑/核显自动降到流畅档）。也可强制
 *                       'low'|'medium'|'high'，强制时不再自动降档。
 *                       注：resolutionScale/maxFps 不传时由档位决定；传入则覆盖。
 */

import { useEffect, useRef, CSSProperties } from 'react'

// ─── 类型 ────────────────────────────────────────────────────────────────────

export interface BlackHoleProps {
  className?: string
  style?: CSSProperties
  /** 内部渲染分辨率缩放 0.25~1，默认 0.6 */
  resolutionScale?: number
  /** 动画速度倍率，默认 1 */
  speed?: number
  /** 整体亮度 0~2，默认 1 */
  brightness?: number
  /** 鼠标视差微倾斜，默认 false */
  interactive?: boolean
  /** 暂停渲染 */
  paused?: boolean
  /** 帧率上限，默认 30；0 = 不限帧 */
  maxFps?: number
  /**
   * 画质档位。默认 'auto'：自动探测设备性能定档 + 运行时实测帧率兜底降档。
   * 也可强制指定 'low' | 'medium' | 'high'（用户在设置里手动选档时用）。
   * 指定固定档位时不再自动降档。
   */
  quality?: QualityTier | 'auto'
}

// ─── Shader 源码 ──────────────────────────────────────────────────────────────

const VERT_SRC = /* glsl */ `
  attribute vec2 a_pos;
  void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`

/**
 * Fragment shader：史瓦西度规光线步进
 *
 * 物理近似说明：
 *  - 测地线用经典 Shadertoy 近似（非完整 GR）：
 *    加速度 a = -1.5 * h² * p / |p|^5，其中 h = p × v（角动量守恒项）
 *  - 步长自适应：靠近黑洞时缩短，远离时放大，平衡精度与性能
 *  - 吸积盘：平面 y=0 上环形区域，多普勒增亮是视觉关键
 *  - 星空：逃逸光线用 hash 函数生成伪随机星点，被透镜效应自然扭曲
 */
const FRAG_SRC_BODY = /* glsl */ `
  precision highp float;

  uniform vec2  u_resolution;
  uniform float u_time;
  uniform float u_speed;
  uniform float u_brightness;
  uniform vec2  u_mouse;   // 归一化 [-1,1]，interactive 时生效

  // ── 工具函数 ──────────────────────────────────────────────────────────────

  // 低成本 hash：伪随机标量
  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // 分形布朗运动噪声（用于吸积盘纹理）
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash2(i),               hash2(i + vec2(1,0)), u.x),
      mix(hash2(i + vec2(0,1)),   hash2(i + vec2(1,1)), u.x),
      u.y
    );
  }

  // 2 层 fbm：模拟气体流丝
  float fbm(vec2 p) {
    float v = 0.0;
    v += 0.55 * noise(p);
    v += 0.30 * noise(p * 2.1 + vec2(5.7, 3.2));
    v += 0.15 * noise(p * 4.3 + vec2(2.1, 8.4));
    return v;
  }

  // ACES 近似 tone mapping（Krzysztof Narkowicz 版本）
  vec3 aces(vec3 x) {
    float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
  }

  // ── 主渲染 ────────────────────────────────────────────────────────────────

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    // 相机设置：位于 (0,1,-8.5) 朝向原点，FOV ≈ 1.2 rad
    // interactive 时鼠标偏移驱动相机做微倾（缓动在 JS 侧，这里直接用 u_mouse）
    float pitch = u_mouse.y * 0.15;
    float yaw   = u_mouse.x * 0.15;

    vec3 ro = vec3(0.0, 1.0 + pitch * 2.0, -8.5);   // 相机原点（ray origin）

    // 构建相机矩阵：前方向 w，右方向 u，上方向 v
    vec3 ta = vec3(0.0);                              // 注视点
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(0,1,0)));
    vec3 vv = cross(uu, ww);

    // 应用偏航（yaw）旋转
    uu = cos(yaw)*uu + sin(yaw)*ww;
    ww = normalize(cross(vv, uu));

    // 初始光线方向（FOV ≈ 1.2）
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 0.84 * ww);

    // ── 光线步进：史瓦西度规测地线近似 ─────────────────────────────────────
    vec3 p  = ro;           // 光子当前位置
    vec3 v  = rd;           // 光子当前方向（速度）

    // 角动量守恒量 h = |p × v|²（决定光线弯曲强度）
    float h2 = dot(cross(p, v), cross(p, v));

    // 累积颜色：吸积盘贡献
    vec3  accum    = vec3(0.0);
    float transmit = 1.0;   // 透射率（多层穿越盘面时衰减）

    float prevY = p.y;      // 上一步 y 坐标，用于检测穿越盘面

    // 步进循环（最多 64 步：步数与下方 dt 配套，覆盖到 r≈30 逃逸边界；
    // 更多步数在 ANGLE/Metal 上有编译时间与单帧 GPU 超时风险）
    for (int i = 0; i < STEPS; i++) {
      float dist2 = dot(p, p);
      float dist  = sqrt(dist2);

      // ── 事件视界（史瓦西半径 = 1）──────────────────────────────────────
      if (dist < 1.0) {
        // 击中黑洞：停止，accum 不再增加（最终呈纯黑）
        transmit = 0.0;
        break;
      }

      // ── 逃逸判断 ──────────────────────────────────────────────────────
      if (dist > 30.0) break;

      // 自适应步长：靠近时小步（精度），远离时大步（性能）
      float dt = (0.18 + 0.08 * max(0.0, dist - 3.0)) * DT_SCALE;

      // ── 测地线积分：a = -1.5 * h² * p / |p|^5 ────────────────────────
      // 物理意义：史瓦西度规下光子轨道的引力加速度（角动量修正项）
      vec3 a = -1.5 * h2 * p / pow(dist2, 2.5);
      v += a * dt;
      p += v * dt;

      // ── 吸积盘采样：检测是否穿越 y=0 盘面 ───────────────────────────
      // 物理意义：吸积盘位于黑道赤道面（xz 平面），内缘 r≈1.6，外缘 r≈7.5
      float currY = p.y;
      if (prevY * currY < 0.0 && transmit > 0.01) {
        // 线性插值出交点位置
        float t = prevY / (prevY - currY);
        vec3 hit = mix(p - v * dt, p, t);   // 近似交点
        float r = length(hit.xz);

        if (r > 1.6 && r < 7.5) {
          // 差速旋转（开普勒：角速度 ∝ r^(-3/2)，内圈转快）。
          // 注意：直接累积 u_time 会让相位随时间无限缠绕，纹理径向频率线性
          // 增长，跑得越久螺旋条纹越细 → 必然超过采样率产生混叠锯齿。
          // 用 flow-cycling 限制缠绕：两套相位各自在周期 T 内回绕，按三角权重
          // 交叉淡化，缠绕量有上界，细节密度恒定且视觉连续。
          float baseAng = atan(hit.z, hit.x);
          float omega   = u_speed * 5.5 / pow(r, 1.5);
          float T  = 8.0;
          float t1 = mod(u_time, T);
          float t2 = mod(u_time + 0.5 * T, T);
          float w2 = abs(t1 / T * 2.0 - 1.0);   // t1 临近回绕点时权重切到 t2

          // 径向归一化坐标 [0,1]
          float rn   = (r - 1.6) / (7.5 - 1.6);

          // fbm 噪声产生气体流丝纹理（两套相位采样后混合）
          float ang1 = baseAng + t1 * omega;
          float ang2 = baseAng + t2 * omega;
          float tex1 = fbm(vec2(ang1 * 3.5, rn * 3.2 + hash(floor(ang1 * 0.5)) * 0.3));
          float tex2 = fbm(vec2(ang2 * 3.5, rn * 3.2 + hash(floor(ang2 * 0.5)) * 0.3));
          float tex  = mix(tex1, tex2, w2);
          tex = tex * tex;   // 提高对比度，让条纹更清晰

          // ── 颜色温度梯度 ─────────────────────────────────────────────
          // 内缘白热（黑体辐射峰），中段金橙，外缘暗红冷却
          vec3 colInner = vec3(1.00, 0.95, 0.85);   // 内缘：接近白热
          vec3 colMid   = vec3(1.00, 0.62, 0.22);   // 中段：金黄橙
          vec3 colOuter = vec3(0.45, 0.12, 0.02);   // 外缘：暗橙红

          // 亮度随半径幂次衰减（内圈能量密度更高）
          float radFade  = pow(1.0 - rn, 2.2) * 3.5 + 0.2;
          vec3 diskColor = mix(mix(colInner, colMid, smoothstep(0.0, 0.4, rn)),
                               colOuter, smoothstep(0.3, 1.0, rn));
          diskColor *= radFade * (0.6 + 1.4 * tex);

          // ── 多普勒增亮（Doppler beaming）────────────────────────────
          // 物理意义：靠近观察者的一侧辐射压缩（蓝移增亮），
          //           远离观察者的一侧辐射拉伸（红移变暗）
          // tangent：盘物质切向速度方向（逆时针绕 y 轴公转）
          vec3 tangent    = normalize(cross(vec3(0,1,0), hit));
          float dopplerFac = pow(max(0.0, 1.0 + 0.75 * dot(tangent, normalize(v))), 3.0);
          diskColor *= dopplerFac;

          // 内外缘 smoothstep 渐隐：r 边界的二值硬切在掠射视角下被压缩成
          // 屏幕上的高频硬边，是轮廓阶梯锯齿的主源；渐隐后边缘亚像素平滑
          float edgeFade = smoothstep(1.6, 1.95, r) * (1.0 - smoothstep(6.7, 7.5, r));

          // 半透明叠加（多次穿越盘面逐层衰减，形成上下两道光弧）
          float alpha   = min(1.0, 0.65 * tex + 0.1) * edgeFade;
          accum        += transmit * diskColor * alpha;
          transmit     *= (1.0 - alpha * 0.55);
        }
      }

      prevY = currY;

      if (transmit < 0.01) break;
    }

    // ── 背景：星空（光线逃逸后）──────────────────────────────────────────
    // 物理意义：逃逸光线的最终方向被引力透镜扭曲，星空图案会变形
    // 实现：O(1) 网格 hash 星空，避免逐帧循环对弱 GPU 的压力。
    // 将逃逸方向映射为球面经纬 uv，乘密度后 floor 取 cell，
    // hash(cell) 决定该 cell 是否有星/亮度/颜色，fract 算到星心距离点亮。
    // 动画层保持深空黑（不把 #262624 画进 shader，避免整屏发灰）；
    // 纯色 #262624 只做 canvas 下方的 CSS 底层。
    vec3 skyColor = vec3(0.0);

    float lenP = length(p);
    if (lenP > 1.0 && transmit > 0.01) {
      vec3 dir = normalize(v);   // 逃逸方向（已被透镜扭曲）

      // 球面经纬映射：dir → uv（连续、无奇点在赤道）
      float phi   = atan(dir.z, dir.x);              // 经度 [-π, π]
      float theta = asin(clamp(dir.y, -1.0, 1.0));   // 纬度 [-π/2, π/2]
      vec2 skyUV  = vec2(phi / 6.28318, theta / 3.14159) + 0.5;  // [0,1]

      // 极淡银河带：沿赤道方向的漫散射（仍 O(1)）
      float galactic = exp(-abs(dir.y) * 4.0) * 0.03;
      skyColor += vec3(0.12, 0.14, 0.20) * galactic;

      // ── 稀疏亮星层（低密度，明显星点）───────────────────────────────
      // density 控制平均每格出现率；cell + fract 一起做 O(1) 点状采样
      float density1 = 55.0;
      vec2  cell1    = floor(skyUV * density1);
      vec2  frac1    = fract(skyUV * density1) - 0.5;  // 格内偏移，中心为0
      float rng1     = hash2(cell1);
      if (rng1 > 0.92) {  // ~8% 的格有星
        // 星心在格内随机偏移，避免规则网格感
        vec2  offset1 = vec2(hash2(cell1 + 13.7), hash2(cell1 + 27.3)) - 0.5;
        float d1      = length(frac1 - offset1 * 0.6);
        float mag1    = hash2(cell1 + 5.1) * 0.7 + 0.3;
        float bright1 = smoothstep(0.08, 0.0, d1) * mag1;
        // 星色：蓝白为主，少量偏橙
        vec3  starC1  = mix(vec3(0.80, 0.90, 1.00), vec3(1.00, 0.85, 0.60),
                            hash2(cell1 + 99.9));
        skyColor += starC1 * bright1 * 2.0;
      }

      // ── 密集暗星层（高密度，细小星点）───────────────────────────────
      float density2 = 180.0;
      vec2  cell2    = floor(skyUV * density2);
      vec2  frac2    = fract(skyUV * density2) - 0.5;
      float rng2     = hash2(cell2 + 200.0);
      if (rng2 > 0.82) {  // ~18% 的格有星
        vec2  offset2 = vec2(hash2(cell2 + 44.1), hash2(cell2 + 88.5)) - 0.5;
        float d2      = length(frac2 - offset2 * 0.5);
        float mag2    = hash2(cell2 + 33.3) * 0.35 + 0.1;
        float bright2 = smoothstep(0.05, 0.0, d2) * mag2;
        skyColor += vec3(0.82, 0.88, 1.00) * bright2 * 0.9;
      }

      skyColor *= transmit;
    }

    // ── 合成 + 后处理 ─────────────────────────────────────────────────────
    vec3 color = accum + skyColor;

    // 中心辉光：基于吸积盘累积亮度的软压缩（无需多 pass）
    float lumAccum = dot(accum, vec3(0.299, 0.587, 0.114));
    color += accum * smoothstep(0.0, 1.5, lumAccum) * 0.25;

    // ACES tone mapping
    color = aces(color);

    // 整体亮度调节
    color *= u_brightness;

    // 暗角（vignette）：边缘轻压暗，让黑洞居中更突出
    float vignette = 1.0 - 0.38 * dot(uv, uv);
    color *= vignette;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`

/**
 * 拼接 fragment 源码：在 body 前注入档位相关宏。
 * GLSL ES 1.0 的 for 循环上限必须是编译期常量，无法用 uniform 动态控制，
 * 因此步数（STEPS）只能靠宏注入、按档位重新编译 program。
 * 步数减半时步长（DT_SCALE）需放大以仍能覆盖到 r≈30 逃逸边界。
 */
function buildFragSrc(steps: number, dtScale: number): string {
  return `#define STEPS ${steps}\n#define DT_SCALE ${dtScale.toFixed(3)}\n${FRAG_SRC_BODY}`
}

// ─── 性能分档 ────────────────────────────────────────────────────────────────

/** 画质档位：流畅 / 均衡 / 精细 */
export type QualityTier = 'low' | 'medium' | 'high'

interface TierParams {
  steps: number          // ray marching 步数（编译期常量）
  dtScale: number        // 步长缩放（步数越少越大）
  resolutionScale: number
  maxFps: number
}

const TIER_TABLE: Record<QualityTier, TierParams> = {
  low:    { steps: 32, dtScale: 2.0, resolutionScale: 0.5, maxFps: 30 },
  medium: { steps: 48, dtScale: 1.35, resolutionScale: 0.7, maxFps: 45 },
  high:   { steps: 64, dtScale: 1.0, resolutionScale: 1.0, maxFps: 60 },
}

const TIER_ORDER: QualityTier[] = ['high', 'medium', 'low']

/**
 * 设备性能探测：综合 CPU 核数、内存、GPU renderer 字符串静态定档。
 * 这是「初判」——软渲染/核显/低核数 → low；明确高端独显 → high；其余 medium。
 * 真正兜底靠运行时实测帧率（见组件内 FPS 监控），探测误判也能被纠正。
 */
function detectTier(gl: WebGLRenderingContext): QualityTier {
  // GPU renderer 字符串（需 WEBGL_debug_renderer_info 扩展）
  let renderer = ''
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '').toLowerCase()
  } catch {
    // 某些隐私设置下扩展被屏蔽，忽略
  }

  // 软渲染 / 明确的弱 GPU → 直接最低档
  const isSoftware = /swiftshader|software|llvmpipe|microsoft basic|angle \(google/.test(renderer)
  if (isSoftware) return 'low'

  // 明确的高端独显标识 → 最高档
  const isHighEnd = /rtx|radeon rx|geforce (gtx|rtx)|apple m[1-9]|nvidia/.test(renderer)

  const cores = navigator.hardwareConcurrency ?? 4
  // deviceMemory 非标准但 Chrome 支持，单位 GB
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4

  if (isHighEnd && cores >= 8) return 'high'

  // Intel 核显（办公电脑主力）/ 低核数 / 低内存 → 流畅档
  const isIntegrated = /intel|uhd|hd graphics|iris/.test(renderer)
  if (isIntegrated || cores <= 4 || mem <= 4) return 'low'

  return 'medium'
}

// ─── WebGL 辅助工具（内联，零依赖）──────────────────────────────────────────

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[BlackHole] Shader compile error:', gl.getShaderInfoLog(s))
    gl.deleteShader(s)
    return null
  }
  return s
}

function createProgram(gl: WebGLRenderingContext, steps: number, dtScale: number): WebGLProgram | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, buildFragSrc(steps, dtScale))
  if (!vert || !frag) return null

  const prog = gl.createProgram()
  if (!prog) return null

  gl.attachShader(prog, vert)
  gl.attachShader(prog, frag)
  gl.linkProgram(prog)

  // shader 链接后可以删除中间对象
  gl.deleteShader(vert)
  gl.deleteShader(frag)

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[BlackHole] Program link error:', gl.getProgramInfoLog(prog))
    gl.deleteProgram(prog)
    return null
  }
  return prog
}

// ─── 组件实现 ────────────────────────────────────────────────────────────────

export function BlackHole({
  className,
  style,
  resolutionScale,
  speed = 1,
  brightness = 1,
  interactive = false,
  paused = false,
  maxFps,
  quality = 'auto',
}: BlackHoleProps) {
  const wrapRef    = useRef<HTMLDivElement>(null)

  // 存 rAF id 及鼠标目标值（缓动用）
  const rafRef     = useRef<number>(0)
  const mouseRef   = useRef({ tx: 0, ty: 0, cx: 0, cy: 0 }) // target / current

  // 把频繁变化的 prop 存 ref，避免 effect 重新注册
  const propsRef   = useRef({ resolutionScale, speed, brightness, interactive, paused, maxFps, quality })
  propsRef.current = { resolutionScale, speed, brightness, interactive, paused, maxFps, quality }

  // paused 恢复时通过 kickRef.current() 踢一帧续上 rAF 循环
  const kickRef    = useRef<(() => void) | null>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    // canvas 由 effect 动态创建而非 JSX 渲染：cleanup 会调 loseContext() 释放 GPU
    // 资源，被 lose 过的 canvas 无法可靠拿回可用 context（Chrome 上 restoreContext
    // 时序不可靠）。React StrictMode（dev）会双跑 effect 并复用同一 DOM 节点，
    // 每次 setup 新建 canvas 才能保证拿到全新 context。
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'display:block;width:100%;height:100%'
    wrap.appendChild(canvas)

    // ── 获取 WebGL 上下文 ────────────────────────────────────────────────
    let gl: WebGLRenderingContext | null = null
    try {
      gl = canvas.getContext('webgl', { antialias: false, alpha: false }) ??
           canvas.getContext('experimental-webgl', { antialias: false, alpha: false }) as WebGLRenderingContext | null
    } catch {
      // ignore
    }

    // WebGL 不可用：静默降级为纯色底（与星空彩蛋一致）
    if (!gl) {
      canvas.style.background = '#262624'
      return () => { canvas.remove() }
    }

    const glCtx = gl  // 局部别名，帮助 TS narrow

    // ── 画质分档：auto 时探测设备定初判档，否则用强制档 ──────────────────
    const qualityProp = propsRef.current.quality
    const autoTier = qualityProp === 'auto'
    let tier: QualityTier = autoTier ? detectTier(glCtx) : qualityProp
    let tierParams = TIER_TABLE[tier]

    // ── 构建 GL 资源 ─────────────────────────────────────────────────────
    let prog     = createProgram(glCtx, tierParams.steps, tierParams.dtScale)
    let buf      = glCtx.createBuffer()
    let isLost   = false

    const setupGeom = () => {
      if (!prog || !buf) return
      // 全屏三角形（两个三角形组成一个全屏 quad）
      glCtx.bindBuffer(glCtx.ARRAY_BUFFER, buf)
      glCtx.bufferData(
        glCtx.ARRAY_BUFFER,
        new Float32Array([-1, -1,  3, -1, -1,  3]),
        glCtx.STATIC_DRAW
      )
    }
    setupGeom()

    // ── uniform 位置缓存 ─────────────────────────────────────────────────
    const getUniform = (name: string) =>
      prog ? glCtx.getUniformLocation(prog, name) : null

    // ── resize：用 ResizeObserver 监听容器尺寸 ──────────────────────────
    let canvasW = 1, canvasH = 1

    const setSize = (w: number, h: number) => {
      // 分辨率缩放：显式 prop 优先，否则用当前档位值（运行时降档会更新 tierParams）
      const rs = propsRef.current.resolutionScale ?? tierParams.resolutionScale
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
      canvasW     = Math.max(1, Math.round(w * dpr * rs))
      canvasH     = Math.max(1, Math.round(h * dpr * rs))
      canvas.width  = canvasW
      canvas.height = canvasH
      glCtx.viewport(0, 0, canvasW, canvasH)
      // 问题 4 修复：reducedMotion / paused 静止时 resize 后补渲一帧，避免画面拉伸
      // kickRef 在 render 定义后赋值，通过间接引用规避 TDZ；
      // rafRef.current === 0 表示当前没有活跃循环（render 结束后会置 0）
      if (rafRef.current === 0) {
        kickRef.current?.()
      }
    }

    const ro = new ResizeObserver((entries) => {
      const e = entries[0]
      if (!e) return
      setSize(e.contentRect.width, e.contentRect.height)
    })
    ro.observe(wrap)
    setSize(wrap.clientWidth || 1, wrap.clientHeight || 1)

    // ── prefers-reduced-motion ───────────────────────────────────────────
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // ── 运行时帧率兜底降档 ───────────────────────────────────────────────
    // 静态探测可能误判（同样标 Intel 的核显性能跨度很大），实测最可靠。
    // 仅 auto 模式生效：采样一段窗口的平均帧率，连续过低则降一档并重建。
    // 重建需重新编译 shader（步数是编译期常量），代价不小，故只降不升、有冷却。
    let fpsAccumTime = 0       // 采样窗口累计时长（ms）
    let fpsAccumFrames = 0     // 采样窗口累计帧数
    let prevTs = 0             // 上一帧时间戳（算 delta）
    let cooldownUntil = 0      // 降档冷却截止时间戳（避免重建后立刻又判降）
    const SAMPLE_WINDOW = 2000 // 每 2s 评估一次

    const rebuildForTier = (next: QualityTier) => {
      tier = next
      tierParams = TIER_TABLE[next]
      // 重新编译 program（步数变化）
      if (prog) glCtx.deleteProgram(prog)
      prog = createProgram(glCtx, tierParams.steps, tierParams.dtScale)
      // 重设画布尺寸（分辨率缩放变化），setSize 内部会补渲一帧
      setSize(wrap.clientWidth || 1, wrap.clientHeight || 1)
    }

    const sampleFps = (now: number) => {
      // 仅 auto 模式且能继续降档时才采样
      if (!autoTier) return
      const idx = TIER_ORDER.indexOf(tier)
      if (idx >= TIER_ORDER.length - 1) return  // 已是最低档
      if (now < cooldownUntil) { prevTs = now; return }

      if (prevTs > 0) {
        const dt = now - prevTs
        // 跳过异常大间隔（切后台/断点导致），不计入采样
        if (dt > 0 && dt < 500) {
          fpsAccumTime += dt
          fpsAccumFrames += 1
        }
      }
      prevTs = now

      if (fpsAccumTime >= SAMPLE_WINDOW && fpsAccumFrames > 0) {
        const avgFps = (fpsAccumFrames * 1000) / fpsAccumTime
        // 目标帧率取当前档上限；实测低于其 75% 视为吃力 → 降档
        const target = tierParams.maxFps
        if (avgFps < target * 0.75) {
          rebuildForTier(TIER_ORDER[idx + 1])
          cooldownUntil = now + 3000
        }
        fpsAccumTime = 0
        fpsAccumFrames = 0
      }
    }

    // ── 渲染帧 ───────────────────────────────────────────────────────────
    const startTime = performance.now()
    let lastFrameAt = 0   // 上一次真正绘制的 rAF 时间戳（限帧用）

    const render = (now?: number) => {
      if (isLost || !prog || !buf) {
        return
      }
      const { speed: sp, brightness: br, interactive: iact, paused: ps } = propsRef.current
      // 帧率上限：显式 prop 优先，否则用当前档位值
      const fps = propsRef.current.maxFps ?? tierParams.maxFps

      // 限帧节流：仅对 rAF 驱动的连续帧生效（now 为 rAF 时间戳），
      // 手动踢帧（无参调用，如首帧/resize 补渲）总是立即绘制。
      // -1ms 容差吸收 60Hz 下 16.7ms 的整数倍边界抖动
      if (now !== undefined && fps > 0) {
        if (now - lastFrameAt < 1000 / fps - 1) {
          // 间隔未到：跳过绘制但维持循环（停帧条件与帧尾一致）
          if (!ps && !reducedMotion && !document.hidden) {
            rafRef.current = requestAnimationFrame(render)
          } else {
            rafRef.current = 0
          }
          return
        }
        lastFrameAt = now
      }

      // 鼠标缓动（lerp 系数 0.06 ≈ ~10帧平滑）
      const m = mouseRef.current
      if (iact) {
        m.cx += (m.tx - m.cx) * 0.06
        m.cy += (m.ty - m.cy) * 0.06
      } else {
        m.cx += (0 - m.cx) * 0.06
        m.cy += (0 - m.cy) * 0.06
      }

      const t = (performance.now() - startTime) / 1000

      glCtx.useProgram(prog)
      glCtx.bindBuffer(glCtx.ARRAY_BUFFER, buf)

      const aPos = glCtx.getAttribLocation(prog, 'a_pos')
      glCtx.enableVertexAttribArray(aPos)
      glCtx.vertexAttribPointer(aPos, 2, glCtx.FLOAT, false, 0, 0)

      const uRes   = getUniform('u_resolution')
      const uTime  = getUniform('u_time')
      const uSpeed = getUniform('u_speed')
      const uBr    = getUniform('u_brightness')
      const uMouse = getUniform('u_mouse')

      if (uRes)   glCtx.uniform2f(uRes,   canvasW, canvasH)
      if (uTime)  glCtx.uniform1f(uTime,  t)
      if (uSpeed) glCtx.uniform1f(uSpeed, sp)
      if (uBr)    glCtx.uniform1f(uBr,    br)
      if (uMouse) glCtx.uniform2f(uMouse, m.cx, m.cy)

      glCtx.drawArrays(glCtx.TRIANGLES, 0, 3)
      // 运行时帧率采样（仅 rAF 连续帧；手动踢帧 now 为 undefined 不计入）
      if (now !== undefined) sampleFps(now)

      if (!ps && !reducedMotion && !document.hidden) {
        rafRef.current = requestAnimationFrame(render)
      } else {
        // 循环停止：置 0 让 setSize 的静止补渲检测可以工作
        rafRef.current = 0
      }
    }

    // 问题 1 修复：paused 恢复时通过 kickRef 踢一帧续循环
    // render 定义后立即赋值，确保 setSize 的间接调用也能拿到
    kickRef.current = () => {
      // 确认 propsRef 已更新（由 React 同步赋值），再踢帧
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(render)
    }

    // 首帧总是渲染（静态模式下只渲染这一帧）
    render()

    // ── 可见性变化：后台时停帧 ──────────────────────────────────────────
    const onVisibility = () => {
      if (!document.hidden && !propsRef.current.paused && !reducedMotion) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(render)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // ── WebGL 上下文丢失/恢复 ────────────────────────────────────────────
    // restore 重试上限：GPU 反复丢失（单帧超时/驱动过载）时若无限重建，
    // 每轮同步 shader 编译会把主线程卡死成 lost→restore 风暴；超限永久降级纯黑
    let restoreAttempts = 0
    const MAX_RESTORE_ATTEMPTS = 3

    const onLost = (e: Event) => {
      e.preventDefault()
      isLost = true
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }

    const onRestored = () => {
      restoreAttempts += 1
      if (restoreAttempts > MAX_RESTORE_ATTEMPTS) {
        canvas.style.background = '#262624'
        return
      }
      isLost = false
      prog   = createProgram(glCtx, tierParams.steps, tierParams.dtScale)
      buf    = glCtx.createBuffer()
      setupGeom()
      if (!propsRef.current.paused) {
        rafRef.current = requestAnimationFrame(render)
      }
    }

    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

    // ── 鼠标事件：挂 window 而非 wrap ───────────────────────────────────
    // 问题 3 修复：interactive 时若挂在 wrap 上会因 pointerEvents:'auto' 拦截上层点击；
    // 改为挂 window，用 getBoundingClientRect 算相对坐标，pointer-events 始终 none。
    const onMouseMove = (e: MouseEvent) => {
      if (!propsRef.current.interactive) return
      const rect = wrap.getBoundingClientRect()
      const m    = mouseRef.current
      m.tx = ((e.clientX - rect.left) / rect.width  - 0.5) * 2
      m.ty = ((e.clientY - rect.top)  / rect.height - 0.5) * -2  // y 轴翻转
    }

    window.addEventListener('mousemove', onMouseMove)

    // ── 清理 ─────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      kickRef.current = null   // 卸载后禁止残留调用
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      window.removeEventListener('mousemove', onMouseMove)

      if (prog) glCtx.deleteProgram(prog)
      if (buf)  glCtx.deleteBuffer(buf)

      // 主动释放上下文，避免 Chrome 对废弃 canvas 保留 GPU 资源；
      // canvas 是本次 setup 创建的，移除后下次 setup 会拿全新节点/context
      const ext = glCtx.getExtension('WEBGL_lose_context')
      ext?.loseContext()
      canvas.remove()
    }
  }, []) // 只在挂载/卸载时运行；prop 变化通过 propsRef.current 实时读取

  // 问题 1 修复：paused true→false 时通过 kickRef 踢一帧续循环
  // propsRef.current 由上方同步赋值，kickRef 调用时 paused 已是最新值
  useEffect(() => {
    if (!paused) {
      kickRef.current?.()
    }
  }, [paused])

  // ── 外层 div 样式 ─────────────────────────────────────────────────────────
  // 问题 3 修复：pointer-events 始终 none，不拦截上层 UI 点击；
  // interactive 效果由挂在 window 上的 mousemove 监听器实现。
  const wrapStyle: CSSProperties = {
    position:      'absolute',
    inset:         0,
    overflow:      'hidden',
    pointerEvents: 'none',
    backgroundColor: '#262624',
    ...style,
  }

  // canvas 由 effect 动态创建（见 useEffect 内注释），这里只渲染容器
  return <div ref={wrapRef} className={className} style={wrapStyle} />
}

export default BlackHole
