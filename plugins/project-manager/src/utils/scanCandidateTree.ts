/***********************嵌套扫描候选树：选择与裁剪*********************/

import type { ImportNode } from '../api/types';
import { normalizeProjectPath } from './projectTree';

/** 复选框三态：全选 / 半选 / 未选 */
export type CandidateCheckState = 'checked' | 'indeterminate' | 'unchecked';

/** 递归收集一棵子树中的全部路径（含自身），返回归一化路径 */
export function collectSubtreePaths(node: ImportNode): string[] {
  const out: string[] = [normalizeProjectPath(node.path)];
  for (const child of node.children) out.push(...collectSubtreePaths(child));
  return out;
}

/** 递归收集整片森林中的全部路径 */
export function collectForestPaths(nodes: ImportNode[]): string[] {
  return nodes.flatMap(collectSubtreePaths);
}

/**
 * 计算默认勾选集合。
 *
 * 批量导入不传 existingPaths 时保留全选语义；层级管理传入已有路径后，
 * 只有当前 parent subtree 中已经注册的项目默认勾选，新扫描候选必须由用户主动选择。
 */
export function buildDefaultSelection(
  nodes: ImportNode[],
  existingPaths?: ReadonlySet<string>,
): Set<string> {
  const paths = collectForestPaths(nodes);
  return existingPaths
    ? new Set(paths.filter((path) => existingPaths.has(path)))
    : new Set(paths);
}

/** 在森林中按归一化路径定位节点及其祖先链（祖先在前、目标在后） */
function findNodeChain(nodes: ImportNode[], targetPath: string): ImportNode[] | null {
  for (const node of nodes) {
    if (normalizeProjectPath(node.path) === targetPath) return [node];
    const inChild = findNodeChain(node.children, targetPath);
    if (inChild) return [node, ...inChild];
  }
  return null;
}

/**
 * 勾选/取消某个节点，返回新的选择集合。
 *
 * 只有两条**硬约束**（它们源自"子项目无法脱离父级挂载"这一事实）：
 * - 取消父节点 → 必须级联取消其全部后代（父级都没了，子级无处挂载）；
 * - 勾选子节点 → 必须自动勾选其全部祖先（补齐挂载链）。
 *
 * 反过来「勾选父节点」**不再**级联勾选后代。那条级联不是不变式要求的，
 * 只是个便利默认，代价却很大：它让"保留父级、去掉其下全部孙级"这个状态
 * 无法通过点击父级维持——用户刚取消完孙级，一点父级就全被勾回来。
 * 需要整棵勾上时用顶部的「全选」，那是明确的批量意图。
 */
export function toggleCandidateSelection(
  nodes: ImportNode[],
  targetPath: string,
  checked: boolean,
  selected: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selected);
  const chain = findNodeChain(nodes, normalizeProjectPath(targetPath));
  if (!chain) return next;

  const target = chain[chain.length - 1];

  if (checked) {
    next.add(normalizeProjectPath(target.path));
    // 向上补齐祖先，保证挂载链完整
    for (const ancestor of chain.slice(0, -1)) {
      next.add(normalizeProjectPath(ancestor.path));
    }
    return next;
  }

  // 取消：自身与全部后代一起取消
  for (const path of collectSubtreePaths(target)) next.delete(path);
  return next;
}

/**
 * 计算某节点复选框的三态显示。
 *
 * **`checked` 只看节点自身**，`indeterminate` 表示"自身没勾但子孙里有勾选的"。
 * 这样点击行为才自洽：勾选不再级联向下，一个节点的勾选态就该由它自己决定，
 * 而不是被后代拖成半选——否则"保留父级、去掉其下孙级"会让父级显示成半选，
 * 用户再点一下就变成勾选全部后代，永远取消不干净。
 *
 * @param ignoredPaths 不参与"子孙是否有勾选"统计的路径。纯新增场景（批量导入）
 *   传入已导入的路径：它们永远不会进入勾选集合，不应把祖先拖成半选。
 */
export function getCandidateCheckState(
  node: ImportNode,
  selected: ReadonlySet<string>,
  ignoredPaths?: ReadonlySet<string>,
): CandidateCheckState {
  if (selected.has(normalizeProjectPath(node.path))) return 'checked';

  // 自身未勾选：只要子孙中还有勾选的，就显示为半选，提示该分支尚未清空
  const descendants = node.children.flatMap(collectSubtreePaths);
  const counted = ignoredPaths
    ? descendants.filter((path) => !ignoredPaths.has(path))
    : descendants;
  return counted.some((path) => selected.has(path)) ? 'indeterminate' : 'unchecked';
}

/**
 * 按勾选结果裁剪出待导入的树。
 *
 * 保留条件：节点自身被勾选，**或**其子孙中存在被保留的节点——后者让
 * 已存在的项目能继续作为层级容器留在树里（`flattenImportNodeTree` 会
 * 复用它的既有 id 作为父级，而不会重复入库）。
 */
export function pruneSelectedTree(
  nodes: ImportNode[],
  selected: ReadonlySet<string>,
): ImportNode[] {
  const out: ImportNode[] = [];
  for (const node of nodes) {
    const children = pruneSelectedTree(node.children, selected);
    const isSelected = selected.has(normalizeProjectPath(node.path));
    if (isSelected || children.length > 0) {
      out.push({ ...node, children });
    }
  }
  return out;
}

/**
 * 把**已入库的子树**并入扫描候选树，返回合并后的森林。
 *
 * 为什么必须合并：弹窗的候选来自后端扫描，而扫描有两处天然盲区——
 * 1. 深度预算。编辑二级项目时 `remainingDepth = 1`，只扫得到它的直接子级，
 *    已经入库的三级项目根本不在候选里；
 * 2. 非对称递归规则。带构建清单但无 `.git` 的目录不再向内递归
 *    （见 `scan_project_tree`），其内部即使已有入库的子项目也扫不出来。
 *
 * 候选里没有的节点就无法被取消勾选 —— 用户会看到"某些已添加的子项目
 * 压根不出现在列表里，因而删不掉"。合并后它们照常显示、照常可取消。
 *
 * 同路径以扫描结果为准（扫描带有 kind/framework/scripts 等新鲜元数据），
 * 仅把入库子树中缺失的节点补进来。
 */
export function mergeExistingSubtree(
  scanned: ImportNode[],
  existing: ImportNode[],
): ImportNode[] {
  const byPath = new Map<string, ImportNode>();
  const order: string[] = [];

  const put = (node: ImportNode) => {
    const key = normalizeProjectPath(node.path);
    const prev = byPath.get(key);
    if (!prev) {
      order.push(key);
      byPath.set(key, node);
      return;
    }
    // 同路径：保留先来的（扫描结果）的元数据，递归合并各自的子树
    byPath.set(key, { ...prev, children: mergeExistingSubtree(prev.children, node.children) });
  };

  for (const node of scanned) put(node);
  for (const node of existing) put(node);

  return order.map((key) => byPath.get(key)!);
}

/**
 * 找出被取消勾选的、已导入的节点路径——这些是用户要移除的项目。
 *
 * 只看候选树覆盖到的范围：树外的项目（别处手动添加、或本次扫描不可见的）
 * 不在这次操作的语义里，绝不能因为"没出现在勾选集合中"就被删掉。
 */
export function collectDeselectedExistingPaths(
  nodes: ImportNode[],
  existingPaths: ReadonlySet<string>,
  selected: ReadonlySet<string>,
): string[] {
  return collectForestPaths(nodes).filter(
    (path) => existingPaths.has(path) && !selected.has(path),
  );
}

/** 统计一棵子树中可识别为模块的节点数（unknown 容器不计入自身） */
export function countModulesInNode(node: ImportNode): number {
  const self = node.kind === 'unknown' ? 0 : 1;
  return self + node.children.reduce((sum, child) => sum + countModulesInNode(child), 0);
}
