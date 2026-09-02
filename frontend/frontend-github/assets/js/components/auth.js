/**
 * components/auth.js - 登录状态管理 + 路由守卫
 * --------------------------------------------------
 * 状态存储：localStorage['smoke.auth']
 *   结构: { role: 'system_admin'|'community_admin'|'user', username: string, loginAt: number, communityId?: string }
 *
 * 用法：
 *   // 1) 管理大屏：允许 system_admin + community_admin 两档管理员
 *   Auth.requireRole('admin');
 *
 *   // 2) 仅系统管理员（全局阈值/用户管理等）
 *   Auth.requireRole('system_admin');
 *
 *   // 3) 普通用户个人查询中心（任何登录态均放行）
 *   Auth.requireRole('user');
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'smoke.auth';

  const KNOWN_ROLES = new Set(['system_admin', 'community_admin', 'firefighter', 'user']);

  const Auth = {
    /** 四角色对应首页：两档管理员都进管理大屏；消防员进专属大屏；普通用户进个人中心 */
    INDEX_PAGES: {
      system_admin:    'index.html',
      community_admin: 'index.html',
      firefighter:     'firefighter.html',
      user:            'user.html',
    },
    ROLE_LABELS: {
      system_admin:    '系统管理员',
      community_admin: '小区管理员',
      firefighter:     '消防员',
      user:            '普通用户',
    },
    LOGIN_PAGE: 'login.html',

    /* ---------- 状态读写 ---------- */
    getSession() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || !obj.role || !obj.username) return null;
        if (!KNOWN_ROLES.has(obj.role)) return null;
        return obj;
      } catch (err) {
        console.warn('[auth] 读取登录态失败', err);
        return null;
      }
    },
    setSession({ role, username, token, userId, communityId, communityName, realName, phone }) {
      const r = String(role || '').toLowerCase();
      const safeRole = KNOWN_ROLES.has(r) ? r : 'user';
      const payload = {
        role: safeRole,
        username: String(username || '').trim(),
        token: token || '',
        userId: userId != null ? String(userId) : '',
        communityId: communityId != null ? String(communityId) : '',
        communityName: communityName || '',
        realName: realName || '',
        phone: phone || '',
        loginAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return payload;
    },
    /** 后端角色枚举 → 前端四角色 code */
    mapBackendRole(backendRole) {
      const r = String(backendRole || '').toUpperCase();
      if (r === 'SYSTEM_ADMIN') return 'system_admin';
      if (r === 'COMMUNITY_ADMIN') return 'community_admin';
      if (r === 'FIREFIGHTER') return 'firefighter';
      return 'user';
    },
    /** 角色 code → 中文展示名 */
    roleLabel(code) {
      return this.ROLE_LABELS[code] || '普通用户';
    },
    /**
     * 真实登录（对接后端 POST /users/login）
     * @returns {Promise<{ok:boolean, role?:string, username?:string, msg?:string}>}
     */
    async login({ username, password, expectedRole }) {
      const name = String(username || '').trim();
      const pwd  = String(password || '');
      if (name.length < 2) return { ok: false, msg: '账号长度至少 2 位' };
      if (pwd.length  < 4) return { ok: false, msg: '密码长度至少 4 位' };
      try {
        const data = await global.DashboardApi.User.login({ username: name, password: pwd });
        const role = this.mapBackendRole(data && data.role);
        // 角色不匹配校验：用户在登录页选了某角色 Tab，但账号实际角色不一致 → 拒绝登录
        // 防止「选小区管理员 Tab + 输入 user01 账号」这种误用
        if (expectedRole && role !== expectedRole) {
          const expectedLabel = this.ROLE_LABELS[expectedRole] || expectedRole;
          const actualLabel   = this.ROLE_LABELS[role] || role;
          return { ok: false, msg: `该账号不是${expectedLabel}，请改选「${actualLabel}」Tab 后再登录` };
        }
        this.setSession({
          role,
          username: (data && data.username) || name,
          token: data && data.token,
          userId: data && data.userId,
          communityId: data && (data.communityId ?? data.community_id),
          communityName: data && data.communityName,
          realName: data && data.realName,
          phone: data && data.phone,
        });
        return { ok: true, role, username: (data && data.username) || name };
      } catch (e) {
        const msg = (e && e.message) || '登录失败，请检查账号密码';
        // 后端登录状态校验：PENDING → "账号待审核"，DISABLED → "账号已被禁用"
        if (/pending|待审核/i.test(msg))  return { ok: false, msg: '账号待审核，请等待小区管理员审核通过后再登录' };
        if (/disabled|已禁用|已冻结/i.test(msg)) return { ok: false, msg: '账号已被禁用，请联系管理员' };
        return { ok: false, msg };
      }
    },
    clearSession() {
      localStorage.removeItem(STORAGE_KEY);
      // 兼容遗留：同时清 remember 过的密码（可选）
      // localStorage.removeItem('smoke.remember');
    },
    isLoggedIn() { return !!this.getSession(); },

    /**
     * 注册（对接后端 POST /users/register）
     * 后端角色白名单允许 RESIDENT / COMMUNITY_ADMIN / FIREFIGHTER；
     * 小区管理员注册时无需选小区（审核时由系统管理员指定管理范围）；
     * 注册成功后不自动登录（需等待管理员审核通过，status=ACTIVE 后才能登录）。
     * @param {object} param { username, password, communityId, realName, phone, role }
     * @returns {Promise<{ok:boolean, username?:string, msg?:string}>}
     */
    async register({ username, password, communityId, realName, phone, role }) {
      const name = String(username || '').trim();
      const pwd  = String(password || '');
      if (name.length < 2) return { ok: false, msg: '账号长度至少 2 位' };
      if (pwd.length  < 4) return { ok: false, msg: '密码长度至少 4 位' };
      if (!realName)     return { ok: false, msg: '请填写真实姓名' };
      if (!phone)        return { ok: false, msg: '请填写联系电话' };
      try {
        const data = await global.DashboardApi.User.register({
          username: name,
          password: pwd,
          communityId: communityId || null,
          realName,
          phone,
          role,
        });
        // 注册成功但 status=PENDING，不写入登录态
        // 后端可能返回 { code, errorMsg, data: null } 或直接返回对象
        return { ok: true, username: name };
      } catch (e) {
        return { ok: false, msg: (e && e.message) || '注册失败，请稍后重试' };
      }
    },

    /** 基于当前页面 pathname 计算绝对路径（避免子目录 /web-dashboard/ 下相对路径解析歧义） */
    _resolveUrl(relativePage) {
      try {
        const pn = window.location.pathname || '/';
        const lastSlash = pn.lastIndexOf('/');
        const base = lastSlash >= 0 ? pn.substring(0, lastSlash + 1) : '/';
        const combined = base + relativePage;
        // 只保留 relativePage 本身带有的 query/hash，不继承当前页面的
        return combined.replace(/([^:])\/+/g, '$1/');
      } catch (_) {
        return relativePage; // fallback：退回到相对路径
      }
    },

    /* ---------- 登出 ---------- */
    logout({ redirect = true, reason } = {}) {
      // 退出前主动断开 WebSocket，避免连接泄漏 / 旧 token 继续接收推送
      try {
        if (global.WS && typeof global.WS.disconnect === 'function') {
          global.WS.disconnect();
        }
      } catch (_) { /* ignore */ }
      try {
        this.clearSession();
      } catch (err) {
        console.error('[auth] 清理登录态失败：', err);
      }
      if (redirect) {
        try {
          const basePage = this.LOGIN_PAGE + (reason ? `?reason=${encodeURIComponent(reason)}` : '');
          const absUrl = this._resolveUrl(basePage);
          console.info('[auth] 退出，跳转至：', absUrl);
          window.location.replace(absUrl);
        } catch (err) {
          console.error('[auth] 跳转登录页失败，尝试 fallback：', err);
          // fallback：直接用 document.location 兜底
          try { document.location.href = this.LOGIN_PAGE + (reason ? `?reason=${encodeURIComponent(reason)}` : ''); }
          catch (e2) { /* last resort: meta refresh 也可以，但这里就抛错吧 */ console.error(e2); }
        }
      }
    },

    /* ---------- 登录后跳转到对应首页 ---------- */
    redirectAfterLogin(role) {
      try {
        const page = this.INDEX_PAGES[role] || this.INDEX_PAGES.user;
        // 支持 login.html?next=xxx 跳回来源页
        const params = new URLSearchParams(window.location.search);
        const next = params.get('next');
        const safeNext = (next && /^[a-zA-Z0-9_\-./?=&%#]+$/.test(next)) ? next : '';
        const target = safeNext || page;
        const absUrl = this._resolveUrl(target);
        console.info('[auth] 登录后跳转：', absUrl);
        window.location.replace(absUrl);
      } catch (err) {
        console.error('[auth] 登录后跳转失败：', err);
        try { document.location.href = this.INDEX_PAGES[role] || this.INDEX_PAGES.user; }
        catch (e2) { console.error(e2); }
      }
    },

    /* ---------- 路由守卫：未登录/角色不对 → 跳转 ---------- */
    requireRole(required) {
      const s = this.getSession();
      if (!s) {
        // 未登录 → 跳登录，把当前地址放在 next 参数
        const current = window.location.pathname.split('/').pop() + window.location.search + window.location.hash;
        const qs = new URLSearchParams({ next: current }).toString();
        try {
          const absUrl = this._resolveUrl(this.LOGIN_PAGE + `?${qs}`);
          console.info('[auth] 未登录，跳登录：', absUrl);
          window.location.replace(absUrl);
        } catch (err) {
          console.error('[auth] 守卫跳转失败：', err);
          try { document.location.href = this.LOGIN_PAGE + `?${qs}`; }
          catch (e2) { console.error(e2); }
        }
        return false;
      }

      // 支持数组形式：requireRole(['firefighter', 'system_admin'])
      if (Array.isArray(required)) {
        if (required.includes(s.role)) return true;
        // 不在允许列表 → 跳回对应首页
        const target = this.INDEX_PAGES[s.role] || 'index.html';
        console.warn('[auth] 当前角色不在允许列表中，跳回：', target);
        try { window.location.replace(this._resolveUrl(target)); }
        catch (e) { document.location.href = target; }
        return false;
      }

      if (required === '*') return true;
      const isSysAdmin = s.role === 'system_admin';
      const isAnyAdmin = isSysAdmin || s.role === 'community_admin';

      // requireRole('admin') = 任何管理员角色（system + community）
      if (required === 'admin' && !isAnyAdmin) {
        this.logout({ reason: 'need-admin' });
        return false;
      }
      // requireRole('system_admin') = 仅限系统管理员
      if (required === 'system_admin' && !isSysAdmin) {
        this.logout({ reason: 'need-admin' });
        return false;
      }
      // requireRole('user') = 仅限普通用户角色
      if (required === 'user') {
        if (s.role !== 'user') {
          const target = this.INDEX_PAGES[s.role] || 'index.html';
          console.warn('[auth] 非普通用户角色尝试访问 user 页面，跳回：', target);
          try { window.location.replace(this._resolveUrl(target)); }
          catch (e) { document.location.href = target; }
          return false;
        }
        return true;
      }

      // requireRole('firefighter') = 仅限消防员
      if (required === 'firefighter' && s.role !== 'firefighter') {
        const target = this.INDEX_PAGES[s.role] || 'index.html';
        console.warn('[auth] 非消防员角色尝试访问 firefighter 页面，跳回：', target);
        try { window.location.replace(this._resolveUrl(target)); }
        catch (e) { document.location.href = target; }
        return false;
      }

      // 其他未知 required，默认放行
      return true;
    },

    /* ---------- 设置联动：记住账号 & 会话 TTL ---------- */

    /** 记住账号偏好（settings 中修改）：保存到 localStorage */
    setRememberPreference(enabled) {
      try {
        if (enabled) localStorage.setItem('smoke.auth.rememberPref', '1');
        else localStorage.removeItem('smoke.auth.rememberPref');
      } catch (_) { /* ignore */ }
    },
    getRememberPreference() {
      try { return localStorage.getItem('smoke.auth.rememberPref') === '1'; }
      catch (_) { return true; }
    },

    /** 会话 TTL（秒），0 = 关闭自动登录。读取 settings 中配置 */
    setSessionTtlSeconds(sec) {
      try {
        localStorage.setItem('smoke.auth.sessionTtl', String(Number(sec) || 0));
      } catch (_) { /* ignore */ }
    },
    getSessionTtlSeconds() {
      try {
        const v = localStorage.getItem('smoke.auth.sessionTtl');
        if (v === null) return 7200; // 默认 2 小时
        return Number(v) || 0;
      } catch (_) { return 7200; }
    },
  };

  global.Auth = Auth;
})(window);
