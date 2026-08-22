package com.cqu.event;

/**
 * 设备心跳领域事件（隐式在线刷新，携带电量）
 */
public record DeviceHeartbeatEvent(String deviceSn, Integer batteryLevel) {
}
