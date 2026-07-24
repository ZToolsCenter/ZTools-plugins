import React, { PureComponent, Component } from 'react';
import Card from '@mui/material/Card';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import CodeIcon from '@mui/icons-material/Code';
import ImageIcon from '@mui/icons-material/Image';
import chroma from 'chroma-js';
import gradientsET from '../data/gradients-eT.json';
import gradientsTT from '../data/gradients-tT.json';
import gradientsNT from '../data/gradients-nT.json';
import { copyText, copyImage, hideMainWindow } from '../utils/platform';

/**
 * GradientsPage - 渐变色页面
 * 
 * 核心功能:
 * - 展示渐变色库(按色系分类和筛选)
 * - 渐变色详情弹窗(角度/尺寸调整、CSS代码复制、导出图片)
 * - 方向编辑器(可视化调整渐变角度)
 */

/** 颜色筛选选项 */
const filterColors = [
  { id: "red", color: "#D7003A" },
  { id: "orange", color: "#EE7800" },
  { id: "yellow", color: "#FFD900" },
  { id: "green", color: "#3EB370" },
  { id: "cyan", color: "#0095D9" },
  { id: "blue", color: "#165E83" },
  { id: "magenta", color: "#884898" },
  { id: "white", color: "#eaeaea" },
  { id: "gray", color: "#c0c0cb" },
  { id: "black", color: "#333333" },
];

/** 根据颜色 HSL 值分类到对应色系 */
function classifyColor(color: string): string {
  const [h, s, l] = chroma(color).hsl();
  const hue = isNaN(h) ? 0 : h;
  if (l < 0.2) return "black";
  if (l > 0.85) return "white";
  if (s < 0.2) return "gray";
  if (hue < 26) return "red";
  if (hue < 50) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 165) return "green";
  if (hue < 190) return "cyan";
  if (hue < 265) return "blue";
  if (hue < 320) return "magenta";
  return "red";
}

/** 渐变数据项 */
interface GradientItem { colors: string[]; tags: string[] };

/** 懒加载并缓存所有渐变色数据，合并三个数据源并自动分类标签 */
let allGradients: GradientItem[] | null = null;

function getGradients(): GradientItem[] {
  if (allGradients) return allGradients;
  allGradients = [];
  [gradientsET, gradientsTT, gradientsNT].forEach(group => {
    (group as string[][]).forEach(colors => {
      allGradients!.push({
        colors,
        tags: colors.map(c => classifyColor(c)),
      });
    });
  });
  return allGradients;
}

/** 计算渐变线的起止坐标(用于 Canvas 渲染) */
function calculateGradientLine(width: number, height: number, angle: number) {
  const rad = angle * Math.PI / 180 + Math.PI / 2;
  const len = Math.sqrt(width / 2 * width / 2 + height / 2 * height / 2);
  const tx = Math.cos(rad) * len + width / 2;
  const ty = Math.sin(rad) * len + height / 2;
  return { tx, ty, bx: width / 2, by: height / 2 };
}

/** 默认渐变角度和尺寸 */
const DEFAULT_ANGLE = 135;
const DEFAULT_SIZE = 500;

/** 方向编辑器 - 可视化调整渐变角度的圆形控件 */
interface DirectionEditorProps {
  angle: number;
  onChange: (angle: number) => void;
}

class DirectionEditor extends PureComponent<DirectionEditorProps> {
  private directionEditorRef: HTMLDivElement | null = null;
  private _centerPoint = { x: 0, y: 0 };

  getPointByAngle(angle: number) {
    const rad = 2 * Math.PI / 360 * angle;
    const r = 30;
    const x = 50 + Math.sin(rad) * r;
    const y = 50 - Math.cos(rad) * r;
    return { x, y };
  }

  handleKnobMouseDown = () => {
    if (!this.directionEditorRef) return;
    const rect = this.directionEditorRef.getBoundingClientRect();
    this._centerPoint = {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
    window.addEventListener("mousemove", this.handleKnobMouseMove);
    window.addEventListener("mouseup", this.handleKnobMouseUp);
  };

  handleKnobMouseMove = (e: MouseEvent) => {
    const dx = e.clientX - this._centerPoint.x;
    const dy = this._centerPoint.y - e.clientY;
    let angle = 90 - Math.atan2(dy, dx) * 180 / Math.PI;
    if (angle < 0) angle = 360 + angle;
    this.props.onChange(Math.round(angle));
  };

  handleKnobMouseUp = () => {
    window.removeEventListener("mousemove", this.handleKnobMouseMove);
    window.removeEventListener("mouseup", this.handleKnobMouseUp);
  };

  render() {
    const { angle } = this.props;
    const point = this.getPointByAngle(angle);

    return (
      <div
        ref={el => { this.directionEditorRef = el; }}
        className="direction-editor"
      >
        <svg viewBox="0 0 1 1" className="direction-editor-box">
          <polyline
            transform={`rotate(${angle} .5 .5)`}
            points=".5 1 .5 0 .44 .06 .56 .06 .5 0"
            className="direction-editor-polyline"
          />
        </svg>
        <div className="direction-editor-box">
          <svg viewBox="0 0 1 1">
            <circle cx="0.5" cy="0.5" r=".3" className="direction-editor-circle" />
          </svg>
          <div
            onMouseDown={this.handleKnobMouseDown}
            className="direction-editor-knob"
            style={{ left: point.x + "%", top: point.y + "%" }}
          />
        </div>
      </div>
    );
  }
}

/** 渐变色详情弹窗 - 角度/尺寸调整、CSS代码复制、导出图片 */
interface GradientDialogProps {
  gradientData: string[] | null;
}

interface GradientDialogState {
  open: boolean;
  angle: number;
  imageWidth: string;
  imageHeight: string;
}

class GradientDialog extends Component<GradientDialogProps, GradientDialogState> {
  state: GradientDialogState = {
    open: false,
    angle: DEFAULT_ANGLE,
    imageWidth: '1000',
    imageHeight: '1000',
  };

  handleClose = () => {
    this.setState({ open: false });
  };

  handleDirectionChange = (angle: number) => {
    this.setState({ angle });
  };

  handleImageWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (/^\d*$/.test(v)) {
      this.setState({ imageWidth: v });
    }
  };

  handleImageHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (/^\d*$/.test(v)) {
      this.setState({ imageHeight: v });
    }
  };

  handleCssCodeCopy = () => {
    const cssCode = `linear-gradient(${this.state.angle}deg,${this.props.gradientData!.join(",").toLowerCase()})`;
    copyText(cssCode);
    hideMainWindow();
  };

  handleImageExport = () => {
    const { angle, imageWidth, imageHeight } = this.state;
    const w = parseInt(imageWidth);
    const h = parseInt(imageHeight);
    if (w < 1 || h < 1) return;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.style.zIndex = "0";
    canvas.style.position = "fixed";
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d")!;
    const line = calculateGradientLine(w, h, angle);
    const gradient = ctx.createLinearGradient(line.tx, line.ty, line.bx, line.by);

    const stops = [0];
    if (this.props.gradientData!.length > 2) {
      const total = this.props.gradientData!.length - 1;
      for (let i = 1; i < total; i++) {
        stops.push(i / total);
      }
    }
    stops.push(1);

    stops.forEach((stop, i) => {
      gradient.addColorStop(stop, this.props.gradientData![i]);
    });

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    copyImage(canvas.toDataURL());
    canvas.remove();
    hideMainWindow();
  };

  componentDidUpdate(prev: GradientDialogProps) {
    if (this.props.gradientData && prev.gradientData !== this.props.gradientData) {
      this.setState({ open: true, angle: DEFAULT_ANGLE, imageWidth: '1000', imageHeight: '1000' });
    }
  }

  render() {
    const { gradientData } = this.props;
    if (!gradientData) return false;

    const { open, angle, imageWidth, imageHeight } = this.state;
    const gradientCSS = `linear-gradient(${angle}deg,${gradientData.join(",").toLowerCase()})`;

    return (
      <Dialog className="gradient-dialog" open={open} onClose={this.handleClose}>
        <div className="gradient-dialog-viewer" style={{ background: gradientCSS }} />
        <div className="gradient-dialog-content">
          <div>
            <DirectionEditor angle={angle} onChange={this.handleDirectionChange} />
          </div>
          <div className="gradient-dialog-form">
            <div>
              <div>
                <TextField
                  disabled
                  value={gradientCSS}
                  fullWidth
                  label="CSS 代码"
                  variant="outlined"
                />
              </div>
              <div>
                <Button
                  disableFocusRipple
                  tabIndex={-1}
                  onClick={this.handleCssCodeCopy}
                  variant="contained"
                  startIcon={<CodeIcon />}
                >
                  复制代码
                </Button>
              </div>
            </div>
            <div>
              <div className="gradient-dialog-image-output">
                <div>
                  <TextField
                    fullWidth
                    type="number"
                    onChange={this.handleImageWidthChange}
                    value={imageWidth}
                    label="图片宽度"
                    variant="outlined"
                  />
                </div>
                <div>
                  <TextField
                    fullWidth
                    type="number"
                    onChange={this.handleImageHeightChange}
                    value={imageHeight}
                    label="图片高度"
                    variant="outlined"
                  />
                </div>
              </div>
              <div>
                <Button
                  disableFocusRipple
                  tabIndex={-1}
                  onClick={this.handleImageExport}
                  variant="contained"
                  startIcon={<ImageIcon />}
                >
                  复制图片
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Dialog>
    );
  }
}

interface GradientsPageState {
  gradients: GradientItem[];
  filterColor: string;
  gradientData: string[] | null;
}

class GradientsPage extends Component<{ onColorClick: (e: any) => void }, GradientsPageState> {
  private gradientContentRef: HTMLDivElement | null = null;

  constructor(props: { onColorClick: (e: any) => void }) {
    super(props);
    this.state = {
      gradients: getGradients(),
      filterColor: "",
      gradientData: null,
    };
  }

  handleFilterColor = (id: string) => () => {
    if (this.gradientContentRef && this.gradientContentRef.scrollTop > 0) {
      this.gradientContentRef.scrollTop = 0;
    }
    if (id === this.state.filterColor) {
      this.setState({ gradients: getGradients(), filterColor: "" });
      return;
    }
    const filtered = getGradients().filter(g => g.tags.includes(id));
    this.setState({ gradients: filtered, filterColor: id });
  };

  handleGradientOpen = (gradient: GradientItem) => () => {
    this.setState({ gradientData: [...gradient.colors] });
  };

  render() {
    const { gradients, filterColor, gradientData } = this.state;

    return (
      <div className="gradient-body">
        <div className="gradient-filter">
          {filterColors.map(fc => (
            <div
              key={fc.id}
              title="只显示相近颜色"
              onClick={this.handleFilterColor(fc.id)}
              style={{
                backgroundColor: fc.color,
                boxShadow: filterColor === fc.id ? `0 0 0 2px ${fc.color}` : "none",
              }}
            />
          ))}
        </div>
        <div
          ref={el => { this.gradientContentRef = el; }}
          className="gradient-content"
        >
          {gradients.map((gradient, i) => (
            <Card className="gradient-item" key={i} variant="outlined">
              <div
                onClick={this.handleGradientOpen(gradient)}
                style={{ background: `linear-gradient(135deg, ${gradient.colors.join(",")})` }}
              />
              <div>
                {gradient.colors.map((color, j) => (
                  <div
                    key={`${i}-${j}`}
                    onClick={this.props.onColorClick}
                    title={color}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
        <GradientDialog gradientData={gradientData} />
      </div>
    );
  }
}

export default GradientsPage;
