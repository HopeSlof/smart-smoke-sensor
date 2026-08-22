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
 * 烟感设备表
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("devices")
public class Devices implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.NONE)
    private Long id;

    private String deviceName;

    /** 硬件唯一序列号，MQTT 主题标识 */
    private String deviceSn;

    /** 设备类型: SMOKE_SENSOR / CAMERA / BROADCAST / SPRINKLER ... */
    private String deviceType;

    /** 归属小区（数据权限过滤） */
    private Long communityId;

    /** 安装位置（如 1栋-2单元-301） */
    private String location;

    /** 在线状态: ONLINE / OFFLINE */
    private String onlineStatus;

    /** 电量百分比 0-100 */
    private Integer batteryLevel;

    private LocalDateTime lastHeartbeatTime;

    private LocalDateTime createdAt;
}
