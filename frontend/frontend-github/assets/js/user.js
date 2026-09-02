/**
 * user.js - 普通用户查询中心逻辑
 * 依赖：DomUtil / DateUtil / DashboardApi / UI(interactions) / Auth
 */
(function (global) {
  'use strict';

  const { $, create, render } = global.DomUtil;
  const { formatDay } = global.DateUtil;
  const UI = global.UI;

  const UserPage = {
    session: null,
    /** 全量告警列表（筛选时再过滤） */
    _allAlerts: [],

    async init() {
      console.log('[user] init() starting...');
      this.session = global.Auth.getSession();
      console.log('[user] session:', this.session ? JSON.stringify(this.session).substring(0, 200) : 'null');
      if (!this.session) {
        console.warn('[user] no session, aborting init');
        return;
      }
      this._renderHeader();
      this._bindButtons();
      this._bindLayerNav();
      this._updateCommunityDisplay();
      // 先同步渲染基础信息（用户名一定有），再异步补齐
      console.log('[user] calling _renderProfileSync...');
      this._renderProfileSync();
      console.log('[user] _renderProfileSync done');
      this._renderProfileAsync();
      await this._renderStats();
      await this._renderDevices();
      this._fetchAndRenderAlerts();
      this._bindFilters();
      this._renderFooterDate();
      console.log('[user] init() complete');
    },

    /* ---------- 二级结构导航（居民：社区层 ↔ 感知层） ---------- */
    _bindLayerNav() {
      const btnC = $('#user-layer-community');
      const btnD = $('#user-layer-device');
      const hostStats = document.querySelector('section.user-stats');
      const hostGrid  = document.querySelector('div.user-grid');
      const sidePanel = document.querySelector('aside.user-side .user-panel'); // 个人信息面板在社区层显示
      const alertsSection = document.querySelector('section.user-alerts'); // 告警在感知层可见
      const _apply = (layer) => {
        if (btnC) btnC.classList.toggle('is-active', layer === 'community');
        if (btnD) btnD.classList.toggle('is-active', layer === 'device');
        // 社区层：显示「我的小区信息 + 统计概览」，隐藏设备列表滚动区和告警
        if (layer === 'community') {
          if (hostStats) hostStats.style.display = ''; // 顶部统计卡两栏都保留
          if (sidePanel) sidePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (alertsSection) alertsSection.style.display = ''; // 告警保留
        } else {
          // 感知层：自动滚动到设备列表区
          if (hostGrid) hostGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
      btnC?.addEventListener('click', () => _apply('community'));
      btnD?.addEventListener('click', () => _apply('device'));
    },
    /** 根据登录态填我的小区名（优先用后端登录返回的 communityName；兜底查前端常量） */
    _updateCommunityDisplay() {
      const s = this.session || {};
      const nameEl = $('#user-layer-community-name');
      const hintEl = $('#user-layer-right-hint');
      let name = s.communityName || '';
      if (!name && s.communityId && global.DashboardApi) {
        name = (typeof global.DashboardApi.communityNameById === 'function')
          ? global.DashboardApi.communityNameById(s.communityId)
          : ('ID=' + s.communityId);
      }
      if (!name) name = '我的小区（待绑定）';
      if (nameEl) nameEl.textContent = name;
      if (hintEl) {
        hintEl.textContent = s.communityId
          ? `归属小区「${name}」，仅查看已绑定的烟感设备和对应的告警事件，点击设备可查看浓度/温度趋势`
          : '暂无绑定的归属小区信息，请联系管理员完成用户与小区的绑定';
      }
    },

    /* ---------- 顶部 ---------- */
    _renderHeader() {
      const who = $('#whoami');
      if (who) who.textContent = this.session.username || '--';
      const role = this.session.role;
      const isSysAdmin = role === 'system_admin';
      const isAnyAdmin = isSysAdmin || role === 'community_admin';
      // 如果是任意管理员进入用户视角，加一个"管理"标签 + 显示返回大屏按钮
      if (isAnyAdmin) {
        const tag = document.querySelector('.role-tag');
        if (tag) {
          tag.textContent = isSysAdmin ? '系统管理员视角' : '小区管理员视角';
          tag.classList.remove('user-tag');
          tag.classList.add('admin-tag');
        }
        const back = $('#backBtn');
        if (back) back.hidden = false;
      }
      // tagline 也稍微改一下
      const tagline = $('#header-tagline');
      if (tagline && isAnyAdmin) {
        tagline.textContent = isSysAdmin
          ? '系统管理员预览 · 个人查询视角'
          : '小区管理员预览 · 个人查询视角';
      }
    },

    _bindButtons() {
      try {
        const logout = $('#logoutBtn');
        if (logout) {
          logout.addEventListener('click', (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            try {
              if (UI && UI.Toast) UI.Toast.info('正在退出登录…');
            } catch (_) { /* ignore */ }
            setTimeout(() => {
              try { global.Auth.logout({ reason: 'logged-out' }); }
              catch (err) { console.error('[user] logout 失败：', err); }
            }, 50);
          });
        }
        const back = $('#backBtn');
        if (back) {
          back.addEventListener('click', () => {
            try {
              // 按当前登录角色跳回对应首页（管理员→大屏，消防员→消防员大屏）
              const Auth = global.Auth;
              const role = (this.session && this.session.role) || (Auth && Auth.getSession && Auth.getSession() && Auth.getSession().role);
              const INDEX = {
                system_admin: 'index.html',
                community_admin: 'index.html',
                firefighter: 'firefighter.html',
                user: 'user.html',
              };
              const target = (INDEX[role] || 'index.html');
              // 用 _resolveUrl 保证子目录部署下路径正确
              const abs = (Auth && typeof Auth._resolveUrl === 'function') ? Auth._resolveUrl(target) : target;
              window.location.href = abs;
            } catch (err) {
              console.error('[user] 跳转失败：', err);
              window.location.href = 'index.html';
            }
          });
        }
      } catch (err) {
        console.error('[user] _bindButtons 失败：', err);
      }
    },

    /* ---------- 个人信息：用 innerHTML 直接渲染，避免 DomUtil 潜在问题 ---------- */
    _renderProfileSync() {
      const host = document.getElementById('profile-host');
      if (!host) {
        console.warn('[user] profile-host element not found');
        // 如果找不到，尝试创建一个
        const panel = document.querySelector('.user-panel');
        if (panel) {
          const ul = document.createElement('ul');
          ul.id = 'profile-host';
          ul.className = 'kv-list';
          panel.appendChild(ul);
          console.log('[user] created fallback profile-host');
          this._renderProfileSync(); // 重试
        }
        return;
      }
      const s = this.session || {};
      const Auth = global.Auth || {};
      const roleLabel = (Auth.roleLabel && typeof Auth.roleLabel === 'function')
        ? Auth.roleLabel(s.role)
        : ({ firefighter: '消防员', user: '普通用户', community_admin: '小区管理员', system_admin: '系统管理员' }[s.role] || '普通用户');

      const esc = (str) => {
        const sv = String(str == null ? '' : str);
        return sv.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      };

      const rows = [];
      rows.push({ k: '登录账号', v: esc(s.username || '--') });
      rows.push({ k: '真实姓名', v: esc(s.realName || s.username || s.nickname || '未填写') });
      rows.push({ k: '绑定手机', v: esc(s.phone || '未填写') });
      if (s.communityId) {
        let cName = '小区 ' + s.communityId;
        if (global.DashboardApi && global.DashboardApi.communityNameById) {
          const n = global.DashboardApi.communityNameById(s.communityId);
          if (n) cName = n;
        }
        rows.push({ k: '归属小区', v: esc(cName) });
      }
      rows.push({ k: '角色权限', v: esc(roleLabel), cls: 'ok' });
      rows.push({ k: '登录状态', v: '已认证', cls: 'ok' });

      const html = rows.map(r =>
        `<li><span class="k">${r.k}</span><span class="v${r.cls ? ' ' + r.cls : ''}">${r.v}</span></li>`
      ).join('');
      host.innerHTML = html;

      // 验证渲染结果
      const childCount = host.children.length;
      console.log('[user] profile rendered:', childCount, 'items, HTML length:', html.length);

      // 如果仍然是空的，用纯文本兜底
      if (childCount === 0) {
        console.error('[user] profile rendered 0 items, using text fallback');
        host.style.cssText = 'list-style:none;padding:8px 0;color:#ef4444;font-size:13px;';
        host.textContent = '个人信息加载失败，请刷新页面';
      }
    },

    async _renderProfileAsync() {
      const s = this.session || {};
      const Auth = global.Auth || {};
      // 用 userId 或 id 作为查询条件
      const uid = s.userId || s.id;
      if (!uid) return;
      if (!global.DashboardApi || !global.DashboardApi.AdminUser) return;

      try {
        const list = await global.DashboardApi.AdminUser.getList({ pageSize: 1000 });
        const records = (list && list.records) || [];
        // 按多种字段匹配
        const me = records.find(u =>
          String(u.id) === String(uid) ||
          String(u.userId || '') === String(uid) ||
          String(u.username || '') === String(s.username || '')
        );
        if (me) {
          const patches = {};
          if (me.realName) patches.realName = me.realName;
          if (me.phone) patches.phone = me.phone;
          if (me.communityId) patches.communityId = me.communityId;
          if (Object.keys(patches).length) {
            const merged = Object.assign({}, Auth.getSession() || {}, patches);
            try { Auth.setSession(merged); } catch (_) {}
            // 重新渲染
            this.session = Auth.getSession();
            this._renderProfileSync();
          }
        }
      } catch (err) {
        console.warn('[user] profile 异步补齐失败：', err);
      }
    },

    /* ---------- 顶部 4 张统计卡 ---------- */
    async _renderStats() {
      let devs = [];
      try { devs = await this._getMyDevices(); } catch (err) { /* ignore */ }
      let alerts = [];
      try { alerts = await this._getMyBoundAlerts(); } catch (err) { /* ignore */ }

      const total   = devs.length;
      const online  = devs.filter(d => d.status !== 'offline').length;
      const warn    = alerts.length;
      // 处置率：已处理 / 总数
      let handled = 0;
      alerts.forEach(a => { if (a.handled) handled++; });
      const rate = alerts.length ? Math.round(handled * 100 / alerts.length) : null;

      const $set = (id, v) => {
        const el = $(id);
        if (el) el.textContent = v;
      };
      $set('stat-total',   total);
      $set('stat-online',  online);
      $set('stat-warn',    warn);
      $set('stat-handled', handled);

      // 处置率单独替换占位
      const rateEl = document.querySelector('#stat-handled')?.parentElement?.parentElement?.querySelector('.highlight');
      if (rateEl) rateEl.textContent = (rate === null ? '--' : rate + '%');
    },

    /* ---------- 我的设备 ---------- */
    async _renderDevices() {
      const host = document.getElementById('my-device-host');
      if (!host) return;
      let list = [];
      try { list = await this._getMyDevices(); } catch (err) { /* ignore */ }
      if (!list || !list.length) {
        host.innerHTML = this._emptyBox('您当前没有绑定的烟感设备，请联系管理员为您的家庭安装并绑定账号。');
        return;
      }
      host.innerHTML = '';
      list.forEach(d => {
        const card = this._deviceCard(d);
        if (card) host.appendChild(card);
      });
    },

    /* ---------- 获取当前用户绑定的设备（映射为前端展示格式） ---------- */
    async _getMyDevices() {
      const uid = this.session && this.session.userId;
      if (!uid) return [];
      const arr = await global.DashboardApi.AdminUser.getBoundDevices(uid);
      const { num } = global.DashboardApi._util;
      return (arr || []).map(r => {
        const onlineStatus = String(r.onlineStatus || '').toUpperCase();
        let status = 'offline';
        if (onlineStatus === 'ONLINE') {
          const bat = num(r.batteryLevel, 100);
          status = bat < 20 ? 'warning' : 'normal';
        }
        return {
          id: String(r.id),
          name: r.deviceName || ('设备-' + String(r.id).slice(-5)),
          location: r.location || '--',
          status,
          concentration: null,
          temp: null,
          battery: num(r.batteryLevel, null),
          rssi: null,
          model: r.deviceType || '--',
        };
      });
    },

    /* ---------- 获取本小区所有设备（可主动查询，非仅绑定） ---------- */
    async _getCommunityDevices() {
      const list = await global.DashboardApi.Device.getRealtimeList(200);
      return list;
    },

    /* ---------- 只获取绑定设备的告警 ---------- */
    async _getMyBoundAlerts() {
      let list = [];
      try { list = await global.DashboardApi.Alert.getEventList(500); } catch (err) { return []; }
      let boundIds = new Set();
      try {
        const myDevices = await this._getMyDevices();
        boundIds = new Set((myDevices || []).map(d => String(d.id)));
      } catch (e) { /* ignore */ }
      return list.filter(a => boundIds.has(String(a.deviceId || '')));
    },

    /* ---------- 查看本小区所有报警器（可点击查看趋势图） ---------- */
    async showCommunityDevices() {
      let list = [];
      try { list = await this._getCommunityDevices(); } catch (e) { /* ignore */ }
      if (!list || !list.length) {
        if (UI && UI.Toast) UI.Toast.info('本小区暂无可查询的设备');
        return;
      }

      const mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;z-index:1200;background:rgba(3,8,20,0.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;';

      const closeMask = () => { if (mask.parentNode) mask.parentNode.removeChild(mask); };

      const host = create('div', { style: 'display:flex;flex-direction:column;gap:0;' });
      list.forEach(d => {
        const online = String(d.status || '').toUpperCase() === 'ONLINE' || d.status === 'normal';
        const stText = online ? '在线' : '离线';
        const stColor = online ? '#22c55e' : '#ef4444';
        const row = create('div', {
          style: 'display:flex;align-items:center;justify-content:space-between;padding:11px 14px;margin-bottom:8px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(148,163,184,0.14);cursor:pointer;transition:all 0.15s;',
          title: '点击查看传感器趋势图',
          onclick: () => {
            closeMask();
            if (global.TrendModal && typeof global.TrendModal.open === 'function') {
              try {
                global.TrendModal.open({
                  deviceId: d.id,
                  deviceName: d.name || ('设备-' + String(d.id || '').slice(-5)),
                  location: d.location,
                  model: d.model,
                });
              } catch (err) {
                console.error('[user] TrendModal.open 失败：', err);
                if (UI && UI.Toast) UI.Toast.error('趋势图加载失败');
              }
            } else {
              if (UI && UI.Toast) UI.Toast.warning('趋势图组件未加载');
            }
          },
          onmouseenter: (e) => { e.currentTarget.style.background = 'rgba(34,211,238,0.08)'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.35)'; },
          onmouseleave: (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,0.14)'; },
        }, [
          create('div', { style: 'display:flex;flex-direction:column;gap:3px;' }, [
            create('div', { style: 'font-size:13px;font-weight:600;color:var(--text-main);' }, d.name || '未命名设备'),
            create('div', { style: 'font-size:11px;color:var(--text-dim);' }, d.location || '未设置位置'),
          ]),
          create('div', { style: 'display:flex;align-items:center;gap:10px;' }, [
            d.model ? create('span', { style: 'font-size:11px;color:var(--text-dim);' }, d.model) : null,
            create('span', { style: 'font-size:12px;color:' + stColor + ';' }, [
              create('span', { style: 'display:inline-block;width:8px;height:8px;border-radius:50%;background:' + stColor + ';margin-right:5px;box-shadow:0 0 6px ' + stColor + ';' }),
              document.createTextNode(stText),
            ]),
          ]),
        ]);
        host.appendChild(row);
      });

      const container = create('div', {
        style: 'width:560px;max-width:100%;max-height:80vh;display:flex;flex-direction:column;background:linear-gradient(160deg,#0b1626,#0d1b30);border:1px solid rgba(34,211,238,0.28);border-radius:14px;box-shadow:0 16px 50px rgba(0,0,0,0.55);overflow:hidden;',
      }, [
        create('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid rgba(148,163,184,0.15);' }, [
          create('div', { style: 'font-size:16px;font-weight:700;color:var(--text-main);letter-spacing:1px;' }, '本小区全部报警器 · 点击查看趋势'),
          create('button', {
            class: 'cc-close',
            style: 'background:transparent;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;line-height:1;padding:2px 6px;',
            textContent: '×',
            onclick: closeMask,
          }),
        ]),
        create('div', { style: 'flex:1;overflow-y:auto;padding:16px 22px;' }, [host]),
        create('div', { style: 'padding:12px 22px;border-top:1px solid rgba(148,163,184,0.12);font-size:11px;color:var(--text-dim);' },
          `共 ${list.length} 台设备 · 仅展示本小区范围，告警推送仅针对您绑定的设备`
        ),
      ]);
      mask.appendChild(container);
      document.body.appendChild(mask);
      mask.addEventListener('click', (e) => { if (e.target === mask) closeMask(); });
      const onKey = (e) => { if (e.key === 'Escape') { closeMask(); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);
    },

    /* ---------- 我的消息（含管理员回复） ---------- */
    async showMyMessages() {
      const mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;z-index:1200;background:rgba(3,8,20,0.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;';
      mask.innerHTML = `
        <div style="width:600px;max-width:100%;max-height:82vh;display:flex;flex-direction:column;background:linear-gradient(160deg,#0b1626,#0d1b30);border:1px solid rgba(34,211,238,0.28);border-radius:14px;box-shadow:0 16px 50px rgba(0,0,0,0.55);overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid rgba(148,163,184,0.15);">
            <div style="font-size:16px;font-weight:700;color:var(--text-main);letter-spacing:1px;">我的消息</div>
            <button class="mm-close" style="background:transparent;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;line-height:1;padding:2px 6px;">×</button>
          </div>
          <div id="mm-list" style="flex:1;overflow-y:auto;padding:16px 22px;">
            <div style="color:var(--text-dim);font-size:13px;text-align:center;padding:30px 0;">加载中…</div>
          </div>
          <div style="padding:12px 22px;border-top:1px solid rgba(148,163,184,0.12);font-size:11px;color:var(--text-dim);">可随时通过「联系管理员」发起新的报修或申请</div>
        </div>`;
      document.body.appendChild(mask);
      const close = () => { if (mask.parentNode) mask.parentNode.removeChild(mask); };
      mask.querySelector('.mm-close').addEventListener('click', close);
      mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
      const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);

      const listHost = mask.querySelector('#mm-list');
      let page;
      try {
        page = await global.DashboardApi.Message.getMyList({ page: 1, pageSize: 100 });
      } catch (e) {
        listHost.innerHTML = '<div style="color:#fca5a5;font-size:13px;text-align:center;padding:30px 0;">消息加载失败：' + (e && e.message || '未知错误') + '</div>';
        return;
      }
      const records = (page && page.records) || [];
      if (!records.length) {
        listHost.innerHTML = '<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:40px 0;">暂无消息，可通过「联系管理员」发起报修</div>';
        return;
      }
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const fmt = (s) => {
        if (!s) return '--';
        try { const d = new Date(s); if (isNaN(d.getTime())) return s; const p = n => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); } catch (e) { return s; }
      };
      listHost.innerHTML = records.map(m => {
        const isAdmin = m.senderRole === 'ADMIN';
        const unread = m.status !== 'READ';
        if (isAdmin) {
          return `
          <div style="padding:10px 14px;margin-bottom:10px;margin-left:26px;border-radius:10px;background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.18);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;flex-wrap:wrap;gap:6px;">
              <span style="font-size:12px;font-weight:600;color:#4ade80;">↩ 管理员回复</span>
              <span style="font-size:11px;color:var(--text-dim);">${fmt(m.createdAt)}</span>
            </div>
            <div style="font-size:13px;color:var(--text-muted);line-height:1.6;white-space:pre-wrap;">${esc(m.content) || ''}</div>
          </div>`;
        }
        return `
          <div style="padding:12px 14px;margin-bottom:10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(148,163,184,0.14);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px;">
              <span style="font-size:12px;font-weight:600;color:var(--text-main);">我 · ${unread ? '<span style="color:#f87171;font-size:10px;">待回复</span>' : '<span style="color:var(--text-dim);font-size:10px;">已处理</span>'}</span>
              <span style="font-size:11px;color:var(--text-dim);">${fmt(m.createdAt)}</span>
            </div>
            <div style="font-size:13px;color:var(--text-muted);line-height:1.6;white-space:pre-wrap;">${esc(m.content) || ''}</div>
          </div>`;
      }).join('');
    },

    _deviceCard(d) {
      const statusMap = {
        normal:  { cls: '',       text: '在线' },
        warning: { cls: 'warning',text: '预警' },
        danger:  { cls: 'danger', text: '告警' },
        offline: { cls: 'offline',text: '离线' },
      };
      const sm = statusMap[d.status] || statusMap.normal;
      // 按设备显示规范：仅保留状态映射，不展示任何传感器细项（烟雾/温度/电量等收敛到趋势图）
      const card = create('div', {
        class: 'device-card' + (sm.cls ? ' ' + sm.cls : ''),
        title: '点击查看趋势分析 · Shift+点击查看简单详情',
        onclick: (e) => {
          if (e && e.shiftKey) {
            this._openDeviceDetail(d);
          } else if (global.TrendModal && typeof global.TrendModal.open === 'function') {
            try {
              global.TrendModal.open({ deviceId: d.id, deviceName: d.name, location: d.location, model: d.model });
            } catch (err) {
              console.error('[user] TrendModal.open 失败：', err);
              this._openDeviceDetail(d);
            }
          } else {
            this._openDeviceDetail(d);
          }
        },
      }, [
        create('div', { class: 'device-card-head' }, [
          create('div', { class: 'device-card-ic',
            html: `<svg viewBox="0 0 36 36" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="20" r="7" fill="rgba(34,211,238,0.08)"/>
              <path d="M11 12c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>
              <path d="M24 10c0-5 4-9 9-9"/>
              <line x1="18" y1="27" x2="18" y2="32"/>
            </svg>` }),
          create('div', { class: 'device-card-title' }, [
            // 按规范：只显示设备总 ID + 名称 + 位置，传感器字段收敛到趋势图
            create('div', { class: 'device-card-name' }, [
              create('span', {
                style: 'display:inline-block;min-width:28px;padding:1px 5px;margin-right:6px;border-radius:3px;background:var(--bg-accent);color:var(--primary);font-size:10px;font-weight:600;',
                html: '#' + (d.id || '--'),
              }),
              create('span', { html: d.name || '未命名设备' }),
            ]),
            create('div', { class: 'device-card-loc' }, d.location || '未设置位置'),
          ]),
          create('div', { class: 'device-card-status ' + sm.cls }, [
            create('span', { class: 'd' }),
            document.createTextNode(sm.text),
          ]),
        ]),
        create('div', {
          class: 'device-card-footer',
          style: 'margin-top:8px;padding-top:10px;border-top:1px dashed var(--border);',
        }, [
          create('span', {}, (d.status === 'danger' || d.status === 'warning') ? '⚠ 请查看趋势分析' : '点击查看趋势'),
          create('span', { class: 'view-detail' }, [
            document.createTextNode('趋势分析'),
            create('span', {}, '›'),
          ]),
        ]),
      ]);
      return card;
    },
    _mk(k, v, vcls) {
      return create('div', { class: 'micro-k' }, [
        create('span', { class: 'mk' }, k),
        create('span', { class: 'mv' + (vcls ? ' ' + vcls : '') }, v),
      ]);
    },

    _openDeviceDetail(d) {
      if (!UI || !UI.Modal) {
        alert('设备：' + (d.name || '--') + '\n位置：' + (d.location || '--'));
        return;
      }
      const statusText =
        d.status === 'danger' ? '告警' :
        d.status === 'warning' ? '预警' :
        d.status === 'offline' ? '离线' : '正常';
      // 按规范：设备详情只展示 ID + 名称 + 位置，传感器数据收敛到趋势分析
      const html = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <h3 style="margin:0;font-size:16px;letter-spacing:2px;">
            <span style="padding:2px 8px;border-radius:4px;background:var(--bg-accent);color:var(--primary);font-size:12px;font-weight:600;">#${d.id || '--'}</span>
            ${d.name || '设备详情'}
            <span class="level-chip ${d.status === 'danger' ? 'high' : d.status === 'warning' ? 'mid' : 'low'}"
                  style="margin-left:8px;font-size:11px;">${statusText}</span>
          </h3>
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:12px;font-size:13px;">
          <div><div style="color:var(--text-dim);font-size:11px;">安装位置</div><div>${d.location || '未设置'}</div></div>
        </div>
        <div style="margin-top:14px;padding:10px 12px;border-radius:8px;background:rgba(37,99,235,0.06);border:1px solid rgba(37,99,235,0.18);font-size:12px;line-height:1.7;color:var(--text-muted);">
          <b style="color:#3b82f6;">提示：</b>传感器详细数据（烟雾 / 温度 / 电量 / 信号 / 心跳）请在「趋势分析」图中查看。
        </div>`;
      UI.Modal.open({ title: '设备详情', contentHtml: html, width: 520 });
    },

    /* ---------- 告警记录 ---------- */
    async _fetchAndRenderAlerts() {
      let list = [];
      try { list = await this._getMyBoundAlerts(); } catch (err) { /* ignore */ }
      // 加上默认时间（如果 API 没给）、规范化字段
      list = list.map((a, i) => ({
        id: a.id || ('a' + i),
        level: a.level || 'low',
        time: a.time || this._timeAgo(i * 36 + 1800),
        title: a.title || '提示信息',
        description: a.description || '',
        location: a.deviceId ? '设备 ' + a.deviceId : '--',
        handled: !!a.handled,
      }));
      // 保存原始 deviceId 字段（后面徽章要用）
      list = list.map((a, i) => Object.assign(a, {
        __deviceId: a.deviceId || null,
      }));
      this._allAlerts = list;
      this._applyFiltersAndRender();
    },

    _timeAgo(sec) {
      const d = new Date(Date.now() - sec * 1000);
      const pad = n => (n < 10 ? '0' : '') + n;
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    },

    _bindFilters() {
      // 查询按钮
      const btn = $('#btn-apply-filter');
      if (btn) btn.addEventListener('click', () => this._applyFiltersAndRender());
      // 回车搜索
      const q = $('#filter-query');
      if (q) q.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._applyFiltersAndRender(); });
    },

    _applyFiltersAndRender() {
      const host = $('#my-alert-host');
      if (!host) return;
      const level   = $('#filter-level')?.value   || 'all';
      const handled = $('#filter-handled')?.value || 'all';
      const from    = $('#filter-from')?.value || '';
      const to      = $('#filter-to')?.value || '';
      const q       = ($('#filter-query')?.value || '').trim().toLowerCase();

      let list = this._allAlerts.slice();
      if (level   !== 'all') list = list.filter(a => a.level === level);
      if (handled === 'handled') list = list.filter(a =>  a.handled);
      if (handled === 'pending') list = list.filter(a => !a.handled);
      if (from || to) {
        list = list.filter(a => {
          // 目前只有 HH:mm:ss，简化：只要今天就默认都在范围内（实训 demo 没给真实日期）
          return true;
        });
      }
      if (q) {
        list = list.filter(a =>
          (a.title || '').toLowerCase().includes(q) ||
          (a.description || '').toLowerCase().includes(q) ||
          (a.location || '').toLowerCase().includes(q)
        );
      }

      if (!list.length) {
        host.innerHTML = this._emptyBox('没有匹配的告警记录，可尝试更换筛选条件。');
        return;
      }
      const LEVEL_TEXT = { high: '紧急告警', mid: '一般预警', low: '提示信息' };
      render(host, list.map(a => {
        // 设备ID徽章（按任务清单要求：警告事件触发时明确标注具体设备ID）
        const deviceIdChip = (a.__deviceId || a.deviceId)
          ? create('span', {
              style: 'display:inline-block;padding:1px 6px;margin-right:6px;border-radius:3px;background:rgba(37,99,235,0.1);color:#3b82f6;font-size:10px;font-weight:700;vertical-align:1px;',
              title: '触发告警的设备 ID',
            }, '设备 #' + String(a.__deviceId || a.deviceId))
          : null;
        const titleChildren = [];
        if (deviceIdChip) titleChildren.push(deviceIdChip);
        titleChildren.push(create('b', {}, (a.title || '--')));
        if (a.description) {
          titleChildren.push(create('span', { style: 'margin-left:6px;color:var(--text-dim);' }, '· ' + a.description));
        }
        return create('div', {
          class: 'alert-row',
          title: a.description || a.title,
        }, [
          create('div', { class: 'time' }, a.time || '--'),
          create('span', { class: 'level-chip ' + a.level }, LEVEL_TEXT[a.level] || '--'),
          create('div', { class: 'desc' }, titleChildren),
          create('div', { class: 'loc'  }, a.location || '--'),
          create('div', { class: 'st ' + (a.handled ? 'handled' : 'pending') }, a.handled ? '已处理' : '待处理'),
        ]);
      }));
    },

    /* ---------- 空状态 ---------- */
    _emptyBox(text) {
      return `<div class="empty-box">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="9"/>
          <line x1="12" y1="8" x2="12" y2="13"/>
          <circle cx="12" cy="16.5" r="0.8" fill="currentColor"/>
        </svg>
        <span>${text}</span></div>`;
    },

    /* ---------- 帮助：联系管理员（发消息给本小区管理员） ---------- */
    touchAdmin() {
      const mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;z-index:1200;background:rgba(3,8,20,0.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;';
      mask.innerHTML = `
        <div style="width:440px;max-width:100%;background:linear-gradient(160deg,#0b1626,#0d1b30);border:1px solid rgba(34,211,238,0.28);border-radius:14px;padding:22px 24px 20px;box-shadow:0 16px 50px rgba(0,0,0,0.55);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <div style="font-size:16px;font-weight:700;color:var(--text-main);letter-spacing:1px;">联系管理员</div>
            <button class="cm-close" style="background:transparent;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;line-height:1;padding:2px 6px;">×</button>
          </div>
          <div style="font-size:12px;color:var(--text-dim);margin-bottom:16px;">向本小区管理员发送消息（报修 / 地址变更 / 申请加设备等）</div>
          <div style="margin-bottom:13px;">
            <label style="display:block;font-size:12px;color:var(--text-dim);margin-bottom:6px;">消息类型</label>
            <select id="cm-type" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(148,163,184,0.25);border-radius:8px;padding:10px 12px;color:var(--text-main);font-size:13px;">
              <option value="REPAIR">设备报修</option>
              <option value="ADDRESS_CHANGE">地址变更</option>
              <option value="ADD_DEVICE">申请加设备</option>
              <option value="OTHER">其他</option>
            </select>
          </div>
          <div style="margin-bottom:13px;">
            <label style="display:block;font-size:12px;color:var(--text-dim);margin-bottom:6px;">消息内容</label>
            <textarea id="cm-content" rows="4" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(148,163,184,0.25);border-radius:8px;padding:10px 12px;color:var(--text-main);font-size:13px;resize:vertical;font-family:inherit;"></textarea>
          </div>
          <div id="cm-err" style="color:#fca5a5;font-size:12px;min-height:16px;margin-top:4px;"></div>
          <div style="display:flex;gap:10px;margin-top:14px;">
            <button id="cm-cancel" class="btn btn-ghost" style="flex:1;" type="button">取消</button>
            <button id="cm-submit" class="btn btn-primary" style="flex:1;" type="button">发送</button>
          </div>
        </div>`;
      document.body.appendChild(mask);

      const close = () => { if (mask.parentNode) mask.parentNode.removeChild(mask); };
      const showErr = (msg) => { const e = mask.querySelector('#cm-err'); if (e) e.textContent = msg; };

      mask.querySelector('.cm-close').addEventListener('click', close);
      mask.querySelector('#cm-cancel').addEventListener('click', close);
      mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
      const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);

      const submitBtn = mask.querySelector('#cm-submit');
      submitBtn.addEventListener('click', async () => {
        const type = mask.querySelector('#cm-type').value;
        const content = mask.querySelector('#cm-content').value.trim();
        if (!content) { showErr('请输入消息内容'); return; }
        submitBtn.disabled = true; submitBtn.textContent = '发送中…';
        try {
          await global.DashboardApi.Message.send({ type, content });
          close();
          if (UI && UI.Toast) UI.Toast.success('消息已发送给管理员');
        } catch (e) {
          showErr((e && e.message) || '发送失败，请稍后重试');
          submitBtn.disabled = false; submitBtn.textContent = '发送';
        }
      });
    },

    _renderFooterDate() {
      const el = $('#now-date-small');
      if (!el) return;
      const update = () => {
        const d = new Date();
        const pad = n => (n < 10 ? '0' : '') + n;
        el.textContent =
          d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
          ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      };
      update();
      setInterval(update, 30 * 1000);
    },
  };

  global.UserPage = UserPage;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => UserPage.init());
  } else {
    UserPage.init();
  }
})(window);
