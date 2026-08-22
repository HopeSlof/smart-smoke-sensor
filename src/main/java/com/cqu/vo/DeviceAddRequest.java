package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 设备新增/编辑请求
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeviceAddRequest {

    private String deviceName;
    private String deviceSn;
    /** 设备类型: SMOKE_SENSOR / CAMERA / BROADCAST ... */
    private String deviceType;
    private Long communityId;
    private String location;
}
