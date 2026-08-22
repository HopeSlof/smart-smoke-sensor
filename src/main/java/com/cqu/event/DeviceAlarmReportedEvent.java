package com.cqu.event;

/**
 * 设备主动告警上报领域事件
 */
public record DeviceAlarmReportedEvent(String deviceSn, String alarmType, String message) {
}
