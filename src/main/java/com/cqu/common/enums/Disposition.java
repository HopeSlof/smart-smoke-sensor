package com.cqu.common.enums;

/**
 * 告警处置结论（用于误报率统计）
 */
public enum Disposition {
    /** 确认真火警 */
    CONFIRMED_FIRE,
    /** 误报 */
    FALSE_ALARM
}
