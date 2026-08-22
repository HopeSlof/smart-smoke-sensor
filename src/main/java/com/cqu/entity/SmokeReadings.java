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
 * 烟雾浓度采集记录（时序数据，含多参数联合判定字段）
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("smoke_readings")
public class SmokeReadings implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.NONE)
    private Long id;

    private Long deviceId;

    /** 烟雾浓度值 */
    private BigDecimal smokeConcentration;

    /** 温度（可选，联合判定） */
    private BigDecimal temperature;

    /** 一氧化碳浓度（可选，联合判定） */
    private BigDecimal coConcentration;

    private LocalDateTime createdAt;
}
