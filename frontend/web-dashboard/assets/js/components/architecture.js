/**
 * components/architecture.js - 三层架构健康度状态条
 *   感知层 / 接入层 / 服务层 / AI层
 * 数据源：DashboardApi.Architecture.getLayerStatus
 * 交互：悬浮显示各层详情（状态 / 延迟 / 描述）
 */
(function (global) {
  'use strict';

  const { $, create, render } = global.DomUtil;

  /** 各层图标（SVG） */
  const LAYER_ICONS = {
    perception: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/></svg>',
    access:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
    service:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="20" height="6" rx="2"/><rect x="2" y="15" width="20" height="6" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    ai:         '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0-3 3v1a3 3 0 0 0 0 6v1a3 3 0 0 0 3 3h1a3 3 0 0 0 6 0h1a3 3 0 0 0 3-3v-1a3 3 0 0 0 0-6V9a3 3 0 0 0-3-3H15V5a3 3 0 0 0-3-3z"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/></svg>',
    application:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  };

  const STATUS_DOT = {
    ok:    { cls: 'ok',    color: 'var(--green)'  },
    warn:  { cls: 'warn',  color: 'var(--orange)' },
    error: { cls: 'error', color: 'var(--red)'    },
  };

  const Architecture = {
    _timer: null,

    init() {
      this.render();
      this._timer = setInterval(() => this.render(), 30_000);
    },

    async render() {
      const host = $('arch-bar-host');
      if (!host) return;
      let data;
      try {
        data = await global.DashboardApi.Architecture.getLayerStatus();
      } catch (err) {
        console.warn('[architecture] 拉取失败', err);
      }
      const layers = (data && Array.isArray(data.layers)) ? data.layers : [];
      if (layers.length === 0) {
        // 无真实数据时显示占位（不显示假数据，仅展示层名 + 待接入状态）
        const placeholderLayers = [
          { key: 'perception', name: '感知层', statusText: '待接入', status: 'warn', detail: '等待后端接入…' },
          { key: 'access',     name: '接入层', statusText: '待接入', status: 'warn', detail: '等待后端接入…' },
          { key: 'service',    name: '服务层', statusText: '待接入', status: 'warn', detail: '等待后端接入…' },
          { key: 'ai',         name: 'AI 层',  statusText: '待接入', status: 'warn', detail: '等待后端接入…' },
        ];
        render(host, placeholderLayers.map(l => this._layerNode(l)));
        return;
      }
      render(host, layers.map(l => this._layerNode(l)));
    },

    _layerNode(l) {
      const dot = STATUS_DOT[l.status] || STATUS_DOT.ok;
      const iconHtml = LAYER_ICONS[l.key] || LAYER_ICONS.service;
      const seg = create('div', {
        class: 'arch-seg ' + dot.cls,
      }, [
        create('span', { class: 'arch-icon', html: iconHtml }),
        create('span', { class: 'arch-name' }, l.name || '--'),
        create('span', { class: 'arch-dot ' + dot.cls }),
        create('span', { class: 'arch-status' }, l.statusText || '正常'),
      ]);
      // 悬浮详情
      seg.addEventListener('mouseenter', (e) => {
        const lines = [
          '<strong>' + (l.name || '') + '</strong>',
          l.detail || '',
          l.statusText ? '状态：' + l.statusText : '',
          typeof l.latency === 'number' ? '延迟：' + l.latency + ' ms' : '',
        ].filter(Boolean);
        global.UI.Tooltip.show(e, lines.join('<br>'));
      });
      seg.addEventListener('mouseleave', () => global.UI.Tooltip.hide());
      seg.addEventListener('mousemove', (e) => global.UI.Tooltip.show(e,
        [
          '<strong>' + (l.name || '') + '</strong>',
          l.detail || '',
          l.statusText ? '状态：' + l.statusText : '',
          typeof l.latency === 'number' ? '延迟：' + l.latency + ' ms' : '',
        ].filter(Boolean).join('<br>')
      ));
      return seg;
    },

    destroy() {
      if (this._timer) clearInterval(this._timer);
    },
  };

  global.ArchitectureComponent = Architecture;
})(window);
