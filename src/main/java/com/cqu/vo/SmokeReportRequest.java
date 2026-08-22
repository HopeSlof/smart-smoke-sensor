package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * 烟雾数据上报请求（HTTP 降级通道）
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SmokeReportRequest {

    private String deviceSn;
    private BigDecimal smokeConcentration;
    private BigDecimal temperature;
    private BigDecimal coConcentration;
}
