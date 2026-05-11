/**
 * 图像差异比较Composable
 * 提供图像对比功能，包括多种视图模式和像素级差异计算
 */

import { ref, shallowRef, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import pixelmatch from 'pixelmatch'
import { readFileAsDataURL } from '@/utils/file'

/**
 * 视图模式类型
 * - split: 分屏显示
 * - slider: 滑块对比
 * - blend: 混合叠加
 * - highlight: 差异高亮
 */
type ViewMode = 'split' | 'slider' | 'blend' | 'highlight'

/**
 * 图像差异比较Composable
 */
export function useImageDiff() {
    /** 源图像的DataURL */
    const sourceImage = shallowRef<string | null>(null)
    /** 目标图像的DataURL */
    const targetImage = shallowRef<string | null>(null)
    /** 当前视图模式 */
    const viewMode = ref<ViewMode>('split')

    /** 滑块位置（百分比） */
    const sliderPos = ref(50)
    /** 是否正在拖动滑块 */
    const isDragging = ref(false)
    /** 是否正在平移图像 */
    const isPanning = ref(false)
    /** 混合模式的透明度 */
    const blendOpacity = ref(0.5)

    /** 缩放比例 */
    const zoom = ref(1)
    /** 水平平移距离 */
    const panX = ref(0)
    /** 垂直平移距离 */
    const panY = ref(0)
    /** 上一次鼠标位置 */
    const lastMousePos = ref({ x: 0, y: 0 })

    /** 差异叠加层的DataURL */
    const diffOverlay = shallowRef<string | null>(null)
    /** 是否正在计算差异 */
    const isComputingDiff = ref(false)

    /** 两张图像是否都已加载 */
    const bothLoaded = computed(() => !!sourceImage.value && !!targetImage.value)

    /**
     * 加载图像对象
     * @param src - 图像的DataURL
     * @returns Promise<HTMLImageElement> 加载的图像元素
     */
    const loadImageObj = (src: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.onerror = reject
            img.src = src
        })
    }

    /**
     * 计算像素级差异
     * 使用pixelmatch库比较两张图像的像素差异
     */
    const computePixelDiff = async () => {
        if (!sourceImage.value || !targetImage.value) return
        isComputingDiff.value = true
        try {
            const imgSrc = await loadImageObj(sourceImage.value)
            const imgTarget = await loadImageObj(targetImage.value)

            const width = Math.max(imgSrc.width, imgTarget.width)
            const height = Math.max(imgSrc.height, imgTarget.height)

            const c1 = document.createElement('canvas')
            c1.width = width
            c1.height = height
            const ctx1 = c1.getContext('2d')!
            ctx1.drawImage(imgSrc, 0, 0)
            const data1 = ctx1.getImageData(0, 0, width, height)

            const c2 = document.createElement('canvas')
            c2.width = width
            c2.height = height
            const ctx2 = c2.getContext('2d')!
            ctx2.drawImage(imgTarget, 0, 0)
            const data2 = ctx2.getImageData(0, 0, width, height)

            const diffCanvas = document.createElement('canvas')
            diffCanvas.width = width
            diffCanvas.height = height
            const diffCtx = diffCanvas.getContext('2d')!
            const diffData = diffCtx.createImageData(width, height)

            pixelmatch(data1.data, data2.data, diffData.data, width, height, {
                threshold: 0.1,
                alpha: 0.5,
                includeAA: true,
                diffColor: [255, 0, 0],
            })

            diffCtx.putImageData(diffData, 0, 0)
            diffOverlay.value = diffCanvas.toDataURL()
        } catch (e) {
            console.error('计算差异失败:', e)
        } finally {
            isComputingDiff.value = false
        }
    }

    /**
     * 监听视图模式和图像变化，自动计算差异
     */
    watch([viewMode, sourceImage, targetImage], () => {
        if (viewMode.value === 'highlight' && bothLoaded.value) {
            computePixelDiff()
        }
    })

    /**
     * 处理文件输入
     * @param e - 输入事件
     * @param side - 文件放置位置：source-源图像，target-目标图像
     */
    const handleFileInput = async (e: Event, side: 'source' | 'target') => {
        const input = e.target as HTMLInputElement
        const files = input.files
        if (!files || files.length === 0) return

        if (files.length >= 2) {
            sourceImage.value = await readFileAsDataURL(files[0])
            targetImage.value = await readFileAsDataURL(files[1])
        } else {
            const url = await readFileAsDataURL(files[0])
            if (side === 'source') sourceImage.value = url
            else targetImage.value = url
        }
        input.value = ''
    }

    /**
     * 清除所有图像
     */
    const clearImages = () => {
        sourceImage.value = null
        targetImage.value = null
        diffOverlay.value = null
        sliderPos.value = 50
        blendOpacity.value = 0.5
        viewMode.value = 'split'
        resetTransform()
    }

    /**
     * 重置变换（缩放和平移）
     */
    const resetTransform = () => {
        zoom.value = 1
        panX.value = 0
        panY.value = 0
    }

    /**
     * 开始拖动滑块
     * @param e - 鼠标事件
     */
    const startSliderDrag = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        isDragging.value = true
        nextTick()
    }

    /**
     * 开始平移
     * @param e - 鼠标事件
     * @description 在滑块模式下禁用平移，仅允许拖动滑块手柄
     */
    const startPan = (e: MouseEvent) => {
        if (viewMode.value === 'slider') return

        isPanning.value = true
        lastMousePos.value = { x: e.clientX, y: e.clientY }
    }

    /**
     * 处理鼠标滚轮缩放
     * @param e - 滚轮事件
     */
    const handleWheel = (e: WheelEvent) => {
        e.preventDefault()
        const delta = -e.deltaY
        const zoomSpeed = 0.001
        const newZoom = Math.max(0.1, Math.min(zoom.value + delta * zoomSpeed, 10))
        zoom.value = newZoom
    }

    /** 视口元素引用 */
    let viewportRef = shallowRef<HTMLDivElement | null>(null)

    /**
     * 鼠标移动事件处理
     * 处理滑块拖动和平移操作
     * @param e - 鼠标事件
     */
    const onMouseMove = (e: MouseEvent) => {
        if (isDragging.value && viewMode.value === 'slider' && viewportRef) {
            const rect = viewportRef.value.getBoundingClientRect()
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
            sliderPos.value = (x / rect.width) * 100
        } else if (isPanning.value) {
            const dx = e.clientX - lastMousePos.value.x
            const dy = e.clientY - lastMousePos.value.y
            panX.value += dx
            panY.value += dy
            lastMousePos.value = { x: e.clientX, y: e.clientY }
        }
    }

    /**
     * 停止拖动
     */
    const stopDrag = () => {
        isDragging.value = false
        isPanning.value = false
    }

    /**
     * 图像变换样式计算
     */
    const imageTransform = computed(() => ({
        transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
        transition: isPanning.value ? 'none' : 'transform 0.1s ease-out',
    }))

    /**
     * 组件挂载时添加全局事件监听
     */
    onMounted(() => {
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', stopDrag)
    })

    /**
     * 组件卸载时移除事件监听
     */
    onUnmounted(() => {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', stopDrag)
    })

    /**
     * 返回的接口对象
     */
    return {
        sourceImage,
        targetImage,
        viewMode,
        sliderPos,
        isDragging,
        blendOpacity,
        zoom,
        panX,
        panY,
        diffOverlay,
        isComputingDiff,
        bothLoaded,
        handleFileInput,
        clearImages,
        resetTransform,
        startSliderDrag,
        startPan,
        handleWheel,
        imageTransform,
        viewportRef
    }
}