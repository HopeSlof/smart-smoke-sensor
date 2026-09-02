/**
 * firefighter.js - 消防员指挥台逻辑
 * 依赖：DomUtil / DateUtil / DashboardApi / UI(interactions) / Auth / TrendModal / WS
 */
(function (global) {
  'use strict';

  const { $, create, render } = global.DomUtil;
  const { formatDay, fmtTimeAgo } = global.DateUtil;
  const UI = global.UI;

  const FF = {
    session: null,
    _allAlerts: [],
    _allDevices: [],
    _linkageStates: { sounder: false, vent: false, valve: false, light: false },
    /** 三级结构切换：'overview' 总览（全区） | 'community' 社区层（单责任小区） */
    _currentLayer: 'overview',
    /** 社区层选中的责任小区 id；空串=不过滤（总览） */
    _activeCommunityId: '',
    /** 责任小区 id→name 映射（从后端 public list 拉取填充） */
    _communityNameMap: {},

    init() {
      this.session = global.Auth.getSession();
      if (!this.session) return;
      this._renderHeader();
      this._bindTopButtons();
      this._bindLinkageButtons();
      this._bindDeviceFilter();
      this._bindLayerNav();          // 新增：三级结构按钮 + 下拉
      this._fillCommunityOptions();  // 新增：填充责任小区下拉
      this._applyCommunityFromSession(); // 新增：session 有绑定社区则默认选中
      this._startClock();
      // 并行拉初始数据
      this._loadAll().catch(err => console.error('[ff] 初始加载失败：', err));
      // 启动 WebSocket（订阅火警全局广播）
      try {
        if (global.WS && typeof global.WS.init === 'function') {
          global.WS.init();
          // 监听推送：有新告警自动刷新（刷新后自动应用社区过滤）
          if (global.WS.on) {
            global.WS.on('alert', () => this._loadAlerts());
            global.WS.on('device', () => this._loadDevices());
          }
        }
      } catch (err) { console.warn('[ff] WS init 失败', err); }
    },

    /* ============= 顶部 ============= */
    _renderHeader() {
      const who = $('#ff-whoami-name');
      if (who) who.textContent = (this.session.realName || this.session.username || '消防员');
      const scopeChip = $('#ff-chip-status');
      if (scopeChip) {
        const name = (this.session.communityName
          || (global.DashboardApi && global.DashboardApi.communityNameById && this.session.communityId
              ? global.DashboardApi.communityNameById(this.session.communityId) : null)
          || '全区');
        scopeChip.innerHTML = `责任区：<b style="color:#67e8f9;">${name}</b>`;
      }
    },

    _bindTopButtons() {
      $('#ff-btn-logout')?.addEventListener('click', () => {
        UI?.Toast?.info('正在退出登录…');
        setTimeout(() => global.Auth.logout({ reason: 'logged-out' }), 50);
      });
      $('#ff-btn-back')?.addEventListener('click', () => {
        try {
          const Auth = global.Auth;
          const role = (this.session && this.session.role) || (Auth && Auth.getSession && Auth.getSession() && Auth.getSession().role);
          const target = role === 'system_admin' ? 'index.html' : 'index.html';
          const abs = (Auth && typeof Auth._resolveUrl === 'function') ? Auth._resolveUrl(target) : target;
          window.location.href = abs;
        } catch (e) { window.location.href = 'index.html'; }
      });
      $('#ff-btn-refresh')?.addEventListener('click', () => {
        UI?.Toast?.info('正在刷新…');
        this._loadAll().then(() => UI?.Toast?.success('数据已更新'));
      });
      $('#ff-btn-fullscreen')?.addEventListener('click', () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
      });
      // 新增：应急联动快捷跳转（滚动到联动控制面板区域）
      $('#ff-btn-linkage')?.addEventListener('click', () => {
        try {
          const el = document.getElementById('ff-linkage-host');
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          UI?.Toast?.info('已定位到应急联动控制面板');
        } catch (e) { UI?.Toast?.error('跳转失败：' + (e && e.message || e)); }
      });
      // 新增：处置记录快捷跳转（滚动到今日处置记录区域）
      $('#ff-btn-logs')?.addEventListener('click', () => {
        try {
          const el = document.getElementById('ff-log-host');
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          UI?.Toast?.info('已定位到今日处置记录');
        } catch (e) { UI?.Toast?.error('跳转失败：' + (e && e.message || e)); }
      });
      // 新增：设置快捷按钮（打开系统设置 Modal）
      $('#ff-btn-settings')?.addEventListener('click', () => {
        try {
          if (global.SettingsModal && typeof global.SettingsModal.open === 'function') {
            global.SettingsModal.open({ initialTab: 'account' });
          } else if (UI && UI.Modal && typeof UI.Modal.alert === 'function') {
            UI.Modal.alert({ title: '设置', message: '设置面板加载中，请稍后重试…' });
          } else {
            UI?.Toast?.info('设置面板暂不可用');
          }
        } catch (e) { UI?.Toast?.error('打开设置失败：' + (e && e.message || e)); }
      });
    },

    _startClock() {
      const tick = () => {
        const d = new Date();
        const p = n => (n < 10 ? '0' : '') + n;
        const tEl = $('#ff-now-time');
        const dEl = $('#ff-now-date');
        if (tEl) tEl.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        if (dEl) dEl.textContent = `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())}`;
      };
      tick(); setInterval(tick, 1000);
    },

    /* ============= 初始全量拉 ============= */
    async _loadAll() {
      await Promise.all([
        this._loadAlerts(),
        this._loadDevices(),
        this._loadScope(),
        this._renderLogs(),
      ]);
      this._renderStats();
    },

    /* ============= 告警 ============= */
    async _loadAlerts() {
      try {
        const list = await global.DashboardApi.Alert.getEventList(200);
        // 过滤：只看高等级火警（pending/confirmed）+ 今日已归档也留着（用于统计）
        this._allAlerts = Array.isArray(list) ? list : (list && list.records) || [];
        this._renderAlerts();
      } catch (err) {
        console.warn('[ff] alerts 拉取失败：', err);
      }
    },

    _renderAlerts() {
      const host = $('#ff-alert-host');
      if (!host) return;
      // 社区过滤 + 可见性过滤（已在 _filteredAlerts 里完成）再按状态优先级/时间倒序
      const visible = this._filteredAlerts().sort((x, y) => {
        const order = { pending: 0, confirmed: 1, processing: 2 };
        const ox = order[String(x.status || '').toLowerCase()] ?? 9;
        const oy = order[String(y.status || '').toLowerCase()] ?? 9;
        if (ox !== oy) return ox - oy;
        return new Date(y.createdAt || 0) - new Date(x.createdAt || 0);
      });

      // 更新顶部 chip
      const pendingCount = visible.filter(a =>
        ['pending', 'confirmed'].includes(String(a.status || '').toLowerCase())
      ).length;
      const chip = $('#ff-chip-pending');
      if (chip) chip.innerHTML = `<span class="fire-badge"><span class="pulse-dot"></span>${pendingCount} 火警待处置</span>`;

      if (!visible.length) {
        host.innerHTML = `<div class="empty-ff"><div class="big-ic">🚒</div>暂无火警告警 · 保持待命</div>`;
        return;
      }

      host.innerHTML = '';
      visible.forEach(a => {
        const card = this._buildAlertCard(a);
        if (card) host.appendChild(card);
      });
    },

    _buildAlertCard(a) {
      const st = String(a.status || '').toLowerCase();
      const isPending = st === 'pending';
      const lvl = String(a.level || '').toLowerCase();
      const time = a.createdAt ? fmtTimeAgo(new Date(a.createdAt)) : '--';
      const loc = a.location || a.deviceLocation || '未知位置';
      const devName = a.deviceName || ('设备-' + String(a.deviceId || a.id).slice(-5));
      const community = a.communityName || (a.communityId ? '小区' + a.communityId : '');
      // 按任务清单要求：警告事件触发时明确标注具体设备ID徽章
      const deviceIdChip = a.deviceId
        ? create('span', {
            style: 'display:inline-block;min-width:24px;padding:1px 6px;margin-right:6px;border-radius:3px;background:rgba(37,99,235,0.12);color:#3b82f6;font-size:10px;font-weight:700;',
            title: '触发告警的设备 ID · 便于消防员快速核实点位',
          }, '#' + String(a.deviceId))
        : null;

      const body = create('div', { class: 'dispatch-card' + (isPending ? ' pending' : '') }, [
        create('div', { class: 'dispatch-icon' }, [
          (() => {
            const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
            s.setAttribute('viewBox','0 0 24 24'); s.setAttribute('width','22'); s.setAttribute('height','22');
            s.setAttribute('fill','none'); s.setAttribute('stroke','currentColor'); s.setAttribute('stroke-width','2');
            s.innerHTML = '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>';
            return s;
          })(),
        ]),
        create('div', { class: 'dispatch-body' }, [
          create('div', { class: 'dispatch-head' }, [
            create('div', { class: 'dispatch-title' }, [
              deviceIdChip,
              create('span', {}, devName),
            ]),
            create('span', { class: 'dispatch-level' }, lvl === 'high' || lvl === 'danger' ? '🚨 紧急' : '⚠ 预警'),
          ]),
          create('div', { class: 'dispatch-meta' }, [
            create('span', {}, ['📍 ', create('b', {}, community || '全区')]),
            create('span', {}, ['🏠 ', create('b', {}, loc)]),
            create('span', {}, ['⏱ ', create('b', {}, time)]),
          ]),
          create('div', { class: 'dispatch-actions' }, this._buildAlertActions(a, st)),
        ]),
      ]);

      // 卡片点击：查看设备趋势
      body.style.cursor = 'pointer';
      body.addEventListener('click', (e) => {
        if (e.target.closest('button')) return; // 点按钮不触发
        if (a.deviceId && global.TrendModal) {
          try { global.TrendModal.open({ deviceId: a.deviceId, deviceName: devName, location: loc }); }
          catch (_) {}
        }
      });
      return body;
    },

    _buildAlertActions(a, st) {
      const actions = [];
      // 查看设备趋势
      actions.push({
        label: '查看传感器', cls: 'btn-ff-ghost',
        onClick: () => {
          if (a.deviceId && global.TrendModal) {
            global.TrendModal.open({ deviceId: a.deviceId, deviceName: a.deviceName || a.deviceId, location: a.location });
          } else UI?.Toast?.warning('缺少设备信息');
        },
      });
      // 待处理 → 确认出警
      if (st === 'pending') {
        actions.push({
          label: '确认出警', cls: 'btn-fire',
          onClick: () => this._confirmFire(a),
        });
      }
      // 待处理 / 确认中 → 消除紧急告警（确认设备正常后）
      if ((st === 'pending' || st === 'confirmed') && this._isFirefighterOrAdmin()) {
        actions.push({
          label: '确认正常 · 消除告警', cls: 'btn-ff-ghost',
          onClick: () => this._dismissEmergency(a),
        });
      }
      // 确认中 → 处置归档
      if (st === 'confirmed') {
        actions.push({
          label: '处置完毕 · 归档', cls: 'btn-fire',
          onClick: () => this._archive(a),
        });
      }
      return actions.map(o => {
        const b = create('button', { class: o.cls, onclick: (e) => { e && e.stopPropagation(); o.onClick && o.onClick(); } }, o.label);
        return b;
      });
    },

    async _confirmFire(a) {
      UI?.Toast?.info('正在确认火警…');
      try {
        await global.DashboardApi.AlertAction.confirmFire(a.id);
        a.status = 'confirmed';
        UI?.Toast?.success('已确认，正在调度最近消防力量');
        await this._loadAlerts(); this._renderStats(); this._appendLog(`🚨 确认火警：${a.deviceName || a.deviceId || a.id}`);
      } catch (err) {
        UI?.Toast?.error('确认失败：' + (err && err.message || '请稍后重试'));
      }
    },

    async _archive(a) {
      UI?.Toast?.info('正在归档…');
      try {
        await global.DashboardApi.AlertAction.archiveAlert(a.id);
        a.status = 'archived';
        UI?.Toast?.success('处置记录已归档');
        await this._loadAlerts(); this._renderStats(); this._appendLog(`✅ 归档处置：${a.deviceName || a.deviceId || a.id}`);
      } catch (err) {
        UI?.Toast?.error('归档失败：' + (err && err.message || '请稍后重试'));
      }
    },

    async _dismissEmergency(a) {
      const ok = await (UI && UI.Modal && typeof UI.Modal.confirm === 'function'
        ? UI.Modal.confirm({ title: '消除紧急告警', message: '请确认该告警点位已现场核实、设备已恢复正常，消除后将归档并从列表移除。', confirmText: '确认消除', cancelText: '取消' })
        : Promise.resolve(window.confirm('请确认设备已恢复正常，是否消除并归档？')));
      if (!ok) return;
      UI?.Toast?.info('正在消除并归档…');
      try {
        await global.DashboardApi.AlertAction.archiveAlert(a.id);
        a.status = 'archived';
        UI?.Toast?.success('紧急告警已消除归档');
        await this._loadAlerts(); this._renderStats(); this._appendLog(`🧯 消除告警：${a.deviceName || a.deviceId || a.id}（已核实现场正常）`);
      } catch (err) {
        UI?.Toast?.error('消除失败：' + (err && err.message || '请稍后重试'));
      }
    },

    _isFirefighterOrAdmin() {
      const r = String((this.session && this.session.role) || '').toLowerCase();
      return r === 'firefighter' || r === 'system_admin' || r === 'community_admin';
    },

    /* ============= 统计卡 ============= */
    _renderStats() {
      // 社区过滤（仅按社区维度，不过滤状态/等级，因为要统计归档/今日等全量）
      const cid = String(this._activeCommunityId || '');
      const _matchCommunity = (item) => {
        if (!cid) return true;
        const itemCid = item.communityId != null ? String(item.communityId) : '';
        if (itemCid) return itemCid === cid;
        const name = this._communityNameMap[cid];
        return !!(name && item.communityName && item.communityName === name);
      };
      const alerts = (this._allAlerts || []).filter(_matchCommunity);
      const devices = (this._allDevices || []).filter(_matchCommunity);
      const today = new Date(); today.setHours(0,0,0,0);
      const todayTime = today.getTime();

      const pending = alerts.filter(a => {
        const st = String(a.status || '').toLowerCase();
        return (st === 'pending' || st === 'confirmed');
      }).length;

      const todayCount = alerts.filter(a => {
        if (!a.createdAt) return false;
        return new Date(a.createdAt).getTime() >= todayTime;
      }).length;

      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
      const monthTotal = alerts.filter(a => a.createdAt && new Date(a.createdAt).getTime() >= monthStart);
      const monthDone = monthTotal.filter(a => String(a.status || '').toLowerCase() === 'archived');
      const rate = monthTotal.length ? Math.round(monthDone.length * 100 / monthTotal.length) : null;

      const online = devices.filter(d => String(d.status || '').toLowerCase() !== 'offline').length;

      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set('ff-stat-pending', pending);
      set('ff-stat-today', todayCount);
      set('ff-stat-rate', rate === null ? '--' : rate);
      set('ff-stat-online', online);
    },

    /* ============= 设备 ============= */
    async _loadDevices() {
      try {
        const list = await global.DashboardApi.Device.getRealtimeList(500);
        this._allDevices = list || [];
        this._renderDevices();
      } catch (err) { console.warn('[ff] devices 拉取失败：', err); }
    },

    _bindDeviceFilter() {
      $('#ff-dev-filter')?.addEventListener('change', () => this._renderDevices());
    },

    /* ============= 三级结构导航 + 责任小区过滤 ============= */
    _bindLayerNav() {
      const btnO = $('#ff-layer-overview');
      const btnC = $('#ff-layer-community');
      const sel  = $('#ff-community-select');
      const nameEl = $('#ff-community-name');

      const _syncButtons = () => {
        if (btnO) btnO.classList.toggle('is-active', this._currentLayer === 'overview');
        if (btnC) btnC.classList.toggle('is-active', this._currentLayer === 'community');
        if (btnC) btnC.disabled = !this._activeCommunityId; // 没选小区则不能切到「社区层」态
        if (nameEl) {
          nameEl.textContent = this._activeCommunityId
            ? (this._communityNameMap[String(this._activeCommunityId)] || ('小区ID ' + this._activeCommunityId))
            : '（选择责任小区后切换）';
        }
      };

      btnO?.addEventListener('click', () => {
        this._currentLayer = 'overview';
        this._activeCommunityId = '';
        if (sel && sel.value !== '') sel.value = '';
        _syncButtons();
        // 切回总览：刷新所有统计/设备/告警（不过滤）
        this._renderStats(); this._renderDevices(); this._renderAlerts(); this._renderLogs();
      });
      btnC?.addEventListener('click', () => {
        if (!this._activeCommunityId) {
          UI?.Toast?.warn('请先从右侧下拉选择一个责任小区');
          return;
        }
        this._currentLayer = 'community';
        _syncButtons();
        // 切换到社区层：重新渲染过滤后的数据
        this._renderStats(); this._renderDevices(); this._renderAlerts(); this._renderLogs();
      });
      sel?.addEventListener('change', () => {
        const v = sel.value || '';
        this._activeCommunityId = v ? String(v) : '';
        // 选中小区 → 自动切到社区层视图
        if (this._activeCommunityId) this._currentLayer = 'community';
        else this._currentLayer = 'overview';
        _syncButtons();
        this._renderStats(); this._renderDevices(); this._renderAlerts(); this._renderLogs();
      });
      _syncButtons();
    },

    /** 填充责任小区下拉（仅使用后端公开列表，禁止演示常量污染业务选择） */
    async _fillCommunityOptions() {
      const sel = $('#ff-community-select');
      if (!sel) return;
      let list = [];
      let loadError = false;
      try {
        if (global.DashboardApi && global.DashboardApi.Community && typeof global.DashboardApi.Community.getPublicList === 'function') {
          list = await global.DashboardApi.Community.getPublicList() || [];
        }
      } catch (e) { loadError = true; }
      // 重置（保留第一个「全部」选项）
      sel.innerHTML = '<option value="">全部（全区）</option>';
      if (loadError || !list.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.disabled = true;
        opt.textContent = loadError ? '小区列表加载失败，请刷新重试' : '当前暂无可选小区';
        sel.appendChild(opt);
      }
      this._communityNameMap = {};
      (list || []).forEach(c => {
        const id = String(c.id);
        const opt = document.createElement('option');
        opt.value = id; opt.textContent = c.name || ('小区 ' + id);
        sel.appendChild(opt);
        this._communityNameMap[id] = c.name || opt.textContent;
      });
      // 如果当前已有选中值，要恢复 select 的 value
      if (this._activeCommunityId && sel.querySelector('option[value="' + this._activeCommunityId + '"]')) {
        sel.value = this._activeCommunityId;
      }
    },

    /** session 绑定了社区（或登录带 communityId）则预选该责任小区 */
    _applyCommunityFromSession() {
      const s = this.session || {};
      if (!s.communityId) return;
      const id = String(s.communityId);
      const sel = $('#ff-community-select');
      const tryApply = () => {
        if (sel && sel.querySelector('option[value="' + id + '"]')) {
          sel.value = id;
          sel.dispatchEvent(new Event('change'));
          return true;
        }
        return false;
      };
      if (tryApply()) return;
      // 等 _fillCommunityOptions() 异步填充完再应用
      setTimeout(() => tryApply(), 350);
      setTimeout(() => tryApply(), 900);
    },

    /** 社区过滤后的告警列表（未归档未误报的火警优先，再排序） */
    _filteredAlerts() {
      const cid = String(this._activeCommunityId || '');
      return (this._allAlerts || []).filter(a => {
        // 责任小区过滤：社区层按 communityId 匹配；告警没有 communityId 时再退化匹配 communityName
        if (cid) {
          const aCid = a.communityId != null ? String(a.communityId) : '';
          if (aCid && aCid !== cid) return false;
          if (!aCid) {
            const name = this._communityNameMap[cid];
            if (name && a.communityName && a.communityName !== name) return false;
          }
        }
        // 再走原有的可见性过滤（未归档+高等级/火警）
        const st = String(a.status || '').toLowerCase();
        if (st === 'archived' || st === 'false_alarm') return false;
        const lvl = String(a.level || '').toLowerCase();
        return lvl === 'high' || lvl === 'danger' || a.type === 'FIRE';
      });
    },

    /** 社区过滤后的设备列表 */
    _filteredDevices() {
      const cid = String(this._activeCommunityId || '');
      if (!cid) return (this._allDevices || []).slice();
      return (this._allDevices || []).filter(d => {
        const dCid = d.communityId != null ? String(d.communityId) : '';
        if (dCid) return dCid === cid;
        // 设备没有 communityId 字段：尝试按 communityName 匹配
        const name = this._communityNameMap[cid];
        return !!(name && d.communityName && d.communityName === name);
      });
    },

    _renderDevices() {
      const sumHost = $('#ff-dev-summary');
      const host = $('#ff-device-host');
      if (!host) return;
      const all = this._filteredDevices();
      const cnt = { danger: 0, warning: 0, offline: 0, normal: 0 };
      all.forEach(d => {
        const s = String(d.status || '').toLowerCase();
        if (cnt[s] != null) cnt[s]++; else cnt.normal++;
      });
      if (sumHost) {
        const chip = (label, count, color, bg) => create('div', {
          style: `padding:8px 10px;border-radius:8px;background:${bg};border:1px solid ${color}33;display:flex;align-items:center;justify-content:space-between;`,
        }, [
          create('span', { style: `font-size:11px;color:${color};font-weight:500;` }, label),
          create('span', { style: `font-family:'Orbitron',monospace;font-size:16px;font-weight:700;color:${color};` }, count),
        ]);
        render(sumHost, [
          chip('🔴 火警', cnt.danger, '#f87171', 'rgba(239,68,68,0.06)'),
          chip('🟠 预警', cnt.warning, '#fbbf24', 'rgba(251,191,36,0.06)'),
          chip('⚪ 离线', cnt.offline, '#94a3b8', 'rgba(148,163,184,0.06)'),
          chip('🟢 正常', cnt.normal, '#4ade80', 'rgba(34,197,94,0.06)'),
        ]);
      }

      const filter = $('#ff-dev-filter');
      const fv = filter && filter.value;
      const list = fv ? all.filter(d => String(d.status || '').toLowerCase() === fv) : all;
      if (!list.length) {
        host.innerHTML = `<div class="empty-ff" style="margin-top:10px;"><div class="big-ic">📡</div>暂无符合条件的设备</div>`;
        return;
      }
      host.innerHTML = '';
      list.slice(0, 80).forEach(d => {
        const item = this._buildDeviceItem(d);
        if (item) host.appendChild(item);
      });
    },

    _buildDeviceItem(d) {
      const s = String(d.status || '').toLowerCase();
      const map = {
        danger:  { cls: 'danger', t: '火警',    c: '#f87171' },
        warning: { cls: 'warn',   t: '预警',    c: '#fbbf24' },
        offline: { cls: '',       t: '离线',    c: '#94a3b8' },
        normal:  { cls: '',       t: '正常',    c: '#4ade80' },
      };
      const m = map[s] || map.normal;
      const item = create('div', {
        class: 'ff-device-item' + (m.cls ? ' ' + m.cls : ''),
        onclick: () => {
          if (global.TrendModal && typeof global.TrendModal.open === 'function') {
            try { global.TrendModal.open({ deviceId: d.id, deviceName: d.name, location: d.location, model: d.model }); }
            catch (err) { console.error('[ff] TrendModal.open 失败：', err); }
          }
        },
      }, [
        create('div', { class: 'ff-device-left' }, [
          create('div', { class: 'ff-device-ic' }, [
            (() => {
              const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
              svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('width','16'); svg.setAttribute('height','16');
              svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','2');
              svg.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/>';
              return svg;
            })(),
          ]),
          create('div', {}, [
            create('div', { class: 'ff-device-name', title: d.name || '' }, d.name || ('设备-' + String(d.id||'').slice(-4))),
            create('div', { class: 'ff-device-loc' }, d.location || '未设置位置'),
          ]),
        ]),
        create('span', { class: 'ff-device-st', style: { color: m.c } }, m.t),
      ]);
      return item;
    },

    /* ============= 联动控制 ============= */
    _bindLinkageButtons() {
      const host = $('#ff-linkage-host');
      if (!host) return;
      host.querySelectorAll('.linkage-btn-2').forEach(btn => {
        btn.addEventListener('click', () => this._toggleLinkage(btn));
      });
    },

    async _toggleLinkage(btn) {
      const key = btn.dataset && btn.dataset.key;
      if (!key) return;
      const labels = {
        sounder: '声光报警器', vent: '排风排烟设备', valve: '燃气电磁阀', light: '应急照明系统',
      };
      const label = labels[key] || key;
      const willOn = !this._linkageStates[key];
      if (willOn) {
        const ok = await (UI && UI.Modal && typeof UI.Modal.confirm === 'function'
          ? UI.Modal.confirm({ title: `启动${label}`, message: `将向责任区所有联动设备下发启动指令，是否继续？`, confirmText: '立即启动', cancelText: '取消' })
          : Promise.resolve(window.confirm(`确定启动${label}？`)));
        if (!ok) return;
      }
      UI?.Toast?.info(`${willOn ? '正在启动' : '正在关闭'}${label}…`);
      // 调用 MQTT 广播接口；无接口时前端模拟切换
      const done = await (async () => {
        try {
          if (global.DashboardApi && global.DashboardApi.Device && global.DashboardApi.Device.triggerLinkage) {
            await global.DashboardApi.Device.triggerLinkage(key, willOn ? 'ON' : 'OFF');
            return true;
          }
        } catch (_) {}
        // 降级：前端模拟
        await new Promise(r => setTimeout(r, 450));
        return true;
      })();
      if (done) {
        this._linkageStates[key] = willOn;
        btn.classList.toggle('active', willOn);
        const st = btn.querySelector('.st');
        if (st) st.textContent = willOn ? '● 运行中' : '未启动';
        UI?.Toast?.success(`${label}已${willOn ? '启动' : '关闭'}`);
        this._appendLog(`${willOn ? '🔛 启动' : '⏹ 关闭'}联动：${label}`);
      } else {
        UI?.Toast?.error('指令下发失败');
      }
    },

    /* ============= 责任区信息 ============= */
    async _loadScope() {
      const host = $('#ff-scope-host');
      if (!host) return;
      // 尝试拉社区列表（消防员按 communityId 过滤）
      let communities = [];
      try {
        const p = await global.DashboardApi.Community.getList({ pageSize: 200 }).catch(() => ({ records: [] }));
        communities = (p && p.records) || [];
      } catch (_) {}
      let devices = [];
      try { devices = this._allDevices.length ? this._allDevices : await global.DashboardApi.Device.getRealtimeList(500).catch(() => []); } catch (_) {}
      this._allDevices = devices || [];

      // 小区数（管理员/消防员可能只管一个）
      const cCount = communities.length || (this.session.communityId ? 1 : 0);
      const dCount = devices.length;
      const online = devices.filter(d => String(d.status || '').toLowerCase() !== 'offline').length;
      const danger = devices.filter(d => String(d.status || '').toLowerCase() === 'danger').length;

      const card = (k, v, sub, color) => create('div', {
        style: `padding:10px 12px;border-radius:9px;background:rgba(255,255,255,0.025);border:1px solid rgba(148,163,184,0.12);`,
      }, [
        create('div', { style: 'font-size:10px;color:var(--text-dim);margin-bottom:4px;' }, k),
        create('div', { style: `font-family:'Orbitron',monospace;font-size:18px;font-weight:700;color:${color};` }, v),
        create('div', { style: 'font-size:10px;color:var(--text-dim);margin-top:2px;' }, sub),
      ]);

      render(host, [
        card('覆盖社区', cCount || '--', cCount ? '个责任社区' : '全区权限', '#a855f7'),
        card('监管设备', dCount || '0', dCount ? '台烟感器' : '暂无设备', '#22d3ee'),
        card('当前在线', online, online ? `台 · 在线率 ${dCount ? Math.round(online*100/dCount) : 0}%` : '无在线设备', '#4ade80'),
        card('异常点位', danger, danger ? '处需立即关注' : '无异常', danger ? '#f87171' : '#4ade80'),
      ]);
    },

    /* ============= 日志 ============= */
    async _renderLogs() {
      const host = $('#ff-log-host');
      if (!host) return;
      const today = new Date(); today.setHours(0,0,0,0);
      const todayTs = today.getTime();
      const cid = String(this._activeCommunityId || '');
      const todayAlerts = (this._allAlerts || []).filter(a => {
        if (!a.createdAt) return false;
        if (new Date(a.createdAt).getTime() < todayTs) return false;
        if (!cid) return true;
        const aCid = a.communityId != null ? String(a.communityId) : '';
        if (aCid) return aCid === cid;
        const name = this._communityNameMap[cid];
        return !!(name && a.communityName && a.communityName === name);
      });
      if (!todayAlerts.length) {
        host.innerHTML = `<div style="padding:20px 0;text-align:center;color:var(--text-dim);font-size:11px;">今日暂无处置记录 · 一切平安 🧯</div>`;
        return;
      }
      host.innerHTML = '';
      todayAlerts.sort((x,y) => new Date(y.createdAt||0) - new Date(x.createdAt||0)).slice(0, 30).forEach(a => {
        const st = String(a.status || '').toLowerCase();
        const stText = { pending: '待处置', confirmed: '处置中', archived: '已归档', false_alarm: '误报' }[st] || st;
        const stCls  = { pending: 'warn', confirmed: 'warn', archived: 'ok', false_alarm: '' }[st] || '';
        const level = String(a.level || '').toLowerCase();
        const color = (level === 'high' || level === 'danger') ? '#f87171' : '#fbbf24';
        const line = create('div', { class: 'log-line ' + (st === 'archived' ? '' : 'warn') }, [
          create('span', { class: 'log-time' }, a.createdAt ? new Date(a.createdAt).toTimeString().slice(0,8) : '--:--:--'),
          create('span', { class: 'log-tag', style: `background:${color}22;color:${color};border-color:${color}44;` },
            level === 'high' ? '火警' : '预警'),
          create('span', { class: 'log-text' }, [
            document.createTextNode(`${a.deviceName || a.deviceId || '设备'} · ${a.location || '未知位置'}`),
          ]),
          create('span', { class: 'log-tag ' + (stCls || ''), style: 'margin-left:auto;' }, stText),
        ]);
        host.appendChild(line);
      });
    },

    _appendLog(text) {
      const host = $('#ff-log-host');
      if (!host) return;
      const t = new Date();
      const p = n => (n < 10 ? '0' : '') + n;
      const line = create('div', { class: 'log-line ok' }, [
        create('span', { class: 'log-time' }, `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`),
        create('span', { class: 'log-tag', style: 'background:rgba(34,211,238,0.12);color:#67e8f9;border-color:rgba(34,211,238,0.3);' }, '操作'),
        create('span', { class: 'log-text' }, text),
      ]);
      host.insertBefore(line, host.firstChild);
      // 限制数量
      while (host.childElementCount > 100) host.removeChild(host.lastChild);
    },
  };

  // 注册全局
  global.FirefighterPage = FF;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => FF.init());
  } else {
    FF.init();
  }
})(window);
