package com.cqu.event;

import com.cqu.service.IAlarmLogsService;
import com.cqu.service.IDevicesService;
import com.cqu.service.ISmokeReadingsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * MQTT 领域事件监听器 —— 将硬件上报事件路由到对应业务 Service。
 * <p>作为网关与业务层之间的胶水层，业务层不反向依赖网关。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DeviceEventListeners {

    private final ISmokeReadingsService smokeReadingsService;
    private final IDevicesService devicesService;
    private final IAlarmLogsService alarmLogsService;

    @EventListener
    public void onSmokeReported(SmokeReportedEvent event) {
        smokeReadingsService.reportReading(event.deviceSn(), event.smokeConcentration(),
                event.temperature(), event.coConcentration());
    }

    @EventListener
    public void onAlarmReported(DeviceAlarmReportedEvent event) {
        alarmLogsService.createAlarm(event.deviceSn(), event.alarmType(), null, event.message());
    }

    @EventListener
    public void onHeartbeat(DeviceHeartbeatEvent event) {
        devicesService.updateHeartbeat(event.deviceSn(), event.batteryLevel());
    }

    @EventListener
    public void onSelfCheck(DeviceSelfCheckEvent event) {
        devicesService.handleSelfCheck(event.deviceSn(), event.batteryLevel(), event.sensorFault());
    }
}
