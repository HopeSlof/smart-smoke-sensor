package com.cqu.schedule;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.cqu.common.enums.AlarmLevel;
import com.cqu.common.enums.AlarmType;
import com.cqu.common.enums.OnlineStatus;
import com.cqu.entity.Devices;
import com.cqu.entity.ThresholdConfig;
import com.cqu.mapper.DevicesMapper;
import com.cqu.service.IAlarmLogsService;
import com.cqu.service.IThresholdConfigService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 低电量检测定时任务
 */
@Slf4j
@Component
public class BatteryCheckTask {

    @Autowired
    private DevicesMapper devicesMapper;

    @Autowired
    private IThresholdConfigService thresholdConfigService;

    @Autowired
    private IAlarmLogsService alarmLogsService;

    @Scheduled(fixedRate = 300_000)
    public void checkBattery() {
        ThresholdConfig config = thresholdConfigService.getConfigEntity();
        if (config == null || config.getBatteryLowThreshold() == null) {
            return;
        }
        int lowThreshold = config.getBatteryLowThreshold();

        List<Devices> lowBatteryDevices = devicesMapper.selectList(
                new LambdaQueryWrapper<Devices>()
                        .eq(Devices::getOnlineStatus, OnlineStatus.ONLINE.name())
                        .lt(Devices::getBatteryLevel, lowThreshold));

        for (Devices device : lowBatteryDevices) {
            alarmLogsService.createAlarm(device.getId(), AlarmType.LOW_BATTERY.name(),
                    AlarmLevel.LOW_BATTERY.name(), "设备电量低于 " + lowThreshold + "%");
            log.info("低电量: 设备 {} ({}) 电量 {}%", device.getId(), device.getDeviceName(), device.getBatteryLevel());
        }
    }
}
