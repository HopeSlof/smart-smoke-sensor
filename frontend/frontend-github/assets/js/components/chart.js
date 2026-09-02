/**
 * components/chart.js - 实时浓度趋势图（SVG，双 y 轴三线）+ 顶部快速指标
 * 数据源：
 *   DashboardApi.Sensor.getQuickMetrics            → 4 指标卡
 *   DashboardApi.Sensor.getTrend(deviceId, range)  → SVG 三条曲线（烟雾/温度/CO）
 *
 * 交互增强：
 *   - 监测设备下拉：切换设备重新画图（系统管理员可选所有，小区管理员默认本小区设备）
 *   - 时间范围 Tabs：1h / 6h / 12h / 24h（对应后端 startTime 参数）
 *   - 图例点击显隐对应曲线（烟雾 / CO / 温度 / 阈值）
 *   - 鼠标悬停 SVG 显示 tooltip（按 x 最近点展示多指标数值）
 *   - 双 y 轴：左轴 烟雾/CO（0~100 μg/m³ / ppm），右轴 温度（0~50 ℃）
 */
(function (global) {
  'use strict';

  const { $, create, createSVG, render } = global.DomUtil;

  /* SVG viewBox 固定尺寸，实际自适应容器 */
  const VB_W = 800;
  const VB_H = 320;
  const PAD_LEFT = 44;
  const PAD_RIGHT = 44;
  const PAD_TOP = 20;
  const PAD_BOTTOM = 36;

  /* ===== 各指标阈值配置（与后端告警阈值一致）===== */
  const METRICS_THRESHOLDS = {
    smoke: [
      { value: 100, label: '预警 100',  color: '#ffab40', dash: '6 4' },
      { value: 200, label: '火警 200',  color: '#ff5252', dash: '4 3' },
    ],
    co: [
      { value: 100, label: '告警 100',  color: '#ff5252', dash: '6 4' },
    ],
    temperature: [
      { value: 55,  label: '告警 55',   color: '#ff5252', dash: '6 4' },
    ],
  };

  /* Y 轴最大值：按各指标最高阈值 ×1.15 向上取整到友好刻度 */
  const SMOKE_MAX = niceMax(200, 40);   // 240 —— 烟雾含火警 200，刻度 0~240 step=40
  const TEMP_MAX  = niceMax(55, 10);    // 70  —— 温度告警 55，刻度 0~70 step=10
  /* 左轴 = 烟雾+CO 共用，取 max(烟雾最高阈值, CO最高阈值) */
  const LEFT_MAX  = niceMax(Math.max(200, 100), 40); // 240
  /* 左轴刻度步进 */
  const LEFT_STEP  = 40;   // 0, 40, 80, 120, 160, 200, 240
  const TEMP_STEP  = 10;   // 0, 10, 20, 30, 40, 50, 60, 70

  function niceMax(maxVal, step) {
    return Math.ceil((maxVal * 1.15) / step) * step;
  }

  const Chart = {
    _metricTimer: null,
    _trendTimer: null,
    /** 显隐状态 */
    _visible: { smoke: true, co: true, temp: true, threshold: true },
    /** 当前时间范围 (1h/6h/12h/24h) */
    _range: '24h',
    /** 缓存最近一次趋势数据 */
    _lastTrend: null,
    /** 当前选中设备 ID */
    _deviceId: null,

    init() {
      this._renderRangeTabs();
      this._bindLegend();
      this._bindDevicePicker();
      this._bindExpandButton();
      this._metricTimer = setInterval(() => this.renderMetrics(), 4000);
      this._trendTimer  = setInterval(() => this.renderTrend(), 15_000);
      // 先加载设备下拉，选默认设备后画第一帧
      this._loadDevicePicker().then(() => this.render());
    },

    async render() {
      // 先画趋势（设置 _lastTrend），再用趋势数据算指标卡
      await this.renderTrend();
      await this.renderMetrics();
    },

    /* ---------- 4 个快速指标 ---------- */
    /* 后端无全局聚合接口 → 从最近一次趋势数据本地计算均值/峰值/超限次数 */
    async renderMetrics() {
      const host = $('quick-metrics-host');
      if (!host) return;

      const trend = this._lastTrend;
      const smoke = (trend && trend.smoke) || [];

      // 从趋势数据本地聚合
      const avg  = smoke.length ? (smoke.reduce((s, v) => s + (v || 0), 0) / smoke.length) : null;
      const peak = smoke.length ? Math.max(...smoke.map(v => v || 0)) : null;
      // 烟雾预警阈值 100（取 METRICS_THRESHOLDS 第一个阈值）
      const warnThr = (METRICS_THRESHOLDS.smoke && METRICS_THRESHOLDS.smoke[0] && METRICS_THRESHOLDS.smoke[0].value) || 100;
      const fireThr = (METRICS_THRESHOLDS.smoke && METRICS_THRESHOLDS.smoke[1] && METRICS_THRESHOLDS.smoke[1].value) || 200;
      const exceed = smoke.filter(v => typeof v === 'number' && v >= warnThr).length;

      // 浓度进度条：值 / 火警阈值（200），预警阈值 100 在 50% 处标记
      const ratioBar = (val) => {
        if (val == null) return null;
        const pct = Math.min(100, (val / fireThr) * 100);
        const warnPct = (warnThr / fireThr) * 100; // 预警线位置 50%
        const barColor = val >= warnThr ? '#ff5252' : val >= warnThr * 0.6 ? '#ffab40' : '#4caf50';
        return create('div', { class: 'metric-bar' }, [
          create('div', { class: 'metric-bar-fill', style: `width:${pct}%;background:${barColor};box-shadow:0 0 6px ${barColor};` }),
          create('div', { class: 'metric-bar-warn', style: `left:${warnPct}%;` }),
        ]);
      };

      const items = [
        { cls: 'green',  value: avg  != null ? avg.toFixed(1)  : '--', label: '平均浓度 μg/m³', bar: ratioBar(avg) },
        { cls: 'warn',   value: peak != null ? peak.toFixed(1) : '--', label: '峰值 μg/m³',    bar: ratioBar(peak) },
        { cls: exceed > 0 ? 'danger' : '', value: smoke.length ? String(exceed) : '--', label: '超限次数', bar: null },
        { cls: '',       value: '--',                                  label: '监测区域',       bar: null },
      ];
      render(host, items.map(it => {
        const v = (it.value === '' || it.value == null) ? '--' : it.value;
        const children = [
          create('div', { class: 'metric-value' }, v),
          create('div', { class: 'metric-label' }, it.label),
        ];
        if (it.bar) children.push(it.bar);
        return create('div', { class: 'metric-item' + (it.cls ? ' ' + it.cls : '') }, children);
      }));
    },

    /* ============================================
     *   时间范围 Tabs（注入到 #chart-range-tabs）
     * ============================================ */
    _renderRangeTabs() {
      const tabs = $('chart-range-tabs');
      if (!tabs) return;
      tabs.innerHTML = '';
      const ranges = [
        { r: '24h', label: '24 小时' },
        { r: '12h', label: '12 小时' },
        { r: '6h',  label: '6 小时' },
        { r: '1h',  label: '1 小时' },
      ];
      ranges.forEach(it => {
        tabs.appendChild(create('div', {
          class: 'tab' + (it.r === this._range ? ' is-active' : ''),
          'data-r': it.r,
        }, it.label));
      });
      tabs.addEventListener('click', (e) => {
        const t = e.target.closest('.tab');
        if (!t) return;
        tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('is-active'));
        t.classList.add('is-active');
        this._range = t.dataset.r;
        this.renderTrend();
      });
    },

    /* ============================================
     *   监测设备下拉
     * ============================================ */
    _bindDevicePicker() {
      const sel = $('dm-chart-device');
      if (!sel) return;
      sel.addEventListener('change', () => {
        this._deviceId = sel.value || null;
        this.renderTrend();
      });
    },

    async _loadDevicePicker() {
      const sel = $('dm-chart-device');
      if (!sel) return;
      let page;
      try {
        page = await global.DashboardApi.Device.getList({ page: 1, pageSize: 200 });
      } catch (e) {
        console.warn('[chart] load device list failed', e);
        page = null;
      }
      const records = (page && page.records) || [];
      sel.innerHTML = '';
      if (records.length === 0) {
        sel.appendChild(create('option', { value: '' }, '暂无可选设备'));
        this._deviceId = null;
        return;
      }
      records.forEach(d => {
        const name = d.deviceName || d.deviceSn || ('设备#' + d.id);
        const loc  = d.location || '未填位置';
        sel.appendChild(create('option', { value: String(d.id) }, `${name} · ${loc}`));
      });
      // 默认选第一个
      this._deviceId = String(records[0].id);
      sel.value = this._deviceId;
    },

    /* ============================================
     *   放大 · 分指标独立大图
     * ============================================ */
    _bindExpandButton() {
      const btn = $('btn-chart-expand');
      if (!btn) return;
      btn.addEventListener('click', () => this._openExpandModal());
    },

    _openExpandModal() {
      const trend = this._lastTrend;
      if (!trend || !trend.xLabels || trend.xLabels.length === 0) {
        if (global.UI && global.UI.Toast) global.UI.Toast.warn('暂无趋势数据可放大');
        return;
      }

      // 设备名
      const sel = $('dm-chart-device');
      const devText = sel ? (sel.options[sel.selectedIndex] || {}).text : '设备';
      const rangeLabel = { '1h': '1小时', '6h': '6小时', '12h': '12小时', '24h': '24小时' }[this._range] || this._range;

      // 创建或复用弹窗
      let modal = $('chart-expand-modal');
      if (!modal) {
        modal = create('div', { id: 'chart-expand-modal', class: 'chart-expand-modal' });
        document.body.appendChild(modal);
      }
      modal.innerHTML = '';

      // 头部
      const header = create('div', { class: 'chart-expand-header' });
      const title = create('div', { class: 'ce-title' });
      title.appendChild(create('h3', {}, devText));
      title.appendChild(create('span', { class: 'ce-badge' }, rangeLabel));
      header.appendChild(title);
      const closeBtn = create('button', { class: 'ce-close', title: '关闭 (Esc)', 'aria-label': '关闭趋势详情', type: 'button' });
      closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      header.appendChild(closeBtn);
      modal.appendChild(header);

      // 内容区
      const body = create('div', { class: 'chart-expand-body' });

      // 三个子图配置（key 与趋势数据字段名对齐：smoke / co / temperature）
      // Y 轴 max 按各指标最高阈值 ×1.15 取友好刻度；thresholds 来自 METRICS_THRESHOLDS
      const metrics = [
        { key: 'smoke', label: '烟雾浓度', unit: 'μg/m³', color: '#00e5ff', gradId: 'ce-grad-smoke',
          max: niceMax(200, 40), step: 40, thresholds: METRICS_THRESHOLDS.smoke },
        { key: 'co',    label: 'CO 浓度',  unit: 'ppm',    color: '#b388ff', gradId: 'ce-grad-co',
          max: niceMax(100, 20), step: 20, thresholds: METRICS_THRESHOLDS.co },
        { key: 'temperature', label: '环境温度', unit: '℃', color: '#ff7043', gradId: 'ce-grad-temp',
          max: niceMax(55, 10), step: 10, thresholds: METRICS_THRESHOLDS.temperature, dashed: true },
      ];

      metrics.forEach(m => {
        const values = trend[m.key] || [];
        if (!values.length) return;

        const sub = create('div', { class: 'ce-sub-chart' });
        const head = create('div', { class: 'ce-sub-head' });
        const stitle = create('div', { class: 'ce-sub-title' });
        stitle.appendChild(create('span', { class: 'ce-sub-dot', style: `background:${m.color};box-shadow:0 0 8px ${m.color};` }));
        stitle.appendChild(create('span', {}, `${m.label} (${m.unit})`));
        head.appendChild(stitle);

        // 子图统计
        const valid = values.filter(v => typeof v === 'number');
        const avg = valid.length ? (valid.reduce((s, v) => s + v, 0) / valid.length) : 0;
        const peak = valid.length ? Math.max(...valid) : 0;
        const min = valid.length ? Math.min(...valid) : 0;
        const stats = create('div', { class: 'ce-sub-stats' });
        stats.innerHTML = `均值<strong>${avg.toFixed(1)}</strong>峰值<strong>${peak.toFixed(1)}</strong>最低<strong>${min.toFixed(1)}</strong>`;
        head.appendChild(stats);
        sub.appendChild(head);

        const host = create('div', { class: 'ce-sub-host' });
        sub.appendChild(host);
        body.appendChild(sub);

        // 绘制单指标大图
        const svg = Chart._buildSingleMetricSvg(trend, m);
        host.appendChild(svg);
        Chart._bindSubHoverTooltip(svg, host, trend, m);
      });

      modal.appendChild(body);

      // 显示
      requestAnimationFrame(() => modal.classList.add('is-open'));
      document.body.style.overflow = 'hidden';

      // 关闭事件
      const closeModal = () => this._closeExpandModal();
      closeBtn.addEventListener('click', closeModal);
      const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
      document.addEventListener('keydown', escHandler);
      modal._escHandler = escHandler;
      modal._closeBtn = closeBtn;
    },

    _closeExpandModal() {
      const modal = $('chart-expand-modal');
      if (!modal) return;
      modal.classList.remove('is-open');
      if (modal._escHandler) {
        document.removeEventListener('keydown', modal._escHandler);
        modal._escHandler = null;
      }
      document.body.style.overflow = '';
      // 延迟清空内容释放 DOM
      setTimeout(() => { if (modal && !modal.classList.contains('is-open')) modal.innerHTML = ''; }, 300);
    },

    /** 构建单指标大图 SVG —— 独立 y 轴，更大尺寸，更清晰 */
    _buildSingleMetricSvg(trend, m) {
      const W = 900, H = 200;
      const PL = 50, PR = 30, PT = 16, PB = 30;
      const values = trend[m.key] || [];
      const xStep = (W - PL - PR) / Math.max(1, values.length - 1);
      const yRange = H - PT - PB;
      const xAt = i => PL + xStep * i;
      const yAt = v => H - PB - (v / m.max) * yRange;

      const svg = createSVG('svg', {
        class: 'chart-svg', viewBox: `0 0 ${W} ${H}`,
        preserveAspectRatio: 'none', style: 'cursor:crosshair;width:100%;height:100%;',
      });

      // defs
      const defs = createSVG('defs');
      defs.innerHTML = `
        <linearGradient id="${m.gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${m.color}" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="${m.color}" stop-opacity="0"/>
        </linearGradient>
        <filter id="ce-glow-${m.key}"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
      svg.appendChild(defs);

      // 安全区底色：低于最低阈值的区域加淡绿色底
      const lowestTh = (m.thresholds || []).reduce((min, th) => Math.min(min, th.value), Infinity);
      if (lowestTh !== Infinity) {
        const sy = yAt(lowestTh);
        svg.appendChild(createSVG('rect', {
          x: PL, y: sy, width: W - PL - PR, height: H - PB - sy,
          fill: 'rgba(76, 175, 80, 0.05)', 'data-layer': 'safe-zone',
        }));
      }

      // 网格横线 + y 轴刻度（按 m.step）
      for (let v = 0; v <= m.max; v += m.step) {
        const y = yAt(v);
        svg.appendChild(createSVG('line', {
          x1: PL, y1: y, x2: W - PR, y2: y,
          stroke: 'rgba(0,200,255,0.06)', 'stroke-width': 1,
        }));
        const t = createSVG('text', {
          x: PL - 8, y: y + 4, fill: '#7a96b8', 'font-size': 10,
          'font-family': 'Orbitron, monospace', 'text-anchor': 'end',
        });
        t.textContent = String(Math.round(v));
        svg.appendChild(t);
      }
      // y 轴标题
      const yTitle = createSVG('text', {
        x: 10, y: PT + 4, fill: m.color, 'font-size': 10, 'text-anchor': 'middle',
      });
      yTitle.textContent = m.unit;
      svg.appendChild(yTitle);

      // 网格竖线 + x 轴标签（稀疏化）
      const stepLbl = Math.ceil(values.length / 10);
      trend.xLabels.forEach((lbl, i) => {
        if (i % stepLbl !== 0 && i !== values.length - 1) return;
        svg.appendChild(createSVG('line', {
          x1: xAt(i), y1: PT, x2: xAt(i), y2: H - PB,
          stroke: 'rgba(0,200,255,0.06)', 'stroke-width': 1,
        }));
        const t = createSVG('text', {
          x: xAt(i), y: H - PB + 20, fill: '#7a96b8', 'font-size': 10,
          'font-family': 'Orbitron, monospace', 'text-anchor': 'middle',
        });
        t.textContent = lbl;
        svg.appendChild(t);
      });

      // 阈值线（每个指标的所有阈值）
      (m.thresholds || []).forEach(th => {
        const y = yAt(th.value);
        svg.appendChild(createSVG('line', {
          x1: PL, y1: y, x2: W - PR, y2: y,
          stroke: th.color, 'stroke-width': 1.5, 'stroke-dasharray': th.dash, opacity: 0.7,
        }));
        const tl = createSVG('text', {
          x: W - PR - 5, y: y - 6, fill: th.color, 'font-size': 10, 'text-anchor': 'end',
          'font-family': 'Noto Sans SC, sans-serif',
        });
        tl.textContent = th.label;
        svg.appendChild(tl);
      });

      // 面积 + 曲线
      const xs = values.map((_, i) => xAt(i));
      const ys = values.map(v => yAt(typeof v === 'number' ? v : 0));
      const pts = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
      const dLine = 'M' + pts.split(' ').join(' L');
      const dArea = `${dLine} L${xs[xs.length - 1]},${H - PB} L${xs[0]},${H - PB} Z`;

      svg.appendChild(createSVG('path', { d: dArea, fill: `url(#${m.gradId})` }));
      svg.appendChild(createSVG('path', {
        d: dLine, fill: 'none', stroke: m.color, 'stroke-width': 2.5,
        filter: `url(#ce-glow-${m.key})`, opacity: 1,
        'stroke-dasharray': m.dashed ? '5 3' : 'none',
      }));

      // 峰值点
      let peakIdx = 0, peakVal = -Infinity;
      values.forEach((v, i) => { if (typeof v === 'number' && v > peakVal) { peakVal = v; peakIdx = i; } });
      svg.appendChild(createSVG('circle', {
        cx: xAt(peakIdx), cy: yAt(peakVal), r: 5,
        fill: m.color, filter: `url(#ce-glow-${m.key})`,
      }));

      // hover 指示线 + 点
      svg.appendChild(createSVG('line', {
        id: `ce-hover-line-${m.key}`,
        x1: PL, y1: PT, x2: PL, y2: H - PB,
        stroke: 'rgba(0,229,255,0.45)', 'stroke-width': 1, 'stroke-dasharray': '3 3',
        style: 'opacity:0;pointer-events:none;transition:opacity 0.15s;',
      }));
      svg.appendChild(createSVG('circle', {
        id: `ce-hover-dot-${m.key}`,
        r: 5, cx: PL, cy: H - PB, fill: m.color, stroke: '#fff', 'stroke-width': 1.2,
        style: 'opacity:0;pointer-events:none;',
      }));

      svg._ce_meta = { W, H, PL, PR, PT, PB, xStep, yRange, m };
      return svg;
    },

    /** 子图 hover tooltip */
    _bindSubHoverTooltip(svg, host, trend, m) {
      const meta = svg._ce_meta;
      if (!meta) return;
      const { W, PL, PR, xStep } = meta;
      const values = trend[m.key] || [];

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;z-index:2;';
      host.appendChild(overlay);

      const toSvgX = (ev) => {
        const rect = svg.getBoundingClientRect();
        const scaleX = W / rect.width;
        return (ev.clientX - rect.left) * scaleX;
      };
      const hideAll = () => {
        const hl = svg.querySelector(`#ce-hover-line-${m.key}`);
        if (hl) hl.style.opacity = 0;
        const d = svg.querySelector(`#ce-hover-dot-${m.key}`);
        if (d) d.style.opacity = 0;
        global.UI.Tooltip.hide();
      };

      overlay.addEventListener('mousemove', (ev) => {
        const vbX = toSvgX(ev);
        if (vbX < PL - 6 || vbX > W - PR + 6) { hideAll(); return; }
        let i = Math.round((vbX - PL) / xStep);
        i = Math.max(0, Math.min(values.length - 1, i));
        const x = PL + xStep * i;
        const v = values[i];
        if (typeof v !== 'number') { hideAll(); return; }
        const y = meta.H - meta.PB - (v / m.max) * meta.yRange;

        const hl = svg.querySelector(`#ce-hover-line-${m.key}`);
        if (hl) { hl.setAttribute('x1', x); hl.setAttribute('x2', x); hl.style.opacity = 1; }
        const d = svg.querySelector(`#ce-hover-dot-${m.key}`);
        if (d) { d.setAttribute('cx', x); d.setAttribute('cy', y); d.style.opacity = 1; }

        const html = `<div class="chart-tooltip">
          <div class="tt-time">⏱ ${trend.xLabels[i]}</div>
          <div class="tt-row"><span><span class="tt-dot" style="background:${m.color};box-shadow:0 0 6px ${m.color};"></span>${m.label}</span><strong>${v.toFixed(1)} ${m.unit}</strong></div>
        </div>`;
        global.UI.Tooltip.show(ev, html, '');
      });
      overlay.addEventListener('mouseleave', hideAll);
    },

    /* ============================================
     *   图例显隐
     * ============================================ */
    _bindLegend() {
      const legend = $('chart-legend');
      if (!legend) return;
      legend.addEventListener('click', (e) => {
        const item = e.target.closest('.legend-item');
        if (!item) return;
        const k = item.dataset.key;
        if (!k) return;
        this._visible[k] = !this._visible[k];
        item.classList.toggle('is-off', !this._visible[k]);
        this._applyVisibility();
      });
    },

    _applyVisibility() {
      const host = $('chart-svg-host');
      if (!host) return;
      const svg = host.querySelector('svg');
      if (!svg) return;
      const map = {
        smoke:     ['#smoke-line', '[data-layer="smoke-area"]'],
        co:        ['#co-line',    '[data-layer="co-area"]'],
        temp:      ['#temp-line', '[data-layer="temp-line-glow"]'],
        threshold: ['[data-layer="thresholds"]', '[data-layer="safe-zone"]'],
      };
      Object.keys(map).forEach(k => {
        const show = this._visible[k];
        map[k].forEach(sel => {
          const el = svg.querySelector(sel);
          if (el) {
            el.style.transition = 'opacity 0.3s';
            el.style.opacity = show ? (k === 'co' ? 0.9 : k === 'threshold' ? 0.7 : 1) : 0;
            el.style.pointerEvents = show ? 'auto' : 'none';
          }
        });
      });
    },

    /* ---------- SVG 趋势图 ---------- */
    async renderTrend() {
      const host = $('chart-svg-host');
      if (!host) return;

      if (!this._deviceId) {
        host.innerHTML = Chart._emptySvg('请先选择监测设备');
        return;
      }

      let trend;
      try {
        trend = await global.DashboardApi.Sensor.getTrend(this._deviceId, this._range);
      } catch (err) {
        console.warn('[chart] trend 拉取失败', err);
        trend = null;
      }

      if (!trend || !trend.xLabels || trend.xLabels.length === 0) {
        host.innerHTML = Chart._emptySvg('暂无趋势数据');
        this._lastTrend = null;
        return;
      }
      

      this._lastTrend = trend;

      const svg = Chart._buildTrendSvg(trend);
      host.innerHTML = '';
      host.appendChild(svg);

      Chart._animatePath(svg);
      Chart._applyVisibility();
      Chart._bindHoverTooltip(svg, host, trend);
    },

    _emptySvg(msg) {
      return `<svg class="chart-svg" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="none">
        <rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="transparent"/>
        <text x="${VB_W / 2}" y="${VB_H / 2}" fill="#7a96b8" font-size="14" text-anchor="middle">
          ${msg || '等待传感器趋势数据...'}
        </text>
      </svg>`;
    },

    _buildTrendSvg(trend) {
      const svg = createSVG('svg', {
        class: 'chart-svg',
        viewBox: `0 0 ${VB_W} ${VB_H}`,
        preserveAspectRatio: 'none',
        style: 'cursor:crosshair;',
      });

      /* defs: 渐变 + 发光滤镜 */
      const defs = createSVG('defs');
      defs.innerHTML = `
        <linearGradient id="grad-smoke" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"  stop-color="#00e5ff" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="#00e5ff" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="grad-co" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"  stop-color="#b388ff" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#b388ff" stop-opacity="0"/>
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>`;
      svg.appendChild(defs);

      /* ---- 坐标 & 网格 ---- */
      const xStep = (VB_W - PAD_LEFT - PAD_RIGHT) / Math.max(1, trend.xLabels.length - 1);
      const yRange = VB_H - PAD_TOP - PAD_BOTTOM;
      const xAt = i => PAD_LEFT + xStep * i;
      // 左 y 轴：烟雾 / CO（标度 0~LEFT_MAX）
      const yAtSmoke = v => VB_H - PAD_BOTTOM - (v / LEFT_MAX) * yRange;
      // 右 y 轴：温度（标度 0~TEMP_MAX）
      const yAtTemp  = v => VB_H - PAD_BOTTOM - (v / TEMP_MAX)  * yRange;

      // 安全区底色：低于最低预警阈值的区域加淡绿色底
      const lowestLeftThresh = Math.min(100, 100); // 烟雾预警100 / CO告警100 → 最低=100
      const safeY = yAtSmoke(lowestLeftThresh);
      svg.appendChild(createSVG('rect', {
        x: PAD_LEFT, y: safeY, width: VB_W - PAD_LEFT - PAD_RIGHT,
        height: VB_H - PAD_BOTTOM - safeY,
        fill: 'rgba(76, 175, 80, 0.05)', 'data-layer': 'safe-zone',
      }));

      // 网格横线（按左 y 轴刻度，step=LEFT_STEP）
      for (let v = 0; v <= LEFT_MAX; v += LEFT_STEP) {
        svg.appendChild(createSVG('line', {
          x1: PAD_LEFT, y1: yAtSmoke(v), x2: VB_W - PAD_RIGHT, y2: yAtSmoke(v),
          stroke: 'rgba(0,200,255,0.08)', 'stroke-width': 1,
        }));
      }
      // 网格竖线
      trend.xLabels.forEach((_, i) => {
        svg.appendChild(createSVG('line', {
          x1: xAt(i), y1: PAD_TOP, x2: xAt(i), y2: VB_H - PAD_BOTTOM,
          stroke: 'rgba(0,200,255,0.08)', 'stroke-width': 1,
        }));
      });

      // 左 y 轴刻度文字（自上而下）
      for (let v = LEFT_MAX; v >= 0; v -= LEFT_STEP) {
        const t = createSVG('text', {
          x: PAD_LEFT - 6, y: yAtSmoke(v) + 4,
          fill: '#7a96b8', 'font-size': 10,
          'font-family': 'Orbitron, monospace', 'text-anchor': 'end',
        });
        t.textContent = String(v);
        svg.appendChild(t);
      }
      // 左 y 轴标题
      const leftTitle = createSVG('text', {
        x: 8, y: PAD_TOP + 4, fill: '#00e5ff', 'font-size': 10, 'text-anchor': 'middle',
      });
      leftTitle.textContent = 'μg/m³';
      svg.appendChild(leftTitle);

      // 右 y 轴刻度文字（温度，自上而下）
      for (let v = TEMP_MAX; v >= 0; v -= TEMP_STEP) {
        const t = createSVG('text', {
          x: VB_W - PAD_RIGHT + 6, y: yAtTemp(v) + 4,
          fill: '#ff7043', 'font-size': 10,
          'font-family': 'Orbitron, monospace', 'text-anchor': 'start',
        });
        t.textContent = String(v);
        svg.appendChild(t);
      }
      // 右 y 轴标题
      const rightTitle = createSVG('text', {
        x: VB_W - 8, y: PAD_TOP + 4, fill: '#ff7043', 'font-size': 10, 'text-anchor': 'end',
      });
      rightTitle.textContent = '℃';
      svg.appendChild(rightTitle);

      // X 轴标签（稀疏化）
      const stepLbl = Math.ceil(trend.xLabels.length / 8);
      trend.xLabels.forEach((lbl, i) => {
        if (i % stepLbl !== 0 && i !== trend.xLabels.length - 1) return;
        const t = createSVG('text', {
          x: xAt(i), y: VB_H - PAD_BOTTOM + 22,
          fill: '#7a96b8', 'font-size': 10,
          'font-family': 'Orbitron, monospace',
          'text-anchor': 'middle',
        });
        t.textContent = lbl;
        svg.appendChild(t);
      });

      // ===== 阈值线：左轴（烟雾预警/火警 + CO告警）+ 右轴（温度告警）=====
      const threshLayer = createSVG('g', { 'data-layer': 'thresholds' });
      // 烟雾阈值（左轴）
      (METRICS_THRESHOLDS.smoke || []).forEach(th => {
        const y = yAtSmoke(th.value);
        threshLayer.appendChild(createSVG('line', {
          x1: PAD_LEFT, y1: y, x2: VB_W - PAD_RIGHT, y2: y,
          stroke: th.color, 'stroke-width': 1.5, 'stroke-dasharray': th.dash, opacity: 0.7,
        }));
        const t = createSVG('text', {
          x: PAD_LEFT + 4, y: y - 4, fill: th.color, 'font-size': 10,
          'font-family': 'Noto Sans SC, sans-serif',
        });
        t.textContent = th.label;
        threshLayer.appendChild(t);
      });
      // CO 阈值（左轴，与烟雾预警 100 重合则偏移标注）
      (METRICS_THRESHOLDS.co || []).forEach(th => {
        const y = yAtSmoke(th.value);
        threshLayer.appendChild(createSVG('line', {
          x1: PAD_LEFT, y1: y + 0.5, x2: VB_W - PAD_RIGHT, y2: y + 0.5,
          stroke: th.color, 'stroke-width': 1, 'stroke-dasharray': th.dash, opacity: 0.5,
        }));
        const t = createSVG('text', {
          x: VB_W - PAD_RIGHT - 4, y: y - 4, fill: th.color, 'font-size': 9,
          'font-family': 'Noto Sans SC, sans-serif', 'text-anchor': 'end',
        });
        t.textContent = 'CO ' + th.label;
        threshLayer.appendChild(t);
      });
      // 温度阈值（右轴）
      (METRICS_THRESHOLDS.temperature || []).forEach(th => {
        const y = yAtTemp(th.value);
        threshLayer.appendChild(createSVG('line', {
          x1: PAD_LEFT, y1: y, x2: VB_W - PAD_RIGHT, y2: y,
          stroke: th.color, 'stroke-width': 1.5, 'stroke-dasharray': th.dash, opacity: 0.6,
        }));
        const t = createSVG('text', {
          x: VB_W - PAD_RIGHT - 4, y: y - 4, fill: th.color, 'font-size': 10,
          'font-family': 'Noto Sans SC, sans-serif', 'text-anchor': 'end',
        });
        t.textContent = '温度 ' + th.label;
        threshLayer.appendChild(t);
      });
      svg.appendChild(threshLayer);

      /* ---- 三条曲线绘制顺序：CO -> 温度 -> 烟雾（烟雾在最上层） ---- */
      // CO 用左 y 轴（与烟雾同标度 0-100 ppm）
      Chart._addAreaLine(svg, trend.co,          'grad-co',   '#b388ff', 2,   0.9, 'co-line',    'co-area',    xAt, yAtSmoke);
      // 温度用右 y 轴（0-50 ℃），用虚线区分
      Chart._addTempLine(svg, trend.temperature, '#ff7043', 2, 0.95, 'temp-line', xAt, yAtTemp);
      // 烟雾用左 y 轴
      Chart._addAreaLine(svg, trend.smoke,       'grad-smoke','#00e5ff', 2.5, 1,   'smoke-line', 'smoke-area', xAt, yAtSmoke);

      /* ---- 峰值点 & 标注（基于烟雾） ---- */
      if (trend.peak && typeof trend.peak.index === 'number') {
        const idx = Math.min(trend.peak.index, (trend.smoke || []).length - 1);
        const x = xAt(idx);
        const y = yAtSmoke(typeof trend.peak.value === 'number' ? trend.peak.value : 0);
        const gPoints = createSVG('g', { id: 'data-points' });
        gPoints.appendChild(createSVG('circle', {
          cx: x, cy: y, r: 5,
          fill: '#00e5ff',
          filter: 'url(#glow)',
        }));
        svg.appendChild(gPoints);

        const anno = createSVG('g', { transform: `translate(${x},${y})` });
        anno.innerHTML = `
          <line x1="0" y1="0" x2="0" y2="-40" stroke="#00e5ff" stroke-width="1" stroke-dasharray="2 2"/>
          <rect x="5" y="-58" width="90" height="22" rx="3"
                fill="rgba(0,229,255,0.12)" stroke="rgba(0,229,255,0.5)"/>
          <text x="12" y="-43" fill="#00e5ff" font-size="11" font-family="Orbitron">峰值 ${
            typeof trend.peak.value === 'number' ? trend.peak.value.toFixed(1) : '--'
          }</text>`;
        svg.appendChild(anno);
      }

      /* ---- Hover 竖线指示器 ---- */
      const hoverLine = createSVG('line', {
        id: 'hover-line',
        x1: PAD_LEFT, y1: PAD_TOP, x2: PAD_LEFT, y2: VB_H - PAD_BOTTOM,
        stroke: 'rgba(0,229,255,0.45)', 'stroke-width': 1,
        'stroke-dasharray': '3 3',
        style: 'opacity:0;pointer-events:none;transition:opacity 0.15s;',
      });
      svg.appendChild(hoverLine);
      ['smoke', 'co', 'temp'].forEach(k => {
        svg.appendChild(createSVG('circle', {
          id: `hover-dot-${k}`,
          r: 5, cx: PAD_LEFT, cy: VB_H - PAD_BOTTOM,
          fill: k === 'smoke' ? '#00e5ff' : k === 'co' ? '#b388ff' : '#ff7043',
          stroke: '#fff', 'stroke-width': 1.2,
          style: 'opacity:0;pointer-events:none;',
        }));
      });

      return svg;
    },

    _addAreaLine(svg, values, gradId, color, strokeWidth, opacity, lineId, areaLayerId, xAt, yAt) {
      if (!values || values.length === 0) return;
      const xs = values.map((_, i) => xAt(i));
      const ys = values.map(v => yAt(typeof v === 'number' ? v : 0));
      const points = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
      const dLine = 'M' + points.split(' ').join(' L');
      const dArea = `${dLine} L${xs[xs.length - 1]},${VB_H - PAD_BOTTOM} L${xs[0]},${VB_H - PAD_BOTTOM} Z`;

      const area = createSVG('path', { d: dArea, fill: `url(#${gradId})`, 'data-layer': `${areaLayerId.split('-')[0]}-area` });
      svg.appendChild(area);
      svg.appendChild(createSVG('path', {
        id: lineId, d: dLine, fill: 'none',
        stroke: color, 'stroke-width': strokeWidth,
        filter: 'url(#glow)', opacity,
      }));
    },

    /** 温度线：右 y 轴，虚线无填充 */
    _addTempLine(svg, values, color, strokeWidth, opacity, lineId, xAt, yAt) {
      if (!values || values.length === 0) return;
      // 温度可能为 null（部分点位缺失），用分段绘制：跳过 null
      const valid = values.map((v, i) => ({ v, i })).filter(o => typeof o.v === 'number');
      if (valid.length === 0) return;
      // 分段：连续索引
      const segments = [];
      let cur = [valid[0]];
      for (let k = 1; k < valid.length; k++) {
        if (valid[k].i === valid[k - 1].i + 1) {
          cur.push(valid[k]);
        } else {
          segments.push(cur);
          cur = [valid[k]];
        }
      }
      segments.push(cur);

      const g = createSVG('g', { id: lineId, 'data-layer': 'temp-line-glow' });
      segments.forEach(seg => {
        const pts = seg.map(o => `${xAt(o.i)},${yAt(o.v)}`).join(' ');
        const d = 'M' + pts.split(' ').join(' L');
        g.appendChild(createSVG('path', {
          d, fill: 'none',
          stroke: color, 'stroke-width': strokeWidth,
          'stroke-dasharray': '5 3',
          filter: 'url(#glow)', opacity,
        }));
      });
      svg.appendChild(g);
    },

    /* ============================================
     *   鼠标悬浮 Tooltip
     * ============================================ */
    _bindHoverTooltip(svg, host, trend) {
      const overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.zIndex = '2';
      host.appendChild(overlay);

      const xStep = (VB_W - PAD_LEFT - PAD_RIGHT) / Math.max(1, trend.xLabels.length - 1);
      const xAt = i => PAD_LEFT + xStep * i;
      const yRange = VB_H - PAD_TOP - PAD_BOTTOM;
      const yAtSmoke = v => VB_H - PAD_BOTTOM - (v / LEFT_MAX) * yRange;
      const yAtTemp  = v => VB_H - PAD_BOTTOM - (v / TEMP_MAX)  * yRange;

      const getIndexByX = (vbX) => {
        const rel = vbX - PAD_LEFT;
        let i = Math.round(rel / xStep);
        i = Math.max(0, Math.min(trend.xLabels.length - 1, i));
        return i;
      };

      const toSvgX = (ev) => {
        const rect = svg.getBoundingClientRect();
        const scaleX = VB_W / rect.width;
        return (ev.clientX - rect.left) * scaleX;
      };

      // 判断数值是否超阈值，返回状态标签
      const statusOf = (val, thresholds) => {
        if (typeof val !== 'number' || !thresholds || !thresholds.length) return '';
        const exceeded = thresholds.filter(th => val >= th.value);
        if (exceeded.length === 0) return '<span style="color:#4caf50;">✓ 安全</span>';
        return '<span style="color:#ff5252;">⚠ ' + exceeded.map(t => t.label).join('/') + '</span>';
      };

      const hideAll = () => {
        const hl = svg.querySelector('#hover-line');
        if (hl) hl.style.opacity = 0;
        ['smoke', 'co', 'temp'].forEach(k => {
          const d = svg.querySelector(`#hover-dot-${k}`);
          if (d) d.style.opacity = 0;
        });
        global.UI.Tooltip.hide();
      };

      overlay.addEventListener('mousemove', (ev) => {
        const vbX = toSvgX(ev);
        if (vbX < PAD_LEFT - 6 || vbX > VB_W - PAD_RIGHT + 6) { hideAll(); return; }
        const i = getIndexByX(vbX);
        const x = xAt(i);
        const smokeV = (trend.smoke && trend.smoke[i]);
        const coV    = (trend.co    && trend.co[i]);
        const tempV  = (trend.temperature && trend.temperature[i]);

        const hl = svg.querySelector('#hover-line');
        if (hl) { hl.setAttribute('x1', x); hl.setAttribute('x2', x); hl.style.opacity = 1; }
        if (this._visible.smoke && typeof smokeV === 'number') {
          const d = svg.querySelector('#hover-dot-smoke');
          if (d) { d.setAttribute('cx', x); d.setAttribute('cy', yAtSmoke(smokeV)); d.style.opacity = 1; }
        }
        if (this._visible.co && typeof coV === 'number') {
          const d = svg.querySelector('#hover-dot-co');
          if (d) { d.setAttribute('cx', x); d.setAttribute('cy', yAtSmoke(coV)); d.style.opacity = 1; }
        }
        if (this._visible.temp && typeof tempV === 'number') {
          const d = svg.querySelector('#hover-dot-temp');
          if (d) { d.setAttribute('cx', x); d.setAttribute('cy', yAtTemp(tempV)); d.style.opacity = 1; }
        }

        const rows = [];
        if (this._visible.smoke && typeof smokeV === 'number') rows.push(`<div class="tt-row"><span><span class="tt-dot" style="background:#00e5ff;box-shadow:0 0 6px #00e5ff;"></span>烟雾浓度 ${statusOf(smokeV, METRICS_THRESHOLDS.smoke)}</span><strong>${Number(smokeV).toFixed(1)} μg/m³</strong></div>`);
        if (this._visible.co && typeof coV === 'number')         rows.push(`<div class="tt-row"><span><span class="tt-dot" style="background:#b388ff;box-shadow:0 0 6px #b388ff;"></span>CO 浓度 ${statusOf(coV, METRICS_THRESHOLDS.co)}</span><strong>${Number(coV).toFixed(1)} ppm</strong></div>`);
        if (this._visible.temp && typeof tempV === 'number')     rows.push(`<div class="tt-row"><span><span class="tt-dot" style="background:#ff7043;box-shadow:0 0 6px #ff7043;"></span>环境温度 ${statusOf(tempV, METRICS_THRESHOLDS.temperature)}</span><strong>${Number(tempV).toFixed(1)} ℃</strong></div>`);

        const html = `
          <div class="chart-tooltip">
            <div class="tt-time">⏱ ${trend.xLabels[i]}  (索引 ${i + 1}/${trend.xLabels.length})</div>
            ${rows.join('')}
          </div>
        `;
        global.UI.Tooltip.show(ev, html, '');
      });
      overlay.addEventListener('mouseleave', hideAll);
    },

    _animatePath(svg) {
      ['smoke-line', 'co-line', 'temp-line'].forEach(id => {
        const p = svg.querySelector('#' + id);
        if (!p) return;
        try {
          // temp-line 是 g 内多个 path，分别动画
          const paths = p.tagName === 'path' ? [p] : Array.from(p.querySelectorAll('path'));
          paths.forEach(path => {
            const len = path.getTotalLength();
            path.style.strokeDasharray = len;
            path.style.strokeDashoffset = len;
            path.style.transition = 'stroke-dashoffset 2.5s ease-in-out';
            requestAnimationFrame(() => {
              requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; });
            });
          });
        } catch (e) { /* ignore */ }
      });
    },

    _pulsePoints(svg) {
      const points = svg.querySelectorAll('#data-points circle');
      points.forEach((p, i) => {
        p.animate(
          [
            { transform: 'scale(1)',   opacity: 1 },
            { transform: 'scale(1.8)', opacity: 0.6 },
            { transform: 'scale(1)',   opacity: 1 },
          ],
          { duration: 2000, delay: i * 400, iterations: Infinity }
        );
      });
    },

    destroy() {
      if (this._metricTimer) clearInterval(this._metricTimer);
      if (this._trendTimer)  clearInterval(this._trendTimer);
    },
  };

  global.ChartComponent = Chart;
})(window);
