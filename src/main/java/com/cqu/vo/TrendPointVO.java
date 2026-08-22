package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 趋势点
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TrendPointVO {

    private String time;
    private String value;
}
