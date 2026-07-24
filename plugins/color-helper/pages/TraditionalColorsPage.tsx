import React, { Component } from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import chroma from 'chroma-js';
import chinaColors from '../data/traditional-china.json';
import japanColors from '../data/traditional-japan.json';

/**
 * TraditionalColorsPage - 传统色页面
 * 
 * 展示中国传统色/日本传统色色板，支持搜索和收藏
 * 点击色块可复制颜色值，长按可收藏/取消收藏
 */

// 颜色属性分类(tag + dark)
function getColorAttr(color: string): { tag: string; dark: boolean } {
  const c = chroma(color);
  let [h, s, l] = c.hsl();
  const dark = c.get('lab.l') < 70;
  h = isNaN(h) ? 0 : h;
  let tag: string;
  if (l < 0.2) tag = "black";
  else if (l > 0.85) tag = "white";
  else if (s < 0.2) tag = "gray";
  else if (h < 26) tag = "red";
  else if (h < 50) tag = "orange";
  else if (h < 70) tag = "yellow";
  else if (h < 165) tag = "green";
  else if (h < 190) tag = "cyan";
  else if (h < 265) tag = "blue";
  else if (h < 320) tag = "magenta";
  else tag = "red";
  return { tag, dark };
}

// AD数组
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

// 预处理颜色数据
// 中国传统色数据: nc = JSON.parse(...) - 按节气分组
interface ChinaColorItem {
  name: string;
  color: string;
  attr?: { tag: string; dark: boolean };
}

interface ChinaColorGroup {
  title: string;
  colors: ChinaColorItem[];
}

// 日本传统色数据: tc = JSON.parse(...) - 扁平列表
interface JapanColorItem {
  name: string;
  jname: string;
  color: string;
  attr?: { tag: string; dark: boolean };
}

const ncData: ChinaColorGroup[] = (chinaColors as any[]).map((group: any) => ({
  title: group.title,
  colors: group.colors.map((c: any) => ({
    name: c.name,
    color: c.color,
  })),
}));

const tcData: JapanColorItem[] = (japanColors as any[]).map((c: any) => ({
  name: c.name,
  jname: c.jname || c.romaji || "",
  color: c.color,
}));

// 中国传统色
interface ChinaColorsProps {
  onColorClick: (e: any) => void;
  searchName: string;
  filterColor: string;
}

interface ChinaColorsState {
  colors: ChinaColorGroup[];
}

class ChinaColors extends Component<ChinaColorsProps, ChinaColorsState> {
  constructor(props: ChinaColorsProps) {
    super(props);
    // 初始化attr=> { o.colors.forEach(s => { s.attr = o8(s.color) }) })"
    if (!ncData[0]?.colors[0]?.attr) {
      ncData.forEach(group => {
        group.colors.forEach(c => {
          c.attr = getColorAttr(c.color);
        });
      });
    }
    this.state = { colors: ncData };
  }

  filterBySearchName = () => {
    const result: ChinaColorGroup[] = [];
    ncData.forEach(group => {
      const filtered = group.colors.filter(c => c.name.indexOf(this.props.searchName) !== -1);
      if (filtered.length > 0) {
        result.push({ title: group.title, colors: filtered });
      }
    });
    this.setState({ colors: result });
  };

  filterByFilterColor = () => {
    const result: ChinaColorGroup[] = [];
    ncData.forEach(group => {
      const filtered = group.colors.filter(c => c.attr!.tag === this.props.filterColor);
      if (filtered.length > 0) {
        result.push({ title: group.title, colors: filtered });
      }
    });
    this.setState({ colors: result });
  };

  componentDidMount() {
    if (this.props.searchName) return this.filterBySearchName();
    if (this.props.filterColor) this.filterByFilterColor();
  }

  componentDidUpdate(prev: ChinaColorsProps) {
    if (prev.searchName !== this.props.searchName) {
      if (this.props.searchName) return this.filterBySearchName();
      if (prev.filterColor === this.props.filterColor) return this.setState({ colors: ncData });
    }
    if (prev.filterColor !== this.props.filterColor) {
      if (this.props.filterColor) this.filterByFilterColor();
      else this.setState({ colors: ncData });
    }
  }

  render() {
    const { colors } = this.state;
    return (
      <div className="traditional-gugong">
        {colors.map((group, gi) => (
          <div className="traditional-gugong-box" key={gi}>
            <h1 className="traditional-gugong-title">{group.title}</h1>
            <div className="traditional-gugong-colors">
              {group.colors.map((c, ci) => (
                <div
                  key={`${gi}-${ci}`}
                  onClick={this.props.onColorClick}
                  style={{ backgroundColor: c.color, color: c.attr!.dark ? "#fff" : "#212121" }}
                >
                  <div>{c.name}</div>
                  <div>{c.color}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
}

// 日本传统色
interface JapanColorsProps {
  onColorClick: (e: any) => void;
  searchName: string;
  filterColor: string;
}

interface JapanColorsState {
  colors: JapanColorItem[];
}

class JapanColors extends Component<JapanColorsProps, JapanColorsState> {
  constructor(props: JapanColorsProps) {
    super(props);
    // 初始化attr=> { o.attr = o8(o.color) })"
    if (!tcData[0]?.attr) {
      tcData.forEach(c => {
        c.attr = getColorAttr(c.color);
      });
    }
    this.state = { colors: tcData };
  }

  filterBySearchName = () => {
    const result = tcData.filter(c => c.name.indexOf(this.props.searchName) !== -1 || c.jname.indexOf(this.props.searchName) !== -1);
    this.setState({ colors: result });
  };

  filterByFilterColor = () => {
    const result = tcData.filter(c => c.attr!.tag === this.props.filterColor);
    this.setState({ colors: result });
  };

  componentDidMount() {
    if (this.props.searchName) return this.filterBySearchName();
    if (this.props.filterColor) this.filterByFilterColor();
  }

  componentDidUpdate(prev: JapanColorsProps) {
    if (prev.searchName !== this.props.searchName) {
      if (this.props.searchName) return this.filterBySearchName();
      if (prev.filterColor === this.props.filterColor) return this.setState({ colors: tcData });
    }
    if (prev.filterColor !== this.props.filterColor) {
      if (this.props.filterColor) this.filterByFilterColor();
      else this.setState({ colors: tcData });
    }
  }

  render() {
    const { colors } = this.state;
    return (
      <div className="traditional-japan">
        {colors.map((c, i) => (
          <div
            key={i}
            onClick={this.props.onColorClick}
            style={{ backgroundColor: c.color, color: c.attr!.dark ? "#fff" : "#333" }}
          >
            <div>{c.name}</div>
            <div>{c.jname}</div>
            <div>{c.color}</div>
          </div>
        ))}
      </div>
    );
  }
}

// 传统色主页面
interface TraditionalPageState {
  nav: string;
  searchName: string;
  filterColor: string;
}

class TraditionalColorsPage extends Component<{ onColorClick: (e: any) => void }, TraditionalPageState> {
  private contentRef: HTMLDivElement | null = null;

  constructor(props: { onColorClick: (e: any) => void }) {
    super(props);
    this.state = {
      nav: "china",
      searchName: "",
      filterColor: "",
    };
  }

  handleTabChange = (_e: any, value: string) => {
    this.setState({ nav: value });
    if (this.contentRef && this.contentRef.scrollTop > 0) {
      this.contentRef.scrollTop = 0;
    }
  };

  handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (this.contentRef && this.contentRef.scrollTop > 0) {
      this.contentRef.scrollTop = 0;
    }
    this.setState({ searchName: e.target.value, filterColor: "" });
  };

  handleFilterColor = (id: string) => () => {
    if (this.contentRef && this.contentRef.scrollTop > 0) {
      this.contentRef.scrollTop = 0;
    }
    if (id === this.state.filterColor) {
      this.setState({ searchName: "", filterColor: "" });
      return;
    }
    this.setState({ searchName: "", filterColor: id });
  };

  render() {
    const { nav, searchName, filterColor } = this.state;

    return (
      <div className="traditional-body">
        <div className="traditional-nav">
          <Tabs value={nav} onChange={this.handleTabChange}>
            <Tab disableFocusRipple value="china" label="中国传统色 • 故宫 24 节气" />
            <Tab disableFocusRipple value="japan" label="日本传统色" />
          </Tabs>
        </div>
        <div className="traditional-header">
          <div>
            <TextField
              value={searchName}
              onChange={this.handleSearchInputChange}
              size="small"
              variant="standard"
              fullWidth
              placeholder="名称搜索"
              InputProps={{
                endAdornment: searchName ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => this.setState({ searchName: "", filterColor: "" })}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
            />
          </div>
          <div>
            {filterColors.map(fc => (
              <div
                key={fc.id}
                title="只显示相近颜色"
                onClick={this.handleFilterColor(fc.id)}
                style={{ backgroundColor: fc.color }}
              >
                {filterColor === fc.id && <CheckIcon />}
              </div>
            ))}
          </div>
        </div>
        <div ref={el => { this.contentRef = el; }} className="traditional-content">
          {nav === "china" && <ChinaColors onColorClick={this.props.onColorClick} searchName={searchName} filterColor={filterColor} />}
          {nav === "japan" && <JapanColors onColorClick={this.props.onColorClick} searchName={searchName} filterColor={filterColor} />}
        </div>
      </div>
    );
  }
}

export default TraditionalColorsPage;
