/**
 * components/camera-capture.js - 摄像头拍照组件
 * ------------------------------------------------------------
 * 功能：
 *   1. 调用本地摄像头（getUserMedia）实时预览
 *   2. 点击拍摄 → 截取画面为 base64
 *   3. 上传到后端 /cameras/{id}/capture → 返回 AI 分析结果
 *   4. 在弹窗内显示拍摄照片 + AI 预测结果
 *
 * 用法：
 *   CameraCapture.open(cameraObj)  // cameraObj 须含 id 和 name
 *   CameraCapture.close()
 * ------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const { $, create, render } = global.DomUtil;

  const CameraCapture = {
    /** 当前摄像头对象 */
    _camera: null,
    /** video 流 */
    _stream: null,
    /** 是否已打开 */
    _opened: false,

    init() {
      // 绑定关闭事件（Modal 遮罩 / Esc 关闭时释放摄像头）
      document.addEventListener('modal-closed:camera-capture-modal', () => {
        this._releaseStream();
        this._opened = false;
      });
    },

    destroy() {
      this._releaseStream();
      this._opened = false;
    },

    /** 打开拍照弹窗 */
    open(camera) {
      if (!camera || !camera.id) {
        try { global.UI?.Toast?.warn('摄像头信息缺失，无法拍照'); } catch (_) {}
        return;
      }
      this._camera = camera;
      this._ensureModal();
      this._resetModalContent();
      global.UI?.Modal?.open('camera-capture-modal');

      // 更新标题
      const titleEl = $('camera-capture-title');
      if (titleEl) titleEl.textContent = '摄像头拍照 · ' + (camera.name || ('#' + camera.id));

      this._opened = true;
      // 自动启动摄像头
      this._startCamera();
    },

    close() {
      this._releaseStream();
      global.UI?.Modal?.close('camera-capture-modal');
      this._opened = false;
    },

    _ensureModal() {
      if ($('camera-capture-modal')) return;

      const modal = create('div', {
        id: 'camera-capture-modal',
        class: 'modal',
        role: 'dialog',
        'aria-modal': 'true',
        style: 'display:none;',
      }, [
        create('span', { class: 'm-corner-tr' }),
        create('span', { class: 'm-corner-bl' }),
        create('div', { class: 'modal-header' }, [
          create('div', { class: 'modal-title-wrap' }, [
            create('span', { class: 'modal-title-bar', style: '--c:#a855f7;' }),
            create('div', {}, [
              create('div', { class: 'modal-title', id: 'camera-capture-title' }, '摄像头拍照'),
              create('div', { class: 'modal-sub' }, '使用本地摄像头拍摄画面，上传后 AI 自动分析'),
            ]),
          ]),
          create('button', {
            class: 'modal-close',
            onclick: () => this.close(),
            title: '关闭',
            'aria-label': '关闭',
            html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
          }),
        ]),
        create('div', { class: 'modal-body', id: 'camera-capture-body' }),
      ]);

      document.body.appendChild(modal);
    },

    _resetModalContent() {
      const body = $('camera-capture-body');
      if (!body) return;
      body.innerHTML = '';

      // 主容器：左预览 + 右结果
      const wrap = create('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;' }, []);

      // 左侧：摄像头预览区
      const leftPanel = create('div', {
        style: 'flex:1;min-width:320px;',
      }, [
        create('div', {
          style: 'font-size:12px;font-weight:600;color:var(--text-main);margin-bottom:8px;display:flex;align-items:center;gap:6px;',
        }, [
          create('span', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>' }),
          create('span', { text: '实时画面' }),
        ]),
        // 视频预览容器
        create('div', {
          id: 'camera-video-wrap',
          style: 'position:relative;width:100%;aspect-ratio:4/3;background:rgba(0,0,0,0.5);border-radius:12px;border:1px solid rgba(168,85,247,0.25);overflow:hidden;display:flex;align-items:center;justify-content:center;',
        }, [
          create('div', {
            id: 'camera-video-placeholder',
            style: 'text-align:center;color:var(--text-dim);font-size:12px;line-height:1.8;',
            html: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4;margin-bottom:8px;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><br>正在启动摄像头…',
          }),
        ]),
        // 拍摄按钮区
        create('div', {
          style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;',
        }, [
          create('button', {
            id: 'camera-shoot-btn',
            type: 'button',
            class: 'btn btn-primary',
            style: 'background:linear-gradient(135deg,#a855f7,#7c3aed);border-color:rgba(168,85,247,0.4);color:#fff;padding:8px 18px;font-size:13px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;',
            onclick: () => this._capture(),
            html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg> 拍摄',
          }),
          create('button', {
            id: 'camera-retry-btn',
            type: 'button',
            style: 'display:none;padding:8px 14px;font-size:12px;border-radius:8px;cursor:pointer;background:rgba(255,171,64,0.1);border:1px solid rgba(255,171,64,0.3);color:var(--orange);',
            onclick: () => this._retake(),
            text: '重新拍摄',
          }),
        ]),
      ]);

      // 右侧：拍摄结果 + AI 分析
      const rightPanel = create('div', {
        id: 'camera-result-panel',
        style: 'flex:1;min-width:280px;',
      }, [
        create('div', {
          style: 'font-size:12px;font-weight:600;color:var(--text-main);margin-bottom:8px;display:flex;align-items:center;gap:6px;',
        }, [
          create('span', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>' }),
          create('span', { text: '拍摄结果与 AI 分析' }),
        ]),
        create('div', {
          id: 'camera-result-content',
          style: 'min-height:180px;padding:16px;border-radius:12px;background:rgba(0,20,40,0.3);border:1px solid rgba(34,211,238,0.12);display:flex;align-items:center;justify-content:center;text-align:center;color:var(--text-dim);font-size:12px;',
          text: '拍摄后将显示画面与 AI 分析结果',
        }),
      ]);

      wrap.appendChild(leftPanel);
      wrap.appendChild(rightPanel);
      body.appendChild(wrap);
    },

    /** 启动本地摄像头 */
    async _startCamera() {
      const videoWrap = $('camera-video-wrap');
      if (!videoWrap) return;

      // 移除旧 video
      const oldVideo = videoWrap.querySelector('video');
      if (oldVideo) oldVideo.remove();

      // 释放旧流
      this._releaseStream();

      const placeholder = $('camera-video-placeholder');
      if (placeholder) placeholder.style.display = '';

      try {
        if (!global.navigator || !global.navigator.mediaDevices || !global.navigator.mediaDevices.getUserMedia) {
          if (placeholder) {
            placeholder.innerHTML = '<div style="color:var(--orange);"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px;"><circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/></svg><br>当前浏览器不支持摄像头访问<br><span style="font-size:10px;">请使用 Chrome / Edge 浏览器</span></div>';
          }
          return;
        }

        const stream = await global.navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });

        this._stream = stream;

        // 创建 video 元素
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px;';
        video.srcObject = stream;

        if (placeholder) placeholder.style.display = 'none';
        videoWrap.appendChild(video);

        await video.play().catch(() => {});

      } catch (err) {
        const msg = (err && err.name === 'NotAllowedError')
          ? '摄像头权限被拒绝，请在浏览器设置中允许访问摄像头'
          : (err && err.name === 'NotFoundError')
            ? '未检测到摄像头设备，请连接摄像头后重试'
            : ('摄像头启动失败：' + (err && err.message || '未知错误'));

        if (placeholder) {
          placeholder.innerHTML = '<div style="color:var(--red);"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:8px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><br>' + msg + '</div>';
        }
        try { global.UI?.Toast?.warn(msg); } catch (_) {}
      }
    },

    /** 拍摄当前画面 */
    _capture() {
      const videoWrap = $('camera-video-wrap');
      if (!videoWrap) return;
      const video = videoWrap.querySelector('video');
      if (!video || !video.videoWidth) {
        try { global.UI?.Toast?.warn('摄像头尚未就绪，请稍候'); } catch (_) {}
        return;
      }

      // 截图到 canvas
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // 转为 base64（去掉 data:image/jpeg;base64, 前缀）
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64 = dataUrl.split(',')[1];

      this._capturedBase64 = base64;
      this._capturedDataUrl = dataUrl;

      // 显示拍摄结果
      this._showCapturedResult(dataUrl, base64);

      // 显示重拍按钮
      const retryBtn = $('camera-retry-btn');
      if (retryBtn) retryBtn.style.display = '';

      // 自动上传
      this._uploadCapture(base64);
    },

    /** 显示拍摄画面 + 上传 */
    _showCapturedResult(dataUrl, base64) {
      const resultContent = $('camera-result-content');
      if (!resultContent) return;

      const time = new Date().toLocaleString('zh-CN');
      const camName = (this._camera && this._camera.name) || ('摄像头#' + (this._camera && this._camera.id));

      resultContent.innerHTML = '';
      resultContent.style.cssText = 'min-height:180px;padding:12px;border-radius:12px;background:rgba(0,20,40,0.3);border:1px solid rgba(34,211,238,0.12);';

      // 拍摄图片
      const imgWrap = create('div', { style: 'text-align:center;margin-bottom:10px;' }, [
        create('img', {
          src: dataUrl,
          alt: camName + ' 拍摄画面',
          style: 'max-width:100%;max-height:160px;border-radius:8px;border:1px solid rgba(168,85,247,0.2);object-fit:cover;',
        }),
        create('div', { style: 'font-size:10px;color:var(--text-dim);margin-top:4px;', text: '拍摄时间：' + time }),
      ]);
      resultContent.appendChild(imgWrap);

      // AI 分析区域
      const aiArea = create('div', {
        id: 'camera-ai-result',
        style: 'padding:10px;border-radius:8px;background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);',
      }, [
        create('div', {
          style: 'font-size:11px;font-weight:600;color:#c084fc;margin-bottom:6px;display:flex;align-items:center;gap:4px;',
        }, [
          create('span', { html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>' }),
          create('span', { text: 'AI 分析中...' }),
        ]),
        create('div', {
          style: 'display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text-dim);',
          html: '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(168,85,247,0.2);border-top-color:#a855f7;border-radius:50%;animation:spin 0.8s linear infinite;"></span> 正在上传画面并等待 AI 分析...',
        }),
      ]);
      resultContent.appendChild(aiArea);
    },

    /** 上传拍摄画面到后端 */
    async _uploadCapture(base64) {
      const aiResultEl = $('camera-ai-result');
      const camId = this._camera && this._camera.id;

      if (!camId) {
        if (aiResultEl) aiResultEl.innerHTML = '<div style="font-size:11px;color:var(--red);">摄像头 ID 缺失</div>';
        return;
      }

      try {
        const res = await global.DashboardApi.Camera.capture(camId, base64);

        if (aiResultEl) {
          if (res && res.aiResult) {
            aiResultEl.innerHTML = '';
            aiResultEl.appendChild(create('div', {
              style: 'font-size:11px;font-weight:600;color:#c084fc;margin-bottom:6px;display:flex;align-items:center;gap:4px;',
            }, [
              create('span', { html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>' }),
              create('span', { text: 'AI 预测结果' }),
            ]));
            aiResultEl.appendChild(create('div', {
              style: 'font-size:12px;color:var(--text-main);line-height:1.6;white-space:pre-wrap;word-break:break-word;',
              text: res.aiResult,
            }));
            try { global.UI?.Toast?.success('AI 分析完成'); } catch (_) {}
          } else {
            aiResultEl.innerHTML = '<div style="font-size:11px;color:var(--text-dim);">上传成功，后端未返回 AI 分析结果</div>';
          }
        }
      } catch (err) {
        if (aiResultEl) {
          aiResultEl.innerHTML = '<div style="font-size:11px;color:var(--orange);">上传失败：' + (err && err.message || '接口待部署') + '</div>';
        }
        try { global.UI?.Toast?.error('拍照上传失败，后端接口可能未部署'); } catch (_) {}
      }
    },

    /** 重新拍摄 */
    _retake() {
      this._capturedBase64 = null;
      this._capturedDataUrl = null;

      const retryBtn = $('camera-retry-btn');
      if (retryBtn) retryBtn.style.display = 'none';

      const resultContent = $('camera-result-content');
      if (resultContent) {
        resultContent.innerHTML = '拍摄后将显示画面与 AI 分析结果';
        resultContent.style.cssText = 'min-height:180px;padding:16px;border-radius:12px;background:rgba(0,20,40,0.3);border:1px solid rgba(34,211,238,0.12);display:flex;align-items:center;justify-content:center;text-align:center;color:var(--text-dim);font-size:12px;';
      }

      // 重新启动摄像头
      this._startCamera();
    },

    /** 释放摄像头流 */
    _releaseStream() {
      if (this._stream) {
        try {
          this._stream.getTracks().forEach(t => t.stop());
        } catch (_) {}
        this._stream = null;
      }
      const videoWrap = $('camera-video-wrap');
      if (videoWrap) {
        const video = videoWrap.querySelector('video');
        if (video) {
          try { video.srcObject = null; } catch (_) {}
          video.remove();
        }
      }
    },
  };

  global.CameraCaptureComponent = CameraCapture;
})(window);
