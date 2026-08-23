package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用户视图
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserVO {

    private String id;
    private String username;
    private String role;
    private Long communityId;
    private String status;
    private String realName;
    private String phone;
    private String createdAt;
}
