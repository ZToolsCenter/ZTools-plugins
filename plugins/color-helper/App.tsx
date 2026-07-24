import React, { Component } from 'react';
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
import ColorizeIcon from '@mui/icons-material/Colorize';
import chroma from 'chroma-js';
import ColorPage from './pages/ColorPage';
import UIPalettesPage from './pages/UIPalettesPage';
import TraditionalColorsPage from './pages/TraditionalColorsPage';
import GradientsPage from './pages/GradientsPage';
import ImagePalettePage from './pages/ImagePalettePage';
import CollectColorsPage from './pages/CollectColorsPage';
import AIPalettePage from './pages/AIPalettePage';
import { copyText, dbStorage, screenColorPick, onPluginEnter, onPluginOut, isPlatform } from './utils/platform';

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

// 导航项
const navItems = [
  { key: "color", label: "颜色", icon: <PaletteIcon /> },
  { key: "ai", label: "AI 配色", icon: <AutoAwesomeIcon /> },
  { key: "ui", label: "UI 色卡", icon: <ViewCompactIcon /> },
  { key: "image", label: "图片色卡", icon: <ImageIcon /> },
  { key: "traditional", label: "传统色", icon: <BrushIcon /> },
  { key: "gradient", label: "渐变色", icon: <GradientIcon /> },
  { key: "collect", label: "收藏颜色", icon: <StarIcon /> },
];

interface AppState {
  nav: string;
  colorValue: (string | null)[];
  openMessage: boolean;
  messageData: { key: number; color: string; body?: string };
  setting: boolean;
}

class App extends Component<{}, AppState> {
  private imageEnterPayload: any = null;

  state: AppState = {
    nav: "",
    colorValue: [],
    openMessage: false,
    messageData: { key: 0, color: "" },
    setting: false,
  };

  handleNavChange = (nav: string) => () => {
    (document.activeElement as HTMLElement)?.blur();
    this.setState({ nav });
  };

  handleColorClick = (eventOrColor: any) => {
    let color: string | null = null;

    if (eventOrColor?.currentTarget?.style) {
      color = colorFromBackgroundColor(eventOrColor.currentTarget.style.backgroundColor, this.state.setting);
    } else if (typeof eventOrColor === 'string') {
      try {
        const c = chroma(eventOrColor);
        color = this.state.setting ? c.hex().substring(1) : c.hex();
      } catch {}
    }

    if (color) {
      copyText(color);
      this.setState({
        messageData: { color, key: Date.now() },
        openMessage: true,
      });
    }
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
    this.setState({ messageData: { key: Date.now(), color: "", body: msg }, openMessage: true });
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
        if (type === "img") {
          this.imageEnterPayload = payload;
        } else if (type === "files") {
          this.imageEnterPayload = payload?.[0]?.path;
        } else {
          this.imageEnterPayload = null;
        }
      } else {
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
        if (code === "ai" && type === "regex") {
          this.setState({ nav: "ai", colorValue: [payload], setting });
          return;
        }
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
    const { nav, colorValue, openMessage, messageData, setting } = this.state;

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
        pageContent = <GradientsPage onColorClick={this.handleColorClick} />;
        break;
      case "image":
        pageContent = <ImagePalettePage onColorClick={this.handleColorClick} />;
        break;
      case "collect":
        pageContent = <CollectColorsPage onColorClick={this.handleColorClick} />;
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
          {pageContent}
        </div>
        <Snackbar
          anchorOrigin={{ horizontal: 'right', vertical: 'top' }}
          open={openMessage}
          autoHideDuration={3000}
          onClose={this.handleSnackbarClose}
          message={messageData.color ? `已复制 "${messageData.color}"` : messageData.body}
          action={messageData.color ? (
            <>
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
            </>
          ) : undefined}
          key={messageData.key}
        />
      </div>
    );
  }
}

export default App;
