package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * 最新烟雾浓度视图
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LatestSmokeVO {

    private String deviceId;
    private BigDecimal smokeConcentration;
    private BigDecimal temperature;
    private BigDecimal coConcentration;
    private String createdAt;
}
