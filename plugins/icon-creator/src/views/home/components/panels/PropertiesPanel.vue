<template>
  <div class="right-panel-scroll">
    <!-- 对象属性 -->
    <template v-if="activeObject">
      <div class="section-title">
        <span v-if="isMultiSelection">已选中 {{ selectionCount }} 个对象</span>
        <span v-else>对象属性</span>
      </div>
      <template v-if="activeKaleidoscopeInstance">
        <div class="prop-section">
          <div class="prop-actions instance-actions">
            <button class="tb-btn" @click="selectKaleidoscopeSourceFromInstance">选中源对象</button>
            <button class="tb-btn" @click="detachKaleidoscopeInstance">脱离万花筒</button>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="prop-section">
          <div class="prop-group transform-row">
            <label>位置</label>
            <span class="size-lock-spacer"></span>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.leftInput"
              @update:model-value="objProps.leftInput = String($event)"
              @change="setObjPropFromInput('left', $event)"
            ><template #suffix>px</template></ZInput>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.topInput"
              @update:model-value="objProps.topInput = String($event)"
              @change="setObjPropFromInput('top', $event)"
            ><template #suffix>px</template></ZInput>
          </div>
          <div class="prop-group transform-row">
            <label>尺寸</label>
            <Icon
              class="size-lock-icon"
              :class="{ active: sizeRatioLocked }"
              :icon="sizeRatioLocked ? 'mdi:lock' : 'mdi:lock-open-variant'"
              :title="sizeRatioLocked ? '解锁宽高比例' : '锁定宽高比例'"
              @click="toggleSizeRatioLock"
            />
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.widthInput"
              @update:model-value="objProps.widthInput = String($event)"
              @change="setObjSizeFromInput('width', $event)"
            ><template #suffix>px</template></ZInput>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.heightInput"
              @update:model-value="objProps.heightInput = String($event)"
              @change="setObjSizeFromInput('height', $event)"
            ><template #suffix>px</template></ZInput>
          </div>
          <div class="prop-group rotation-combined-row">
            <label>旋转</label>
            <ZPopover
              trigger="hover"
              placement="top"
              :to="false"
              show-arrow
              :delay="200"
              :hide-delay="100"
              keep-alive-on-hover
            >
              <template #trigger>
                <div class="rotation-inputs-group">
                  <ZInput
                    size="small"
                    type="text"
                    :model-value="objProps.rotateXInput"
                    @update:model-value="objProps.rotateXInput = String($event)"
                    @change="setObjPropFromInput('rotateX', $event)"
                  ><template #suffix>°</template></ZInput>
                  <ZInput
                    size="small"
                    type="text"
                    :model-value="objProps.rotateYInput"
                    @update:model-value="objProps.rotateYInput = String($event)"
                    @change="setObjPropFromInput('rotateY', $event)"
                  ><template #suffix>°</template></ZInput>
                  <ZInput
                    size="small"
                    type="text"
                    :model-value="objProps.angleInput"
                    @update:model-value="objProps.angleInput = String($event)"
                    @change="setObjPropFromInput('angle', $event)"
                  ><template #suffix>°</template></ZInput>
                </div>
              </template>
              <div class="rotation-tooltip">
                <div class="rotation-tooltip-row">
                  <span class="rotation-tooltip-label">X轴旋转</span>
                  <ZSlider
                    :model-value="objProps.rotateX"
                    :min="0"
                    :max="360"
                    :step="1"
                    :formatter="(value) => `${Math.round(value)}°`"
                    @change="setObjProp('rotateX', $event)"
                  />
                </div>
                <div class="rotation-tooltip-row">
                  <span class="rotation-tooltip-label">Y轴旋转</span>
                  <ZSlider
                    :model-value="objProps.rotateY"
                    :min="0"
                    :max="360"
                    :step="1"
                    :formatter="(value) => `${Math.round(value)}°`"
                    @change="setObjProp('rotateY', $event)"
                  />
                </div>
                <div class="rotation-tooltip-row">
                  <span class="rotation-tooltip-label">Z轴旋转</span>
                  <ZSlider
                    :model-value="objProps.angle"
                    :min="0"
                    :max="360"
                    :step="1"
                    :formatter="(value) => `${Math.round(value)}°`"
                    @change="setObjProp('angle', $event)"
                  />
                </div>
              </div>
            </ZPopover>
          </div>
          <div class="prop-group transform-actions-row">
            <label>变换</label>
            <div class="transform-actions">
              <button
                class="tb-btn sm"
                :class="{ active: objProps.flipX }"
                :title="objProps.flipX ? '取消水平翻转' : '水平翻转'"
                @click="flipObject('x')"
              >水平翻</button>
              <button
                class="tb-btn sm"
                :class="{ active: objProps.flipY }"
                :title="objProps.flipY ? '取消垂直翻转' : '垂直翻转'"
                @click="flipObject('y')"
              >垂直翻</button>
              <button class="tb-btn sm" title="重置变换" @click="resetTransform">重置</button>
            </div>
          </div>
          <div v-if="!(activeObject instanceof ActiveSelection)" class="prop-group style-color-row">
            <label>吸附边距</label>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.endpointSnapMarginInput"
              @update:model-value="objProps.endpointSnapMarginInput = String($event)"
              @change="setEndpointSnapMarginFromInput"
            ><template #suffix>px</template></ZInput>
          </div>
          <div class="prop-group align-row">
            <label>对齐</label>
            <ZPopover
              :show="alignPopoverVisible"
              trigger="hover"
              placement="bottom"
              :to="false"
              show-arrow
              keep-alive-on-hover
              @update:show="alignPopoverVisible = $event"
            >
              <template #trigger>
                <button
                  class="align-btn align-trigger"
                  :title="currentAlignPosition.label"
                  @click="alignToCanvas(currentAlignPosition.id)"
                >
                  <svg viewBox="0 0 18 18" aria-hidden="true">
                    <rect x="1" y="1" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.2" />
                    <rect :x="currentAlignPosition.svgX" :y="currentAlignPosition.svgY" width="6" height="4" rx="0.5" fill="currentColor" />
                  </svg>
                </button>
              </template>
              <div class="align-grid align-popover-grid">
                <button
                  v-for="pos in alignPositions"
                  :key="pos.id"
                  class="align-btn"
                  :class="{ active: pos.id === currentAlignId }"
                  :title="pos.label"
                  @click="selectAlign(pos.id)"
                >
                  <svg viewBox="0 0 18 18" aria-hidden="true">
                    <rect x="1" y="1" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.2" />
                    <rect :x="pos.svgX" :y="pos.svgY" width="6" height="4" rx="0.5" fill="currentColor" />
                  </svg>
                </button>
              </div>
            </ZPopover>
          </div>
          <div v-if="canAlignSelection" class="prop-group selection-layout-row">
            <label>多选对齐</label>
            <div class="selection-layout-actions">
              <button class="tb-btn sm layout-tool-btn" title="以当前选区左边界为参考左对齐" @click="alignSelection('left')">左</button>
              <button class="tb-btn sm layout-tool-btn" title="以当前选区水平中心为参考居中" @click="alignSelection('center')">横中</button>
              <button class="tb-btn sm layout-tool-btn" title="以当前选区右边界为参考右对齐" @click="alignSelection('right')">右</button>
              <button class="tb-btn sm layout-tool-btn" title="以当前选区上边界为参考顶对齐" @click="alignSelection('top')">顶</button>
              <button class="tb-btn sm layout-tool-btn" title="以当前选区垂直中心为参考居中" @click="alignSelection('middle')">竖中</button>
              <button class="tb-btn sm layout-tool-btn" title="以当前选区下边界为参考底对齐" @click="alignSelection('bottom')">底</button>
            </div>
          </div>
          <div v-if="canDistributeSelection" class="prop-group selection-layout-row">
            <label>等距分布</label>
            <div class="selection-layout-actions distribute-actions">
              <button class="tb-btn sm layout-tool-btn" title="在当前选区左右边界之间水平等距分布" @click="distributeSelection('horizontal')">水平</button>
              <button class="tb-btn sm layout-tool-btn" title="在当前选区上下边界之间垂直等距分布" @click="distributeSelection('vertical')">垂直</button>
            </div>
          </div>
        </div>
        <div class="prop-section">
          <div class="prop-group style-toggle-row">
            <label>填充</label>
            <ZSwitch size="small" :model-value="objProps.fillEnabled" @change="toggleFill" />
          </div>
          <div v-if="objProps.fillEnabled" class="prop-group">
            <label>模式</label>
            <div class="stroke-line-type-picker fill-style-picker">
              <button
                class="stroke-line-swatch fill-style-solid"
                :class="{ active: currentFillStyleMode === 'solid' }"
                title="纯色"
                @click="setFillStyleMode('solid')"
              />
              <button
                class="stroke-line-swatch fill-style-radial"
                :class="{ active: currentFillStyleMode === 'radial' }"
                title="径向渐变"
                @click="setFillStyleMode('radial')"
              />
              <button
                class="stroke-line-swatch fill-style-linear"
                :class="{ active: currentFillStyleMode === 'linear' }"
                title="线性渐变"
                @click="setFillStyleMode('linear')"
              />
              <button
                class="stroke-line-swatch fill-style-pattern"
                :class="{ active: currentFillStyleMode === 'pattern' }"
                title="图案"
                @click="setFillStyleMode('pattern')"
              />
            </div>
          </div>
          <div v-if="objProps.fillEnabled && currentFillStyleMode === 'solid'" class="prop-group style-color-row">
            <label>填充色</label>
            <ZColorPicker
              size="small"
              show-alpha
              :model-value="objProps.fill || '#000000'"
              @change="setSolidFillColor(String($event))"
            />
          </div>
          <template v-if="objProps.fillEnabled && objProps.fillMode === 'gradient'">
            <VueDraggable
              v-model="objProps.fillGradientStops"
              class="gradient-stop-list"
              item-key="id"
              handle=".gradient-stop-handle"
              @end="reorderFillGradientStops"
            >
              <div
                v-for="(stop, stopIndex) in objProps.fillGradientStops"
                :key="stop.id"
                class="prop-group gradient-stop-row"
              >
                <button class="gradient-stop-handle" type="button" title="拖动排序">
                  <Icon icon="mdi:drag-vertical" />
                </button>
                <ZColorPicker
                  size="small"
                  :show-input="false"
                  show-alpha
                  :model-value="stop.color"
                  @change="setFillGradientStopColor(stopIndex, String($event))"
                />
                <ZSlider
                  :model-value="Math.round(stop.offset * 100)"
                  :min="0"
                  :max="100"
                  :step="1"
                  :formatter="(value) => `${Math.round(value)}%`"
                  :disabled-value="(value) => isFillGradientStopPercentDisabled(stopIndex, value)"
                  @change="setFillGradientStopOffset(stopIndex, $event)"
                />
                <ZInput
                  size="small"
                  type="text"
                  class="gradient-stop-offset-input"
                  :model-value="`${Math.round(stop.offset * 100)}`"
                  @change="setFillGradientStopOffsetFromInput(stopIndex, $event)"
                  title="色标位置 (%)"
                />
                <button class="layer-icon-btn danger" :disabled="objProps.fillGradientStops.length <= 2" title="删除色标" @click="removeFillGradientStop(stopIndex)">
                  <Icon icon="mdi:close" />
                </button>
              </div>
            </VueDraggable>
            <div class="gradient-stop-actions">
              <button class="tb-btn sm gradient-stop-add-btn" @click="addFillGradientStop">添加渐变</button>
            </div>
            <div v-if="objProps.fillGradientType === 'linear'" class="prop-group rotation-row">
              <label>角度</label>
              <ZSlider
                :model-value="objProps.fillGradientAngle"
                :min="0"
                :max="359"
                :step="1"
                :formatter="(value) => `${Math.round(value)}°`"
                @change="setFillGradientAngleValue($event)"
              />
              <div class="max-w-60px">
                <ZInput
                  size="small"
                  type="text"
                  :model-value="objProps.fillGradientAngleInput"
                  @update:model-value="objProps.fillGradientAngleInput = String($event)"
                  @change="setFillGradientAngleFromInput"
                  title="渐变角度 (°)"
                ><template #suffix>°</template></ZInput>
              </div>
            </div>
            <template v-if="objProps.fillGradientType === 'radial'">
              <div class="prop-group gradient-radius-row">
                <label>扩散范围</label>
                <ZSlider
                  :model-value="objProps.fillGradientRadius"
                  :min="0.05"
                  :max="2"
                  :step="0.01"
                  :formatter="(value) => `${Number(value).toFixed(2)}`"
                  @change="setFillGradientRadiusValue($event)"
                />
                <span class="val-label">{{ objProps.fillGradientRadius.toFixed(2) }}</span>
              </div>
            </template>
          </template>
          <!-- 图案填充参数：来源（本地图片上传）/ 平铺方式 / 图案缩放，change 提交并入撤销栈 -->
          <template v-if="objProps.fillEnabled && currentFillStyleMode === 'pattern'">
            <div class="prop-group style-color-row">
              <label>来源</label>
              <div class="pattern-source-row">
                <label class="tb-btn sm pattern-upload-btn" title="上传本地图片作为图案">
                  上传图片
                  <input
                    type="file"
                    accept="image/*"
                    class="pattern-file-input"
                    @change="setPatternFillFromFile($event)"
                  />
                </label>
                <span class="pattern-source-name" :title="objProps.fillPatternSourceName || '默认图案'">
                  {{ objProps.fillPatternSourceName || '默认图案' }}
                </span>
              </div>
            </div>
            <div class="prop-group">
              <label>平铺</label>
              <ZSelect
                size="small"
                class="w-100%"
                :model-value="objProps.fillPatternRepeat"
                :options="patternRepeatOptions"
                @change="setPatternFillRepeat(String($event))"
              />
            </div>
            <div class="prop-group rotation-row">
              <label>缩放</label>
              <ZSlider
                :model-value="objProps.fillPatternScale"
                :min="0.05"
                :max="20"
                :step="0.05"
                :formatter="(value) => `${Number(value).toFixed(2)}x`"
                @change="setPatternFillScale($event)"
              />
              <span class="val-label">{{ Number(objProps.fillPatternScale).toFixed(2) }}x</span>
            </div>
          </template>
        </div>
        <div class="prop-section">
          <div class="prop-group style-toggle-row">
            <label>描边</label>
            <ZSwitch size="small" :model-value="objProps.strokeEnabled" @change="toggleStroke" />
          </div>
          <div v-if="objProps.strokeEnabled" class="prop-group style-color-row">
            <label>描边色</label>
            <ZColorPicker
              size="small"
              show-alpha
              :model-value="objProps.stroke || '#000000'"
              @change="setObjProp('stroke', String($event))"
            />
          </div>
          <div v-if="objProps.strokeEnabled" class="prop-group style-color-row">
            <label>描边宽</label>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.strokeWidthInput"
              @update:model-value="objProps.strokeWidthInput = String($event)"
              @change="setStrokeWidthFromInput"
            ><template #suffix>px</template></ZInput>
          </div>
          <div v-if="objProps.strokeEnabled" class="prop-group">
            <label>线型</label>
            <div class="stroke-line-type-picker">
              <button
                class="stroke-line-swatch solid"
                :class="{ active: objProps.strokeLineType === 'solid' }"
                title="实线"
                @click="setStrokeLineType('solid')"
              />
              <button
                class="stroke-line-swatch dashed"
                :class="{ active: objProps.strokeLineType === 'dashed' }"
                title="虚线"
                @click="setStrokeLineType('dashed')"
              />
            </div>
          </div>
          <div v-if="objProps.strokeEnabled && objProps.strokeLineType === 'dashed'" class="prop-group style-color-row">
            <label>虚线线长</label>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.strokeDashLengthInput"
              @update:model-value="objProps.strokeDashLengthInput = String($event)"
              @change="setStrokeDashLengthFromInput"
            ><template #suffix>px</template></ZInput>
          </div>
          <div v-if="objProps.strokeEnabled && objProps.strokeLineType === 'dashed'" class="prop-group style-color-row">
            <label>虚线间隔</label>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.strokeDashGapInput"
              @update:model-value="objProps.strokeDashGapInput = String($event)"
              @change="setStrokeDashGapFromInput"
            ><template #suffix>px</template></ZInput>
          </div>
        </div>
        <div class="prop-section">
          <div class="prop-group opacity-row">
            <label>透明度</label>
            <ZSlider
              :model-value="objProps.opacity"
              :min="0"
              :max="1"
              :step="0.01"
              :formatter="(value) => `${Math.round(value * 100)}%`"
              @change="setObjProp('opacity', $event)"
            />
            <span class="val-label">{{ Math.round(objProps.opacity * 100) }}%</span>
          </div>
        </div>
        <div class="prop-section">
          <div class="prop-group style-toggle-row">
            <label>阴影效果</label>
            <button class="tb-btn sm" @click="addShadowEffect">添加</button>
          </div>
          <div v-if="objProps.shadowEffects && objProps.shadowEffects.length > 0" class="shadow-effects-list">
            <div
              v-for="(shadow, index) in objProps.shadowEffects"
              :key="shadow.id"
              class="shadow-effect-item"
            >
              <div class="prop-group style-toggle-row shadow-header">
                <label>{{ shadow.type === 'drop' ? '投影' : '内阴影' }} #{{ index + 1 }}</label>
                <ZSwitch size="small" :model-value="shadow.enabled" @change="toggleShadowEffect(index, $event)" />
              </div>
              <template v-if="shadow.enabled">
                <div class="prop-group style-color-row">
                  <label>颜色</label>
                  <ZColorPicker
                    size="small"
                    show-alpha
                    :model-value="shadow.color"
                    @change="setShadowEffectProp(index, 'color', String($event))"
                  />
                </div>
                <div class="prop-group bezier-group-row">
                  <label>偏移</label>
                  <ZInput
                    size="small"
                    type="text"
                    :model-value="shadow.offsetXInput"
                    @update:model-value="objProps.shadowEffects[index].offsetXInput = String($event)"
                    @change="setShadowEffectProp(index, 'offsetX', $event)"
                  ><template #suffix>px</template></ZInput>
                  <ZInput
                    size="small"
                    type="text"
                    :model-value="shadow.offsetYInput"
                    @update:model-value="objProps.shadowEffects[index].offsetYInput = String($event)"
                    @change="setShadowEffectProp(index, 'offsetY', $event)"
                  ><template #suffix>px</template></ZInput>
                </div>
                <div class="prop-group style-color-row">
                  <label>模糊</label>
                  <ZInput
                    size="small"
                    type="text"
                    :model-value="shadow.blurInput"
                    @update:model-value="objProps.shadowEffects[index].blurInput = String($event)"
                    @change="setShadowEffectProp(index, 'blur', $event)"
                  ><template #suffix>px</template></ZInput>
                </div>
                <div class="prop-group" style="justify-content: flex-end; padding-top: 0;">
                  <button class="tb-btn sm danger" @click="removeShadowEffect(index)">删除</button>
                </div>
              </template>
            </div>
          </div>
        </div>
        <!-- 位图区：选中位图时显示；裁剪会话中活动对象切换为裁剪框，本区保持可见但隐藏滤镜列表 -->
        <div v-if="isBitmapActiveObject || cropModeActive" class="prop-section">
          <!-- 位图裁剪：进入裁剪模式后画布上出现可拖拽/调尺寸的裁剪框，确认应用 / 取消或 Esc 恢复原状 -->
          <div class="prop-group style-toggle-row">
            <label>裁剪</label>
            <div v-if="!cropModeActive" class="crop-session-actions">
              <button class="tb-btn sm" title="进入裁剪模式，在图片上拖出保留区域" @click="beginBitmapCrop">进入裁剪</button>
            </div>
            <div v-else class="crop-session-actions">
              <button class="tb-btn sm" title="应用当前裁剪区域（一条撤销记录）" @click="confirmBitmapCrop">确认裁剪</button>
              <button class="tb-btn sm danger" title="取消裁剪并恢复原图（Esc 同效）" @click="cancelBitmapCrop">取消</button>
            </div>
          </div>
          <template v-if="!cropModeActive">
            <div class="prop-group style-toggle-row">
              <label>滤镜</label>
            </div>
            <div class="bitmap-filter-list">
              <div
                v-for="filter in objProps.bitmapFilters"
                :key="filter.type"
                class="bitmap-filter-item"
              >
                <div class="prop-group style-toggle-row bitmap-filter-header">
                  <label>{{ filter.label }}</label>
                  <ZSwitch size="small" :model-value="filter.enabled" @change="toggleImageFilter(filter.type, $event)" />
                </div>
                <!-- 有参滤镜在启用态展示参数滑杆；change 提交时应用滤镜并入撤销栈 -->
                <div v-if="filter.enabled && filter.paramKey" class="prop-group rotation-row">
                  <label>{{ filter.paramLabel }}</label>
                  <ZSlider
                    :model-value="Number(filter[filter.paramKey])"
                    :min="filter.paramMin"
                    :max="filter.paramMax"
                    :step="BITMAP_FILTER_PARAM_STEP"
                    :formatter="(value) => `${Math.round(value * 100)}%`"
                    @change="setImageFilterParam(filter.type, filter.paramKey, $event)"
                  />
                  <span class="val-label">{{ Math.round(Number(filter[filter.paramKey]) * 100) }}%</span>
                </div>
              </div>
            </div>
          </template>
        </div>
        <!-- 混合模式区：所有对象类型通用 -->
        <div class="prop-section">
          <div class="prop-group">
            <label>混合模式</label>
            <ZSelect
              size="small"
              class="w-100%"
              :model-value="objProps.blendMode"
              :options="blendModeOptions"
              @change="setObjectBlendMode(String($event))"
            />
          </div>
        </div>
        <!-- 文本区：选中集合包含文本对象时显示（单选文本或多选/编组中的文本子对象），
             属性批量应用到集合内全部文本目标，回显取第一个文本对象 -->
        <div v-if="showTextSection" class="prop-section">
          <div class="prop-group">
            <label>字体</label>
            <ZSelect
              size="small"
              class="w-100%"
              :model-value="objProps.fontFamily"
              :options="fontFamilyOptions"
              @change="setTextProp('fontFamily', String($event))"
            />
          </div>
          <div class="prop-group rotation-row">
            <label>字号</label>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.fontSizeInput"
              @update:model-value="objProps.fontSizeInput = String($event)"
              @change="setTextPropFromInput('fontSize', $event)"
            ><template #suffix>px</template></ZInput>
          </div>
          <div class="prop-group">
            <label>样式</label>
            <div class="text-style-actions">
              <button
                class="tb-btn sm text-style-btn bold"
                :class="{ active: objProps.fontBold }"
                title="粗体"
                @click="toggleTextBold"
              >B</button>
              <button
                class="tb-btn sm text-style-btn italic"
                :class="{ active: objProps.fontItalic }"
                title="斜体"
                @click="toggleTextItalic"
              >I</button>
              <button
                class="tb-btn sm text-style-btn underline"
                :class="{ active: objProps.fontUnderline }"
                title="下划线"
                @click="toggleTextUnderline"
              >U</button>
              <button
                class="tb-btn sm text-style-btn linethrough"
                :class="{ active: objProps.fontLinethrough }"
                title="删除线"
                @click="toggleTextLinethrough"
              >S</button>
            </div>
          </div>
          <div class="prop-group rotation-row">
            <label>字间距</label>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.charSpacingInput"
              @update:model-value="objProps.charSpacingInput = String($event)"
              @change="setTextPropFromInput('charSpacing', $event)"
            />
          </div>
          <div class="prop-group rotation-row">
            <label>行高</label>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.lineHeightInput"
              @update:model-value="objProps.lineHeightInput = String($event)"
              @change="setTextPropFromInput('lineHeight', $event)"
            />
          </div>
          <div class="prop-group">
            <label>对齐</label>
            <div class="text-style-actions">
              <button
                class="tb-btn sm"
                :class="{ active: objProps.textAlign === 'left' }"
                title="左对齐"
                @click="setTextAlign('left')"
              >左</button>
              <button
                class="tb-btn sm"
                :class="{ active: objProps.textAlign === 'center' }"
                title="水平居中"
                @click="setTextAlign('center')"
              >中</button>
              <button
                class="tb-btn sm"
                :class="{ active: objProps.textAlign === 'right' }"
                title="右对齐"
                @click="setTextAlign('right')"
              >右</button>
            </div>
          </div>
        </div>
        <div v-if="hasEditablePoints" class="prop-section">
          <div v-if="!hasSelectedPoint" class="prop-group style-color-row">
            <label>圆角</label>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.cornerRadiusInput"
              @update:model-value="objProps.cornerRadiusInput = String($event)"
              @change="setCornerRadiusFromInput"
            ><template #suffix>px</template></ZInput>
          </div>
          <div v-else-if="!hasSelectedArrowEndpoint" class="prop-group style-color-row">
            <label>点圆角</label>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.pointCornerRadiusInput"
              @update:model-value="objProps.pointCornerRadiusInput = String($event)"
              @change="setSelectedPointCornerRadiusFromInput"
            ><template #suffix>px</template></ZInput>
          </div>
        </div>
        <div v-if="hasSelectedArrowEndpoint" class="prop-section">
          <div class="prop-group style-toggle-row">
            <label>箭头</label>
            <ZSwitch
              size="small"
              :model-value="arrowAggregated.enabled === true"
              @change="toggleSelectedArrowEnabled"
            />
          </div>
          <template v-if="arrowAggregated.enabled === true">
            <div v-if="!isHollowShaftArrow" class="prop-group">
              <label>形状</label>
              <div class="stroke-line-type-picker arrow-shape-picker">
                <button
                  class="stroke-line-swatch arrow-shape-solid"
                  :class="{ active: arrowAggregated.shape === 'solid' }"
                  title="实心"
                  @click="setSelectedArrowShape('solid')"
                />
                <button
                  class="stroke-line-swatch arrow-shape-hollow"
                  :class="{ active: arrowAggregated.shape === 'hollow' }"
                  title="空心"
                  @click="setSelectedArrowShape('hollow')"
                />
              </div>
            </div>
            <div v-if="!isHollowShaftArrow" class="prop-group rotation-row">
              <label>夹角</label>
              <ZSlider
                :model-value="arrowAggregated.angle ?? 60"
                :min="15"
                :max="150"
                :step="1"
                :formatter="(value) => `${Math.round(value)}°`"
                @change="setSelectedArrowAngle($event)"
              />
              <span class="val-label">{{ arrowAggregated.angle == null ? '—' : `${Math.round(arrowAggregated.angle)}°` }}</span>
            </div>
            <div v-if="isHollowShaftArrow" class="prop-group style-color-row">
              <label>线宽</label>
              <ZInput
                size="small"
                type="text"
                :model-value="objProps.arrowLineWidthInput"
                @update:model-value="objProps.arrowLineWidthInput = String($event)"
                @change="setHollowArrowLineWidthFromInput"
              ><template #suffix>px</template></ZInput>
            </div>
            <div v-if="isHollowShaftArrow" class="prop-group rotation-row">
              <label>顶角</label>
              <ZSlider
                :model-value="objProps.arrowTipAngle"
                :min="15"
                :max="165"
                :step="1"
                :formatter="(value) => `${Math.round(value)}°`"
                @change="setHollowArrowTipAngle"
              />
              <span class="val-label">{{ `${Math.round(objProps.arrowTipAngle)}°` }}</span>
            </div>
            <div v-if="isHollowShaftArrow" class="prop-group rotation-row">
              <label>边角</label>
              <ZSlider
                :model-value="objProps.arrowSideAngle"
                :min="15"
                :max="90"
                :step="1"
                :formatter="(value) => `${Math.round(value)}°`"
                @change="setHollowArrowSideAngle"
              />
              <span class="val-label">{{ `${Math.round(objProps.arrowSideAngle)}°` }}</span>
            </div>
            <div class="prop-group style-color-row">
              <label>{{ isHollowShaftArrow ? '高度' : '长度' }}</label>
              <ZInput
                size="small"
                type="text"
                :model-value="objProps.arrowLengthInput"
                @update:model-value="objProps.arrowLengthInput = String($event)"
                @change="setSelectedArrowLengthFromInput"
              ><template #suffix>px</template></ZInput>
            </div>
          </template>
        </div>
        <div v-if="hasSelectedCurveSegment" class="prop-section">
          <div class="prop-group style-toggle-row">
            <label>曲线</label>
            <ZSwitch size="small" :model-value="objProps.curveEnabled" @change="setSelectedSegmentCurveEnabled" />
          </div>
          <div v-if="objProps.curveEnabled" class="prop-group bezier-group-row">
            <label>CP1</label>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.curveCp1XInput"
              @update:model-value="objProps.curveCp1XInput = String($event)"
              @change="setSelectedSegmentControlPointCoordFromInput('cp1', 'x', $event)"
            ><template #suffix>px</template></ZInput>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.curveCp1YInput"
              @update:model-value="objProps.curveCp1YInput = String($event)"
              @change="setSelectedSegmentControlPointCoordFromInput('cp1', 'y', $event)"
            ><template #suffix>px</template></ZInput>
          </div>
          <div v-if="objProps.curveEnabled" class="prop-group bezier-group-row">
            <label>CP2</label>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.curveCp2XInput"
              @update:model-value="objProps.curveCp2XInput = String($event)"
              @change="setSelectedSegmentControlPointCoordFromInput('cp2', 'x', $event)"
            ><template #suffix>px</template></ZInput>
            <ZInput
              size="small"
              type="text"
              :model-value="objProps.curveCp2YInput"
              @update:model-value="objProps.curveCp2YInput = String($event)"
              @change="setSelectedSegmentControlPointCoordFromInput('cp2', 'y', $event)"
            ><template #suffix>px</template></ZInput>
          </div>
        </div>
        <div class="prop-section">
          <div class="prop-group style-toggle-row">
            <label>万花筒</label>
            <ZSwitch
              size="small"
              :model-value="objProps.kaleidoscopeEnabled"
              :disabled="!activeKaleidoscopeEditableSource"
              @change="setKaleidoscopeEnabled"
            />
          </div>
          <template v-if="activeKaleidoscopeEditableSource && objProps.kaleidoscopeEnabled">
            <div class="prop-group bezier-group-row">
              <label>中心点</label>
              <ZInput
                size="small"
                type="text"
                :model-value="objProps.kaleidoscopeCenterXInput"
                @update:model-value="objProps.kaleidoscopeCenterXInput = String($event)"
                @change="setKaleidoscopeCenterFromInput('x', $event)"
              ><template #suffix>px</template></ZInput>
              <ZInput
                size="small"
                type="text"
                :model-value="objProps.kaleidoscopeCenterYInput"
                @update:model-value="objProps.kaleidoscopeCenterYInput = String($event)"
                @change="setKaleidoscopeCenterFromInput('y', $event)"
              ><template #suffix>px</template></ZInput>
            </div>
            <div class="prop-group style-toggle-row">
              <label>跟随旋转</label>
              <ZSwitch size="small" :model-value="objProps.kaleidoscopeFollowRotation" @change="setKaleidoscopeFollowRotation" />
            </div>
            <div class="prop-group style-color-row">
              <label>份数</label>
              <ZInput
                size="small"
                type="text"
                :model-value="objProps.kaleidoscopeCountInput"
                @update:model-value="objProps.kaleidoscopeCountInput = String($event)"
                @change="setKaleidoscopeCountFromInput"
              />
            </div>
          </template>
        </div>
        <div class="prop-actions boolean-actions">
          <button class="tb-btn" @mouseenter="showBooleanPreview('union')" @mouseleave="clearBooleanPreview" @click="runBooleanOperation('union')" :disabled="!canBoolean">并集</button>
          <button class="tb-btn" @mouseenter="showBooleanPreview('intersect')" @mouseleave="clearBooleanPreview" @click="runBooleanOperation('intersect')" :disabled="!canBoolean">交集</button>
          <ZPopover
            v-if="canBoolean"
            :show="subtractPopoverVisible"
            trigger="hover"
            placement="top"
            :to="false"
            show-arrow
            keep-alive-on-hover
            @update:show="handleSubtractPopoverShowChange"
          >
            <template #trigger>
              <button class="tb-btn" @mouseenter="showBooleanPreview('subtract')" @click="runBooleanOperation('subtract')">差集</button>
            </template>
            <div class="boolean-preview-menu">
              <template v-if="canDirectionalSubtract">
                <button class="tb-btn sm boolean-preview-option" @mouseenter="showBooleanPreview('subtract', 'forward')" @click="runBooleanOperation('subtract', 'forward')">A - B</button>
                <button class="tb-btn sm boolean-preview-option" @mouseenter="showBooleanPreview('subtract', 'reverse')" @click="runBooleanOperation('subtract', 'reverse')">B - A</button>
              </template>
              <div v-else class="boolean-preview-note">多对象差集预览当前默认结果</div>
            </div>
          </ZPopover>
          <button v-else class="tb-btn" disabled>差集</button>
          <button class="tb-btn" @mouseenter="showBooleanPreview('xor')" @mouseleave="clearBooleanPreview" @click="runBooleanOperation('xor')" :disabled="!canBoolean">异或</button>
          <span v-if="booleanBusy" class="boolean-status">处理中...</span>
          <span v-if="booleanError" class="boolean-error">{{ booleanError }}</span>
        </div>
        <div class="prop-actions">
          <button class="tb-btn" @click="groupObjects" :disabled="!canGroup" title="成组 (Ctrl+G)">成组</button>
          <button class="tb-btn" @click="ungroupObject" :disabled="!canUngroup" title="解组 (Ctrl+Shift+G)">解组</button>
          <ZPopover
            trigger="hover"
            placement="top"
            :to="false"
            show-arrow
            keep-alive-on-hover
          >
            <template #trigger>
              <button
                class="tb-btn"
                :class="{ active: currentLockMode !== 'none' }"
                :title="getLockButtonTooltip()"
                @click="toggleLock"
              >
                锁定
              </button>
            </template>
            <div class="lock-options-menu">
              <button
                class="lock-option-btn"
                :class="{ active: currentLockMode === 'none' }"
                @click="setLockMode('none')"
                title="无锁定"
              >
                <Icon icon="mdi:lock-open-variant-outline" />
              </button>
              <button
                class="lock-option-btn"
                :class="{ active: currentLockMode === 'position' }"
                @click="setLockMode('position')"
                title="锁定位置"
              >
                <Icon icon="mdi:crosshairs-gps" />
              </button>
              <button
                class="lock-option-btn"
                :class="{ active: currentLockMode === 'size' }"
                @click="setLockMode('size')"
                title="锁定尺寸"
              >
                <Icon icon="mdi:arrow-expand-all" />
              </button>
              <button
                class="lock-option-btn"
                :class="{ active: currentLockMode === 'full' }"
                @click="setLockMode('full')"
                title="完全锁定"
              >
                <Icon icon="mdi:lock-outline" />
              </button>
            </div>
          </ZPopover>
          <button class="tb-btn danger" @click="deleteObject">删除</button>
        </div>
      </template>
    </template>
    <template v-else>
      <div class="canvas-settings">
        <div class="section-title">画布设置</div>
        <div class="prop-group">
          <label>预设</label>
          <ZSelect
            size="small"
            class="w-100%"
            :model-value="canvasPresetValue"
            :options="canvasPresetOptions"
            placeholder="请选择预设"
            @change="applyCanvasPreset(String($event))"
          />
        </div>
        <div class="prop-group">
          <label>宽高</label>
          <ZInput
            size="small"
            type="text"
            :model-value="canvasWidthInput"
            @update:model-value="canvasWidthInput = String($event)"
            @change="setCanvasSizeFromInput('width', $event)"
          ><template #suffix>px</template></ZInput>
          <ZInput
            size="small"
            type="text"
            :model-value="canvasHeightInput"
            @update:model-value="canvasHeightInput = String($event)"
            @change="setCanvasSizeFromInput('height', $event)"
          ><template #suffix>px</template></ZInput>
        </div>
        <div class="prop-group">
          <label>背景</label>
          <div class="canvas-bg-picker">
            <ZButton
              class="transparent-swatch"
              :class="{ active: isCanvasBgTransparent }"
              title="透明"
              @click="setCanvasBg('transparent')"
            />
            <ZColorPicker
              size="small"
              :show-input="false"
              :model-value="canvasBgPickerValue"
              @change="setCanvasBg(String($event))"
            />
          </div>
        </div>
        <div class="prop-group style-toggle-row">
          <label>网格</label>
          <ZSwitch size="small" :model-value="showPixelGrid" @change="setPixelGridVisible" />
        </div>
        <div class="prop-group style-toggle-row">
          <label>网格吸附</label>
          <ZSwitch size="small" :model-value="snapToPixelGrid" @change="setSnapToPixelGrid" />
        </div>
        <div class="prop-group style-color-row">
          <label>网格间距</label>
          <ZInput
            size="small"
            type="text"
            :model-value="pixelGridSizeInput"
            @update:model-value="pixelGridSizeInput = String($event)"
            @change="setPixelGridSizeFromInput"
          ><template #suffix>px</template></ZInput>
        </div>
        <div class="prop-group style-color-row">
          <label>画笔大小</label>
          <ZInput
            size="small"
            type="text"
            :model-value="pixelPaintBrushSizeInput"
            @update:model-value="pixelPaintBrushSizeInput = String($event)"
            @change="setPixelPaintBrushSizeFromInput"
            title="油漆桶网格上色时的画笔边长（N × N 个网格单元格）"
          ><template #suffix>格</template></ZInput>
        </div>
        <div class="prop-group style-color-row">
          <label>参考线</label>
          <ZSelect
            size="small"
            class="w-100%"
            :model-value="keylineTemplate"
            :options="keylineTemplateOptions"
            @change="setKeylineTemplate(String($event) as KeylineTemplate)"
          />
        </div>
        <div v-if="keylineTemplate === 'custom'" class="prop-group style-color-row">
          <label>安全区</label>
          <ZInput
            size="small"
            type="text"
            :model-value="keylineMarginInput"
            @update:model-value="keylineMarginInput = String($event)"
            @change="setKeylineMarginFromInput"
          ><template #suffix>px</template></ZInput>
        </div>
        <div v-if="keylineTemplate !== 'none'" class="prop-group rotation-row">
          <label>透明度</label>
          <ZSlider
            :model-value="keylineOpacity"
            :min="0"
            :max="1"
            :step="0.01"
            :formatter="(value) => `${Math.round(Number(value) * 100)}%`"
            @change="setKeylineOpacity"
          />
          <span class="val-label">{{ `${Math.round(keylineOpacity * 100)}%` }}</span>
        </div>
        <div class="prop-group">
          <label>颜色</label>
          <ZButton size="small" class="w-100%" title="扫描文档颜色并批量替换" @click="openColorReplace">颜色替换…</ZButton>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { Icon } from '@iconify/vue'
import { ActiveSelection, FabricImage, Textbox, type FabricObject } from 'fabric'
import { ZButton, ZColorPicker, ZInput, ZPopover, ZSelect, ZSlider, ZSwitch } from 'ztools-ui'
import { BLEND_MODE_OPTIONS, BITMAP_FILTER_PARAM_STEP } from '../../bitmapFilters'
import { FONT_FAMILY_OPTIONS } from '../../fontCatalog'
import { PATTERN_FILL_REPEATS, PATTERN_FILL_REPEAT_LABELS } from '../../fabric/patternFill'
import type { ColorPaletteGroup, GradientPresetItem, KeylineTemplate, StylePresetManagerTab, StyleTargetChannel } from '../../types'

type AnyFn = (...args: any[]) => any

type SelectOption = {
  label: string
  value: string
}

const props = defineProps<{
  activeObject: FabricObject | null
  isMultiSelection: boolean
  selectionCount: number
  activeKaleidoscopeInstance: FabricObject | null | undefined
  activeKaleidoscopeEditableSource: FabricObject | null | undefined
  objProps: Record<string, any>
  sizeRatioLocked: boolean
  alignPopoverVisible: boolean
  currentAlignPosition: Record<string, any>
  alignPositions: Array<Record<string, any>>
  currentAlignId: string
  currentFillStyleMode: string
  hasEditablePoints: boolean
  hasSelectedPoint: boolean
  hasSelectedArrowEndpoint: boolean
  arrowAggregated: Record<string, any>
  isHollowShaftArrow: boolean
  hasSelectedCurveSegment: boolean
  canBoolean: boolean
  canDirectionalSubtract: boolean
  subtractPopoverVisible: boolean
  booleanBusy: boolean
  booleanError: string
  canGroup: boolean
  canUngroup: boolean
  canAlignSelection: boolean
  canDistributeSelection: boolean
  canvasPresetValue: string
  canvasPresetOptions: SelectOption[]
  canvasWidthInput: string
  canvasHeightInput: string
  canvasBgPickerValue: string
  isCanvasBgTransparent: boolean
  showPixelGrid: boolean
  snapToPixelGrid: boolean
  pixelGridSizeInput: string
  pixelPaintBrushSizeInput: string
  keylineTemplate: KeylineTemplate
  keylineTemplateOptions: SelectOption[]
  keylineMarginInput: string
  keylineOpacity: number
  /** 打开全局颜色替换弹窗（文档级工具，无对象选中时展示在画布设置区）。 */
  openColorReplace: AnyFn
  colorPaletteGroups: ColorPaletteGroup[]
  gradientPresets: GradientPresetItem[]
  colorPaletteColumns: number
  selectKaleidoscopeSourceFromInstance: AnyFn
  detachKaleidoscopeInstance: AnyFn
  setObjPropFromInput: AnyFn
  setObjSizeFromInput: AnyFn
  toggleSizeRatioLock: AnyFn
  setObjProp: AnyFn
  setEndpointSnapMarginFromInput: AnyFn
  alignToCanvas: AnyFn
  selectAlign: AnyFn
  toggleFill: AnyFn
  setFillStyleMode: AnyFn
  setSolidFillColor: AnyFn
  reorderFillGradientStops: AnyFn
  setFillGradientStopColor: AnyFn
  isFillGradientStopPercentDisabled: AnyFn
  setFillGradientStopOffset: AnyFn
  setFillGradientStopOffsetFromInput: AnyFn
  removeFillGradientStop: AnyFn
  addFillGradientStop: AnyFn
  setFillGradientAngleValue: AnyFn
  setFillGradientAngleFromInput: AnyFn
  setFillGradientRadiusValue: AnyFn
  applyColorSwatch: AnyFn
  applyGradientPreset: AnyFn
  toggleStroke: AnyFn
  setStrokeWidthFromInput: AnyFn
  setStrokeLineType: AnyFn
  setStrokeDashLengthFromInput: AnyFn
  setStrokeDashGapFromInput: AnyFn
  setCornerRadiusFromInput: AnyFn
  setSelectedPointCornerRadiusFromInput: AnyFn
  toggleSelectedArrowEnabled: AnyFn
  setSelectedArrowShape: AnyFn
  setSelectedArrowAngle: AnyFn
  setHollowArrowLineWidthFromInput: AnyFn
  setHollowArrowTipAngle: AnyFn
  setHollowArrowSideAngle: AnyFn
  setSelectedArrowLengthFromInput: AnyFn
  setSelectedSegmentCurveEnabled: AnyFn
  setSelectedSegmentControlPointCoordFromInput: AnyFn
  setKaleidoscopeEnabled: AnyFn
  setKaleidoscopeCenterFromInput: AnyFn
  setKaleidoscopeFollowRotation: AnyFn
  setKaleidoscopeCountFromInput: AnyFn
  showBooleanPreview: AnyFn
  clearBooleanPreview: AnyFn
  runBooleanOperation: AnyFn
  handleSubtractPopoverShowChange: AnyFn
  groupObjects: AnyFn
  ungroupObject: AnyFn
  alignSelection: AnyFn
  distributeSelection: AnyFn
  lockObject: AnyFn
  deleteObject: AnyFn
  applyCanvasPreset: AnyFn
  setCanvasSizeFromInput: AnyFn
  setCanvasBg: AnyFn
  setPixelGridVisible: AnyFn
  setSnapToPixelGrid: AnyFn
  setPixelGridSizeFromInput: AnyFn
  setPixelPaintBrushSizeFromInput: AnyFn
  setKeylineTemplate: AnyFn
  setKeylineMarginFromInput: AnyFn
  setKeylineOpacity: AnyFn
  openStylePresetManager: (tab: StylePresetManagerTab) => void
  addShadowEffect: AnyFn
  toggleShadowEffect: AnyFn
  setShadowEffectProp: AnyFn
  removeShadowEffect: AnyFn
  setObjectBlendMode: AnyFn
  setTextProp: AnyFn
  setTextPropFromInput: AnyFn
  toggleTextBold: AnyFn
  toggleTextItalic: AnyFn
  toggleTextUnderline: AnyFn
  toggleTextLinethrough: AnyFn
  setTextAlign: AnyFn
  toggleImageFilter: AnyFn
  setImageFilterParam: AnyFn
  cropModeActive: boolean
  beginBitmapCrop: AnyFn
  confirmBitmapCrop: AnyFn
  cancelBitmapCrop: AnyFn
  setPatternFillFromFile: AnyFn
  setPatternFillRepeat: AnyFn
  setPatternFillScale: AnyFn
  flipObject: AnyFn
  resetTransform: AnyFn
  setRotate3DFromInput: AnyFn
  copyStyle: AnyFn
  pasteStyle: AnyFn
  currentLockMode: string
  setLockMode: AnyFn
}>()

const emit = defineEmits<{
  (event: 'update:align-popover-visible', value: boolean): void
  (event: 'update:canvas-width-input', value: string): void
  (event: 'update:canvas-height-input', value: string): void
  (event: 'update:pixel-grid-size-input', value: string): void
  (event: 'update:pixel-paint-brush-size-input', value: string): void
  (event: 'update:keyline-margin-input', value: string): void
}>()

function getLockButtonTooltip() {
  switch (props.currentLockMode) {
    case 'position':
      return '已锁定位置（点击切换/悬浮查看选项）'
    case 'size':
      return '已锁定尺寸（点击切换/悬浮查看选项）'
    case 'full':
      return '已完全锁定（点击切换/悬浮查看选项）'
    default:
      return '锁定对象（点击切换/悬浮查看选项）'
  }
}

function toggleLock() {
  if (props.currentLockMode === 'none') {
    props.setLockMode('full')
  } else {
    props.setLockMode('none')
  }
}

const colorSwatchTargets: Array<{ channel: StyleTargetChannel; label: string; className: string }> = [
  { channel: 'fill', label: '填', className: 'fill-target' },
  { channel: 'stroke', label: '描', className: 'stroke-target' }
]

// 生成色板按钮提示，区分同一颜色应用到填充或描边，减少小按钮含义不清的问题。
function getColorSwatchButtonTitle(name: string, channel: StyleTargetChannel) {
  return `${channel === 'fill' ? '应用到填充' : '应用到描边'}：${name}`
}

// 把预设色标格式化为 CSS 渐变 stop，供属性面板中轻量预览渐变外观。
function getGradientStopCss(preset: GradientPresetItem) {
  const stops = [...preset.stops].sort((a, b) => a.offset - b.offset)
  return stops.map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`).join(', ')
}

// 将 Fabric 的 0° 向右角度转换为 CSS linear-gradient 的角度体系，用于保持预览方向接近实际填充。
function getCssLinearGradientAngle(angle: unknown) {
  const parsed = Number(angle)
  const normalized = Number.isFinite(parsed) ? parsed : 0
  return (normalized + 90) % 360
}

// 根据线性 / 径向预设生成预览块背景；只影响面板展示，不参与 Fabric 对象数据。
function getGradientPresetStyle(preset: GradientPresetItem) {
  const stops = getGradientStopCss(preset)
  if (preset.type === 'radial') {
    const x = Math.round((Number(preset.centerX) || 0.5) * 100)
    const y = Math.round((Number(preset.centerY) || 0.5) * 100)
    return { background: `radial-gradient(circle at ${x}% ${y}%, ${stops})` }
  }
  return { background: `linear-gradient(${getCssLinearGradientAngle(preset.angle)}deg, ${stops})` }
}

// 生成渐变预设 tooltip，补充类型和自定义来源，便于区分内置预设与用户保存预设。
function getGradientPresetTitle(preset: GradientPresetItem) {
  const typeLabel = preset.type === 'radial' ? '径向渐变' : '线性渐变'
  return `${preset.name} · ${typeLabel}${preset.userCreated ? ' · 我的预设' : ''}`
}

const colorPaletteColumns = computed(() => {
  const parsed = Number(props.colorPaletteColumns)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6
})
// 位图滤镜区仅对单个选中的位图对象显示（多选/组合时 activeObject 是 ActiveSelection，不命中）
const isBitmapActiveObject = computed(() => props.activeObject instanceof FabricImage)
const blendModeOptions = BLEND_MODE_OPTIONS
// 字体下拉选项（fontCatalog 常见系统字体清单，value 即 fabric fontFamily 字符串）
const fontFamilyOptions = FONT_FAMILY_OPTIONS
// 文本区显隐：选中集合内包含文本对象即显示（单选文本，或多选/编组中的文本子对象，支持批量应用）
const showTextSection = computed(() => {
  const obj = props.activeObject
  if (!obj) return false
  const candidates = obj instanceof ActiveSelection ? obj.getObjects() : [obj]
  return candidates.some((candidate) => candidate instanceof Textbox)
})
// 图案填充平铺方式下拉选项（value 与 fabric Pattern.repeat / MCP 契约一致）
const patternRepeatOptions = PATTERN_FILL_REPEATS.map((value) => ({
  label: PATTERN_FILL_REPEAT_LABELS[value],
  value
}))
const alignPopoverVisible = computed({
  get: () => props.alignPopoverVisible,
  set: (value: boolean) => emit('update:align-popover-visible', value)
})
const canvasWidthInput = computed({
  get: () => props.canvasWidthInput,
  set: (value: string) => emit('update:canvas-width-input', value)
})
const canvasHeightInput = computed({
  get: () => props.canvasHeightInput,
  set: (value: string) => emit('update:canvas-height-input', value)
})
const pixelGridSizeInput = computed({
  get: () => props.pixelGridSizeInput,
  set: (value: string) => emit('update:pixel-grid-size-input', value)
})
const pixelPaintBrushSizeInput = computed({
  get: () => props.pixelPaintBrushSizeInput,
  set: (value: string) => emit('update:pixel-paint-brush-size-input', value)
})
const keylineMarginInput = computed({
  get: () => props.keylineMarginInput,
  set: (value: string) => emit('update:keyline-margin-input', value)
})
</script>

<style lang="scss" scoped>
@use '../../styles/tokens' as *;

.right-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.section-title {
  font-weight: 700;
  font-size: 12px;
  padding: 6px 4px;
  color: #555;
}
.tb-btn {
  padding: 4px 10px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 5px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease, background 0.15s ease;
  &:hover { background: #e8e8e8; }
  &:disabled { opacity: 0.4; cursor: default; }
  &.sm { padding: 3px 7px; font-size: 11px; }
  &.danger { color: #c00; }
  &.active {
    border-color: var(--primary-color);
    color: var(--primary-color);
    background: var(--primary-light-bg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color), transparent 35%);
  }
}
.canvas-bg-picker,
.stroke-line-type-picker {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  :deep(.zt-color-picker) {
    display: inline-flex;
    flex: 0 0 auto;
  }
}
.transparent-swatch {
  position: relative;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  overflow: hidden;
  padding: 0;
  box-sizing: border-box;
  background-color: #fafafa;
  background-image:
    linear-gradient(45deg, rgba(0, 0, 0, 0.07) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.07) 75%, rgba(0, 0, 0, 0.07)),
    linear-gradient(45deg, rgba(0, 0, 0, 0.07) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.07) 75%, rgba(0, 0, 0, 0.07));
  background-position: 0 0, 6px 6px;
  background-size: 12px 12px;
  box-shadow: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  &:hover:not(:disabled) {
    background-color: #fafafa;
    background-image:
      linear-gradient(45deg, rgba(0, 0, 0, 0.07) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.07) 75%, rgba(0, 0, 0, 0.07)),
      linear-gradient(45deg, rgba(0, 0, 0, 0.07) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.07) 75%, rgba(0, 0, 0, 0.07));
    background-position: 0 0, 6px 6px;
    background-size: 12px 12px;
  }

  &.active {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px var(--primary-light-bg);
  }
}
.stroke-line-swatch {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  padding: 0;
  box-sizing: border-box;
  border: 2px solid var(--control-border);
  border-radius: 6px;
  background: #fafafa;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;

  &::before {
    content: '';
    display: block;
    width: 16px;
    height: 0;
    border-top: 2px solid #333;
    margin: 0 auto;
  }

  &.dashed::before {
    border-top-style: dashed;
  }

  &:hover:not(:disabled) {
    background-color: #fafafa;
    border-color: color-mix(in srgb, var(--primary-color), black 15%);
  }

  &.active {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px var(--primary-light-bg);
  }
}
.arrow-shape-picker,
.fill-style-picker {
  .stroke-line-swatch {
    &::before {
      display: none;
    }
    background-color: #fafafa;
    background-position: center;
    background-repeat: no-repeat;
    background-size: 18px 16px;

    &:hover:not(:disabled) {
      background-color: #fafafa;
    }
  }
}
.arrow-shape-picker {
  .arrow-shape-solid {
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 16'><path d='M2 8H11' fill='none' stroke='%23333' stroke-width='2.4' stroke-linecap='round'/><path d='M10.2 4.15C10.2 3.57 10.85 3.23 11.33 3.55L15.32 6.22C16.5 7.01 16.5 8.99 15.32 9.78L11.33 12.45C10.85 12.77 10.2 12.43 10.2 11.85V4.15Z' fill='%23333'/></svg>");
  }
  .arrow-shape-hollow {
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 16'><path d='M2 8H11' fill='none' stroke='%23333' stroke-width='2.4' stroke-linecap='round'/><path d='M10.4 4.5L13.9 8L10.4 11.5' fill='none' stroke='%23333' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  }
}
.fill-style-picker {
  .fill-style-solid {
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 16'><rect x='3' y='3' width='12' height='10' rx='2' fill='%23333'/></svg>");
  }
  .fill-style-radial {
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 16'><defs><radialGradient id='g' cx='50%25' cy='50%25' r='65%25'><stop offset='0%25' stop-color='%23333'/><stop offset='100%25' stop-color='%23d8d8d8'/></radialGradient></defs><rect x='3' y='3' width='12' height='10' rx='2' fill='url(%23g)' stroke='%23333' stroke-width='0.6'/></svg>");
  }
  .fill-style-linear {
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 16'><defs><linearGradient id='g' x1='0%25' y1='50%25' x2='100%25' y2='50%25'><stop offset='0%25' stop-color='%23333'/><stop offset='100%25' stop-color='%23d8d8d8'/></linearGradient></defs><rect x='3' y='3' width='12' height='10' rx='2' fill='url(%23g)' stroke='%23333' stroke-width='0.6'/></svg>");
  }
  .fill-style-pattern {
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 16'><defs><pattern id='p' width='5' height='5' patternUnits='userSpaceOnUse'><rect width='5' height='5' fill='%23ffffff'/><rect width='2.5' height='2.5' fill='%23333'/><rect x='2.5' y='2.5' width='2.5' height='2.5' fill='%23333'/></pattern></defs><rect x='3' y='3' width='12' height='10' rx='2' fill='url(%23p)' stroke='%23333' stroke-width='0.6'/></svg>");
  }
}
.size-lock-icon,
.size-lock-spacer {
  width: 20px;
  height: 22px;
  flex-shrink: 0;
}
.size-lock-spacer {
  display: block;
}
.size-lock-icon {
  justify-self: center;
  padding: 3px;
  cursor: pointer;
  color: #666;
  &.active { color: #1e6fff; }
}
.prop-section {
  padding: 4px 0;
  border-bottom: $border;
}
.transform-row {
  display: grid!important;
  grid-template-columns: 28px 20px 1fr 1fr;
  column-gap: 4px;
}
.align-row {
  display: grid!important;
  grid-template-columns: 36px 1fr;
  column-gap: 8px;
  align-items: center;
  :deep(.zt-popover) {
    justify-self: end;
  }
}
.selection-layout-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  min-width: 0;
}
.distribute-actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.layout-tool-btn {
  min-width: 0;
  padding-inline: 4px;
}
.align-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: 1fr;
  gap: 4px;
  width: 100%;
}
.align-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 3px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 5px;
  background: #fff;
  color: #555;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
  &:hover {
    background: color-mix(in srgb, var(--primary-color) 8%, #fff);
    border-color: var(--primary-color);
    color: var(--primary-color);
  }
  &.active {
    border-color: var(--primary-color);
    color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color) 12%, #fff);
  }
  &.align-trigger {
    color: var(--primary-color);
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
  }
}
.align-grid .align-btn {
  width: 100%;
  height: auto;
  aspect-ratio: 1;
}
.align-popover-grid {
  width: 108px;
}
:deep(.zt-popover__panel:has(.align-popover-grid) .zt-popover__content) {
  min-width: 0;
}
:deep(.zt-popover__panel:has(.align-popover-grid) .zt-popover__body--card) {
  padding: 8px;
}
.gradient-stop-list {
  display: flex;
  flex-direction: column;
}
.prop-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  label:not(.zt-switch) {
    font-size: 11px;
    color: #666;
    min-width: 48px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  :deep(.zt-input) {
    width: 100%;
  }
  .val-label {
    font-size: 11px;
    color: #666;
    min-width: 36px;
    text-align: right;
  }
  &.rotation-row,
  &.opacity-row,
  &.gradient-radius-row {
    label {
      width: 52px;
      min-width: 52px;
      white-space: nowrap;
    }
  }
  .max-w-60px {
    max-width: 60px;
  }
  &.style-toggle-row,
  &.style-color-row {
    display: grid;
    grid-template-columns: 48px 1fr;
    column-gap: 8px;
  }
  &.gradient-stop-row {
    display: grid;
    grid-template-columns: 20px auto minmax(0, 1fr) 60px auto;
    column-gap: 6px;
    align-items: center;

    .gradient-stop-offset-input {
      width: 100%;
    }
  }
  &.bezier-group-row {
    display: grid;
    grid-template-columns: 48px 1fr 1fr;
    column-gap: 6px;
  }
  &.selection-layout-row {
    display: grid;
    grid-template-columns: 48px 1fr;
    column-gap: 8px;
  }
  &.rotation-combined-row {
    display: grid;
    grid-template-columns: 48px 1fr;
    column-gap: 8px;
    :deep(.zt-popover) {
      width: 100%;
    }
  }
  .stroke-line-type-picker {
    justify-self: end;
  }
  &.style-toggle-row {
    :deep(.zt-switch) {
      justify-self: end;
    }
  }
}
/* 画布设置区：label 最小宽度统一为 36px，覆盖共享行样式里更宽的网格列 / 固定宽度 */
.canvas-settings {
  .prop-group {
    &.rotation-row {
      label {
        width: auto;
        min-width: 36px;
      }
    }
  }
}
.rotation-inputs-group {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  width: 100%;
}
.rotation-tooltip {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px;
  min-width: 240px;
}
.rotation-tooltip-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rotation-tooltip-label {
  font-size: 11px;
  color: #666;
  font-weight: 500;
}
.gradient-stop-actions {
  padding: 4px 8px 8px;
}
.gradient-stop-add-btn {
  width: 100%;
}
.gradient-stop-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #888;
  cursor: grab;
  &:active {
    cursor: grabbing;
  }
}
.layer-icon-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  padding: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &.danger:hover { color: #c00; }
}
.trace-mode-picker {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  .tb-btn.active {
    border-color: var(--primary-color);
    color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color) 10%, #fff);
  }
}
.prop-actions {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  flex-wrap: wrap;
}
.boolean-actions {
  border-bottom: $border;
  margin-top: 0;
}
.boolean-preview-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 120px;
}
.boolean-preview-option {
  width: 100%;
  justify-content: flex-start;
}
.boolean-preview-note {
  font-size: 12px;
  color: #666;
  line-height: 1.4;
  max-width: 180px;
}
.boolean-status,
.boolean-error {
  width: 100%;
  font-size: 12px;
}
.boolean-status { color: #666; }
.boolean-error { color: #c00; }

.shadow-effects-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px 8px;
}
.shadow-effect-item {
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 6px;
  padding: 4px 8px;
  background: #fafafa;
}
.shadow-header {
  padding: 4px 0 !important;
}
/* 位图滤镜列表：与阴影效果列表同风格，每行 = 一种滤镜（开关头 + 可选参数滑杆行） */
.bitmap-filter-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px 8px;
}
/* 位图裁剪会话按钮组：进入/确认/取消右对齐，与面板开关行风格一致 */
.crop-session-actions {
  display: flex;
  gap: 4px;
  justify-self: end;
}
/* 图案填充来源行：上传按钮 + 来源名（超出省略），来源名用 val-label 同款弱化色 */
.pattern-source-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.pattern-upload-btn {
  position: relative;
  flex: 0 0 auto;
  cursor: pointer;
}
.pattern-file-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.pattern-source-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #666;
}
.bitmap-filter-item {
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 6px;
  padding: 2px 8px 4px;
  background: #fafafa;
}
.bitmap-filter-header {
  padding: 4px 0 !important;
}
/* 文本区样式按钮行：粗体/斜体/下划线/删除线与对齐三态按钮，右对齐与线型选择器一致 */
.text-style-actions {
  display: flex;
  gap: 4px;
  justify-self: end;
}
.text-style-btn {
  justify-content: center;
  min-width: 28px;
  &.bold { font-weight: 700; }
  &.italic { font-style: italic; }
  &.underline { text-decoration: underline; }
  &.linethrough { text-decoration: line-through; }
}
.transform-actions-row {
  display: grid !important;
  grid-template-columns: 48px 1fr;
  column-gap: 8px;
}
.transform-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.lock-options-menu {
  display: flex;
  flex-direction: row;
  gap: 6px;
  padding: 8px;
  min-width: 0;
}
.lock-option-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  background: #fff;
  color: #555;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease, background 0.15s ease;

  :deep(.iconify) {
    width: 16px;
    height: 16px;
  }

  &:hover {
    background: color-mix(in srgb, var(--primary-color) 8%, #fff);
    border-color: var(--primary-color);
    color: var(--primary-color);
  }

  &.active {
    border-color: var(--primary-color);
    color: var(--primary-color);
    background: var(--primary-light-bg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color), transparent 35%);
  }
}
</style>
