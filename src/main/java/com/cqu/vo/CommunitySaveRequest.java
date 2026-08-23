package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 小区新增/编辑请求
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CommunitySaveRequest {

    private String name;
    private String address;
    /** 负责人（COMMUNITY_ADMIN 用户 ID），可空 */
    private Long adminUserId;
}
