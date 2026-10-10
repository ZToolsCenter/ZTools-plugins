import React, { Component, lazy, Suspense } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Snackbar from '@mui/material/Snackbar';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Tooltip from '@mui/material/Tooltip';
import PaletteIcon from '@mui/icons-material/Palette';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ImageIcon from '@mui/icons-material/Image';
import ViewCompactIcon from '@mui/icons-material/ViewCompact';
import BrushIcon from '@mui/icons-material/Brush';
import GradientIcon from '@mui/icons-material/Gradient';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import ColorizeIcon from '@mui/icons-material/Colorize';
import chroma from 'chroma-js';
import ColorPage from './pages/ColorPage';
import UIPalettesPage from './pages/UIPalettesPage';
import TraditionalColorsPage from './pages/TraditionalColorsPage';
import CollectColorsPage from './pages/CollectColorsPage';
import { copyText, db, dbStorage, screenColorPick, onPluginEnter, onPluginOut, isPlatform } from './utils/platform';
import { collectDocId, saveCollectedColor } from './utils/collect';

// 代码分割试点: 只拆「单次使用 + 自带大块资源」的页面
//  - GradientsPage: 渐变数据 4.05 kB gzip + 代码 17.71 kB
//  - ImagePalettePage: 4 张封面图 107 kB + quantize.ts
//  - AIPalettePage: 色轮 UI(iro 仅剩样式与 ui 常量, 逻辑已在首屏共用 chunk)
// 其余页面体积小且首屏常用, 保持静态导入
const GradientsPage = lazy(() => import('./pages/GradientsPage'));
const ImagePalettePage = lazy(() => import('./pages/ImagePalettePage'));
const AIPalettePage = lazy(() => import('./pages/AIPalettePage'));

/**
 * App - 核心架构: 状态驱动导航(this.state.nav) + 平台生命周期
 */

// 从backgroundColor(rgb字符串)解析为hex, setting=true时去掉#
function colorFromBackgroundColor(bgColor: string, setting: boolean): string | null {
  if (!bgColor) return null;
  try {
    const match = bgColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (match) {
      const hex = match.slice(1).map(n => parseInt(n, 10).toString(16).padStart(2, "0")).join("");
      return setting ? hex : "#" + hex;
    }
    // fallback for other formats
    const c = chroma(bgColor);
    return setting ? c.hex().substring(1) : c.hex();
  } catch {
    return null;
  }
}

/**
 * 侧边栏导航项
 */
export const navItems = [
  { key: "color", label: "颜色", icon: <PaletteIcon /> },
  { key: "ui", label: "UI 色卡", icon: <ViewCompactIcon /> },
  { key: "traditional", label: "传统色", icon: <BrushIcon /> },
  { key: "gradient", label: "渐变色", icon: <GradientIcon /> },
  { key: "image", label: "图片色卡", icon: <ImageIcon /> },
  { key: "collect", label: "收藏颜色", icon: <StarIcon /> },
  { key: "ai", label: "AI 配色", icon: <AutoAwesomeIcon /> },
];

interface AppState {
  nav: string;
  colorValue: (string | null)[];
  openMessage: boolean;
  messageData: { key: number; color: string; text: string };
  setting: boolean;
  imagePayload: string | null;
  /** 收藏页在 constructor 里一次性读库, 从提示条收藏成功后递增它重挂载刷新列表 */
  collectVersion: number;
}

class App extends Component<{}, AppState> {

  state: AppState = {
    nav: "",
    colorValue: [],
    openMessage: false,
    messageData: { key: 0, color: "", text: "" },
    setting: false,
    imagePayload: null,
    collectVersion: 0,
  };

  handleNavChange = (nav: string) => () => {
    (document.activeElement as HTMLElement)?.blur();
    this.setState({ nav });
  };

  /**
   * 复制色值并弹出带操作的 snackbar
   *
   * `copied` 是真正写进剪贴板、也是提示条要原样回显的文本; `color` 是同一个颜色
   * 解析出来的 hex, 只用于定位 收藏 / 查看 / 配色 三个操作指向哪个颜色。
   *
   * 颜色页各格式的复制按钮传 (原文, hex): rgb/hsl/hsv/hsi/cmyk/lab 串 chroma
   * 解析不了, hex 必须由调用方一并给出。其余各页色块只传 DOM 事件或色值串。
   */
  handleColorClick = (eventOrColor: any, knownHex?: string) => {
    let color: string | null = null;
    let copied: string | null = null;

    if (knownHex && typeof eventOrColor === 'string') {
      // 颜色页各格式的复制: 原文 chroma 解析不了, hex 由调用方给出
      color = knownHex;
      copied = eventOrColor;
    } else if (eventOrColor?.currentTarget?.style) {
      color = colorFromBackgroundColor(eventOrColor.currentTarget.style.backgroundColor, this.state.setting);
      copied = color;
    } else if (typeof eventOrColor === 'string') {
      try {
        const c = chroma(eventOrColor);
        color = c.hex();
        copied = eventOrColor;
      } catch {}
    }

    // 「色值去 #」只作用于复制出去的文本: 各格式串里没有 #, 去掉是空操作
    if (copied && this.state.setting) copied = copied.replace(/#/g, '');

    if (color && copied) {
      copyText(copied);
      this.setState({
        messageData: { color, key: Date.now(), text: `已复制 "${copied}"` },
        openMessage: true,
      });
    }
  };

  handleCollectColor = () => {
    const { color } = this.state.messageData;
    if (!color || !!db.get(collectDocId(color))) return;
    if (!saveCollectedColor(color)) {
      // 走到这里说明色值非法或 db 写入失败(已收藏的情况上面已拦下):
      // 保留提示条上的操作按钮, 只换提示文本
      this.setState({ messageData: { ...this.state.messageData, text: "收藏失败，请重试" } });
      return;
    }
    this.setState({ collectVersion: this.state.collectVersion + 1 });
    this.showMessage(`已收藏 "${color}"，可在「收藏颜色」中查看`);
  };

  handleViewCollectedColors = () => {
    this.setState({ nav: "collect", openMessage: false });
  };

  handleViewColorInfo = () => {
    if (this.state.messageData.color) {
      this.setState({ nav: "color", colorValue: [this.state.messageData.color], openMessage: false });
    }
  };

  handleColorToAi = () => {
    if (this.state.messageData.color) {
      this.setState({ nav: "ai", colorValue: [this.state.messageData.color], openMessage: false });
    }
  };

  handleSnackbarClose = (_event: any, reason: string) => {
    if (reason === "clickaway") return;
    this.setState({ openMessage: false });
  };

  showMessage = (msg: string) => {
    this.setState({ messageData: { key: Date.now(), color: "", text: msg }, openMessage: true });
  };

  handleSettingCheckboxChange = (e: any) => {
    if (e.target.checked) {
      dbStorage.setItem("setting", true);
    } else {
      dbStorage.removeItem("setting");
    }
    this.setState({ setting: e.target.checked });
  };

  // 平台生命周期
  componentDidMount() {
    onPluginEnter(({ code, type, payload }: any) => {
      const setting = !!dbStorage.getItem("setting");

      if (code === "image") {
        let imagePayload: string | null = null;
        if (type === "img") {
          imagePayload = payload;
        } else if (type === "files") {
          imagePayload = payload?.[0]?.path || null;
        }
        this.setState({ nav: "image", imagePayload, setting });
        return;
      }

      if (code === "pickercolor") {
        screenColorPick(({ hex }) => {
          this.setState({ nav: "color", colorValue: [hex], setting });
        });
        return;
      }
      if (code === "color" && type === "regex") {
        this.setState({ nav: "color", colorValue: [payload], setting });
        return;
      }

      this.setState({ nav: code, setting });
    });

    onPluginOut(() => {
      this.setState({ nav: "", openMessage: false });
    });

    const setting = !!dbStorage.getItem("setting");
    if (setting !== this.state.setting) {
      this.setState({ setting });
    }

    // 非平台环境默认
    if (!isPlatform && !this.state.nav) {
      this.setState({ nav: "color" });
    }
  }

  render() {
    const { nav, colorValue, openMessage, messageData, setting, imagePayload, collectVersion } = this.state;
    // 星标状态以 db 实时为准: 提示条跨页面存活, 期间收藏可能被增删
    const favorited = !!messageData.color && !!db.get(collectDocId(messageData.color));

    // 页面内容
    let pageContent: React.ReactNode;
    switch (nav) {
      case "color":
        pageContent = <ColorPage value={colorValue} onColorClick={this.handleColorClick} setting={setting} showMessage={this.showMessage} />;
        break;
      case "ui":
        pageContent = <UIPalettesPage onColorClick={this.handleColorClick} />;
        break;
      case "traditional":
        pageContent = <TraditionalColorsPage onColorClick={this.handleColorClick} />;
        break;
      case "gradient":
        pageContent = <GradientsPage onColorClick={this.handleColorClick} showMessage={this.showMessage} />;
        break;
      case "image":
        pageContent = <ImagePalettePage onColorClick={this.handleColorClick} initialImage={imagePayload} />;
        break;
      case "collect":
        pageContent = <CollectColorsPage onColorClick={this.handleColorClick} key={collectVersion} />;
        break;
      case "ai":
        pageContent = <AIPalettePage value={colorValue} onColorClick={this.handleColorClick} setting={setting} showMessage={this.showMessage} key={colorValue?.[0]} />;
        break;
      default:
        pageContent = false;
    }

    return (
      <div className="app-body">
        <div className="app-nav">
          <List className="app-side-list">
            {navItems.map(item => (
              <ListItem disablePadding key={item.key}>
                <ListItemButton
                  tabIndex={-1}
                  selected={nav === item.key}
                  onClick={this.handleNavChange(item.key)}
                >
                  <ListItemIcon className="app-nav-icon">{item.icon}</ListItemIcon>
                  <ListItemText primary={item.label} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
          <Tooltip
            disableFocusListener
            placement="right"
            title='点击复制的色值不包含 "#"。"rgb"... 标识'
          >
            <FormControlLabel
              onChange={this.handleSettingCheckboxChange}
              checked={setting}
              className="app-setting"
              sx={{ userSelect: 'none' }}
              control={<Checkbox disableFocusRipple tabIndex={-1} color="default" size="small" />}
              label='色值去 "#"'
            />
          </Tooltip>
        </div>
        <div className="app-content">
          <Suspense fallback={<div className="page-loading" />}>
            {pageContent}
          </Suspense>
        </div>
        <Snackbar
          anchorOrigin={{ horizontal: 'right', vertical: 'top' }}
          open={openMessage}
          autoHideDuration={3000}
          onClose={this.handleSnackbarClose}
          // pre-line: 复制 rgb/hsl 时提示要给色值换行, 默认 white-space 会把换行折成空格
          message={<span style={{ whiteSpace: 'pre-line' }}>{messageData.text}</span>}
          action={messageData.color ? (
            <>
              {/* 「查看」的去处是颜色页, 已经在颜色页上时点下去只会把同一个色
                  再追加成色板里的重复色块, 所以不显示。按当前页面判断:
                  提示条跨页面存活, 弹出时所在的页面说明不了现在 */}
              {nav !== "color" && (
                <Button
                  disableFocusRipple
                  tabIndex={-1}
                  startIcon={<PaletteIcon />}
                  style={{ marginRight: '10px' }}
                  variant="contained"
                  color="primary"
                  size="small"
                  onClick={this.handleViewColorInfo}
                >
                  查看
                </Button>
              )}
              <Tooltip
                disableFocusListener
                placement="top"
                title={favorited ? '已收藏，点此查看收藏列表' : '收藏这个颜色'}
              >
                <Button
                  disableFocusRipple
                  tabIndex={-1}
                  startIcon={favorited ? <StarIcon /> : <StarBorderIcon />}
                  style={{ marginRight: '10px' }}
                  variant="contained"
                  color={favorited ? 'success' : 'primary'}
                  size="small"
                  onClick={favorited ? this.handleViewCollectedColors : this.handleCollectColor}
                >
                  收藏
                </Button>
              </Tooltip>
              <Button
                disableFocusRipple
                tabIndex={-1}
                startIcon={<ColorizeIcon />}
                style={{ marginRight: '10px' }}
                variant="contained"
                color="primary"
                size="small"
                onClick={this.handleColorToAi}
              >
                配色
              </Button>
            </>
          ) : undefined}
          key={messageData.key}
        />
      </div>
    );
  }
}

export default App;
