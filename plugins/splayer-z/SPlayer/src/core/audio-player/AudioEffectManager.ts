/**
 * @fileoverview 负责均衡器和频谱分析的管理器
 */

export class AudioEffectManager {
  private audioCtx: AudioContext;

  /** 分析节点 */
  private analyserNode: AnalyserNode | null = null;
  /** 均衡器节点数组 */
  private filters: BiquadFilterNode[] = [];

  /** 平滑后的低频音量 */
  private smoothedLowFreqVolume: number = 0;

  /** 均衡器频段 (10段) */
  private readonly eqFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  constructor(context: AudioContext) {
    this.audioCtx = context;
    this.initNodes();
  }

  /**
   * 初始化节点
   */
  private initNodes() {
    // 创建分析器
    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = 512;

    // 创建均衡器滤波器
    this.filters = this.eqFrequencies.map((freq) => {
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = freq;
      filter.Q.value = 1;
      filter.gain.value = 0; // 默认平坦
      return filter;
    });
  }

  /**
   * 将效果链连接到音频管线中
   * 链路: Input -> Filter[0] -> ... -> Filter[9] -> Analyser -> Output(Return)
   * @param inputNode 输入音频节点 (通常是 SourceNode)
   * @returns 链条的最后一个节点 (AnalyserNode)，供调用者连接到 GainNode 或 Destination
   */
  public connect(inputNode: AudioNode): AudioNode {
    let currentNode = inputNode;

    // 串联所有滤波器
    for (const filter of this.filters) {
      currentNode.connect(filter);
      currentNode = filter;
    }

    // 连接到分析器
    if (this.analyserNode) {
      currentNode.connect(this.analyserNode);
      currentNode = this.analyserNode;
    }

    return currentNode;
  }

  /**
   * 设置均衡器增益
   * @param index 频段索引 (0-9)
   * @param value 增益值 (-40 ~ 40)
   */
  public setFilterGain(index: number, value: number) {
    if (this.filters[index]) {
      this.filters[index].gain.value = value;
    }
  }

  /**
   * 获取当前均衡器设置
   */
  public getFilterGains(): number[] {
    return this.filters.map((f) => f.gain.value);
  }

  /**
   * 获取频谱数据 (用于可视化)
   */
  public getFrequencyData(): Uint8Array {
    if (!this.analyserNode) return new Uint8Array(0);
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);
    return dataArray;
  }

  /**
   * 获取低频音量
   * @returns 低频音量 (0-1)
   */
  public getLowFrequencyVolume(): number {
    if (!this.analyserNode) return 0;

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);

    // 低频范围：前 3 个 bin (约 0-280Hz，基于 512 FFT 和约 48kHz 采样率)
    const lowFreqBins = dataArray.slice(0, 3);
    const sum = lowFreqBins.reduce((acc, val) => acc + val, 0);
    const avg = sum / lowFreqBins.length;

    // 使用阈值和幂函数扩展动态范围
    // 通常低频能量较高（约 200-255），我们需要将其映射到更有意义的范围
    const threshold = 180; // 低于此值视为静音
    const maxValue = 255;

    // 计算超过阈值的部分
    const normalized = Math.max(0, (avg - threshold) / (maxValue - threshold));

    // 应用幂函数扩展动态范围 (使低值更低，高值保持)
    const rawValue = Math.pow(normalized, 2);

    // 应用指数移动平均 (EMA) 平滑处理
    // smoothFactor 越小平滑效果越明显，0.1-0.3 较为平缓
    const smoothFactor = 0.28;
    this.smoothedLowFreqVolume =
      this.smoothedLowFreqVolume + smoothFactor * (rawValue - this.smoothedLowFreqVolume);

    return this.smoothedLowFreqVolume;
  }

  /**
   * 清理资源，断开连接
   */
  public disconnect() {
    this.filters.forEach((f) => f.disconnect());
    this.analyserNode?.disconnect();
  }
}
