package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 管理员创建用户请求
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserCreateRequest {

    private String username;
    private String password;
    /** 角色: RESIDENT / COMMUNITY_ADMIN / FIREFIGHTER */
    private String role;
    private Long communityId;
    private String realName;
    private String phone;
}
