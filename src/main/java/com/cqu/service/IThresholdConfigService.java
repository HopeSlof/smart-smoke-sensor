package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.ThresholdConfig;
import com.cqu.vo.ThresholdConfigVO;
import com.cqu.vo.ThresholdUpdateRequest;

/**
 * 阈值配置服务
 */
public interface IThresholdConfigService extends IService<ThresholdConfig> {

    ThresholdConfigVO getConfig();

    void updateConfig(ThresholdUpdateRequest request);

    /**
     * 获取配置实体（供规则引擎 / 定时任务内部使用）
     */
    ThresholdConfig getConfigEntity();
}
