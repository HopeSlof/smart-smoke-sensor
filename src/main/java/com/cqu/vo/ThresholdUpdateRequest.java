package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

/**
 * 阈值更新请求
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ThresholdUpdateRequest {

    private BigDecimal smokeWarnThreshold;
    private BigDecimal smokeAlarmThreshold;
    private BigDecimal temperatureThreshold;
    private BigDecimal coThreshold;
    private Integer heartbeatTimeout;
    private Integer batteryLowThreshold;
    private Integer debounceCount;
    private Integer escalationMinutes;
    private Boolean multiParamEnabled;
}
