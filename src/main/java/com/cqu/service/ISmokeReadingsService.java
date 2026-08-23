package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.SmokeReadings;
import com.cqu.vo.LatestSmokeVO;
import com.cqu.vo.PageResult;
import com.cqu.vo.SmokeReadingsVO;
import com.cqu.vo.TrendVO;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 烟雾浓度数据服务
 */
public interface ISmokeReadingsService extends IService<SmokeReadings> {

    PageResult<SmokeReadingsVO> pageReadings(int page, int pageSize, Long deviceId,
                                             LocalDateTime startTime, LocalDateTime endTime);

    LatestSmokeVO getLatest(Long deviceId);

    TrendVO getTrend(Long deviceId, LocalDateTime startTime, LocalDateTime endTime);

    /**
     * 烟雾数据上报（MQTT 事件 / HTTP 降级通道共用入口）
     * 内部：刷新心跳 + 保存记录 + WS 推送 + 触发规则引擎分级判定
     */
    void reportReading(String deviceSn, BigDecimal smokeConcentration,
                       BigDecimal temperature, BigDecimal coConcentration);
}
