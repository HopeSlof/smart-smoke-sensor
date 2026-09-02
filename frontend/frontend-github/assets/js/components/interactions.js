/**
 * components/interactions.js - 统一交互组件
 *   Modal / Drawer / PopCard / Tooltip / Toast
 *   挂在 window.UI
 *   用法：
 *     UI.Modal.open('log-modal')
 *     UI.Modal.close('log-modal')
 *     UI.Drawer.open({...data})
 *     UI.Toast.success('已刷新')
 *     UI.Tooltip.show(event, html)
 * ----------------------------------------------------------- */
(function (global) {
  'use strict';

  const { $, create } = global.DomUtil;

  /* =============================================================
   *  1. Overlay 遮罩（共用）
   * ============================================================= */
  function ensureOverlay() {
    let ov = $('global-overlay');
    if (!ov) {
      ov = create('div', { id: 'global-overlay', class: 'overlay', onclick: () => {
        // 点击遮罩：关闭 Drawer + 所有 Modal（可配置）
        UI.Drawer.close();
        UI.Modal.closeAll();
        UI.PopCard.close();
      }});
      document.body.appendChild(ov);
    }
    return ov;
  }

  function syncOverlay() {
    const ov = ensureOverlay();
    const any =
      document.querySelector('.drawer.is-open') ||
      document.querySelector('.modal.is-open')  ||
      document.querySelector('.pop-card.is-open');
    ov.classList.toggle('is-open', !!any);
  }

  /* =============================================================
   *  2. Modal - 居中弹窗
   * ============================================================= */
  const Modal = {
    /**
     * 根据 id 打开 Modal；id 对应 DOM 上 .modal#xxx
     */
    open(id) {
      const el = document.getElementById(id);
      if (!el || !el.classList.contains('modal')) {
        console.warn('[Modal] 找不到 #' + id);
        return;
      }
      el.classList.add('is-open');
      syncOverlay();
      document.body.style.overflow = 'hidden';
      // 通知组件：已打开（供组件复位 _opened 标记，避免与 open() 里显式置 true 竞争时为假）
      el.dispatchEvent(new CustomEvent('modal-opened', { detail: { id } }));
      // Escape 用 AbortController：同 Modal 下次再开自动覆盖旧 controller，close 时 abort 移除
      const ctlKey = '_escCtl_' + id;
      if (Modal[ctlKey]) Modal[ctlKey].abort();
      const ac = new AbortController();
      Modal[ctlKey] = ac;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && el.classList.contains('is-open')) Modal.close(id);
      }, { signal: ac.signal });
    },
    close(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('is-open');
      const ctlKey = '_escCtl_' + id;
      if (Modal[ctlKey]) { Modal[ctlKey].abort(); delete Modal[ctlKey]; }
      // 通知 Settings/DeviceMgr 等模块复位自身的 _opened 守卫
      el.dispatchEvent(new CustomEvent('modal-closed', { detail: { id } }));
      document.dispatchEvent(new CustomEvent('modal-closed:' + id, { detail: { id } }));
      syncOverlay();
      if (!document.querySelector('.drawer.is-open') &&
          !document.querySelector('.modal.is-open')) {
        document.body.style.overflow = '';
      }
    },
    closeAll() {
      const opened = Array.from(document.querySelectorAll('.modal.is-open'));
      opened.forEach(m => m.classList.remove('is-open'));
      opened.forEach(m => {
        const id = m.id;
        const ctlKey = '_escCtl_' + id;
        if (Modal[ctlKey]) { Modal[ctlKey].abort(); delete Modal[ctlKey]; }
        m.dispatchEvent(new CustomEvent('modal-closed', { detail: { id } }));
        document.dispatchEvent(new CustomEvent('modal-closed:' + id, { detail: { id } }));
      });
      document.body.style.overflow = '';
      syncOverlay();
    },

    /**
     * 通用确认弹窗（Promise 化）
     * @param {Object} opts { title, message, confirmText, cancelText, danger }
     * @returns {Promise<boolean>} 确认 true / 取消 false
     */
    confirm(opts = {}) {
      return new Promise((resolve) => {
        const id = 'ui-confirm-modal';
        // 移除旧实例
        const old = document.getElementById(id);
        if (old) old.remove();
        const danger = !!opts.danger;
        const el = create('div', {
          id,
          class: 'modal is-open',
          role: 'dialog',
          'aria-modal': 'true',
          style: 'align-items:center;justify-content:center;display:flex;',
        });
        el.innerHTML = `
          <span class="m-corner-tr"></span><span class="m-corner-bl"></span>
          <div style="width:400px;max-width:92vw;">
            <div class="modal-header">
              <div class="modal-title-wrap">
                <span class="modal-title-bar" style="background:${danger ? 'var(--red)' : 'var(--cyan)'};box-shadow:0 0 6px ${danger ? 'rgba(255,61,113,0.6)' : 'rgba(0,229,255,0.6)'};"></span>
                <div>
                  <div class="modal-title">${String(opts.title || '确认操作').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</div>
                </div>
              </div>
            </div>
            <div class="modal-body" style="padding:18px 22px;">
              <div style="font-size:13px;line-height:1.8;color:var(--text-muted);">${String(opts.message || '是否继续？').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</div>
            </div>
            <div class="modal-footer" style="padding:14px 22px 18px;">
              <button type="button" class="btn btn-ghost" data-act="cancel">${String(opts.cancelText || '取消').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</button>
              <button type="button" class="btn ${danger ? 'btn-red' : 'btn-primary'}" data-act="ok">${String(opts.confirmText || '确认').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</button>
            </div>
          </div>`;
        document.body.appendChild(el);
        document.body.style.overflow = 'hidden';
        try { syncOverlay(); } catch (_) {}

        const done = (val) => {
          el.remove();
          if (!document.querySelector('.drawer.is-open') && !document.querySelector('.modal.is-open')) {
            document.body.style.overflow = '';
          }
          try { syncOverlay(); } catch (_) {}
          document.removeEventListener('keydown', onKey);
          resolve(val);
        };
        el.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
        el.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
        const onKey = (e) => { if (e.key === 'Escape') done(false); };
        document.addEventListener('keydown', onKey);
      });
    },
  };

  /* =============================================================
   *  3. Drawer - 右侧滑出详情抽屉
   *     通过 API 传入数据动态渲染内容，不是固定 DOM
   * ============================================================= */
  function ensureDrawer() {
    let d = $('detail-drawer');
    if (d) return d;
    d = create('aside', { id: 'detail-drawer', class: 'drawer' }, [
      create('div', { class: 'drawer-header' }, [
        create('div', {}, [
          create('span', { id: 'dr-level-tag', class: 'drawer-level-tag' }),
          create('div', { id: 'dr-title', class: 'drawer-title' }),
          create('div', { id: 'dr-desc',  class: 'drawer-desc' }),
        ]),
        create('button', {
          class: 'icon-btn',
          title: '关闭 (Esc)',
          'aria-label': '关闭详情',
          onclick: () => UI.Drawer.close(),
          html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        }),
      ]),
      create('div', { id: 'dr-body', class: 'drawer-body' }),
      create('div', { id: 'dr-footer', class: 'drawer-footer' }),
    ]);
    document.body.appendChild(d);
    return d;
  }

  /** 渲染 Drawer 底部按钮：传入 footerActions 则自定义；否则用默认 3 个 */
  function renderDrawerFooter(data) {
    const footer = $('dr-footer');
    if (!footer) return;
    footer.innerHTML = '';
    const actions = Array.isArray(data.footerActions) ? data.footerActions : null;
    if (actions && actions.length) {
      actions.forEach(act => {
        footer.appendChild(create('button', {
          class: 'btn ' + (act.cls || 'btn-ghost'),
          title: act.title || '',
          onclick: () => { if (typeof act.onClick === 'function') act.onClick(); },
          html: (act.icon || '') + (act.label || ''),
        }));
      });
    } else {
      // 默认按钮（兼容旧调用）
      footer.appendChild(create('button', {
        class: 'btn btn-ghost',
        onclick: () => { UI.Toast.success('已转派处理工单'); UI.Drawer.close(); }
      }, '转派工单'));
      footer.appendChild(create('button', {
        class: 'btn btn-warn',
        onclick: () => UI.Toast.warn('告警已静音 30 分钟')
      }, '静音告警'));
      footer.appendChild(create('button', {
        class: 'btn btn-primary',
        onclick: () => { UI.Toast.success('已标记为已处理'); UI.Drawer.close(); }
      }, '标记已处理'));
    }
  }

  const Drawer = {
    /**
     * 打开详情
     * @param {object} data
     *   level: 'high'|'mid'|'low'
     *   title, description
     *   infoPairs: [{label,value,cls?}]  cls=highlight/warn/danger/ok
     *   extraSections: [{title?, node: Node}]  插入到 infoPairs 与 timeline 之间的自定义块
     *   timeline:  [{time,text,ok|warn|bad}]
     *   footerActions: [{label, cls, icon?, title?, onClick}] 自定义底部按钮
     */
    open(data = {}) {
      const el = ensureDrawer();
      $('dr-level-tag').textContent =
        data.level === 'high' ? '紧急告警' : data.level === 'mid' ? '一般预警' : '提示信息';
      $('dr-level-tag').className = 'drawer-level-tag ' + (data.level || 'low');
      $('dr-title').textContent = data.title || '详情';
      $('dr-desc').textContent = data.description || '';

      const body = $('dr-body');
      body.innerHTML = '';

      if (Array.isArray(data.infoPairs) && data.infoPairs.length) {
        const grid = create('div', { class: 'info-grid' },
          data.infoPairs.map(p => create('div', { class: 'info-pair' + (p.full ? ' full' : '') }, [
            create('div', { class: 'info-pair-label' }, p.label),
            create('div', { class: 'info-pair-value ' + (p.cls || '') },
              typeof p.value !== 'undefined' ? String(p.value) : '--'),
          ]))
        );
        body.appendChild(grid);
      }

      // 自定义 section（状态机图 / 闭环进度条等）
      if (Array.isArray(data.extraSections)) {
        data.extraSections.forEach(sec => {
          if (!sec || !sec.node) return;
          const wrap = create('div', { class: 'drawer-section' });
          if (sec.title) wrap.appendChild(create('div', { class: 'section-title' }, sec.title));
          wrap.appendChild(sec.node);
          body.appendChild(wrap);
        });
      }

      if (Array.isArray(data.timeline) && data.timeline.length) {
        const wrap = create('div', {}, [
          create('div', { class: 'section-title' }, '事件时间线'),
          create('div', { class: 'timeline' },
            data.timeline.map(t => create('div', { class: 'timeline-item ' + (t.cls || '') }, [
              create('div', { class: 'timeline-dot' }),
              create('div', { class: 'timeline-time' }, t.time || ''),
              create('div', { class: 'timeline-text' }, t.text || ''),
            ]))
          ),
        ]);
        body.appendChild(wrap);
      }

      // 空数据占位
      if (body.children.length === 0) {
        body.innerHTML = `<div class="empty-placeholder" style="flex:1;">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r="0.8" fill="currentColor"/></svg>
          <span>暂无详细数据</span></div>`;
      }

      // 渲染底部按钮
      renderDrawerFooter(data);

      el.classList.add('is-open');
      syncOverlay();
      document.body.style.overflow = 'hidden';
      if (Drawer._escCtl) Drawer._escCtl.abort();
      const ac = new AbortController();
      Drawer._escCtl = ac;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') Drawer.close();
      }, { signal: ac.signal });
    },
    close() {
      const el = $('detail-drawer');
      if (el) el.classList.remove('is-open');
      if (Drawer._escCtl) { Drawer._escCtl.abort(); Drawer._escCtl = null; }
      document.dispatchEvent(new CustomEvent('drawer-closed'));
      syncOverlay();
      if (!document.querySelector('.drawer.is-open') &&
          !document.querySelector('.modal.is-open')) {
        document.body.style.overflow = '';
      }
    },
  };

  /* =============================================================
   *  4. Toast 轻提示
   * ============================================================= */
  function ensureToastHost() {
    let h = $('toast-host');
    if (h) return h;
    h = create('div', { id: 'toast-host', class: 'toast-host' });
    document.body.appendChild(h);
    return h;
  }
  const Toast = {
    _push(text, type, icon) {
      const host = ensureToastHost();
      const el = create('div', { class: 'toast ' + type }, [
        create('span', { class: 'toast-icon' }, icon || ''),
        create('span', {}, text),
      ]);
      host.appendChild(el);
      setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 350);
      }, 2400);
    },
    info(t)    { Toast._push(t, '', 'ℹ'); },
    success(t) { Toast._push(t, 'success', '✓'); },
    warn(t)    { Toast._push(t, 'warn', '!'); },
    error(t)   { Toast._push(t, 'error', '✕'); },
  };

  /* =============================================================
   *  5. Tooltip 小气泡
   * ============================================================= */
  function ensureTooltip() {
    let t = $('global-tooltip');
    if (t) return t;
    t = create('div', { id: 'global-tooltip', class: 'tooltip' });
    document.body.appendChild(t);
    return t;
  }
  const Tooltip = {
    /**
     * 显示悬浮提示
     * @param {MouseEvent|{x:number,y:number}} pos
     * @param {string} html  innerHTML
     * @param {string} [extraClass]
     */
    show(pos, html, extraClass) {
      const el = ensureTooltip();
      el.className = 'tooltip' + (extraClass ? ' ' + extraClass : '');
      el.innerHTML = html;
      el.classList.add('is-visible');
      const x = (pos && pos.x != null) ? pos.x : (pos && pos.clientX) || 0;
      const y = (pos && pos.y != null) ? pos.y : (pos && pos.clientY) || 0;
      const W = window.innerWidth, H = window.innerHeight;
      const w = el.offsetWidth, h = el.offsetHeight;
      let left = x + 14, top = y + 14;
      if (left + w > W - 8)  left = x - w - 14;
      if (top  + h > H - 8)  top  = y - h - 14;
      el.style.left = Math.max(8, left) + 'px';
      el.style.top  = Math.max(8, top)  + 'px';
    },
    hide() {
      const el = $('global-tooltip');
      if (el) el.classList.remove('is-visible');
    },
  };

  /* =============================================================
   *  6. PopCard 楼栋/设备浮动详情卡
   * ============================================================= */
  function ensurePopCard() {
    let p = $('pop-card');
    if (p) return p;
    p = create('div', { id: 'pop-card', class: 'pop-card' });
    document.body.appendChild(p);
    return p;
  }
  const PopCard = {
    /**
     * @param {{x:number,y:number}} pos
     * @param {HTMLElement|string} content  HTML String 或 Node
     */
    open(pos, content) {
      const el = ensurePopCard();
      if (typeof content === 'string') el.innerHTML = content;
      else { el.innerHTML = ''; el.appendChild(content); }
      el.classList.add('is-open');
      const W = window.innerWidth, H = window.innerHeight;
      // 下一帧再定位，取真实尺寸
      requestAnimationFrame(() => {
        const w = el.offsetWidth, h = el.offsetHeight;
        let left = pos.x + 12, top = pos.y + 12;
        if (left + w > W - 10) left = pos.x - w - 12;
        if (top  + h > H - 10) top  = pos.y - h - 12;
        el.style.left = Math.max(10, left) + 'px';
        el.style.top  = Math.max(10, top)  + 'px';
      });
      syncOverlay();
    },
    close() {
      const el = $('pop-card');
      if (el) el.classList.remove('is-open');
      syncOverlay();
    },
  };

  /* =============================================================
   *  7. 全屏 + Esc 快捷键
   * ============================================================= */
  const Fullscreen = {
    toggle() {
      const doc = document;
      const el = doc.documentElement;
      if (!doc.fullscreenElement) {
        (el.requestFullscreen || el.webkitRequestFullscreen || function(){}).call(el);
      } else {
        (doc.exitFullscreen || doc.webkitExitFullscreen || function(){}).call(doc);
      }
    },
    isActive() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement);
    },
  };

  // 注册 Esc 关闭最上层 Drawer/Modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.querySelector('.drawer.is-open')) { Drawer.close(); return; }
      Modal.closeAll();
      PopCard.close();
    }
  });

  // 点击空白关闭 PopCard
  document.addEventListener('mousedown', (e) => {
    const pc = $('pop-card');
    if (pc && pc.classList.contains('is-open')) {
      if (!pc.contains(e.target) && !e.target.closest('.building') && !e.target.closest('.device-item')) {
        PopCard.close();
      }
    }
  });

  /* ---------- 预创建 DOM（确保页面打开即可用，不用等到第一次点击） ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    ensureDrawer();
    ensureToastHost();
    ensurePopCard();
    ensureOverlay();
  });
  // 如果脚本在 DOMContentLoaded 之后才执行（例如 head 里 defer），立即跑一次兜底
  if (document.readyState !== 'loading') {
    ensureDrawer();
    ensureToastHost();
    ensurePopCard();
    ensureOverlay();
  }

  /* ---------- 导出 ---------- */
  global.UI = {
    Modal,
    Drawer,
    Toast,
    Tooltip,
    PopCard,
    Fullscreen,
  };

})(window);
