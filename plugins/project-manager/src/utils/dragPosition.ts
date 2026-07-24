type DragTranslateOptions = {
  pointerClientY: number;
  listClientTop: number;
  pointerOffsetY: number;
  itemOffsetTop: number;
};

type DragCenterOptions = {
  itemOffsetTop: number;
  itemHeight: number;
  translateY: number;
};

type FlipPosition = {
  id: string;
  top: number;
};

type FlipTransformOptions = {
  oldPositions: FlipPosition[];
  newPositions: FlipPosition[];
  excludedId?: string | null;
};

/***********************拖拽位置计算*********************/

export function calculateDraggedItemTranslateY(options: DragTranslateOptions) {
  const pointerContentY = options.pointerClientY - options.listClientTop;
  const targetItemTop = pointerContentY - options.pointerOffsetY;
  return targetItemTop - options.itemOffsetTop;
}

export function calculateDraggedItemCenterY(options: DragCenterOptions) {
  return options.itemOffsetTop + options.translateY + options.itemHeight / 2;
}

/***********************换位动画计算*********************/

export function calculateFlipTransforms(options: FlipTransformOptions) {
  const oldTopById = new Map(options.oldPositions.map(item => [item.id, item.top]));
  const transforms = new Map<string, number>();

  options.newPositions.forEach((item) => {
    if (item.id === options.excludedId) return;

    const oldTop = oldTopById.get(item.id);
    if (oldTop === undefined || oldTop === item.top) return;

    transforms.set(item.id, oldTop - item.top);
  });

  return transforms;
}
