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
    public static final String TOPIC_ALARMS_FIRE = "/topic/alarms/fire";

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

    /** 新告警（通用） */
    public void pushAlarm(Object data) {
        send(TOPIC_ALARMS, "ALARM_CREATED", data);
    }

    /** 告警升级 */
    public void pushAlarmEscalated(Object data) {
        send(TOPIC_ALARMS, "ALARM_ESCALATED", data);
    }

    /** 火警跨小区广播 */
    public void pushFireAlarm(Object data) {
        send(TOPIC_ALARMS_FIRE, "ALARM_CREATED", data);
    }

    /** 本小区告警推送 */
    public void pushCommunityAlarm(Long communityId, Object data) {
        send("/topic/community/" + communityId + "/alarms", "ALARM_CREATED", data);
    }

    /** 住户绑定设备告警重点提示（定向推送） */
    public void pushUserAlert(Long userId, Object data) {
        WebSocketMessage msg = WebSocketMessage.builder()
                .type("ALARM_HIGHLIGHT")
                .timestamp(LocalDateTime.now())
                .data(data)
                .build();
        log.info("WebSocket 重点提示 → /user/{}/queue/alerts", userId);
        messagingTemplate.convertAndSendToUser(String.valueOf(userId), "/queue/alerts", msg);
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
