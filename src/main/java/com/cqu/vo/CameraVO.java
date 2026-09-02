package com.cqu.vo;

import lombok.Data;

/**
 * 摄像头视图对象（返回前端）
 */
@Data
public class CameraVO {

    private String id;
    private String cameraName;
    private String cameraSn;
    private Long communityId;
    private String communityName;
    private String location;
    private String onlineStatus;
    private String boundDeviceId;
    private String boundDeviceName;
    private String snapshotUrl;
    private String createdAt;
}
