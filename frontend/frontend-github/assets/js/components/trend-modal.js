/**
 * components/trend-modal.js - 传感器趋势表查看弹窗（居民/管理员/消防员共用）
 * 调用：
 *   TrendModal.open({ deviceId, deviceName, location, model })
 *
 * 展示内容：
 *   - 设备基本信息（型号、位置、在线状态、最新读数）
 *   - 双 Y 轴三线 SVG 趋势图（烟雾 / CO / 温度）
 *   - 时间范围切换（1h / 6h / 12h / 24h）
 *   - 3 张子指标卡（均值、峰值、最低）+ 超限次数
 */
(function (global) {
  'use strict';

  const { create, createSVG } = global.DomUtil;

  const METRICS_THRESHOLDS = {
    smoke: [
      { value: 100, label: '预警 100', color: '#ffab40', dash: '6 4' },
      { value: 200, label: '火警 200', color: '#ff5252', dash: '4 3' },
    ],
    co: [
      { value: 100, label: '告警 100', color: '#ff5252', dash: '6 4' },
    ],
    temperature: [
      { value: 55,  label: '告警 55',  color: '#ff5252', dash: '6 4' },
    ],
  };

  const VB_W = 720;
  const VB_H = 280;
  const PAD_LEFT = 44, PAD_RIGHT = 44, PAD_TOP = 24, PAD_BOTTOM = 36;
  const LEFT_MAX = 240, LEFT_STEP = 40;
  const TEMP_MAX = 70, TEMP_STEP = 10;

  function niceMax(maxVal, step) {
    return Math.ceil((maxVal * 1.15) / step) * step;
  }

  function num(v, def) {
    if (v === null || v === undefined || v === '') return def;
    const n = Number(v);
    return isNaN(n) ? def : n;
  }

  function _latestDeviceReading(deviceId) {
    return (global.DashboardApi && global.DashboardApi.Device
      ? global.DashboardApi.Device.getList({ pageSize: 200 })
          .then(p => ((p && p.records) || []).find(d => String(d.id) === String(deviceId)))
          .catch(() => null)
      : Promise.resolve(null));
  }

  const TrendModal = {
    _mounted: false,

    async open({ deviceId, deviceName, location, model }) {
      if (!deviceId) return global.UI?.Toast?.warning('缺少设备 ID');
      if (!this._mounted) this._injectStyles();
      this._mounted = true;

      const name = deviceName || ('设备 #' + String(deviceId));
      const UI = global.UI;

      // 先打开占位 modal
      const mask = this._buildMask(`趋势分析 · ${name}`);
      document.body.appendChild(mask);
      const viewport = mask.querySelector('#tm-viewport');
      if (viewport) viewport.innerHTML = `<div style="padding:40px;color:var(--text-dim);text-align:center;">加载中…</div>`;

      try {
        const [reading, trendRaw] = await Promise.all([
          _latestDeviceReading(deviceId),
          this._fetchTrend(deviceId, '24h'),
        ]);
        const data = trendRaw;
        this._renderViewport(mask, {
          deviceId, deviceName: name, location, model,
          reading, data, range: '24h',
        });
      } catch (err) {
        console.error('[trend-modal] 加载失败：', err);
        if (viewport) viewport.innerHTML = `<div style="padding:30px;color:#fca5a5;text-align:center;">加载失败：${err && err.message ? err.message : '未知错误'}</div>`;
      }
    },

    _injectStyles() {
      const s = document.createElement('style');
      s.textContent = `
        .tm-mask{position:fixed;inset:0;z-index:10002;background:rgba(3,8,20,.76);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:20px;}
        .tm-box{width:920px;max-width:100%;max-height:88vh;background:linear-gradient(160deg,#0b1626,#0d1b30);border:1px solid rgba(34,211,238,.28);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden;}
        .tm-head{padding:16px 22px;border-bottom:1px solid rgba(148,163,184,.15);display:flex;align-items:center;justify-content:space-between;}
        .tm-title{font-size:16px;font-weight:700;color:var(--text-main);letter-spacing:1px;}
        .tm-close{background:transparent;border:none;color:var(--text-dim);font-size:22px;cursor:pointer;line-height:1;padding:2px 6px;}
        .tm-close:hover{color:var(--cyan);}
        .tm-body{padding:16px 22px;overflow-y:auto;}
        .tm-info-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 14px;margin-bottom:14px;}
        .tm-info-item{padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(148,163,184,.14);}
        .tm-info-label{font-size:11px;color:var(--text-dim);margin-bottom:3px;}
        .tm-info-value{font-size:13px;color:var(--text-main);font-weight:500;}
        .tm-info-value.highlight{color:var(--cyan);font-family:var(--font-num);}
        .tm-info-value.warn{color:#fbbf24;}
        .tm-info-value.ok{color:#4ade80;}
        .tm-metric-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0;}
        .tm-metric-card{padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(148,163,184,.14);}
        .tm-metric-title{font-size:12px;color:var(--text-dim);margin-bottom:6px;display:flex;align-items:center;gap:6px;}
        .tm-metric-title .dot{width:8px;height:8px;border-radius:50%;display:inline-block;}
        .tm-metric-vals{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 10px;font-size:12px;}
        .tm-metric-vals .k{color:var(--text-dim);}
        .tm-metric-vals .v{color:var(--text-main);font-family:var(--font-num);}
        .tm-bar{height:6px;border-radius:4px;background:rgba(148,163,184,.12);margin-top:6px;overflow:hidden;position:relative;}
        .tm-bar > i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,#22c55e 0%,#22c55e 58%,#f59e0b 58%,#f59e0b 80%,#ef4444 80%);}
        .tm-bar-warn{position:absolute;top:-1px;bottom:-1px;left:50%;width:1px;background:rgba(255,255,255,.5);}
        .tm-range-tabs{display:inline-flex;gap:4px;background:rgba(255,255,255,.04);border:1px solid rgba(148,163,184,.15);border-radius:8px;padding:3px;}
        .tm-range-tabs .tab{padding:4px 10px;font-size:12px;border-radius:6px;color:var(--text-dim);cursor:pointer;user-select:none;}
        .tm-range-tabs .tab.active{background:rgba(34,211,238,.15);color:var(--cyan);}
        .tm-toolbar{display:flex;align-items:center;justify-content:space-between;margin:4px 0 10px;flex-wrap:wrap;gap:8px;}
        .tm-chart-wrap{position:relative;border-radius:12px;background:rgba(255,255,255,.02);border:1px solid rgba(148,163,184,.12);padding:6px;}
        .tm-chart-wrap svg{width:100%;height:auto;display:block;}
        .tm-legend{display:flex;gap:14px;justify-content:center;margin:6px 0 2px;font-size:12px;color:var(--text-dim);flex-wrap:wrap;}
        .tm-legend .item{display:flex;align-items:center;gap:6px;}
        .tm-legend .sw{width:18px;height:3px;border-radius:2px;}
        .tm-tooltip{position:absolute;pointer-events:none;z-index:10003;min-width:160px;padding:8px 10px;border-radius:8px;background:rgba(11,22,38,.96);border:1px solid rgba(34,211,238,.35);color:var(--text-main);font-size:12px;line-height:1.6;box-shadow:0 8px 24px rgba(0,0,0,.5);display:none;}
        .tm-tooltip b{color:var(--cyan);font-weight:600;}
        .tm-tooltip .row{display:flex;justify-content:space-between;gap:14px;}
      `;
      document.head.appendChild(s);
    },

    _buildMask(title) {
      const mask = document.createElement('div');
      mask.className = 'tm-mask';
      mask.innerHTML = `
        <div class="tm-box" role="dialog" aria-modal="true">
          <div class="tm-head">
            <div class="tm-title">${title}</div>
            <button class="tm-close" aria-label="关闭">×</button>
          </div>
          <div class="tm-body" id="tm-viewport"></div>
        </div>`;
      const close = () => { if (mask.parentNode) mask.parentNode.removeChild(mask); document.removeEventListener('keydown', onKey); };
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
      mask.querySelector('.tm-close').addEventListener('click', close);
      return mask;
    },

    async _fetchTrend(deviceId, range) {
      try {
        if (!global.DashboardApi || !global.DashboardApi.Sensor) throw new Error('Sensor API 未就绪');
        const d = await global.DashboardApi.Sensor.getTrend(deviceId, range);
        if (d && Array.isArray(d.xLabels) && d.xLabels.length > 0) return d;
      } catch (e) { /* fallthrough */ }
      // 无真实趋势数据时返回空结构，由界面显示明确的空状态，不伪造读数。
      return {
        xLabels: [],
        smoke: [],
        co: [],
        temperature: [],
      };
    },

    _renderViewport(mask, ctx) {
      const { deviceId, deviceName, location, model, reading, data, range } = ctx;
      const UI = global.UI;
      const viewport = mask.querySelector('#tm-viewport');
      if (!viewport) return;

      const r = reading || {};
      const { num: numUtil } = (global.DashboardApi && global.DashboardApi._util) || { num };
      const smokeVal = numUtil(r.lastSmokeValue, null);
      const tempVal  = numUtil(r.lastTemperatureValue, null);
      const coVal    = numUtil(r.lastCoValue, null);
      const batVal   = numUtil(r.batteryLevel, null);
      const rssiVal  = numUtil(r.signalStrength, null);
      const online = String(r.onlineStatus || '').toUpperCase() === 'ONLINE';
      const statusText = online ? '在线' : '离线';
      const statusCls  = online ? 'ok' : 'warn';

      // 指标卡统计
      const stats = this._aggStats(data);

      viewport.innerHTML = '';
      const grid = create('div', { class: 'tm-info-grid' });
      grid.innerHTML = `
        <div class="tm-info-item"><div class="tm-info-label">设备 ID</div><div class="tm-info-value highlight">${deviceId}</div></div>
        <div class="tm-info-item"><div class="tm-info-label">设备名称</div><div class="tm-info-value">${deviceName || '--'}</div></div>
        <div class="tm-info-item"><div class="tm-info-label">安装位置</div><div class="tm-info-value">${location || '--'}</div></div>
        <div class="tm-info-item"><div class="tm-info-label">在线状态</div><div class="tm-info-value ${statusCls}">${statusText}</div></div>
        <div class="tm-info-item"><div class="tm-info-label">型号</div><div class="tm-info-value">${model || r.deviceModel || '--'}</div></div>
        <div class="tm-info-item"><div class="tm-info-label">最新烟雾</div><div class="tm-info-value highlight">${smokeVal != null ? (smokeVal.toFixed(1) + ' μg/m³') : '--'}</div></div>
        <div class="tm-info-item"><div class="tm-info-label">最新温度</div><div class="tm-info-value highlight">${tempVal != null ? (tempVal.toFixed(1) + ' ℃') : '--'}</div></div>
        <div class="tm-info-item"><div class="tm-info-label">最新 CO</div><div class="tm-info-value highlight">${coVal != null ? (coVal.toFixed(1) + ' ppm') : '--'}</div></div>
      `;
      viewport.appendChild(grid);

      // 指标卡
      const metricRow = create('div', { class: 'tm-metric-row' });
      const cfg = [
        { key: 'smoke', name: '烟雾浓度', color: '#22d3ee', unit: 'μg/m³', threshold: 200, warn: 100, data: stats.smoke },
        { key: 'co',    name: 'CO 浓度', color: '#ef4444', unit: 'ppm',    threshold: 100, warn: 60,  data: stats.co    },
        { key: 'temperature', name: '环境温度', color: '#f59e0b', unit: '℃', threshold: 55, warn: 45, data: stats.temp  },
      ];
      metricRow.innerHTML = cfg.map(c => {
        const d = c.data || {};
        const avg = typeof d.avg === 'number' ? d.avg.toFixed(1) : '--';
        const max = typeof d.max === 'number' ? d.max.toFixed(1) : '--';
        const min = typeof d.min === 'number' ? d.min.toFixed(1) : '--';
        const exceed = typeof d.exceed === 'number' ? d.exceed : null;
        const pct = c.threshold ? Math.min(100, (num(d.max,0) / c.threshold) * 100) : 0;
        return `
          <div class="tm-metric-card">
            <div class="tm-metric-title"><span class="dot" style="background:${c.color};"></span>${c.name}</div>
            <div class="tm-metric-vals">
              <div class="k">平均</div><div class="v">${avg} ${c.unit}</div>
              <div class="k">峰值</div><div class="v">${max} ${c.unit}</div>
              <div class="k">最低</div><div class="v">${min} ${c.unit}</div>
              <div class="k">超限</div><div class="v" style="${exceed ? 'color:#f87171;' : ''}">${exceed == null ? '--' : exceed + ' 次'}</div>
            </div>
            <div class="tm-bar"><i style="width:${pct}%;"></i>
              ${c.warn ? `<div class="tm-bar-warn" style="left:${(c.warn/c.threshold)*100}%;"></div>` : ''}
            </div>
          </div>`;
      }).join('');
      viewport.appendChild(metricRow);

      // 工具条
      const toolbar = create('div', { class: 'tm-toolbar' });
      const tabs = create('div', { class: 'tm-range-tabs', id: 'tm-range-tabs' },
        ['1h', '6h', '12h', '24h'].map(k => create('div', {
          class: 'tab' + (k === range ? ' active' : ''),
          'data-range': k,
        }, k)));
      tabs.addEventListener('click', async (e) => {
        const t = e.target.closest('.tab');
        if (!t) return;
        const nr = t.getAttribute('data-range');
        if (!nr || nr === this._range) return;
        tabs.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
        const loadingHost = mask.querySelector('#tm-chart-host');
        if (loadingHost) loadingHost.innerHTML = `<div style="padding:30px;color:var(--text-dim);text-align:center;">加载 ${nr} 趋势中…</div>`;
        const newRaw = await this._fetchTrend(deviceId, nr);
        const newData = newRaw;
        const newStats = this._aggStats(newData);
        // 更新指标卡
        mask.querySelectorAll('.tm-metric-card').forEach((card, idx) => {
          const c = cfg[idx];
          if (!c) return;
          const d = (newStats[c.key === 'temperature' ? 'temp' : c.key]) || {};
          const avg = typeof d.avg === 'number' ? d.avg.toFixed(1) : '--';
          const max = typeof d.max === 'number' ? d.max.toFixed(1) : '--';
          const min = typeof d.min === 'number' ? d.min.toFixed(1) : '--';
          const exceed = typeof d.exceed === 'number' ? d.exceed : null;
          const pct = c.threshold ? Math.min(100, (num(d.max,0) / c.threshold) * 100) : 0;
          card.querySelector('.tm-metric-vals').innerHTML = `
            <div class="k">平均</div><div class="v">${avg} ${c.unit}</div>
            <div class="k">峰值</div><div class="v">${max} ${c.unit}</div>
            <div class="k">最低</div><div class="v">${min} ${c.unit}</div>
            <div class="k">超限</div><div class="v" style="${exceed ? 'color:#f87171;' : ''}">${exceed == null ? '--' : exceed + ' 次'}</div>`;
          const bar = card.querySelector('.tm-bar > i');
          if (bar) bar.style.width = pct + '%';
        });
        // 重画图
        const chartHost = mask.querySelector('#tm-chart-host');
        if (chartHost) chartHost.innerHTML = '';
        this._drawChart(chartHost, newData);
      });
      const leftToolbar = create('div', {});
      leftToolbar.innerHTML = `<span style="font-size:12px;color:var(--text-dim);">时间范围：</span>`;
      leftToolbar.appendChild(tabs);
      const rightToolbar = create('div', { style: 'font-size:11px;color:var(--text-dim);' });
      rightToolbar.innerHTML = `时间点：<b style="color:var(--text-main);">${((data && data.xLabels) || []).length}</b>`;
      toolbar.appendChild(leftToolbar);
      toolbar.appendChild(rightToolbar);
      viewport.appendChild(toolbar);

      // 图例 + SVG 趋势容器
      const chartWrap = create('div', { class: 'tm-chart-wrap', id: 'tm-chart-host' });
      const legend = create('div', { class: 'tm-legend' });
      legend.innerHTML = `
        <div class="item"><span class="sw" style="background:#22d3ee;"></span>烟雾浓度 (μg/m³)</div>
        <div class="item"><span class="sw" style="background:#ef4444;"></span>CO 浓度 (ppm)</div>
        <div class="item"><span class="sw" style="background:#f59e0b;"></span>环境温度 (℃)</div>
        <div class="item"><span class="sw" style="background:#ffab40;border-top:1px dashed #ffab40;"></span>预警阈值</div>
        <div class="item"><span class="sw" style="background:#ff5252;border-top:1px dashed #ff5252;"></span>火警 / 告警阈值</div>`;
      viewport.appendChild(legend);
      viewport.appendChild(chartWrap);
      this._drawChart(chartWrap, data);
    },

    _aggStats(data) {
      const calc = (arr, threshold) => {
        if (!Array.isArray(arr) || !arr.length) return { avg: null, max: null, min: null, exceed: null };
        let sum = 0, max = -Infinity, min = Infinity, cnt = 0, exc = 0;
        arr.forEach(v => {
          if (v === null || v === undefined || Number.isNaN(Number(v))) return;
          const n = Number(v);
          sum += n; cnt++;
          if (n > max) max = n;
          if (n < min) min = n;
          if (threshold && n >= threshold) exc++;
        });
        return {
          avg: cnt ? sum / cnt : null,
          max: max === -Infinity ? null : max,
          min: min ===  Infinity ? null : min,
          exceed: exc,
        };
      };
      return {
        smoke: calc(data.smoke, 200),
        co:    calc(data.co, 100),
        temp:  calc(data.temperature, 55),
      };
    },

    _drawChart(host, data) {
      if (!host) return;
      const xLabels = data.xLabels || [];
      const n = xLabels.length;
      if (!n) {
        host.innerHTML = `<div style="padding:30px;color:var(--text-dim);text-align:center;">暂无趋势数据</div>`;
        return;
      }
      const smoke = (data.smoke || []).map(v => num(v, null));
      const co    = (data.co    || []).map(v => num(v, null));
      const temp  = (data.temperature || []).map(v => num(v, null));

      const svg = createSVG('svg', { viewBox: `0 0 ${VB_W} ${VB_H}`, preserveAspectRatio: 'none', width: '100%', height: '280' });

      // 安全区底色（低于最低阈值）
      const safeMax = 100;
      const safeY = PAD_TOP + (1 - safeMax / LEFT_MAX) * (VB_H - PAD_TOP - PAD_BOTTOM);
      svg.appendChild(createSVG('rect', {
        x: PAD_LEFT, y: safeY,
        width: VB_W - PAD_LEFT - PAD_RIGHT,
        height: (VB_H - PAD_TOP - PAD_BOTTOM) - (safeY - PAD_TOP),
        fill: 'rgba(76,175,80,0.05)',
      }));

      // 网格 + 左 Y 轴刻度
      for (let v = 0; v <= LEFT_MAX; v += LEFT_STEP) {
        const y = PAD_TOP + (1 - v / LEFT_MAX) * (VB_H - PAD_TOP - PAD_BOTTOM);
        svg.appendChild(createSVG('line', {
          x1: PAD_LEFT, y1: y, x2: VB_W - PAD_RIGHT, y2: y,
          stroke: 'rgba(148,163,184,0.1)', 'stroke-dasharray': '3 3',
        }));
        svg.appendChild(createSVG('text', {
          x: PAD_LEFT - 6, y: y + 3, 'text-anchor': 'end',
          fill: 'rgba(148,163,184,0.6)', 'font-size': 10,
        }, String(v)));
      }
      // 右 Y 轴（温度）
      for (let v = 0; v <= TEMP_MAX; v += TEMP_STEP) {
        const y = PAD_TOP + (1 - v / TEMP_MAX) * (VB_H - PAD_TOP - PAD_BOTTOM);
        svg.appendChild(createSVG('text', {
          x: VB_W - PAD_RIGHT + 6, y: y + 3, 'text-anchor': 'start',
          fill: 'rgba(245,158,11,0.7)', 'font-size': 10,
        }, String(v)));
      }

      // 阈值线
      const drawThr = (metric) => {
        const yMax = (metric === 'temperature') ? TEMP_MAX : LEFT_MAX;
        (METRICS_THRESHOLDS[metric] || []).forEach(t => {
          if (t.value > yMax) return;
          const y = PAD_TOP + (1 - t.value / yMax) * (VB_H - PAD_TOP - PAD_BOTTOM);
          svg.appendChild(createSVG('line', {
            x1: PAD_LEFT, y1: y, x2: VB_W - PAD_RIGHT, y2: y,
            stroke: t.color, 'stroke-dasharray': t.dash, 'stroke-width': 1.2, 'opacity': 0.85,
          }));
          svg.appendChild(createSVG('text', {
            x: VB_W - PAD_RIGHT - 4, y: y - 3, 'text-anchor': 'end',
            fill: t.color, 'font-size': 9,
          }, t.label));
        });
      };
      drawThr('smoke'); drawThr('co'); drawThr('temperature');

      // X 轴标签（稀疏化）
      const sparseN = Math.min(6, n);
      for (let i = 0; i < sparseN; i++) {
        const idx = Math.max(0, Math.min(n - 1, Math.floor(i * (n - 1) / Math.max(1, sparseN - 1))));
        const x = PAD_LEFT + (idx / Math.max(1, n - 1)) * (VB_W - PAD_LEFT - PAD_RIGHT);
        svg.appendChild(createSVG('text', {
          x, y: VB_H - 14, 'text-anchor': 'middle',
          fill: 'rgba(148,163,184,0.6)', 'font-size': 10,
        }, xLabels[idx] || ''));
      }

      // 绘制单条曲线 + 面积填充
      const drawLine = (values, yMax, color, fill, key) => {
        const pts = [];
        for (let i = 0; i < n; i++) {
          if (values[i] === null || values[i] === undefined || Number.isNaN(values[i])) continue;
          const x = PAD_LEFT + (i / Math.max(1, n - 1)) * (VB_W - PAD_LEFT - PAD_RIGHT);
          const v = Math.min(yMax, Math.max(0, values[i]));
          const y = PAD_TOP + (1 - v / yMax) * (VB_H - PAD_TOP - PAD_BOTTOM);
          pts.push([x, y, i]);
        }
        if (pts.length < 2) return;
        const areaPath = `M ${pts[0][0]},${VB_H - PAD_BOTTOM} ` +
          pts.map(p => `L ${p[0]},${p[1]}`).join(' ') +
          ` L ${pts[pts.length - 1][0]},${VB_H - PAD_BOTTOM} Z`;
        const linePath = `M ${pts.map(p => `${p[0]},${p[1]}`).join(' L ')}`;
        svg.appendChild(createSVG('path', {
          d: areaPath, fill, opacity: 0.18,
        }));
        svg.appendChild(createSVG('path', {
          d: linePath, fill: 'none', stroke: color, 'stroke-width': 2,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        }));
        // 峰值点
        let peakIdx = -1, peakVal = -Infinity;
        pts.forEach(p => {
          const v = values[p[2]];
          if (typeof v === 'number' && v > peakVal) { peakVal = v; peakIdx = p[2]; }
        });
        if (peakIdx >= 0) {
          const px = PAD_LEFT + (peakIdx / Math.max(1, n - 1)) * (VB_W - PAD_LEFT - PAD_RIGHT);
          const pv = Math.min(yMax, Math.max(0, peakVal));
          const py = PAD_TOP + (1 - pv / yMax) * (VB_H - PAD_TOP - PAD_BOTTOM);
          svg.appendChild(createSVG('circle', {
            cx: px, cy: py, r: 4, fill: color, stroke: '#fff', 'stroke-width': 1.2,
          }));
          svg.appendChild(createSVG('text', {
            x: px, y: py - 8, 'text-anchor': 'middle',
            fill: color, 'font-size': 10, 'font-weight': 700,
          }, peakVal.toFixed(1)));
        }
      };
      drawLine(smoke, LEFT_MAX, '#22d3ee', 'rgba(34,211,238,0.25)', 'smoke');
      drawLine(co,    LEFT_MAX, '#ef4444', 'rgba(239,68,68,0.25)',  'co');
      drawLine(temp,  TEMP_MAX, '#f59e0b', 'rgba(245,158,11,0.25)', 'temp');

      // Hover 覆盖层
      const overlay = createSVG('rect', {
        x: PAD_LEFT, y: PAD_TOP,
        width: VB_W - PAD_LEFT - PAD_RIGHT, height: VB_H - PAD_TOP - PAD_BOTTOM,
        fill: 'transparent', style: 'cursor:crosshair;',
      });
      const tooltip = document.createElement('div');
      tooltip.className = 'tm-tooltip';
      host._tmTooltip = tooltip;
      host.appendChild(svg);
      host.appendChild(tooltip);
      const findClosest = (clientX) => {
        const rect = svg.getBoundingClientRect();
        const relX = (clientX - rect.left) / rect.width * VB_W;
        if (relX < PAD_LEFT || relX > VB_W - PAD_RIGHT) return -1;
        const ratio = (relX - PAD_LEFT) / (VB_W - PAD_LEFT - PAD_RIGHT);
        return Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
      };
      const statusFor = (val, warn, alarm) => {
        if (val === null || val === undefined) return { t: '—', c: '' };
        if (alarm && val >= alarm) return { t: '🔥 火警/告警', c: '#f87171' };
        if (warn  && val >= warn)  return { t: '⚠ 预警',     c: '#fbbf24' };
        return { t: '✓ 安全', c: '#4ade80' };
      };
      overlay.addEventListener('mousemove', (e) => {
        const i = findClosest(e.clientX);
        if (i < 0) { tooltip.style.display = 'none'; return; }
        const sv = num(smoke[i], null);
        const cv = num(co[i],    null);
        const tv = num(temp[i],  null);
        const sS = statusFor(sv, 100, 200);
        const cS = statusFor(cv, 60,  100);
        const tS = statusFor(tv, 45,  55);
        tooltip.style.display = 'block';
        tooltip.innerHTML = `
          <div style="margin-bottom:4px;"><b>${xLabels[i] || ''}</b></div>
          <div class="row"><span>💨 烟雾 <span style="color:${sS.c};">${sS.t}</span></span><b>${sv != null ? sv.toFixed(1) + ' μg/m³' : '—'}</b></div>
          <div class="row"><span>☠️ CO <span style="color:${cS.c};">${cS.t}</span></span><b>${cv != null ? cv.toFixed(1) + ' ppm' : '—'}</b></div>
          <div class="row"><span>🌡️ 温度 <span style="color:${tS.c};">${tS.t}</span></span><b>${tv != null ? tv.toFixed(1) + ' ℃' : '—'}</b></div>
        `;
        const hostRect = host.getBoundingClientRect();
        let tx = e.clientX - hostRect.left + 14;
        let ty = e.clientY - hostRect.top - 10;
        if (tx + tooltip.offsetWidth > hostRect.width - 6) tx = e.clientX - hostRect.left - tooltip.offsetWidth - 14;
        if (ty < 4) ty = 4;
        tooltip.style.left = tx + 'px';
        tooltip.style.top  = ty + 'px';
      });
      overlay.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
      svg.appendChild(overlay);
    },
  };

  global.TrendModal = TrendModal;
})(window);
