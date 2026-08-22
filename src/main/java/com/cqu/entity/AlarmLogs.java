package com.cqu.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 告警记录表
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("alarm_logs")
public class AlarmLogs implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.NONE)
    private Long id;

    private Long deviceId;

    /** 告警类型: SMOKE_HIGH / TEMP_HIGH / CO_HIGH / OFFLINE / LOW_BATTERY / SENSOR_FAULT */
    private String alarmType;

    /** 告警等级: WARN / FIRE / OFFLINE / FAULT / LOW_BATTERY */
    private String alarmLevel;

    private String message;

    /** 告警状态: ACTIVE / RESOLVED */
    private String status;

    /** 处置结论: CONFIRMED_FIRE / FALSE_ALARM */
    private String disposition;

    /** 首次确认时间（用于告警升级判定） */
    private LocalDateTime acknowledgedAt;

    /** 是否已升级 */
    private Boolean escalated;

    private LocalDateTime createdAt;

    private LocalDateTime resolvedAt;
}
