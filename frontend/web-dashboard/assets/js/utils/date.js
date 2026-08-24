/**
 * utils/date.js - 日期时间工具
 */
(function (global) {
  'use strict';

  const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
  const pad = n => (n < 10 ? '0' + n : '' + n);

  const DateUtil = {
    /**
     * 格式化为 HH:mm:ss
     * @param {Date} [date=new Date()]
     */
    formatHMS(date = new Date()) {
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    },

    /**
     * 格式化为 YYYY/MM/DD 星期X
     * @param {Date} [date=new Date()]
     */
    formatDateCN(date = new Date()) {
      return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} 星期${WEEK_CN[date.getDay()]}`;
    },

    /**
     * 格式化为 HH:mm:ss （日志用，可接收自定义Date）
     */
    formatLogTime(date = new Date()) {
      return DateUtil.formatHMS(date);
    },

    /**
     * 格式化为 YYYY-MM-DD（供导出/表头用）
     */
    formatDay(date = new Date()) {
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    },

    /**
     * 相对时间：刚刚 / N分钟前 / N小时前 / N天前，超出7天返回日期
     */
    fmtTimeAgo(date = new Date()) {
      const d = (date instanceof Date) ? date : new Date(date);
      if (isNaN(d.getTime())) return '--';
      const diff = Date.now() - d.getTime();
      if (diff < 0) return '刚刚';
      const min = Math.floor(diff / 60000);
      if (min < 1) return '刚刚';
      if (min < 60) return `${min}分钟前`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr}小时前`;
      const day = Math.floor(hr / 24);
      if (day < 7) return `${day}天前`;
      return DateUtil.formatDay(d);
    },
  };

  global.DateUtil = DateUtil;
})(window);
