/**
 * 留学课堂音频拾音增强与防休眠控制器 (audio-meter.js)
 * 1. 针对阶梯教室远场拾音优化麦克风约束（关闭回声消除与过度降噪，开启自动增益）
 * 2. 提供实时音量电平检测 (RMS)，直观展示是否成功收录到远处老师的声音
 * 3. 管理浏览器 Screen Wake Lock 防息屏锁
 */
export class ClassroomAudioGuardian {
  constructor({ onVolumeChange, onWakeLockChange }) {
    this.onVolumeChange = onVolumeChange || (() => {});
    this.onWakeLockChange = onWakeLockChange || (() => {});

    this.mediaStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.rafId = null;
    this.wakeLockSentinel = null;
    this.farFieldMode = true;
  }

  /**
   * 启动麦克风远场拾音引导与实时音量表
   * @param {boolean} farFieldMode 是否开启课堂远场拾音模式
   */
  async startMicrophoneMonitor(farFieldMode = true) {
    this.farFieldMode = farFieldMode;
    this.stopMicrophoneMonitor();

    const audioConstraints = farFieldMode
      ? {
          echoCancellation: false, // 关闭回声消除，防止损失远场人声频段
          noiseSuppression: false, // 关闭默认会议降噪，防止远处老师声音被当噪音过滤
          autoGainControl: true,   // 开启自动增益，放大远处讲台声音
          channelCount: 1
        }
      : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        };

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.65;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      const updateMeter = () => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        // 映射到 0-100 的视觉百分比（对微弱远场声音做非线性放大方便观察）
        const level = Math.min(100, Math.round(Math.pow(rms, 0.55) * 185));
        this.onVolumeChange(level, rms);
        this.rafId = requestAnimationFrame(updateMeter);
      };

      this.rafId = requestAnimationFrame(updateMeter);

      const track = this.mediaStream.getAudioTracks()[0];
      const appliedSettings = track ? track.getSettings() : {};
      return {
        ok: true,
        label: track ? track.label || "默认麦克风" : "默认麦克风",
        settings: appliedSettings
      };
    } catch (err) {
      this.onVolumeChange(0, 0);
      return {
        ok: false,
        error: err.message || "无法获取麦克风权限"
      };
    }
  }

  stopMicrophoneMonitor() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    this.analyser = null;
    this.onVolumeChange(0, 0);
  }

  /**
   * 申请屏幕常亮锁 (Screen Wake Lock API)，防止上课记笔记不碰网页时屏幕休眠
   */
  async acquireWakeLock() {
    if (!("wakeLock" in navigator)) {
      this.onWakeLockChange({
        supported: false,
        active: false,
        message: "当前浏览器不支持 Wake Lock API"
      });
      return false;
    }

    try {
      this.wakeLockSentinel = await navigator.wakeLock.request("screen");
      this.onWakeLockChange({
        supported: true,
        active: true,
        message: "已开启防息屏常亮"
      });

      this.wakeLockSentinel.addEventListener("release", () => {
        this.onWakeLockChange({
          supported: true,
          active: false,
          message: "防息屏锁已释放（切回页面将自动恢复）"
        });
      });
      return true;
    } catch (err) {
      this.onWakeLockChange({
        supported: true,
        active: false,
        message: `防息屏未激活: ${err.message}`
      });
      return false;
    }
  }

  async releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch (_) {}
      this.wakeLockSentinel = null;
    }
    this.onWakeLockChange({
      supported: "wakeLock" in navigator,
      active: false,
      message: "未开启防息屏"
    });
  }
}

