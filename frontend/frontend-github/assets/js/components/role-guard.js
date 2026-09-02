/**
 * components/role-guard.js - 三角色权限 UI 守卫
 * ------------------------------------------------------------
 * 设计依据：设计文档 2.1 干系人与角色 / 2.2 功能需求（10条用户故事）
 *   · SYSTEM_ADMIN  系统管理员：AI视觉复核(US-08)、联动广播(US-10)、阈值/联动/接入/存储全局配置
 *   · COMMUNITY_ADMIN 小区管理员：设备总览/绑定管理/告警日志(US-05/06/07)，不可操作全局功能
 *   · RESIDENT 普通用户：仅本人绑定设备/告警
 *
 * 用法：所有模块 init 完成后调用 RoleGuard.apply()，自动：
 *   1. 按当前登录角色隐藏/禁用专属入口
 *   2. 对小区管理员显示「数据范围：仅本小区」提示条
 *   3. 设置弹窗 Tab 按角色过滤（阈值/联动/接入/存储仅系统管理员可见）
 */
(function (global) {
  'use strict';

  const { $, create } = global.DomUtil;

  /** 需要 SYSTEM_ADMIN 角色才可见的元素 ID/选择器 */
  const SYSTEM_ADMIN_ONLY_SELECTORS = [
    '#btn-broadcast',            // 顶部工具栏「紧急广播」按钮
    '#broadcast-modal',          // 紧急广播弹窗（隐藏按钮即可，弹窗本身不可通过其他方式打开）
    '.review-stats',             // AI 复核统计卡容器
    '.review-list',              // AI 复核列表容器
  ];

  /** 需要 SYSTEM_ADMIN 角色才可见的 AI 视觉复核整块面板（index.html 里的 sub-panel）
   *  该面板没有 id，通过内部标题 h3 文本匹配来定位其父容器 */
  function hideAiReviewPanel(role) {
    if (role === 'system_admin') return;
    // 找标题文本包含「AI 视觉复核」的 .sub-panel
    const h3s = document.querySelectorAll('.sub-panel h3');
    h3s.forEach(h3 => {
      if (h3.textContent && h3.textContent.includes('AI 视觉复核')) {
        const panel = h3.closest('.sub-panel');
        if (panel) panel.style.display = 'none';
      }
    });
    // 同时把 review.js 挂载的容器清掉，避免组件尝试渲染报空
    const rs = $('review-stats-host');
    const rh = $('review-host');
    if (rs) rs.style.display = 'none';
    if (rh) rh.style.display = 'none';
  }

  /** 设置弹窗里的 Tab：仅系统管理员可见的 Tab data-tab 值 */
  const SETTINGS_TABS_SYSTEM_ONLY = [
    'tab-thresholds',    // 📈 告警阈值
    'tab-linkage',       // 🔗 联动策略
    'tab-integration',   // 🌐 系统接入（含 AI Base URL / Token）
    'tab-storage',       // 💾 存储与缓存
  ];
  /** 仅居民（RESIDENT）必须隐藏的 Tab：社区管理 + 用户审核
   *  社区管理：小区管理员"只读"可见、系统管理员"可读写"可见
   *  用户审核：小区管理员"仅审核本小区"可见、系统管理员"全局"可见 */
  const SETTINGS_TABS_RESIDENT_HIDE = [
    'tab-community',     // 🏘️ 社区管理
    'tab-user-audit',    // 👥 用户与审核
    'tab-camera',        // 📷 摄像头管理
  ];
  /** 对应的 Tab 内容面板，id 与 data-tab 值一致 */

  function applySettingsTabFilter(role) {
    // 1) 非系统管理员：隐藏 SYSTEM_ONLY 的 Tab
    const hideSystemTabs = role !== 'system_admin';
    if (hideSystemTabs) {
      SETTINGS_TABS_SYSTEM_ONLY.forEach(tabId => {
        const btn = document.querySelector('#settings-tabs .tab-item[data-tab="' + tabId + '"]');
        if (btn) btn.style.display = 'none';
        const panel = document.getElementById(tabId);
        if (panel) panel.style.display = 'none';
      });
    }
    // 2) 居民（role=user / resident）：隐藏社区管理 & 用户审核 Tab
    const roleNorm = String(role || '').toLowerCase();
    const isResident = roleNorm === 'resident' || roleNorm === 'user';
    if (isResident) {
      SETTINGS_TABS_RESIDENT_HIDE.forEach(tabId => {
        const btn = document.querySelector('#settings-tabs .tab-item[data-tab="' + tabId + '"]');
        if (btn) btn.style.display = 'none';
        const panel = document.getElementById(tabId);
        if (panel) panel.style.display = 'none';
      });
    }
    // 3) 如果当前激活的 Tab 被隐藏了，强制切到第一个可见的 Tab（通知设置 tab-notify）
    const hiddenSet = new Set();
    if (hideSystemTabs) SETTINGS_TABS_SYSTEM_ONLY.forEach(t => hiddenSet.add(t));
    if (isResident) SETTINGS_TABS_RESIDENT_HIDE.forEach(t => hiddenSet.add(t));
    const activeTab = document.querySelector('#settings-tabs .tab-item.active');
    if (activeTab) {
      const activeTabVal = activeTab.getAttribute('data-tab');
      if (hiddenSet.has(activeTabVal)) {
        activeTab.classList.remove('active');
        activeTab.setAttribute('aria-selected', 'false');
        // 按顺序找第一个可见的 Tab 作为 fallback
        const allBtns = document.querySelectorAll('#settings-tabs .tab-item');
        let fallback = null;
        for (let i = 0; i < allBtns.length; i++) {
          const v = allBtns[i].getAttribute('data-tab');
          const disp = allBtns[i].style.display;
          if (disp !== 'none' && !hiddenSet.has(v)) { fallback = allBtns[i]; break; }
        }
        if (!fallback) fallback = document.querySelector('#settings-tabs .tab-item[data-tab="tab-notify"]');
        if (fallback) {
          fallback.classList.add('active');
          fallback.setAttribute('aria-selected', 'true');
          // 同步面板显隐
          const curPanel = document.getElementById(activeTabVal);
          if (curPanel) curPanel.style.display = 'none';
          const fbId = fallback.getAttribute('data-tab');
          const fbPanel = fbId && document.getElementById(fbId);
          if (fbPanel) fbPanel.style.display = '';
        }
      }
    }
    // 4) 修改副标题文案（系统管理员保持原文案）
    const sub = $('settings-modal-sub');
    if (sub) {
      if (role === 'system_admin') {
        sub.textContent = '系统管理员可维护阈值、联动策略、社区/用户等所有全局设置。';
      } else if (roleNorm === 'community_admin') {
        sub.textContent = '管理通知策略、账号安全；可审核本小区注册与住户绑定；阈值/联动/接入等全局设置需联系系统管理员';
      } else {
        sub.textContent = '管理通知策略与账号安全；全局配置、社区管理、用户审核请联系管理员';
      }
    }
  }

  /** 优先使用登录接口返回的小区名称；没有名称时只显示 ID，避免前端伪造社区数据。 */
  function resolveCommunityName(session) {
    if (!session) return '';
    if (session.communityName) return session.communityName;
    const cid = session.communityId;
    if (!cid && cid !== 0 && cid !== '0') return '';
    return '小区 #' + String(cid);
  }

  /** 在顶部 header-status 左侧加「数据范围」提示条（仅小区管理员/普通用户） */
  function ensureScopeBanner(session) {
    const role = session && session.role;
    const existing = $('role-scope-banner');
    if (!role || role === 'system_admin') {
      if (existing) existing.remove();
      return;
    }
    const cname = resolveCommunityName(session);
    let text = '数据范围：仅本小区数据';
    let cls = 'scope-banner-community';
    if (role === 'user') {
      text = cname ? ('数据范围：「' + cname + '」· 仅本人绑定设备') : '数据范围：仅本人绑定设备';
      cls = 'scope-banner-resident';
    } else if (role === 'community_admin') {
      if (cname) {
        text = '数据范围：「' + cname + '」· 仅本小区';
      } else {
        text = '数据范围：仅本小区';
      }
    }
    const tooltip = role === 'community_admin'
      ? '您当前为小区管理员身份，只能查看和管理您所属小区的设备与告警；阈值配置、跨小区数据、广播控制等需联系系统管理员。'
      : '您当前为普通用户身份，仅可查看与您本人绑定的设备及相关告警。';

    // 已存在 → 只做一次文本/类名/tooltip 校准，避免被 header._fetchStatus 等覆盖后失效
    if (existing) {
      existing.textContent = text;
      existing.className = 'status-chip ' + cls;
      existing.title = tooltip;
      return;
    }

    const host = document.querySelector('.header-status');
    if (!host) return;
    const banner = create('div', {
      id: 'role-scope-banner',
      class: 'status-chip ' + cls,
      text: text,
      title: tooltip,
    });
    host.insertBefore(banner, host.firstChild);
  }

  /** 登录后首次进入大屏：若为小区管理员，Toast 提示所属小区 */
  function toastScopeWelcome(session) {
    const role = session && session.role;
    if (role !== 'community_admin') return;
    const UI = global.UI;
    if (!UI || !UI.Toast) return;
    const cname = resolveCommunityName(session);
    let msg = '欢迎回来，您当前为小区管理员身份，仅可管理本小区设备与告警。';
    if (cname) {
      msg = '欢迎回来，您所属小区为「' + cname + '」，仅可管理本小区设备与告警。';
    }
    // 延迟一点等 Toast 组件就绪
    setTimeout(() => { try { UI.Toast.info(msg, 4500); } catch (_) {} }, 1200);
  }

  /** 隐藏 SYSTEM_ADMIN 专属元素 */
  function hideSystemAdminOnly(role) {
    if (role === 'system_admin') return;
    SYSTEM_ADMIN_ONLY_SELECTORS.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.style.display = 'none';
    });
  }

  /** 设备管理弹窗：仅系统管理员可「物理删除」；
   *  小区管理员保留「解绑」（设计文档 US-06 明确小区管理员可新增/解绑设备）；
   *  本项目前端当前只做解绑，不做物理删除，因此对 device-mgr 保持不变。
   *  若未来加入删除按钮，可在此处按角色禁用。 */

  const RoleGuard = {
    /** 对外：一次性应用所有角色守卫。在所有模块 init 完之后调用。 */
    apply() {
      const Auth = global.Auth;
      const s = Auth && typeof Auth.getSession === 'function' ? Auth.getSession() : null;
      if (!s) return;
      const role = s.role;

      try {
        hideSystemAdminOnly(role);
      } catch (e) { console.warn('[RoleGuard] hideSystemAdminOnly 失败', e); }

      try {
        hideAiReviewPanel(role);
      } catch (e) { console.warn('[RoleGuard] hideAiReviewPanel 失败', e); }

      try {
        applySettingsTabFilter(role);
      } catch (e) { console.warn('[RoleGuard] applySettingsTabFilter 失败', e); }

      try {
        ensureScopeBanner(s);
      } catch (e) { console.warn('[RoleGuard] ensureScopeBanner 失败', e); }

      try {
        toastScopeWelcome(s);
      } catch (e) { /* noop */ }
    },

    /** 供 settings.js 在弹窗打开时再次校准 Tab（防止动态渲染把隐藏的 Tab 又显示出来） */
    recalibrateSettingsTabs() {
      const Auth = global.Auth;
      const s = Auth && typeof Auth.getSession === 'function' ? Auth.getSession() : null;
      if (!s) return;
      try { applySettingsTabFilter(s.role); } catch (_) {}
    },
  };

  global.RoleGuard = RoleGuard;
})(window);
