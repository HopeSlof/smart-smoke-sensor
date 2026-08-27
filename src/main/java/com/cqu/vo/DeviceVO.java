package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 设备视图
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeviceVO {

    private String id;
    private String deviceName;
    private String deviceSn;
    private String deviceType;
    private Long communityId;
    private String location;
    private String onlineStatus;
    private Integer batteryLevel;
    private Long boundCameraId;
    private String lastHeartbeatTime;
    private String createdAt;
}
