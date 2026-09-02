/**
 * components/review.js - AI 视觉复核记录列表 + 复核详情弹窗
 * ------------------------------------------------------------
 * 数据源：DashboardApi.Review.getReviewList
 * 交互：
 *   - 列表点击 → 打开复核详情 Modal（摄像头画面 + AI 结果 + 置信度）
 *   - 复核弹窗操作按钮 → 联动告警确认（确认火情 / 标记误报）
 *   - 检出明火/烟雾且关联告警 → 提供「确认火情·下发广播」「标记误报」闭环按钮
 *
 * 设计依据：设计文档 §3.1 告警与视觉复核闭环（步骤 6-8）
 *           US-08 告警联动摄像头 AI 复核（P0）
 */
(function (global) {
  'use strict';

  const { $, create, render } = global.DomUtil;

  /** 检测结果配置：文案 / 配色 / 图标 */
  const RESULT_CFG = {
    fire:   { text: '检测到明火', cls: 'danger', color: '#ef4444',
              icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>' },
    smoke:  { text: '检测到烟雾', cls: 'warn', color: '#f59e0b',
              icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h12a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h10"/></svg>' },
    normal: { text: '未发现异常', cls: 'ok', color: '#22c55e',
              icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' },
  };

  const Review = {
    _timer: null,

    init() {
      this.render();
      this._ensureModal();
      this._timer = setInterval(() => this.render(), 30_000);
    },

    async render() {
      await this.renderList();
    },

    /** ---------- 复核记录列表 ---------- */
    async renderList() {
      const host = $('review-host');
      if (!host) return;
      let list = [];
      try {
        list = await global.DashboardApi.Review.getReviewList(8);
      } catch (err) {
        console.warn('[review] 列表拉取失败', err);
      }
      if (!Array.isArray(list) || list.length === 0) {
        host.innerHTML = this._emptyHtml();
        this._renderStats([]);
        return;
      }
      this._renderStats(list);
      render(host, list.map((r, i) => this._reviewItem(r, i)));
    },

    _emptyHtml() {
      return `<div class="empty-placeholder" style="min-height:150px;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
        </svg>
        <span>暂无 AI 复核记录</span>
        <span style="font-size:11px;opacity:.6;">告警触发后将自动调用摄像头复核</span>
      </div>`;
    },

    /** 复核统计（今日复核 / 明火 / 烟雾 / 正常） */
    _renderStats(list) {
      const host = $('review-stats-host');
      if (!host) return;
      const fire = list.filter(r => r.result === 'fire').length;
      const smoke = list.filter(r => r.result === 'smoke').length;
      const normal = list.filter(r => r.result === 'normal').length;
      const cfg = [
        { label: '复核总数', value: list.length, cls: '' },
        { label: '明火', value: fire, cls: 'danger' },
        { label: '烟雾', value: smoke, cls: 'warn' },
        { label: '正常', value: normal, cls: 'ok' },
      ];
      render(host, cfg.map(c => create('div', { class: 'review-stat ' + (c.cls || '') }, [
        create('div', { class: 'review-stat-num' }, String(c.value)),
        create('div', { class: 'review-stat-label' }, c.label),
      ])));
    },

    _reviewItem(r, i) {
      const cfg = RESULT_CFG[r.result] || RESULT_CFG.normal;
      const conf = r.confidence != null ? Math.round(r.confidence * 100) : null;
      return create('div', {
        class: 'review-item ' + cfg.cls,
        style: { animationDelay: (i * 0.04) + 's' },
        title: '点击查看复核详情',
        onclick: (e) => { e.stopPropagation(); Review.openDetail(r); },
      }, [
        create('div', { class: 'review-thumb', style: { color: cfg.color }, html: cfg.icon }),
        create('div', { class: 'review-info' }, [
          create('div', { class: 'review-result' }, [
            create('span', { class: 'review-result-tag ' + cfg.cls, style: { color: cfg.color } }, cfg.text),
            conf != null ? create('span', { class: 'review-conf' }, '置信度 ' + conf + '%') : null,
          ]),
          create('div', { class: 'review-meta' },
            (r.deviceId || r.device || '--') + ' · ' + (r.area || '--')),
        ]),
        create('div', { class: 'review-time' }, r.time || '--'),
      ]);
    },

    /** ============================================
     *   复核详情 Modal（动态创建）
     * ============================================ */
    _ensureModal() {
      if ($('review-modal')) return;
      const modal = create('div', { id: 'review-modal', class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
        create('span', { class: 'm-corner-tr' }),
        create('span', { class: 'm-corner-bl' }),
        create('div', { class: 'modal-header' }, [
          create('div', { class: 'modal-title-wrap' }, [
            create('span', { class: 'modal-title-bar', style: '--c:#a855f7;' }),
            create('div', {}, [
              create('div', { class: 'modal-title' }, 'AI 视觉复核详情'),
              create('div', { class: 'modal-subtitle' }, 'SmartJavaAI · 明火 / 烟雾形态检测'),
            ]),
          ]),
          create('div', { class: 'modal-actions' }, [
            create('button', { class: 'icon-btn', title: '关闭 (Esc)',
              onclick: () => global.UI.Modal.close('review-modal'),
              html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' }),
          ]),
        ]),
        create('div', { id: 'review-modal-body', class: 'modal-body' }),
        create('div', { id: 'review-modal-footer', class: 'modal-footer' }),
      ]);
      document.body.appendChild(modal);
    },

    openDetail(r) {
      this._ensureModal();
      const cfg = RESULT_CFG[r.result] || RESULT_CFG.normal;
      const conf = r.confidence != null ? Math.round(r.confidence * 100) : null;
      const body = $('review-modal-body');
      body.innerHTML = '';

      body.appendChild(
        create('div', { class: 'review-detail' }, [
          // 摄像头画面区
          create('div', { class: 'review-frame' }, [
            create('div', { class: 'review-frame-inner', style: { color: cfg.color }, html: cfg.icon }),
            create('div', { class: 'review-frame-overlay' }, [
              create('span', { class: 'cam-dot' }),
              create('span', {}, r.frameUrl ? '摄像头实时画面' : '画面待接入'),
            ]),
          ]),
          // AI 检测结果
          create('div', { class: 'review-result-block' }, [
            create('div', { class: 'section-title' }, 'AI 检测结果'),
            create('div', { class: 'review-big-result ' + cfg.cls, style: { color: cfg.color } }, [
              create('span', { html: cfg.icon }),
              create('span', {}, cfg.text),
            ]),
            conf != null ? create('div', { class: 'review-conf-bar' }, [
              create('div', { class: 'review-conf-label' }, '置信度 ' + conf + '%'),
              create('div', { class: 'conf-bar' }, [
                create('div', { class: 'conf-bar-fill ' + cfg.cls, style: { width: conf + '%' } }),
              ]),
            ]) : null,
          ]),
          // 关联信息
          create('div', { class: 'section-title', style: 'margin-top:16px;' }, '关联信息'),
          create('div', { class: 'info-grid' }, [
            this._kv('关联告警', r.alertId || '--', 'highlight'),
            this._kv('检测设备', r.deviceId || r.device || '--'),
            this._kv('所在区域', r.area || '--'),
            this._kv('复核时间', r.time || '--'),
            this._kv('复核状态', r.status === 'pending' ? '复核中…' : '已完成',
              r.status === 'pending' ? 'warn' : 'ok'),
          ]),
        ])
      );

      // 操作按钮（footer）—— 检出明火/烟雾 且关联告警 → 提供闭环按钮
      const footer = $('review-modal-footer');
      footer.innerHTML = '';
      if (r.alertId && r.result !== 'normal' && r.status !== 'pending') {
        footer.appendChild(create('button', {
          class: 'btn btn-danger',
          onclick: () => Review._onConfirmFire(r),
        }, '确认火情 · 下发广播'));
        footer.appendChild(create('button', {
          class: 'btn btn-warn',
          onclick: () => Review._onMarkFalse(r),
        }, '标记误报'));
      }
      footer.appendChild(create('button', {
        class: 'btn btn-ghost',
        onclick: () => global.UI.Modal.close('review-modal'),
      }, '关闭'));

      global.UI.Modal.open('review-modal');
    },

    _kv(label, value, cls) {
      return create('div', { class: 'info-pair' }, [
        create('div', { class: 'info-pair-label' }, label),
        create('div', { class: 'info-pair-value ' + (cls || '') },
          typeof value !== 'undefined' ? String(value) : '--'),
      ]);
    },

    /** 确认火情 → 联动下发广播（告警状态 pending → confirmed） */
    async _onConfirmFire(r) {
      const UI = global.UI;
      try {
        await global.DashboardApi.AlertAction.confirmFire(r.alertId, { remark: 'AI 复核确认火情' });
        UI.Toast.success('已确认火情，广播指令已下发');
        UI.Modal.close('review-modal');
        this.render();
        if (global.AlertsComponent && global.AlertsComponent.render) global.AlertsComponent.render();
      } catch (e) {
        UI.Toast.error('确认失败：' + (e && e.message || '未知错误'));
      }
    },

    /** 标记误报（告警状态 pending → false_alarm） */
    async _onMarkFalse(r) {
      const UI = global.UI;
      try {
        await global.DashboardApi.AlertAction.markFalseAlarm(r.alertId, { remark: 'AI 复核判定误报' });
        UI.Toast.success('已标记为误报');
        UI.Modal.close('review-modal');
        this.render();
        if (global.AlertsComponent && global.AlertsComponent.render) global.AlertsComponent.render();
      } catch (e) {
        UI.Toast.error('操作失败：' + (e && e.message || '未知错误'));
      }
    },

    destroy() {
      if (this._timer) clearInterval(this._timer);
    },
  };

  global.ReviewComponent = Review;
})(window);
