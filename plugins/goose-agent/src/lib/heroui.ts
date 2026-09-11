/**
 * HeroUI 统一入口。
 * 新业务 UI 优先从此导入；禁止再手写平行 shadcn 业务控件。
 * 完整约定见 docs/adr/0009-heroui-ui.md · https://heroui.com/
 *
 * 新功能先查 https://heroui.com/ 是否已有组件；有则用，禁止手写平行实现。
 * 需要尚未 re-export 的组件时从 @heroui/react 引入，并顺手补进本文件。
 */
export {
  // 基础操作
  Button,
  ButtonGroup,
  CloseButton,
  ToggleButton,
  ToggleButtonGroup,
  // 输入
  Input,
  TextArea,
  TextField,
  InputGroup,
  NumberField,
  TimeField,
  SearchField,
  Form,
  FieldError,
  Description,
  Label,
  Checkbox,
  CheckboxGroup,
  Radio,
  RadioGroup,
  Switch,
  SwitchGroup,
  Slider,
  // 选择 / 列表
  Select,
  ListBox,
  ComboBox,
  Autocomplete,
  Dropdown,
  // 反馈 / 覆盖层
  Tooltip,
  Popover,
  Modal,
  Alert,
  AlertDialog,
  Drawer,
  /** Toast 组件树；业务 API 优先用 `@/lib/toast`（含 error→danger 别名） */
  Toast,
  Spinner,
  ProgressBar,
  ProgressCircle,
  Meter,
  Skeleton,
  EmptyState,
  // 展示
  Avatar,
  Badge,
  Chip,
  Tag,
  TagGroup,
  Card,
  Surface,
  Separator,
  ScrollShadow,
  Kbd,
  Link,
  Header,
  Toolbar,
  // 导航 / 结构
  Tabs,
  Accordion,
  Disclosure,
  Breadcrumbs,
  Pagination,
  // 其它
  useOverlayState,
} from "@heroui/react";
