import React, { Component } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import Fab from '@mui/material/Fab';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import ColorizeIcon from '@mui/icons-material/Colorize';
import chroma from 'chroma-js';
import { db, dbStorage, screenColorPick } from '../utils/platform';

/**
 * CollectColorsPage - 收藏颜色管理页面
 * 
 * 管理用户收藏的颜色，支持分组、拖拽排序、添加/删除
 * 数据持久化到 dbStorage
 */

interface CollectColor {
  _id: string;
  _rev?: string;
  name: string;
  color: string;
  dark?: boolean;
}

// 编辑表单对话框
interface FormDialogProps {
  formData: CollectColor | null;
  onSubmit: (isEdit: boolean) => void;
}

interface FormDialogState {
  open: boolean;
  name: string;
  color: string;
  error: string;
}

class CollectFormDialog extends Component<FormDialogProps, FormDialogState> {
  state: FormDialogState = {
    open: false,
    name: "",
    color: "",
    error: "",
  };

  handleClose = () => {
    this.setState({ open: false });
  };

  handleOk = () => {
    const { name, color } = this.state;
    if (name && name.length > 64) {
      this.setState({ error: "名称长度太长" });
      return;
    }
    this.props.formData!.name = name;
    const isEdit = !!this.props.formData!._id;
    if (!isEdit) {
      const parsed = chroma.valid(color) ? chroma(color) : null;
      if (!parsed) {
        this.setState({ error: "错误的色值" });
        return;
      }
      const hex = parsed.hex();
      const docId = "color/" + hex.substring(1).toLowerCase();
      if (db.get(docId)) {
        this.setState({ error: "该颜色已收藏!" });
        return;
      }
      this.props.formData!._id = docId;
      this.props.formData!.color = hex.toUpperCase();
      this.props.formData!.dark = parsed.get("lab.l") < 70;
    }
    const result = db.put(this.props.formData!);
    if (result?.error) {
      this.setState({ error: "保存失败" });
      return;
    }
    this.props.formData!._rev = result!.rev;
    this.setState({ open: false });
    this.props.onSubmit(isEdit);
  };

  handleNameInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ name: e.target.value });
  };

  handleColorInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ color: e.target.value });
  };

  handleColorPicker = () => {
    screenColorPick(({ hex }: { hex: string }) => {
      this.setState({ color: hex });
    });
  };

  componentDidUpdate(prev: FormDialogProps) {
    if (this.props.formData && prev.formData !== this.props.formData) {
      this.setState({
        open: true,
        name: this.props.formData.name,
        color: this.props.formData.color,
        error: "",
      });
    }
  }

  render() {
    const { formData } = this.props;
    if (!formData) return false;

    const { open, name, color, error } = this.state;
    const hasColor = !!formData.color;

    return (
      <Dialog open={open} onClose={this.handleClose} maxWidth="xs" fullWidth>
        <DialogTitle>{formData._id ? "修改名称" : "收藏新颜色"} </DialogTitle>
        <DialogContent className="collect-form-content">
          <TextField
            autoFocus={hasColor}
            value={name}
            onChange={this.handleNameInputChange}
            label="名称"
            variant="standard"
            helperText="为颜色取个名称(可 为空)"
          />
          <TextField
            disabled={hasColor}
            autoFocus={!hasColor}
            value={color}
            onChange={this.handleColorInputChange}
            style={{ marginLeft: 20 }}
            label="色值"
            variant="standard"
            helperText="任意格式的色值"
          />
          <Tooltip placement="left" title="取色">
            <span>
              <IconButton
                disableFocusRipple
                tabIndex={-1}
                onClick={this.handleColorPicker}
                disabled={hasColor}
              >
                <ColorizeIcon />
              </IconButton>
            </span>
          </Tooltip>
          {error && <Alert style={{ marginTop: 20 }} severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button disableFocusRipple tabIndex={-1} onClick={this.handleClose}>取消</Button>
          <Button disableFocusRipple tabIndex={-1} onClick={this.handleOk}>确定</Button>
        </DialogActions>
      </Dialog>
    );
  }
}

// 删除确认对话框
interface DeleteDialogProps {
  deleteData: CollectColor | null;
  onSubmit: () => void;
}

interface DeleteDialogState {
  open: boolean;
}

class CollectDeleteDialog extends Component<DeleteDialogProps, DeleteDialogState> {
  state: DeleteDialogState = { open: false };

  handleClose = () => {
    this.setState({ open: false });
  };

  shouldComponentUpdate(nextProps: DeleteDialogProps, nextState: DeleteDialogState) {
    return nextProps.deleteData !== this.props.deleteData || nextState.open !== this.state.open;
  }

  componentDidUpdate(prev: DeleteDialogProps) {
    if (this.props.deleteData && prev.deleteData !== this.props.deleteData) {
      this.setState({ open: true });
    }
  }

  render() {
    const { deleteData, onSubmit } = this.props;
    if (!deleteData) return false;

    const { open } = this.state;

    return (
      <Dialog open={open} onClose={this.handleClose}>
        <DialogTitle>确认删除该颜色？</DialogTitle>
        <DialogContent>
          <Box
            sx={{
              backgroundColor: deleteData.color,
              width: 200,
              height: 100,
              border: (theme: any) => deleteData.color === "#FFFFFF" ? `${theme.palette.divider} solid 1px` : "none",
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button disableFocusRipple tabIndex={-1} onClick={this.handleClose}>取消</Button>
          <Button disableFocusRipple tabIndex={-1} onClick={onSubmit} color="error" autoFocus>删除</Button>
        </DialogActions>
      </Dialog>
    );
  }
}

interface CollectPageState {
  colors: CollectColor[];
  colorForm: CollectColor | null;
  openDeleteData: CollectColor | null;
}

class CollectColorsPage extends Component<{ onColorClick: (e: any) => void }, CollectPageState> {
  constructor(props: { onColorClick: (e: any) => void }) {
    super(props);

    let colors: CollectColor[] = [];
    let sortDoc: any = null;
    let markerDoc: any = null;

    const allDocs = db.allDocs();
    allDocs.forEach((doc: any) => {
      if (doc._id.startsWith("color/")) {
        colors.push(doc);
      } else if (doc._id === "collectsort") {
        sortDoc = doc;
      } else if (doc._id === "markercolor") {
        markerDoc = doc;
      }
    });

    // 迁移markercolor旧数据
    if (markerDoc) {
      markerDoc.colors.forEach((color: string) => {
        const upper = color.toUpperCase();
        if (!/^#[A-F0-9]{6}$/.test(upper) || colors.find(c => c.color === upper)) return;
        const dark = chroma(color).get("lab.l") < 70;
        const newDoc: CollectColor = { _id: "color/" + color.substring(1).toLowerCase(), name: "", color: upper, dark };
        const result = db.put(newDoc);
        if (result.ok) {
          newDoc._rev = result.rev;
          colors.push(newDoc);
        }
      });
      db.remove(markerDoc);
      dbStorage.setItem("collectsort", colors.map(c => c._id));
    }

    // 排序
    if (sortDoc) {
      colors = colors.sort((a, b) => {
        let ai = sortDoc.value.indexOf(a._id);
        let bi = sortDoc.value.indexOf(b._id);
        if (ai === -1) ai = 9999999;
        if (bi === -1) bi = 9999999;
        return ai - bi;
      });
    }

    this.state = {
      colors,
      colorForm: null,
      openDeleteData: null,
    };
  }

  handleOpenNewForm = () => {
    this.setState({ colorForm: { _id: "", name: "", color: "" } });
  };

  handleOpenEditForm = (color: CollectColor) => (e: React.MouseEvent) => {
    e.stopPropagation();
    this.setState({ colorForm: { ...color } });
  };

  handleOpenDeleteConfirm = (color: CollectColor) => (e: React.MouseEvent) => {
    e.stopPropagation();
    this.setState({ openDeleteData: { ...color } });
  };

  handleDeleteSubmit = () => {
    const { colors, openDeleteData } = this.state;
    if (!openDeleteData || db.remove(openDeleteData).error) {
      this.setState({ openDeleteData: null });
      return;
    }
    const index = colors.findIndex(c => c._id === openDeleteData._id);
    if (index !== -1) colors.splice(index, 1);
    this.setState({ openDeleteData: null });
  };

  handleFormSubmit = (isEdit: boolean) => {
    const { colors, colorForm } = this.state;
    if (!colorForm) return;

    if (isEdit) {
      // 编辑 - 有_id表示已存在的文档
      const index = colors.findIndex(c => c._id === colorForm._id);
      if (index !== -1) colors.splice(index, 1, colorForm);
    } else {
      // 新增
      colors.push(colorForm);
      dbStorage.setItem("collectsort", colors.map(c => c._id));
    }
    this.setState({ colorForm: null });
  };

  render() {
    const { colors, colorForm, openDeleteData } = this.state;

    return (
      <div className="collect-body">
        <div className="collect-grid">
          {colors.map(c => (
            <Typography
              className="collect-item"
              key={c._id}
              onClick={() => this.props.onColorClick(c.color)}
              sx={{
                backgroundColor: c.color,
                color: c.dark ? "#fff" : "#333",
                ".MuiSvgIcon-root": { color: c.dark ? "#fff" : "#333" },
                boxSizing: "border-box",
                border: (theme: any) => c.color === "#FFFFFF" ? `${theme.palette.divider} solid 1px` : "none",
              }}
            >
              <div>
                <div className="collect-item-info">
                  {c.name && <div>{c.name}</div>}
                  <div>{c.color}</div>
                </div>
                <div className="collect-item-handle">
                  <IconButton disableFocusRipple tabIndex={-1} onClick={this.handleOpenEditForm(c)} size="small">
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton disableFocusRipple tabIndex={-1} onClick={this.handleOpenDeleteConfirm(c)} size="small">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </div>
              </div>
            </Typography>
          ))}
        </div>
        {colors.length === 0 && (
          <div className="collect-empty">~~ 无收藏记录 ~~</div>
        )}
        <CollectFormDialog formData={colorForm} onSubmit={this.handleFormSubmit} />
        <CollectDeleteDialog deleteData={openDeleteData} onSubmit={this.handleDeleteSubmit} />
        <Fab color="primary" onClick={this.handleOpenNewForm} className="collect-btn-add">
          <AddIcon />
        </Fab>
      </div>
    );
  }
}

export default CollectColorsPage;
