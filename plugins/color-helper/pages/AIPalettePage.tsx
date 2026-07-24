import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Divider from '@mui/material/Divider';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import ColorizeIcon from '@mui/icons-material/Colorize';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { styled } from '@mui/material/styles';
import chroma from 'chroma-js';
import iro from '@jaames/iro';
import { dbStorage, screenColorPick, aiChat, isAIAvailable } from '../utils/platform';

/**
 * AIPalettePage - AI配色方案生成页面
 * 
 * 核心功能:
 * - 用户选择主色、风格、色系、配色数量
 * - 调用 AI 生成配色方案(每个配色包含 hex/名称/描述)
 * - 支持屏幕取色、随机色
 * - 配色结果可点击复制
 */

/** AI 返回的配色项 */
interface AIPaletteItem {
  hex: string;
  name: string;
  description: string;
}

/** 解析 AI 返回的 JSON 字符串 */
function parseAIResponse(content: string): AIPaletteItem[] {
  if (content.startsWith("{")) return JSON.parse(content);
  return JSON.parse(content.replace(/^```json\n/, "").replace(/\n```$/, ""));
}

// useLocalStorage - 持久化状态到 dbStorage
function useLocalStorage<T>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => dbStorage.getItem(key) ?? defaultValue);
  useEffect(() => {
    dbStorage.setItem(key, value);
  }, [key, value]);
  return [value, setValue];
}

/** AI 配色风格选项 */
const AI_STYLES = ["现代", "复古", "自然", "活泼", "浪漫"];
/** AI 配色色系选项 */
const AI_THEMES = ["暖", "冷"];
/** AI 配色数量选项 */
const AI_COUNTS = [3, 4, 5, 6, 7, 8];

/** 设置行样式: 标签 + 值横向排列 */
const StyleRow = styled('div')({
  display: 'flex',
  flexDirection: "row",
  alignItems: "center",
  width: "100%",
  marginBottom: "44px",
  whiteSpace: "nowrap",
  ">.label": { marginRight: "30px" },
  ">.value": { width: 28, height: 28, boxSizing: "border-box", borderRadius: "4px" },
});

/** ChipSelect - 色块选择器组件，用于风格/色系/数量选择 */
interface ChipSelectProps {
  data: any[];
  value: any;
  size: number | [number, number];
  shape?: string;
  onChange: (v: any, item?: any) => void;
}

function ChipSelect({ data, value, size, shape, onChange }: ChipSelectProps) {
  const [width, height] = useMemo(() => {
    if (Array.isArray(size)) {
      const [w = 22, h = w] = size;
      return [w, h];
    }
    const s = size ?? 22;
    return [s, s];
  }, [size]);

  const borderRadius = useMemo(() => {
    if (shape === "circle") {
      const dims = [width, height].filter(v => typeof v === "number" && v > 0 && !Number.isNaN(v));
      return dims.length === 0 ? 4 : Math.min(...dims) / 2;
    }
    return 4;
  }, [width, height, shape]);

  return (
    <Stack direction="row" flexWrap="wrap" gap="10px">
      {data?.map(item => {
        const val = typeof item === "object" ? (item.value ?? item.label) : String(item);
        const label = typeof item === "object" ? (item.label ?? item.value) : String(item);
        return (
          <Button
            key={String(item)}
            sx={{
              minWidth: 0,
              minHeight: 0,
              margin: 0,
              padding: 0,
              width,
              height,
              fontSize: 12,
              lineHeight: "12px",
              borderRadius: `${borderRadius}px`,
              "&.MuiButtonBase-root": {
                boxShadow: "none",
                border: "#E0E0E0 solid 1px",
                background: String(value) === String(val) ? "#E0E0E0" : undefined,
                color: "#000",
                boxSizing: "border-box",
                px: 1.5,
              },
              textTransform: "none",
            }}
            variant="outlined"
            onClick={() => onChange(val, item)}
          >
            {label}
          </Button>
        );
      })}
    </Stack>
  );
}

// 空配色占位
function EmptyPalette() {
  return (
    <Stack height="100%" alignItems="center" sx={{ userSelect: 'none' }}>
      <Stack position="relative" mt={20}>
        <Box width={35} height={80} borderRadius={2} sx={{ background: 'linear-gradient(180deg, #D8D8D8 0%, #FFFFFF 100%)' }} />
        <Box bgcolor="#fff" position="absolute" top="50%" left="50%" sx={{ transform: 'translate(-50%, -50%)', whiteSpace: 'nowrap', py: 0.2, color: '#D8D8D8' }}>
          暂无配色
        </Box>
      </Stack>
    </Stack>
  );
}

// iro ColorPicker组件
interface IroPickerProps {
  color: string;
  onChange: (hex: string) => void;
}

function IroPicker({ color, onChange }: IroPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<any>(null);
  // 保持 onChange 引用最新，避免事件回调中使用过期的闭包
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;
    if (pickerRef.current) {
      const c = chroma.valid(color) ? chroma(color) : null;
      if (c) pickerRef.current.color.hexString = c.hex();
      return;
    }
    pickerRef.current = new iro.ColorPicker(containerRef.current, {
      width: 190,
      borderWidth: 1,
      handleSvg: "#colorHandle",
      layout: [
        { component: iro.ui.Wheel, options: { wheelDirection: "clockwise", wheelAngle: -90 } },
        { component: iro.ui.Slider, options: { sliderType: "saturation" } },
        { component: iro.ui.Slider },
      ],
    });
    const handleChange = (c: any) => onChangeRef.current(c.hexString);
    pickerRef.current.on("input:change", handleChange);
    const c = chroma.valid(color) ? chroma(color) : null;
    if (c) pickerRef.current.color.hexString = c.hex();

    return () => {
      if (pickerRef.current) {
        pickerRef.current.off("input:change", handleChange);
      }
    };
  }, [color]);

  return (
    <>
      <svg style={{ display: "none" }}>
        <defs>
          <g id="colorHandle">
            <circle cx="8" cy="8" r="8" fill="none" strokeWidth="1" stroke="#fff" />
          </g>
        </defs>
      </svg>
      <div ref={containerRef} />
    </>
  );
}

// 颜色选择弹窗
interface ColorPickerDialogProps {
  color: string;
  open: boolean;
  onClose: () => void;
  onSubmit: (color: string) => void;
}

function ColorPickerDialog({ color, open, onClose, onSubmit }: ColorPickerDialogProps) {
  const [inputColor, setInputColor] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && color) setInputColor(color);
  }, [color, open]);

  useEffect(() => {
    if (!open) {
      setInputColor("");
      setError("");
    }
  }, [open]);

  return (
    <Dialog open={!!open} onClose={onClose}>
      <DialogTitle>输入颜色</DialogTitle>
      <DialogContent>
        <Stack alignItems="center" width={300}>
          <IroPicker color={inputColor} onChange={setInputColor} />
          <TextField
            autoFocus
            variant="standard"
            value={inputColor}
            error={!!error}
            onChange={e => setInputColor(e.target.value)}
            fullWidth
            helperText={error || "任意格式的色 值"}
            margin="normal"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disableFocusRipple tabIndex={-1} onClick={onClose}>取消</Button>
        <Button disableFocusRipple tabIndex={-1} onClick={() => {
          if (!inputColor) { setError("请输入颜色"); return; }
          const c = chroma.valid(inputColor) ? chroma(inputColor) : null;
          if (!c) { setError("错误的色值"); return; }
          onSubmit(c.hex());
          onClose();
        }}>确定</Button>
      </DialogActions>
    </Dialog>
  );
}

/** AI配色主页面 - 上次生成结果缓存 */
let lastMainColor = chroma.random().hex();
let lastPalettes: AIPaletteItem[] = [];

interface AIPaletteProps {
  value: (string | null)[];
  onColorClick: (e: any) => void;
  setting: boolean;
  showMessage: (msg: string) => void;
}

const AIPalettePage = memo(function AIPalettePage(props: AIPaletteProps) {
  const [mainColor, setMainColor] = useState("");
  const [style, setStyle] = useLocalStorage("ai/paletteStyle", "现代");
  const [theme, setTheme] = useLocalStorage("ai/paletteTheme", "暖");
  const [count, setCount] = useLocalStorage("ai/paletteCount", 3);
  const [palettes, setPalettes] = useState<AIPaletteItem[]>([]);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [status, setStatus] = useState<"pending" | "loading" | "finished">("pending");

  useEffect(() => {
    setPalettes(lastPalettes);
    if (lastPalettes.length > 0) setStatus("finished");
  }, []);

  useEffect(() => {
    lastPalettes = palettes;
  }, [palettes]);

  const buttonText = useMemo(() => {
    if (status === "loading") return "AI 生成中";
    if (status === "finished") return "AI 重新生成";
    return "AI 生成配色";
  }, [status]);

  /** 调用 AI 生成配色方案 */
  const generate = useCallback(async () => {
    if (!mainColor) return;
    setStatus("loading");

    if (!isAIAvailable()) {
      props.showMessage("当前版本不支持 AI 功能");
      return;
    }

    try {
      const result = await aiChat([
          {
            role: "system",
            content: `
# Role
你是一个颜色配色大师
## Skills
- 读取用户输入的颜色值
- 给读取的颜色选择合适的配色方案,共需要给用户提供 ${count} 个颜色, 配色中不要有 ${mainColor}
- 生成的配色方案必须符合 ${style} 风格
- 生成的配色方案必须符合 ${theme} 色系
- 你给出的每个配色方案必须包含颜色hex值、颜色名称以及颜色描述
- 返回的配色方案以 JSON 数组格式返回
## Actions
- 根据用户输入的颜色值生成合适的配色方案
- 你直接输出 JSON 数组，不再额外输出其他内容
## Example
[{
  "hex": "#E797B7",
  "name": "芭比粉",
  "description": "比主色调更浅淡一些，粉色调更明显，与主色调搭配能营造出柔和温暖且具有现代感的氛围。"
}]
## Input
输入：{颜色值}
## Output
{JSON}
`,
          },
          { role: "user", content: `输入: ${[mainColor]}` },
        ]
      );

      const parsed = parseAIResponse(result.content);
      if (!Array.isArray(parsed)) {
        props.showMessage("AI 生成配色失败");
        return;
      }
      setPalettes(parsed);
    } catch {
      props.showMessage("AI 生成配色失败");
    } finally {
      setStatus("finished");
    }
  }, [mainColor, style, theme, count, props.showMessage]);

  useEffect(() => {
    if (mainColor) {
      lastMainColor = mainColor;
    }
  }, [mainColor]);

  useEffect(() => {
    if (props.value?.[0]) {
      const parsed = parseColorInput(props.value[0]);
      if (!parsed) {
        setMainColor(lastMainColor);
        return;
      }
      setMainColor(parsed.hex());
    } else {
      setMainColor(lastMainColor);
    }
  }, []);

  return (
    <Stack width="100%" height="100%" overflow="hidden" boxSizing="border-box" p={1} sx={{ userSelect: 'none', background: mainColor }}>
      <Card sx={{ height: '100%', width: '100%', overflow: 'hidden', boxSizing: 'border-box', borderRadius: 3 }} variant="outlined">
        <Stack direction="row" alignItems="center" height="100%" overflow="hidden" py={3} boxSizing="border-box">
          {/* 左侧控制区 */}
          <Stack flex={1} boxSizing="border-box" px={3} height="100%">
            {/* 主色行 */}
            <StyleRow>
              <Box className="label">主色</Box>
              <Box
                className="value"
                sx={{
                  backgroundColor: mainColor,
                  border: mainColor === '#ffffff' ? (theme: any) => `1px solid ${theme.palette.divider}` : 'none',
                  cursor: 'pointer',
                }}
                onClick={() => setColorPickerOpen(true)}
              />
              <Stack direction="row" gap="15px" ml="20px" sx={{
                '.MuiButtonBase-root': {
                  boxShadow: 'none',
                  width: 24,
                  height: 24,
                  minWidth: 0,
                  minHeight: 0,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(0,0,0,0.04)',
                  '&:hover,&:active': { boxShadow: 'none', backgroundColor: 'rgba(0,0,0,0.08)' },
                  '.MuiSvgIcon-root': { fontSize: 14 },
                },
              }}>
                <Tooltip placement="right" title="屏幕取色">
                  <IconButton disableFocusRipple size="small" onClick={() => { screenColorPick(({ hex }: any) => { setMainColor(hex); }); }}>
                    <ColorizeIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip placement="right" title="复制颜色">
                  <IconButton disableFocusRipple size="small" onClick={() => { props.onColorClick(mainColor); }}>
                    <ContentCopyIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            </StyleRow>

            {/* 风格行 */}
            <StyleRow>
              <Box className="label">风格</Box>
              <ChipSelect data={AI_STYLES} value={style} size={[46, 26]} shape="circle" onChange={setStyle} />
            </StyleRow>

            {/* 色系行 */}
            <StyleRow>
              <Box className="label">色系</Box>
              <ChipSelect data={AI_THEMES} value={theme} size={[46, 26]} shape="circle" onChange={setTheme} />
            </StyleRow>

            {/* 数量行 */}
            <StyleRow>
              <Box className="label">数量</Box>
              <ChipSelect data={AI_COUNTS} value={count} size={24} onChange={setCount} />
            </StyleRow>

            {/* 生成按钮 */}
            <Stack direction="row" mt="auto" justifyContent="flex-end">
              <Button
                disabled={status === "loading"}
                sx={{
                  "&.MuiButtonBase-root": {
                    color: "#fff",
                    background: "linear-gradient(91deg, #B379F7 0%, #878DF9 99%)",
                    boxShadow: "none",
                    ".MuiSvgIcon-root": { fontSize: 12 },
                    "&:hover,&:active": { color: "#fff", background: "linear-gradient(91deg, #B379F7 0%, #878DF9 99%)", boxShadow: "none" },
                    "&:disabled": { opacity: 0.5 },
                  },
                }}
                variant="contained"
                color="inherit"
                onClick={() => status !== 'loading' && generate()}
                startIcon={<AutoAwesomeIcon />}
              >
                {buttonText}
              </Button>
            </Stack>
          </Stack>

          {/* 分隔线 */}
          <Divider orientation="vertical" flexItem />

          {/* 右侧配色结果 */}
          <Stack width={235} height="100%" overflow="hidden" px={3.5} boxSizing="border-box">
            <Box>配色</Box>
            <Box flex={1}>
              {palettes.length === 0 && <EmptyPalette />}
              <Box mt={3} sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: '1fr', gridGap: '10px' }}>
                {palettes.map((w) => (
                  <Tooltip
                    key={w.hex}
                    title={
                      <Box width={185} boxSizing="border-box" px="11px" pt="12px" pb="17px">
                        <Box fontSize={14}>{w.name} {w.hex}</Box>
                        <Box fontSize={12} mt="12px" lineHeight="20px">{w.description}</Box>
                      </Box>
                    }
                    placement="bottom"
                    componentsProps={{
                      tooltip: { sx: { bgcolor: '#fff', color: '#000', boxShadow: '0px 0px 10px 0px rgba(0, 0, 0, 0.15)', borderRadius: 2 } },
                      arrow: { sx: { color: '#fff' } },
                    }}
                    arrow
                  >
                    <Box
                      sx={{ bgcolor: w.hex, width: 58, height: 58, borderRadius: 1, cursor: 'pointer' }}
                      onClick={() => { props.onColorClick(w.hex); }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </Box>
          </Stack>
        </Stack>
      </Card>
      <ColorPickerDialog color={mainColor} open={colorPickerOpen} onClose={() => setColorPickerOpen(false)} onSubmit={(c) => setMainColor(c)} />
    </Stack>
  );
});

// 解析颜色输入
function parseColorInput(input: string | null): chroma.Color | null {
  if (!input) return null;
  try {
    return chroma(input);
  } catch {
    return null;
  }
}

export default AIPalettePage;
