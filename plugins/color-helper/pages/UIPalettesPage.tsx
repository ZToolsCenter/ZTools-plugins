import { Component, PureComponent } from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { db } from '../utils/platform';
import flatUIData from '../data/ui-flat-ui.json';
import fluentData from '../data/ui-fluent.json';
import openColorData from '../data/ui-open-color.json';
import antDesignData from '../data/ui-ant-design.json';
import materialDesignData from '../data/ui-material-design.json';
import type {
  FlatUIColorCategory, MaterialColorCategory, UIColorCategory,
} from '../types';

/**
 * UIPalettesPage - UI色卡页面
 * 
 * 展示主流 UI 设计系统的色板: Flat UI / Fluent / Open Color / Ant Design / Material Design
 * 点击色块可复制颜色值
 */

class FlatUIColors extends PureComponent<{ onColorClick: (e: any) => void; data: FlatUIColorCategory[] }> {
  render() {
    return (
      <div className="ui-color-body">
        {this.props.data.map((group, gi) => (
          <div className="flat-ui-box" key={gi}>
            <div className="flat-ui-title">{group.title}</div>
            <div className="flat-ui-colors">
              {group.colors.map((pair, ci) => (
                <div key={ci}>
                  {pair.map((color, pi) => (
                    <div
                      key={pi}
                      style={{ backgroundColor: color }}
                      onClick={this.props.onColorClick}
                    >
                      <span>{color.substr(1)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
}

class FluentColors extends PureComponent<{ onColorClick: (e: any) => void; data: UIColorCategory[] }> {
  render() {
    return (
      <div className="ui-color-body">
        {this.props.data.map((group, gi) => (
          <div className="flat-ui-box" key={gi}>
            <div className="flat-ui-title">{group.title}</div>
            <div className="fluent-ui-colors">
              {group.colors.map((color, ci) => (
                <div key={ci}>
                  <div
                    style={{ backgroundColor: color }}
                    onClick={this.props.onColorClick}
                  >
                    <span>{color.substr(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
}

class OpenColors extends PureComponent<{ onColorClick: (e: any) => void; data: UIColorCategory[] }> {
  render() {
    return (
      <div className="ui-color-body">
        <div className="ui-color-header">
          <div />
          <div>
            {[0,1,2,3,4,5,6,7,8,9].map(n => <div key={n}>{n}</div>)}
          </div>
        </div>
        <div>
          {this.props.data.map((group, gi) => (
            <div className="ui-color-row" key={gi}>
              <div>{group.title}</div>
              <div style={{ fontSize: '1.5vw' }}>
                {group.colors.map((color, ci) => (
                  <div key={ci}>
                    <div
                      style={{ backgroundColor: color }}
                      onClick={this.props.onColorClick}
                    >
                      {/* 色阶按浅→深排列: 前 5 档是浅色档配深字, 其余深色档配白字 */}
                      <span style={{ color: ci < 5 ? '#000' : '#FFF' }}>{color.substr(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
}

class AntDesignColors extends PureComponent<{ onColorClick: (e: any) => void; data: UIColorCategory[] }> {
  render() {
    return (
      <div className="ui-color-body">
        <div className="ui-color-header">
          <div />
          <div>
            {[1,2,3,4,5,6,7,8,9,10].map(n => <div key={n}>{n}</div>)}
          </div>
        </div>
        <div>
          {this.props.data.map((group, gi) => (
            <div className="ui-color-row" key={gi}>
              <div>{group.title}</div>
              <div style={{ fontSize: '1.5vw' }}>
                {group.colors.map((color, ci) => (
                  <div key={ci}>
                    <div
                      style={{ backgroundColor: color }}
                      onClick={this.props.onColorClick}
                    >
                      {/* 色阶按浅→深排列: 前 5 档是浅色档配深字, 其余深色档配白字 */}
                      <span style={{ color: ci < 5 ? '#000' : '#FFF' }}>{color.substr(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
}

class MaterialDesignColors extends PureComponent<{ onColorClick: (e: any) => void; data: MaterialColorCategory[] }> {
  render() {
    return (
      <div className="ui-color-body">
        <div className="ui-color-header">
          <div />
          <div>
            {["50","100","200","300","400","500","600","700","800","900"].map(n => (
              <div key={n}>{n}</div>
            ))}
            {["A100","A200","A300","A400"].map(n => (
              <div key={n} style={n === "A100" ? { borderLeft: '1px solid #EEE', marginLeft: '-1px' } : {}}>{n}</div>
            ))}
          </div>
        </div>
        <div>
          {this.props.data.map((group, gi) => (
            <div className="ui-color-row" key={gi}>
              <div>{group.title}</div>
              <div style={{ fontSize: '1.1vw' }}>
                {group.colors.map((color, ci) => (
                  <div key={ci}>
                    {color ? (
                      <div
                        style={{ backgroundColor: color }}
                        onClick={this.props.onColorClick}
                      >
                      {/* 色阶按浅→深排列: 前 5 档是浅色档配深字, 其余深色档配白字 */}
                      <span style={{ color: ci < 5 ? '#000' : '#FFF' }}>{color.substr(1)}</span>
                      </div>
                    ) : <div />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
}

interface UIPalettesState {
  ui: string;
}

class UIPalettesPage extends Component<{ onColorClick: (e: any) => void }, UIPalettesState> {
  constructor(props: { onColorClick: (e: any) => void }) {
    super(props);

    this.handleTabChange = this.handleTabChange.bind(this);

    const saved = db.get("uicolor");
    let ui = "flat";
    if (saved && ["flat","fluent","open","antd","material"].includes(saved.ui)) {
      ui = saved.ui;
    }
    this.state = { ui };
  }

  handleTabChange(_e: any, value: string) {
    this.setState({ ui: value });
  }

  getTabContent() {
    const flatData = flatUIData as unknown as FlatUIColorCategory[];
    const fluentDataT = fluentData as unknown as UIColorCategory[];
    const openColorDataT = openColorData as unknown as UIColorCategory[];
    const antDesignDataT = antDesignData as unknown as UIColorCategory[];
    const materialDesignDataT = materialDesignData as unknown as MaterialColorCategory[];
    switch (this.state.ui) {
      case "flat": return <FlatUIColors onColorClick={this.props.onColorClick} data={flatData} />;
      case "fluent": return <FluentColors onColorClick={this.props.onColorClick} data={fluentDataT} />;
      case "open": return <OpenColors onColorClick={this.props.onColorClick} data={openColorDataT} />;
      case "antd": return <AntDesignColors onColorClick={this.props.onColorClick} data={antDesignDataT} />;
      case "material": return <MaterialDesignColors onColorClick={this.props.onColorClick} data={materialDesignDataT} />;
      default: return false;
    }
  }

  // Tab 切换只更新 state, 离开页面时才持久化: 避免每次点 Tab 都写一次 db
  componentWillUnmount() {
    const saved = db.get("uicolor") || { _id: "uicolor", ui: "flat" };
    if (saved.ui !== this.state.ui) {
      saved.ui = this.state.ui;
      db.put(saved);
    }
  }

  render() {
    return (
      <div className="ui-content">
        <div>
          <Tabs value={this.state.ui} onChange={this.handleTabChange}>
            <Tab className="ui-tab" disableFocusRipple value="flat" label="Flat UI" />
            <Tab className="ui-tab" disableFocusRipple value="fluent" label="Fluent Design" />
            <Tab className="ui-tab" disableFocusRipple value="open" label="Open Color" />
            <Tab className="ui-tab" disableFocusRipple value="antd" label="Ant Design" />
            <Tab className="ui-tab" disableFocusRipple value="material" label="Material Design" />
          </Tabs>
        </div>
        <div>{this.getTabContent()}</div>
      </div>
    );
  }
}

export default UIPalettesPage;
