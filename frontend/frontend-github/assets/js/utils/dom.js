/**
 * utils/dom.js - DOM 操作小工具
 */
(function (global) {
  'use strict';

  const DomUtil = {
    /**
     * 通用选择器：支持纯 ID / '#id' / CSS 选择器
     * @param {string} sel
     */
    $(sel) {
      const s = String(sel == null ? '' : sel);
      if (!s) return null;
      if (s.startsWith('#')) {
        const id = s.slice(1);
        // 纯 ID（无后续 CSS 语法）直接走 getElementById，最快
        if (/^[\w-]+$/.test(id)) return document.getElementById(id);
        return document.querySelector(s);
      }
      if (/^[\w-]+$/.test(s)) return document.getElementById(s);
      return document.querySelector(s);
    },

    /**
     * 创建 DOM 元素并设置属性/子节点
     * @param {string} tag 标签名
     * @param {object} [props] 属性对象，包括 text/html/class/style/onXxx/dataset
     * @param {Array<Node|string>} [children] 子节点
     */
    create(tag, props = {}, children = []) {
      const el = document.createElement(tag);
      for (const key of Object.keys(props)) {
        const val = props[key];
        if (val == null || val === false) continue;
        if (key === 'class')   el.className = val;
        else if (key === 'text') el.textContent = val;
        else if (key === 'html') el.innerHTML = val;
        else if (key === 'style' && typeof val === 'object') Object.assign(el.style, val);
        else if (key === 'dataset' && typeof val === 'object') Object.assign(el.dataset, val);
        else if (key.startsWith('on') && typeof val === 'function') {
          el.addEventListener(key.slice(2).toLowerCase(), val);
        } else {
          el.setAttribute(key, val);
        }
      }
      // children 归一化：支持数组 / 单个节点 / 字符串 / 数字（自动包装为数组）
      let kids = children;
      if (kids == null || kids === false) kids = [];
      else if (!Array.isArray(kids)) kids = [kids];
      for (const c of kids) {
        if (c == null || c === false) continue;
        el.appendChild(
          (typeof c === 'string' || typeof c === 'number')
            ? document.createTextNode(String(c))
            : c
        );
      }
      return el;
    },

    /**
     * 清空容器并填充新元素
     * @param {HTMLElement} container
     * @param {Array<Node>} elements
     */
    render(container, elements) {
      container.innerHTML = '';
      for (const el of elements) {
        if (el == null) continue;
        container.appendChild(el);
      }
    },

    /**
     * SVG 命名空间下创建元素
     */
    createSVG(tag, attrs = {}) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const k of Object.keys(attrs)) {
        if (attrs[k] == null) continue;
        el.setAttribute(k, attrs[k]);
      }
      return el;
    },
  };

  global.DomUtil = DomUtil;
})(window);
