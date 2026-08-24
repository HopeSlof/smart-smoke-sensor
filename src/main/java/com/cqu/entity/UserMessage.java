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
 * 站内消息（居民-管理员双向消息）
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("user_message")
public class UserMessage implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(value = "id", type = IdType.NONE)
    private Long id;

    /** 发送者用户 ID */
    private Long senderUserId;

    /** 发送者用户名（冗余，便于展示） */
    private String senderUsername;

    /** 所属小区 */
    private Long communityId;

    /** 消息类型 */
    private String type;

    /** 消息内容 */
    private String content;

    /** 状态: UNREAD | READ */
    private String status;

    /** 回复的原消息 ID（管理员回复居民时指向原消息） */
    private Long replyToId;

    /** 发送者角色: RESIDENT=居民发, ADMIN=管理员回复 */
    private String senderRole;

    private LocalDateTime createdAt;
}
