package com.cqu.common.enums;

/**
 * 告警类型
 */
public enum AlarmType {
    /** 烟雾浓度超标 */
    SMOKE_HIGH,
    /** 温度超标 */
    TEMP_HIGH,
    /** 一氧化碳超标 */
    CO_HIGH,
    /** 设备离线 */
    OFFLINE,
    /** 低电量 */
    LOW_BATTERY,
    /** 传感器故障 */
    SENSOR_FAULT
}
