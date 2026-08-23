package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 设备绑定/解绑请求
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BindDeviceRequest {

    /** 住户（RESIDENT）用户 ID */
    private Long userId;
}
