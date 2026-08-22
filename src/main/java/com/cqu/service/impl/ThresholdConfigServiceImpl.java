package com.cqu.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.entity.ThresholdConfig;
import com.cqu.mapper.ThresholdConfigMapper;
import com.cqu.service.IThresholdConfigService;
import com.cqu.vo.ThresholdConfigVO;
import com.cqu.vo.ThresholdUpdateRequest;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * 阈值配置服务实现（单行配置）
 */
@Service
public class ThresholdConfigServiceImpl extends ServiceImpl<ThresholdConfigMapper, ThresholdConfig>
        implements IThresholdConfigService {

    /** 单行配置约定 ID（schema.sql 预置） */
    private static final Long DEFAULT_CONFIG_ID = 1L;

    @Override
    public ThresholdConfigVO getConfig() {
        ThresholdConfig config = getConfigEntity();
        if (config == null) {
            throw new BusinessException("阈值配置不存在");
        }
        return toVO(config);
    }

    @Override
    public void updateConfig(ThresholdUpdateRequest request) {
        ThresholdConfig config = getConfigEntity();
        if (config == null) {
            throw new BusinessException("阈值配置不存在");
        }

        // 校验：预警阈值必须小于报警阈值
        if (request.getSmokeWarnThreshold() != null && request.getSmokeAlarmThreshold() != null
                && request.getSmokeWarnThreshold().compareTo(request.getSmokeAlarmThreshold()) >= 0) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "预警阈值必须小于报警阈值");
        }

        // 部分更新：非空字段才覆盖
        if (request.getSmokeWarnThreshold() != null) config.setSmokeWarnThreshold(request.getSmokeWarnThreshold());
        if (request.getSmokeAlarmThreshold() != null) config.setSmokeAlarmThreshold(request.getSmokeAlarmThreshold());
        if (request.getTemperatureThreshold() != null) config.setTemperatureThreshold(request.getTemperatureThreshold());
        if (request.getCoThreshold() != null) config.setCoThreshold(request.getCoThreshold());
        if (request.getHeartbeatTimeout() != null) config.setHeartbeatTimeout(request.getHeartbeatTimeout());
        if (request.getBatteryLowThreshold() != null) config.setBatteryLowThreshold(request.getBatteryLowThreshold());
        if (request.getDebounceCount() != null) config.setDebounceCount(request.getDebounceCount());
        if (request.getEscalationMinutes() != null) config.setEscalationMinutes(request.getEscalationMinutes());
        if (request.getMultiParamEnabled() != null) config.setMultiParamEnabled(request.getMultiParamEnabled());
        config.setUpdatedAt(LocalDateTime.now());

        this.updateById(config);
    }

    @Override
    public ThresholdConfig getConfigEntity() {
        return this.getById(DEFAULT_CONFIG_ID);
    }

    private ThresholdConfigVO toVO(ThresholdConfig config) {
        return ThresholdConfigVO.builder()
                .id(String.valueOf(config.getId()))
                .smokeWarnThreshold(config.getSmokeWarnThreshold())
                .smokeAlarmThreshold(config.getSmokeAlarmThreshold())
                .temperatureThreshold(config.getTemperatureThreshold())
                .coThreshold(config.getCoThreshold())
                .heartbeatTimeout(config.getHeartbeatTimeout())
                .batteryLowThreshold(config.getBatteryLowThreshold())
                .debounceCount(config.getDebounceCount())
                .escalationMinutes(config.getEscalationMinutes())
                .multiParamEnabled(config.getMultiParamEnabled())
                .updatedAt(String.valueOf(config.getUpdatedAt()))
                .build();
    }
}
