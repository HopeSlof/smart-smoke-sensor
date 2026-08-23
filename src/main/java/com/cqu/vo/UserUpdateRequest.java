package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用户编辑请求
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserUpdateRequest {

    /** 角色: RESIDENT / COMMUNITY_ADMIN / FIREFIGHTER（不能设为 SYSTEM_ADMIN） */
    private String role;
    private Long communityId;
    private String realName;
    private String phone;
}
