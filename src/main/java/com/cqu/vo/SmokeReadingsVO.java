package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * 烟雾浓度记录视图
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SmokeReadingsVO {

    private String id;
    private String deviceId;
    private String deviceName;
    private BigDecimal smokeConcentration;
    private BigDecimal temperature;
    private BigDecimal coConcentration;
    private String createdAt;
}
