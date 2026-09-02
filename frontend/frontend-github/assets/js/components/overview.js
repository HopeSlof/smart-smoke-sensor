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
    /** 三级结构状态：'overview'=总览层（显示设备列表/社区卡片入口），'community'=社区层（只显示某社区设备） */
    _currentLayer: 'overview',
    /** 当前选中的社区 ID（进入社区层时设置） */
    _activeCommunityId: null,
    /** 当前选中的社区名称（用于导航条显示） */
    _activeCommunityName: '',
    /** 缓存的社区列表（避免重复拉取） */
    _communityCache: null,

    init() {
      // 首次渲染是异步的，待设备总览 DOM 生成后再绑定“查看全部”交互。
      this.render().finally(() => this._bindDeadButtons());
      this._perceptionTimer = setInterval(() => this.renderPerception(), 3000);
      // —— 三级结构导航：绑定切换按钮 + 拉社区列表渲染中间层入口卡片 ——
      this._initLayerNavigation();
    },

    /** ---------- 三级结构：导航条 + 社区入口卡片 ---------- */
    _initLayerNavigation() {
      const btnOverview = document.getElementById('nav-btn-overview');
      const btnCommunity = document.getElementById('nav-btn-community');
      const btnPerception = document.getElementById('nav-btn-perception');
      if (btnOverview) {
        btnOverview.addEventListener('click', () => this._switchLayer('overview'));
      }
      if (btnCommunity) {
        btnCommunity.addEventListener('click', () => this._openCommunitySelector());
      }
      if (btnPerception) {
        btnPerception.addEventListener('click', () => this._switchLayer('perception'));
      }
      // 拉取社区列表（用于渲染社区入口卡片；同时给社区管理员做权限隔离）
      this._loadAndRenderCommunities();

      // 小区管理员：社区层按钮直接切到自己的社区（无需选择器）
      const session = global.Auth && global.Auth.getSession && global.Auth.getSession();
      if (session && session.role === 'community_admin' && session.communityId) {
        this._activeCommunityId = String(session.communityId);
        this._activeCommunityName = this._communityCache && this._communityCache.length
          ? ((this._communityCache[0] && this._communityCache[0].name) || '我的小区')
          : '我的小区';
        const nameSpan = document.getElementById('nav-community-name');
        if (nameSpan) nameSpan.textContent = this._activeCommunityName;
      }
    },

    /** 点击社区层按钮 → 弹出小区选择面板（系统管理员可见所有小区，小区管理员自动跳自己的） */
    async _openCommunitySelector() {
      console.log('[overview] _openCommunitySelector called');
      const session = global.Auth && global.Auth.getSession && global.Auth.getSession();
      const role = session && session.role;

      // 小区管理员直接切到自己的社区，无需选择
      if (role === 'community_admin' && this._activeCommunityId) {
        this._switchLayer('community');
        if (global.UI && global.UI.Toast) {
          global.UI.Toast.info('已进入「' + this._activeCommunityName + '」视图');
        }
        // 同步刷新告警面板
        if (global.AlertsComponent && typeof global.AlertsComponent.setCommunityFilter === 'function') {
          global.AlertsComponent.setCommunityFilter(this._activeCommunityId);
        }
        return;
      }

      // 系统管理员 → 弹小区选择 Modal
      const UI = global.UI;
      // 首次点击可能早于异步社区列表返回，先等待真实数据再打开选择器。
      if (this._communityCache === null) {
        await this._loadAndRenderCommunities();
      }
      const communities = this._communityCache || [];

      // 如果已经进入过某个社区，切回总览层
      if (this._currentLayer === 'community' && this._activeCommunityId) {
        // 显示简单的切换选择器
      }

      // 构造选择 Modal
      const modalId = 'community-select-modal';
      const oldModal = document.getElementById(modalId);
      if (oldModal) oldModal.remove();

      const overlay = document.createElement('div');
      overlay.id = modalId;
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,0.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;';
      const closeSelector = () => {
        overlay.remove();
        document.removeEventListener('keydown', closeOnEscape);
      };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSelector(); });
      const closeOnEscape = (e) => {
        if (e.key === 'Escape') {
          closeSelector();
        }
      };
      document.addEventListener('keydown', closeOnEscape);

      const panel = document.createElement('div');
      panel.style.cssText = 'width:480px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;border-radius:14px;border:1px solid rgba(34,211,238,0.3);background:linear-gradient(160deg,rgba(15,23,42,0.98),rgba(2,6,23,0.95));box-shadow:0 20px 60px rgba(0,0,0,0.5),0 0 40px rgba(34,211,238,0.15);overflow:hidden;';

      // 标题
      const titleBar = document.createElement('div');
      titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;border-bottom:1px solid rgba(34,211,238,0.15);';
      titleBar.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg>
          <span style="font-size:15px;font-weight:700;color:var(--text-main);letter-spacing:1px;">选择社区 / 小区</span>
        </div>
        <button type="button" id="community-select-close" aria-label="关闭社区选择" title="关闭 (Esc)" style="width:28px;height:28px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,71,87,0.1);border:1px solid rgba(255,71,87,0.4);color:#ff4757;cursor:pointer;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`;
      panel.appendChild(titleBar);
      titleBar.querySelector('#community-select-close')?.addEventListener('click', closeSelector);

      // 搜索框
      const searchBar = document.createElement('div');
      searchBar.style.cssText = 'padding:10px 14px;';
      searchBar.innerHTML = `
        <input id="community-search-input" type="text" placeholder="搜索小区名称或地址..." style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(34,211,238,0.3);background:rgba(0,20,40,0.6);color:var(--text-main);font-size:12px;font-family:inherit;outline:none;box-sizing:border-box;">`;
      panel.appendChild(searchBar);

      // 社区列表
      const listWrap = document.createElement('div');
      listWrap.style.cssText = 'flex:1;overflow-y:auto;padding:4px 10px 10px;';
      listWrap.id = 'community-select-list';
      panel.appendChild(listWrap);

      // 无数据提示
      if (!communities || communities.length === 0) {
        listWrap.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);font-size:13px;">暂无社区数据，请先在系统管理中创建社区</div>';
      } else {
        this._renderCommunitySelectList(communities, listWrap);
      }

      // 搜索过滤
      const searchInput = searchBar.querySelector('#community-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          const kw = (searchInput.value || '').trim().toLowerCase();
          const items = listWrap.querySelectorAll('.community-select-item');
          items.forEach(it => {
            const name = (it.dataset.name || '').toLowerCase();
            const addr = (it.dataset.addr || '').toLowerCase();
            it.style.display = (!kw || name.includes(kw) || addr.includes(kw)) ? '' : 'none';
          });
        });
      }
      setTimeout(() => { if (searchInput) searchInput.focus(); }, 100);

      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    },

    /** 渲染社区选择列表项 */
    _renderCommunitySelectList(communities, listWrap) {
      listWrap.innerHTML = '';
      communities.forEach(c => {
        const item = document.createElement('div');
        item.className = 'community-select-item';
        item.dataset.name = c.name || '';
        item.dataset.addr = c.address || '';
        item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:6px;border-radius:10px;border:1px solid rgba(34,211,238,0.15);background:rgba(34,211,238,0.04);cursor:pointer;transition:all .15s;';
        item.innerHTML = `
          <div style="width:36px;height:36px;border-radius:8px;background:rgba(34,211,238,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text-main);">${c.name || '未命名社区'} <span style="color:var(--text-dim);font-size:11px;font-weight:400;">#${c.id}</span></div>
            <div style="font-size:11px;color:var(--text-dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.address || '暂无地址信息'}</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-dim);flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>`;
        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(34,211,238,0.12)';
          item.style.borderColor = 'rgba(34,211,238,0.5)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'rgba(34,211,238,0.04)';
          item.style.borderColor = 'rgba(34,211,238,0.15)';
        });
        item.addEventListener('click', () => {
          this._activeCommunityId = String(c.id);
          this._activeCommunityName = c.name || ('社区-' + c.id);
          const nameSpan = document.getElementById('nav-community-name');
          if (nameSpan) nameSpan.textContent = this._activeCommunityName;
          // 关闭弹窗
          const modal = document.getElementById('community-select-modal');
          if (modal) modal.remove();
          // 切换到社区层
          this._switchLayer('community');
          if (global.UI && global.UI.Toast) {
            global.UI.Toast.info('已进入「' + this._activeCommunityName + '」视图');
          }
          // 同步刷新告警面板
          if (global.AlertsComponent && typeof global.AlertsComponent.setCommunityFilter === 'function') {
            global.AlertsComponent.setCommunityFilter(this._activeCommunityId);
          }
        });
        listWrap.appendChild(item);
      });
    },

    /** 拉取社区列表并渲染「中间层入口卡片」（总览层显示，用户点击可进入对应社区视图） */
    async _loadAndRenderCommunities() {
      const session = global.Auth && global.Auth.getSession && global.Auth.getSession();
      const role = session && session.role;
      const communityId = session && session.communityId;
      const Api = global.DashboardApi;
      let communities = [];

      try {
        if (Api && Api.Community && typeof Api.Community.getList === 'function') {
          const page = await Api.Community.getList({ page: 1, pageSize: 100 });
          communities = (page && page.records) || [];
        }
      } catch (err) {
        console.warn('[overview] 社区列表拉取失败，降级用本地常量', err);
      }

      // 社区管理员：只能看到自己负责的那一个社区
      if (role === 'community_admin' && communityId) {
        communities = communities.filter(c => String(c.id) === String(communityId));
        // 如果接口没拉到（后端没建数据），用 session 里的 communityId 造一条占位，保证视图可点
        if (communities.length === 0) {
          communities = [{
            id: communityId,
            name: (Api && Api.communityNameById && Api.communityNameById(communityId)) || '我的小区',
            address: '',
          }];
        }
      }
      this._communityCache = communities;
      this._renderCommunityCards(communities);
    },

    /** 渲染社区入口卡片（总览层时显示在设备列表下方） */
    _renderCommunityCards(communities) {
      const host = document.getElementById('community-list-host');
      if (!host) return;
      if (!communities || communities.length === 0) {
        host.innerHTML = '';
        return;
      }
      const session = global.Auth && global.Auth.getSession && global.Auth.getSession();
      const role = session && session.role;
      // 系统管理员 → 显示社区入口卡片（中间层）；
      // 小区管理员 → 不显示（后端已按其 communityId 过滤，总览层即本小区视图，社区层按钮也已去掉）
      const showCommunityLayer = (role === 'system_admin');
      if (!showCommunityLayer) {
        host.innerHTML = '';
        host.style.display = 'none';
        return;
      }
      const cards = communities.map(c => this._communityCard(c));
      render(host, cards);
      // 总览层时把 community-list-host 显示在设备列表下方，作为"中间层入口"
      if (this._currentLayer === 'overview') {
        host.style.display = '';
      }
    },

    /** 单个社区入口卡片 */
    _communityCard(c) {
      const cid = String(c.id);
      const card = create('div', {
        class: 'community-card',
        title: '点击进入「' + (c.name || '社区') + '」视图 · 只看该社区的设备和告警',
        onclick: () => this._enterCommunity(cid, c.name || ('社区-' + cid)),
      }, [
        create('div', { class: 'community-head' }, [
          create('div', { class: 'community-icon', html: Overview._svgCommunity() }),
          create('div', {}, [
            create('div', { class: 'community-name' }, [
              document.createTextNode(c.name || '未命名社区'),
              create('span', { class: 'community-id' }, '#' + cid),
            ]),
            create('div', {
              style: 'font-size:10px;color:var(--text-dim);margin-top:2px;',
              html: (c.address || c.adminUsername ? (c.address || '') + (c.adminUsername ? ' · 负责人：' + c.adminUsername : '') : '点击进入查看本社区设备'),
            }),
          ]),
        ]),
        create('div', { class: 'community-stats' }, [
          create('div', {}, ['设备数', create('span', { class: 'num ok', html: (typeof c.deviceCount === 'number' ? c.deviceCount : '--') })]),
          create('div', {}, ['告警', create('span', { class: 'num warn', html: (typeof c.alarmCount === 'number' ? c.alarmCount : '--') })]),
          create('div', { style: 'color:var(--primary);font-size:13px;', html: '进入 ›' }),
        ]),
      ]);
      return card;
    },

    _svgCommunity() {
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg>';
    },

    /** 切换总览层 / 社区层 / 感知层（社区层需 _activeCommunityId 已设置） */
    _switchLayer(layer) {
      const btnOverview = document.getElementById('nav-btn-overview');
      const btnCommunity = document.getElementById('nav-btn-community');
      const btnPerception = document.getElementById('nav-btn-perception');
      const nameSpan = document.getElementById('nav-community-name');
      const deviceListWrap = document.getElementById('device-list-wrap');  // 设备列表整块（含标题）
      const statCardsHost = document.getElementById('stat-cards-host');  // 4 张统计卡
      const perceptionExpandHost = document.getElementById('perception-expand-host'); // 感知层放大视图
      const deviceListHost = document.getElementById('device-list-host');
      const communityListHost = document.getElementById('community-list-host');
      const titleSpan = document.getElementById('device-list-title-span');
      const session = global.Auth && global.Auth.getSession && global.Auth.getSession();

      // 先清除所有 active 样式
      [btnOverview, btnCommunity, btnPerception].forEach(b => { if (b) b.classList.remove('is-active'); });

      if (layer === 'perception') {
        // ========== 感知层：隐藏统计卡和设备列表，渲染放大视图（含设备选择器） ==========
        this._currentLayer = 'perception';
        if (btnPerception) btnPerception.classList.add('is-active');
        // 社区层按钮始终可点击（点击后弹小区选择器或直接切社区）
        if (btnCommunity) btnCommunity.disabled = false;
        if (nameSpan) nameSpan.textContent = '社区层';
        // 隐藏统计卡 & 设备列表整块
        if (statCardsHost) statCardsHost.style.display = 'none';
        if (deviceListWrap) deviceListWrap.style.display = 'none';
        // 显示感知层放大视图
        if (perceptionExpandHost) {
          perceptionExpandHost.style.display = '';
          perceptionExpandHost.innerHTML = '';
          this._buildPerceptionExpandView(perceptionExpandHost);
        }
        if (global.UI && global.UI.Toast) {
          global.UI.Toast.info('已进入「感知层」· 可在顶部选择具体传感器设备查看读数');
        }
        return;
      }

      // ========== 总览层 / 社区层：恢复统计卡和设备列表容器，隐藏感知层放大视图 ==========
      this._currentLayer = layer;
      if (statCardsHost) statCardsHost.style.display = '';
      if (deviceListWrap) deviceListWrap.style.display = '';
      if (perceptionExpandHost) perceptionExpandHost.style.display = 'none';

      if (layer === 'overview') {
        if (btnOverview) btnOverview.classList.add('is-active');
        if (btnCommunity) {
          btnCommunity.classList.remove('is-active');
          btnCommunity.disabled = false;  // 始终可点击（用于弹出小区选择器）
        }
        if (nameSpan) nameSpan.textContent = '社区层';
        if (titleSpan) titleSpan.textContent = '实时设备状态';
        // 总览层：显示设备列表 + 下方社区入口卡片（系统/小区管理员可见）
        if (deviceListHost) deviceListHost.style.display = '';
        if (communityListHost) {
          const role = session && session.role;
          const showCards = (role === 'system_admin') || (role === 'community_admin');
          communityListHost.style.display = showCards ? '' : 'none';
        }
        // 清除告警面板社区过滤器（回到全局）
        if (global.AlertsComponent && typeof global.AlertsComponent.setCommunityFilter === 'function') {
          global.AlertsComponent.setCommunityFilter(null);
        }
        // 刷新数据（4 张卡 + 设备列表 → 回到全局视图）
        this.renderSummary();
        this.renderDevices();
      } else if (layer === 'community' && this._activeCommunityId) {
        if (btnOverview) btnOverview.classList.remove('is-active');
        if (btnCommunity) {
          btnCommunity.classList.add('is-active');
          btnCommunity.disabled = false;
        }
        if (nameSpan) nameSpan.textContent = this._activeCommunityName;
        if (titleSpan) titleSpan.textContent = '社区设备 · ' + (this._activeCommunityName || this._activeCommunityId);
        // 社区层：隐藏社区入口卡片；设备列表 → 过滤只显示本社区设备
        if (communityListHost) communityListHost.style.display = 'none';
        if (deviceListHost) deviceListHost.style.display = '';
        // 告警面板也切到该社区
        if (global.AlertsComponent && typeof global.AlertsComponent.setCommunityFilter === 'function') {
          global.AlertsComponent.setCommunityFilter(this._activeCommunityId);
        }
        // 按社区重新拉数据
        this.renderSummary(this._activeCommunityId);
        this.renderDevices(this._activeCommunityId);
      }
    },

    /** 从社区卡片点击 → 记录选中社区并切到社区层视图 */
    _enterCommunity(communityId, communityName) {
      this._activeCommunityId = String(communityId);
      this._activeCommunityName = communityName || ('社区-' + communityId);
      // 使社区层按钮可点击
      const btn = document.getElementById('nav-btn-community');
      if (btn) btn.disabled = false;
      this._switchLayer('community');
      if (global.UI && global.UI.Toast) {
        global.UI.Toast.info('已进入「' + this._activeCommunityName + '」视图 · 仅显示本社区设备');
      }
      // 同步刷新告警面板（如支持社区过滤）
      if (global.AlertsComponent && typeof global.AlertsComponent.setCommunityFilter === 'function') {
        global.AlertsComponent.setCommunityFilter(this._activeCommunityId);
      }
    },

    /* =========================================================
     * 感知层放大视图（含设备选择器）
     * 结构：标题行(标题+×关闭) / 选择行(设备下拉+全屏按钮) /
     *       设备信息条 / 指标卡网格（始终对应当前选中的单个设备）
     * ========================================================= */

    /** 当前感知层选中的设备 ID（始终对应一个真实设备） */
    _perceptionDeviceId: null,
    /** 感知层设备下拉的缓存列表 */
    _perceptionDevices: null,

    /** 构建感知层放大视图骨架（下拉选择 + 关闭按钮 + 卡片容器） */
    _buildPerceptionExpandView(host) {
      if (!host) return;
      host.innerHTML = '';

      // 外层卡片容器（与其它 panel 视觉对齐）
      const cardWrap = document.createElement('div');
      cardWrap.style.cssText = 'border-radius:10px;border:1px solid rgba(34,211,238,0.18);background:linear-gradient(160deg,rgba(34,211,238,0.04),rgba(15,23,42,0.02));padding:14px 14px 12px;';
      host.appendChild(cardWrap);

      // ---- 标题行：左侧标题 + 右侧×关闭（内联样式，不依赖CSS类，确保一定渲染出来） ----
      const titleRow = document.createElement('div');
      titleRow.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;';
      const leftInfo = document.createElement('div');
      leftInfo.innerHTML = `
        <div style="font-size:14px;font-weight:700;letter-spacing:1px;color:var(--text-main);display:flex;align-items:center;gap:6px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#22d3ee;flex-shrink:0;"><path d="M2 12h4l3-9 4 18 3-9h6"/></svg>
          感知层监测 · 放大视图
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:4px;line-height:1.6;">
          每 3 秒自动刷新 · 顶部可切换查看具体传感器设备 · 点击 × 退出
        </div>`;
      titleRow.appendChild(leftInfo);

      // ×关闭按钮：全部用内联样式（宽高/边框/背景/颜色），即使CSS加载失败也可见可点
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.id = 'perception-expand-close';
      closeBtn.title = '退出感知层 · 返回总览层（Esc）';
      closeBtn.setAttribute('aria-label', '关闭感知层');
      closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      closeBtn.style.cssText = 'flex-shrink:0;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;background:rgba(255,71,87,0.10);border:1px solid rgba(255,71,87,0.45);color:#ff4757;transition:all .2s;';
      closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(255,71,87,0.22)'; closeBtn.style.boxShadow = '0 4px 14px rgba(255,71,87,0.25)'; });
      closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'rgba(255,71,87,0.10)'; closeBtn.style.boxShadow = 'none'; });
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._perceptionDeviceId = null;
        try { if (global.UI && global.UI.Toast) global.UI.Toast.info('已返回总览层'); } catch (_) {}
        this._switchLayer('overview');
      });
      titleRow.appendChild(closeBtn);
      cardWrap.appendChild(titleRow);

      // ---- 选择行：设备下拉（左） + 全屏详情按钮（右） ----
      const selectRow = document.createElement('div');
      selectRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;';
      const selLabel = document.createElement('span');
      selLabel.textContent = '传感器设备：';
      selLabel.style.cssText = 'font-size:12px;color:var(--text-dim);flex-shrink:0;';
      selectRow.appendChild(selLabel);

      const devSelect = document.createElement('select');
      devSelect.id = 'perception-device-select';
      devSelect.title = '选择要查看的具体传感器设备';
      devSelect.style.cssText = 'flex:1;min-width:220px;max-width:420px;padding:6px 10px;border-radius:8px;font-size:12px;font-family:inherit;border:1px solid rgba(34,211,238,0.35);background:rgba(0,20,40,0.6);color:var(--text-main);cursor:pointer;outline:none;';
      selectRow.appendChild(devSelect);
      // 当前选择回填
      devSelect.value = this._perceptionDeviceId || '';
      devSelect.addEventListener('change', () => {
        this._perceptionDeviceId = devSelect.value || null;
        this._refreshPerceptionExpand();
        try {
          if (global.UI && global.UI.Toast) {
            global.UI.Toast.info(this._perceptionDeviceId ? '已切换到该设备的专属读数' : '请选择要查看的传感器设备');
          }
        } catch (_) {}
      });

      const fullBtn = document.createElement('button');
      fullBtn.type = 'button';
      fullBtn.id = 'perception-expand-full';
      fullBtn.title = '打开模态框 · 查看指标详情与阈值说明';
      fullBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>全屏详情';
      fullBtn.style.cssText = 'flex-shrink:0;padding:6px 12px;border-radius:8px;font-size:12px;font-family:inherit;cursor:pointer;background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.35);color:var(--cyan);transition:all .2s;';
      fullBtn.addEventListener('click', (e) => { e.preventDefault(); this._openPerceptionDetail(); });
      selectRow.appendChild(fullBtn);
      cardWrap.appendChild(selectRow);

      // ---- 设备信息条（选中具体设备时显示：#ID · 名称 · 位置 · 状态） ----
      const devBanner = document.createElement('div');
      devBanner.id = 'perception-device-banner';
      devBanner.style.cssText = 'display:none;margin-bottom:12px;padding:10px 14px;border-radius:8px;background:rgba(34,211,238,0.06);border:1px solid rgba(34,211,238,0.25);font-size:12px;color:var(--text-main);line-height:1.8;';
      cardWrap.appendChild(devBanner);

      // ---- 指标卡网格 ----
      const grid = document.createElement('div');
      grid.id = 'perception-expand-grid';
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;';
      cardWrap.appendChild(grid);

      // ---- 摄像头分区 ----
      const camSection = document.createElement('div');
      camSection.id = 'perception-camera-section';
      camSection.style.cssText = 'margin-top:16px;padding-top:14px;border-top:1px solid rgba(34,211,238,0.12);';
      camSection.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span style="font-size:14px;font-weight:700;color:var(--text-main);">摄像头监控</span>
          <span style="font-size:10px;color:var(--text-dim);margin-left:4px;">点击拍照 → 本地摄像头采集 → AI 自动分析</span>
        </div>
        <div id="perception-camera-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">
          <div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-dim);font-size:12px;">摄像头列表加载中…</div>
        </div>`;
      cardWrap.appendChild(camSection);

      // 键盘可达：Esc 退出感知层（只注册一次）
      if (!Overview.__escBoundPerception) {
        Overview.__escBoundPerception = true;
        document.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape' && Overview._currentLayer === 'perception') {
            Overview._perceptionDeviceId = null;
            Overview._switchLayer('overview');
          }
        });
      }

      // 加载设备列表填充下拉 + 首次渲染卡片
      this._fillPerceptionDeviceOptions(devSelect);
      this._refreshPerceptionExpand();
      // 加载摄像头列表到感知层
      this._loadPerceptionCameras();
    },

    /** 拉取设备列表填充感知层下拉（复用设备列表接口，按角色自动过滤） */
    async _fillPerceptionDeviceOptions(devSelect) {
      if (!devSelect) return;
      try {
        const devices = await global.DashboardApi.Device.getRealtimeList(200);
        this._perceptionDevices = devices || [];
        devSelect.innerHTML = '';
        this._perceptionDevices.forEach(d => {
          const o = document.createElement('option');
          o.value = String(d.id);
          o.textContent = '#' + d.id + ' ' + (d.name || '未命名') + '（' + (d.location || '未设置位置') + '）';
          devSelect.appendChild(o);
        });
        // 当前设备不存在时默认选中第一台真实设备，保证下方卡片有明确来源。
        const currentExists = this._perceptionDevices.some(d => String(d.id) === String(this._perceptionDeviceId));
        if (!currentExists) this._perceptionDeviceId = this._perceptionDevices[0] ? String(this._perceptionDevices[0].id) : null;
        if (!this._perceptionDevices.length) {
          const empty = document.createElement('option');
          empty.value = '';
          empty.textContent = '暂无可用传感器设备';
          empty.disabled = true;
          devSelect.appendChild(empty);
        }
        devSelect.value = this._perceptionDeviceId || '';
        await this._refreshPerceptionExpand();
      } catch (err) {
        console.warn('[overview] 感知层设备下拉拉取失败', err);
      }
    },

    /** 加载摄像头列表到感知层 */
    async _loadPerceptionCameras() {
      const grid = document.getElementById('perception-camera-grid');
      if (!grid) return;
      try {
        let cameras = [];
        try {
          cameras = await global.DashboardApi.Camera.list();
        } catch (err) {
          grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-dim);font-size:12px;">摄像头接口待部署</div>';
          return;
        }
        if (!Array.isArray(cameras) || !cameras.length) {
          grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-dim);font-size:12px;">暂无摄像头，请在设置→摄像头管理中创建</div>';
          return;
        }
        grid.innerHTML = cameras.map(c => {
          const devText = c.deviceId
            ? '<span style="color:var(--cyan);font-size:10px;">绑定设备#' + c.deviceId + '</span>'
            : '<span style="color:var(--text-dim);font-size:10px;">未绑定设备</span>';
          const statusDot = c.status === 'online'
            ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--green);margin-right:4px;"></span>'
            : '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--red);margin-right:4px;"></span>';
          return `
            <div data-cam-id="${c.id}" style="padding:12px;border-radius:10px;background:rgba(168,85,247,0.04);border:1px solid rgba(168,85,247,0.15);display:flex;flex-direction:column;gap:6px;">
              <div style="display:flex;align-items:center;gap:6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" style="flex-shrink:0;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                <span style="font-size:12px;font-weight:600;color:var(--text-main);">${c.name || ('摄像头#' + c.id)}</span>
              </div>
              <div style="font-size:10px;color:var(--text-dim);">${c.location || '位置未设置'}</div>
              <div style="display:flex;align-items:center;gap:8px;">
                ${statusDot}<span style="font-size:10px;color:var(--text-dim);">${c.status === 'online' ? '在线' : '离线'}</span>
                ${devText}
              </div>
              <button type="button" class="cam-capture-btn" data-cam-id="${c.id}" data-cam-name="${c.name || ''}" style="margin-top:4px;padding:6px 12px;border-radius:8px;font-size:11px;cursor:pointer;background:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(124,58,237,0.1));border:1px solid rgba(168,85,247,0.3);color:#c084fc;transition:all .2s;display:inline-flex;align-items:center;gap:4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
                拍照
              </button>
            </div>`;
        }).join('');

        // 绑定拍照按钮点击事件（事件委托）
        grid.onclick = (e) => {
          const btn = e.target.closest('[data-cam-id]');
          if (!btn) return;
          const camId = btn.getAttribute('data-cam-id');
          const camName = btn.getAttribute('data-cam-name');
          if (global.CameraCaptureComponent) {
            global.CameraCaptureComponent.open({ id: camId, name: camName });
          }
        };
      } catch (err) {
        console.warn('[overview] 摄像头列表加载失败', err);
      }
    },

    /** 刷新感知层放大视图：只渲染当前下拉选中的单设备读数卡 */
    async _refreshPerceptionExpand() {
      const grid = document.getElementById('perception-expand-grid');
      const banner = document.getElementById('perception-device-banner');
      if (!grid) return;
      const devId = this._perceptionDeviceId;

      if (!devId) {
        // 没有真实设备时不调用聚合接口，避免把某一台设备误标成“全部”。
        if (banner) banner.style.display = 'none';
        grid.innerHTML = Overview._emptyHtml('请选择一个传感器设备查看实时读数');
        return;
      }

      // 单设备视图：设备信息条 + 该设备读数卡
      const dev = (this._perceptionDevices || []).find(d => String(d.id) === String(devId));
      if (banner) {
        if (dev) {
          const stTxt = dev.status === 'danger' ? '火警' : dev.status === 'warning' ? '预警' : dev.status === 'offline' ? '离线' : '正常';
          const stColor = dev.status === 'danger' ? '#ff4757' : dev.status === 'warning' ? '#ffa502' : dev.status === 'offline' ? '#7f8c8d' : '#2ed573';
          banner.innerHTML =
            '<b>#' + dev.id + '</b> ' + (dev.name || '未命名设备') +
            ' · <span style="color:var(--text-dim);">位置：' + (dev.location || '未设置') + '</span>' +
            ' · <span style="color:' + stColor + ';font-weight:600;">' + stTxt + '</span>' +
            ' · <span style="color:var(--text-dim);">最后心跳：' + (dev.lastHeartbeat || '未知') + '</span>';
        } else {
          banner.innerHTML = '设备 #' + devId + ' · <span style="color:var(--text-dim);">设备列表加载中…</span>';
        }
        banner.style.display = '';
      }
      await this._renderPerceptionForDevice(devId, dev, grid);
    },

    /** 渲染单个设备的感知读数卡（烟雾/温度/CO/电量/信号，带异常过滤） */
    async _renderPerceptionForDevice(devId, dev, grid) {
      const Api = global.DashboardApi;
      let l = null;
      try { l = await Api.Sensor.getLatestReading(devId); } catch (_) { l = null; }
      let thresholdConfig = {};
      try {
        const settings = await Api.Settings.getAll();
        thresholdConfig = (settings && settings._raw) || {};
      } catch (_) { /* 阈值接口不可用时保持未配置状态 */ }

      // 读数：优先 latest 接口，其次设备记录上的 lastXxxValue
      const num = (v, d) => (v == null || typeof v !== 'number' || isNaN(v)) ? d : v;
      let smoke = l ? num(l.smokeConcentration, null) : null;
      if (smoke == null && dev) smoke = num(dev.concentration, null);
      let temp = l ? num(l.temperature, null) : null;
      if (temp == null && dev) temp = num(dev.temp, null);
      const co = l ? num(l.coConcentration, null) : null;
      const bat = (l ? num(l.batteryLevel, null) : null) != null ? (l ? num(l.batteryLevel, 0) : null)
                : (dev ? num(dev.battery, null) : null);
      const rssi = l ? num(l.signalStrength, null) : (dev ? num(dev.rssi, null) : null);

      // 异常过滤（物理不可能值视为 NULL，保持空状态）
      if (smoke != null && (smoke < 0 || smoke > 500)) smoke = null;
      if (temp != null && (temp < -20 || temp >= 60)) temp = null;
      if (co != null && (co < 0 || co >= 300)) co = null;

      const smokeWarn = num(thresholdConfig.smokeWarnThreshold, null);
      const smokeAlarm = num(thresholdConfig.smokeAlarmThreshold, null);
      const tempAlarm = num(thresholdConfig.temperatureThreshold, null);
      const coAlarm = num(thresholdConfig.coThreshold, null);
      const mk = (id, icon, name, value, unit, st, stTxt, badge, provi, thrLabel) =>
        ({ id, icon, name, value, unit, status: st, statusText: stTxt, badge, provisional: provi, thresholdLabel: thrLabel });

      const cards = [];
      if (smoke == null) {
        cards.push(mk('smoke', 'smoke', '烟雾浓度', null, 'μg/m³', 'ok', '暂无感知数据', '暂无感知数据', true, '预警阈值待配置'));
      } else {
        const st = smokeAlarm != null && smoke >= smokeAlarm ? 'danger' : smokeWarn != null && smoke >= smokeWarn ? 'warn' : 'ok';
        cards.push(mk('smoke', 'smoke', '烟雾浓度', smoke, 'μg/m³', st, st === 'danger' ? '超过火警阈值' : st === 'warn' ? '超过预警阈值' : '正常', null, false, smokeWarn != null || smokeAlarm != null ? `预警 ${smokeWarn ?? '--'} / 火警 ${smokeAlarm ?? '--'} μg/m³` : '阈值未配置'));
      }
      if (temp == null) {
        cards.push(mk('temp', 'temp', '环境温度', null, '℃', 'ok', '暂无感知数据', '暂无感知数据', true, '告警阈值待配置'));
      } else {
        const st = tempAlarm != null && temp >= tempAlarm ? 'danger' : 'ok';
        cards.push(mk('temp', 'temp', '环境温度', temp, '℃', st, st === 'danger' ? '超过温度阈值' : '正常', null, false, tempAlarm != null ? `告警阈值 ${tempAlarm}℃` : '阈值未配置'));
      }
      if (co == null) {
        cards.push(mk('co', 'co', 'CO 浓度', null, 'ppm', 'ok', '暂无感知数据', '暂无感知数据', true, '告警阈值待配置'));
      } else {
        const st = coAlarm != null && co >= coAlarm ? 'danger' : 'ok';
        cards.push(mk('co', 'co', 'CO 浓度', co, 'ppm', st, st === 'danger' ? 'CO 超标' : '正常', null, false, coAlarm != null ? `告警阈值 ${coAlarm} ppm` : '阈值未配置'));
      }
      // 电量/信号：设备自检卡（复用 dev 卡结构）
      cards.push(mk('dev', 'dev', '设备电量/信号', null, '', 'ok',
        '电量 ' + (bat == null ? '--' : bat + '%') + ' · 信号 ' + (rssi == null ? '--' : (rssi >= -60 ? '强' : rssi >= -75 ? '良好' : rssi >= -85 ? '一般' : '弱')),
        null, false, '低电量 < 20% 提醒更换'));

      render(grid, cards.map(s => Overview._sensorCard(s)));
    },

    /** 兜底：HTML 写了但 JS 0 绑定的按钮，在此处绑定（避免用户点了没反应） */
    _bindDeadButtons() {
      // 1) 设备总览面板 → "查看全部 →" → 打开设备选择面板（可搜索/选设备看详情）
      const seeAll = document.querySelector('.see-all');
      if (seeAll) {
        seeAll.style.cursor = 'pointer';
        seeAll.title = '查看全部设备 · 选择设备查看详情';
        seeAll.textContent = '查看全部设备 →';
        seeAll.dataset.bound = '1';
        seeAll.addEventListener('click', () => this._openDeviceSelector());
      }
    },

    /** 打开设备选择面板（弹窗，可搜索设备列表，点击设备看趋势详情） */
    async _openDeviceSelector() {
      const UI = global.UI;
      const modalId = 'device-select-modal';
      const oldModal = document.getElementById(modalId);
      if (oldModal) oldModal.remove();

      // 先拉设备列表
      let devices = [];
      try {
        devices = await global.DashboardApi.Device.getRealtimeList(200);
        devices = devices || [];
        // 社区层只展示当前社区设备（后端按 JWT 隔离后再做一次前端兜底）。
        if (this._currentLayer === 'community' && this._activeCommunityId) {
          const cid = String(this._activeCommunityId);
          const hasCommunityField = devices.some(d => d.communityId != null && String(d.communityId) !== '');
          if (hasCommunityField) {
            devices = devices.filter(d => String(d.communityId) === cid);
          }
        }
      } catch (err) {
        console.warn('[overview] 设备列表拉取失败', err);
        if (UI && UI.Toast) UI.Toast.error('设备列表加载失败，请刷新重试');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = modalId;
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,0.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;';
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

      const panel = document.createElement('div');
      panel.style.cssText = 'width:640px;max-width:94vw;max-height:82vh;display:flex;flex-direction:column;border-radius:14px;border:1px solid rgba(34,211,238,0.3);background:linear-gradient(160deg,rgba(15,23,42,0.98),rgba(2,6,23,0.95));box-shadow:0 20px 60px rgba(0,0,0,0.5),0 0 40px rgba(34,211,238,0.15);overflow:hidden;';

      // 标题栏
      const titleBar = document.createElement('div');
      titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 18px 10px;border-bottom:1px solid rgba(34,211,238,0.15);';
      titleBar.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>
          <span style="font-size:15px;font-weight:700;color:var(--text-main);letter-spacing:1px;">设备列表</span>
          <span style="font-size:11px;color:var(--text-dim);margin-left:8px;">共 ${devices.length} 台设备</span>
        </div>
        <button type="button" id="device-select-close" aria-label="关闭设备列表" title="关闭设备列表" style="width:28px;height:28px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,71,87,0.1);border:1px solid rgba(255,71,87,0.4);color:#ff4757;cursor:pointer;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`;
      panel.appendChild(titleBar);

      // 搜索+过滤
      const filterBar = document.createElement('div');
      filterBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;flex-wrap:wrap;';
      filterBar.innerHTML = `
        <input id="device-select-search" type="text" placeholder="搜索设备名称/ID/位置..." style="flex:1;min-width:180px;padding:7px 12px;border-radius:8px;border:1px solid rgba(34,211,238,0.3);background:rgba(0,20,40,0.6);color:var(--text-main);font-size:12px;font-family:inherit;outline:none;box-sizing:border-box;">
        <select id="device-select-status" style="padding:7px 10px;border-radius:8px;border:1px solid rgba(34,211,238,0.3);background:rgba(0,20,40,0.6);color:var(--text-main);font-size:12px;font-family:inherit;outline:none;cursor:pointer;">
          <option value="all">全部状态</option>
          <option value="online">在线</option>
          <option value="offline">离线</option>
          <option value="danger">告警</option>
        </select>`;
      panel.appendChild(filterBar);

      // 设备列表
      const listWrap = document.createElement('div');
      listWrap.style.cssText = 'flex:1;overflow-y:auto;padding:4px 12px 12px;';
      listWrap.id = 'device-select-list';
      panel.appendChild(listWrap);

      // 渲染设备列表
      if (!devices || devices.length === 0) {
        listWrap.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);font-size:13px;">暂无设备数据</div>';
      } else {
        this._renderDeviceSelectList(devices, listWrap);
      }

      // 搜索/过滤绑定
      const searchInput = filterBar.querySelector('#device-select-search');
      const statusSel = filterBar.querySelector('#device-select-status');
      const applyFilter = () => {
        const kw = (searchInput.value || '').trim().toLowerCase();
        const st = statusSel.value;
        const items = listWrap.querySelectorAll('.device-select-item');
        items.forEach(it => {
          const name = (it.dataset.name || '').toLowerCase();
          const id = (it.dataset.id || '').toLowerCase();
          const loc = (it.dataset.loc || '').toLowerCase();
          const status = it.dataset.status || '';
          const matchKw = !kw || name.includes(kw) || id.includes(kw) || loc.includes(kw);
          const matchSt = st === 'all'
            || (st === 'online' && (status === 'online' || status === 'normal' || status === 'warning'))
            || (st === 'danger' && (status === 'danger' || status === 'warning'))
            || (st === 'offline' && status === 'offline');
          it.style.display = (matchKw && matchSt) ? '' : 'none';
        });
      };
      searchInput.addEventListener('input', applyFilter);
      statusSel.addEventListener('change', applyFilter);

      // 关闭按钮
      const closeBtn = titleBar.querySelector('#device-select-close');
      if (closeBtn) closeBtn.addEventListener('click', () => overlay.remove());

      setTimeout(() => { if (searchInput) searchInput.focus(); }, 100);

      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    },

    /** 渲染设备选择列表项 */
    _renderDeviceSelectList(devices, listWrap) {
      listWrap.innerHTML = '';
      const statusLabel = (st) => ({ online: '在线', offline: '离线', danger: '告警', normal: '正常' }[st] || st || '未知');
      const statusColor = (st) => ({ online: '#2ed573', offline: '#7f8c8d', danger: '#ff4757', normal: '#2ed573' }[st] || '#7f8c8d');

      devices.forEach(d => {
        const status = d.status || 'normal';
        const item = document.createElement('div');
        item.className = 'device-select-item';
        item.dataset.name = d.name || '';
        item.dataset.id = String(d.id);
        item.dataset.loc = d.location || '';
        item.dataset.status = status;
        item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 14px;margin-bottom:6px;border-radius:10px;border:1px solid rgba(34,211,238,0.15);background:rgba(34,211,238,0.04);cursor:pointer;transition:all .15s;';
        item.innerHTML = `
          <div style="width:40px;height:40px;border-radius:10px;background:rgba(34,211,238,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M6 7V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3"/></svg>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text-main);display:flex;align-items:center;gap:8px;">
              ${d.name || '未命名设备'}
              <span style="font-size:11px;color:var(--text-dim);font-weight:400;">#${d.id}</span>
              <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${statusColor(status)}20;color:${statusColor(status)};border:1px solid ${statusColor(status)}40;">${statusLabel(status)}</span>
            </div>
            <div style="font-size:11px;color:var(--text-dim);margin-top:3px;display:flex;gap:12px;flex-wrap:wrap;">
              <span>📍 ${d.location || '未设置位置'}</span>
              ${typeof d.concentration === 'number' ? `<span>💨 ${d.concentration}μg/m³</span>` : ''}
              ${typeof d.temp === 'number' ? `<span>🌡 ${d.temp}℃</span>` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
            <button class="btn-view-detail" data-id="${d.id}" style="padding:5px 10px;font-size:11px;border-radius:6px;background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.3);color:var(--cyan);cursor:pointer;white-space:nowrap;">查看详情</button>
          </div>`;
        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(34,211,238,0.12)';
          item.style.borderColor = 'rgba(34,211,238,0.5)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'rgba(34,211,238,0.04)';
          item.style.borderColor = 'rgba(34,211,238,0.15)';
        });
        // 点击卡片或"查看详情"按钮 → 打开趋势详情
        const openDetail = (devId) => {
          const modal = document.getElementById('device-select-modal');
          if (modal) modal.remove();
          // 用已有的 TrendModal 组件打开设备详情
          if (global.TrendModal && typeof global.TrendModal.open === 'function') {
            const dev = devices.find(item => String(item.id) === String(devId));
            global.TrendModal.open({
              deviceId: String(devId),
              deviceName: dev && dev.name,
              location: dev && dev.location,
              model: dev && dev.model,
            });
          } else {
            // 降级：直接跳转到设备趋势
            if (UI && UI.Toast) UI.Toast.info('正在打开设备 #' + devId + ' 的趋势详情...');
          }
        };
        item.addEventListener('click', (e) => {
          // 如果点击的是"查看详情"按钮本身，不冒泡重复触发
          if (e.target.closest('.btn-view-detail')) {
            openDetail(d.id);
          } else {
            openDetail(d.id);
          }
        });
        // 单独绑定按钮
        const btn = item.querySelector('.btn-view-detail');
        if (btn) btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openDetail(d.id);
        });
        listWrap.appendChild(item);
      });
    },

    /** 感知层详情 Modal：动态创建节点（复用 settings-modal 的结构），避免 Drawer.open 的 alerts 专用参数不兼容 */
    async _openPerceptionDetail() {
      const UI = global.UI;
      const selectedId = this._perceptionDeviceId;
      const selected = (this._perceptionDevices || []).find(d => String(d.id) === String(selectedId));
      if (!selectedId || !selected) {
        UI?.Toast?.warning('请先选择一个传感器设备');
        return;
      }
      // 全屏详情必须沿用当前下拉设备，避免再次请求并展示另一台设备的数据。
      if (global.TrendModal && typeof global.TrendModal.open === 'function') {
        return global.TrendModal.open({
          deviceId: String(selected.id),
          deviceName: selected.name,
          location: selected.location,
          model: selected.model,
        });
      }
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
                create('div', {}, '· 标签「待接入」：硬件尚未 MQTT 上线或暂无有效感知读数，当前数值显示为 --。'),
                create('div', {}, '· 烟雾、温度、CO 阈值由系统配置决定；达到阈值后显示预警/告警状态。'),
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

    /** ---------- 4张统计卡 ----------
     * @param {string} [communityId]  传了则统计「本社区设备」；不传则走全局统计
     */
    async renderSummary(communityId) {
      const host = $('stat-cards-host');
      if (!host) return;
      let data;
      try {
        // 后端 /devices/statistics 目前无 communityId 参数，
        // 若处于社区层则前端用「设备列表」自己聚合 4 项统计，保证社区视图数据口径正确
        if (communityId) {
          data = await this._calcCommunitySummary(communityId);
        } else {
          data = await global.DashboardApi.Device.getSummary();
        }
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
      const rows = [];
      for (let i = 0; i < cards.length; i += 2) {
        rows.push(create('div', { class: 'stat-row' }, [
          Overview._card(cards[i]),
          cards[i + 1] ? Overview._card(cards[i + 1]) : null,
        ]));
      }
      render(host, rows);
    },

    /** 社区层 4 张统计卡：前端拉设备列表 → 按 communityId 过滤 → 本地聚合 */
    async _calcCommunitySummary(communityId) {
      try {
        const Api = global.DashboardApi;
        const page = Api && Api.Device && typeof Api.Device.getList === 'function'
          ? await Api.Device.getList({ page: 1, pageSize: 500 })
          : null;
        let records = (page && page.records) || [];
        const cid = String(communityId);
        // 有 communityId 字段就后端/前端双重过滤；没有就退化为显示当前列表全量
        if (records.length > 0 && records[0].communityId != null) {
          records = records.filter(r => String(r.communityId) === cid);
        }
        let online = 0, offline = 0, warning = 0;
        records.forEach(r => {
          const onlineStatus = String(r.onlineStatus != null ? r.onlineStatus : '').toUpperCase();
          if (onlineStatus === 'OFFLINE' || r.status === 'offline') offline++;
          else online++;
          // 告警统计：activeAlarmCount 或 status=warning/danger 都算
          const alarm = typeof r.activeAlarmCount === 'number' ? r.activeAlarmCount : 0;
          const st = String(r.status || '').toLowerCase();
          if (alarm > 0 || st === 'warning' || st === 'danger') warning++;
        });
        const total = records.length;
        return {
          total, online, offline, warning,
          onlineRate: total > 0 ? Math.round((online / total) * 100) : 0,
          newToday: null, diffYesterday: null,
        };
      } catch (err) {
        console.warn('[overview] _calcCommunitySummary 失败', err);
        return { total: 0, online: 0, offline: 0, warning: 0, onlineRate: 0 };
      }
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

    /** ---------- 设备列表 ----------
     * @param {string} [communityId]  传了则只显示本社区设备
     */
    async renderDevices(communityId) {
      const host = $('device-list-host');
      if (!host) return;
      let list;
      try {
        // 先调用 getList（返回分页 records），这样能拿到 communityId 字段用于社区层过滤
        const Api = global.DashboardApi;
        if (Api && Api.Device && typeof Api.Device.getList === 'function') {
          const page = await Api.Device.getList({ page: 1, pageSize: communityId ? 500 : 6 });
          let recs = (page && page.records) || [];
          // 社区层：前端按 communityId 过滤（后端若已按 JWT 隔离也只是双重保险）
          if (communityId && recs.length > 0) {
            const cid = String(communityId);
            const hasCidField = recs[0].communityId != null;
            if (hasCidField) {
              recs = recs.filter(r => String(r.communityId) === cid);
            }
          }
          // 取前 6 条展示（总览层）或全量（社区层）
          const sliceCount = communityId ? recs.length : Math.min(6, recs.length);
          recs = recs.slice(0, sliceCount);
          // 映射成前端列表项（复用 getRealtimeList 的字段名口径）
          list = recs.map(r => {
            const st = this._mapStatusFromRecord(r);
            return {
              id: String(r.id),
              name: r.deviceName || ('设备-' + String(r.id).slice(-5)),
              location: r.location || '--',
              status: st,
              communityId: r.communityId != null ? String(r.communityId) : null,
              model: r.deviceModel || '--',
            };
          });
        } else {
          // 降级：原 getRealtimeList
          list = await global.DashboardApi.Device.getRealtimeList(6);
        }
      } catch (err) {
        console.warn('[overview] devices 拉取失败', err);
      }
      if (!list || list.length === 0) {
        host.innerHTML = Overview._emptyHtml(communityId ? '本社区暂无设备' : '暂无设备状态数据');
        return;
      }
      render(host, list.map(d => Overview._deviceItem(d)));
    },

    /** 从后端原始 record 映射设备状态（与 mapDeviceStatus 口径一致，避免直接依赖 client.js 内部函数） */
    _mapStatusFromRecord(r) {
      const onlineStatus = String(r.onlineStatus != null ? r.onlineStatus : '').toUpperCase();
      if (onlineStatus === 'OFFLINE') return 'offline';
      const alarmCount = typeof r.activeAlarmCount === 'number' ? r.activeAlarmCount : 0;
      if (alarmCount >= 2) return 'danger';
      if (alarmCount === 1) return 'warning';
      const bat = typeof r.batteryLevel === 'number' ? r.batteryLevel : null;
      if (bat != null && bat < 20) return 'warning';
      return 'normal';
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
            // 只显示：设备总 ID + 名称 + 位置 + 状态
            create('div', { class: 'device-name', title: d.name }, [
              create('span', {
                style: 'display:inline-block;min-width:32px;padding:1px 5px;margin-right:6px;border-radius:3px;background:var(--bg-accent);color:var(--primary);font-size:10px;font-weight:600;',
                html: '#' + (d.id || '--'),
              }),
              create('span', { html: d.name || '未命名设备' }),
              create('span', {
                style: 'float:right;color:var(--text-dim);font-size:10px;',
                html: '›',
              }),
            ]),
            create('div', { class: 'device-loc' }, d.location || '未设置位置'),
          ]),
        ]),
        create('div', { class: 'device-status' + (statusCls ? ' ' + statusCls : '') }, statusText),
      ]);
      return dev;
    },

    /** 设备详情弹层（按规范：只展示 ID+名称+位置，其余字段收敛到趋势图或感知层详情） */
    _showDevicePop(e, d, statusText, statusValCls) {
      const UI = global.UI;
      const content = `
        <h4>
          <span style="padding:2px 8px;border-radius:4px;background:var(--bg-accent);color:var(--primary);font-size:12px;font-weight:600;">#${d.id || '--'}</span>
          ${d.name || '未命名设备'}
          <span class="device-status ${d.status === 'danger' ? 'danger' : d.status === 'warning' ? 'warn' : ''}" style="font-size:11px;padding:2px 8px;float:right;margin-top:4px;">${statusText}</span>
        </h4>
        <div class="info-grid" style="display:grid;grid-template-columns:1fr;gap:10px;">
          <div class="info-pair"><div class="info-pair-label">安装位置</div><div class="info-pair-value">${d.location || '未设置'}</div></div>
          <div class="info-pair"><div class="info-pair-label">建议操作</div><div class="info-pair-value warn">${
            d.status === 'danger' ? '请立即核实火情并消警' :
            d.status === 'warning' ? '尽快安排巡检' :
            d.status === 'offline' ? '检查供电与通信' :
            '点击设备卡片查看趋势分析'
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
      const expandGrid = document.getElementById('perception-expand-grid');
      // 旧版独立感知卡已移除；保留此刷新逻辑为放大视图提供实时数据。
      if (!host && !expandGrid) return;
      // 当前页面只保留单设备感知视图，直接刷新所选设备，避免再请求一个无法对应设备的聚合结果。
      if (!host) {
        if (expandGrid && Overview._currentLayer === 'perception') await this._refreshPerceptionExpand();
        return;
      }
      let list;
      try {
        list = await global.DashboardApi.Sensor.getPerception();
      } catch (err) {
        console.warn('[overview] perception 拉取失败', err);
      }
      if (!list || list.length === 0) {
        if (host) host.innerHTML = Overview._emptyHtml('等待感知层设备数据...');
        if (expandGrid && Overview._currentLayer === 'perception') {
          expandGrid.innerHTML = Overview._emptyHtml('等待感知层设备数据...');
        }
        return;
      }
      if (host) render(host, list.map(s => Overview._sensorCard(s)));
      // 放大视图只刷新当前选中的具体设备，不再把单设备数据伪装成汇总数据。
      if (expandGrid && Overview._currentLayer === 'perception') {
        if (this._perceptionDeviceId) {
          const banner = document.getElementById('perception-device-banner');
          const devId = this._perceptionDeviceId;
          const dev = (this._perceptionDevices || []).find(d => String(d.id) === String(devId));
          if (banner && dev) {
            const stTxt = dev.status === 'danger' ? '火警' : dev.status === 'warning' ? '预警' : dev.status === 'offline' ? '离线' : '正常';
            const stColor = dev.status === 'danger' ? '#ff4757' : dev.status === 'warning' ? '#ffa502' : dev.status === 'offline' ? '#7f8c8d' : '#2ed573';
            banner.innerHTML =
              '<b>#' + dev.id + '</b> ' + (dev.name || '未命名设备') +
              ' · <span style="color:var(--text-dim);">位置：' + (dev.location || '未设置') + '</span>' +
              ' · <span style="color:' + stColor + ';font-weight:600;">' + stTxt + '</span>' +
              ' · <span style="color:var(--text-dim);">最后心跳：' + (dev.lastHeartbeat || '未知') + '</span>';
          }
          this._renderPerceptionForDevice(devId, dev, expandGrid);
        }
      }
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
            title: provi ? '当前没有可用的真实感知读数' : s.badge,
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
        const hasBattery = typeof s.battery === 'number' && Number.isFinite(s.battery);
        const hasSignal = typeof s.signal === 'number' && Number.isFinite(s.signal);
        const bat = hasBattery ? Math.max(0, Math.min(100, s.battery)) : 0;
        const sig = hasSignal ? Math.max(0, Math.min(4, s.signal)) : 0;
        const batteryBox = create('div', { class: 'metric-row' }, [
          create('span', { class: 'm-label' }, '电量'),
          create('div', { class: 'battery' }, [
            create('div', { class: 'bat-fill', style: { width: (hasBattery ? bat : 0) + '%' } }),
            create('div', { class: 'bat-cap' }),
          ]),
          create('span', { class: 'm-num' + (provi ? ' dim' : '') },
            hasBattery ? bat + '%' : '--（暂无数据）'),
        ]);
        const signalBox = create('div', { class: 'metric-row' }, [
          create('span', { class: 'm-label' }, '信号'),
          create('div', { class: 'signal-bars' },
            [1, 2, 3, 4].map(i => create('div', { class: 'bar' + (i <= sig ? ' on' : '') }))
          ),
          create('span', { class: 'm-num' + (provi ? ' dim' : '') },
            hasSignal ? (sig <= 1 ? '弱' : sig <= 2 ? '一般' : sig <= 3 ? '良好' : '极强') : '--'),
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
