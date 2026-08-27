package com.cqu.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * AI 视觉复核记录表
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("ai_review_log")
public class AiReviewLog implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.NONE)
    private Long id;

    /** 关联告警记录 ID */
    private Long alarmLogId;

    /** 触发告警的烟感设备 ID */
    private Long smokeDeviceId;

    /** 复核用摄像头设备 ID */
    private Long cameraDeviceId;

    /** 送给 AI 分析的图片 URL */
    private String imageUrl;

    /** AI 判定结果: FIRE / NO_FIRE / UNCERTAIN */
    private String aiResult;

    /** AI 置信度 0.0-1.0 */
    private Double confidence;

    /** AI 返回的原始文本 */
    private String aiDescription;

    /** 复核状态: PENDING / SUCCESS / FAILED */
    private String status;

    /** 失败时的错误信息 */
    private String errorMessage;

    /** AI 复核完成时间 */
    private LocalDateTime reviewTime;

    private LocalDateTime createdAt;
}
