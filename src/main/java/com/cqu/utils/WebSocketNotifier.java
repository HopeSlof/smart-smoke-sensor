package com.cqu.utils;

import com.cqu.vo.WebSocketMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * WebSocket 推送封装：集中管理主题与消息信封，避免在 Service 中重复拼接。
 */
@Slf4j
@Component
public class WebSocketNotifier {

    public static final String TOPIC_SMOKE = "/topic/smoke-readings";
    public static final String TOPIC_DEVICE_STATUS = "/topic/device-status";
    public static final String TOPIC_DEVICE_ONLINE = "/topic/device-online";
    public static final String TOPIC_ALARMS = "/topic/alarms";

    private final SimpMessagingTemplate messagingTemplate;

    public WebSocketNotifier(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    /** 烟雾浓度上报 */
    public void pushSmokeReading(Object data) {
        send(TOPIC_SMOKE, "SMOKE_REPORTED", data);
    }

    /** 设备状态变更 */
    public void pushDeviceStatus(Object data) {
        send(TOPIC_DEVICE_STATUS, "DEVICE_STATUS_CHANGED", data);
    }

    /** 设备在线状态变更 */
    public void pushDeviceOnline(Object data) {
        send(TOPIC_DEVICE_ONLINE, "DEVICE_ONLINE_STATUS_CHANGED", data);
    }

    /** 新告警 */
    public void pushAlarm(Object data) {
        send(TOPIC_ALARMS, "ALARM_CREATED", data);
    }

    /** 告警升级 */
    public void pushAlarmEscalated(Object data) {
        send(TOPIC_ALARMS, "ALARM_ESCALATED", data);
    }

    private void send(String topic, String type, Object data) {
        WebSocketMessage msg = WebSocketMessage.builder()
                .type(type)
                .timestamp(LocalDateTime.now())
                .data(data)
                .build();
        log.info("WebSocket 推送 → {}: {}", topic, type);
        messagingTemplate.convertAndSend(topic, msg);
    }
}
