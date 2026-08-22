package com.cqu.common.enums;

/**
 * 告警等级（分级告警）
 */
public enum AlarmLevel {
    /** 预警 */
    WARN,
    /** 火警 */
    FIRE,
    /** 离线 */
    OFFLINE,
    /** 故障 */
    FAULT,
    /** 低电量 */
    LOW_BATTERY
}
