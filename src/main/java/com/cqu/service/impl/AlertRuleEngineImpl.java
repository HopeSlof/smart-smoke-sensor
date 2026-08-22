package com.cqu.service.impl;

import com.cqu.common.enums.AlarmLevel;
import com.cqu.common.enums.AlarmType;
import com.cqu.entity.ThresholdConfig;
import com.cqu.service.IAlarmLogsService;
import com.cqu.service.IAlertRuleEngine;
import com.cqu.service.IThresholdConfigService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 告警规则引擎实现：分级判定 + 多参数联合判定 + 消抖 + 去重
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AlertRuleEngineImpl implements IAlertRuleEngine {

    private final IThresholdConfigService thresholdConfigService;
    private final IAlarmLogsService alarmLogsService;

    /** 消抖状态缓存：deviceId -> DebounceState（内存实现，可后续替换为 Redis） */
    private final Map<Long, DebounceState> stateMap = new ConcurrentHashMap<>();

    @Override
    public AlarmLevel evaluate(Long deviceId, BigDecimal smoke, BigDecimal temperature, BigDecimal co) {
        ThresholdConfig config = thresholdConfigService.getConfigEntity();
        if (config == null) {
            log.warn("阈值配置不存在，跳过判定");
            return null;
        }

        AlarmLevel level = determineLevel(smoke, temperature, co, config);
        if (level == null) {
            stateMap.remove(deviceId);
            return null;
        }

        // 消抖：连续达到同一等级的次数
        int debounceCount = config.getDebounceCount() != null ? config.getDebounceCount() : 1;
        DebounceState state = stateMap.computeIfAbsent(deviceId, k -> new DebounceState());
        if (state.level == level) {
            state.count++;
        } else {
            state.level = level;
            state.count = 1;
        }

        if (state.count < debounceCount) {
            log.debug("消抖中: deviceId={}, level={}, count={}/{}", deviceId, level, state.count, debounceCount);
            return null;
        }

        // 达到消抖次数，触发告警（去重由 createAlarm 内部处理），随后重置状态避免重复触发
        stateMap.remove(deviceId);
        String message = level == AlarmLevel.FIRE
                ? "烟雾浓度超标，多参数验证通过，判定为火警"
                : "烟雾浓度达到预警阈值";
        alarmLogsService.createAlarm(deviceId, AlarmType.SMOKE_HIGH.name(), level.name(), message);
        log.info("规则引擎触发告警: deviceId={}, level={}, smoke={}", deviceId, level, smoke);
        return level;
    }

    /**
     * 分级判定 + 多参数联合验证：
     * 1) 烟雾 >= 报警阈值：启用多参数时需温度或 CO 交叉验证，未通过则降级为预警；未启用直接判火警
     * 2) 烟雾 >= 预警阈值：预警
     * 3) 否则不触发
     */
    private AlarmLevel determineLevel(BigDecimal smoke, BigDecimal temperature, BigDecimal co, ThresholdConfig config) {
        if (smoke == null) {
            return null;
        }

        BigDecimal alarmThreshold = config.getSmokeAlarmThreshold();
        if (alarmThreshold != null && smoke.compareTo(alarmThreshold) >= 0) {
            if (Boolean.TRUE.equals(config.getMultiParamEnabled())) {
                boolean crossValidated = hit(temperature, config.getTemperatureThreshold())
                        || hit(co, config.getCoThreshold());
                return crossValidated ? AlarmLevel.FIRE : AlarmLevel.WARN;
            }
            return AlarmLevel.FIRE;
        }

        BigDecimal warnThreshold = config.getSmokeWarnThreshold();
        if (warnThreshold != null && smoke.compareTo(warnThreshold) >= 0) {
            return AlarmLevel.WARN;
        }
        return null;
    }

    private boolean hit(BigDecimal value, BigDecimal threshold) {
        return value != null && threshold != null && value.compareTo(threshold) >= 0;
    }

    private static class DebounceState {
        AlarmLevel level;
        int count;
    }
}
