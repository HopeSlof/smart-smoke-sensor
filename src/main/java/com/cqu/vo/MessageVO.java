package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 站内消息视图
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MessageVO {

    private String id;
    private Long senderUserId;
    private String senderUsername;
    private Long communityId;
    private String type;
    private String content;
    private String status;
    private Long replyToId;
    private String senderRole;
    private String createdAt;
}
