/**
 * components/mqtt.js - MQTT 接入层状态面板
 * 数据源：
 *   DashboardApi.Mqtt.getStatus      → Broker 连接状态 / 速率 / 客户端数
 *   DashboardApi.Mqtt.getMessageFlow → 最近上下行消息流
 * 交互：定时刷新（15s）
 */
(function (global) {
  'use strict';

  const { $, create, render } = global.DomUtil;

  /** 秒 → "1h 23m" / "45m" / "12s" */
  function fmtUptime(sec) {
    if (!sec || sec <= 0) return '--';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  const Mqtt = {
    _timer: null,

    init() {
      this.render();
      this._timer = setInterval(() => this.render(), 15_000);
    },

    async render() {
      await Promise.all([this._renderStatus(), this._renderFlow()]);
    },

    async _renderStatus() {
      const host = $('mqtt-status-host');
      if (!host) return;
      let data;
      try {
        data = await global.DashboardApi.Mqtt.getStatus();
      } catch (err) {
        console.warn('[mqtt] status 拉取失败', err);
      }
      if (!data) {
        host.innerHTML = '<div class="mqtt-placeholder">等待 MQTT 接入层数据…</div>';
        return;
      }
      const connCls = data.connected ? 'ok' : 'error';
      const connText = data.connected ? '已连接' : '未连接';
      const items = [
        { label: 'Broker', value: data.broker || '--', cls: 'highlight' },
        { label: '连接状态', value: connText, cls: connCls },
        { label: '在线客户端', value: (data.clientCount || 0) + ' 台' },
        { label: '连接时长', value: fmtUptime(data.uptime) },
        { label: '上行速率', value: (data.msgRateIn || 0) + ' 条/s', cls: 'highlight' },
        { label: '下行速率', value: (data.msgRateOut || 0) + ' 条/s' },
      ];
      render(host, [
        create('div', { class: 'mqtt-conn ' + connCls }, [
          create('span', { class: 'mqtt-conn-dot' }),
          create('span', { class: 'mqtt-conn-text' }, connText),
          create('span', { class: 'mqtt-conn-broker' }, data.broker || ''),
        ]),
        create('div', { class: 'mqtt-stats' },
          items.map(it => create('div', { class: 'mqtt-stat' }, [
            create('div', { class: 'mqtt-stat-label' }, it.label),
            create('div', { class: 'mqtt-stat-value ' + (it.cls || '') }, it.value),
          ]))
        ),
      ]);
    },

    async _renderFlow() {
      const host = $('mqtt-flow-host');
      if (!host) return;
      let list;
      try {
        list = await global.DashboardApi.Mqtt.getMessageFlow(12);
      } catch (err) {
        console.warn('[mqtt] flow 拉取失败', err);
      }
      if (!list || list.length === 0) {
        host.innerHTML = '<div class="mqtt-placeholder">暂无消息流数据</div>';
        return;
      }
      render(host, list.map(m => {
        const dir = m.direction === 'up' ? '上行' : '下行';
        const dirCls = m.direction === 'up' ? 'up' : 'down';
        const arrow = m.direction === 'up' ? '↑' : '↓';
        return create('div', { class: 'mqtt-msg ' + dirCls }, [
          create('span', { class: 'mqtt-msg-dir' }, arrow + ' ' + dir),
          create('span', { class: 'mqtt-msg-time' }, m.time || '--'),
          create('span', { class: 'mqtt-msg-topic', title: m.topic || '' }, m.topic || '--'),
          create('span', { class: 'mqtt-msg-payload', title: m.payload || '' }, m.payload || ''),
        ]);
      }));
    },

    destroy() {
      if (this._timer) clearInterval(this._timer);
    },
  };

  global.MqttComponent = Mqtt;
})(window);
