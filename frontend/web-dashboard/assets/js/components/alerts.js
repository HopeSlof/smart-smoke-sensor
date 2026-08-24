/**
 * components/alerts.js - 告警统计 + 告警事件流 + 联动控制 + 系统日志
 * 数据源：
 *   DashboardApi.Alert.getStats      → 3 项统计
 *   DashboardApi.Alert.getEventList  → 告警列表
 *   DashboardApi.Alert.getSystemLogs → 系统日志
 * 交互增强：
 *   - 告警条目点击 → Drawer 详情
 *   - 联动控制按钮 → 下发指令 + Toast
 *   - 日志面板右上角放大按钮 → Modal 全屏查看
 *   - Modal 支持：日志等级 Tabs 筛选 / 关键字搜索 / 自动滚动暂停
 *                / 一键复制 / 导出文本 / 清空
 */
(function (global) {
  'use strict';

  const { $, create, render } = global.DomUtil;
  const { formatLogTime } = global.DateUtil;

  const LEVEL_TEXT = { high: '紧急', mid: '预警', low: '提示' };
  // 不使用 mock 日志模板：真实数据未接入时不显示任何假数据，由 renderLogs 通过 API 拉取后 append。
  const LOG_TEMPLATES = [];

  /** 告警类型 → 图标 + 文案 + CSS 类名（设计文档 §3.2） */
  const ALARM_TYPE_MAP = {
    SMOKE_HIGH:   { icon: '🔥', text: '烟雾火警', cls: 't-fire' },
    TEMP_HIGH:    { icon: '🌡️', text: '温度火警', cls: 't-fire' },
    CO_HIGH:      { icon: '☠️', text: 'CO超标',  cls: 't-fire' },
    SENSOR_FAULT: { icon: '🔧', text: '故障',    cls: 't-fault' },
    LOW_BATTERY:  { icon: '🔋', text: '低电量',  cls: 't-battery' },
    OFFLINE:      { icon: '📡', text: '设备离线', cls: 't-offline' },
    WARN:         { icon: '⚠️', text: '预警',    cls: 't-warn' },
  };

  /** 根据告警数据解析出告警类型信息 */
  function resolveAlarmType(a) {
    const raw = String(a.alarmType || a.type || a.alarm_type || '').toUpperCase();
    // 后端可能返回的是 AlarmType 枚举名
    if (ALARM_TYPE_MAP[raw]) return ALARM_TYPE_MAP[raw];
    // 兜底：从 level 推断
    const level = String(a.level || '').toLowerCase();
    if (level === 'high') return { icon: '🔥', text: '火警', cls: 't-fire' };
    if (level === 'mid')  return { icon: '⚠️', text: '预警', cls: 't-warn' };
    return { icon: '📢', text: raw || '告警', cls: 't-warn' };
  }

  /** 告警状态机配置（设计文档 §6.2：未处理→已确认→已归档 / 未处理→误报归档） */
  const STATUS_CFG = {
    pending:     { text: '待处理',  cls: 'pending' },
    confirmed:   { text: '已确认',  cls: 'confirmed' },
    archived:    { text: '已归档',  cls: 'archived' },
    false_alarm: { text: '误报',    cls: 'false-alarm' },
  };

  /** 10 步闭环（设计文档 §3.1 告警与视觉复核闭环） */
  const LOOP_STEPS = [
    { name: '阈值配置', desc: '系统配置告警阈值' },
    { name: '实时采集', desc: '传感器采集烟雾浓度' },
    { name: '阈值判断', desc: '后端判断浓度是否超阈值' },
    { name: '触发告警', desc: '系统生成告警记录' },
    { name: '推送通知', desc: '告警推送至值班人员' },
    { name: '调看摄像头', desc: '安保调看告警点位画面' },
    { name: 'AI 复核',  desc: 'SmartJavaAI 视觉复核' },
    { name: '确认火情', desc: '人工确认是否真实火情' },
    { name: '下发广播', desc: 'MQTT 下发联动广播指令' },
    { name: '处置归档', desc: '现场处置后归档' },
  ];

  const Alerts = {
    _logTimer: null,
    _refreshTimer: null,
    _logIdx: 0,
    /** 完整日志数组（Modal里查看，最多存 500 条） */
    _allLogs: [],
    /** Modal 状态 */
    _modal: {
      level: 'all',
      keyword: '',
      autoscroll: true,
      /** 用户在 viewport 里有选中或手动滚动，临时暂停自动滚动 */
      userPausedScroll: false,
    },
    /** 联动控制状态（每个设备 on/off） */
    _linkageState: {},

    init() {
      this.render();
      this._bindLogModal();
      this._bindExpandButtons();

      // 【约定】真实数据未接入时，不预先生成、不定时推送任何假日志。
      // 等后端接通后，renderLogs 会通过 DashboardApi.Log.getLogList 拉取并渲染真实数据。
      this._refreshTimer = setInterval(() => this.render(), 60_000);
    },

    /** 统一入口，统计+告警+联动+日志刷新（header 的手动刷新会调这里） */
    async render() {
      await Promise.all([this.renderStats(), this.renderEvents(), this.renderLinkage(), this.renderLogs()]);
    },

    /** ---------- 统计 ---------- */
    async renderStats() {
      const host = $('alert-stats-host');
      if (!host) return;
      let data;
      try {
        data = await global.DashboardApi.Alert.getStats();
      } catch (err) {
        console.warn('[alerts] stats 拉取失败', err);
      }
      const cfg = [
        { key: 'high', cls: 'high', label: '紧急告警' },
        { key: 'mid',  cls: 'mid',  label: '一般预警' },
        { key: 'low',  cls: 'low',  label: '提示信息' },
      ];
      render(host, cfg.map(c => create('div', { class: 'alert-stat ' + c.cls }, [
        create('div', { class: 'alert-stat-num' },
          data && typeof data[c.key] === 'number' ? String(data[c.key]) : '--'),
        create('div', { class: 'alert-stat-label' }, c.label),
      ])));
    },

    /** ---------- 告警事件 (点击打开 Drawer 详情) ---------- */
    async renderEvents() {
      const host = $('alert-list-host');
      if (!host) return;
      let list;
      try {
        list = await global.DashboardApi.Alert.getEventList(50);
      } catch (err) {
        console.warn('[alerts] events 拉取失败', err);
      }
      // 只展示活跃告警（待处理/已确认）；已归档、误报的告警不再显示在事件流中
      if (Array.isArray(list)) {
        list = list.filter(a => a.status !== 'archived' && a.status !== 'false_alarm');
      }
      if (!list || list.length === 0) {
        host.innerHTML = `<div class="empty-placeholder" style="min-height:240px;">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span>暂无活跃告警</span></div>`;
        return;
      }
      render(host, list.map((a, i) => Alerts._alertItem(a, i)));
    },

    _alertItem(a, i) {
      const levelCls = a.level === 'high' ? '' : a.level === 'mid' ? 'mid' : 'low';
      const animCls = (levelCls === '' || levelCls === 'mid' || levelCls === 'low') ? ' anim-alert-in' : '';
      const typeInfo = resolveAlarmType(a);
      const div = create('div', {
        class: 'alert-item' + (levelCls ? ' ' + levelCls : '') + animCls + (a.escalated ? ' is-escalated' : ''),
        style: { animationDelay: (i * 0.05) + 's', cursor: 'pointer' },
        title: '点击查看详情',
        onclick: (e) => {
          e.stopPropagation();
          Alerts._openAlertDrawer(a);
        },
      }, [
        create('div', { class: 'alert-head' }, [
          create('span', { class: 'alert-level' }, LEVEL_TEXT[a.level] || '提示'),
          create('span', { class: 'alarm-type-badge ' + typeInfo.cls, title: typeInfo.text },
            typeInfo.icon + ' ' + typeInfo.text),
          ...(a.escalated ? [create('span', { class: 'alert-escalated-badge', title: '火警超时未确认，系统已自动升级' }, '已升级')] : []),
          create('span', { class: 'alert-time' }, a.time || ''),
        ]),
        create('div', { class: 'alert-title', title: a.title,
          html: a.title + ' <span style="float:right;color:var(--text-dim);font-size:11px;">详情 ›</span>' }),
        create('div', { class: 'alert-desc' }, a.description || ''),
      ]);
      return div;
    },

    /** 解析告警对象 → 状态机 key */
    _getAlertStatus(a) {
      if (a.status && STATUS_CFG[a.status]) return a.status;
      if (a.status === '已处理' || a.status === '已归档') return 'archived';
      if (a.status === '已确认') return 'confirmed';
      if (a.status === '误报')   return 'false_alarm';
      if (a.handled)             return 'archived';
      return 'pending';
    },

    /** 状态 → 已完成闭环步数 */
    _getCompletedSteps(status) {
      switch (status) {
        case 'archived':    return 10;   // 全流程闭环
        case 'confirmed':   return 8;    // 确认火情完成，待下发广播 + 归档
        case 'false_alarm': return 7;    // AI 复核完成，标记误报终止
        default:            return 5;    // 推送通知完成，待调看摄像头
      }
    },

    /** 构建状态机流转图 DOM 节点 */
    _buildStateMachine(status) {
      const { create } = global.DomUtil;
      const order = ['pending', 'confirmed', 'archived'];
      const ci = order.indexOf(status);
      const flow = create('div', { class: 'sm-flow' });
      order.forEach((key, i) => {
        const cfg = STATUS_CFG[key];
        const passed = ci >= 0 && i < ci;
        flow.appendChild(create('div', {
          class: 'sm-node ' + cfg.cls +
                 (key === status ? ' is-current' : '') +
                 (passed ? ' is-passed' : ''),
        }, cfg.text));
        if (i < order.length - 1) {
          flow.appendChild(create('div', {
            class: 'sm-arrow' + (i < ci ? ' done' : ''),
            html: '<svg width="20" height="14" viewBox="0 0 20 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="7" x2="16" y2="7"/><polyline points="12,3 16,7 12,11"/></svg>',
          }));
        }
      });
      const branch = create('div', { class: 'sm-branch' }, [
        create('div', { class: 'sm-branch-line' }),
        create('div', {
          class: 'sm-node false-alarm' + (status === 'false_alarm' ? ' is-current' : ''),
        }, STATUS_CFG.false_alarm.text),
      ]);
      return create('div', { class: 'state-machine' }, [flow, branch]);
    },

    /** 构建 10 步闭环进度条 DOM 节点 */
    _buildLoopProgress(status, completed) {
      const { create } = global.DomUtil;
      const dots = create('div', { class: 'loop-dots' });
      LOOP_STEPS.forEach((step, i) => {
        const idx = i + 1;
        const done = idx <= completed;
        const isTerminal = status === 'archived' || status === 'false_alarm';
        const current = !isTerminal && idx === completed + 1;
        dots.appendChild(create('div', {
          class: 'loop-dot' + (done ? ' done' : '') + (current ? ' current' : ''),
          title: idx + '. ' + step.name + ' — ' + step.desc,
        }, String(idx)));
        if (i < LOOP_STEPS.length - 1) {
          dots.appendChild(create('div', {
            class: 'loop-link' + (idx < completed ? ' done' : ''),
          }));
        }
      });
      const info = create('div', { class: 'loop-current' });
      if (status === 'archived') {
        info.appendChild(create('span', { class: 'loop-current-label ok' }, '闭环已完成'));
        info.appendChild(create('span', { class: 'loop-current-desc' }, '全部 10 个环节已处置归档'));
      } else if (status === 'false_alarm') {
        info.appendChild(create('span', { class: 'loop-current-label highlight' }, '经判定为误报'));
        info.appendChild(create('span', { class: 'loop-current-desc' }, '已完成 AI 视觉复核并标记误报，流程终止'));
      } else {
        const cur = LOOP_STEPS[Math.min(completed, LOOP_STEPS.length - 1)];
        info.appendChild(create('span', { class: 'loop-current-label warn' }, '当前环节：' + cur.name));
        info.appendChild(create('span', { class: 'loop-current-desc' }, cur.desc));
      }
      return create('div', { class: 'loop-progress' }, [dots, info]);
    },

    /** 当前登录角色是否为「可消除紧急告警」：管理员（系统/小区）或消防员 */
    _canDismissAlert() {
      try {
        const s = global.Auth && global.Auth.getSession && global.Auth.getSession();
        if (!s) return false;
        const r = String(s.role || '').toLowerCase();
        return r === 'system_admin' || r === 'community_admin' || r === 'firefighter';
      } catch (_) { return false; }
    },

    /** 根据状态生成底部操作按钮 */
    _buildFooterActions(a, status) {
      const actions = [];
      const level = String(a.level || '').toLowerCase();
      const isHigh = level === 'high'; // 紧急级别（火警等）
      const canDismiss = this._canDismissAlert();

      // 【新增】：待处理 / 已确认的紧急告警，管理员 & 消防员在确认设备正常后，可直接「消除」归档
      if (canDismiss && isHigh && (status === 'pending' || status === 'confirmed')) {
        actions.push({
          label: '消除紧急告警', cls: 'btn-red',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px;"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/><line x1="10" y1="11" x2="14" y2="11"/></svg>',
          onClick: () => this._onDismissEmergency(a),
        });
      }

      if (status === 'pending') {
        actions.push({
          label: '标记误报', cls: 'btn-warn',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px;"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>',
          onClick: () => this._onMarkFalseAlarm(a),
        });
        actions.push({
          label: '确认火情', cls: 'btn-red',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px;"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
          onClick: () => this._onConfirmFire(a),
        });
      } else if (status === 'confirmed') {
        actions.push({
          label: '标记误报', cls: 'btn-warn',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px;"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>',
          onClick: () => this._onMarkFalseAlarm(a),
        });
        actions.push({
          label: '处置归档', cls: 'btn-primary',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px;margin-right:5px;"><polyline points="20 6 9 17 4 12"/></svg>',
          onClick: () => this._onArchive(a),
        });
      }
      actions.push({
        label: '关闭', cls: 'btn-ghost',
        onClick: () => global.UI.Drawer.close(),
      });
      return actions;
    },

    /** 管理员 / 消防员：消除紧急告警（确认设备正常后，直接归档关闭） */
    async _onDismissEmergency(a) {
      const UI = global.UI;
      // 二次确认：避免误消
      const ok = await (UI && UI.Modal && typeof UI.Modal.confirm === 'function'
        ? UI.Modal.confirm({
            title: '消除紧急告警',
            message: '请确认该告警点位已现场核实、设备已恢复正常，消除后该告警将归档并从事件流中移除。',
            confirmText: '确认消除',
            cancelText: '取消',
          })
        : Promise.resolve(window.confirm('请确认设备已恢复正常，是否消除并归档该告警？')));
      if (!ok) return;
      UI?.Toast?.info('正在消除并归档紧急告警…');
      try {
        await global.DashboardApi.AlertAction.archiveAlert(a.id);
        a.status = 'archived';
        UI?.Toast?.success('紧急告警已消除并归档，不再显示于事件流');
        await Promise.all([this.renderStats(), this.renderEvents()]);
        global.UI?.Drawer?.close();
      } catch (err) {
        UI?.Toast?.error('消除失败：' + (err && err.message || '请稍后重试'));
      }
    },

    /** 确认火情：pending → confirmed（联动下发广播） */
    async _onConfirmFire(a) {
      const UI = global.UI;
      UI.Toast.info('正在确认火情并联动广播…');
      try {
        await global.DashboardApi.AlertAction.confirmFire(a.id);
        a.status = 'confirmed';
        UI.Toast.success('已确认火情，已联动下发广播指令');
        await Promise.all([this.renderStats(), this.renderEvents()]);
        this._openAlertDrawer(a);
      } catch (err) {
        UI.Toast.error('确认失败：' + (err && err.message || '请稍后重试'));
      }
    },

    /** 标记误报：pending/confirmed → false_alarm */
    async _onMarkFalseAlarm(a) {
      const UI = global.UI;
      try {
        await global.DashboardApi.AlertAction.markFalseAlarm(a.id);
        a.status = 'false_alarm';
        UI.Toast.success('已标记为误报，告警流程终止');
        await Promise.all([this.renderStats(), this.renderEvents()]);
        this._openAlertDrawer(a);
      } catch (err) {
        UI.Toast.error('操作失败：' + (err && err.message || '请稍后重试'));
      }
    },

    /** 处置归档：confirmed → archived */
    async _onArchive(a) {
      const UI = global.UI;
      try {
        await global.DashboardApi.AlertAction.archiveAlert(a.id);
        a.status = 'archived';
        UI.Toast.success('已归档，告警闭环完成');
        await Promise.all([this.renderStats(), this.renderEvents()]);
        this._openAlertDrawer(a);
      } catch (err) {
        UI.Toast.error('归档失败：' + (err && err.message || '请稍后重试'));
      }
    },

    /** 打开告警详情 Drawer：先从后端拉详情，保证 history / disposition 字段真实 */
    async _openAlertDrawer(a) {
      const UI = global.UI;
      // 列表项已有一个粗略 status（来自 getEventList），先立即显示 Drawer 占位，再刷新内容
      UI.Drawer.open({
        level: a.level || 'low',
        title: a.title || '告警详情',
        description: '正在加载详情…',
        infoPairs: [],
        timeline: [{ time: a.time || '--', text: '加载中，请稍候…' }],
        footerActions: [{ label: '关闭', cls: 'btn-ghost', onClick: () => UI.Drawer.close() }],
      });
      // 拉详情
      let detail = a;
      try {
        if (a && a.id && global.DashboardApi && global.DashboardApi.AlertAction) {
          detail = await global.DashboardApi.AlertAction.getDetail(a.id);
        }
      } catch (err) {
        UI.Toast.warn('详情拉取失败，已显示列表摘要：' + (err && err.message || ''));
      }
      // 合并（保留列表里的 title/level/time 兜底）
      const merged = Object.assign({}, a, detail || {});
      const status = this._getAlertStatus(merged);
      const statusCfg = STATUS_CFG[status];
      const completed = this._getCompletedSteps(status);

      UI.Drawer.open({
        level: merged.level || 'low',
        title: merged.title || '告警详情',
        description: merged.description || '',
        infoPairs: [
          { label: '事件 ID',    value: merged.id || '--', cls: 'highlight' },
          { label: '严重等级',   value: LEVEL_TEXT[merged.level] || '--',
              cls: merged.level === 'high' ? 'danger' : merged.level === 'mid' ? 'warn' : 'highlight' },
          ...(merged.escalated ? [{ label: '升级状态', value: '已升级 · 火警超时未确认',
              cls: 'danger' }] : []),
          { label: '设备编号',   value: merged.deviceId || merged.device || 'D-UNKN', cls: '' },
          { label: '所在区域',   value: merged.area   || merged.location || '--',     cls: '' },
          { label: '首次触发',   value: (merged.time ? String(merged.time).slice(0, 19) : '--') },
          { label: '当前状态',   value: statusCfg.text,
              cls: status === 'pending' ? 'warn' : status === 'confirmed' ? 'danger' :
                   status === 'archived' ? 'ok' : 'highlight' },
          { label: '处理建议',   value: merged.tip    || merged.description || '请联系值班人员现场确认', cls: 'warn', full: true },
        ],
        extraSections: [
          { title: '告警状态机', node: this._buildStateMachine(status) },
          { title: '告警闭环进度（' + completed + '/10）', node: this._buildLoopProgress(status, completed) },
        ],
        timeline: this._buildTimeline(merged, status),
        footerActions: this._buildFooterActions(merged, status),
      });
    },

    _buildTimeline(a, status) {
      const arr = [];
      arr.push({ time: (a.time ? String(a.time).slice(0, 19) : '--'),
                 text: '首次检测到异常：' + (a.description || a.title || ''),
                 cls: a.level === 'high' ? 'bad' : a.level === 'mid' ? 'warn' : '' });
      if (Array.isArray(a.history) && a.history.length) {
        a.history.forEach(h => {
          if (!h) return;
          if (!arr.find(x => x.text === h.action && String(x.time).slice(0, 16) === String(h.time).slice(0, 16))) {
            arr.push({
              time: h.time ? String(h.time).slice(0, 19) : '--',
              cls: /误报|FALSE/.test(h.action || '') ? '' : 'ok',
              text: (h.operator ? (h.operator + '：') : '') + (h.action || '系统事件'),
            });
          }
        });
      } else {
        arr.push({ time: a.time ? String(a.time).slice(0, 19) : '--', cls: 'ok', text: '系统已记录事件并推送至值班人员' });
      }
      arr.push({
        time: status === 'pending' ? '—' : (a.time ? String(a.time).slice(0, 19) : '--'),
        cls: status === 'pending' ? '' : 'ok',
        text: status === 'pending' ? '等待人工确认 / 处置…' :
              status === 'confirmed' ? '已确认为真实火情，等待处置归档' :
              status === 'archived' ? '现场处置完成，已归档闭环' :
              '经复核判定为误报，已关闭',
      });
      return arr;
    },

    /** 打开告警汇总 Drawer（工具栏右上按钮） */
    async openSummary() {
      const UI = global.UI;
      let data = null, list = null;
      try {
        [data, list] = await Promise.all([
          global.DashboardApi.Alert.getStats(),
          global.DashboardApi.Alert.getEventList(8),
        ]);
      } catch (e) {}
      const h = data && typeof data.high === 'number' ? data.high : 0;
      const m = data && typeof data.mid  === 'number' ? data.mid  : 0;
      const l = data && typeof data.low  === 'number' ? data.low  : 0;
      const pending = h + m;

      // 时间线：最近的告警
      const tl = (list || []).slice(0, 6).map(a => ({
        time: a.time || '--',
        text: `[${LEVEL_TEXT[a.level] || '提示'}] ${a.title || ''}`,
        cls: a.level === 'high' ? 'bad' : a.level === 'mid' ? 'warn' : 'ok',
      }));

      UI.Drawer.open({
        level: h > 0 ? 'high' : m > 0 ? 'mid' : 'low',
        title: `告警处置汇总 · 待处理 ${pending} 项`,
        description: h > 0 ? '检测到紧急告警，请优先处置红色级别事件。' : (m > 0 ? '仍有一般预警，建议在 2 小时内响应。' : '当前全部告警已处于可控状态。'),
        infoPairs: [
          { label: '紧急告警', value: h + ' 条', cls: h > 0 ? 'danger' : 'ok' },
          { label: '一般预警', value: m + ' 条', cls: m > 6 ? 'warn' : '' },
          { label: '提示信息', value: l + ' 条' },
          { label: '待处理总数', value: pending + ' 条', cls: pending >= 3 ? 'warn' : 'highlight' },
          { label: '处置值班', value: '张工 · 138-0000-0001', full: true },
          { label: '响应 SLA',   value: '紧急 ≤ 10 分钟 / 预警 ≤ 2 小时', full: true, cls: 'highlight' },
        ],
        timeline: tl.length ? tl : [
          { time: '暂无', cls: '', text: '当前没有需要处置的事件时间线数据' },
        ],
      });
    },

    /** ---------- 应用层 · 联动控制 ---------- */
    async renderLinkage() {
      const host = $('linkage-host');
      if (!host) return;

      const items = [
        { id: 'alarm',   name: '声光报警器联动', color: '#ef4444', ready: '待机中', on: '告警中',
          icon: `<svg viewBox="0 0 36 36" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6c-4 3-7 7-7 12v4h14v-4c0-5-3-9-7-12z"/>
            <path d="M10 22h16"/>
            <path d="M14 26v2a4 4 0 0 0 8 0v-2"/>
            <path d="M9 13l-2-1M27 13l2-1M8 18H5M31 18h-3"/>
          </svg>` },
        { id: 'fan',     name: '排风设备启动',   color: '#3b82f6', ready: '已待机', on: '排风中',
          icon: `<svg viewBox="0 0 36 36" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="18" r="13"/>
            <path d="M18 18c3-6 12-7 11-11M18 18c6 3 7 12 11 11M18 18c-3 6-12 7-11 11M18 18c-6-3-7-12-11-11"/>
          </svg>` },
        { id: 'valve',   name: '电磁阀关闭',     color: '#f59e0b', ready: '已开启', on: '已切断',
          icon: `<svg viewBox="0 0 36 36" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="10" y="14" width="16" height="10" rx="2"/>
            <line x1="6" y1="19" x2="10" y2="19"/><line x1="26" y1="19" x2="30" y2="19"/>
            <line x1="14" y1="14" x2="14" y2="10"/><line x1="22" y1="14" x2="22" y2="10"/>
            <line x1="12" y1="10" x2="24" y2="10"/>
          </svg>` },
        { id: 'light',   name: '应急照明启动',   color: '#22c55e', ready: '待机中', on: '照明中',
          icon: `<svg viewBox="0 0 36 36" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 4a10 10 0 0 1 4 19.2V26h-8v-2.8A10 10 0 0 1 18 4z"/>
            <line x1="14" y1="30" x2="22" y2="30"/>
            <line x1="16" y1="33" x2="20" y2="33"/>
            <line x1="7" y1="13" x2="4" y2="11"/><line x1="29" y1="13" x2="32" y2="11"/>
            <line x1="6" y1="20" x2="3" y2="20"/><line x1="30" y1="20" x2="33" y2="20"/>
          </svg>` },
      ];
      render(host, items.map(it => {
        const isOn = !!this._linkageState[it.id];
        const btn = create('div', {
          class: 'linkage-btn' + (isOn ? ' on' : ''),
          title: isOn ? `点击关闭：${it.name}` : `点击触发：${it.name}`,
          onclick: (e) => {
            e.stopPropagation();
            Alerts._onTriggerLinkage(it, btn);
          },
        }, [
          create('div', { class: 'linkage-icon', style: { color: it.color }, html: it.icon }),
          create('div', { class: 'linkage-name' }, it.name),
          create('div', { class: 'linkage-status ' + (isOn ? 'on' : '') }, [
            create('span', { class: 'sw' }),
            document.createTextNode(isOn ? it.on : it.ready),
          ]),
        ]);
        return btn;
      }));
    },

    _onTriggerLinkage(item, btnEl) {
      const UI = global.UI;
      const prev = !!this._linkageState[item.id];
      const next = !prev;
      this._linkageState[item.id] = next;
      // 视觉切换 class
      if (next) btnEl.classList.add('on'); else btnEl.classList.remove('on');
      const statusEl = btnEl.querySelector('.linkage-status');
      if (statusEl) {
        statusEl.classList.toggle('on', next);
        const text = statusEl.lastChild;
        if (text && text.nodeType === 3) text.nodeValue = next ? item.on : item.ready;
      }
      // 日志 + Toast（不生成假日志 push 到列表里，只弹轻提示）
      if (next) {
        UI.Toast.info(`已下发【${item.name}】指令`);
      } else {
        UI.Toast.success(`【${item.name}】已复位`);
      }
    },

    /** ---------- 日志 ---------- */
    async renderLogs() {
      const host = $('log-list-host');
      if (!host) return;

      // 优先拉 API 数据（真实数据接入后会在这里返回）
      let apiList = [];
      try {
        apiList = await global.DashboardApi.Alert.getSystemLogs(20);
      } catch (err) {
        console.warn('[alerts] logs 拉取失败', err);
      }
      if (Array.isArray(apiList) && apiList.length) {
        // 将 API 拉到的同步到 _allLogs
        apiList.forEach(l => this._appendLog(this._normalizeLog(l), true));
      }

      // 显示逻辑：面板只显示最近 6 条
      const toShow = this._allLogs.slice(-6).slice().reverse();
      if (toShow.length === 0) {
        host.innerHTML = `<div class="empty-placeholder" style="min-height: 180px;">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/></svg>
          <span>暂无日志数据，等待后端接入…</span></div>`;
        return;
      }
      host.innerHTML = this._buildLogLines(toShow);
    },

    /** 把 API / 外部传入的日志对象标准化（时间 / 类型 / 级别 / 消息），类型文案统一中文 */
    _normalizeLog(l) {
      const now = formatLogTime();
      const type = (l.type || l.level || 'info').toString().toUpperCase();
      const map = {
        INFO:   { type: '[信息]', cls: 'info' },
        DATA:   { type: '[数据]', cls: 'info' },
        OK:     { type: '[正常]', cls: 'ok'   },
        SUCCESS:{ type: '[正常]', cls: 'ok'   },
        WARN:   { type: '[警告]', cls: 'warn' },
        ALERT:  { type: '[错误]', cls: 'err'  },
        ERR:    { type: '[错误]', cls: 'err'  },
        ERROR:  { type: '[错误]', cls: 'err'  },
        DEBUG:  { type: '[调试]', cls: 'info' },
      };
      // cls 也允许直接传英文 level → 归一化成中文标签
      const clsRaw = (l.cls || '').toString().toLowerCase();
      const hit = map[type] ||
                  map[clsRaw.toUpperCase()] ||
                  { type: l.type || '[信息]', cls: clsRaw || 'info' };
      return {
        time: l.time || l.timestamp || now,
        type: hit.type,
        cls:  hit.cls,
        msg:  l.msg  || l.message || l.content || l.text || '',
      };
    },

    /** 追加一条日志（通用入口，API 或 UI 内部都可调用） */
    _appendLog(log, silent) {
      if (!log) return;
      this._allLogs.push(log);
      if (this._allLogs.length > 500) this._allLogs.shift();
      if (silent) return;
      const host = $('log-list-host');
      if (host) {
        const div = document.createElement('div');
        div.className = 'log-line';
        div.innerHTML = this._buildLogLines([log]);
        host.insertBefore(div, host.firstChild);
        while (host.children.length > 6) host.removeChild(host.lastChild);
      }
      if ($('log-modal')?.classList.contains('is-open')) this._renderModalViewport(true);
    },

    /** @deprecated 兼容旧调用名，不再生成 mock */
    _appendFullLog(silent) { /* no-op: 不生成任何假数据 */ },
    _pushLogLine()        { /* no-op: 不再定时推假数据 */ },

    _buildLogLines(list) {
      return list.map(l => {
        // 如果日志还没走 normalize（例如 _renderModalViewport 直接拉 _allLogs），再补一次转义/中文化兜底
        const n = this._normalizeLog(l);
        return `<div class="log-line">
          <span class="log-time">${n.time}</span>
          <span class="log-type ${n.cls}">${n.type}</span>
          <span class="log-msg">${n.msg}</span>
        </div>`;
      }).join('');
    },

    /** ==========================================
     *    日志全屏 Modal 相关交互
     * ========================================== */
    _bindExpandButtons() {
      const btnExpandLog = $('btn-expand-log');
      if (btnExpandLog) {
        btnExpandLog.addEventListener('click', () => {
          this._openLogModal();
        });
      }
    },

    _openLogModal() {
      global.UI.Modal.open('log-modal');
      // 首次打开时先渲染一次
      this._renderModalViewport(false);
    },

    _bindLogModal() {
      // 关闭按钮
      $('btn-log-close')?.addEventListener('click', () => global.UI.Modal.close('log-modal'));

      // Tabs 切换
      const tabs = $('log-tabs');
      if (tabs) {
        tabs.addEventListener('click', (e) => {
          const t = e.target.closest('.tab');
          if (!t) return;
          tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('is-active'));
          t.classList.add('is-active');
          this._modal.level = t.dataset.level || 'all';
          this._renderModalViewport(false);
        });
      }

      // 自动滚动开关
      const toggleAuto = $('btn-toggle-autoscroll');
      if (toggleAuto) {
        toggleAuto.addEventListener('click', () => {
          const on = toggleAuto.classList.toggle('is-on');
          this._modal.autoscroll = on;
          if (on) {
            this._modal.userPausedScroll = false;
            $('log-viewport')?.classList.remove('is-paused-autoscroll');
            this._renderModalViewport(true);
            global.UI.Toast.success('已开启自动滚动');
          } else {
            global.UI.Toast.info('已暂停自动滚动');
          }
        });
      }

      // 搜索
      const search = $('log-search');
      if (search) {
        let t = null;
        search.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(() => {
            this._modal.keyword = (search.value || '').trim();
            this._renderModalViewport(false);
          }, 120);
        });
      }

      // viewport: 用户拖动选择文本 => 暂停自动滚动；松手一段时间后恢复
      const v = $('log-viewport');
      if (v) {
        const checkSelection = () => {
          const sel = window.getSelection();
          if (sel && sel.toString().length > 0) {
            this._modal.userPausedScroll = true;
            v.classList.add('is-paused-autoscroll');
          } else {
            if (this._modal.autoscroll) {
              // 没选中文本，且开关开着 => 继续滚动
              this._modal.userPausedScroll = false;
              v.classList.remove('is-paused-autoscroll');
            }
          }
        };
        v.addEventListener('mousedown', () => { /* 开始选择不立即暂停，等 mouseup 判断 */ });
        v.addEventListener('mouseup',   checkSelection);
        v.addEventListener('keyup',     checkSelection);
        // 手动滚动滚上去 => 自动暂停
        let _topLock = false;
        v.addEventListener('scroll', () => {
          const atBottom = (v.scrollHeight - v.scrollTop - v.clientHeight) < 24;
          if (!atBottom && this._modal.autoscroll && !this._modal.userPausedScroll) {
            this._modal.userPausedScroll = true;
            v.classList.add('is-paused-autoscroll');
            _topLock = true;
          } else if (atBottom && _topLock) {
            this._modal.userPausedScroll = false;
            v.classList.remove('is-paused-autoscroll');
            _topLock = false;
          }
        });
      }

      // 复制全部
      $('btn-log-copy')?.addEventListener('click', async () => {
        const visible = this._getVisibleLogs();
        const text = visible.map(l => `${l.time} ${l.type} ${l.msg}`).join('\n');
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            // 兼容
            const ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); ta.remove();
          }
          global.UI.Toast.success(`已复制 ${visible.length} 条日志到剪贴板`);
        } catch (e) {
          global.UI.Toast.error('复制失败：' + (e && e.message || '未知错误'));
        }
      });

      // 清空显示（只是清空，不是清空数据源）
      $('btn-log-clear')?.addEventListener('click', () => {
        const v = $('log-viewport');
        if (v) v.innerHTML = '';
        this._updateModalCounts([], this._allLogs);
      });

      // 导出为文本
      $('btn-log-export')?.addEventListener('click', () => {
        const visible = this._getVisibleLogs();
        const text = visible.map(l => `${l.time} ${l.type} ${l.msg}`).join('\r\n');
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs_${DateUtil.formatLogTime().replace(/[: ]/g,'-')}.txt`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        global.UI.Toast.success(`已导出 ${visible.length} 条日志`);
      });
    },

    /** 根据当前筛选条件获取应该显示的日志 */
    _getVisibleLogs() {
      const { level, keyword } = this._modal;
      let list = this._allLogs.slice();
      if (level && level !== 'all') {
        list = list.filter(l => {
          if (level === 'err')  return l.cls === 'err';
          if (level === 'warn') return l.cls === 'warn';
          if (level === 'ok')   return l.cls === 'ok';
          if (level === 'info') return l.cls === 'info' || l.cls === undefined;
          return true;
        });
      }
      if (keyword) {
        const kw = keyword.toLowerCase();
        list = list.filter(l =>
          (l.msg || '').toLowerCase().includes(kw) ||
          (l.type || '').toLowerCase().includes(kw) ||
          (l.time || '').toLowerCase().includes(kw)
        );
      }
      return list;
    },

    _updateModalCounts(visible, total) {
      const cv = $('log-count-visible');
      const ct = $('log-count-total');
      if (cv) cv.textContent = visible.length;
      if (ct) ct.textContent = (total || this._allLogs).length;
    },

    /** 渲染日志 Modal 视口 */
    _renderModalViewport(appendMode) {
      const viewport = $('log-viewport');
      if (!viewport) return;

      const visible = this._getVisibleLogs();
      this._updateModalCounts(visible);

      const doScroll = this._modal.autoscroll && !this._modal.userPausedScroll;

      if (!appendMode || !this._lastRenderedCount || this._lastRenderedCount > visible.length) {
        // 筛选条件变化 / 首次渲染 -> 完整重绘
        viewport.innerHTML = visible.length === 0
          ? `<div style="color:var(--text-dim);padding:40px 0;text-align:center;">（ 没有匹配的日志，请尝试修改筛选条件 ）</div>`
          : this._buildLogLines(visible);
        if (doScroll) viewport.scrollTop = viewport.scrollHeight;
      } else {
        // 追加模式（只新增后面几条）
        const from = this._lastRenderedCount;
        const tail = visible.slice(from);
        if (tail.length > 0) {
          const tmp = document.createElement('div');
          tmp.innerHTML = this._buildLogLines(tail);
          while (tmp.firstChild) viewport.appendChild(tmp.firstChild);
        }
        if (doScroll) viewport.scrollTop = viewport.scrollHeight;
      }
      this._lastRenderedCount = visible.length;
    },

    destroy() {
      if (this._logTimer)     clearInterval(this._logTimer);
      if (this._refreshTimer) clearInterval(this._refreshTimer);
    },
  };

  global.AlertsComponent = Alerts;
})(window);
