package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.AlarmLogs;
import com.cqu.vo.AlarmLogVO;
import com.cqu.vo.AlarmStatisticsVO;
import com.cqu.vo.PageResult;

/**
 * 告警服务
 */
public interface IAlarmLogsService extends IService<AlarmLogs> {

    PageResult<AlarmLogVO> pageAlarms(int page, int pageSize, Long deviceId,
                                      String alarmType, String alarmLevel, String status);

    AlarmLogVO getAlarmDetail(Long id);

    /** 解决告警 */
    void resolveAlarm(Long id);

    /** 确认告警（记录首次确认时间，用于告警升级判定） */
    void acknowledgeAlarm(Long id);

    /** 确认处置结论（确认真火警 / 误报） */
    void confirmAlarm(Long id, String disposition);

    AlarmStatisticsVO getStatistics();

    /** 创建告警（直接 deviceId，规则引擎/定时任务调用；内部去重） */
    void createAlarm(Long deviceId, String alarmType, String alarmLevel, String message);

    /** 创建告警（deviceSn，硬件上报事件调用） */
    void createAlarm(String deviceSn, String alarmType, String alarmLevel, String message);
}
