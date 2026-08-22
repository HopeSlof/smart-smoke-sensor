package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 控制日志视图
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ControlLogVO {

    private String id;
    private String deviceId;
    private String deviceName;
    private String operatorId;
    private String operatorName;
    private String command;
    private String source;
    private String result;
    private String createdAt;
}
