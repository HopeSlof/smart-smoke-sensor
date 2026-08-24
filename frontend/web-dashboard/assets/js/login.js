/**
 * login.js - 登录页表单逻辑
 * 依赖：auth.js (Auth)
 * —— 全量直接使用 document.getElementById，避免函数引用/作用域失效问题。
 */
(function (global) {
  'use strict';

  const REMEMBER_KEY = 'smoke.remember.user';

  const KNOWN_ROLES = ['user', 'community_admin', 'firefighter', 'system_admin'];

  const Login = {
    /** 当前选中角色：'user' | 'community_admin' | 'firefighter' | 'system_admin'（默认普通用户，更安全） */
    role: 'user',
    /** 注册视图当前角色：'user' | 'community_admin'（消防员/系统管理员不开放自助注册，由系统管理员后台创建） */
    regRole: 'user',
    _submitting: false,

    init() {
      this._bindTabs();
      this._bindTogglePwd();
      this._bindSubmit();
      this._bindViewSwitch();
      this._bindRegTabs();
      this._bindToggleRegPwd();
      this._bindRegister();
      this._fillRegCommunityOptions();
      this._restoreRemember();
      this._checkReason();
      // 如已登录 → 显示提示条，允许手动跳转 / 切换账号（不再强制无提示跳转，避免"登录界面不见了"）
      const s = global.Auth.getSession();
      if (s) {
        this._showLoggedInBanner(s);
      }
    },

    /* ---------- 登录/注册视图切换 ---------- */
    _bindViewSwitch() {
      const tabs = document.querySelectorAll('.view-tab');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const view = tab.getAttribute('data-view');
          tabs.forEach(t => { t.classList.toggle('is-active', t === tab); t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
          const loginPanel = document.getElementById('view-login');
          const regPanel   = document.getElementById('view-register');
          if (view === 'register') {
            if (loginPanel) loginPanel.hidden = true;
            if (regPanel)   regPanel.hidden = false;
          } else {
            if (regPanel)   regPanel.hidden = true;
            if (loginPanel) loginPanel.hidden = false;
          }
          this._hideError();
          this._hideRegError();
        });
      });
    },

    /* ---------- 注册角色 Tab ---------- */
    _bindRegTabs() {
      const tabs = document.querySelectorAll('[data-reg-role]');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
          tab.classList.add('is-active');
          tab.setAttribute('aria-selected', 'true');
          const v = tab.getAttribute('data-reg-role');
          this.regRole = (v === 'community_admin' || v === 'firefighter') ? v : 'user';
          // 消防员注册时归属小区改为可选（可负责全区）
          const cField = document.getElementById('reg-community');
          if (cField) {
            const label = document.querySelector('label[for="reg-community"]');
            if (this.regRole === 'firefighter') {
              cField.required = false;
              const opt = cField.querySelector('option[value=""]');
              if (opt) opt.textContent = '全区（不选则负责全部小区）';
              if (label) label.textContent = '责任小区';
            } else {
              cField.required = true;
              const opt = cField.querySelector('option[value=""]');
              if (opt) opt.textContent = '请选择归属小区';
              if (label) label.textContent = '归属小区';
            }
          }
          this._hideRegError();
        });
      });
    },

    /* ---------- 注册页密码眼睛 ---------- */
    _bindToggleRegPwd() {
      const tog = document.getElementById('toggleRegPwd');
      const pwd = document.getElementById('reg-password');
      if (!tog || !pwd) return;
      tog.addEventListener('click', () => {
        const show = pwd.type === 'password';
        pwd.type = show ? 'text' : 'password';
        tog.style.color = show ? 'var(--cyan)' : '';
      });
    },

    /* ---------- 填充注册页归属小区下拉 ---------- */
    async _fillRegCommunityOptions() {
      const sel = document.getElementById('reg-community');
      if (!sel) return;
      sel.innerHTML = '<option value="">请选择归属小区</option>';
      // 优先从后端 Community.getList 动态加载
      try {
        const Api = global.DashboardApi;
        if (Api && Api.Community && typeof Api.Community.getList === 'function') {
          const page = await Api.Community.getList({ pageSize: 500 });
          const records = (page && page.records) || [];
          records.forEach(c => {
            const opt = document.createElement('option');
            opt.value = String(c.id);
            opt.textContent = c.name || ('社区 ' + c.id);
            sel.appendChild(opt);
          });
          if (records.length) return;
        }
      } catch (err) {
        console.warn('[login] 从后端加载小区列表失败，降级用常量：', err);
      }
      // 降级：前端常量
      const list = (global.DashboardApi && global.DashboardApi.COMMUNITIES) || [];
      list.forEach(c => {
        const opt = document.createElement('option');
        opt.value = String(c.id);
        opt.textContent = c.name;
        sel.appendChild(opt);
      });
    },

    /* ---------- 注册错误提示 ---------- */
    _showRegError(msg) {
      const box = document.getElementById('registerError');
      if (!box) return;
      box.textContent = msg;
      box.hidden = false;
      box.style.animation = 'none';
      // eslint-disable-next-line no-unused-expressions
      box.offsetHeight;
      box.style.animation = '';
    },
    _hideRegError() {
      const box = document.getElementById('registerError');
      if (box) box.hidden = true;
    },

    /* ---------- 注册逻辑 ---------- */
    async register() { return this._doRegister(); },

    async _doRegister() {
      if (this._submitting) return false;
      const uEl  = document.getElementById('reg-username');
      const pEl  = document.getElementById('reg-password');
      const p2El = document.getElementById('reg-password2');
      const rnEl = document.getElementById('reg-realname');
      const phEl = document.getElementById('reg-phone');
      const cEl  = document.getElementById('reg-community');
      const btn  = document.getElementById('registerBtn');
      if (!uEl || !pEl || !p2El || !cEl || !rnEl || !phEl) {
        console.warn('[register] form elements not ready, retrying...');
        setTimeout(() => this.register(), 120);
        return false;
      }
      const username   = uEl.value.trim();
      const password   = pEl.value;
      const password2  = p2El.value;
      const realName   = rnEl.value.trim();
      const phone      = phEl.value.trim();
      const communityId = cEl.value;
      if (!username)        { this._showRegError('请输入账号'); uEl.focus(); return false; }
      if (!/^[A-Za-z0-9_]{2,20}$/.test(username)) { this._showRegError('账号需 2-20 位字母数字下划线'); uEl.focus(); return false; }
      if (!password)        { this._showRegError('请输入密码'); pEl.focus(); return false; }
      if (password.length < 4) { this._showRegError('密码至少 4 位'); pEl.focus(); return false; }
      if (password !== password2) { this._showRegError('两次密码不一致'); p2El.focus(); return false; }
      if (!realName)        { this._showRegError('请输入真实姓名'); rnEl.focus(); return false; }
      if (!phone)           { this._showRegError('请输入联系电话'); phEl.focus(); return false; }
      if (!/^[\d\-+\s()]{7,20}$/.test(phone)) { this._showRegError('请输入有效的联系电话'); phEl.focus(); return false; }
      // 消防员可不选小区（负责全区）；其他角色必须选
      const isFF = this.regRole === 'firefighter';
      if (!communityId && !isFF) { this._showRegError('请选择归属小区'); cEl.focus(); return false; }

      this._hideRegError();
      this._submitting = true;
      if (btn) btn.disabled = true;
      const btnTextEl = btn ? btn.querySelector('.btn-text') : null;
      const originalText = btnTextEl ? btnTextEl.innerHTML : '';
      if (btnTextEl) btnTextEl.innerHTML = '注册中…';

      try {
        const roleMap = {
          user: 'RESIDENT',
          community_admin: 'COMMUNITY_ADMIN',
          firefighter: 'FIREFIGHTER',
        };
        const result = await global.Auth.register({
          username, password,
          communityId: communityId ? Number(communityId) : null,
          realName, phone,
          role: roleMap[this.regRole] || 'RESIDENT',
        });
        if (!result.ok) {
          this._showRegError(result.msg || '注册失败');
          return false;
        }
        // 注册成功：后端返回 status=PENDING，不自动登录
        // 显示成功提示，2 秒后切回登录视图
        const okBox = document.getElementById('registerSuccess');
        if (okBox) {
          okBox.innerHTML = '✅ 注册成功！您的账号已提交至所属小区管理员审核，审核通过后即可登录。';
          okBox.hidden = false;
        }
        // 清空注册表单
        uEl.value = ''; pEl.value = ''; p2El.value = '';
        rnEl.value = ''; phEl.value = ''; cEl.value = '';
        // 2.5 秒后自动切回登录视图
        setTimeout(() => {
          if (okBox) okBox.hidden = true;
          const loginTab = document.querySelector('.view-tab[data-view="login"]');
          if (loginTab) loginTab.click();
        }, 2500);
        return true;
      } catch (e) {
        console.error('[register] 注册异常：', e);
        this._showRegError('注册失败：' + (e && e.message || '未知错误'));
        return false;
      } finally {
        setTimeout(() => {
          this._submitting = false;
          if (btn) btn.disabled = false;
          if (btnTextEl) btnTextEl.innerHTML = originalText;
        }, 800);
      }
    },

    /** 已有登录态时显示操作提示条 */
    _showLoggedInBanner(session) {
      const card = document.querySelector('.login-card');
      if (!card) return;
      const Auth = global.Auth;
      const roleText = (Auth && Auth.roleLabel) ? Auth.roleLabel(session.role) : (session.role === 'user' ? '普通用户' : '管理员');
      let nextText = '个人查询中心';
      if (session.role === 'system_admin')    nextText = '全局管理大屏';
      else if (session.role === 'community_admin') nextText = '小区管理大屏';
      else if (session.role === 'firefighter') nextText = '消防员指挥台';
      let countdown = 30;  // 30秒倒计时，足够用户看清登录界面并选择（立即进入/切换账号/暂不跳转）

      const banner = document.createElement('div');
      banner.className = 'login-banner';
      banner.innerHTML = `
        <div class="lb-head">
          <span class="lb-chip">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            自动进入倒计时 <strong class="lb-count">${countdown}</strong>s
          </span>
          <span class="lb-user">已登录：<strong>${roleText} · ${session.username}</strong></span>
        </div>
        <div class="lb-actions">
          <button type="button" class="lb-btn lb-btn-primary" data-act="go">
            立即进入${nextText}
          </button>
          <button type="button" class="lb-btn lb-btn-ghost" data-act="switch">
            切换账号（退出当前）
          </button>
          <button type="button" class="lb-btn lb-btn-text" data-act="cancel">
            暂不跳转，留在此页
          </button>
        </div>
      `;
      card.parentNode.insertBefore(banner, card);

      // 倒计时
      const timer = setInterval(() => {
        countdown -= 1;
        const countEl = banner.querySelector('.lb-count');
        if (countEl) countEl.textContent = countdown > 0 ? countdown : 0;
        if (countdown <= 0) {
          clearInterval(timer);
          global.Auth.redirectAfterLogin(session.role);
        }
      }, 1000);

      // 按钮绑定
      banner.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const act = btn.getAttribute('data-act');
          if (act === 'go') {
            clearInterval(timer);
            global.Auth.redirectAfterLogin(session.role);
          } else if (act === 'switch') {
            clearInterval(timer);
            global.Auth.clearSession();
            banner.remove();
            // 清空输入框，聚焦账号
            const u = document.getElementById('username');
            const p = document.getElementById('password');
            if (u) u.value = '';
            if (p) p.value = '';
            u?.focus();
          } else { // cancel
            clearInterval(timer);
            banner.remove();
          }
        });
      });
    },

    /**
     * 公开方法：供内联 onclick / onsubmit 直接调用（双重保险）
     */
    submit() { return this._doSubmit(); },

    /* ---------- 核心登录逻辑（异步对接后端 /users/login） ---------- */
    async _doSubmit() {
      if (this._submitting) return false;
      const uEl = document.getElementById('username');
      const pEl = document.getElementById('password');
      const btn = document.getElementById('submitBtn');
      const rEl = document.getElementById('remember');
      if (!uEl || !pEl) {
        // 偶发：页面元素尚未就绪
        console.warn('[login] form elements not ready, retrying...');
        setTimeout(() => this.submit(), 120);
        return false;
      }
      const username = uEl.value.trim();
      const password = pEl.value;
      if (!username) { this._showError('请输入账号'); uEl.focus(); return false; }
      if (!password) { this._showError('请输入密码'); pEl.focus(); return false; }
      const remember = !!rEl && rEl.checked;

      this._hideError();
      this._submitting = true;
      if (btn) btn.disabled = true;
      const btnTextEl = btn ? btn.querySelector('.btn-text') : null;
      const originalText = btnTextEl ? btnTextEl.innerHTML : '';
      if (btnTextEl) btnTextEl.innerHTML = '登录中…';

      try {
        // 调用后端登录，并校验账号角色与所选 Tab 是否匹配
        const result = await global.Auth.login({ username, password, expectedRole: this.role });
        if (!result.ok) {
          this._showError(result.msg || '登录失败');
          return false;
        }
        if (remember) {
          try { localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: result.username, role: result.role })); }
          catch (err) { /* ignore */ }
        } else {
          try { localStorage.removeItem(REMEMBER_KEY); } catch (err) { /* ignore */ }
        }
        global.Auth.redirectAfterLogin(result.role);
        return true;
      } catch (e) {
        console.error('[login] 登录异常：', e);
        this._showError('登录失败：' + (e && e.message || '未知错误'));
        return false;
      } finally {
        // 延迟恢复按钮，避免快速重复点击
        setTimeout(() => {
          this._submitting = false;
          if (btn) btn.disabled = false;
          if (btnTextEl) btnTextEl.innerHTML = originalText;
        }, 800);
      }
    },

    /* ---------- 角色 Tab 切换 ---------- */
    _bindTabs() {
      const tabs = document.querySelectorAll('.role-tab');
      const labels = document.querySelectorAll('[data-label]');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => {
            t.classList.remove('is-active');
            t.setAttribute('aria-selected', 'false');
          });
          tab.classList.add('is-active');
          tab.setAttribute('aria-selected', 'true');
          const raw = tab.getAttribute('data-role');
          this.role = KNOWN_ROLES.includes(raw) ? raw : 'user';

          // 同步登录按钮文案
          labels.forEach(el => { el.hidden = (el.getAttribute('data-label') !== this.role); });

          this._hideError();

          // 聚焦输入框
          setTimeout(() => document.getElementById('username')?.focus(), 50);
        });
      });
    },

    /* ---------- 密码眼睛 ---------- */
    _bindTogglePwd() {
      const tog = document.getElementById('togglePwd');
      const pwd = document.getElementById('password');
      if (!tog || !pwd) return;
      tog.addEventListener('click', () => {
        const show = pwd.type === 'password';
        pwd.type = show ? 'text' : 'password';
        tog.setAttribute('title', show ? '隐藏密码' : '显示密码');
        tog.style.color = show ? 'var(--cyan)' : '';
      });
    },

    /* ---------- 表单提交（主逻辑已经内联到 html onsubmit/onclick 调 Login.submit，这里做辅助） ---------- */
    _bindSubmit() {
      const form = document.getElementById('loginForm');
      const btn  = document.getElementById('submitBtn');
      const pwd  = document.getElementById('password');
      if (!form || !btn) return;
      // Enter 键直接登录
      const trySubmit = () => this.submit();
      form.addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); trySubmit(); return false; });
      btn.addEventListener('click',   (e) => { e.preventDefault(); e.stopPropagation(); trySubmit(); return false; });
      // 密码框按回车直接提交
      pwd?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); trySubmit(); }
      });
    },

    /* ---------- 注册表单提交绑定（主逻辑内联 onclick 调 LoginPage.register，这里辅助 Enter 键） ---------- */
    _bindRegister() {
      const form = document.getElementById('registerForm');
      const btn  = document.getElementById('registerBtn');
      const pwd2 = document.getElementById('reg-password2');
      const community = document.getElementById('reg-community');
      if (!form || !btn) return;
      const tryRegister = () => this.register();
      form.addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); tryRegister(); return false; });
      btn.addEventListener('click',   (e) => { e.preventDefault(); e.stopPropagation(); tryRegister(); return false; });
      // 确认密码框按回车直接提交
      pwd2?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); tryRegister(); }
      });
      // 选完小区也允许回车提交
      community?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); tryRegister(); }
      });
    },

    /* ---------- 记住账号 ---------- */
    _restoreRemember() {
      try {
        const raw = localStorage.getItem(REMEMBER_KEY);
        if (!raw) return;
        const { username, role } = JSON.parse(raw);
        if (username) {
          const u = document.getElementById('username');
          if (u) u.value = username;
        }
        if (role && KNOWN_ROLES.includes(role)) {
          const tab = document.querySelector(`.role-tab[data-role="${role}"]`);
          if (tab) tab.click();
          const r = document.getElementById('remember');
          if (r) r.checked = true;
        }
        setTimeout(() => document.getElementById('password')?.focus(), 100);
      } catch (err) { /* ignore */ }
    },

    /* ---------- 错误提示 ---------- */
    _showError(msg) {
      const box = document.getElementById('loginError');
      if (!box) return;
      box.textContent = msg;
      box.hidden = false;
      box.style.animation = 'none';
      // eslint-disable-next-line no-unused-expressions
      box.offsetHeight;
      box.style.animation = '';
    },
    _hideError() {
      const box = document.getElementById('loginError');
      if (box) box.hidden = true;
    },

    /* ---------- 忘记密码 ---------- */
    showForgot() {
      const mask = document.createElement('div');
      mask.className = 'fg-mask';
      mask.innerHTML = `
        <div class="fg-dialog" role="dialog" aria-modal="true" aria-label="忘记密码">
          <div class="fg-head">
            <div class="fg-title">忘记密码</div>
            <button class="fg-close" aria-label="关闭">×</button>
          </div>
          <div class="fg-sub">输入登录账号与注册时绑定的手机号，即可重置密码</div>
          <div class="fg-field">
            <label class="fg-label">登录账号</label>
            <input id="fg-username" class="fg-input" type="text" placeholder="请输入登录账号" autocomplete="username"/>
          </div>
          <div class="fg-field">
            <label class="fg-label">绑定手机号</label>
            <input id="fg-phone" class="fg-input" type="tel" placeholder="注册时填写的联系电话"/>
          </div>
          <div class="fg-field">
            <label class="fg-label">新密码</label>
            <input id="fg-password" class="fg-input" type="password" placeholder="至少 4 位" autocomplete="new-password"/>
          </div>
          <div class="fg-err" id="fg-err"></div>
          <div class="fg-actions">
            <button class="btn btn-ghost" id="fg-cancel" type="button">取消</button>
            <button class="btn btn-primary" id="fg-submit" type="button">重置密码</button>
          </div>
        </div>`;
      document.body.appendChild(mask);

      const close = () => { if (mask.parentNode) mask.parentNode.removeChild(mask); };
      const showErr = (msg) => { const e = mask.querySelector('#fg-err'); if (e) e.textContent = msg; };

      mask.querySelector('.fg-close').addEventListener('click', close);
      mask.querySelector('#fg-cancel').addEventListener('click', close);
      mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
      const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);

      const submitBtn = mask.querySelector('#fg-submit');
      submitBtn.addEventListener('click', async () => {
        const username = mask.querySelector('#fg-username').value.trim();
        const phone = mask.querySelector('#fg-phone').value.trim();
        const newPassword = mask.querySelector('#fg-password').value;
        if (!username) { showErr('请输入登录账号'); return; }
        if (!phone) { showErr('请输入绑定手机号'); return; }
        if (!newPassword || newPassword.length < 4) { showErr('新密码至少 4 位'); return; }
        submitBtn.disabled = true;
        submitBtn.textContent = '重置中…';
        try {
          await global.DashboardApi.User.resetPasswordByPhone({ username, phone, newPassword });
          close();
          alert('密码重置成功，请使用新密码登录');
        } catch (e) {
          showErr((e && e.message) || '重置失败，请稍后重试');
          submitBtn.disabled = false;
          submitBtn.textContent = '重置密码';
        }
      });
    },

    /* ---------- URL reason 提示 ---------- */
    _checkReason() {
      const params = new URLSearchParams(window.location.search);
      const reason = params.get('reason');
      if (!reason) return;
      let msg = '';
      switch (reason) {
        case 'timeout':   msg = '登录已过期，请重新登录'; break;
        case 'need-admin':msg = '该页面需要管理员权限，请以管理员身份登录'; break;
        case 'need-login':msg = '请先登录后再访问'; break;
        case 'logged-out':msg = '您已安全退出'; break;
        default: break;
      }
      if (msg) this._showError(msg);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Login.init());
  } else {
    Login.init();
  }
  global.LoginPage = Login;
})(window);
