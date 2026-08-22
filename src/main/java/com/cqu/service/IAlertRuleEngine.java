package com.cqu.service;

import com.cqu.common.enums.AlarmLevel;

import java.math.BigDecimal;

/**
 * 告警规则引擎：分级判定 + 多参数联合判定 + 消抖 + 去重
 */
public interface IAlertRuleEngine {

    /**
     * 评估一次烟雾上报，命中规则则触发告警
     *
     * @param deviceId           设备ID
     * @param smokeConcentration 烟雾浓度
     * @param temperature        温度（可空）
     * @param coConcentration    一氧化碳浓度（可空）
     * @return 触发的告警等级，未触发返回 null
     */
    AlarmLevel evaluate(Long deviceId, BigDecimal smokeConcentration,
                        BigDecimal temperature, BigDecimal coConcentration);
}
