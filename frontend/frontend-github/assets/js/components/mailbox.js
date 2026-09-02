/**
 * components/mailbox.js - 管理员邮箱面板（查看居民站内消息）
 * ------------------------------------------------------------
 * 数据源：DashboardApi.Message.getList / markRead
 * 权限：系统管理员看全部消息，小区管理员看本小区消息（后端已按角色过滤）
 */
(function (global) {
  'use strict';

  const TYPE_LABEL = {
    REPAIR: '设备报修',
    ADDRESS_CHANGE: '地址变更',
    ADD_DEVICE: '申请加设备',
    OTHER: '其他',
  };
  const TYPE_COLOR = {
    REPAIR: '#f59e0b',
    ADDRESS_CHANGE: '#38bdf8',
    ADD_DEVICE: '#22c55e',
    OTHER: '#94a3b8',
  };

  const Mailbox = {
    async openMailbox() {
      const mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;z-index:1200;background:rgba(3,8,20,0.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;';
      mask.innerHTML = `
        <div style="width:640px;max-width:100%;max-height:82vh;display:flex;flex-direction:column;background:linear-gradient(160deg,#0b1626,#0d1b30);border:1px solid rgba(34,211,238,0.28);border-radius:14px;box-shadow:0 16px 50px rgba(0,0,0,0.55);overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid rgba(148,163,184,0.15);">
            <div style="font-size:16px;font-weight:700;color:var(--text-main);letter-spacing:1px;">居民消息信箱</div>
            <button class="mb-close" type="button" aria-label="关闭居民消息信箱" title="关闭居民消息信箱" style="background:transparent;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;line-height:1;padding:2px 6px;">×</button>
          </div>
          <div id="mb-list" style="flex:1;overflow-y:auto;padding:16px 22px;">
            <div style="color:var(--text-dim);font-size:13px;text-align:center;padding:30px 0;">加载中…</div>
          </div>
        </div>`;
      document.body.appendChild(mask);

      const close = () => {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        document.removeEventListener('keydown', onKey);
      };
      mask.querySelector('.mb-close').addEventListener('click', close);
      mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
      const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);

      await this._renderList(mask);
    },

    async _renderList(mask) {
      const listHost = mask.querySelector('#mb-list');
      let page;
      try {
        page = await global.DashboardApi.Message.getList({ page: 1, pageSize: 100 });
      } catch (e) {
        listHost.innerHTML = '<div style="color:#fca5a5;font-size:13px;text-align:center;padding:30px 0;">消息加载失败：' + (e && e.message || '未知错误') + '</div>';
        return;
      }
      const records = (page && page.records) || [];
      if (!records.length) {
        listHost.innerHTML = '<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:40px 0;">暂无居民消息</div>';
        return;
      }
      listHost.innerHTML = records.map(m => {
        const isAdmin = m.senderRole === 'ADMIN';
        const color = TYPE_COLOR[m.type] || TYPE_COLOR.OTHER;
        const typeLabel = TYPE_LABEL[m.type] || m.type || '其他';
        const unread = m.status !== 'READ';
        // 管理员回复：缩进 + 绿色标记
        if (isAdmin) {
          return `
          <div class="mb-item" data-id="${m.id}" data-read="${m.status === 'READ' ? 'true' : 'false'}"
               style="padding:10px 14px;margin-bottom:10px;margin-left:26px;border-radius:10px;cursor:${unread ? 'pointer' : 'default'};
                 background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.18);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;flex-wrap:wrap;gap:6px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:12px;font-weight:600;color:#4ade80;">↩ 管理员回复</span>
                ${unread ? '<span class="mb-unread" style="font-size:10px;color:#f87171;">● 未读</span>' : ''}
              </div>
              <span style="font-size:11px;color:var(--text-dim);">${this._fmtTime(m.createdAt)}</span>
            </div>
            <div style="font-size:13px;color:var(--text-muted);line-height:1.6;white-space:pre-wrap;">${this._esc(m.content) || ''}</div>
          </div>`;
        }
        // 居民消息：带「回复」按钮
        return `
          <div class="mb-item" data-id="${m.id}" data-read="${m.status === 'READ' ? 'true' : 'false'}"
               style="padding:12px 14px;margin-bottom:10px;border-radius:10px;cursor:${unread ? 'pointer' : 'default'};
                 background:${unread ? 'rgba(34,211,238,0.06)' : 'rgba(255,255,255,0.02)'};
                 border:1px solid ${unread ? 'rgba(34,211,238,0.25)' : 'rgba(148,163,184,0.12)'};">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:13px;font-weight:600;color:var(--text-main);">${this._esc(m.senderUsername) || '居民'}</span>
                <span style="font-size:11px;padding:2px 8px;border-radius:999px;color:${color};background:${color}1f;border:1px solid ${color}44;">${typeLabel}</span>
                ${unread ? '<span class="mb-unread" style="font-size:10px;color:#f87171;">● 未读</span>' : ''}
              </div>
              <span style="font-size:11px;color:var(--text-dim);">${this._fmtTime(m.createdAt)}</span>
            </div>
            <div style="font-size:13px;color:var(--text-muted);line-height:1.6;white-space:pre-wrap;">${this._esc(m.content) || ''}</div>
            <div style="margin-top:8px;text-align:right;">
              <button class="mb-reply" data-id="${m.id}" style="background:transparent;border:1px solid rgba(34,211,238,0.35);color:var(--cyan);font-size:12px;padding:4px 12px;border-radius:6px;cursor:pointer;">回复</button>
            </div>
          </div>`;
      }).join('');

      // 回复按钮
      listHost.querySelectorAll('.mb-reply').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          this._reply(id, () => this._renderList(mask));
        });
      });

      // 点击未读消息 → 标记已读
      listHost.querySelectorAll('.mb-item[data-read="false"]').forEach(item => {
        item.addEventListener('click', async () => {
          const id = item.getAttribute('data-id');
          try {
            await global.DashboardApi.Message.markRead(id);
            item.setAttribute('data-read', 'true');
            item.style.background = 'rgba(255,255,255,0.02)';
            item.style.border = '1px solid rgba(148,163,184,0.12)';
            item.style.cursor = 'default';
            const badge = item.querySelector('.mb-unread');
            if (badge) badge.remove();
          } catch (e) { /* ignore */ }
        });
      });
    },

    _reply(messageId, onDone) {
      const mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;z-index:1300;background:rgba(3,8,20,0.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;';
      mask.innerHTML = `
        <div style="width:420px;max-width:100%;background:linear-gradient(160deg,#0b1626,#0d1b30);border:1px solid rgba(34,211,238,0.28);border-radius:14px;padding:22px 24px 20px;box-shadow:0 16px 50px rgba(0,0,0,0.55);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <div style="font-size:16px;font-weight:700;color:var(--text-main);letter-spacing:1px;">回复居民</div>
            <button class="rp-close" type="button" aria-label="关闭回复窗口" title="关闭回复窗口" style="background:transparent;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;line-height:1;padding:2px 6px;">×</button>
          </div>
          <div style="margin-bottom:13px;margin-top:10px;">
            <label style="display:block;font-size:12px;color:var(--text-dim);margin-bottom:6px;">回复内容</label>
            <textarea id="rp-content" rows="4" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(148,163,184,0.25);border-radius:8px;padding:10px 12px;color:var(--text-main);font-size:13px;resize:vertical;font-family:inherit;"></textarea>
          </div>
          <div id="rp-err" style="color:#fca5a5;font-size:12px;min-height:16px;margin-top:4px;"></div>
          <div style="display:flex;gap:10px;margin-top:14px;">
            <button id="rp-cancel" class="btn btn-ghost" style="flex:1;" type="button">取消</button>
            <button id="rp-submit" class="btn btn-primary" style="flex:1;" type="button">发送回复</button>
          </div>
        </div>`;
      document.body.appendChild(mask);
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      const close = () => {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        document.removeEventListener('keydown', onKey);
      };
      const showErr = (msg) => { const e = mask.querySelector('#rp-err'); if (e) e.textContent = msg; };
      mask.querySelector('.rp-close').addEventListener('click', close);
      mask.querySelector('#rp-cancel').addEventListener('click', close);
      mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
      document.addEventListener('keydown', onKey);
      const submitBtn = mask.querySelector('#rp-submit');
      submitBtn.addEventListener('click', async () => {
        const content = mask.querySelector('#rp-content').value.trim();
        if (!content) { showErr('请输入回复内容'); return; }
        submitBtn.disabled = true; submitBtn.textContent = '发送中…';
        try {
          await global.DashboardApi.Message.reply(messageId, content);
          close();
          if (global.UI && global.UI.Toast) global.UI.Toast.success('回复已发送');
          onDone && onDone();
        } catch (e) {
          showErr((e && e.message) || '回复失败，请稍后重试');
          submitBtn.disabled = false; submitBtn.textContent = '发送回复';
        }
      });
    },

    _esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    },

    _fmtTime(s) {
      if (!s) return '--';
      try {
        const d = new Date(s);
        if (isNaN(d.getTime())) return s;
        const pad = n => (n < 10 ? '0' : '') + n;
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      } catch (e) { return s; }
    },
  };

  global.MailboxComponent = Mailbox;
})(window);
