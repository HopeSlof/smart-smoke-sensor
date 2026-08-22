package com.cqu.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 阈值与判定规则配置表（单行）
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("threshold_config")
public class ThresholdConfig implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.NONE)
    private Long id;

    /** 烟雾预警阈值 */
    private BigDecimal smokeWarnThreshold;

    /** 烟雾报警阈值（火警） */
    private BigDecimal smokeAlarmThreshold;

    /** 温度阈值（联合判定） */
    private BigDecimal temperatureThreshold;

    /** CO 阈值（联合判定） */
    private BigDecimal coThreshold;

    /** 心跳超时秒数 */
    private Integer heartbeatTimeout;

    /** 低电量阈值百分比 */
    private Integer batteryLowThreshold;

    /** 消抖连续超阈值次数 */
    private Integer debounceCount;

    /** 告警升级分钟数 */
    private Integer escalationMinutes;

    /** 是否启用多参数联合判定 */
    private Boolean multiParamEnabled;

    private LocalDateTime updatedAt;
}
