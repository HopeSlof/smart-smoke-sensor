package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 多指标趋势视图（烟雾 / 温度 / CO 三条曲线）
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TrendVO {

    /** 烟雾浓度序列 */
    private List<TrendPointVO> smoke;
    /** 温度序列 */
    private List<TrendPointVO> temperature;
    /** 一氧化碳浓度序列 */
    private List<TrendPointVO> co;
}
