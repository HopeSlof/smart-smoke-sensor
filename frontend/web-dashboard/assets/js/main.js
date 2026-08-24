/**
 * main.js - 应用入口
 * ------------------------------------------------------------
 *  负责：
 *    1. 加载 CSS（如果 index.html 已加载可忽略）
 *    2. 等 DOMContentLoaded 后，初始化所有子组件
 *    3. 暴露 window.Dashboard 用于调试：
 *         Dashboard.refreshAll()      // 手动刷新所有数据
 *         Dashboard.modules.Xxx       // 访问各子模块
 * ------------------------------------------------------------ */
(function (global) {
  'use strict';

  const MODULES = [
    { key: 'Header',   init: 'init', destroy: 'destroy' },
    { key: 'Settings', init: 'init', destroy: undefined },
    { key: 'Overview', init: 'init', destroy: 'destroy' },
    { key: 'Chart',    init: 'init', destroy: 'destroy' },
    { key: 'Map',      init: 'init', destroy: undefined },
    { key: 'Alerts',   init: 'init', destroy: 'destroy' },
    { key: 'Review',   init: 'init', destroy: 'destroy' },
    { key: 'Broadcast',init: 'init', destroy: undefined },
    { key: 'Architecture', init: 'init', destroy: 'destroy' },
    { key: 'Mqtt', init: 'init', destroy: 'destroy' },
  ];

  function initAll() {
    const started = {};
    MODULES.forEach(m => {
      const Comp = global[m.key + 'Component'];
      if (!Comp || typeof Comp.init !== 'function') {
        console.warn('[main] 模块未找到或缺少 init:', m.key);
        return;
      }
      try {
        Comp.init();
        started[m.key] = Comp;
      } catch (err) {
        console.error('[main] 模块初始化失败 ' + m.key, err);
      }
    });

  /** 对外暴露调试对象 */
    global.Dashboard = {
      modules: started,
      /** 手动重新拉取所有模块的数据 */
      async refreshAll() {
        const jobs = [];
        Object.values(started).forEach(c => {
          if (typeof c.render === 'function')      jobs.push(c.render());
          else if (typeof c.renderAll === 'function') jobs.push(c.renderAll());
        });
        await Promise.all(jobs);
      },
    };

    /* ———————————————————————————————————————————————————————————
     *  兜底重绑：HTML inline onclick 里的 `XxxComponent.xxx && XxxComponent.xxx()`
     *  一旦短路 / 加载顺序有问题 / 全局名不匹配，点击就"没反应"也不报错。
     *  这里在所有模块 init 完之后（组件一定已挂载到 window 了），对核心按钮再加一次
     *  addEventListener，并加 try/catch + Toast 错误兜底，保证：
     *    · 点了一定有反应（成功打开 UI，或 Toast 明确提示错误）
     *    · 不会因为组件内部抛异常而"点了死静"
     * ——————————————————————————————————————————————————————————— */
    const rebind = (idOrSel, handler) => {
      const el = (idOrSel.startsWith('#') || idOrSel.startsWith('.') || idOrSel.includes(' '))
        ? document.querySelector(idOrSel)
        : document.getElementById(idOrSel);
      if (!el) return;
      // 组件内部已绑定过（dataset.bound 标记）则跳过，避免双重触发（重复弹窗）
      if (el.dataset && el.dataset.bound) return;
      // 移除内联 onclick，避免与 addEventListener 双重触发（重复弹窗）
      if (el.onclick) el.onclick = null;
      el.addEventListener('click', (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        try { handler(e, global); }
        catch (err) {
          console.error('[main] 按钮点击异常：' + idOrSel, err);
          if (global.UI && global.UI.Toast) {
            global.UI.Toast.error('操作失败：' + (err && err.message || '请稍后重试'));
          }
        }
      });
    };

    // 1. 告警汇总面板右上角"放大"按钮（用户说的"放大按钮"之一）
    rebind('btn-expand-alerts', (_, g) => {
      if (g.AlertsComponent && typeof g.AlertsComponent.openSummary === 'function') {
        g.AlertsComponent.openSummary();
      } else if (g.UI && g.UI.Toast) {
        g.UI.Toast.warn('告警模块加载中，请稍后再试');
      }
    });

    // 2. 设备总览面板右上角"+ 设备绑定管理"按钮
    rebind('btn-device-mgr', (_, g) => {
      if (g.DeviceMgrComponent && typeof g.DeviceMgrComponent.openManage === 'function') {
        g.DeviceMgrComponent.openManage();
      } else if (g.UI && g.UI.Toast) {
        g.UI.Toast.warn('设备管理模块加载中，请稍后再试');
      }
    });

    // 3. 头部退出登录按钮
    rebind('logoutBtn', async (_, g) => {
      if (g.Auth && typeof g.Auth.logout === 'function') {
        if (g.UI && g.UI.Toast) g.UI.Toast.info('正在退出登录…');
        await g.Auth.logout({ reason: 'logged-out' });
      }
    });

    // 4. 紧急广播关闭按钮 / 发送按钮（broadcast.js 已绑，但兜底一下防止用户点了没反应）
    rebind('btn-broadcast-close', (_, g) => { g.UI && g.UI.Modal && g.UI.Modal.close('broadcast-modal'); });
    rebind('btn-broadcast-send', (_, g) => {
      if (g.BroadcastComponent && typeof g.BroadcastComponent._send === 'function') g.BroadcastComponent._send();
    });

    // 5. 登录页切换密码可见（login.js 已绑但兜底）
    rebind('togglePwd', () => {
      const p = document.getElementById('password');
      if (p) p.type = (p.type === 'password') ? 'text' : 'password';
    });

    // 6. 所有 .preset-btn（紧急广播快捷模板，broadcast.js 已绑兜底）
    document.querySelectorAll('.preset-btn').forEach(b => {
      if (b.dataset && b.dataset.bound) return;
      b.addEventListener('click', () => {
        const ta = document.getElementById('broadcast-content');
        if (ta && b.dataset && b.dataset.text) ta.value = b.dataset.text;
      });
    });

    // 7. "查看全部 →" see-all 与 btn-expand-perception：overview.js 已在 _bindDeadButtons 绑了，但保险起见
    //    （如果 Overview 模块初始化失败导致 _bindDeadButtons 没跑，这里也兜底开）
    rebind('.see-all', (_, g) => {
      if (g.DeviceMgrComponent && typeof g.DeviceMgrComponent.openManage === 'function') g.DeviceMgrComponent.openManage();
    });
    rebind('btn-expand-perception', (_, g) => {
      if (g.OverviewComponent && typeof g.OverviewComponent._openPerceptionDetail === 'function') {
        g.OverviewComponent._openPerceptionDetail();
      }
    });

    /* ———————————————————————————————————————————————————————————
     *  角色权限 UI 守卫：
     *  在所有模块 init 完、DOM 已稳定之后，按当前登录角色隐藏/禁用专属入口。
     *  · 系统管理员：显示 AI 复核、紧急广播、阈值/联动/接入/存储等所有 Tab
     *  · 小区管理员：隐藏上述系统级入口，显示「数据范围：仅本小区」提示条
     *  · 普通用户：进一步收窄为「仅本人绑定设备」
     * ——————————————————————————————————————————————————————————— */
    try {
      if (global.RoleGuard && typeof global.RoleGuard.apply === 'function') {
        global.RoleGuard.apply();
      }
    } catch (err) {
      console.warn('[main] RoleGuard.apply 异常', err);
    }

    /* ———————————————————————————————————————————————————————————
     *  WebSocket 实时推送（STOMP）：
     *  在所有模块 init 完成、组件已挂载之后再启动，确保 WS 收到推送时
     *  AlertsComponent/HeaderComponent/OverviewComponent 都可用。
     *  WS 初始化失败不影响其他功能（内部已降级）。
     * ——————————————————————————————————————————————————————————— */
    try {
      if (global.WS && typeof global.WS.init === 'function') {
        global.WS.init();
      }
    } catch (err) {
      console.warn('[main] WebSocket 模块初始化失败', err);
    }

    console.info('[智慧烟感大屏] 初始化完成，共', Object.keys(started).length, '个模块。');
    console.info('[智慧烟感大屏] 调试对象：window.Dashboard');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})(window);
