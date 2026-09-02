/**
 * ws.js - WebSocket (STOMP) 实时推送客户端
 * ------------------------------------------------------------
 * 对接后端 STOMP 端点：ws://{API_HOST}/ws?token={JWT}
 *   · 握手阶段由 WebSocketAuthInterceptor 校验 token（query 参数）
 *   · 失败会被后端拒绝连接
 *
 * 按角色订阅主题：
 *   · 系统管理员      → /topic/alarms/admin           （全部小区告警）
 *   · 小区管理员/居民  → /topic/alarms/community/{cid}  （本小区告警）
 *   · 所有登录态      → /topic/smoke-readings          （烟雾浓度上报）
 *                      /topic/device-online            （设备在线状态变更）
 *                      /topic/device-status            （设备状态变更）
 *
 * 消息信封：{ type, timestamp, data }
 *   type ∈ SMOKE_REPORTED | DEVICE_STATUS_CHANGED | DEVICE_ONLINE_STATUS_CHANGED
 *          | ALARM_CREATED | ALARM_ESCALATED
 *
 * 依赖：
 *   · 全局 Stomp（@stomp/stompjs UMD，由 index.html 加载）
 *   · global.Auth.getSession()  → 取 role / communityId / token
 *   · global.UI.Toast           → 推送 Toast 提示
 *   · global.AlertsComponent   → 告警推送后刷新列表/统计
 *   · global.HeaderComponent   → 刷新顶部待处理计数
 *   · global.OverviewComponent → 感知层/设备总览刷新
 *   · global.ChartComponent     → 趋势图刷新
 * ------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /** 后端 API 主机（与 client.js 的 API_BASE 对齐：动态取 hostname + 8080，转 ws 协议） */
  function buildBrokerURL(token) {
    const host = (global.location && global.location.hostname ? global.location.hostname : 'localhost') + ':8080';
    const proto = global.location && global.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${host}/ws?token=${encodeURIComponent(token)}`;
  }

  /** 与 auth.js 共用的 localStorage Key */
  const AUTH_KEY = 'smoke.auth';

  function getSession() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function getToken() {
    const s = getSession();
    return s && s.token ? String(s.token) : '';
  }

  /** 安全 Toast：UI 未初始化时不报错 */
  function toast(level, msg) {
    try {
      const UI = global.UI;
      if (UI && UI.Toast && typeof UI.Toast[level] === 'function') {
        UI.Toast[level](msg);
      }
    } catch (_) { /* ignore */ }
  }

  const WS = {
    _client: null,
    _connected: false,
    /** 已订阅句柄，断开时统一 unsubscribe */
    _subscriptions: [],
    /** 节流定时器，避免高频推送刷爆渲染 */
    _throttleTimers: {},

    /** 入口：由 main.js initAll 之后调用 */
    init() {
      const s = getSession();
      if (!s || !s.token) {
        console.info('[ws] 未登录，跳过 WebSocket 连接');
        return;
      }
      if (typeof global.StompJs === 'undefined' || !global.StompJs || !global.StompJs.Client) {
        console.warn('[ws] stompjs 库未加载，WebSocket 实时推送不可用（页面其他功能不受影响）');
        return;
      }
      this.connect();
    },

    /** 建立 STOMP 连接（带自动重连） */
    connect() {
      const token = getToken();
      if (!token) return;

      // 清理旧连接
      this.disconnect();

      const client = new global.StompJs.Client({
        brokerURL: buildBrokerURL(token),
        reconnectDelay: 5000,        // 断开 5s 后自动重连
        heartbeatIncoming: 10000,
        heartbeatOutgoing: 10000,
        debug: false,
      });

      client.onConnect = () => {
        this._connected = true;
        console.info('[ws] STOMP 已连接');
        this._subscribeTopics();
      };

      client.onDisconnect = () => {
        this._connected = false;
        console.info('[ws] STOMP 已断开');
      };

      client.onStompError = (frame) => {
        const reason = (frame && frame.headers && frame.headers['message']) || '未知错误';
        console.error('[ws] STOMP 协议错误：', reason);
        toast('error', '实时连接协议错误：' + reason);
      };

      client.onWebSocketError = (err) => {
        console.warn('[ws] WebSocket 通道错误', err);
      };

      try {
        client.activate();
        this._client = client;
      } catch (e) {
        console.error('[ws] 激活失败', e);
      }
    },

    /** 按角色订阅对应主题（设计文档 §7.3 主题设计） */
    _subscribeTopics() {
      if (!this._client || !this._connected) return;
      const s = getSession();
      if (!s) return;

      // 1) 火警主题：全部角色都订阅（跨小区广播）
      this._subscriptions.push(
        this._client.subscribe('/topic/alarms/fire', (msg) => this._onAlarm(msg))
      );

      // 2) 本小区告警主题：居民/小区管理员订阅（含离线/低电量/故障/预警）
      if (s.role !== 'system_admin' && s.communityId) {
        const topic = '/topic/community/' + s.communityId + '/alarms';
        this._subscriptions.push(
          this._client.subscribe(topic, (msg) => this._onAlarm(msg))
        );
      }

      // 3) 系统管理员订阅全部小区告警（通过 admin 专属主题，后端如有则订阅）
      if (s.role === 'system_admin') {
        // 兼容旧主题名 + 新主题名
        this._subscriptions.push(
          this._client.subscribe('/topic/alarms/admin', (msg) => this._onAlarm(msg))
        );
      }

      // 4) 本小区设备运维主题：小区管理员订阅
      if (s.role === 'community_admin' && s.communityId) {
        const devTopic = '/topic/community/' + s.communityId + '/devices';
        this._subscriptions.push(
          this._client.subscribe(devTopic, (msg) => this._onDeviceStatus(msg))
        );
      }

      // 5) 住户重点提示队列：绑定设备的火警/低电量定向推送
      if (s.role === 'user' && s.userId) {
        this._subscriptions.push(
          this._client.subscribe('/user/' + s.userId + '/queue/alerts', (msg) => this._onPersonalAlert(msg))
        );
      }

      // 6) 烟雾浓度上报（兼容旧全局主题）
      this._subscriptions.push(
        this._client.subscribe('/topic/smoke-readings', (msg) => this._onSmoke(msg))
      );

      // 7) 设备在线状态变更（兼容旧全局主题）
      this._subscriptions.push(
        this._client.subscribe('/topic/device-online', (msg) => this._onDeviceOnline(msg))
      );

      // 8) 设备状态变更（兼容旧全局主题）
      this._subscriptions.push(
        this._client.subscribe('/topic/device-status', (msg) => this._onDeviceStatus(msg))
      );
    },

    /** 解析 STOMP 消息信封 */
    _parse(msg) {
      try {
        const body = msg && msg.body ? JSON.parse(msg.body) : null;
        return body || {};
      } catch (e) {
        console.warn('[ws] 消息解析失败', e);
        return {};
      }
    },

    /** 告警主题分发：ALARM_CREATED / ALARM_ESCALATED */
    _onAlarm(msg) {
      const env = this._parse(msg);
      const data = env.data || {};
      if (env.type === 'ALARM_CREATED') {
        this._handleAlarmCreated(data);
      } else if (env.type === 'ALARM_ESCALATED') {
        this._handleAlarmEscalated(data);
      } else if (env.type === 'DEVICE_OFFLINE' || env.type === 'DEVICE_ONLINE') {
        this._handleDeviceOnlineEvent(data, env.type);
      }
    },

    /**
     * 新告警处理：按告警类型分发不同 Toast 级别
     * 设计文档 §3.2 告警可见与提示矩阵：
     *   FIRE（火警）→ error 级别 Toast
     *   OFFLINE（离线）→ warn
     *   LOW_BATTERY（低电量）→ warn
     *   SENSOR_FAULT（故障）→ error（故障需立即处理）
     *   WARN（预警）→ warn
     */
    _handleAlarmCreated(data) {
      const alarmType  = String(data.alarmType  || data.type  || '').toUpperCase();
      const alarmLevel = String(data.alarmLevel || data.level || '').toUpperCase();
      const text       = data.message || data.title || '设备告警';
      const deviceName = data.deviceName || data.device || '';
      const areaName   = data.area || data.location || '';

      // 组装提示文本
      const where = [deviceName, areaName].filter(Boolean).join(' · ');
      const full  = where ? `${text}（${where}）` : text;

      // 按告警类型选择 Toast 级别
      switch (alarmType) {
        case 'SMOKE_HIGH':
        case 'TEMP_HIGH':
        case 'CO_HIGH':
          toast('error', '🔥 火警：' + full);
          break;
        case 'SENSOR_FAULT':
          toast('error', '🔧 传感器故障：' + full);
          break;
        case 'LOW_BATTERY':
          toast('warn', '🔋 低电量告警：' + full);
          break;
        case 'OFFLINE':
          toast('warn', '📡 设备离线：' + full);
          break;
        default:
          // 兼容旧 level 方式
          if (alarmLevel === 'FIRE' || alarmLevel === 'HIGH') {
            toast('error', '🔥 新火警：' + full);
          } else if (alarmLevel === 'FAULT') {
            toast('error', '🔧 设备故障：' + full);
          } else {
            toast('warn', '⚠ 新告警：' + full);
          }
      }
      this._refreshAlertPanels();
      this._refreshHeaderStatus();

      // —— AI 视觉复核：告警触发后自动拉取传感器画面并识别 ——
      // 等待告警列表渲染完毕（100ms 后 DOM 中有卡片），再触发复核
      setTimeout(() => {
        try {
          const C = global.AlertsComponent;
          if (C && typeof C.triggerAiReview === 'function') {
            C.triggerAiReview(data);
          }
        } catch (_) { /* 静默：AI 复核失败不影响告警主流程 */ }
      }, 100);
    },

    /** 告警升级：火警超时未确认被自动升级 */
    _handleAlarmEscalated(data) {
      const text = data.message || '火警超时未确认';
      toast('error', '🚨 告警升级：' + text + '（请立即处置）');
      this._refreshAlertPanels();
      this._refreshHeaderStatus();

      // 升级告警同样触发 AI 复核
      setTimeout(() => {
        try {
          const C = global.AlertsComponent;
          if (C && typeof C.triggerAiReview === 'function') {
            C.triggerAiReview(data);
          }
        } catch (_) {}
      }, 100);
    },

    /** 设备上线/离线事件（从告警主题接收） */
    _handleDeviceOnlineEvent(data, eventType) {
      const isOffline = eventType === 'DEVICE_OFFLINE';
      const name = data.deviceName || data.device || '设备';
      if (isOffline) {
        toast('warn', '📡 设备离线：' + name);
      } else {
        toast('info', '✅ 设备上线：' + name);
      }
      this._throttledRefresh('device-online', 1000, () => {
        if (global.OverviewComponent) {
          // 社区层：传当前 activeCommunityId，保持在社区层不切回全局
          const cid = global.OverviewComponent._activeCommunityId || null;
          if (typeof global.OverviewComponent.renderDevices === 'function') {
            try { global.OverviewComponent.renderDevices(cid); } catch (e) { /* ignore */ }
          }
          if (typeof global.OverviewComponent.renderSummary === 'function') {
            try { global.OverviewComponent.renderSummary(cid); } catch (e) { /* ignore */ }
          }
          if (typeof global.OverviewComponent.renderPerception === 'function') {
            try { global.OverviewComponent.renderPerception(); } catch (e) { /* ignore */ }
          }
        }
        // 趋势图 + 消防员设备列表也一并刷新（保证多端一致）
        if (global.ChartComponent && typeof global.ChartComponent.render === 'function') {
          try { global.ChartComponent.render(); } catch (e) { /* ignore */ }
        }
        if (global.FirefighterPage && typeof global.FirefighterPage.renderDevices === 'function') {
          try { global.FirefighterPage.renderDevices(); } catch (e) { /* ignore */ }
        }
      });
    },

    /**
     * 住户重点提示：绑定设备的火警/低电量定向推送
     * 设计文档 §7.4：通过 convertAndSendToUser 向该住户的 /queue/alerts 定向推送
     */
    _onPersonalAlert(msg) {
      const env = this._parse(msg);
      const data = env.data || env || {};
      const alarmType = String(data.alarmType || data.type || '').toUpperCase();
      const text   = data.message || data.title || '您绑定的设备有新告警';
      const device = data.deviceName || data.device || '';

      // 重点提示：更强烈的 Toast + 浏览器通知
      switch (alarmType) {
        case 'SMOKE_HIGH':
        case 'TEMP_HIGH':
        case 'CO_HIGH':
          toast('error', '🚨 家中报警器火警！' + (device ? '（' + device + '）' : '') + ' ' + text);
          this._notifyBrowser('🔥 家中火警', text + (device ? '（' + device + '）' : ''));
          break;
        case 'LOW_BATTERY':
          toast('warn', '🔋 家中报警器低电量：' + (device ? '（' + device + '）' : '') + ' 请及时更换电池');
          this._notifyBrowser('🔋 低电量提醒', device ? '设备「' + device + '」电量低，请及时更换电池' : '您的报警器电量低，请及时更换');
          break;
        case 'SENSOR_FAULT':
          toast('error', '🔧 家中报警器故障：' + (device ? '（' + device + '）' : '') + ' ' + text);
          this._notifyBrowser('🔧 设备故障', device ? '设备「' + device + '」故障：' + text : '您的报警器出现故障：' + text);
          break;
        default:
          toast('warn', '⚠ 家中设备告警：' + (device ? '（' + device + '）' : '') + ' ' + text);
      }
      this._refreshAlertPanels();
      this._refreshHeaderStatus();
    },

    /** 浏览器系统通知（居民重点提示用，需用户授权） */
    _notifyBrowser(title, body) {
      try {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
          new Notification(title, { body: body, icon: '/assets/img/favicon.png' });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(p => {
            if (p === 'granted') new Notification(title, { body: body });
          });
        }
      } catch (_) { /* ignore */ }
    },

    /** 烟雾上报：节流刷新感知层（趋势图按自身节奏刷新，避免高频重绘） */
    _onSmoke(msg) {
      this._throttledRefresh('smoke', 2000, () => {
        if (global.OverviewComponent && typeof global.OverviewComponent.renderPerception === 'function') {
          try { global.OverviewComponent.renderPerception(); } catch (e) { /* ignore */ }
        }
      });
    },

    /** 设备在线状态变更：刷新设备总览 + 感知层（多角色覆盖） */
    _onDeviceOnline(msg) {
      this._throttledRefresh('device-online-global', 1000, () => {
        // 1) 管理员大屏：设备列表 / 统计卡 / 感知层
        if (global.OverviewComponent) {
          const cid = global.OverviewComponent._activeCommunityId || null;
          if (typeof global.OverviewComponent.renderDevices === 'function') {
            try { global.OverviewComponent.renderDevices(cid); } catch (e) { /* ignore */ }
          }
          if (typeof global.OverviewComponent.renderSummary === 'function') {
            try { global.OverviewComponent.renderSummary(cid); } catch (e) { /* ignore */ }
          }
          if (typeof global.OverviewComponent.renderPerception === 'function') {
            try { global.OverviewComponent.renderPerception(); } catch (e) { /* ignore */ }
          }
        }
        // 2) 趋势图
        if (global.ChartComponent && typeof global.ChartComponent.render === 'function') {
          try { global.ChartComponent.render(); } catch (e) { /* ignore */ }
        }
        // 3) 消防员指挥台：重新拉设备列表 + 统计卡
        if (global.FirefighterPage) {
          if (typeof global.FirefighterPage._loadDevices === 'function') {
            try { global.FirefighterPage._loadDevices().catch(() => {}); } catch (_) {}
          }
          if (typeof global.FirefighterPage._renderStats === 'function') {
            try { global.FirefighterPage._renderStats(); } catch (_) {}
          }
        }
        // 4) 居民端：重新拉设备列表 + 顶部统计（确保绑定设备的状态变更在住户侧立即可见）
        if (global.UserPage) {
          if (typeof global.UserPage._renderDevices === 'function') {
            try { global.UserPage._renderDevices(); } catch (_) {}
          }
          if (typeof global.UserPage._renderStats === 'function') {
            try { global.UserPage._renderStats(); } catch (_) {}
          } else if (typeof global.UserPage.refreshStats === 'function') {
            try { global.UserPage.refreshStats(); } catch (_) {}
          }
        }
      });
    },

    /** 设备状态变更：与在线状态共用刷新逻辑（同时联动告警面板刷新） */
    _onDeviceStatus(msg) {
      this._onDeviceOnline(msg);
      this._refreshAlertPanels();
    },

    /** 节流刷新：同 key 在 delay ms 内只触发一次 */
    _throttledRefresh(key, delay, fn) {
      if (this._throttleTimers[key]) return;
      this._throttleTimers[key] = setTimeout(() => {
        try { fn(); } catch (e) { console.warn('[ws] 节流刷新失败', e); }
        this._throttleTimers[key] = null;
      }, delay);
    },

    /** 刷新告警列表 + 统计（多角色覆盖：管理员大屏 / 消防员指挥台 / 居民查询中心） */
    _refreshAlertPanels() {
      // 1) 管理员大屏告警组件
      try {
        const C = global.AlertsComponent;
        if (C) {
          if (typeof C.renderEvents === 'function') C.renderEvents();
          if (typeof C.renderStats === 'function')   C.renderStats();
        }
      } catch (e) { console.warn('[ws] 刷新管理员告警面板失败', e); }
      // 2) 消防员指挥台：重新拉告警 + 重绘统计卡
      try {
        const F = global.FirefighterPage;
        if (F && typeof F._loadAlerts === 'function') {
          F._loadAlerts().catch(() => {});
        }
        if (F && typeof F._renderStats === 'function') {
          try { F._renderStats(); } catch (_) {}
        }
      } catch (e) { console.warn('[ws] 刷新消防员指挥台告警失败', e); }
      // 3) 居民个人中心：重新拉绑定的告警并渲染（按用户权限过滤，保证多端同步）
      try {
        const U = global.UserPage;
        if (U && typeof U._fetchAndRenderAlerts === 'function') {
          U._fetchAndRenderAlerts();
        }
        if (U && typeof U._renderStats === 'function') {
          try { U._renderStats(); } catch (_) {}
        }
      } catch (e) { console.warn('[ws] 刷新居民告警面板失败', e); }
    },

    /** 刷新顶部待处理告警计数（复用 Header._fetchStatus，避免双源不一致） */
    _refreshHeaderStatus() {
      try {
        const H = global.HeaderComponent;
        if (H && typeof H._fetchStatus === 'function') H._fetchStatus();
      } catch (e) { /* ignore */ }
    },

    /** 主动断开（切换账号 / 退出登录时调用） */
    disconnect() {
      this._subscriptions.forEach(s => { try { s.unsubscribe(); } catch (_) {} });
      this._subscriptions = [];
      if (this._client) {
        try { this._client.deactivate(); } catch (_) {}
        this._client = null;
      }
      this._connected = false;
    },

    /** 当前是否已连接（调试用） */
    isConnected() { return this._connected; },
  };

  global.WS = WS;
})(window);
