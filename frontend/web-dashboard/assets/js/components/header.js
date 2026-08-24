/**
 * components/header.js - 顶部标题栏（时钟 + 状态栏 + 全局工具栏）
 * 数据源：DateUtil + DashboardApi.System.getHeaderStatus
 * 工具栏：刷新 / 告警静音 / 全屏 / 设置
 */
(function (global) {
  'use strict';

  const { $ } = global.DomUtil;
  const { formatHMS, formatDateCN } = global.DateUtil;

  const Header = {
    _timeTimer: null,
    _statusTimer: null,
    _muted: false,

    init() {
      this._bindTime();
      this._fetchStatus();
      this._bindToolbar();
      this._bindAuthBar();
      this._statusTimer = setInterval(() => this._fetchStatus(), 30_000);
    },

    _bindTime() {
      const tick = () => {
        const t = $('now-time'); if (t) t.textContent = formatHMS();
        const d = $('now-date'); if (d) d.textContent = formatDateCN();
      };
      tick();
      this._timeTimer = setInterval(tick, 1000);
    },

    /** ---------- 顶部工具栏按钮 ---------- */
    _bindToolbar() {
      // 全屏
      $('btn-fullscreen')?.addEventListener('click', () => {
        global.UI.Fullscreen.toggle();
        setTimeout(() => {
          const on = global.UI.Fullscreen.isActive();
          global.UI.Toast.success(on ? '已进入全屏模式 · 按 F11 或 ESC 退出' : '已退出全屏');
        }, 60);
      });

      // 刷新 (手动触发所有组件 render)
      $('btn-refresh')?.addEventListener('click', async () => {
        const btn = $('btn-refresh');
        if (btn) btn.style.transition = 'transform 0.6s', btn.style.transform = 'rotate(360deg)';
        setTimeout(() => btn && (btn.style.transform = ''), 600);
        global.UI.Toast.info('正在刷新数据...');
        try {
          await Promise.all([
            global.HeaderComponent?._fetchStatus(),
            global.OverviewComponent?.render(),
            global.ChartComponent?.render(),
            global.MapComponent?.render(),
            global.AlertsComponent?.render(),
          ]);
          global.UI.Toast.success('所有面板刷新完成');
        } catch (e) {
          global.UI.Toast.error('刷新过程中出现异常');
        }
      });

      // 静音 (给 body 加 class，停止告警闪烁/脉冲动画)
      $('btn-mute')?.addEventListener('click', () => {
        Header._muted = !Header._muted;
        document.body.classList.toggle('alerts-muted', Header._muted);
        $('btn-mute')?.classList.toggle('is-active', Header._muted);
        // 告警面板内的 anim-alert 样式将被 body.alerts-muted 抑制
        global.UI.Toast[Header._muted ? 'warn' : 'success'](
          Header._muted ? '告警静音已开启：不再闪烁提示' : '告警静音已关闭：恢复闪烁提示'
        );
      });

      // 设置：btn-settings 的 click 由 SettingsComponent.init() 统一绑定一次（避免同一按钮重复绑定触发两次 click 打乱守卫）
      // 只做降级兜底：settings 未加载时提示

      // 快捷键
      document.addEventListener('keydown', (e) => {
        // F11 浏览器默认处理全屏；这里仅处理 F5
        if (e.key === 'F5') {
          e.preventDefault();
          $('btn-refresh')?.click();
        }
      });
    },

    /** ---------- 登录身份 / 登出按钮 ---------- */
    _bindAuthBar() {
      const s = global.Auth?.getSession();
      if (!s) return;
      // 身份显示（三角色）
      const nameEl = $('whoami-name');
      const Auth = global.Auth || {};
      const label = (Auth.roleLabel && typeof Auth.roleLabel === 'function')
        ? Auth.roleLabel(s.role)
        : (s.role === 'user' ? '普通用户' : (s.role === 'community_admin' ? '小区管理员' : '系统管理员'));
      if (nameEl) {
        nameEl.textContent = label + ' · ' + (s.username || '--');
      }
      const chip = $('whoami');
      if (chip) {
        let tip = '当前为普通用户身份（仅可查看本人绑定设备/告警）';
        if (s.role === 'system_admin')      tip = '当前为系统管理员身份（全局权限：阈值、所有小区设备/告警、控制日志、知识库导入等全部管理功能）';
        else if (s.role === 'community_admin') tip = '当前为小区管理员身份（仅可管理本小区设备、处置本小区告警；阈值、跨小区、全局日志等需系统管理员）';
        chip.title = tip;
      }
      // 登出（避免使用 window.confirm，原生确认框在某些环境被静默拦截）
      const btn = $('logoutBtn');
      if (btn) {
        btn.addEventListener('click', () => {
          const UI = global.UI || {};
          if (UI.Toast) UI.Toast.info('正在退出登录…');
          // 50ms 延迟确保 Toast 渲染出来再跳转
          setTimeout(() => global.Auth.logout({ reason: 'logged-out' }), 50);
        });
      }
    },

    async _fetchStatus() {
      try {
        const data = await global.DashboardApi.System.getHeaderStatus();
        if (!data) return;
        // 用明确的 id 定位，避免被 RoleGuard 注入的 role-scope-banner 抢占索引
        const systemChip = document.getElementById('chip-system-status');
        const alertChip  = document.getElementById('chip-pending-alerts');
        if (systemChip) {
          systemChip.textContent = data.systemOk ? '系统正常' : '系统异常';
          systemChip.classList.toggle('warn', !data.systemOk);
        }
        if (alertChip && typeof data.pendingAlerts === 'number') {
          alertChip.textContent = `${data.pendingAlerts} 告警待处理`;
          alertChip.classList.toggle('warn', data.pendingAlerts === 0);
          alertChip.classList.toggle('danger', data.pendingAlerts > 0);
        }
      } catch (err) {
        console.warn('[header] 拉取系统状态失败', err);
      }
    },

    destroy() {
      if (this._timeTimer)   clearInterval(this._timeTimer);
      if (this._statusTimer) clearInterval(this._statusTimer);
    },
  };

  global.HeaderComponent = Header;
})(window);
