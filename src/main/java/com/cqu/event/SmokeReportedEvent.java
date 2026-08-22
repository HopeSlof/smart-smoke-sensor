package com.cqu.event;

import java.math.BigDecimal;

/**
 * 烟雾浓度上报领域事件（MQTT 网关发布，业务层监听）
 */
public record SmokeReportedEvent(String deviceSn,
                                 BigDecimal smokeConcentration,
                                 BigDecimal temperature,
                                 BigDecimal coConcentration) {
}
