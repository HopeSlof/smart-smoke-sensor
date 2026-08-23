package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 小区视图
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CommunityVO {

    private String id;
    private String name;
    private String address;
    /** 负责人用户 ID（字符串化） */
    private String adminUserId;
    /** 负责人用户名 */
    private String adminUsername;
    private String createdAt;
}
