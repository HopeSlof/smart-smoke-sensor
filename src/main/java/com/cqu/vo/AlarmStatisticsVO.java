package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 告警统计视图（含误报率相关字段）
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AlarmStatisticsVO {

    /** 活跃告警总数 */
    private String activeCount;
    /** 活跃火警数 */
    private String fireCount;
    /** 活跃预警数 */
    private String warnCount;
    /** 按类型分组统计 */
    private List<AlarmTypeCount> byType;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AlarmTypeCount {
        private String alarmType;
        private String count;
    }
}
