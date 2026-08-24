/**
 * components/settings.js - 系统设置（告警阈值 / 通知 / 联动 / 账号 / 接入 / 存储）
 * 数据源：
 *   DashboardApi.Settings.getAll → 读取所有配置
 *   DashboardApi.Settings.save   → 保存配置
 *   DashboardApi.Settings.changePassword → 修改密码
 *   localStorage[smoke.settings] → 本地兜底（Mock 无后端时）
 * 交互：
 *   header 工具栏「⚙️ 系统设置」按钮 → 打开 Modal → 6 个分组 Tab → 底部统一保存
 */
(function (global) {
  'use strict';

  const { $ } = global.DomUtil;

  const STORAGE_KEY = 'smoke.settings';

  // 默认值（对应 HTML 中的默认 value）
  const DEFAULTS = {
    thresholds: {
      smokeLow:    60,
      smokeHigh:   120,
      tempHigh:    60,
      coHigh:      50,
      durationSec: 10,
      recoverySec: 30,
    },
    notify: {
      app:        true,
      sms:        false,
      email:      true,
      voiceCall:  false,
      screen:     true,
      targets:    '',
      timeoutSec: 300,
      escalation: '',
    },
    linkage: {
      sound:         'high',
      vent:          'high',
      valve:         'none',
      light:         'low',
      broadcastTpl:  '【智慧烟感】{$area} 区域检测到烟雾浓度超标，请 {$owner} 立即检查并有序撤离。',
      cooldownSec:   120,
    },
    account: {
      sessionSec: 7200,
      remember:   true,
    },
    integration: {
      apiBase:  '',
      mqtt:     '',
      aiBase:   '',
      // token 从不回显，只在输入时保存
    },
  };

  // 保留键列表，清理时不能动
  const PROTECTED_KEYS = new Set([
    'smoke.auth', 'smoke.settings', 'smoke.remember', 'smoke.accounts',
  ]);

  const Settings = {

    init() {
      try {
        this._bind();
        // 不论 HTML 里的关闭按钮 / 遮罩点击 / Esc 怎么关 Modal，都能在事件里复位
        document.addEventListener('modal-closed:settings-modal', () => {
          this._opened = false;
        });
      } catch (err) { console.error('[settings] init 失败：', err); }
    },

    /* ---------- 打开 / 关闭 ---------- */

    open() {
      if (this._opened) return;
      try {
        this._opened = true;
        global.UI?.Modal?.open('settings-modal');

        // 按角色确定默认 Tab：系统管理员→阈值，小区管理员/用户→通知设置
        let defaultTab = 'tab-thresholds';
        const Auth = global.Auth;
        const s = Auth && typeof Auth.getSession === 'function' ? Auth.getSession() : null;
        if (s && s.role !== 'system_admin') {
          defaultTab = 'tab-notify';
        }
        this._switchTab(defaultTab);

        // 打开弹窗后再校准一次 Tab 可见性（防止 Modal 动画/动态渲染把之前隐藏的 Tab 又显示出来）
        try {
          if (global.RoleGuard && typeof global.RoleGuard.recalibrateSettingsTabs === 'function') {
            global.RoleGuard.recalibrateSettingsTabs();
          }
        } catch (_) {}

        this._loadAll();
      } catch (err) {
        this._opened = false;
        console.error('[settings] open 失败：', err);
      }
    },

    close() {
      this._opened = false;
      global.UI?.Modal?.close('settings-modal');
    },

    /* ---------- 绑定 ---------- */

    _bind() {
      // 工具栏按钮 → 打开弹窗（双重兜底：addEventListener + 内联 onclick 都可触发此 open 方法）
      // 注意：settings.js 绑定一次，header.js 不再重复绑定，避免同一按钮发两次 click 导致守卫误判
      const btn = $('btn-settings');
      if (btn && !btn.dataset.settingsBound) {
        btn.dataset.settingsBound = '1';
        btn.addEventListener('click', () => this.open());
      }

      // Tabs 切换
      $('settings-tabs')?.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.tab-item');
        if (!tabBtn) return;
        const tabId = tabBtn.getAttribute('data-tab');
        if (tabId) this._switchTab(tabId);
      });

      // 保存所有
      $('settings-save-all')?.addEventListener('click', () => this._saveAll());

      // Tab 4: 修改密码
      $('s-a-submit')?.addEventListener('click', () => this._submitChangePassword());

      // Tab 5: 连接测试
      $('s-i-test-api')?.addEventListener('click', () => this._testConnectivity('api'));
      $('s-i-test-mqtt')?.addEventListener('click', () => this._testConnectivity('mqtt'));
      $('s-i-test-ai')?.addEventListener('click', () => this._testConnectivity('ai'));

      // Tab 6: 缓存清理 / 重置 / 导入导出
      $('s-s-clean-ui')?.addEventListener('click', () => this._cleanCache('ui'));
      $('s-s-clean-app')?.addEventListener('click', () => this._cleanCache('app'));
      $('s-s-reset-all')?.addEventListener('click', () => this._resetAll());
      $('s-s-export')?.addEventListener('click', () => this._exportConfig());
      $('s-s-import-btn')?.addEventListener('click', () => $('s-s-import-file')?.click());
      $('s-s-import-file')?.addEventListener('change', (e) => this._importFile(e));

      // ========== Tab 7: 社区管理 ==========
      const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
      const debounce = (fn, ms) => {
        let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
      };
      on('s-c-search', 'input', debounce(() => { this._community.page = 1; this._loadCommunityList(); }, 300));
      on('s-c-add', 'click', () => this._openCommunityForm(null));
      // 委托：表格行的操作按钮
      $('s-c-tbody')?.addEventListener('click', (e) => this._delegateCommunityRowAction(e));

      // ========== Tab 8: 用户管理 · 注册审核 ==========
      on('s-u-search', 'input', debounce(() => { this._users.page = 1; this._loadUserList(); }, 300));
      on('s-u-filter-status', 'change', () => { this._users.page = 1; this._loadUserList(); });
      on('s-u-filter-role', 'change', () => { this._users.page = 1; this._loadUserList(); });
      on('s-u-add', 'click', () => this._openUserForm(null));
      $('s-u-tbody')?.addEventListener('click', (e) => this._delegateUserRowAction(e));
    },

    /* ---------- Tabs 切换 ---------- */

    _switchTab(tabId) {
      const tabs = document.querySelectorAll('#settings-tabs .tab-item');
      tabs.forEach((t) => {
        const active = t.getAttribute('data-tab') === tabId;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      const panels = document.querySelectorAll('.tab-panel');
      panels.forEach((p) => {
        const show = p.id === tabId;
        p.classList.toggle('active', show);
        p.hidden = !show;
      });
      if (tabId === 'tab-storage') this._refreshStorageUsage();
      if (tabId === 'tab-community') this._loadCommunityList();
      if (tabId === 'tab-user-audit') this._loadUserList();
    },

    /* ---------- 读：加载配置到表单 ---------- */

    async _loadAll() {
      // 1. 先从 API 读
      let data = null;
      try {
        if (global.DashboardApi?.Settings) {
          data = await global.DashboardApi.Settings.getAll();
        }
      } catch (err) {
        console.warn('[settings] API getAll 失败，fallback 到本地存储：', err);
      }
      // 2. API 返回为空（缺省字段 null）时，从本地存储补齐
      const local = this._readLocal();
      data = this._mergeWithDefaults(data, local);
      // 3. 填到表单
      this._fillForm(data);
      this._setSaveHint(`最后保存：${data.lastSavedAt ? new Date(data.lastSavedAt).toLocaleString() : '尚未保存，当前为默认值'}`);
    },

    _mergeWithDefaults(fromApi, fromLocal) {
      const safeGet = (group, key, fallback) => {
        let v = undefined;
        if (fromApi && fromApi[group]) v = fromApi[group][key];
        if (v === undefined || v === null) {
          if (fromLocal && fromLocal[group]) v = fromLocal[group][key];
        }
        return (v === undefined || v === null) ? fallback : v;
      };
      return {
        thresholds: {
          smokeLow:    safeGet('thresholds', 'smokeLow',    DEFAULTS.thresholds.smokeLow),
          smokeHigh:   safeGet('thresholds', 'smokeHigh',   DEFAULTS.thresholds.smokeHigh),
          tempHigh:    safeGet('thresholds', 'tempHigh',    DEFAULTS.thresholds.tempHigh),
          coHigh:      safeGet('thresholds', 'coHigh',      DEFAULTS.thresholds.coHigh),
          durationSec: safeGet('thresholds', 'durationSec', DEFAULTS.thresholds.durationSec),
          recoverySec: safeGet('thresholds', 'recoverySec', DEFAULTS.thresholds.recoverySec),
        },
        notify: {
          app:        safeGet('notify', 'app',        DEFAULTS.notify.app),
          sms:        safeGet('notify', 'sms',        DEFAULTS.notify.sms),
          email:      safeGet('notify', 'email',      DEFAULTS.notify.email),
          voiceCall:  safeGet('notify', 'voiceCall',  DEFAULTS.notify.voiceCall),
          screen:     safeGet('notify', 'screen',     DEFAULTS.notify.screen),
          targets:    safeGet('notify', 'targets',    DEFAULTS.notify.targets),
          timeoutSec: safeGet('notify', 'timeoutSec', DEFAULTS.notify.timeoutSec),
          escalation: safeGet('notify', 'escalation', DEFAULTS.notify.escalation),
        },
        linkage: {
          sound:        safeGet('linkage', 'sound',        DEFAULTS.linkage.sound),
          vent:         safeGet('linkage', 'vent',         DEFAULTS.linkage.vent),
          valve:        safeGet('linkage', 'valve',        DEFAULTS.linkage.valve),
          light:        safeGet('linkage', 'light',        DEFAULTS.linkage.light),
          broadcastTpl: safeGet('linkage', 'broadcastTpl', DEFAULTS.linkage.broadcastTpl),
          cooldownSec:  safeGet('linkage', 'cooldownSec',  DEFAULTS.linkage.cooldownSec),
        },
        account: {
          sessionSec: safeGet('account', 'sessionSec', DEFAULTS.account.sessionSec),
          remember:   safeGet('account', 'remember',   DEFAULTS.account.remember),
        },
        integration: {
          apiBase: safeGet('integration', 'apiBase', DEFAULTS.integration.apiBase),
          mqtt:    safeGet('integration', 'mqtt',    DEFAULTS.integration.mqtt),
          aiBase:  safeGet('integration', 'aiBase',  DEFAULTS.integration.aiBase),
          // token 不回显
        },
        lastSavedAt: (fromApi && fromApi.lastSavedAt) || (fromLocal && fromLocal.lastSavedAt) || null,
      };
    },

    _fillForm(d) {
      // thresholds
      $('s-th-smoke-low').value  = d.thresholds.smokeLow;
      $('s-th-smoke-high').value = d.thresholds.smokeHigh;
      $('s-th-temp-high').value  = d.thresholds.tempHigh;
      $('s-th-co-high').value    = d.thresholds.coHigh;
      $('s-th-duration').value   = d.thresholds.durationSec;
      $('s-th-recovery').value   = d.thresholds.recoverySec;
      // notify
      $('s-n-app').checked       = !!d.notify.app;
      $('s-n-sms').checked       = !!d.notify.sms;
      $('s-n-email').checked     = !!d.notify.email;
      $('s-n-voice').checked     = !!d.notify.voiceCall;
      $('s-n-screen').checked    = !!d.notify.screen;
      $('s-n-targets').value     = d.notify.targets || '';
      $('s-n-timeout').value     = d.notify.timeoutSec;
      $('s-n-escalation').value  = d.notify.escalation || '';
      // linkage
      $('s-l-sound').value       = d.linkage.sound;
      $('s-l-vent').value        = d.linkage.vent;
      $('s-l-valve').value       = d.linkage.valve;
      $('s-l-light').value       = d.linkage.light;
      $('s-l-broadcast').value   = d.linkage.broadcastTpl;
      $('s-l-cooldown').value    = d.linkage.cooldownSec;
      // account
      $('s-a-session').value     = String(d.account.sessionSec);
      $('s-a-remember').checked  = !!d.account.remember;
      $('s-a-old').value         = '';
      $('s-a-new').value         = '';
      $('s-a-new2').value        = '';
      // integration（token 不回显）
      $('s-i-api').value         = d.integration.apiBase || '';
      $('s-i-mqtt').value        = d.integration.mqtt    || '';
      $('s-i-ai').value          = d.integration.aiBase  || '';
      $('s-i-token').value       = '';
    },

    /* ---------- 写：从表单收集 + 保存 ---------- */

    _collectForm() {
      return {
        thresholds: {
          smokeLow:    Number($('s-th-smoke-low').value || 0),
          smokeHigh:   Number($('s-th-smoke-high').value || 0),
          tempHigh:    Number($('s-th-temp-high').value || 0),
          coHigh:      Number($('s-th-co-high').value || 0),
          durationSec: Number($('s-th-duration').value || 0),
          recoverySec: Number($('s-th-recovery').value || 0),
        },
        notify: {
          app:        $('s-n-app').checked,
          sms:        $('s-n-sms').checked,
          email:      $('s-n-email').checked,
          voiceCall:  $('s-n-voice').checked,
          screen:     $('s-n-screen').checked,
          targets:    $('s-n-targets').value.trim(),
          timeoutSec: Number($('s-n-timeout').value || 300),
          escalation: $('s-n-escalation').value.trim(),
        },
        linkage: {
          sound:        $('s-l-sound').value,
          vent:         $('s-l-vent').value,
          valve:        $('s-l-valve').value,
          light:        $('s-l-light').value,
          broadcastTpl: $('s-l-broadcast').value,
          cooldownSec:  Number($('s-l-cooldown').value || 0),
        },
        account: {
          sessionSec: Number($('s-a-session').value || 0),
          remember:   $('s-a-remember').checked,
        },
        integration: {
          apiBase: $('s-i-api').value.trim(),
          mqtt:    $('s-i-mqtt').value.trim(),
          aiBase:  $('s-i-ai').value.trim(),
          // token：仅当用户填写了才保存（mask 不回显）
          token:   $('s-i-token').value ? String($('s-i-token').value) : undefined,
        },
      };
    },

    _validate(payload) {
      const errs = [];
      const { thresholds, notify, linkage } = payload;
      if (thresholds.smokeLow  < 0) errs.push('烟雾低阈值不可小于 0');
      if (thresholds.smokeHigh < 0) errs.push('烟雾高阈值不可小于 0');
      if (thresholds.smokeLow  >= thresholds.smokeHigh) errs.push('烟雾低阈值必须小于高阈值');
      if (thresholds.tempHigh  < -30 || thresholds.tempHigh > 500)  errs.push('温度阈值范围异常');
      if (thresholds.coHigh    < 0)  errs.push('CO 阈值不可小于 0');
      if (thresholds.durationSec < 0) errs.push('持续时间不可小于 0');
      if (thresholds.recoverySec < 0) errs.push('恢复时间不可小于 0');
      if (!notify.app && !notify.sms && !notify.email && !notify.voiceCall && !notify.screen) {
        errs.push('请至少启用一个通知通道，否则告警发生时将没有任何推送。');
      }
      const lvSet = new Set(['none', 'low', 'high', 'all']);
      ['sound', 'vent', 'valve', 'light'].forEach((k) => {
        if (!lvSet.has(linkage[k])) errs.push(`联动项 ${k} 的触发级别无效`);
      });
      if (linkage.cooldownSec < 0) errs.push('联动冷却时间不可小于 0');
      return errs;
    },

    async _saveAll() {
      const payload = this._collectForm();
      const errs = this._validate(payload);
      if (errs.length) {
        global.UI?.Toast?.error(errs.join('；'));
        return;
      }
      try {
        this._setSaveHint('正在保存…', 'warn');
        // 1. API
        let saved = false;
        try {
          if (global.DashboardApi?.Settings) {
            const r = await global.DashboardApi.Settings.save(payload);
            saved = true;
            // 后端返回值有可能包含回写的 token（掩码）
            if (r && typeof r === 'object' && r.integration) payload.integration.token = undefined;
          }
        } catch (err) {
          console.warn('[settings] API save 失败，fallback 到本地存储：', err);
        }
        // 2. 本地兜底
        payload.lastSavedAt = new Date().toISOString();
        this._writeLocal(payload);
        // 3. remember 同步到 auth
        try {
          if (global.Auth && global.Auth.setRememberPreference) {
            global.Auth.setRememberPreference(!!payload.account.remember);
          }
          if (global.Auth && global.Auth.setSessionTtlSeconds) {
            global.Auth.setSessionTtlSeconds(payload.account.sessionSec);
          }
        } catch (_) { /* ignore */ }
        // 4. UI 反馈
        saved ? global.UI?.Toast?.success('设置已保存到服务器。')
              : global.UI?.Toast?.warning('服务器暂未接入，已保存到浏览器本地（刷新不会丢失）。');
        this._setSaveHint(`最后保存：${new Date(payload.lastSavedAt).toLocaleString()}`);
      } catch (err) {
        console.error('[settings] save 失败：', err);
        global.UI?.Toast?.error('保存失败：' + (err && err.message ? err.message : '未知错误'));
        this._setSaveHint('保存失败', 'error');
      }
    },

    /* ---------- Tab 4: 修改密码 ---------- */

    async _submitChangePassword() {
      const oldP = $('s-a-old').value;
      const newP = $('s-a-new').value;
      const newP2 = $('s-a-new2').value;
      if (!oldP) return global.UI?.Toast?.error('请输入当前密码');
      if (!newP || newP.length < 6) return global.UI?.Toast?.error('新密码至少 6 位');
      if (newP !== newP2) return global.UI?.Toast?.error('两次输入的新密码不一致');
      try {
        if (global.DashboardApi?.Settings) {
          const ok = await global.DashboardApi.Settings.changePassword({
            oldPassword: oldP,
            newPassword: newP,
          });
          if (ok !== false) {
            global.UI?.Toast?.success('密码修改成功，请下次登录使用新密码。');
            $('s-a-old').value = '';
            $('s-a-new').value = '';
            $('s-a-new2').value = '';
          } else {
            global.UI?.Toast?.error('当前密码错误，请重试。');
          }
        } else {
          global.UI?.Toast?.warning('后端未接入，已保存到本地示例配置。');
          const local = this._readLocal() || {};
          local.account = local.account || {};
          local.account._mockPasswordChanged = new Date().toISOString();
          this._writeLocal(local);
        }
      } catch (err) {
        console.error('[settings] change password 失败：', err);
        global.UI?.Toast?.error('密码修改失败：' + (err && err.message ? err.message : '未知错误'));
      }
    },

    /* ---------- Tab 5: 连通性测试 ---------- */

    async _testConnectivity(type) {
      const box = $('s-i-result');
      if (!box) return;
      box.hidden = false;
      box.className = 'test-result running';
      box.textContent = `正在测试 ${type.toUpperCase()} 连接…`;
      const then = Date.now();
      try {
        let ok = false;
        let latency = 0;
        if (type === 'api') {
          if (global.DashboardApi?.System?.getStatus) {
            const r = await global.DashboardApi.System.getStatus();
            latency = Date.now() - then;
            ok = !!(r && typeof r === 'object');
            box.className = 'test-result ok';
            box.textContent = `✅ API 连接成功，状态：${r.status || 'ok'}，延迟：${latency}ms`;
          } else {
            throw new Error('System.getStatus 未实现');
          }
        } else if (type === 'mqtt') {
          if (global.MqttManager?.testConnection) {
            const r = await global.MqttManager.testConnection();
            latency = Date.now() - then;
            ok = !!r;
            box.className = 'test-result ok';
            box.textContent = `✅ MQTT 已连接（${r.clientId || 'default'}），延迟：${latency}ms`;
          } else {
            throw new Error('MqttManager.testConnection 未实现');
          }
        } else if (type === 'ai') {
          if (global.AiChat?.ping) {
            ok = await global.AiChat.ping();
            latency = Date.now() - then;
            box.className = 'test-result ok';
            box.textContent = ok
              ? `✅ AI 助手服务正常，延迟：${latency}ms`
              : `⚠️ AI 助手返回异常（延迟：${latency}ms）`;
          } else {
            throw new Error('AiChat.ping 未实现');
          }
        }
        if (!ok) throw new Error('no-response');
      } catch (err) {
        latency = Date.now() - then;
        box.className = 'test-result err';
        box.textContent = `❌ ${type.toUpperCase()} 连接失败：${err && err.message ? err.message : '未知错误'}（${latency}ms）`;
        console.error('[settings] connectivity error:', err);
      }
    },

    /* ---------- Tab 6: 存储 / 缓存 / 导入导出 ---------- */

    _refreshStorageUsage() {
      const bar = $('s-s-bar');
      const meta = $('s-s-meta');
      if (!bar || !meta) return;
      const { totalKb, usedKb, pct } = this._calcStorage();
      bar.style.width = `${Math.min(100, pct)}%`;
      bar.className = 'storage-bar-used ' + (pct < 50 ? 'ok' : pct < 80 ? 'warn' : 'err');
      meta.innerHTML = `已使用：<b>${usedKb.toFixed(2)} KB</b> / ${totalKb ? totalKb.toFixed(0) + ' KB' : '5 MB (默认配额)'}，占用 ${pct.toFixed(1)}%，共 ${localStorage.length} 项。`;
    },

    _calcStorage() {
      let bytes = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k);
        bytes += (k.length + v.length) * 2;
      }
      const usedKb = bytes / 1024;
      const totalKb = 5 * 1024; // 5MB 常见浏览器配额
      const pct = totalKb ? (usedKb / totalKb) * 100 : 0;
      return { usedKb, totalKb, pct };
    },

    _cleanCache(scope) {
      if (scope === 'ui') {
        // 仅清理 UI 相关：chart option、tab index、面板展开状态等
        const keep = PROTECTED_KEYS;
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (keep.has(k)) continue;
          if (/^(smoke\.)?(ui|chart|panel|filter|recent|expanded|view)_/i.test(k) || k.startsWith('dashboard.ui.')) {
            toRemove.push(k);
          }
        }
        toRemove.forEach((k) => localStorage.removeItem(k));
        global.UI?.Toast?.success(`已清理 ${toRemove.length} 项 UI 缓存。`);
      } else if (scope === 'app') {
        const keep = PROTECTED_KEYS;
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (keep.has(k)) continue;
          toRemove.push(k);
        }
        toRemove.forEach((k) => localStorage.removeItem(k));
        global.UI?.Toast?.success(`已清理 ${toRemove.length} 项应用缓存（保留登录态与系统设置）。`);
      }
      this._refreshStorageUsage();
      // 通知后端清理临时缓存（接口不存在也不报错）
      try { global.DashboardApi?.Settings?.clearCache?.(scope); } catch (_) { /* ignore */ }
    },

    _resetAll() {
      if (!confirm('确定要恢复为默认设置吗？\n阈值、通知、联动、接入参数等将全部重置，且不可恢复。')) return;
      // 用默认值覆盖本地
      const d = JSON.parse(JSON.stringify(DEFAULTS));
      d.lastSavedAt = new Date().toISOString();
      this._writeLocal(d);
      this._fillForm(this._mergeWithDefaults(null, d));
      try { global.DashboardApi?.Settings?.save(d); } catch (_) { /* ignore */ }
      global.UI?.Toast?.success('已恢复默认设置（可再次调整后点"保存设置"落盘）。');
      this._setSaveHint(`已重置为默认，保存于：${new Date(d.lastSavedAt).toLocaleString()}`);
      this._refreshStorageUsage();
    },

    _exportConfig() {
      const data = this._readLocal() || this._mergeWithDefaults(null, null);
      data._exportAt = new Date().toISOString();
      data._exportVer = '1.0';
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smoke-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      global.UI?.Toast?.success('配置已导出为 JSON 文件。');
    },

    _importFile(e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result || ''));
          if (!data || typeof data !== 'object') throw new Error('内容不是合法 JSON 对象');
          const merged = this._mergeWithDefaults({
            thresholds: data.thresholds || null,
            notify: data.notify || null,
            linkage: data.linkage || null,
            account: data.account || null,
            integration: data.integration || null,
          }, null);
          this._fillForm(merged);
          global.UI?.Toast?.success('已载入导入的配置，可检查后点"保存设置"落盘。');
        } catch (err) {
          console.error('[settings] import 失败：', err);
          global.UI?.Toast?.error('导入失败：' + (err && err.message ? err.message : '文件格式错误'));
        } finally {
          e.target.value = '';
        }
      };
      reader.onerror = () => {
        global.UI?.Toast?.error('读取文件失败');
        e.target.value = '';
      };
      reader.readAsText(f);
    },

    /* ---------- Helpers ---------- */

    _readLocal() {
      try {
        const s = localStorage.getItem(STORAGE_KEY);
        return s ? JSON.parse(s) : null;
      } catch (_) { return null; }
    },

    _writeLocal(obj) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
        return true;
      } catch (e) {
        console.error('[settings] 写入 localStorage 失败：', e);
        return false;
      }
    },

    _setSaveHint(text, level) {
      const h = $('settings-save-hint');
      if (!h) return;
      h.textContent = text || '';
      h.className = 'save-hint' + (level ? ' ' + level : '');
    },

    /** 对外：读取当前阈值（其它组件引用），始终确保返回可用对象 */
    getThresholds() {
      const d = this._mergeWithDefaults(null, this._readLocal());
      return d.thresholds;
    },
    /** 对外：读取当前通知通道启用状态 */
    getNotifyChannels() {
      const d = this._mergeWithDefaults(null, this._readLocal());
      return d.notify;
    },
    /** 对外：读取当前联动级别 */
    getLinkagePolicy() {
      const d = this._mergeWithDefaults(null, this._readLocal());
      return d.linkage;
    },

    /* ============================================================
     *   Tab 7: 社区管理 —— 列表 / 新建 / 编辑 / 删除 / 指定负责人
     * ============================================================ */

    // 当前分页/筛选 state
    _community: { page: 1, pageSize: 10, records: [], total: 0 },

    _isSysAdmin() {
      try {
        const s = global.Auth && typeof global.Auth.getSession === 'function'
          ? global.Auth.getSession() : null;
        return !!(s && s.role === 'system_admin');
      } catch (_) { return false; }
    },
    _getSession() {
      try {
        return (global.Auth && typeof global.Auth.getSession === 'function')
          ? global.Auth.getSession() : null;
      } catch (_) { return null; }
    },
    _fmtDate(v) {
      if (!v) return '-';
      const d = new Date(v);
      if (isNaN(d)) return v;
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },

    async _loadCommunityList() {
      const tbody = $('s-c-tbody');
      const search = $('s-c-search');
      if (!tbody) return;
      const keyword = search ? search.value.trim() : '';
      const isSys = this._isSysAdmin();

      // 非系统管理员：禁止增删改操作，只展示登录态所属小区
      const addBtn = $('s-c-add');
      if (addBtn) addBtn.disabled = !isSys;

      try {
        const Api = global.DashboardApi;
        const opts = { page: this._community.page, pageSize: this._community.pageSize };
        if (keyword) opts.name = keyword;
        let page;
        try {
          page = await Api.Community.getList(opts);
        } catch (err) {
          console.warn('[settings] Community.getList 失败，降级用常量 COMMUNITIES：', err);
          // 降级：前端常量 + 搜索 + 分页
          const all = Array.isArray(Api.COMMUNITIES) ? Api.COMMUNITIES : [];
          const filtered = keyword
            ? all.filter(c => String(c.name || '').includes(keyword))
            : all;
          const p = this._community.page, sz = this._community.pageSize;
          page = {
            total: filtered.length,
            records: filtered.slice((p - 1) * sz, p * sz).map(c => ({
              id: c.id, name: c.name, address: c.address || '-',
              adminUserId: c.adminUserId || null, adminUsername: c.adminUsername || '-',
              createdAt: null,
            })),
          };
        }
        page = page || {};
        this._community.total = Number(page.total || 0);
        this._community.records = Array.isArray(page.records) ? page.records : [];

        // 非系统管理员：只保留自己所属小区
        if (!isSys) {
          const s = this._getSession();
          if (s && s.communityId) {
            this._community.records = this._community.records.filter(r => String(r.id) === String(s.communityId));
            this._community.total = this._community.records.length;
          }
        }

        if (!this._community.records.length) {
          tbody.innerHTML = `<tr><td colspan="5" class="adm-empty">暂无社区数据${keyword ? '（当前搜索条件：' + keyword + '）' : ''}</td></tr>`;
        } else {
          tbody.innerHTML = this._community.records.map(r => {
            const canEdit = isSys;
            return `
              <tr data-id="${r.id}">
                <td><b>${r.name || '-'}</b></td>
                <td>${r.address || '-'}</td>
                <td>${r.adminUsername ? `👤 ${r.adminUsername}` : '<span style="color:var(--text-dim);">未指定</span>'}</td>
                <td>${this._fmtDate(r.createdAt)}</td>
                <td>
                  <div class="row-actions">
                    <button class="link-btn" data-act="edit" ${canEdit ? '' : 'disabled'}>编辑</button>
                    <button class="link-btn" data-act="set-admin" ${canEdit ? '' : 'disabled'}>指定负责人</button>
                    <button class="link-btn danger" data-act="del" ${canEdit ? '' : 'disabled'}>删除</button>
                  </div>
                </td>
              </tr>`;
          }).join('');
        }
        this._renderPager('s-c-pager', this._community, () => this._loadCommunityList());
      } catch (err) {
        console.error('[settings] 社区列表加载失败：', err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="adm-empty">加载失败：${err && err.message ? err.message : '未知错误'}</td></tr>`;
      }
    },

    _delegateCommunityRowAction(e) {
      const btn = e.target.closest('button[data-act]');
      if (!btn || btn.disabled) return;
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = tr.getAttribute('data-id');
      const record = this._community.records.find(r => String(r.id) === String(id));
      if (!record) return;
      const act = btn.getAttribute('data-act');
      if (act === 'edit') this._openCommunityForm(record);
      else if (act === 'del') this._deleteCommunity(record);
      else if (act === 'set-admin') this._openSetAdminForm(record);
    },

    _openCommunityForm(record) {
      if (!this._isSysAdmin()) return global.UI?.Toast?.warning('仅系统管理员可编辑社区信息');
      const isEdit = !!record;
      const title = (isEdit ? '编辑社区' : '新建社区');
      this._miniDialog({
        title,
        bodyHtml: `
          <div class="form-grid" style="grid-template-columns:1fr">
            <div class="form-field full">
              <div class="form-label">社区名称 <small>*</small></div>
              <input id="md-c-name" type="text" class="ghost-input" value="${(record && record.name) || ''}" placeholder="如：阳光花园小区"/>
            </div>
            <div class="form-field full">
              <div class="form-label">地址</div>
              <input id="md-c-addr" type="text" class="ghost-input" value="${(record && record.address) || ''}" placeholder="如：XX 区 XX 路 128 号"/>
            </div>
            <div class="form-field full">
              <div class="form-label">指定负责人（小区管理员，可留空后续再指定）</div>
              <select id="md-c-admin" class="ghost-input"></select>
            </div>
          </div>`,
        onMount: async () => {
          // 填充管理员候选：ACTIVE 用户（居民 + 管理员都可选），选中居民时保存前自动提升角色
          const sel = document.getElementById('md-c-admin');
          if (sel) {
            sel.innerHTML = '<option value="">— 暂不指定 —</option>';
            try {
              const p = await global.DashboardApi.AdminUser.getList({ status: 'ACTIVE', pageSize: 1000 });
              const users = (p && p.records) || [];
              // 占用名单：排除本 record 外的已绑定
              const used = new Set();
              this._community.records.forEach(c => {
                if (c.adminUserId && !(record && String(c.id) === String(record.id))) {
                  used.add(String(c.adminUserId));
                }
              });
              users
                .filter(a => !used.has(String(a.id)))
                .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')))
                .forEach(a => {
                  const o = document.createElement('option');
                  o.value = String(a.id);
                  const isAdmin = String(a.role || '').toUpperCase() === 'COMMUNITY_ADMIN';
                  const isSys   = String(a.role || '').toUpperCase() === 'SYSTEM_ADMIN';
                  const badge = isAdmin ? '【小区管理员】'
                              : isSys   ? '【系统管理员】'
                              :           '【居民】';
                  o.textContent = `${a.username}${a.realName ? '（' + a.realName + '）' : ''} ${badge}`;
                  if (record && String(record.adminUserId) === String(a.id)) o.selected = true;
                  sel.appendChild(o);
                });
            } catch (err) {
              console.warn('[settings] 小区管理员候选获取失败：', err);
            }
          }
        },
        onSubmit: async () => {
          const name = document.getElementById('md-c-name').value.trim();
          const address = document.getElementById('md-c-addr').value.trim();
          const sel = document.getElementById('md-c-admin');
          const adminUserId = sel && sel.value ? sel.value : null;
          if (!name) throw new Error('请填写社区名称');
          // 若选择了负责人但角色不是管理员，先尝试自动提升
          if (adminUserId) {
            try {
              const list = await global.DashboardApi.AdminUser.getList({ pageSize: 1000 });
              const u = (list && list.records || []).find(x => String(x.id) === String(adminUserId));
              if (u && String(u.role || '').toUpperCase() !== 'COMMUNITY_ADMIN') {
                try {
                  const patch = { role: 'COMMUNITY_ADMIN' };
                  if (u.communityId != null) patch.communityId = u.communityId;
                  if (u.realName)  patch.realName = u.realName;
                  if (u.phone)     patch.phone = u.phone;
                  // 创建/编辑时，若没有社区则先绑定（编辑场景看 record.id，创建场景待 create 后再补绑定也行，这里尽量写 patch）
                  if (!patch.communityId && record && record.id) patch.communityId = record.id;
                  await global.DashboardApi.AdminUser.update(adminUserId, patch);
                  global.UI?.Toast?.info(`已将用户 ${u.username || adminUserId} 提升为「小区管理员」`);
                } catch (err2) {
                  console.warn('[settings] 角色自动提升失败，继续保存社区：', err2);
                }
              }
            } catch (_) { /* ignore */ }
          }
          if (isEdit) {
            await global.DashboardApi.Community.update(record.id, { name, address, adminUserId });
            global.UI?.Toast?.success('社区信息已更新');
          } else {
            await global.DashboardApi.Community.create({ name, address, adminUserId });
            global.UI?.Toast?.success('已创建社区');
          }
          this._community.page = 1;
          await this._loadCommunityList();
        },
        submitLabel: isEdit ? '保存修改' : '创建社区',
      });
    },

    _openSetAdminForm(record) {
      if (!this._isSysAdmin()) return global.UI?.Toast?.warning('仅系统管理员可指定负责人');
      this._miniDialog({
        title: `指定负责人 · ${record.name || ''}`,
        bodyHtml: `
          <div class="form-grid" style="grid-template-columns:1fr">
            <div class="form-field full">
              <div class="form-label">负责人 <small>下拉为空表示清除负责人；选择普通用户将自动提升为小区管理员</small></div>
              <select id="md-ca-admin" class="ghost-input"></select>
            </div>
            <div id="md-ca-hint" style="font-size:12px;color:var(--text-dim);padding:6px 2px;display:none;"></div>
          </div>`,
        onMount: async () => {
          const sel = document.getElementById('md-ca-admin');
          const hint = document.getElementById('md-ca-hint');
          if (!sel) return;
          sel.innerHTML = '<option value="">— 清除负责人 —</option>';
          try {
            // 拉取 ACTIVE 状态的所有用户（含居民），选择后前端自动调角色提升
            const [pAdm, pAll] = await Promise.all([
              global.DashboardApi.AdminUser.getList({ role: 'COMMUNITY_ADMIN', pageSize: 500 }).catch(() => ({ records: [] })),
              global.DashboardApi.AdminUser.getList({ status: 'ACTIVE', pageSize: 1000 }).catch(() => ({ records: [] })),
            ]);
            const admins = (pAdm && pAdm.records) || [];
            const allActive = (pAll && pAll.records) || [];
            // 合并去重：优先保留已有的 COMMUNITY_ADMIN
            const adminIds = new Set(admins.map(a => String(a.id)));
            const merged = admins.slice();
            allActive.forEach(u => {
              if (!adminIds.has(String(u.id))) merged.push(u);
            });
            const used = new Set();
            this._community.records.forEach(c => {
              if (c.adminUserId && String(c.id) !== String(record.id)) used.add(String(c.adminUserId));
            });
            const usersById = new Map(allActive.map(u => [String(u.id), u]));
            merged
              .filter(a => !used.has(String(a.id)))
              .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')))
              .forEach(a => {
                const o = document.createElement('option');
                o.value = String(a.id);
                const isAdmin = String(a.role || '').toUpperCase() === 'COMMUNITY_ADMIN';
                const isSys   = String(a.role || '').toUpperCase() === 'SYSTEM_ADMIN';
                const badge = isAdmin ? '【小区管理员】'
                            : isSys   ? '【系统管理员】'
                            :           '【居民→将提升为管理员】';
                o.textContent = `${a.username}${a.realName ? '（' + a.realName + '）' : ''} ${badge}`;
                if (String(record.adminUserId) === String(a.id)) o.selected = true;
                sel.appendChild(o);
              });
            // 角色变更提示
            sel.addEventListener('change', () => {
              const uid = sel.value;
              if (!uid) { hint.style.display = 'none'; return; }
              const u = usersById.get(uid);
              const roleStr = String(u && u.role || '').toUpperCase();
              if (roleStr === 'COMMUNITY_ADMIN') {
                hint.style.display = 'block';
                hint.innerHTML = '✅ 该用户已是小区管理员角色，直接指定即可。';
                hint.style.color = '#4ade80';
              } else if (roleStr === 'SYSTEM_ADMIN') {
                hint.style.display = 'block';
                hint.innerHTML = '⚠️ 该用户是系统管理员，通常不建议同时兼任小区负责人。';
                hint.style.color = '#fbbf24';
              } else {
                hint.style.display = 'block';
                hint.innerHTML = 'ℹ️ 该用户当前是居民角色，确认指定后将自动把其角色提升为「小区管理员」。';
                hint.style.color = 'var(--text-dim)';
              }
            });
            if (sel.value) sel.dispatchEvent(new Event('change'));
          } catch (err) {
            console.warn('[settings] 小区管理员候选获取失败：', err);
          }
        },
        onSubmit: async () => {
          const sel = document.getElementById('md-ca-admin');
          const adminUserId = sel && sel.value ? sel.value : null;
          if (adminUserId) {
            // 如果该用户不是 COMMUNITY_ADMIN 角色，先尝试调用角色提升接口
            try {
              const list = await global.DashboardApi.AdminUser.getList({ pageSize: 1000 });
              const u = (list && list.records || []).find(x => String(x.id) === String(adminUserId));
              if (u && String(u.role || '').toUpperCase() !== 'COMMUNITY_ADMIN') {
                try {
                  const patch = { role: 'COMMUNITY_ADMIN' };
                  // 保留用户原 communityId/姓名/电话，避免覆盖
                  if (u.communityId != null) patch.communityId = u.communityId;
                  if (u.realName)  patch.realName = u.realName;
                  if (u.phone)     patch.phone = u.phone;
                  // 若用户无归属小区，自动绑定到当前社区
                  if (!patch.communityId) patch.communityId = record.id;
                  await global.DashboardApi.AdminUser.update(adminUserId, patch);
                  global.UI?.Toast?.info(`已将用户 ${u.username || adminUserId} 的角色提升为「小区管理员」`);
                } catch (err2) {
                  // 前端角色提升失败（如后端暂不支持）不阻断指定，交由后端 setAdmin 自行兜底校验
                  console.warn('[settings] 角色自动提升失败，继续尝试指定负责人：', err2);
                }
              }
            } catch (_) { /* ignore */ }
          }
          await global.DashboardApi.Community.setAdmin(record.id, adminUserId);
          global.UI?.Toast?.success(adminUserId ? '负责人已指定' : '已清除负责人');
          await this._loadCommunityList();
        },
        submitLabel: '确认指定',
      });
    },

    async _deleteCommunity(record) {
      if (!this._isSysAdmin()) return global.UI?.Toast?.warning('仅系统管理员可删除社区');
      const ok = confirm(`确定要删除社区「${record.name || ''}」吗？\n如果该社区下仍有用户或传感器绑定，删除将被拒绝。`);
      if (!ok) return;
      try {
        await global.DashboardApi.Community.remove(record.id);
        global.UI?.Toast?.success('已删除社区');
        this._community.page = 1;
        await this._loadCommunityList();
      } catch (err) {
        global.UI?.Toast?.error('删除失败：' + (err && err.message ? err.message : '未知错误'));
      }
    },

    /* ============================================================
     *   Tab 8: 用户管理 / 注册审核 —— 列表 / 审核 / 启停用 / 绑定
     * ============================================================ */

    _users: { page: 1, pageSize: 10, records: [], total: 0 },

    _roleLabel(role) {
      switch (String(role || '').toUpperCase()) {
        case 'SYSTEM_ADMIN':    return { text: '系统管理员', cls: 'r-admin' };
        case 'COMMUNITY_ADMIN': return { text: '小区管理员', cls: 'r-community' };
        case 'FIREFIGHTER':     return { text: '消防员',     cls: 'r-fire' };
        case 'RESIDENT':        return { text: '居民',       cls: 'r-resident' };
        default: return { text: role || '-', cls: '' };
      }
    },
    _statusLabel(status) {
      switch (String(status || '').toUpperCase()) {
        case 'ACTIVE':   return { text: '正常', cls: 's-active' };
        case 'PENDING':  return { text: '待审核', cls: 's-pending' };
        case 'DISABLED': return { text: '已禁用', cls: 's-disabled' };
        default: return { text: status || '-', cls: '' };
      }
    },

    async _loadUserList() {
      const tbody = $('s-u-tbody');
      if (!tbody) return;
      const kw = ($('s-u-search') || {}).value || '';
      const st = ($('s-u-filter-status') || {}).value || '';
      const rl = ($('s-u-filter-role') || {}).value || '';
      const isSys = this._isSysAdmin();
      const sess = this._getSession();

      // 只有系统管理员才允许"创建用户"；其它角色不允许
      const addBtn = $('s-u-add');
      if (addBtn) addBtn.disabled = !isSys;

      try {
        const opts = { page: this._users.page, pageSize: this._users.pageSize };
        if (st) opts.status = st;
        if (rl) opts.role = rl;
        const page = await global.DashboardApi.AdminUser.getList(opts) || {};
        let rows = Array.isArray(page.records) ? page.records : [];
        // 内存二次搜索（后端未支持 kw 时不报错）
        if (kw) {
          const k = kw.toLowerCase();
          rows = rows.filter(r =>
            String(r.username || '').toLowerCase().includes(k) ||
            String(r.realName || '').toLowerCase().includes(k) ||
            String(r.phone    || '').toLowerCase().includes(k));
        }
        this._users.records = rows;
        this._users.total   = Number(page.total || rows.length);

        if (!rows.length) {
          tbody.innerHTML = `<tr><td colspan="7" class="adm-empty">暂无用户数据${kw ? '（当前搜索：' + kw + '）' : ''}</td></tr>`;
        } else {
          tbody.innerHTML = rows.map(u => {
            const st = this._statusLabel(u.status);
            const rl = this._roleLabel(u.role);
            const isPending = st.cls === 's-pending';
            const cid = u.communityId;
            const cname = (u.communityName) || (global.DashboardApi.communityNameById && global.DashboardApi.communityNameById(cid)) || (cid ? '#' + cid : '-');
            const isSysRow = rl.cls === 'r-admin';
            // 可操作：系统管理员可操作除自身删除以外，小区管理员仅可操作本小区
            const canOpSystem = isSys;
            const canOpByCommunity = !!(sess && sess.communityId && String(u.communityId) === String(sess.communityId));
            const dis = (cond) => cond ? '' : 'disabled';
            return `
              <tr data-id="${u.id}" class="${isPending ? 'highlight' : ''}">
                <td><b>${u.username || '-'}</b></td>
                <td><span class="role-chip ${rl.cls}">${rl.text}</span></td>
                <td>${cname}</td>
                <td>${u.realName ? u.realName : '<span style="color:var(--text-dim)">未填</span>'}<br/>
                    <span style="color:var(--text-dim);font-size:12px;">${u.phone || '未填手机'}</span></td>
                <td><span class="status-badge ${st.cls}">${st.text}</span></td>
                <td>${this._fmtDate(u.createdAt || u.registerAt)}</td>
                <td>
                  <div class="row-actions">
                    ${isPending ? `<button class="link-btn" data-act="pass" ${dis(canOpSystem || canOpByCommunity)}>通过</button>
                                   <button class="link-btn warn" data-act="reject" ${dis(canOpSystem || canOpByCommunity)}>拒绝</button>` : ''}
                    <button class="link-btn" data-act="edit" ${dis(canOpSystem)}>编辑</button>
                    <button class="link-btn" data-act="bind" ${dis(rl.cls === 'r-resident' && (canOpSystem || canOpByCommunity))}>绑定设备</button>
                    <button class="link-btn warn" data-act="toggle" ${dis((canOpSystem || canOpByCommunity) && !isSysRow)}>
                      ${st.cls === 's-disabled' ? '启用' : '禁用'}
                    </button>
                    ${isSys ? `<button class="link-btn danger" data-act="del" ${dis(!isSysRow)}>删除</button>` : ''}
                  </div>
                </td>
              </tr>`;
          }).join('');
        }
        this._renderPager('s-u-pager', this._users, () => this._loadUserList());
      } catch (err) {
        console.error('[settings] 用户列表加载失败：', err);
        tbody.innerHTML = `<tr><td colspan="7" class="adm-empty">加载失败：${err && err.message ? err.message : '未知错误'}</td></tr>`;
      }
    },

    _delegateUserRowAction(e) {
      const btn = e.target.closest('button[data-act]');
      if (!btn || btn.disabled) return;
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = tr.getAttribute('data-id');
      const record = this._users.records.find(r => String(r.id) === String(id));
      if (!record) return;
      const act = btn.getAttribute('data-act');
      if (act === 'pass')   this._auditUser(record, true);
      if (act === 'reject') this._auditUser(record, false);
      if (act === 'toggle') this._toggleUserStatus(record);
      if (act === 'del')    this._deleteUser(record);
      if (act === 'edit')   this._openUserForm(record);
      if (act === 'bind')   this._openBindDevicesForm(record);
    },

    async _auditUser(u, approve) {
      try {
        await global.DashboardApi.AdminUser.audit(u.id, approve);
        global.UI?.Toast?.success(approve ? '已通过审核' : '已拒绝该注册请求');
        await this._loadUserList();
      } catch (err) {
        global.UI?.Toast?.error('操作失败：' + (err && err.message ? err.message : '未知错误'));
      }
    },

    async _toggleUserStatus(u) {
      const target = (u.status === 'DISABLED') ? 'ACTIVE' : 'DISABLED';
      try {
        await global.DashboardApi.AdminUser.setStatus(u.id, target);
        global.UI?.Toast?.success(target === 'ACTIVE' ? '已启用该用户' : '已禁用该用户');
        await this._loadUserList();
      } catch (err) {
        global.UI?.Toast?.error('操作失败：' + (err && err.message ? err.message : '未知错误'));
      }
    },

    async _deleteUser(u) {
      const ok = confirm(`确定删除用户「${u.username}」吗？删除后不可恢复。`);
      if (!ok) return;
      try {
        await global.DashboardApi.AdminUser.remove(u.id);
        global.UI?.Toast?.success('已删除用户');
        await this._loadUserList();
      } catch (err) {
        global.UI?.Toast?.error('删除失败：' + (err && err.message ? err.message : '未知错误'));
      }
    },

    _openUserForm(record) {
      if (!this._isSysAdmin()) return global.UI?.Toast?.warning('仅系统管理员可创建/编辑用户');
      const isEdit = !!record;
      const sess = this._getSession();
      this._miniDialog({
        title: isEdit ? '编辑用户' : '创建用户',
        bodyHtml: `
          <div class="form-grid" style="grid-template-columns:1fr 1fr">
            <div class="form-field full"><div class="form-label">登录账号 <small>*</small></div>
              <input id="md-u-name" type="text" class="ghost-input" value="${(record && record.username) || ''}" ${isEdit ? 'disabled style="opacity:.6;background:rgba(255,255,255,.04)"' : ''}/>
            </div>
            ${isEdit ? '' : `
              <div class="form-field"><div class="form-label">初始密码 <small>* ≥6 位</small></div>
                <input id="md-u-pwd" type="password" class="ghost-input" placeholder="请输入密码"/>
              </div>
              <div class="form-field"><div class="form-label">确认密码 <small>*</small></div>
                <input id="md-u-pwd2" type="password" class="ghost-input" placeholder="再输入一次"/>
              </div>`}
            <div class="form-field"><div class="form-label">角色 <small>*</small></div>
              <select id="md-u-role" class="ghost-input">
                <option value="RESIDENT">居民</option>
                <option value="COMMUNITY_ADMIN">小区管理员</option>
                <option value="FIREFIGHTER">消防员</option>
              </select>
            </div>
            <div class="form-field"><div class="form-label">归属小区 <small>* 消防员可留空</small></div>
              <select id="md-u-community" class="ghost-input"></select>
            </div>
            <div class="form-field"><div class="form-label">真实姓名</div>
              <input id="md-u-real" type="text" class="ghost-input" value="${(record && record.realName) || ''}"/>
            </div>
            <div class="form-field"><div class="form-label">联系电话</div>
              <input id="md-u-phone" type="text" class="ghost-input" value="${(record && record.phone) || ''}"/>
            </div>
          </div>`,
        onMount: async () => {
          const sel = document.getElementById('md-u-community');
          const roleSel = document.getElementById('md-u-role');
          const refreshCommunities = async () => {
            if (!sel) return;
            sel.innerHTML = '<option value="">— 无（仅消防员可留空）—</option>';
            try {
              let list = [];
              try {
                const p = await global.DashboardApi.Community.getList({ pageSize: 500 });
                list = (p && p.records) || [];
              } catch (_) {
                list = global.DashboardApi.COMMUNITIES || [];
              }
              list.forEach(c => {
                const o = document.createElement('option');
                o.value = String(c.id);
                o.textContent = c.name || ('社区 ' + c.id);
                if (record && String(record.communityId) === String(c.id)) o.selected = true;
                sel.appendChild(o);
              });
            } catch (e) { /* ignore */ }
          };
          if (roleSel && record) roleSel.value = record.role || 'RESIDENT';
          await refreshCommunities();
        },
        onSubmit: async () => {
          const username = (document.getElementById('md-u-name').value || '').trim();
          const role = (document.getElementById('md-u-role') || {}).value || '';
          const communityId = (document.getElementById('md-u-community') || {}).value || '';
          const realName = (document.getElementById('md-u-real').value || '').trim();
          const phone = (document.getElementById('md-u-phone').value || '').trim();
          if (!username) throw new Error('请填写登录账号');
          if (!role) throw new Error('请选择角色');
          if (role !== 'FIREFIGHTER' && !communityId) throw new Error('该角色必须归属一个小区');
          if (!isEdit) {
            const pwd = document.getElementById('md-u-pwd').value;
            const pwd2 = document.getElementById('md-u-pwd2').value;
            if (!pwd || pwd.length < 6) throw new Error('初始密码至少 6 位');
            if (pwd !== pwd2) throw new Error('两次密码不一致');
            await global.DashboardApi.AdminUser.create({
              username, password: pwd, role, communityId: communityId || null, realName, phone,
            });
            global.UI?.Toast?.success('用户已创建');
          } else {
            await global.DashboardApi.AdminUser.update(record.id, {
              role, communityId: communityId || null, realName, phone,
            });
            global.UI?.Toast?.success('用户已更新');
          }
          await this._loadUserList();
        },
        submitLabel: isEdit ? '保存修改' : '创建用户',
      });
    },

    _openBindDevicesForm(user) {
      // 居民：可绑定"同小区"的设备；可多选
      this._miniDialog({
        title: `住户绑定设备 · ${user.username || ''}`,
        bodyHtml: `
          <div class="form-grid" style="grid-template-columns:1fr">
            <div class="form-field full">
              <div class="form-label">当前绑定的设备</div>
              <div id="md-b-bound" class="bind-chips"><span style="color:var(--text-dim);font-size:12px;">加载中…</span></div>
            </div>
            <div class="form-field full">
              <div class="form-label">可绑定设备 <small>仅显示本小区设备</small></div>
              <select id="md-b-select" class="ghost-input" multiple size="8" style="min-height:160px;"></select>
              <div style="margin-top:8px;display:flex;gap:8px;">
                <button class="btn btn-primary" id="md-b-add">＋ 添加选中</button>
                <div style="flex:1"></div>
                <span style="color:var(--text-dim);font-size:12px;align-self:center;">
                  可多选（按住 Ctrl 或 Shift），点上方 chip 的 × 可解绑。
                </span>
              </div>
            </div>
          </div>`,
        onMount: async () => {
          const boundBox = document.getElementById('md-b-bound');
          const selEl = document.getElementById('md-b-select');
          const addBtn = document.getElementById('md-b-add');
          // 查当前已绑定
          const renderBound = async () => {
            try {
              const arr = await global.DashboardApi.AdminUser.getBoundDevices(user.id);
              if (!arr.length) {
                boundBox.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">当前未绑定任何设备。</span>';
                window._boundDevices = [];
              } else {
                window._boundDevices = arr;
                boundBox.innerHTML = arr.map(d =>
                  `<span class="bind-chip" data-id="${d.id || d.deviceId}">
                     ${d.name || d.deviceName || ('设备 ' + (d.id || d.deviceId))}
                     <button class="x" title="解绑">×</button>
                   </span>`).join('');
                boundBox.querySelectorAll('.bind-chip .x').forEach(btn => {
                  btn.addEventListener('click', async () => {
                    const chip = btn.closest('.bind-chip');
                    const devId = chip && chip.getAttribute('data-id');
                    if (!devId) return;
                    try {
                      await global.DashboardApi.UserDevice.unbind(devId, user.id);
                      global.UI?.Toast?.success('已解绑');
                      await renderBound();
                    } catch (err) {
                      global.UI?.Toast?.error('解绑失败：' + (err && err.message ? err.message : '未知错误'));
                    }
                  });
                });
              }
            } catch (err) {
              boundBox.innerHTML = `<span style="color:var(--red);font-size:12px;">已绑定列表加载失败：${err && err.message || '未知错误'}</span>`;
              window._boundDevices = [];
            }
          };
          // 查本小区设备列表
          const renderSelectable = async () => {
            try {
              const opts = { pageSize: 500 };
              // 如果是非系统管理员，后端会自动按社区过滤
              const page = await global.DashboardApi.Device.getList(opts);
              let rows = (page && page.records) || [];
              // 如能拿到 communityId，按同小区过滤（系统管理员场景）
              if (user.communityId) {
                rows = rows.filter(r => String(r.communityId || '') === String(user.communityId));
              }
              const boundIds = new Set((window._boundDevices || []).map(d => String(d.id || d.deviceId)));
              rows = rows.filter(r => !boundIds.has(String(r.id)));
              if (!rows.length) {
                selEl.innerHTML = '<option value="" disabled>（同小区暂无可选设备）</option>';
              } else {
                selEl.innerHTML = rows.map(r => `<option value="${r.id}">${r.name || r.deviceName || ('设备 ' + r.id)}${r.location ? ' — ' + r.location : ''}</option>`).join('');
              }
            } catch (err) {
              selEl.innerHTML = `<option value="" disabled>设备列表加载失败：${err && err.message || '未知错误'}</option>`;
            }
          };
          await renderBound();
          await renderSelectable();
          addBtn && addBtn.addEventListener('click', async () => {
            const ids = Array.from(selEl.selectedOptions).map(o => o.value).filter(Boolean);
            if (!ids.length) return global.UI?.Toast?.warning('请先选择至少一个设备');
            try {
              for (const id of ids) {
                await global.DashboardApi.UserDevice.bind(id, user.id);
              }
              global.UI?.Toast?.success(`已绑定 ${ids.length} 个设备`);
              await renderBound();
              await renderSelectable();
            } catch (err) {
              global.UI?.Toast?.error('绑定失败：' + (err && err.message ? err.message : '未知错误'));
            }
          });
        },
        onSubmit: () => { /* 操作都实时提交，确认仅关闭 */ return Promise.resolve(); },
        submitLabel: '完成',
        showCancel: false,
      });
    },

    /* ============================================================
     *   公用：分页条渲染 + 通用 mini 弹窗
     * ============================================================ */

    _renderPager(containerId, state, onPage) {
      const el = document.getElementById(containerId);
      if (!el) return;
      const total = Number(state.total || 0);
      const sz = Number(state.pageSize || 10);
      const totalPage = Math.max(1, Math.ceil(total / sz));
      const p = Math.min(Math.max(1, state.page || 1), totalPage);
      state.page = p;
      const from = total === 0 ? 0 : (p - 1) * sz + 1;
      const to = Math.min(p * sz, total);
      el.innerHTML = `
        <span>共 <b>${total}</b> 条，当前 ${from}-${to}</span>
        <span class="pg-ctrls">
          <button class="pg-btn" ${p <= 1 ? 'disabled' : ''} data-pg="first">首页</button>
          <button class="pg-btn" ${p <= 1 ? 'disabled' : ''} data-pg="prev">上一页</button>
          <span style="align-self:center;">第 ${p} / ${totalPage} 页</span>
          <button class="pg-btn" ${p >= totalPage ? 'disabled' : ''} data-pg="next">下一页</button>
          <button class="pg-btn" ${p >= totalPage ? 'disabled' : ''} data-pg="last">末页</button>
        </span>`;
      el.querySelectorAll('.pg-btn[data-pg]').forEach(b => {
        b.addEventListener('click', () => {
          const act = b.getAttribute('data-pg');
          if (act === 'first') state.page = 1;
          else if (act === 'last') state.page = totalPage;
          else if (act === 'prev') state.page = Math.max(1, p - 1);
          else if (act === 'next') state.page = Math.min(totalPage, p + 1);
          onPage && onPage();
        });
      });
    },

    /**
     * 通用 mini 弹窗（表单）
     * @param {object} opt
     * @param {string} opt.title
     * @param {string} opt.bodyHtml
     * @param {function=} opt.onMount
     * @param {function():Promise} opt.onSubmit 抛错即显示错误，不关闭
     * @param {string=} opt.submitLabel
     * @param {boolean=} opt.showCancel
     */
    _miniDialog({ title, bodyHtml, onMount, onSubmit, submitLabel = '确定', showCancel = true }) {
      const mask = document.createElement('div');
      mask.className = 'mini-dialog-mask';
      mask.innerHTML = `
        <div class="mini-dialog" role="dialog" aria-modal="true" aria-label="${title}">
          <div class="mini-dialog-head">
            <div class="mini-dialog-title">${title}</div>
            <button class="mini-dialog-close" aria-label="关闭">×</button>
          </div>
          <div class="mini-dialog-body">${bodyHtml}</div>
          <div class="mini-dialog-foot">
            ${showCancel ? '<button class="btn ghost md-cancel">取消</button>' : ''}
            <button class="btn btn-primary md-submit">${submitLabel}</button>
          </div>
        </div>`;
      document.body.appendChild(mask);

      const close = () => { if (mask.parentNode) mask.parentNode.removeChild(mask); };
      const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);

      mask.addEventListener('click', (e) => {
        if (e.target === mask) close();
      });
      mask.querySelector('.mini-dialog-close').addEventListener('click', close);
      const cancelBtn = mask.querySelector('.md-cancel');
      cancelBtn && cancelBtn.addEventListener('click', close);

      try { onMount && onMount(); } catch (err) { console.error('[mini-dialog] onMount:', err); }

      mask.querySelector('.md-submit').addEventListener('click', async () => {
        const submitBtn = mask.querySelector('.md-submit');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '处理中…'; }
        try {
          await (onSubmit ? onSubmit() : Promise.resolve());
          close();
        } catch (err) {
          console.error('[mini-dialog] submit:', err);
          global.UI?.Toast?.error(err && err.message ? err.message : '操作失败');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel; }
        }
      });
    },
  };

  global.Settings = Settings;
  global.SettingsComponent = Settings;
})(window);
