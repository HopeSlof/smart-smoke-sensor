package com.cqu.event;

/**
 * 设备自检领域事件（电量 + 传感器状态）
 */
public record DeviceSelfCheckEvent(String deviceSn, Integer batteryLevel, Boolean sensorFault) {
}
