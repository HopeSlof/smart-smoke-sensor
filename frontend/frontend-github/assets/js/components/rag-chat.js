/**
 * components/rag-chat.js - RAG 智能问答浮动面板
 * 接口：DashboardApi.Rag.chat / listSessions / getMessages / deleteSession
 * 功能：多轮对话、会话历史、引用来源展示
 */
(function (global) {
  'use strict';

  const RagChat = {
    _isOpen: false,
    _sessionId: null,
    _sessions: [],
    _messages: [],
    _loading: false,

    init() {
      this._buildUI();
      this._bindEvents();
    },

    /** 构建浮动按钮 + 聊天面板 */
    _buildUI() {
      // 浮动入口按钮
      const fab = document.createElement('button');
      fab.id = 'rag-chat-fab';
      fab.title = 'AI 智能问答';
      fab.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          <circle cx="9" cy="11" r="1" fill="currentColor"/>
          <circle cx="13" cy="11" r="1" fill="currentColor"/>
          <circle cx="17" cy="11" r="1" fill="currentColor"/>
        </svg>`;
      fab.style.cssText = 'position:fixed;bottom:28px;right:28px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;z-index:9998;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0891b2,#1d4ed8);color:#fff;box-shadow:0 8px 32px rgba(8,145,178,0.4),0 0 20px rgba(34,211,238,0.3);transition:all .3s;';
      fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.1)'; fab.style.boxShadow = '0 12px 40px rgba(8,145,178,0.5),0 0 30px rgba(34,211,238,0.4)'; });
      fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; fab.style.boxShadow = '0 8px 32px rgba(8,145,178,0.4),0 0 20px rgba(34,211,238,0.3)'; });
      document.body.appendChild(fab);
      this._fab = fab;

      // 聊天面板
      const panel = document.createElement('div');
      panel.id = 'rag-chat-panel';
      panel.style.cssText = 'position:fixed;bottom:100px;right:28px;width:420px;max-width:94vw;height:560px;max-height:80vh;border-radius:16px;z-index:9999;display:none;flex-direction:column;overflow:hidden;border:1px solid rgba(34,211,238,0.3);background:linear-gradient(160deg,rgba(15,23,42,0.98),rgba(2,6,23,0.95));box-shadow:0 24px 80px rgba(0,0,0,0.5),0 0 40px rgba(34,211,238,0.12);';
      panel.innerHTML = `
        <!-- 标题栏 -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px 12px;border-bottom:1px solid rgba(34,211,238,0.15);flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,rgba(34,211,238,0.2),rgba(29,78,216,0.15));display:flex;align-items:center;justify-content:center;border:1px solid rgba(34,211,238,0.3);">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--text-main);letter-spacing:1px;">智能问答助手</div>
              <div style="font-size:10px;color:var(--text-dim);margin-top:1px;">基于 RAG · 消防应急知识库</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button id="rag-chat-history" title="会话历史" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(34,211,238,0.2);background:rgba(34,211,238,0.06);color:var(--cyan);cursor:pointer;display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </button>
            <button id="rag-chat-new" title="新建会话" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(34,211,238,0.2);background:rgba(34,211,238,0.06);color:var(--cyan);cursor:pointer;display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            </button>
            <button id="rag-chat-close" title="关闭" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(255,71,87,0.3);background:rgba(255,71,87,0.08);color:#ff4757;cursor:pointer;display:flex;align-items:center;justify-content:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <!-- 消息列表区 -->
        <div id="rag-chat-body" style="flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;">
          <div style="text-align:center;padding:20px 10px;">
            <div style="width:48px;height:48px;margin:0 auto 10px;border-radius:50%;background:rgba(34,211,238,0.1);display:flex;align-items:center;justify-content:center;border:1px solid rgba(34,211,238,0.2);">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div style="font-size:13px;color:var(--text-dim);line-height:1.8;">你好，我是消防应急助手<br/>请输入你的问题，如：<br/>「厨房油锅起火怎么处理？」<br/>「烟感探测器多久换一次电池？」</div>
          </div>
        </div>

        <!-- 输入区 -->
        <div style="padding:10px 14px 14px;border-top:1px solid rgba(34,211,238,0.12);flex-shrink:0;">
          <div style="display:flex;align-items:flex-end;gap:8px;">
            <textarea id="rag-chat-input" rows="1" placeholder="输入你的问题..." style="flex:1;resize:none;max-height:100px;padding:10px 12px;border-radius:10px;border:1px solid rgba(34,211,238,0.25);background:rgba(0,20,40,0.6);color:var(--text-main);font-size:13px;font-family:inherit;outline:none;line-height:1.5;"></textarea>
            <button id="rag-chat-send" title="发送" style="width:40px;height:40px;border-radius:10px;border:none;cursor:pointer;background:linear-gradient(135deg,#0891b2,#1d4ed8);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>`;
      document.body.appendChild(panel);
      this._panel = panel;
    },

    /** 绑定事件 */
    _bindEvents() {
      // 浮动按钮 → 切换面板
      this._fab.addEventListener('click', () => this._toggle());

      // 关闭
      document.getElementById('rag-chat-close').addEventListener('click', () => this._toggle());

      // 新建会话
      document.getElementById('rag-chat-new').addEventListener('click', () => this._newSession());

      // 会话历史
      document.getElementById('rag-chat-history').addEventListener('click', () => this._showHistory());

      // 输入框自适应高度 + 回车发送
      const input = document.getElementById('rag-chat-input');
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._send();
        }
      });

      // 发送按钮
      document.getElementById('rag-chat-send').addEventListener('click', () => this._send());
    },

    /** 切换面板开关 */
    _toggle() {
      this._isOpen = !this._isOpen;
      this._panel.style.display = this._isOpen ? 'flex' : 'none';
      if (this._isOpen) {
        const input = document.getElementById('rag-chat-input');
        if (input) input.focus();
        // 首次打开时加载会话列表
        if (!this._sessionsLoaded) {
          this._loadSessions();
          this._sessionsLoaded = true;
        }
      }
    },

    /** 新建会话 */
    _newSession() {
      this._sessionId = null;
      this._messages = [];
      const body = document.getElementById('rag-chat-body');
      if (body) {
        body.innerHTML = `
          <div style="text-align:center;padding:20px 10px;">
            <div style="font-size:13px;color:var(--text-dim);line-height:1.8;">新会话已创建<br/>请输入你的问题</div>
          </div>`;
      }
      const input = document.getElementById('rag-chat-input');
      if (input) input.focus();
      try { if (global.UI && global.UI.Toast) global.UI.Toast.info('已创建新会话'); } catch (_) {}
    },

    /** 加载会话列表 */
    async _loadSessions() {
      try {
        const list = await global.DashboardApi.Rag.listSessions();
        this._sessions = Array.isArray(list) ? list : [];
      } catch (err) {
        console.warn('[rag-chat] 会话列表拉取失败', err);
        this._sessions = [];
      }
    },

    /** 显示会话历史侧边栏 */
    async _showHistory() {
      await this._loadSessions();
      if (!this._sessions || this._sessions.length === 0) {
        try { if (global.UI && global.UI.Toast) global.UI.Toast.info('暂无历史会话'); } catch (_) {}
        return;
      }

      // 构造历史弹窗
      const modalId = 'rag-chat-history-modal';
      const old = document.getElementById(modalId);
      if (old) old.remove();

      const overlay = document.createElement('div');
      overlay.id = modalId;
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,0.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;';
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

      const panel = document.createElement('div');
      panel.style.cssText = 'width:400px;max-width:90vw;max-height:70vh;display:flex;flex-direction:column;border-radius:14px;border:1px solid rgba(34,211,238,0.3);background:linear-gradient(160deg,rgba(15,23,42,0.98),rgba(2,6,23,0.95));box-shadow:0 20px 60px rgba(0,0,0,0.5);overflow:hidden;';

      panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(34,211,238,0.15);">
          <span style="font-size:14px;font-weight:700;color:var(--text-main);">会话历史</span>
          <button type="button" style="width:28px;height:28px;border-radius:6px;border:1px solid rgba(255,71,87,0.3);background:rgba(255,71,87,0.08);color:#ff4757;cursor:pointer;display:flex;align-items:center;justify-content:center;" onclick="document.getElementById('rag-chat-history-modal')?.remove()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div id="rag-history-list" style="flex:1;overflow-y:auto;padding:8px 10px;"></div>`;

      const listWrap = panel.querySelector('#rag-history-list');
      this._sessions.forEach(s => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;margin-bottom:6px;border-radius:10px;border:1px solid rgba(34,211,238,0.12);background:rgba(34,211,238,0.04);cursor:pointer;transition:all .15s;';
        item.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2" style="flex-shrink:0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.title || '未命名会话'}</div>
            <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">${s.updatedAt || ''}</div>
          </div>
          <button class="rag-del-btn" data-sid="${s.id}" title="删除" style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(255,71,87,0.25);background:rgba(255,71,87,0.06);color:#ff4757;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>`;
        item.addEventListener('mouseenter', () => { item.style.background = 'rgba(34,211,238,0.1)'; item.style.borderColor = 'rgba(34,211,238,0.35)'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'rgba(34,211,238,0.04)'; item.style.borderColor = 'rgba(34,211,238,0.12)'; });
        item.addEventListener('click', (e) => {
          if (e.target.closest('.rag-del-btn')) return;
          this._loadSessionMessages(s.id, s.title);
          overlay.remove();
        });
        // 删除按钮
        const delBtn = item.querySelector('.rag-del-btn');
        if (delBtn) delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await global.DashboardApi.Rag.deleteSession(s.id);
            item.remove();
            if (String(this._sessionId) === String(s.id)) this._newSession();
            try { if (global.UI && global.UI.Toast) global.UI.Toast.info('会话已删除'); } catch (_) {}
          } catch (err) {
            try { if (global.UI && global.UI.Toast) global.UI.Toast.error('删除失败：' + (err.message || '')); } catch (_) {}
          }
        });
        listWrap.appendChild(item);
      });

      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    },

    /** 加载某会话的历史消息 */
    async _loadSessionMessages(sessionId, title) {
      const body = document.getElementById('rag-chat-body');
      if (body) body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim);font-size:12px;">加载中...</div>';
      try {
        const msgs = await global.DashboardApi.Rag.getMessages(sessionId);
        this._sessionId = sessionId;
        this._messages = Array.isArray(msgs) ? msgs : [];
        if (body) body.innerHTML = '';
        this._messages.forEach(m => this._appendMessage(m.role, m.content, m.sources));
        try { if (global.UI && global.UI.Toast) global.UI.Toast.info('已加载会话：' + (title || '')); } catch (_) {}
        const input = document.getElementById('rag-chat-input');
        if (input) input.focus();
      } catch (err) {
        if (body) body.innerHTML = '<div style="text-align:center;padding:20px;color:#ff4757;font-size:12px;">加载失败</div>';
      }
    },

    /** 发送消息 */
    async _send() {
      const input = document.getElementById('rag-chat-input');
      if (!input) return;
      const text = input.value.trim();
      if (!text || this._loading) return;

      // 追加用户消息到界面
      this._appendMessage('user', text);
      input.value = '';
      input.style.height = 'auto';

      // 显示加载中
      this._loading = true;
      const sendBtn = document.getElementById('rag-chat-send');
      if (sendBtn) sendBtn.style.opacity = '0.5';
      this._appendMessage('loading', '正在思考...');

      try {
        const res = await global.DashboardApi.Rag.chat(text, this._sessionId);
        // 移除 loading 消息
        this._removeLastLoading();
        if (res) {
          this._sessionId = res.sessionId;
          this._appendMessage('assistant', res.answer, res.sources);
        }
      } catch (err) {
        this._removeLastLoading();
        this._appendMessage('error', '回答失败：' + (err && err.message || '请稍后重试'));
      } finally {
        this._loading = false;
        if (sendBtn) sendBtn.style.opacity = '1';
      }
    },

    /** 追加消息到聊天区 */
    _appendMessage(role, content, sources) {
      const body = document.getElementById('rag-chat-body');
      if (!body) return;

      // 移除欢迎语
      const welcome = body.querySelector('div[style*="text-align:center"]');
      if (welcome && body.children.length <= 1) welcome.remove();

      const wrap = document.createElement('div');
      const isUser = role === 'user';
      const isErr = role === 'error';
      const isLoading = role === 'loading';
      const bg = isUser ? 'rgba(8,145,178,0.15)' : isErr ? 'rgba(239,68,68,0.12)' : isLoading ? 'rgba(148,163,184,0.08)' : 'rgba(34,211,238,0.08)';
      const color = isUser ? '#a8e6ff' : isErr ? '#f87171' : isLoading ? 'var(--text-dim)' : 'var(--text-main)';
      const align = isUser ? 'flex-end' : 'flex-start';
      const radius = isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px';

      wrap.style.cssText = `max-width:85%;padding:10px 14px;border-radius:${radius};background:${bg};color:${color};font-size:13px;line-height:1.65;white-space:pre-wrap;word-break:break-word;align-self:${align};`;
      wrap.textContent = content || '';

      // AI 回答附引用来源
      if (!isUser && !isErr && !isLoading && sources && sources.length > 0) {
        const srcDiv = document.createElement('div');
        srcDiv.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(34,211,238,0.12);';
        srcDiv.innerHTML = '<div style="font-size:10px;color:var(--text-dim);margin-bottom:4px;">引用来源：</div>';
        sources.forEach((src, i) => {
          const item = document.createElement('div');
          item.style.cssText = 'font-size:10px;color:var(--text-dim);margin-bottom:3px;padding:4px 6px;border-radius:4px;background:rgba(34,211,238,0.04);';
          item.innerHTML = `<b style="color:var(--cyan);">[${i + 1}]</b> ${src.title || ''}`;
          // 悬停查看全文
          item.title = src.content || '';
          item.style.cursor = 'help';
          srcDiv.appendChild(item);
        });
        wrap.appendChild(srcDiv);
      }

      body.appendChild(wrap);
      body.scrollTop = body.scrollHeight;
    },

    /** 移除最后一条 loading 消息 */
    _removeLastLoading() {
      const body = document.getElementById('rag-chat-body');
      if (!body) return;
      const items = body.children;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].textContent === '正在思考...') {
          items[i].remove();
          break;
        }
      }
    },

    destroy() {
      if (this._fab) this._fab.remove();
      if (this._panel) this._panel.remove();
      this._isOpen = false;
    },
  };

  global.RagChatComponent = RagChat;
})(window);
