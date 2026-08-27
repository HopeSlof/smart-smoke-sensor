package com.cqu.service;

import com.cqu.vo.AiReviewVO;

/**
 * AI 视觉复核服务
 */
public interface IAiReviewService {

    /**
     * 异步触发 AI 视觉复核（告警创建后自动调用）
     *
     * @param alarmLogId     告警记录 ID
     * @param smokeDeviceId  触发告警的烟感设备 ID
     */
    void triggerReviewAsync(Long alarmLogId, Long smokeDeviceId);

    /**
     * 手动触发 / 重试 AI 复核
     *
     * @param alarmLogId  告警记录 ID
     * @param imageUrl    手动指定的图片 URL（为空则自动查找摄像头）
     */
    void triggerReview(Long alarmLogId, String imageUrl);

    /**
     * 查询某条告警的 AI 复核结果
     */
    AiReviewVO getReviewByAlarmId(Long alarmLogId);
}
