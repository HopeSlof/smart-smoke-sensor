/**
 * components/map.js - 区域 / 楼栋分布概览
 * 数据源：DashboardApi.Area.getBuildingList
 * 交互：
 *   - 点击楼栋弹出 PopCard 详情
 */
(function (global) {
  'use strict';

  const { $, create, render } = global.DomUtil;

  const MapPanel = {
    init() {
      this.render();
    },

    async render() {
      const host = $('building-grid-host');
      if (!host) return;
      let list;
      try {
        list = await global.DashboardApi.Area.getBuildingList();
      } catch (err) {
        console.warn('[map] buildings 拉取失败', err);
      }
      if (!list || list.length === 0) {
        host.innerHTML = MapPanel._emptyHtml('等待区域数据...');
        return;
      }
      render(host, list.map(b => MapPanel._building(b)));
    },

    _building(b) {
      const statusCls = b.status === 'danger' ? 'danger' : b.status === 'warning' ? 'warn' : '';
      return create('div', {
        class: 'building' + (statusCls ? ' ' + statusCls : ''),
        dataset: { id: b.id },
        style: { cursor: 'pointer' },
        title: '点击查看楼栋详情',
        onclick: (e) => {
          e.stopPropagation();
          MapPanel._showBuildingPop(e, b);
        },
      }, [
        create('span', { class: 'building-status' }),
        create('div', { class: 'building-name' }, b.name),
        create('div', { class: 'building-count' },
          typeof b.deviceCount === 'number' ? String(b.deviceCount) : '--'),
        create('div', { class: 'building-sub' }, (b.subInfo || '') + ' ›'),
      ]);
    },

    _showBuildingPop(e, b) {
      const UI = global.UI;
      const ok  = typeof b.okCount  === 'number' ? b.okCount  : Math.max(0, (b.deviceCount || 0) - ((b.warnCount || 0) + (b.badCount || 0)));
      const wa  = typeof b.warnCount === 'number' ? b.warnCount : 1;
      const bd  = typeof b.badCount  === 'number' ? b.badCount  : (b.status === 'danger' ? 1 : 0);
      const statusText =
        b.status === 'danger' ? '有火情告警' :
        b.status === 'warning' ? '设备预警' : '正常运行';
      const content = `
        <h4>
          ${b.name || '楼栋'}
          <span style="font-size:11px;padding:2px 8px;border-radius:3px;${
            b.status === 'danger' ? 'background:rgba(255,61,113,0.15);color:var(--red);border:1px solid rgba(255,61,113,0.4);' :
            b.status === 'warning' ? 'background:rgba(255,171,64,0.15);color:var(--orange);border:1px solid rgba(255,171,64,0.4);' :
            'background:rgba(0,255,157,0.1);color:var(--green);border:1px solid rgba(0,255,157,0.4);'
          }">${statusText}</span>
        </h4>
        <div class="pop-stats">
          <div class="pop-stat ok"><div class="pop-stat-num">${ok}</div><div class="pop-stat-label">正常设备</div></div>
          <div class="pop-stat wa"><div class="pop-stat-num">${wa}</div><div class="pop-stat-label">预警设备</div></div>
          <div class="pop-stat bd"><div class="pop-stat-num">${bd}</div><div class="pop-stat-label">告警/离线</div></div>
        </div>
        <div class="info-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="info-pair"><div class="info-pair-label">楼栋编号</div><div class="info-pair-value highlight">${b.id || '--'}</div></div>
          <div class="info-pair"><div class="info-pair-label">总设备数</div><div class="info-pair-value">${b.deviceCount || 0} 台</div></div>
          <div class="info-pair"><div class="info-pair-label">所在楼层</div><div class="info-pair-value">${b.floors || '--'} 层</div></div>
          <div class="info-pair"><div class="info-pair-label">面积</div><div class="info-pair-value">${b.areaSize || '--'} m²</div></div>
          <div class="info-pair full"><div class="info-pair-label">负责人 / 电话</div><div class="info-pair-value">${b.manager || '王经理'} · ${b.phone || '138-0000-0000'}</div></div>
          <div class="info-pair full"><div class="info-pair-label">最近巡检</div><div class="info-pair-value ok">${b.lastCheck || '今日 09:35 · 已完成'}</div></div>
          <div class="info-pair full"><div class="info-pair-label">处置建议</div><div class="info-pair-value ${
            b.status === 'danger' ? 'danger' : b.status === 'warning' ? 'warn' : 'ok'
          }">${
            b.status === 'danger' ? '立即前往现场核实火情，同步联络消防站' :
            b.status === 'warning' ? '1 小时内派巡检人员到现场确认设备状态' :
            '状态良好，可按原计划进行每周一次例行巡检'
          }</div></div>
        </div>
      `;
      UI.PopCard.open({ x: e.clientX, y: e.clientY }, content);
    },

    _emptyHtml(text) {
      return `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#7a96b8;font-size:13px;opacity:0.7;">${text}</div>`;
    },
  };

  global.MapComponent = MapPanel;
})(window);
