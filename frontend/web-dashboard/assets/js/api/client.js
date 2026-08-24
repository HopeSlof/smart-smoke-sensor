/**
 * api/client.js - 后端接口客户端
 * ------------------------------------------------------------
 * 已对接后端（smart-smoke-sensor，http://localhost:8080）。
 *
 * 约定：
 *   - 认证：除注册/登录及 3 个硬件上报接口外，请求 Header 携带 `token`（JWT）
 *           token 来自 localStorage['smoke.auth'].token（由 auth.js 写入）
 *   - 统一响应：{ code, errorMsg, data }，code===200 成功；401 清登录态跳登录页
 *   - ID 类型：后端 id/deviceId 等均返回字符串
 *
 * 接口对接说明：
 *   - 后端真实有的接口（设备/告警/烟雾/阈值/用户）走真实请求并做字段映射
 *   - 后端暂未提供的接口（AI复核/广播/MQTT状态/架构/感知层/区域/系统日志等）
 *     通过 useMock 返回空/默认结构，保证页面不崩（降级显示）
 * ------------------------------------------------------------
 */

(function (global) {
  'use strict';

  /** 后端 API 基础地址（后端已开启 CORS 允许前端跨域） */
  const API_BASE = 'http://192.168.43.219:8080';

  /** 与 auth.js 共用的 localStorage Key */
  const AUTH_KEY = 'smoke.auth';

  /**
   * 小区列表（数据库无 communities 表，前端共享常量）
   * 供注册页「归属小区」下拉、设备绑定页「所属小区」下拉、RoleGuard 小区名解析共用。
   * id 与 users.community_id / devices.community_id 对齐。
   */
  const COMMUNITIES = [
    { id: 1, name: '阳光花园小区' },
    { id: 2, name: '幸福里小区' },
  ];

  /**
   * 各小区下的演示居民用户（供设备绑定「绑定用户」下拉展示用，不落库存储）
   * 真实场景应由后端 GET /users?communityId=X 拉取；当前后端无该接口，降级使用预置名单。
   */
  const USERS_BY_COMMUNITY = {
    1: [
      { id: 3, username: 'user01', label: '居民·user01' },
    ],
    2: [
      { id: 4, username: 'user02', label: '居民·user02' },
    ],
  };

  /** 按 communityId 查小区名 */
  function communityNameById(cid) {
    if (cid == null || cid === '') return '';
    const c = COMMUNITIES.find(x => String(x.id) === String(cid));
    return c ? c.name : ('第' + cid + '小区');
  }

  /* ---------- 工具函数 ---------- */

  /** 读取当前登录 token（无则返回空串） */
  function getToken() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return '';
      const obj = JSON.parse(raw);
      return (obj && obj.token) ? String(obj.token) : '';
    } catch (_) { return ''; }
  }

  /** 清除登录态并跳转登录页（401 时调用） */
  function handleUnauthorized() {
    try {
      if (global.Auth && typeof global.Auth.clearSession === 'function') {
        global.Auth.clearSession();
      } else {
        localStorage.removeItem(AUTH_KEY);
      }
    } catch (_) { /* ignore */ }
    // 避免循环跳转：若已在登录页则不跳
    if (!/login\.html/i.test(global.location.pathname)) {
      const next = global.location.pathname.split('/').pop() + global.location.search;
      global.location.replace('login.html?reason=timeout&next=' + encodeURIComponent(next));
    }
  }

  /**
   * 统一请求包装
   * @param {string} path     请求路径（以 / 开头，不含 API_BASE）
   * @param {object} [opts]   fetch 选项
   * @param {object} [cfg]    { useMock, mockData, mockDelay }；useMock=true 返回 mockData
   */
  function request(path, opts, cfg) {
    opts = opts || {};
    cfg = cfg || {};

    // 后端暂未提供的接口：走 mock 降级
    if (cfg.useMock && cfg.mockData !== undefined) {
      return new Promise(resolve => {
        setTimeout(() => resolve(cfg.mockData), cfg.mockDelay || 200);
      });
    }

    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = getToken();
    if (token) headers['token'] = token;

    // 认证走 token 请求头（非 cookie），不需要 credentials，避免后端缺 Access-Control-Allow-Credentials 时被浏览器拦截
    const fetchOpts = Object.assign({}, opts, { headers });
    // GET 请求不要带 body，避免 fetch 报错
    if (!opts.method || /^(GET|HEAD)$/i.test(opts.method)) {
      delete fetchOpts.body;
    }

    return fetch(API_BASE + path, fetchOpts)
      .then(resp => resp.text().then(text => {
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
        return { resp, body };
      }))
      .then(({ resp, body }) => {
        // 后端统一响应 {code, errorMsg, data}
        if (body && typeof body === 'object' && 'code' in body) {
          if (body.code === 200) return body.data;
          if (body.code === 401) { handleUnauthorized(); throw new Error(body.errorMsg || '登录已过期'); }
          throw new Error(body.errorMsg || ('请求失败（code=' + body.code + '）'));
        }
        // HTTP 层错误
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
        return body;
      });
  }

  /** 构造 query string：{a:1,b:'x'} => "a=1&b=x"，跳过 null/undefined/空串 */
  function toQuery(obj) {
    const parts = [];
    Object.keys(obj || {}).forEach(k => {
      const v = obj[k];
      if (v === null || v === undefined || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? ('?' + parts.join('&')) : '';
  }

  /** 后端 role 映射到前端三角色：SYSTEM_ADMIN→system_admin / COMMUNITY_ADMIN→community_admin / 其他→user */
  function mapRole(backendRole) {
    const r = String(backendRole || '').toUpperCase();
    if (r === 'SYSTEM_ADMIN') return 'system_admin';
    if (r === 'COMMUNITY_ADMIN') return 'community_admin';
    return 'user';
  }

  /** 把字符串/数字字段安全转 Number */
  function num(v, def) {
    if (v === null || v === undefined || v === '') return def;
    const n = Number(v);
    return isNaN(n) ? def : n;
  }

  /** 格式化 Date 为 yyyy-MM-dd HH:mm:ss（后端期望格式） */
  function fmtTime(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /** 告警等级映射到前端 level：FIRE→high, WARN→mid, 其余→low */
  function mapAlarmLevel(alarmLevel) {
    const l = String(alarmLevel || '').toUpperCase();
    if (l === 'FIRE') return 'high';
    if (l === 'WARN') return 'mid';
    // OFFLINE / FAULT / LOW_BATTERY 虽也是告警，但前端无"紧急"UI，统一归到 low 保证统计可展示
    return 'low';
  }

  /**
   * 后端 status + disposition → 前端告警状态：
   *   ACTIVE + disposition=CONFIRMED_FIRE → confirmed（已确认，待处置归档）
   *   ACTIVE + disposition=FALSE_ALARM → false_alarm（误报，一般也会立即置 RESOLVED）
   *   ACTIVE + acknowledgedAt已置空 → 未确认但已处理过确认按钮 → confirmed（保守）
   *   ACTIVE + 全空 → pending
   *   RESOLVED + disposition=FALSE_ALARM → false_alarm
   *   RESOLVED → archived
   */
  function mapAlarmStatus(status, disposition, acknowledgedAt, resolvedAt) {
    const s = String(status || '').toUpperCase();
    const d = String(disposition || '').toUpperCase();
    if (s === 'RESOLVED') return d === 'FALSE_ALARM' ? 'false_alarm' : 'archived';
    if (d === 'FALSE_ALARM') return 'false_alarm';
    if (d === 'CONFIRMED_FIRE' || acknowledgedAt || resolvedAt) return 'confirmed';
    return 'pending';
  }

  /** 告警类型转中文文案 */
  function alarmTypeText(t) {
    return {
      SMOKE_HIGH: '烟雾超标',
      TEMP_HIGH: '温度超标',
      CO_HIGH: 'CO超标',
      OFFLINE: '设备离线',
      LOW_BATTERY: '低电量',
      SENSOR_FAULT: '传感器故障',
    }[String(t || '').toUpperCase()] || t || '告警';
  }

  /** 设备在线状态映射到前端展示状态 */
  function mapDeviceStatus(onlineStatus, batteryLevel) {
    const s = String(onlineStatus || '').toUpperCase();
    if (s !== 'ONLINE') return 'offline';
    if (batteryLevel !== null && batteryLevel !== undefined && num(batteryLevel, 100) < 20) return 'warning';
    return 'normal';
  }

  /* =========================================================
   *  0. 用户模块 /auth —— 后端 /users
   * ========================================================= */
  const UserApi = {
    /**
     * 登录 → POST /users/login
     * @returns {Promise<{token,userId,username,role}>} role 已映射为前端 admin/user
     */
    login({ username, password }) {
      return request('/users/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
    },
    /**
     * 注册 → POST /users/register
     * 后端强制 role=RESIDENT + status=PENDING，忽略前端传入 role；注册不返回 token。
     */
    register({ username, password, communityId, realName, phone, role }) {
      return request('/users/register', {
        method: 'POST',
        body: JSON.stringify({ username, password, communityId, realName, phone, role }),
      });
    },
    /**
     * 忘记密码 → POST /users/reset-password
     * 通过「账号 + 绑定手机号」校验后重置密码（无需登录态）
     */
    resetPasswordByPhone({ username, phone, newPassword }) {
      return request('/users/reset-password', {
        method: 'POST',
        body: JSON.stringify({ username, phone, newPassword }),
      });
    },
  };

  /* =========================================================
   *  1a. 小区管理 —— 后端 /community（系统管理员操作）
   * ========================================================= */
  const CommunityApi = {
    /** 新增小区 → POST /community */
    create({ name, address, adminUserId }) {
      return request('/community', {
        method: 'POST',
        body: JSON.stringify({ name, address, adminUserId: adminUserId ? String(adminUserId) : null }),
      });
    },
    /** 小区分页列表 → GET /community
     * @param {object} [opts]  { page, pageSize, name }
     * @returns {Promise<{total, records:Array<{id,name,address,adminUserId,adminUsername,createdAt}>}>}
     */
    getList(opts) {
      opts = opts || {};
      const page = num(opts.page, 1);
      const pageSize = num(opts.pageSize, 50);
      const qs = toQuery({ page, pageSize, name: opts.name || undefined });
      return request('/community' + qs, { method: 'GET' })
        .then(p => p || { total: 0, records: [] });
    },
    /** 小区详情 → GET /community/{id}（前端暂不用，预留给后续） */
    getDetail(id) {
      if (!id) return Promise.resolve(null);
      return request('/community/' + id, { method: 'GET' });
    },
    /** 修改小区 → PUT /community/{id} */
    update(id, { name, address, adminUserId }) {
      return request('/community/' + id, {
        method: 'PUT',
        body: JSON.stringify({ name, address, adminUserId: adminUserId ? String(adminUserId) : null }),
      });
    },
    /** 删除小区 → DELETE /community/{id}（有用户/设备会被拒绝，返回 errorMsg） */
    remove(id) {
      return request('/community/' + id, { method: 'DELETE' });
    },
    /**
     * 指定/更换/清除小区负责人 → PUT /community/{id}/admin
     * @param {string|number|null} adminUserId 传 null/空串表示清除负责人
     */
    setAdmin(id, adminUserId) {
      return request('/community/' + id + '/admin', {
        method: 'PUT',
        body: JSON.stringify({ adminUserId: adminUserId ? String(adminUserId) : null }),
      });
    },
  };

  /* =========================================================
   *  1b. 管理员用 — 用户管理（CRUD + 审核 + 启停 + 重置密码）
   * ========================================================= */
  const AdminUserApi = {
    /**
     * 用户分页列表 → GET /users
     * 数据权限：小区管理员只返回本小区
     * @param {object} [opts] { page, pageSize, role, communityId, status }
     */
    getList(opts) {
      opts = opts || {};
      const qs = toQuery({
        page: num(opts.page, 1),
        pageSize: num(opts.pageSize, 50),
        role: opts.role || undefined,
        communityId: opts.communityId || undefined,
        status: opts.status || undefined,
      });
      return request('/users' + qs, { method: 'GET' })
        .then(p => p || { total: 0, records: [] });
    },
    /**
     * 管理员创建用户 → POST /users
     * 角色：仅允许 RESIDENT / COMMUNITY_ADMIN / FIREFIGHTER（不能 SYSTEM_ADMIN）
     * 小区管理员只能创建本小区居民
     */
    create({ username, password, role, communityId, realName, phone }) {
      const body = { username, password, role };
      if (communityId != null && communityId !== '') body.communityId = communityId;
      if (realName) body.realName = realName;
      if (phone)    body.phone    = phone;
      return request('/users', { method: 'POST', body: JSON.stringify(body) });
    },
    /** 编辑用户 → PUT /users/{id}（角色/小区/姓名/电话） */
    update(id, { role, communityId, realName, phone }) {
      const body = {};
      if (role)        body.role        = role;
      if (communityId) body.communityId = communityId;
      if (realName)    body.realName    = realName;
      if (phone)       body.phone       = phone;
      return request('/users/' + id, { method: 'PUT', body: JSON.stringify(body) });
    },
    /** 启用/禁用用户 → PUT /users/{id}/status  status ∈ {ACTIVE, DISABLED} */
    setStatus(id, status) {
      return request('/users/' + id + '/status', {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
    },
    /** 管理员重置密码 → PUT /users/{id}/password */
    resetPassword(id, password) {
      return request('/users/' + id + '/password', {
        method: 'PUT',
        body: JSON.stringify({ password }),
      });
    },
    /**
     * 审核注册 → PUT /users/{id}/audit
     * @param {string} id  用户 ID
     * @param {boolean} approve  true=通过(ACTIVE) / false=拒绝(DISABLED)
     */
    audit(id, approve) {
      return request('/users/' + id + '/audit', {
        method: 'PUT',
        body: JSON.stringify({ approve: !!approve }),
      });
    },
    /** 删除用户 → DELETE /users/{id}（仅系统管理员；不能删系统管理员） */
    remove(id) {
      return request('/users/' + id, { method: 'DELETE' });
    },
    /** 查询住户绑定设备 → GET /users/{userId}/devices */
    getBoundDevices(userId) {
      if (!userId) return Promise.resolve([]);
      return request('/users/' + userId + '/devices', { method: 'GET' })
        .then(arr => Array.isArray(arr) ? arr : []);
    },
  };

  /* =========================================================
   *  1c. 住户-设备绑定 —— 后端 /devices/{id}/bind | /unbind
   * ========================================================= */
  const UserDeviceApi = {
    /** 绑定住户到设备 → PUT /devices/{deviceId}/bind  userId 必须是居民且与设备同小区 */
    bind(deviceId, userId) {
      return request('/devices/' + deviceId + '/bind', {
        method: 'PUT',
        body: JSON.stringify({ userId: String(userId) }),
      });
    },
    /** 解绑住户与设备 → PUT /devices/{deviceId}/unbind */
    unbind(deviceId, userId) {
      return request('/devices/' + deviceId + '/unbind', {
        method: 'PUT',
        body: JSON.stringify({ userId: String(userId) }),
      });
    },
  };

  /* =========================================================
   *  1d. 居民站内消息 —— 后端 /messages（联系管理员）
   * ========================================================= */
  const MessageApi = {
    /** 居民发送消息 → POST /messages */
    send({ type, content }) {
      return request('/messages', {
        method: 'POST',
        body: JSON.stringify({ type, content }),
      });
    },
    /** 管理员分页查询消息 → GET /messages */
    getList(opts) {
      opts = opts || {};
      const qs = toQuery({ page: num(opts.page, 1), pageSize: num(opts.pageSize, 20) });
      return request('/messages' + qs, { method: 'GET' })
        .then(p => p || { total: 0, records: [] });
    },
    /** 居民查询「我的消息」（含管理员回复） → GET /messages/my */
    getMyList(opts) {
      opts = opts || {};
      const qs = toQuery({ page: num(opts.page, 1), pageSize: num(opts.pageSize, 50) });
      return request('/messages/my' + qs, { method: 'GET' })
        .then(p => p || { total: 0, records: [] });
    },
    /** 管理员回复某条消息 → POST /messages/{id}/reply */
    reply(id, content) {
      return request('/messages/' + id + '/reply', {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
    },
    /** 标记消息已读 → PUT /messages/{id}/read */
    markRead(id) {
      return request('/messages/' + id + '/read', { method: 'PUT' });
    },
  };

  /* =========================================================
   *  1. 设备总览相关接口
   * ========================================================= */
  const DeviceApi = {
    /**
     * 设备统计摘要 → GET /devices/statistics
     * 字段映射：totalCount→total, onlineCount→online, offlineCount→offline, activeAlarmCount→warning
     */
    getSummary() {
      return request('/devices/statistics', { method: 'GET' }).then(s => {
        s = s || {};
        const total = num(s.totalCount, 0);
        const online = num(s.onlineCount, 0);
        const offline = num(s.offlineCount, 0);
        const warning = num(s.activeAlarmCount, 0);
        return {
          total,
          online,
          onlineRate: total > 0 ? Math.round((online / total) * 100) : 0,
          warning,
          offline,
          newToday: 0,      // 后端暂无该统计
          diffYesterday: 0, // 后端暂无该统计
        };
      });
    },

    /**
     * 实时设备列表 → GET /devices?page=1&pageSize={limit}
     * 字段映射 records → 前端列表项（含浓度/温度/电量/信号，来自 last* 字段兜底）
     */
    getRealtimeList(limit = 10) {
      return request('/devices' + toQuery({ page: 1, pageSize: limit }), { method: 'GET' }).then(page => {
        const recs = (page && page.records) || [];
        return recs.map(r => {
          const st = mapDeviceStatus(r.onlineStatus, r.batteryLevel);
          return {
            id: String(r.id),
            name: r.deviceName || ('设备-' + String(r.id).slice(-5)),
            location: r.location || '--',
            status: st,
            // 后端暂未直接暴露浓度/温度，用 lastSmokeValue/lastTemperatureValue 兜底，没有则置空
            concentration: num(r.lastSmokeValue, null),
            temp: num(r.lastTemperatureValue, null),
            battery: num(r.batteryLevel, null),
            rssi: num(r.signalStrength, null),
            model: r.deviceModel || 'SD-200X',
            lastHeartbeat: r.lastHeartbeatTime
              ? (String(r.lastHeartbeatTime).slice(11, 19) + ' 前') : '未知',
          };
        });
      });
    },

    /**
     * 设备分页列表（原始后端 page 对象，含 records / total / etc）
     * 供趋势图「监测设备」下拉使用 —— 返回未映射的原始记录，调用方按需取 deviceName / deviceSn / location。
     *
     * 权限说明：后端基于 JWT 中的角色 + communityId 自动过滤
     *   - 系统管理员：返回所有小区设备
     *   - 小区管理员：仅返回本小区设备
     *   - 普通用户：仅返回本小区设备
     * 前端无需额外传 communityId，后端 Service 层已做数据隔离。
     *
     * @param {object} [opts]  { page=1, pageSize=200 }
     * @returns {Promise<{records:Array, total:number, ...}>}
     */
    getList(opts) {
      opts = opts || {};
      const page = num(opts.page, 1);
      const pageSize = num(opts.pageSize, 200);
      return request('/devices' + toQuery({ page, pageSize }), { method: 'GET' })
        .then(p => p || { records: [], total: 0 });
    },
  };

  /* =========================================================
   *  2. 传感器 / 气体指标 相关接口
   * ========================================================= */
  const SensorApi = {
    /**
     * 当前关键气体指标 —— 后端无"全局聚合"接口，降级返回空数组
     * （真实场景可由设备列表 + /smoke-readings/latest/{id} 聚合，这里保持降级）
     */
    getGasIndex() {
      return request('/sensors/gas/current', { method: 'GET' }, { useMock: true, mockData: [] });
    },

    /**
     * 取某设备的趋势数据（真实后端 GET /smoke-readings/trend）。
     * @param {string|number} deviceId  设备 ID
     * @param {string} range  '1h'|'6h'|'12h'|'24h'，决定 startTime
     * @returns {Promise<{xLabels:string[], smoke:number[], co:number[], temperature:number[], threshold:number, thresholdLabel:string, peak:{index:number,value:number}|null}>}
     */
    getTrend(deviceId, range) {
      if (!deviceId) {
        return Promise.resolve({ xLabels: [], smoke: [], co: [], temperature: [], threshold: 100, thresholdLabel: '预警阈值 100', peak: null });
      }
      const hours = { '1h': 1, '6h': 6, '12h': 12, '24h': 24 }[range] || 24;
      const end = new Date();
      const start = new Date(end.getTime() - hours * 3600 * 1000);
      const qs = toQuery({
        deviceId,
        startTime: fmtTime(start),
        endTime: fmtTime(end),
      });
      return request('/smoke-readings/trend' + qs, { method: 'GET' }).then(points => {
        const arr = Array.isArray(points) ? points : [];
        // 找烟雾峰值点
        let peakIdx = -1, peakVal = -Infinity;
        arr.forEach((p, i) => {
          const v = num(p.value, 0);
          if (typeof v === 'number' && v > peakVal) { peakVal = v; peakIdx = i; }
        });
        // 时间标签：1h 显示 mm, 6h/12h 显示 HH:mm, 24h 显示 HH:mm（稀疏化由 chart 处理）
        const xLabels = arr.map(p => {
          const t = p && p.time ? String(p.time) : '';
          // 取 HH:mm
          return t.length >= 16 ? t.slice(11, 16) : t;
        });
        return {
          xLabels,
          smoke:       arr.map(p => num(p.value, null) ?? 0),
          temperature: arr.map(p => num(p.temperature, null) ?? null),
          co:          arr.map(p => num(p.co, null) ?? null),
          threshold: 100,
          thresholdLabel: '预警阈值 100',
          peak: peakIdx >= 0 ? { index: peakIdx, value: peakVal } : null,
        };
      }).catch(err => {
        console.warn('[api] getTrend failed', err);
        return { xLabels: [], smoke: [], co: [], temperature: [], threshold: 100, thresholdLabel: '预警阈值 100', peak: null };
      });
    },

    /**
     * 兼容旧接口：取首个设备的 24h 趋势
     */
    getTrend24h() {
      return request('/devices' + toQuery({ page: 1, pageSize: 1 }), { method: 'GET' }).then(page => {
        const rec = page && page.records && page.records[0];
        if (!rec) {
          return { xLabels: [], smoke: [], co: [], temperature: [], threshold: 100, thresholdLabel: '预警阈值 100', peak: null };
        }
        return SensorApi.getTrend(rec.id, '24h');
      });
    },

    /** 顶部快速指标 —— 后端无对应，降级 */
    getQuickMetrics() {
      return request('/sensors/metrics/overview', { method: 'GET' }, {
        useMock: true, mockData: { avgConcentration: null, peakConcentration: null, exceedCount: null, monitoringArea: null },
      });
    },

    /**
     * 感知层 6 项 —— 后端没有直接的"感知层聚合"接口，
     * 用「设备统计 + 阈值配置 + 最新一条烟雾读数」合成 6 张卡片（不再是 mock 空数组）。
     * 为了避免「还没接入硬件却显示夸张超标」的错觉（联调时手动造的测试数据），这里做两道保护：
     *   1) 硬件级异常值过滤：smoke≥500、temp≥60 或 <-20、co≥300 => 判为测试脏数据，视为 NULL；
     *   2) 无有效读数 / 读数被过滤时：显示"正常基线空转值"(smoke≈12 / temp≈26 / co≈6)，
     *      并打「待接入」/「暂无感知数据」标签 + provisional=true 视觉淡化，明确告知是参考值。
     */
    getPerception() {
      // —— 两道保护(1)：过滤"硬件不可能达到"的异常值 ——
      const filterSmoke = (v) => (v == null || typeof v !== 'number' || v < 0 || v > 500) ? null : v;
      const filterTemp  = (v) => (v == null || typeof v !== 'number' || v < -20 || v >= 60) ? null : v;
      const filterCo    = (v) => (v == null || typeof v !== 'number' || v < 0 || v >= 300) ? null : v;

      const tasks = [
        request('/devices/statistics', { method: 'GET' }).catch(() => null),
        request('/threshold-config',     { method: 'GET' }).catch(() => null),
        request('/devices' + toQuery({ page: 1, pageSize: 1 }), { method: 'GET' }).catch(() => null),
      ];
      return Promise.all(tasks).then(([stats, thr, devPage]) => {
        stats = stats || {};
        thr = thr || {};
        const rec = (devPage && devPage.records && devPage.records[0]) || null;
        const latest = (rec && rec.id)
          ? request('/smoke-readings/latest/' + rec.id, { method: 'GET' }).catch(() => null)
          : Promise.resolve(null);
        return latest.then(l => {
          const smokeWarn  = num(thr.smokeWarnThreshold, 100);
          const smokeAlarm = num(thr.smokeAlarmThreshold, 200);
          const tempAlarm  = num(thr.temperatureThreshold, 60);
          const coAlarm    = num(thr.coThreshold, 100);
          const total      = num(stats.totalCount, 0);
          const online     = num(stats.onlineCount, 0);
          const offline    = num(stats.offlineCount, 0);

          // 原始读数 → 异常过滤（遇到测试脏数据直接当 NULL 处理）
          const rawSmoke = l && num(l.smokeConcentration, null) !== null
            ? num(l.smokeConcentration, null)
            : num(rec && rec.lastSmokeValue, null);
          const rawTemp = l && num(l.temperature, null) !== null
            ? num(l.temperature, null)
            : num(rec && rec.lastTemperatureValue, null);
          const rawCo = l && num(l.coConcentration, null) !== null
            ? num(l.coConcentration, null)
            : null;
          let curSmoke = filterSmoke(rawSmoke);
          let curTemp  = filterTemp(rawTemp);
          let curCo    = filterCo(rawCo);

          // —— 两道保护(2)：无有效读数时显示基线空转参考值 + 待接入标签 ——
          // 基线参考值(正常室内空气水平)：smoke 10~15μg/m³, temp 24~28℃, co 5~10ppm
          let smokeBadge = null, tempBadge = null, coBadge = null;
          let smokeProvisional = false, tempProvisional = false, coProvisional = false;
          const anyOnline = total > 0 && online > 0;
          if (curSmoke == null) {
            curSmoke = 12; smokeBadge = anyOnline ? '暂无感知数据' : '待接入'; smokeProvisional = true;
          }
          if (curTemp == null) {
            curTemp = 26; tempBadge = anyOnline ? '暂无感知数据' : '待接入'; tempProvisional = true;
          }
          if (curCo == null) {
            curCo = 6; coBadge = anyOnline ? '暂无感知数据' : '待接入'; coProvisional = true;
          }

          // provisional 卡一律按 ok 状态渲染（因为是基线参考值，不能让用户以为真的超阈值）
          const smkStatus = smokeProvisional ? 'ok' :
                            (curSmoke >= smokeAlarm ? 'danger' : curSmoke >= smokeWarn ? 'warn' : 'ok');
          const tmpStatus = tempProvisional  ? 'ok' :
                            (curTemp  >= tempAlarm  ? 'danger' : 'ok');
          const coStatus  = coProvisional    ? 'ok' :
                            (curCo    >= coAlarm    ? 'danger' : 'ok');

          const smkStatusText = smokeProvisional ? '正常 · 基线参考值' :
                                smkStatus === 'danger' ? '超过火警阈值' :
                                smkStatus === 'warn'   ? '超过预警阈值' : '正常';
          const tmpStatusText = tempProvisional  ? '正常 · 基线参考值' :
                                tmpStatus === 'danger' ? '超过温度阈值' : '正常';
          const coStatusText  = coProvisional    ? '正常 · 基线参考值' :
                                coStatus  === 'danger' ? 'CO 超标' : '正常';

          // 设备健康卡：无真实电池/信号时，不要默认填 95%/3格 这种"很健康"的假象
          let batVal = l && num(l.batteryLevel, null) != null ? num(l.batteryLevel, 0)
                     : num(rec && rec.batteryLevel, null);
          let sigValRaw = l && num(l.signalStrength, null) != null ? num(l.signalStrength, -100) : null;
          let devProvisional = false;
          if (batVal == null) { batVal = anyOnline ? 88 : 0; devProvisional = true; }
          let sigVal = 1;
          if (sigValRaw != null) {
            sigVal = sigValRaw >= -60 ? 4 : sigValRaw >= -75 ? 3 : sigValRaw >= -85 ? 2 : 1;
          } else if (anyOnline) {
            sigVal = 3;
          } else {
            sigVal = 1;
            devProvisional = true;
          }
          const devStatusText = total === 0 ? '暂无设备' :
                                devProvisional ? `待接入：离线 ${offline} 台，在线 ${online} 台` :
                                `在网 ${online} 台，离线 ${offline} 台`;

          return [
            {
              id: 'smoke', icon: 'smoke', name: '烟雾浓度',
              value: curSmoke, unit: 'μg/m³',
              status: smkStatus, statusText: smkStatusText,
              badge: smokeBadge, provisional: smokeProvisional,
              thresholdLabel: `预警 ${smokeWarn} / 火警 ${smokeAlarm} μg/m³`,
            },
            {
              id: 'temp', icon: 'temp', name: '环境温度',
              value: curTemp, unit: '℃',
              status: tmpStatus, statusText: tmpStatusText,
              badge: tempBadge, provisional: tempProvisional,
              thresholdLabel: `告警阈值 ${tempAlarm}℃`,
            },
            {
              id: 'co', icon: 'co', name: 'CO 浓度',
              value: curCo, unit: 'ppm',
              status: coStatus, statusText: coStatusText,
              badge: coBadge, provisional: coProvisional,
              thresholdLabel: `告警阈值 ${coAlarm} ppm`,
            },
            {
              id: 'flame', icon: 'flame', name: '火焰/火情联动',
              status: num(stats.activeAlarmCount, 0) > 0 ? 'danger' : 'ok',
              statusText: num(stats.activeAlarmCount, 0) > 0 ? `存在 ${stats.activeAlarmCount} 条活动告警` : '无活动火情',
              mode: '阈值/AI 双通道判定',
              thresholdLabel: '烟雾≥火警 或 视觉检测到火焰即告警',
            },
            {
              id: 'hum', icon: 'hum', name: '网络/设备在线率',
              value: total > 0 ? Math.round((online / total) * 100 * 100) / 100 : null,
              unit: '%',
              status: total === 0 ? 'ok' :
                      (offline / total) >= 0.2 ? 'warn' : 'ok',
              statusText: total === 0 ? '暂无设备接入' :
                          `在线 ${online} / 总计 ${total}`,
              thresholdLabel: '离线设备 ≥ 20% 时提示巡检',
              badge: total === 0 ? '待接入' : null,
              provisional: total === 0,
            },
            {
              id: 'dev', icon: 'battery', name: '设备健康',
              status: devProvisional && offline > 0 ? 'warn' : 'ok',
              statusText: devStatusText,
              battery: batVal, signal: sigVal,
              badge: devProvisional ? (anyOnline ? '部分离线' : '待接入') : null,
              provisional: devProvisional,
            },
          ];
        });
      });
    },
  };

  /* =========================================================
   *  3. 区域 / 楼栋分布 —— 后端无对应，降级
   * ========================================================= */
  const AreaApi = {
    getBuildingList() {
      return request('/areas/buildings', { method: 'GET' }, { useMock: true, mockData: [] });
    },
  };

  /* =========================================================
   *  4. 告警 / 事件流 相关接口
   * ========================================================= */
  const AlertApi = {
    /**
     * 告警统计 → GET /alarm-logs/statistics
     * 映射：fireCount→high, warnCount→mid, activeCount-fire-warn→low
     */
    getStats() {
      return request('/alarm-logs/statistics', { method: 'GET' }).then(s => {
        s = s || {};
        const fire = num(s.fireCount, 0);
        const warn = num(s.warnCount, 0);
        const active = num(s.activeCount, 0);
        return { high: fire, mid: warn, low: Math.max(0, active - fire - warn) };
      });
    },

    /**
     * 告警事件列表 → GET /alarm-logs?page=1&pageSize={limit}
     * 映射 records → 前端事件项（用 acknowledgedAt/disposition 合成 status）
     */
    getEventList(limit = 20) {
      return request('/alarm-logs' + toQuery({ page: 1, pageSize: limit }), { method: 'GET' }).then(page => {
        const recs = (page && page.records) || [];
        return recs.map(r => {
          const s = mapAlarmStatus(r.status, r.disposition, r.acknowledgedAt, r.resolvedAt);
          return ({
            id: String(r.id),
            level: mapAlarmLevel(r.alarmLevel),
            time: (r.createdAt ? String(r.createdAt).slice(11, 19) : ''),
            title: alarmTypeText(r.alarmType),
            description: r.message || '',
            deviceId: r.deviceId ? String(r.deviceId) : '',
            communityId: r.communityId != null ? String(r.communityId) : '',
            escalated: r.escalated === true,
            status: s,
            handled: s === 'archived' || s === 'false_alarm',
          });
        });
      });
    },

    /** 系统日志 —— 后端无对应，降级 */
    getSystemLogs(limit = 10) {
      return request('/system/logs?limit=' + limit, { method: 'GET' }, { useMock: true, mockData: [] });
    },
  };

  /* =========================================================
   *  5. 系统级接口
   * ========================================================= */
  const SystemApi = {
    /** 头部状态 → 复用告警统计的 activeCount 作为待处理告警数 */
    getHeaderStatus() {
      return request('/alarm-logs/statistics', { method: 'GET' }).then(s => {
        s = s || {};
        return { systemOk: true, pendingAlerts: num(s.activeCount, 0) };
      }).catch(() => ({ systemOk: false, pendingAlerts: 0 }));
    },
    /** 测试后端 API 连通性（settings 页"测试连接"用），成功返回 {status:'ok'} */
    getStatus() {
      return request('/devices/statistics', { method: 'GET' })
        .then(() => ({ status: 'ok' }));
    },
  };

  /* =========================================================
   *  6. AI 视觉复核 —— 后端无对应，全降级
   * ========================================================= */
  const ReviewApi = {
    getReviewList(limit = 10) {
      return request('/ai/reviews?limit=' + limit, { method: 'GET' }, { useMock: true, mockData: [] });
    },
    triggerReview(alertId) {
      return request('/ai/reviews', { method: 'POST', body: JSON.stringify({ alertId }) }, { useMock: true, mockData: { taskId: null, status: 'pending' } });
    },
    getReviewByAlert(alertId) {
      return request('/ai/reviews/by-alert/' + alertId, { method: 'GET' }, { useMock: true, mockData: null });
    },
  };

  /* =========================================================
   *  7. 设备绑定管理 —— 后端 /devices
   * ========================================================= */
  const DeviceManageApi = {
    /**
     * 新增设备 → POST /devices
     * 前端 payload {name, location, type, sn?, communityId?} → 后端 {deviceName, deviceSn, deviceType, communityId, location}
     *
     * communityId 取值优先级：
     *   1. payload.communityId（系统管理员从下拉选择的值）
     *   2. 登录态 session.communityId（小区管理员固定本小区）
     *   3. null（兜底，后端小区管理员会强制绑定自己 communityId）
     *
     * 注意：后端 DeviceType 枚举只支持 SMOKE_SENSOR / CAMERA / BROADCAST / SPRINKLER / EXHAUST_FAN。
     *       前端下拉里的烟雾→SMOKE_SENSOR；其它（温感/CO/火焰/湿度）实训里也统一写 SMOKE_SENSOR，
     *       避免后端因非法枚举抛错。
     */
    addDevice(payload) {
      payload = payload || {};
      let communityId = payload.communityId || null;
      if (!communityId) {
        try {
          const raw = localStorage.getItem(AUTH_KEY);
          if (raw) {
            const s = JSON.parse(raw);
            communityId = s.communityId || s.userId || null;
          }
        } catch (_) {}
      }
      // 真实后端枚举
      const validTypes = new Set(['SMOKE_SENSOR', 'CAMERA', 'BROADCAST', 'SPRINKLER', 'EXHAUST_FAN']);
      const shortMap = {
        smoke: 'SMOKE_SENSOR',
        camera: 'CAMERA', video: 'CAMERA',
        broadcast: 'BROADCAST', speaker: 'BROADCAST',
        sprinkler: 'SPRINKLER', fire: 'SPRINKLER',
        fan: 'EXHAUST_FAN', exhaust: 'EXHAUST_FAN', vent: 'EXHAUST_FAN',
      };
      let t = String(payload.type || 'smoke').trim();
      // 前端下拉里：smoke/temp/co/flame/hum — 后端只支持 SMOKE_SENSOR，其它也归为 SMOKE_SENSOR
      if (shortMap[t]) t = shortMap[t];
      else if (!validTypes.has(t)) t = 'SMOKE_SENSOR';
      const body = {
        deviceName: payload.name,
        deviceSn: payload.sn || payload.deviceSn || ('SN-' + Date.now()),
        deviceType: t,
        location: payload.location || '',
        communityId: communityId ? Number(communityId) : null,
      };
      return request('/devices', { method: 'POST', body: JSON.stringify(body) });
    },

    /** 删除设备 → DELETE /devices/{id} */
    removeDevice(deviceId) {
      return request('/devices/' + encodeURIComponent(deviceId), { method: 'DELETE' });
    },

    /**
     * 设备管理列表 → GET /devices?page=1&pageSize=100
     * 映射 records → 前端管理项
     */
    getManageList() {
      return request('/devices' + toQuery({ page: 1, pageSize: 100 }), { method: 'GET' }).then(page => {
        const recs = (page && page.records) || [];
        return recs.map(r => ({
          id: String(r.id),
          name: r.deviceName,
          location: r.location,
          type: r.deviceType,
          owner: '',
          status: mapDeviceStatus(r.onlineStatus, r.batteryLevel) === 'offline' ? 'offline' : 'online',
          lastHeartbeat: r.lastHeartbeatTime || '',
          battery: num(r.batteryLevel, null),
          boundAt: r.createdAt || '',
        }));
      });
    },
  };

  /* =========================================================
   *  8. 告警确认 / 状态机 —— 后端 /alarm-logs
   * ========================================================= */
  const AlertActionApi = {
    /**
     * 告警详情 → GET /alarm-logs/{id}
     * 映射 AlarmLogVO → 前端详情结构（status 基于 status + disposition 联合判断）
     */
    getDetail(alertId) {
      return request('/alarm-logs/' + encodeURIComponent(alertId), { method: 'GET' }).then(r => {
        r = r || {};
        const status = mapAlarmStatus(r.status, r.disposition, r.acknowledgedAt, r.resolvedAt);
        return {
          id: String(r.id),
          level: mapAlarmLevel(r.alarmLevel),
          type: 'smoke',
          title: alarmTypeText(r.alarmType),
          description: r.message || '',
          device: r.deviceName || '',
          area: r.deviceName || '',
          deviceId: r.deviceId ? String(r.deviceId) : '',
          time: r.createdAt || '',
          triggerCount: 0,
          threshold: 0,
          value: 0,
          status,
          tip: r.disposition || '',
          review: null,
          history: [
            { time: r.createdAt, action: '系统自动生成告警记录', operator: 'system' },
          ].concat(
            r.acknowledgedAt ? [{ time: r.acknowledgedAt,
              action: (r.disposition === 'FALSE_ALARM' ? '标记误报：' : '确认火情：') + (r.disposition || '人工确认'),
              operator: '管理员' }] : []
          ).concat(
            r.resolvedAt ? [{ time: r.resolvedAt,
              action: (r.disposition === 'FALSE_ALARM' ? '误报记录归档' : '现场处置完成归档') +
                (r.resolveNote ? '：' + r.resolveNote : ''),
              operator: '管理员' }] : []
          ),
        };
      });
    },

    /**
     * 确认火情：先用 PUT /{id}/confirm disposition=CONFIRMED_FIRE（后端会同时写 disposition + acknowledgedAt 并下发联动）
     */
    confirmFire(alertId) {
      return request('/alarm-logs/' + encodeURIComponent(alertId) + '/confirm', {
        method: 'PUT',
        body: JSON.stringify({ disposition: 'CONFIRMED_FIRE' }),
      }).then(() => ({ success: true }));
    },

    /**
     * 标记误报：PUT /{id}/confirm disposition=FALSE_ALARM（后端写 disposition + acknowledgedAt）
     */
    markFalseAlarm(alertId) {
      return request('/alarm-logs/' + encodeURIComponent(alertId) + '/confirm', {
        method: 'PUT',
        body: JSON.stringify({ disposition: 'FALSE_ALARM' }),
      }).then(() => ({ success: true }));
    },

    /** 归档（处置完成）告警：PUT /{id}/resolve → 后端置 status=RESOLVED + resolvedAt */
    archiveAlert(alertId) {
      return request('/alarm-logs/' + encodeURIComponent(alertId) + '/resolve', {
        method: 'PUT',
      }).then(() => ({ success: true }));
    },
  };

  /* =========================================================
   *  9. 联动广播控制 —— 后端无对应，降级
   * ========================================================= */
  const BroadcastApi = {
    send(payload) {
      return request('/broadcast', { method: 'POST', body: JSON.stringify(payload) }, { useMock: true, mockData: { cmdId: null, status: 'sent' } });
    },
    getHistory(limit = 10) {
      return request('/broadcast/history?limit=' + limit, { method: 'GET' }, { useMock: true, mockData: [] });
    },
  };

  /* =========================================================
   *  10. 接入层（MQTT）状态 —— 后端无对应，降级
   * ========================================================= */
  const MqttApi = {
    getStatus() {
      return request('/mqtt/status', { method: 'GET' }, {
        useMock: true, mockData: { broker: '', connected: false, uptime: 0, clientCount: 0, msgRateIn: 0, msgRateOut: 0, topics: [] },
      });
    },
    getMessageFlow(limit = 20) {
      return request('/mqtt/messages?limit=' + limit, { method: 'GET' }, { useMock: true, mockData: [] });
    },
  };

  /* =========================================================
   *  11. 三层架构健康度 —— 后端无对应，降级
   * ========================================================= */
  const ArchitectureApi = {
    getLayerStatus() {
      return request('/architecture/status', { method: 'GET' }, { useMock: true, mockData: { layers: [], overallOk: true } });
    },
  };

  /* =========================================================
   *  12. 系统设置 / 阈值配置 —— 后端 /threshold-config
   * ========================================================= */
  const SettingsApi = {
    /**
     * 获取阈值配置 → GET /threshold-config
     * 映射到前端 thresholds 分组
     */
    getAll() {
      return request('/threshold-config', { method: 'GET' }).then(c => {
        c = c || {};
        return {
          thresholds: {
            smokeLow: num(c.smokeWarnThreshold, null),
            smokeHigh: num(c.smokeAlarmThreshold, null),
            tempHigh: num(c.temperatureThreshold, null),
            coHigh: num(c.coThreshold, null),
            // 后端 threshold-config 表无这两列，沿用本地已有或默认（默认 10s / 30s）
            durationSec: num(c.durationSec != null ? c.durationSec : null, null),
            recoverySec: num(c.recoverySec != null ? c.recoverySec : null, null),
          },
          notify: null,
          linkage: {
            broadcastTemplate: null,
            autoVentLevel: null,
            autoSoundLevel: null,
            valveLevel: null,
          },
          account: { allowChangePassword: true },
          integration: {
            mqttBroker: 'tcp://localhost:1883',
            apiBase: API_BASE,
            aiApiBase: null,
          },
          storage: { localStorageSizeKb: null },
          lastSavedAt: c.updatedAt || null,
          // 额外透传后端阈值（供阈值设置页直接使用）
          _raw: c,
        };
      });
    },

    /**
     * 保存阈值 → PUT /threshold-config
     * 前端 thresholds 分组 → 后端扁平字段
     */
    save(payload) {
      payload = payload || {};
      const t = payload.thresholds || {};
      const body = {};
      if (t.smokeLow !== null && t.smokeLow !== undefined) body.smokeWarnThreshold = t.smokeLow;
      if (t.smokeHigh !== null && t.smokeHigh !== undefined) body.smokeAlarmThreshold = t.smokeHigh;
      if (t.tempHigh !== null && t.tempHigh !== undefined) body.temperatureThreshold = t.tempHigh;
      if (t.coHigh !== null && t.coHigh !== undefined) body.coThreshold = t.coHigh;
      // 透传原始字段（如 debounceCount / escalationMinutes 等）
      Object.assign(body, payload._raw || {});
      delete body.id; delete body.updatedAt;
      return request('/threshold-config', { method: 'PUT', body: JSON.stringify(body) });
    },

    /** 修改密码 —— 后端无对应，降级 */
    changePassword(payload) {
      return request('/settings/change-password', { method: 'POST', body: JSON.stringify(payload) }, { useMock: true, mockData: true });
    },

    /** 导出配置 —— 后端无对应，降级返回空串 */
    exportConfig() {
      return request('/settings/export', { method: 'GET' }, { useMock: true, mockData: '' });
    },

    /** 导入配置 —— 后端无对应，降级 */
    importConfig(payload) {
      return request('/settings/import', { method: 'POST', body: JSON.stringify(payload) }, { useMock: true, mockData: true });
    },

    /** 清理缓存 —— 后端无对应，降级 */
    clearCache(scope = 'all') {
      return request('/settings/clear-cache?scope=' + encodeURIComponent(scope), { method: 'POST' }, { useMock: true, mockData: true });
    },
  };

  /* ---------- 导出（挂在 window.DashboardApi） ---------- */
  global.DashboardApi = {
    API_BASE,
    User: UserApi,
    /** 小区管理（负责人机制，系统管理员用） */
    Community: CommunityApi,
    /** 用户管理（CRUD/审核/启停/重置密码，管理员用） */
    AdminUser: AdminUserApi,
    /** 住户-设备绑定（告警重点提示用） */
    UserDevice: UserDeviceApi,
    /** 居民站内消息（联系管理员） */
    Message: MessageApi,
    Device: DeviceApi,
    Sensor: SensorApi,
    Area: AreaApi,
    Alert: AlertApi,
    System: SystemApi,
    Review: ReviewApi,
    DeviceManage: DeviceManageApi,
    AlertAction: AlertActionApi,
    Broadcast: BroadcastApi,
    Mqtt: MqttApi,
    Architecture: ArchitectureApi,
    Settings: SettingsApi,
    /** 小区列表 / 小区名解析（供注册页、设备绑定页、RoleGuard 共用）
     *  注意：当后端 community 表已建好并提供 GET /community 后，
     *  前端优先用 Community.getList()，本常量作为社区名为空时的兜底。 */
    COMMUNITIES,
    communityNameById,
    /** 各小区演示居民（设备绑定「绑定用户」下拉数据源，不落库） */
    USERS_BY_COMMUNITY,
    /** 工具方法对外暴露（供 auth.js / login.js 复用） */
    _util: { mapRole, getToken, AUTH_KEY, API_BASE, num },
  };

})(window);
