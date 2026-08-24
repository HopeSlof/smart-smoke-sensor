/**
 * components/overview.js - 设备总览 + 感知层 6 项传感器
 * 数据源：
 *   DashboardApi.Device.getSummary  → 4张统计卡
 *   DashboardApi.Device.getRealtimeList → 设备列表
 *   DashboardApi.Sensor.getPerception → 感知层 6 项传感器卡片
 */
(function (global) {
  'use strict';

  const { $, create, render } = global.DomUtil;

  const Overview = {
    _perceptionTimer: null,

    init() {
      this.render();
      this._perceptionTimer = setInterval(() => this.renderPerception(), 3000);
      // —— 补绑之前没绑定死按钮：see-all"查看全部→" + 感知层右上角放大 ——
      this._bindDeadButtons();
    },

    /** 兜底：HTML 写了但 JS 0 绑定的按钮，在此处绑定（避免用户点了没反应） */
    _bindDeadButtons() {
      const { $ } = global.DomUtil;
      const UI = global.UI;

      // 1) 设备总览面板 → "查看全部 →" 文本按钮 → 打开设备管理弹窗
      const seeAll = document.querySelector('.see-all');
      if (seeAll) {
        seeAll.style.cursor = 'pointer';
        seeAll.title = '查看全部设备 · 打开设备管理面板';
        seeAll.dataset.bound = '1'; // 标记已绑定，避免 main.js 兜底重复绑定
        seeAll.addEventListener('click', () => {
          const Mgr = global.DeviceMgrComponent;
          if (Mgr && typeof Mgr.openManage === 'function') {
            Mgr.openManage();
          } else if (UI && UI.Toast) {
            UI.Toast.warn('设备管理模块加载中，请稍后再试');
          }
        });
      }

      // 2) 感知层面板 → 右上角"展开查看详情"放大按钮 → 打开感知层详情 Drawer
      const btnExp = $('btn-expand-perception');
      if (btnExp) {
        btnExp.dataset.bound = '1'; // 标记已绑定，避免 main.js 兜底重复绑定
        btnExp.addEventListener('click', () => this._openPerceptionDetail());
      }
    },

    /** 感知层详情 Modal：动态创建节点（复用 settings-modal 的结构），避免 Drawer.open 的 alerts 专用参数不兼容 */
    async _openPerceptionDetail() {
      const UI = global.UI;
      const { create, render } = global.DomUtil;
      if (!UI || !UI.Modal) return;
      const id = 'perception-detail-modal';
      // 先拉数据（避免弹窗空白）
      let list;
      try {
        list = await global.DashboardApi.Sensor.getPerception();
      } catch (err) {
        console.warn('[overview] perception detail 拉取失败', err);
        if (UI && UI.Toast) UI.Toast.error('感知数据拉取失败：' + (err && err.message || '请稍后重试'));
        return;
      }
      if (!list || list.length === 0) list = [];

      // 如果节点还没创建 → 动态建一个（结构与 settings-modal 一致，保持样式统一）
      let root = document.getElementById(id);
      if (!root) {
        const closeSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        root = create('div', {
          id, class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + '-title',
        }, [
          create('div', { class: 'modal-mask', onclick: () => UI.Modal.close(id) }),
          create('div', { class: 'modal-body', role: 'document', style: 'max-width:1000px;' }, [
            create('div', { class: 'modal-header' }, [
              create('div', {}, [
                create('div', { id: id + '-title', class: 'modal-title' }, '🔬 感知层监测 · 详情'),
                create('div', { class: 'modal-sub' }, '放大查看 6 项感知指标与阈值说明 · 首页每 3 秒自动刷新一次'),
              ]),
              create('button', {
                class: 'icon-btn', title: '关闭 (Esc)', 'aria-label': '关闭',
                onclick: () => UI.Modal.close(id), innerHTML: closeSVG,
              }),
            ]),
            create('div', { class: 'modal-content' }, [
              create('div', {
                class: 'perception-note',
                style: 'font-size:11px;color:var(--text-dim);line-height:1.7;padding:8px 10px;border-radius:6px;' +
                       'background:rgba(148,163,184,0.06);border:1px solid rgba(148,163,184,0.12);margin-bottom:12px;'
              }, [
                create('div', {}, '· 标签「待接入」：硬件尚未 MQTT 上线或暂无有效感知读数，显示的是正常室内空气水平基线参考值，不代表真实现场情况。'),
                create('div', {}, '· 烟雾 ≥预警阈值(默认 100) 橙色预警 · ≥火警阈值(默认 200) 红色告警并联动告警汇总面板。'),
                create('div', {}, '· 真实硬件接入后，标签会自动消失，卡片恢复饱和色，数值以实际传感器读数为准。'),
              ]),
              create('div', {
                id: id + '-host',
                style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;',
              }),
            ]),
          ]),
        ]);
        document.body.appendChild(root);
      }
      const host = document.getElementById(id + '-host');
      if (host) render(host, list.map(s => Overview._sensorCard(s)));
      UI.Modal.open(id);
    },

    async render() {
      await Promise.all([
        this.renderSummary(),
        this.renderDevices(),
        this.renderPerception(),
      ]);
    },

    /** ---------- 4张统计卡 ---------- */
    async renderSummary() {
      const host = $('stat-cards-host');
      if (!host) return;
      let data;
      try {
        data = await global.DashboardApi.Device.getSummary();
      } catch (err) {
        console.warn('[overview] summary 拉取失败', err);
      }
      if (!data) {
        host.innerHTML = Overview._emptyHtml('等待设备数据...');
        return;
      }
      const cards = [
        { key: 'total',   label: '设备总数',   value: data.total,   cls: '',           change: data.newToday ? `↑ ${data.newToday} 新增` : '', changeDown: false, unit: '台' },
        { key: 'online',  label: '在线设备',   value: data.online,  cls: 'green',      change: typeof data.onlineRate === 'number' ? `${data.onlineRate}% 在线率` : '', changeDown: false, unit: '台' },
        { key: 'warn',    label: '预警设备',   value: data.warning, cls: 'orange',     change: '待处置', changeDown: true, unit: '台' },
        { key: 'offline', label: '离线/故障',  value: data.offline, cls: 'red',        change: typeof data.diffYesterday === 'number'
          ? (data.diffYesterday >= 0 ? `↑ ${data.diffYesterday} 较昨日` : `↓ ${-data.diffYesterday} 较昨日`)
          : '', changeDown: true, unit: '台' },
      ];
      // 每 2 个卡片包成一个 .stat-row (2列 grid)
      const rows = [];
      for (let i = 0; i < cards.length; i += 2) {
        rows.push(create('div', { class: 'stat-row' }, [
          Overview._card(cards[i]),
          cards[i + 1] ? Overview._card(cards[i + 1]) : null,
        ]));
      }
      render(host, rows);
    },

    _card(c) {
      const value = (typeof c.value === 'number') ? c.value.toLocaleString() : '--';
      const children = [];
      children.push(create('div', { class: 'stat-label' }, c.label));
      const valDiv = create('div', { class: 'stat-value' });
      valDiv.appendChild(document.createTextNode(value));
      if (c.unit) valDiv.appendChild(create('span', { class: 'stat-unit' }, c.unit));
      children.push(valDiv);
      if (c.change) {
        children.push(create('div', { class: 'stat-change' + (c.changeDown ? ' down' : '') }, c.change));
      }
      return create('div', { class: 'stat-card' + (c.cls ? ' ' + c.cls : '') }, children);
    },

    /** ---------- 设备列表 ---------- */
    async renderDevices() {
      const host = $('device-list-host');
      if (!host) return;
      let list;
      try {
        list = await global.DashboardApi.Device.getRealtimeList(6);
      } catch (err) {
        console.warn('[overview] devices 拉取失败', err);
      }
      if (!list || list.length === 0) {
        host.innerHTML = Overview._emptyHtml('暂无设备状态数据');
        return;
      }
      render(host, list.map(d => Overview._deviceItem(d)));
    },

    _deviceItem(d) {
      const statusCls = d.status === 'danger' ? 'danger' : d.status === 'warning' ? 'warn' : '';
      const statusText = d.status === 'danger' ? '火警' : d.status === 'warning' ? '预警' : d.status === 'offline' ? '离线' : '正常';
      const statusValCls = d.status === 'danger' ? 'danger' : d.status === 'warning' ? 'warn' : d.status === 'offline' ? '' : 'ok';
      const iconSVG = Overview._iconFor(d.status);
      const dev = create('div', {
        class: 'device-item' + (statusCls ? ' ' + statusCls : ''),
        style: { cursor: 'pointer' },
        title: '点击查看设备趋势与详情',
        onclick: (e) => {
          e.stopPropagation();
          // 优先打开趋势分析弹窗（bug6要求）；shift+点击则保留原 PopCard 快速信息
          if (e && e.shiftKey) {
            Overview._showDevicePop(e, d, statusText, statusValCls);
          } else if (global.TrendModal && typeof global.TrendModal.open === 'function') {
            try {
              global.TrendModal.open({ deviceId: d.id, deviceName: d.name, location: d.location, model: d.model });
            } catch (err) {
              console.error('[overview] TrendModal.open 失败：', err);
              Overview._showDevicePop(e, d, statusText, statusValCls);
            }
          } else {
            Overview._showDevicePop(e, d, statusText, statusValCls);
          }
        },
      }, [
        create('div', { class: 'device-info' }, [
          create('div', { class: 'device-icon', html: iconSVG }),
          create('div', {}, [
            create('div', { class: 'device-name', title: d.name, html: d.name + ' <span style="float:right;color:var(--text-dim);font-size:10px;">›</span>' }),
            create('div', { class: 'device-loc' }, d.location || ''),
          ]),
        ]),
        create('div', { class: 'device-status' + (statusCls ? ' ' + statusCls : '') }, statusText),
      ]);
      return dev;
    },

    /** 设备详情弹层 */
    _showDevicePop(e, d, statusText, statusValCls) {
      const UI = global.UI;
      const content = `
        <h4>${d.name}
          <span class="device-status ${d.status === 'danger' ? 'danger' : d.status === 'warning' ? 'warn' : ''}" style="font-size:11px;padding:2px 8px;">${statusText}</span>
        </h4>
        <div class="pop-stats">
          <div class="pop-stat ok"><div class="pop-stat-num">${typeof d.concentration === 'number' ? d.concentration.toFixed(1) : '--'}</div><div class="pop-stat-label">烟雾 μg/m³</div></div>
          <div class="pop-stat"><div class="pop-stat-num">${typeof d.temp === 'number' ? d.temp.toFixed(1) : '--'}</div><div class="pop-stat-label">温度 ℃</div></div>
          <div class="pop-stat"><div class="pop-stat-num">${typeof d.battery === 'number' ? d.battery : '--'}%</div><div class="pop-stat-label">电量</div></div>
        </div>
        <div class="info-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="info-pair"><div class="info-pair-label">设备 ID</div><div class="info-pair-value highlight">${d.id || '--'}</div></div>
          <div class="info-pair"><div class="info-pair-label">设备型号</div><div class="info-pair-value">${d.model || 'SD-200X'}</div></div>
          <div class="info-pair"><div class="info-pair-label">安装位置</div><div class="info-pair-value">${d.location || '--'}</div></div>
          <div class="info-pair"><div class="info-pair-label">信号强度</div><div class="info-pair-value ${(d.rssi && d.rssi < -80) ? 'warn' : 'ok'}">${d.rssi ? d.rssi + ' dBm' : '--'}</div></div>
          <div class="info-pair full"><div class="info-pair-label">最近心跳</div><div class="info-pair-value">${d.lastHeartbeat || '5 秒前'}</div></div>
          <div class="info-pair full"><div class="info-pair-label">建议</div><div class="info-pair-value warn">${
            d.status === 'danger' ? '请立即到现场核实是否有火情' :
            d.status === 'warning' ? '请尽快安排巡检确认设备状态' :
            d.status === 'offline' ? '请检查设备供电与通信链路' :
            '运行良好，按计划周期巡检即可'
          }</div></div>
        </div>
      `;
      UI.PopCard.open({ x: e.clientX, y: e.clientY }, content);
    },

    _iconFor(status) {
      switch (status) {
        case 'danger':
          return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v6M12 22v-6M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M22 12h-6M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24"/></svg>';
        case 'warning':
          return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
        case 'offline':
          return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        default:
          return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      }
    },

    /** ---------- 感知层 6 项传感器卡片 ---------- */
    async renderPerception() {
      const host = $('perception-host');
      if (!host) return;
      let list;
      try {
        list = await global.DashboardApi.Sensor.getPerception();
      } catch (err) {
        console.warn('[overview] perception 拉取失败', err);
      }
      if (!list || list.length === 0) {
        host.innerHTML = Overview._emptyHtml('等待感知层设备数据...');
        return;
      }
      render(host, list.map(s => Overview._sensorCard(s)));
    },

    /** 单个感知设备卡片 */
    _sensorCard(s) {
      const statusCls = s.status === 'warn' ? 'warn' : s.status === 'danger' ? 'danger' : 'ok';
      const provi = !!s.provisional;
      const cls = 'sensor-card ' + statusCls + (provi ? ' provisional' : '');
      const head = create('div', { class: 'sensor-head' }, [
        create('div', {
          class: 'sensor-icon ' + s.icon,
          html: Overview._sensorIcon(s.icon, provi ? 'ok' : statusCls),
        }),
        create('div', { class: 'sensor-name', title: s.name }, [
          document.createTextNode(s.name),
          s.badge ? create('span', {
            class: 'sensor-badge ' + (provi ? 'provi' : ''),
            title: provi ? '硬件未接入，当前显示正常水平基线参考值' : s.badge,
          }, s.badge) : null,
        ]),
        create('div', { class: 'sensor-status ' + statusCls }, [
          create('span', { class: 'dot' }),
          document.createTextNode(s.statusText || '--'),
        ]),
      ]);
      const body = create('div', { class: 'sensor-body' });
      if (s.id === 'flame') {
        body.appendChild(create('div', { class: 'sensor-value small' }, [
          create('span', { class: 'label' }, '监测方式：'),
          create('span', {}, s.mode || '红外监测'),
        ]));
        body.appendChild(create('div', { class: 'sensor-threshold' }, '阈值：' + (s.thresholdLabel || '检测到立即告警')));
      } else if (s.id === 'dev') {
        const bat = typeof s.battery === 'number' ? s.battery : 0;
        const sig = typeof s.signal === 'number' ? s.signal : 0;
        const batteryBox = create('div', { class: 'metric-row' }, [
          create('span', { class: 'm-label' }, '电量'),
          create('div', { class: 'battery' }, [
            create('div', { class: 'bat-fill', style: { width: bat + '%' } }),
            create('div', { class: 'bat-cap' }),
          ]),
          create('span', { class: 'm-num' + (provi ? ' dim' : '') },
            bat + '%' + (provi && bat === 0 ? '（离线不可测）' : '')),
        ]);
        const signalBox = create('div', { class: 'metric-row' }, [
          create('span', { class: 'm-label' }, '信号'),
          create('div', { class: 'signal-bars' },
            [1, 2, 3, 4].map(i => create('div', { class: 'bar' + (i <= sig ? ' on' : '') }))
          ),
          create('span', { class: 'm-num' + (provi ? ' dim' : '') },
            sig <= 1 ? '弱' : sig <= 2 ? '一般' : sig <= 3 ? '良好' : '极强'),
        ]);
        body.appendChild(batteryBox);
        body.appendChild(signalBox);
      } else {
        const value = (typeof s.value === 'number' ? s.value : '--');
        body.appendChild(create('div', { class: 'sensor-value' }, [
          create('span', { class: 'num' + (provi ? ' dim' : '') },
            typeof value === 'number' ? (Math.round(value * 100) / 100).toFixed(value >= 10 || Math.floor(value) === value ? 0 : 2) : value),
          s.unit ? create('span', { class: 'unit' }, s.unit) : null,
        ]));
        body.appendChild(create('div', { class: 'sensor-threshold' }, '报警阈值：' + (s.thresholdLabel || '--')));
      }
      return create('div', { class: cls }, [head, body]);
    },

    /** 感知层 6 类图标 SVG 模板 */
    _sensorIcon(icon, statusCls) {
      const stroke = statusCls === 'danger' ? '#ef4444' : statusCls === 'warn' ? '#f59e0b' : '#22d3ee';
      switch (icon) {
        case 'smoke':
          return `<svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="24" cy="30" r="8" fill="rgba(34,211,238,0.08)"/>
            <path d="M15 21c0-3 2-5 5-5s5 2 5 5"/>
            <path d="M28 19c0-4 3-7 7-7s7 3 7 7"/>
            <path d="M20 13c0-2 1.5-4 4-4s4 2 4 4"/>
            <line x1="24" y1="38" x2="24" y2="44"/>
          </svg>`;
        case 'temp':
          return `<svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 30V14a6 6 0 1 1 12 0v16a8 8 0 1 1-12 0z" fill="rgba(249,115,22,0.08)"/>
            <circle cx="24" cy="32" r="3" fill="#f97316"/>
            <line x1="24" y1="14" x2="24" y2="29"/>
          </svg>`;
        case 'co':
          return `<svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <text x="24" y="30" text-anchor="middle" font-size="18" font-weight="700" fill="${stroke}" stroke="none">CO</text>
            <circle cx="24" cy="24" r="16" fill="rgba(34,211,238,0.06)"/>
            <circle cx="24" cy="24" r="19" fill="none"/>
          </svg>`;
        case 'flame':
          return `<svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M24 6c3 6 9 9 9 16a9 9 0 0 1-18 0c0-4 3-6 6-8-1 3 1 5 1 5-2-2 2-7 2-13z" fill="rgba(239,68,68,0.1)"/>
            <path d="M24 20c1 2 3 3 3 6a3 3 0 1 1-6 0c0-1.5 1-3 3-6z" fill="rgba(251,146,60,0.2)"/>
          </svg>`;
        case 'hum':
          return `<svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M24 6c5 7 13 13 13 22a13 13 0 0 1-26 0c0-9 8-15 13-22z" fill="rgba(56,189,248,0.1)"/>
            <path d="M17 28c2 3 6 3 7 0 1-3-3-4-7 0z" fill="rgba(56,189,248,0.3)"/>
          </svg>`;
        case 'battery':
          return `<svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="16" width="30" height="18" rx="3" fill="rgba(34,197,94,0.08)"/>
            <rect x="12" y="19" width="21" height="12" rx="1" fill="#22c55e"/>
            <rect x="39" y="21" width="3" height="8" rx="1" fill="currentColor"/>
            <line x1="14" y1="38" x2="34" y2="38"/>
            <line x1="18" y1="42" x2="30" y2="42"/>
          </svg>`;
        default:
          return '';
      }
    },

    _emptyHtml(text) {
      return `<div class="empty-placeholder">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r="0.8" fill="currentColor"/></svg>
        <span>${text}</span></div>`;
    },

    destroy() {
      if (this._perceptionTimer) clearInterval(this._perceptionTimer);
    },
  };

  global.OverviewComponent = Overview;
})(window);
