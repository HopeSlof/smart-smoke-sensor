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
 * 心跳超时离线检测定时任务
 */
@Slf4j
@Component
public class HeartbeatCheckTask {

    @Autowired
    private DevicesMapper devicesMapper;

    @Autowired
    private IThresholdConfigService thresholdConfigService;

    @Autowired
    private IAlarmLogsService alarmLogsService;

    @Autowired
    private WebSocketNotifier webSocketNotifier;

    @Scheduled(fixedRate = 30_000)
    public void checkHeartbeat() {
        ThresholdConfig config = thresholdConfigService.getConfigEntity();
        if (config == null || config.getHeartbeatTimeout() == null) {
            return;
        }
        LocalDateTime deadline = LocalDateTime.now().minusSeconds(config.getHeartbeatTimeout());

        List<Devices> onlineDevices = devicesMapper.selectList(
                new LambdaQueryWrapper<Devices>().eq(Devices::getOnlineStatus, OnlineStatus.ONLINE.name()));

        for (Devices device : onlineDevices) {
            if (device.getLastHeartbeatTime() == null || device.getLastHeartbeatTime().isBefore(deadline)) {
                device.setOnlineStatus(OnlineStatus.OFFLINE.name());
                devicesMapper.updateById(device);

                alarmLogsService.createAlarm(device.getId(), AlarmType.OFFLINE.name(),
                        AlarmLevel.OFFLINE.name(), "设备心跳超时，已自动标记离线");

                Map<String, Object> data = new LinkedHashMap<>();
                data.put("deviceId", device.getId());
                data.put("deviceName", device.getDeviceName());
                data.put("onlineStatus", device.getOnlineStatus());
                data.put("lastHeartbeatTime", device.getLastHeartbeatTime());
                webSocketNotifier.pushDeviceOnline(data);

                log.info("心跳超时: 设备 {} ({}) 已标记离线", device.getId(), device.getDeviceName());
            }
        }
    }
}
