/**
 * components/broadcast.js - 紧急广播控制（手动下发联动广播指令）
 * 数据源：
 *   DashboardApi.Broadcast.send      → 下发广播
 *   DashboardApi.Broadcast.getHistory → 广播下发记录
 * 交互：
 *   header 工具栏「紧急广播」按钮 → 打开 Modal
 *   Modal 内：范围选择 / 内容输入 / 快捷模板 / 下发 / 历史记录
 */
(function (global) {
  'use strict';

  const { $, create, render } = global.DomUtil;

  const SCOPE_TEXT = { all: '全部设备', area: '指定区域', single: '指定设备' };

  const Broadcast = {
    _scope: 'all',

    init() {
      this._bind();
    },

    _bind() {
      // 工具栏按钮 → 打开弹窗
      $('btn-broadcast')?.addEventListener('click', () => this.open());

      // 关闭按钮
      $('btn-broadcast-close')?.addEventListener('click', () =>
        global.UI.Modal.close('broadcast-modal')
      );

      // 范围 Tabs
      const tabs = document.querySelectorAll('.scope-tab');
      tabs.forEach(t => {
        t.addEventListener('click', () => {
          tabs.forEach(x => x.classList.remove('is-active'));
          t.classList.add('is-active');
          this._scope = t.dataset.scope || 'all';
          const devRow = $('broadcast-device-row');
          if (devRow) devRow.style.display = this._scope === 'single' ? '' : 'none';
        });
      });

      // 快捷模板
      document.querySelectorAll('.preset-btn').forEach(b => {
        b.dataset.bound = '1'; // 标记已绑定，避免 main.js 兜底重复绑定
        b.addEventListener('click', () => {
          const ta = $('broadcast-content');
          if (ta) ta.value = b.dataset.text || '';
        });
      });

      // 下发广播
      const sendBtn = $('btn-broadcast-send');
      if (sendBtn) {
        sendBtn.dataset.bound = '1'; // 标记已绑定，避免 main.js 兜底重复绑定
        sendBtn.addEventListener('click', () => this._send());
      }
    },

    async open() {
      global.UI.Modal.open('broadcast-modal');
      // 重置表单
      const ta = $('broadcast-content');
      const dev = $('broadcast-device');
      if (ta) ta.value = '';
      if (dev) dev.value = '';
      await this._renderHistory();
    },

    async _send() {
      const UI = global.UI;
      const content = $('broadcast-content')?.value.trim();
      if (!content) {
        UI.Toast.warn('请输入广播内容');
        return;
      }
      const payload = { content, scope: this._scope };
      if (this._scope === 'single') {
        const dev = $('broadcast-device')?.value.trim();
        if (!dev) {
          UI.Toast.warn('请输入设备编号');
          return;
        }
        payload.deviceId = dev;
      }

      const btn = $('btn-broadcast-send');
      const origHTML = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.textContent = '下发中…'; }

      try {
        await global.DashboardApi.Broadcast.send(payload);
        UI.Toast.success('广播指令已下发');
        const contentEl = $('broadcast-content');
        if (contentEl) contentEl.value = '';
        await this._renderHistory();
      } catch (err) {
        UI.Toast.error('下发失败：' + (err && err.message || '请稍后重试'));
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
      }
    },

    async _renderHistory() {
      const host = $('broadcast-history-host');
      if (!host) return;
      let list = [];
      try {
        list = await global.DashboardApi.Broadcast.getHistory(10);
      } catch (e) {
        console.warn('[broadcast] 历史拉取失败', e);
      }
      if (!list || list.length === 0) {
        host.innerHTML = '<div class="empty-placeholder" style="min-height:80px;"><span>暂无广播记录</span></div>';
        return;
      }
      const resultCfg = {
        success: { text: '成功',   cls: 'ok'      },
        fail:    { text: '失败',   cls: 'danger'  },
        pending: { text: '下发中', cls: 'warn'    },
      };
      render(host, list.map(h => {
        const r = resultCfg[h.result] || resultCfg.pending;
        return create('div', { class: 'bc-history-item' }, [
          create('div', { class: 'bc-history-head' }, [
            create('span', { class: 'bc-scope ' + (h.result || 'pending') },
              SCOPE_TEXT[h.scope] || h.scope || '--'),
            create('span', { class: 'bc-time' }, h.sentAt || '--'),
            create('span', { class: 'bc-result ' + r.cls }, r.text),
          ]),
          create('div', { class: 'bc-content' }, h.content || ''),
          create('div', { class: 'bc-meta' }, [
            create('span', {}, '设备：' + (h.deviceId || '全部')),
            create('span', {}, '操作人：' + (h.operator || '--')),
          ]),
        ]);
      }));
    },
  };

  global.BroadcastComponent = Broadcast;
})(window);
