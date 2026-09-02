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
 * 摄像头表（独立于 devices，通过 bound_device_id 与烟感设备一对一关联）
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("cameras")
public class Cameras implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.NONE)
    private Long id;

    private String cameraName;

    /** 序列号 */
    private String cameraSn;

    /** 归属小区 */
    private Long communityId;

    /** 安装位置 */
    private String location;

    /** 在线状态: ONLINE / OFFLINE */
    private String onlineStatus;

    /** 绑定的烟感设备 ID（一对一） */
    private Long boundDeviceId;

    /** 最新截图 URL */
    private String snapshotUrl;

    private LocalDateTime createdAt;
}
