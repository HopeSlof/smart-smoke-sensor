package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 告警记录视图
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AlarmLogVO {

    private String id;
    private String deviceId;
    private String deviceName;
    private String alarmType;
    private String alarmLevel;
    private String message;
    private String status;
    private String disposition;
    private String acknowledgedAt;
    private Boolean escalated;
    private String createdAt;
    private String resolvedAt;
}
