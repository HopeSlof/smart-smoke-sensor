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
 * 操作审计日志表
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("control_logs")
public class ControlLogs implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.NONE)
    private Long id;

    private Long deviceId;

    private Long operatorId;

    /** 操作类型: RESOLVE_ALARM / CONFIRM_FIRE / FALSE_ALARM / ESCALATE_ALARM / UPDATE_THRESHOLD ... */
    private String command;

    /** 来源: SYSTEM / MANUAL / AUTO */
    private String source;

    /** 结果: SUCCESS / FAIL */
    private String result;

    private LocalDateTime createdAt;
}
