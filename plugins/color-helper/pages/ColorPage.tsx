import React, { Component, PureComponent } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import { copyText as platformCopyText, screenColorPick } from '../utils/platform';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import CheckIcon from '@mui/icons-material/Check';
import AddIcon from '@mui/icons-material/Add';
import ColorizeIcon from '@mui/icons-material/Colorize';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import chroma from 'chroma-js';
import iro from '@jaames/iro';

/**
 * ColorPage - 颜色转换页面
 * 
 * 核心功能:
 * - 颜色选择器(色轮 + 饱和度/明度滑块)
 * - 多格式颜色值显示与编辑(HEX/RGB/HSL/HSV/HSI/CMYK/LAB)
 * - 色彩和谐方案(互补色/类似色/三角色/四角色)
 * - 屏幕取色
 */

/** 格式化色相角度，处理负值和超过360度的情况 */

function formatHueAngle(h: number): string {
  return h >= 0
    ? Math.round((h > 360 ? h - 360 : h) * 100) / 100 + ", "
    : Math.round((360 + h) * 100) / 100 + ", ";
}

/** 将 hsl(...) 字符串转为 HEX */
function hslToHex(hslStr: string): string {
  try {
    const match = hslStr.match(/hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
    if (match) {
      return chroma.hsl(parseFloat(match[1]), parseFloat(match[2]) / 100, parseFloat(match[3]) / 100).hex();
    }
  } catch {}
  return hslStr;
}

/** 颜色状态: 存储各格式的颜色值及用户输入草稿 */
interface ColorState {
  hex: string;
  rgb: string;
  hsl: string;
  hsv: string;
  hsi: string;
  cmyk: string;
  lab: string;
  hexInput?: string;
  rgbInput?: string;
  hslInput?: string;
  hsvInput?: string;
  hsiInput?: string;
  cmykInput?: string;
  labInput?: string;
  hslExtend: {
    complementary: string[];
    analogous: string[];
    triadic: string[];
    tetradic: string[];
  };
}

/** 将 chroma.Color 对象转换为 ColorState，包含所有格式的颜色值和和谐色方案 */
function convertStateColor(color: chroma.Color): ColorState {
  const hex = color.hex();
  const rgb = color.rgb().join(", ");
  const hsl = color.hsl();
  const h = isNaN(hsl[0]) ? 0 : hsl[0];
  const sl = Math.round(hsl[1] * 10000) / 100 + "%, " + Math.round(hsl[2] * 10000) / 100 + "%";
  const hslStr = formatHueAngle(h) + sl;

  const hsv = color.hsv();
  const hsvStr = (isNaN(hsv[0]) ? 0 : Math.round(hsv[0] * 100) / 100) + ", " +
    Math.round(hsv[1] * 10000) / 100 + "%, " + Math.round(hsv[2] * 10000) / 100 + "%";

  const hsi = color.hsi();
  const hsiStr = (isNaN(hsi[0]) ? 0 : Math.round(hsi[0] * 100) / 100) + ", " +
    Math.round(hsi[1] * 10000) / 100 + "%, " + Math.round(hsi[2] * 10000) / 100 + "%";

  const cmyk = color.cmyk().map((v: number) => Math.round(v * 100) + "%").join(", ");
  const lab = color.lab().map((v: number) => Math.round(v * 1000) / 1000 || 0).join(", ");

  const complementary = ["hsl(" + formatHueAngle(h + 180) + sl + ")"];
  const analogous = ["hsl(" + formatHueAngle(h - 30) + sl + ")", "hsl(" + formatHueAngle(h + 30) + sl + ")"];
  const triadic = ["hsl(" + formatHueAngle(h + 120) + sl + ")", "hsl(" + formatHueAngle(h + 240) + sl + ")"];
  const tetradic = ["hsl(" + formatHueAngle(h + 90) + sl + ")", "hsl(" + formatHueAngle(h + 180) + sl + ")", "hsl(" + formatHueAngle(h + 270) + sl + ")"];

  return {
    hex, rgb, hsl: hslStr, hsv: hsvStr, hsi: hsiStr, cmyk, lab,
    hslExtend: { complementary, analogous, triadic, tetradic }
  };
}

/** 按指定格式解析颜色字符串，返回 chroma.Color 或 null */
function parseColorByType(type: string, value: string): chroma.Color | null {
  if (type === "hex") {
    if (/^[0-9a-fA-F]{6}$/.test(value)) return chroma("#" + value);
    return null;
  }
  if (type === "rgb") {
    const m = value.match(/((?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})(?:, *| +)){2}(?:25[0-5]|2[0-4]\d|1?\d{1,2}))/);
    if (m) {
      const parts = m[1].split(/, *| +/).map((v: string) => parseInt(v.trim()));
      return chroma.rgb(parts[0], parts[1], parts[2]);
    }
    return null;
  }
  if (type === "cmyk") {
    const m = value.match(/((?:(?:100|\d{1,2})%?, ?){3}(?:100|\d{1,2})%?|(?:(?:1|0|0\.\d{1,2}), ?){3}(?:1|0|0\.\d{1,2}))/);
    if (m) {
      const parts = m[1].replace(/%/g, "").split(",").map((v: string) => parseFloat(v.trim())).map((v: number) => v > 1 ? v / 100 : v);
      return chroma.cmyk(parts[0], parts[1], parts[2], parts[3]);
    }
    return null;
  }
  if (type === "hsl" || type === "hsi" || type === "hsv") {
    const m = value.match(/((?:360|((?:3[0-5]\d|[1-2]\d{2}|\d{1,2})(?:\.\d{1,15})?))(?:deg)?(?:, *| +)(?:100|\d{1,2}(?:\.\d{1,15})?)%?(?:, *| +)(?:100|\d{1,2}(?:\.\d{1,15})?)%?)/);
    if (m) {
      const parts = m[1].replace(/[^\d., ]/g, "").split(/, *| +/).map((v: string) => parseFloat(v.trim()));
      if (parts[1] > 1) parts[1] = parts[1] / 100;
      if (parts[2] > 1) parts[2] = parts[2] / 100;
      return (chroma as any)[type](parts[0], parts[1], parts[2]);
    }
    return null;
  }
  if (type === "lab") {
    const m = value.match(/((?:100|\d{1,2}(?:\.\d{1,15})?)(?:(?:, *| +)-?(?:100|\d{1,2}(?:\.\d{1,15})?)){2})/);
    if (m) {
      const parts = m[1].split(/, *| +/).map((v: string) => parseFloat(v));
      return chroma.lab(parts[0], parts[1], parts[2]);
    }
    return null;
  }
  return null;
}

/** 自动识别颜色格式并解析输入字符串 */
function parseColorInput(input: string): chroma.Color | null {
  if (!input || input.length < 4) return null;
  let type: string;
  let value = input;

  if (/^(?:#[a-f0-9]{3}|#?[a-f0-9]{6}|#[a-f0-9]{8});?$/i.test(value)) {
    type = "hex";
    value = value.replace(/[^0-9a-fA-F]/gi, "");
    if (value.length === 3) value = value + value;
    else if (value.length === 8) value = value.substring(2);
  } else {
    type = value.substring(0, 3).toLowerCase();
  }
  return parseColorByType(type, value);
}

/** 页面状态缓存，用于跨组件保持颜色选择 */
let cachedState: ColorPageState | null = null;

/** Iro 色轮选择器组件 - 支持多色选择 */
interface IroPickerProps {
  colors: ColorState[];
  activeIndex: number;
  onChange: (color: any) => void;
  onSetActive: (color: any) => void;
}

class IroColorPicker extends PureComponent<IroPickerProps> {
  private colorPicker: any = null;
  private containerRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    if (!this.containerRef.current) return;
    this.colorPicker = new iro.ColorPicker(this.containerRef.current, {
      width: 300,
      borderWidth: 1,
      handleSvg: "#handle",
      colors: this.props.colors.map((t: ColorState) => "hsl(" + t.hsl + ")"),
      layout: [
        { component: iro.ui.Wheel, options: { wheelDirection: "clockwise" as any, wheelAngle: -90 } },
        { component: iro.ui.Slider, options: { sliderType: "saturation" } },
        { component: iro.ui.Slider },
      ],
    });
    this.colorPicker.on("color:change", this.props.onChange);
    this.colorPicker.on("color:setActive", this.props.onSetActive);
    this.colorPicker.setActiveColor(this.props.activeIndex);
  }

  componentWillUnmount() {
    if (this.colorPicker) {
      this.colorPicker.off("color:change", this.props.onChange);
      this.colorPicker.off("color:setActive", this.props.onSetActive);
      if (this.containerRef.current) {
        this.containerRef.current.innerHTML = "";
      }
      this.colorPicker = null;
    }
  }

  componentDidUpdate(prevProps: IroPickerProps) {
    if (prevProps.colors !== this.props.colors) {
      this.colorPicker.setColors(this.props.colors.map((n: ColorState) => "hsl(" + n.hsl + ")"));
      this.colorPicker.setActiveColor(this.props.activeIndex);
    }
  }

  render() {
    return (
      <>
        <svg style={{ display: "none" }}>
          <defs>
            <g id="handle">
              <circle cx="8" cy="8" r="8" fill="none" strokeWidth="1" stroke="#fff" />
            </g>
          </defs>
        </svg>
        <div ref={this.containerRef} />
      </>
    );
  }
}

interface ColorPageProps {
  value: (string | null)[];
  onColorClick: (e: any) => void;
  setting: boolean;
  showMessage: (msg: string) => void;
}

interface ColorPageState {
  colors: ColorState[];
  activeIndex: number;
}

/** 配色方案标签映射 */
const schemeLabels: Record<string, string> = {
  complementary: "互补色",
  triadic: "对比色",
  analogous: "类似色",
  tetradic: "中差色",
};

class ColorPage extends Component<ColorPageProps, ColorPageState> {
  private _currentChromaColor: chroma.Color | null = null;

  /** 添加新颜色到色板(最多8个，超出时移除最早的) */
  setNewColor = (color: ColorState) => {
    const colors = [...this.state.colors, color];
    if (colors.length > 8) colors.shift();
    this.setState({ colors, activeIndex: colors.length - 1 });
  };

  /** 屏幕取色 */
  handleScreenColorPicker = () => {
    screenColorPick(({ hex }) => {
      this.setNewColor(convertStateColor(chroma(hex)));
    });
  };

  /** 随机生成新颜色 */
  handleColorHubNew = () => {
    this.setNewColor(convertStateColor(chroma.random()));
  };

  /** 切换当前激活的颜色索引 */
  handleColorSelect = (index: number) => {
    if (index === this.state.activeIndex) return;
    this.setState({ colors: [...this.state.colors], activeIndex: index });
  };

  /** 复制指定格式的颜色值到剪贴板 */
  handleCssCodeCopy = (format: string) => () => {
    const color = this.state.colors[this.state.activeIndex];
    let copyText: string;
    if (this.props.setting) {
      if (format === "hex") copyText = color.hex.substring(1);
      else if (format === "rgb") copyText = color.rgb;
      else if (format === "cmyk") copyText = color.cmyk;
      else if (["hsl", "hsi", "hsv"].includes(format)) copyText = (color as any)[format];
      else if (format === "lab") copyText = color.lab;
      else return;
    } else {
      if (format === "hex") copyText = color.hex;
      else if (format === "rgb") copyText = "rgb(" + color.rgb + ")";
      else if (format === "cmyk") copyText = "cmyk(" + color.cmyk + ")";
      else if (["hsl", "hsi", "hsv"].includes(format)) copyText = format + "(" + (color as any)[format] + ")";
      else if (format === "lab") copyText = "lab(" + color.lab + ")";
      else return;
    }
    platformCopyText(copyText);
  };

  /** 颜色值输入变更: 解析输入并更新颜色状态，解析失败则保留输入草稿 */
  handleValueChange = (format: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const parsed = parseColorByType(format, value);
    const { colors, activeIndex } = this.state;
    if (parsed) {
      colors[activeIndex] = convertStateColor(parsed);
    } else {
      (colors[activeIndex] as any)[format + "Input"] = value;
    }
    this.setState({ colors: [...colors] });
  };

  handleColorWheelSetActive = (color: any) => {
    this.setState({ activeIndex: color.index });
  };

  handleColorWheelChange = (color: any) => {
    const newColor = convertStateColor(chroma.hsv(color.hsv.h, color.hsv.s / 100, color.hsv.v / 100));
    const colors = [...this.state.colors];
    colors[color.index] = newColor;
    this.setState({ colors });
  };

  constructor(props: ColorPageProps) {
    super(props);

    let initialColor: ColorState | undefined;

    if (props.value?.[0]) {
      const parsed = parseColorInput(props.value[0]!);
      props.value[0] = null;
      if (parsed) initialColor = convertStateColor(parsed);
    }

    if (cachedState) {
      if (initialColor) {
        cachedState.colors.push(initialColor);
        if (cachedState.colors.length > 8) cachedState.colors.shift();
        cachedState.activeIndex = cachedState.colors.length - 1;
      }
      this.state = cachedState;
      return;
    }

    if (!initialColor) initialColor = convertStateColor(chroma.random());
    this.state = { colors: [initialColor], activeIndex: 0 };
  }

  componentWillUnmount() {
    cachedState = this.state;
  }

  componentDidUpdate(prevProps: ColorPageProps) {
    if (prevProps.value !== this.props.value) {
      const parsed = parseColorInput(this.props.value?.[0] || "");
      if (parsed) {
        (this.props.value as any)[0] = null;
        this.setNewColor(convertStateColor(parsed));
      }
    }
  }

  render() {
    const { colors, activeIndex } = this.state;
    const { setting, onColorClick } = this.props;
    const u = colors[activeIndex];

    const extendData: Record<string, { label: string; colors: string[] }> = {
      complementary: { label: "互补色", colors: u.hslExtend.complementary },
      triadic: { label: "对比色", colors: u.hslExtend.triadic },
      analogous: { label: "类似色", colors: u.hslExtend.analogous },
      tetradic: { label: "中差色", colors: u.hslExtend.tetradic },
    };

    return (
      <div className="color-content" style={{ backgroundColor: u.hex }}>
        <div className="color-info">
          <div>
            <Tooltip placement="right" title="屏幕取色">
              <IconButton
                disableFocusRipple
                tabIndex={-1}
                size="small"
                onClick={this.handleScreenColorPicker}
                className="color-screen-picker"
                sx={{
                  backgroundColor: 'rgba(255,255,255,0.7)',
                  '&:hover': { backgroundColor: 'rgba(255,255,255,0.9)' },
                  '&:active': { backgroundColor: 'rgba(255,255,255,0.9)' },
                }}
              >
                <ColorizeIcon />
              </IconButton>
            </Tooltip>
            <IroColorPicker
              colors={colors}
              activeIndex={activeIndex}
              onChange={this.handleColorWheelChange}
              onSetActive={this.handleColorWheelSetActive}
            />
          </div>
          <Card className="color-value">
            {/* 配色方案 */}
            <div className="color-extend">
              {Object.keys(extendData).map(key => {
                const ext = extendData[key];
                return (
                  <div className="color-extend-item" key={key}>
                    <div className="color-extend-label">{ext.label}</div>
                    {ext.colors.map((color, i) => {
                      const hex = hslToHex(color);
                      return (
                        <div
                          key={i}
                          data-key={color}
                          className="color-extend-value"
                          onClick={() => onColorClick({ currentTarget: { style: { backgroundColor: hex } } })}
                          style={{
                            backgroundColor: color,
                            boxSizing: 'border-box',
                            border: hex === '#ffffff' ? '1px solid rgba(0,0,0,0.12)' : 'none',
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <Divider sx={{ my: 3 }} />

            {/* HEX */}
            <div>
              <div>HEX</div>
              <div>
                <input
                  type="text"
                  value={typeof u.hexInput === "string" ? u.hexInput : u.hex.replace("#", "")}
                  onChange={this.handleValueChange("hex")}
                />
              </div>
              <div className="css-code-copy">
                <Tooltip placement="right" title={`复制 "${setting ? u.hex.substring(1) : u.hex}"`}>
                  <IconButton disableFocusRipple tabIndex={-1} onClick={this.handleCssCodeCopy("hex")} size="small">
                    <ContentCopyIcon />
                  </IconButton>
                </Tooltip>
              </div>
            </div>

            {/* RGB */}
            <div>
              <div>RGB</div>
              <div>
                <input
                  type="text"
                  value={typeof u.rgbInput === "string" ? u.rgbInput : u.rgb}
                  onChange={this.handleValueChange("rgb")}
                />
              </div>
              <div className="css-code-copy">
                <Tooltip placement="right" title={`复制 "${setting ? u.rgb : "rgb(" + u.rgb + ")"}"`}>
                  <IconButton disableFocusRipple tabIndex={-1} onClick={this.handleCssCodeCopy("rgb")} size="small">
                    <ContentCopyIcon />
                  </IconButton>
                </Tooltip>
              </div>
            </div>

            {/* HSV/HSB */}
            <div>
              <div>HSV/HSB</div>
              <div>
                <input
                  type="text"
                  value={typeof u.hsvInput === "string" ? u.hsvInput : u.hsv}
                  onChange={this.handleValueChange("hsv")}
                />
              </div>
              <div className="css-code-copy">
                <Tooltip placement="right" title={`复制 "${setting ? u.hsv : "hsv(" + u.hsv + ")"}"`}>
                  <IconButton disableFocusRipple tabIndex={-1} onClick={this.handleCssCodeCopy("hsv")} size="small">
                    <ContentCopyIcon />
                  </IconButton>
                </Tooltip>
              </div>
            </div>

            {/* HSL */}
            <div>
              <div>HSL</div>
              <div>
                <input
                  type="text"
                  value={typeof u.hslInput === "string" ? u.hslInput : u.hsl}
                  onChange={this.handleValueChange("hsl")}
                />
              </div>
              <div className="css-code-copy">
                <Tooltip placement="right" title={`复制 "${setting ? u.hsl : "hsl(" + u.hsl + ")"}"`}>
                  <IconButton disableFocusRipple tabIndex={-1} onClick={this.handleCssCodeCopy("hsl")} size="small">
                    <ContentCopyIcon />
                  </IconButton>
                </Tooltip>
              </div>
            </div>

            {/* CMYK */}
            <div>
              <div>CMYK</div>
              <div>
                <input
                  type="text"
                  value={typeof u.cmykInput === "string" ? u.cmykInput : u.cmyk}
                  onChange={this.handleValueChange("cmyk")}
                />
              </div>
              <div className="css-code-copy">
                <Tooltip placement="right" title={`复制 "${setting ? u.cmyk : "cmyk(" + u.cmyk + ")"}"`}>
                  <IconButton disableFocusRipple tabIndex={-1} onClick={this.handleCssCodeCopy("cmyk")} size="small">
                    <ContentCopyIcon />
                  </IconButton>
                </Tooltip>
              </div>
            </div>

            {/* HSI */}
            <div>
              <div>HSI</div>
              <div>
                <input
                  type="text"
                  value={typeof u.hsiInput === "string" ? u.hsiInput : u.hsi}
                  onChange={this.handleValueChange("hsi")}
                />
              </div>
              <div className="css-code-copy">
                <Tooltip placement="right" title={`复制 "${setting ? u.hsi : "hsi(" + u.hsi + ")"}"`}>
                  <IconButton disableFocusRipple tabIndex={-1} onClick={this.handleCssCodeCopy("hsi")} size="small">
                    <ContentCopyIcon />
                  </IconButton>
                </Tooltip>
              </div>
            </div>

            {/* CIE-LAB */}
            <div>
              <div>CIE-LAB</div>
              <div>
                <input
                  type="text"
                  value={typeof u.labInput === "string" ? u.labInput : u.lab}
                  onChange={this.handleValueChange("lab")}
                />
              </div>
              <div className="css-code-copy">
                <Tooltip placement="right" title={`复制 "${setting ? u.lab : "lab(" + u.lab + ")"}"`}>
                  <IconButton disableFocusRipple tabIndex={-1} onClick={this.handleCssCodeCopy("lab")} size="small">
                    <ContentCopyIcon />
                  </IconButton>
                </Tooltip>
              </div>
            </div>

            {/* 颜色Hub */}
            <div className="color-hub">
              <div className="color-hub-wrapper">
                {colors.map((color, index) => {
                  const isDark = chroma(color.hex).get('lab.l') < 70;
                  return (
                    <Typography
                      key={index}
                      onClick={() => this.handleColorSelect(index)}
                      className={`color-hub-value ${index === activeIndex ? 'color-checked' : ''}`}
                      sx={{
                        backgroundColor: color.hex,
                        border: (theme: any) => color.hex === u.hex ? `1px solid ${theme.palette.divider}` : 'none',
                        color: isDark ? '#fff' : '#000',
                        cursor: 'pointer',
                      }}
                    >
                      <CheckIcon className="color-hub-check" fontSize="small" />
                    </Typography>
                  );
                })}
              </div>
              <Tooltip placement="right" title="新建随机颜色">
                <IconButton
                  disableFocusRipple
                  tabIndex={-1}
                  size="small"
                  onClick={this.handleColorHubNew}
                  sx={{
                    backgroundColor: 'rgba(255,255,255,0.7)',
                    '&:hover': { backgroundColor: 'rgba(255,255,255,0.9)' },
                    '&:active': { backgroundColor: 'rgba(255,255,255,0.9)' },
                  }}
                >
                  <AddIcon />
                </IconButton>
              </Tooltip>
            </div>
          </Card>
        </div>
      </div>
    );
  }
}

export default ColorPage;
