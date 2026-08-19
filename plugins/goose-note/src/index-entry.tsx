/**
 * 主应用入口（index.html → 本文件）。
 *
 * 复用 main.tsx 的共享 bootstrap（host fs / 迁移 / hydration / guard），
 * 仅在此处 import 完整 workspace <App/> 并启动。
 *
 * 之所以把 <App/> 的 import 收敛到这里、而不放进共享的 main.tsx：
 * 速记小窗（quicknote.tsx）也 import 同一个 bootstrap，若 main.tsx 静态引用 <App/>，
 * 整个 workspace（echarts / PDF 导出 / AI 图表等）会被拖进小窗依赖图，令小窗包白白膨胀数 MB。
 */
import App from "./App.tsx";
import { bootstrap } from "./main";
import "@blocknote/xl-ai/style.css";

void bootstrap(() => <App />);
