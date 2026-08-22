package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * 设备详情视图
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeviceDetailVO {

    private String id;
    private String deviceName;
    private String deviceSn;
    private String deviceType;
    private Long communityId;
    private String location;
    private String onlineStatus;
    private Integer batteryLevel;
    private String lastHeartbeatTime;
    private String createdAt;

    /** 最新烟雾浓度 */
    private BigDecimal latestSmokeConcentration;
    /** 活跃告警数 */
    private Long activeAlarmCount;
}
