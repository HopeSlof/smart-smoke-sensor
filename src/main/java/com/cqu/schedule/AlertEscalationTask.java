package com.cqu.schedule;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.cqu.common.enums.AlarmLevel;
import com.cqu.common.enums.AlarmStatus;
import com.cqu.entity.AlarmLogs;
import com.cqu.entity.ThresholdConfig;
import com.cqu.mapper.AlarmLogsMapper;
import com.cqu.service.IControlLogsService;
import com.cqu.service.IThresholdConfigService;
import com.cqu.utils.WebSocketNotifier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 告警升级定时任务：火警超时未确认则自动升级
 */
@Slf4j
@Component
public class AlertEscalationTask {

    @Autowired
    private AlarmLogsMapper alarmLogsMapper;

    @Autowired
    private IThresholdConfigService thresholdConfigService;

    @Autowired
    private IControlLogsService controlLogsService;

    @Autowired
    private WebSocketNotifier webSocketNotifier;

    @Scheduled(fixedRate = 60_000)
    public void escalate() {
        ThresholdConfig config = thresholdConfigService.getConfigEntity();
        if (config == null || config.getEscalationMinutes() == null) {
            return;
        }
        LocalDateTime deadline = LocalDateTime.now().minusMinutes(config.getEscalationMinutes());

        // 仅升级火警：活跃、未确认、未升级、创建时间超时
        List<AlarmLogs> alarms = alarmLogsMapper.selectList(
                new LambdaQueryWrapper<AlarmLogs>()
                        .eq(AlarmLogs::getStatus, AlarmStatus.ACTIVE.name())
                        .eq(AlarmLogs::getAlarmLevel, AlarmLevel.FIRE.name())
                        .eq(AlarmLogs::getEscalated, false)
                        .isNull(AlarmLogs::getAcknowledgedAt)
                        .le(AlarmLogs::getCreatedAt, deadline));

        for (AlarmLogs alarm : alarms) {
            alarm.setEscalated(true);
            alarmLogsMapper.updateById(alarm);

            controlLogsService.recordLog(alarm.getDeviceId(), "ESCALATE_ALARM", "SUCCESS", "SYSTEM");

            Map<String, Object> data = new LinkedHashMap<>();
            data.put("alarmId", alarm.getId());
            data.put("deviceId", alarm.getDeviceId());
            data.put("message", alarm.getMessage());
            webSocketNotifier.pushAlarmEscalated(data);

            log.info("告警升级: 告警 {} 超时未确认，已升级", alarm.getId());
        }
    }
}
