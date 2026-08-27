package com.cqu.vo;

import lombok.Builder;
import lombok.Data;

/**
 * AI 视觉复核 VO
 */
@Data
@Builder
public class AiReviewVO {

    private String id;
    private String alarmLogId;
    private String smokeDeviceId;
    private String cameraDeviceId;
    private String cameraDeviceName;
    private String imageUrl;
    private String aiResult;
    private String confidence;
    private String aiDescription;
    private String status;
    private String errorMessage;
    private String reviewTime;
    private String createdAt;
}
