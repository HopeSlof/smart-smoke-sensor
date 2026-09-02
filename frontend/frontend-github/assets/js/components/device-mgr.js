/**
 * components/device-mgr.js - 设备绑定管理（US-06 · P1）
 * ------------------------------------------------------------
 * 形态：从「设备总览」面板标题栏 + 按钮打开 Modal 弹窗
 * 功能：新增设备绑定 / 解绑设备 / 查看已绑定列表
 * 数据源：DashboardApi.DeviceManage.{getManageList, addDevice, removeDevice}
 *
 * 设计依据：设计文档 US-06 小区管理员新增/解绑设备
 */
(function (global) {
  'use strict';

  const { $, create, render } = global.DomUtil;

  const TYPE_OPTIONS = [
    { value: 'smoke', label: '烟雾传感器' },
    { value: 'temp',  label: '温度传感器' },
    { value: 'co',    label: 'CO 传感器' },
    { value: 'flame', label: '火焰传感器' },
    { value: 'hum',   label: '湿度传感器' },
  ];

  const STATUS_CFG = {
    online:  { text: '在线', cls: 'ok',      color: '#22c55e' },
    offline: { text: '离线', cls: 'danger',  color: '#ef4444' },
    warning: { text: '预警', cls: 'warn',    color: '#f59e0b' },
  };

  const ADD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:5px;vertical-align:-2px;"><path d="M12 5v14M5 12h14"/></svg>';

  const DeviceMgr = {
    init() {
      /* 轻量初始化：Modal 延迟到首次打开时创建，避免页面加载开销 */
    },

    /** 打开设备管理弹窗（由 index.html 按钮 onclick 调用） */
    async openManage() {
      this._ensureModal();
      const body = $('device-mgr-body');
      body.innerHTML = '';
      body.appendChild(this._buildAddForm());
      // 小区选项必须来自后端数据库，不能依赖前端演示常量。
      await this._loadCommunityOptions($('dm-community'));
      body.appendChild(create('div', { class: 'section-title', style: 'margin-top:18px;' }, '已绑定设备'));
      body.appendChild(create('div', { id: 'device-mgr-list', class: 'device-mgr-list' }, '加载中…'));

      global.UI.Modal.open('device-mgr-modal');
      await this._renderList();
    },

    _ensureModal() {
      if ($('device-mgr-modal')) return;
      const modal = create('div', { id: 'device-mgr-modal', class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
        create('span', { class: 'm-corner-tr' }),
        create('span', { class: 'm-corner-bl' }),
        create('div', { class: 'modal-header' }, [
          create('div', { class: 'modal-title-wrap' }, [
            create('span', { class: 'modal-title-bar', style: '--c:#22d3ee;' }),
            create('div', {}, [
              create('div', { class: 'modal-title' }, '设备绑定管理'),
              create('div', { class: 'modal-subtitle' }, '新增 / 解绑烟感设备 · 小区管理员'),
            ]),
          ]),
          create('div', { class: 'modal-actions' }, [
            create('button', { class: 'icon-btn', title: '关闭 (Esc)',
              onclick: () => global.UI.Modal.close('device-mgr-modal'),
              html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' }),
          ]),
        ]),
        create('div', { id: 'device-mgr-body', class: 'modal-body' }),
        create('div', { class: 'modal-footer' }, [
          create('button', { class: 'btn btn-ghost',
            onclick: () => global.UI.Modal.close('device-mgr-modal') }, '关闭'),
        ]),
      ]);
      document.body.appendChild(modal);
    },

    _buildAddForm() {
      // 系统管理员可选小区+用户；小区管理员固定本小区只读
      const Auth = global.Auth;
      const session = Auth && typeof Auth.getSession === 'function' ? Auth.getSession() : null;
      const isSystemAdmin = session && session.role === 'system_admin';
      const myCid = session ? String(session.communityId || '') : '';

      const communityField = create('div', { class: 'dm-field' }, [
        create('label', {}, '所属小区'),
      ]);
      const communityControl = create('div', { class: 'field-control', style: { height: '40px' } }, [
        create('span', { class: 'field-prefix', html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/></svg>' }),
      ]);
      const communitySelect = create('select', { id: 'dm-community', class: 'field-select', style: { height: '100%' } });
      if (isSystemAdmin) {
        // 系统管理员：选项由 _loadCommunityOptions 异步填充
        communitySelect.appendChild(create('option', { value: '' }, '加载小区列表…'));
      } else {
        // 小区管理员：固定本小区，只读
        communitySelect.appendChild(create('option', { value: myCid }, myCid ? ('第' + myCid + '小区') : '未绑定小区'));
        communitySelect.disabled = true;
      }
      communityControl.appendChild(communitySelect);
      communityField.appendChild(communityControl);

      // 绑定摄像头（可选）
      const cameraField = create('div', { class: 'dm-field' }, [
        create('label', {}, '绑定摄像头（可选）'),
      ]);
      const cameraControl = create('div', { class: 'field-control', style: { height: '40px' } }, [
        create('span', { class: 'field-prefix', html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>' }),
      ]);
      const cameraSelect = create('select', { id: 'dm-camera', class: 'field-select', style: { height: '100%' } });
      cameraSelect.appendChild(create('option', { value: '' }, '不绑定'));
      cameraControl.appendChild(cameraSelect);
      cameraField.appendChild(cameraControl);
      // 异步加载摄像头列表
      this._loadCameraOptions(cameraSelect, isSystemAdmin ? null : myCid);

      // 注：传感器只绑定小区，不绑定具体用户（居民通过 community_id 隔离看本小区告警）
      // 因此新增设备表单不再有「绑定用户」下拉。

      return create('div', { class: 'device-mgr-form' }, [
        create('div', { class: 'section-title' }, '新增设备绑定'),
        create('div', { class: 'dm-form-row' }, [
          create('div', { class: 'dm-field' }, [
            create('label', {}, '设备名称'),
            create('input', { id: 'dm-name', type: 'text', placeholder: '如：厨房烟感器' }),
          ]),
          create('div', { class: 'dm-field' }, [
            create('label', {}, '安装位置'),
            create('input', { id: 'dm-location', type: 'text', placeholder: '如：1号楼3层' }),
          ]),
          create('div', { class: 'dm-field' }, [
            create('label', {}, '设备类型'),
            create('select', { id: 'dm-type' },
              TYPE_OPTIONS.map(o => create('option', { value: o.value }, o.label))),
          ]),
          communityField,
          cameraField,
          create('button', {
            class: 'btn btn-primary',
            id: 'dm-add-btn',
            onclick: () => DeviceMgr._onAdd(),
          }, [
            create('span', { html: ADD_ICON }),
            document.createTextNode('添加'),
          ]),
        ]),
      ]);
    },

    /** 从后端加载真实小区列表；系统管理员加载失败时禁止提交，避免写入无效归属。 */
    async _loadCommunityOptions(select) {
      if (!select) return;
      const session = global.Auth && global.Auth.getSession ? global.Auth.getSession() : null;
      // 小区管理员下拉虽然只读，也加载真实名称；系统管理员下拉可编辑。
      if (select.disabled && (!session || session.role !== 'community_admin')) return;
      try {
        const page = await global.DashboardApi.Community.getList({ page: 1, pageSize: 500 });
        const list = (page && page.records) || [];
        if (select.disabled && session && session.role === 'community_admin') {
          const cid = String(session.communityId || '');
          const mine = list.find(c => String(c.id) === cid);
          select.innerHTML = `<option value="${cid}">${(mine && mine.name) || ('第' + cid + '小区')}</option>`;
          return;
        }
        select.innerHTML = '<option value="">请选择小区</option>';
        list.forEach(c => {
          const opt = document.createElement('option');
          opt.value = String(c.id);
          opt.textContent = c.name || ('社区 ' + c.id);
          select.appendChild(opt);
        });
        if (!list.length) {
          select.innerHTML = '<option value="">暂无可用小区，请先创建</option>';
          select.disabled = true;
        }
      } catch (err) {
        console.warn('[device-mgr] 小区列表加载失败', err);
        select.innerHTML = '<option value="">小区列表加载失败，请刷新重试</option>';
        select.disabled = true;
      }
    },

    async _renderList() {
      const host = $('device-mgr-list');
      if (!host) return;
      let list = [];
      try {
        list = await global.DashboardApi.DeviceManage.getManageList();
      } catch (err) {
        console.warn('[device-mgr] 列表拉取失败', err);
      }
      if (!Array.isArray(list) || list.length === 0) {
        host.innerHTML = `<div class="empty-placeholder" style="min-height:140px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>
          <span>暂无已绑定设备</span>
          <span style="font-size:11px;opacity:.6;">通过上方表单新增设备绑定</span>
        </div>`;
        return;
      }
      render(host, list.map(d => this._deviceRow(d)));
    },

    _deviceRow(d) {
      const cfg = STATUS_CFG[d.status] || STATUS_CFG.offline;
      const typeLabel = (TYPE_OPTIONS.find(t => t.value === d.type) || {}).label || d.type || '--';
      return create('div', { class: 'dm-row' }, [
        create('div', { class: 'dm-row-main' }, [
          create('div', { class: 'dm-row-name' }, [
            create('span', { class: 'dm-name-text' }, d.name || '--'),
            create('span', { class: 'dm-row-id' }, d.id || '--'),
          ]),
          create('div', { class: 'dm-row-meta' },
            (d.location || '--') + ' · ' + typeLabel + (d.owner ? ' · 责任人 ' + d.owner : '')),
        ]),
        create('div', { class: 'dm-row-status ' + cfg.cls, style: { color: cfg.color } }, cfg.text),
        create('div', { class: 'dm-row-time' }, d.boundAt || d.lastHeartbeat || '--'),
        create('button', {
          class: 'btn btn-danger dm-unbind-btn',
          title: '解绑该设备',
          onclick: () => DeviceMgr._onRemove(d),
        }, '解绑'),
      ]);
    },

    async _onAdd() {
      const UI = global.UI;
      const name = $('dm-name').value.trim();
      const location = $('dm-location').value.trim();
      const type = $('dm-type').value;
      const communitySel = $('dm-community');
      const communityId = communitySel ? communitySel.value : '';
      const cameraSel = $('dm-camera');
      const cameraId = cameraSel ? cameraSel.value : '';
      if (!name)     { UI.Toast.warn('请填写设备名称'); return; }
      if (!location) { UI.Toast.warn('请填写安装位置'); return; }
      if (!communityId) { UI.Toast.warn('请选择所属小区'); return; }
      const btn = $('dm-add-btn');
      btn.disabled = true;
      try {
        const res = await global.DashboardApi.DeviceManage.addDevice({ name, location, type, communityId: Number(communityId) });
        // 如果选择了摄像头，且设备创建成功，则绑定
        if (cameraId && res && res.id) {
          try {
            await global.DashboardApi.Camera.bindDevice(cameraId, res.id);
            UI.Toast.success('设备已添加并绑定摄像头');
          } catch (bindErr) {
            console.warn('[device-mgr] 摄像头绑定失败：', bindErr);
            UI.Toast.success('设备已添加，摄像头绑定失败（' + (bindErr && bindErr.message || '接口待部署') + '）');
          }
        } else {
          UI.Toast.success('设备已添加');
        }
        $('dm-name').value = '';
        $('dm-location').value = '';
        if (cameraSel) cameraSel.value = '';
        this._renderList();
        /* 通知设备总览面板刷新 */
        if (global.OverviewComponent && global.OverviewComponent.render) global.OverviewComponent.render();
      } catch (e) {
        UI.Toast.error('添加失败：' + (e && e.message || '未知错误'));
      } finally {
        btn.disabled = false;
      }
    },

    /** 加载摄像头列表填充下拉 */
    async _loadCameraOptions(sel, communityId) {
      if (!sel) return;
      try {
        let cameras = [];
        try {
          cameras = await global.DashboardApi.Camera.list();
        } catch (err) {
          // 摄像头接口未部署时保持「不绑定」选项
          return;
        }
        if (!Array.isArray(cameras)) cameras = [];
        // 按社区过滤（小区管理员只看到本社区摄像头）
        if (communityId) {
          cameras = cameras.filter(c => String(c.communityId) === String(communityId));
        }
        sel.innerHTML = '';
        sel.appendChild(create('option', { value: '' }, '不绑定'));
        cameras.forEach(c => {
          sel.appendChild(create('option', { value: c.id },
            '#' + c.id + ' ' + (c.name || '') + (c.location ? ' · ' + c.location : '')));
        });
      } catch (err) {
        console.warn('[device-mgr] 摄像头选项加载失败：', err);
      }
    },

    async _onRemove(d) {
      const UI = global.UI;
      if (!confirm('确定解绑设备「' + (d.name || d.id) + '」？\n解绑后该设备将停止上报数据。')) return;
      try {
        await global.DashboardApi.DeviceManage.removeDevice(d.id);
        UI.Toast.success('设备已解绑');
        this._renderList();
        if (global.OverviewComponent && global.OverviewComponent.render) global.OverviewComponent.render();
      } catch (e) {
        UI.Toast.error('解绑失败：' + (e && e.message || '未知错误'));
      }
    },
  };

  global.DeviceMgrComponent = DeviceMgr;
})(window);
