package com.cqu.config;

import com.cqu.event.DeviceAlarmReportedEvent;
import com.cqu.event.DeviceHeartbeatEvent;
import com.cqu.event.DeviceSelfCheckEvent;
import com.cqu.event.SmokeReportedEvent;
import com.cqu.service.IDeviceCommander;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * MQTT 网关
 * <p>职责单一：负责连接 / 订阅 / 下发指令 / 接收消息并发布领域事件。
 * 不依赖任何业务 Service，业务处理通过事件监听解耦，彻底消除循环依赖。</p>
 */
@Slf4j
@Component
public class MqttGateway implements IDeviceCommander {

    @Value("${mqtt.broker-url}")
    private String brokerUrl;

    @Value("${mqtt.client-id}")
    private String clientId;

    @Value("${mqtt.username:}")
    private String username;

    @Value("${mqtt.password:}")
    private String password;

    private static final String TOPIC_PREFIX = "smoke-sensor/";
    private static final String COMMAND_TOPIC_TPL = TOPIC_PREFIX + "%s/command";
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private final ApplicationEventPublisher eventPublisher;
    private MqttClient mqttClient;

    public MqttGateway(ApplicationEventPublisher eventPublisher) {
        this.eventPublisher = eventPublisher;
    }

    // ==================== 生命周期 ====================

    @PostConstruct
    public void init() {
        try {
            MqttConnectOptions options = new MqttConnectOptions();
            options.setCleanSession(true);
            options.setAutomaticReconnect(true);
            options.setConnectionTimeout(10);
            options.setKeepAliveInterval(60);
            if (username != null && !username.isBlank()) {
                options.setUserName(username);
            }
            if (password != null && !password.isBlank()) {
                options.setPassword(password.toCharArray());
            }

            mqttClient = new MqttClient(brokerUrl, clientId, new MemoryPersistence());
            mqttClient.setCallback(new MqttCallbackExtended() {
                @Override
                public void connectComplete(boolean reconnect, String serverURI) {
                    log.info("MQTT 连接成功: broker={}, reconnect={}", serverURI, reconnect);
                    subscribeTopics();
                }

                @Override
                public void connectionLost(Throwable cause) {
                    log.warn("MQTT 连接断开: {}", cause.getMessage());
                }

                @Override
                public void messageArrived(String topic, MqttMessage message) {
                    handleMessage(topic, message);
                }

                @Override
                public void deliveryComplete(IMqttDeliveryToken token) {
                    // no-op
                }
            });

            mqttClient.connect(options);
            log.info("MQTT 网关初始化完成: brokerUrl={}, clientId={}", brokerUrl, clientId);
        } catch (MqttException e) {
            log.error("MQTT 网关初始化失败", e);
        }
    }

    @PreDestroy
    public void destroy() {
        if (mqttClient != null && mqttClient.isConnected()) {
            try {
                mqttClient.disconnect();
                mqttClient.close();
                log.info("MQTT 网关已关闭");
            } catch (MqttException e) {
                log.error("MQTT 网关关闭异常", e);
            }
        }
    }

    // ==================== 订阅 ====================

    private void subscribeTopics() {
        try {
            mqttClient.subscribe(new String[]{
                    TOPIC_PREFIX + "+/smoke",
                    TOPIC_PREFIX + "+/alarm",
                    TOPIC_PREFIX + "+/heartbeat",
                    TOPIC_PREFIX + "+/self-check",
            }, new int[]{0, 1, 0, 0}); // 告警用 QoS 1
            log.info("MQTT 已订阅 topic: smoke / alarm / heartbeat / self-check");
        } catch (MqttException e) {
            log.error("MQTT 订阅 topic 失败", e);
        }
    }

    // ==================== 下发指令（IDeviceCommander） ====================

    /** MQTT 连接状态 */
    public boolean isConnected() {
        return mqttClient != null && mqttClient.isConnected();
    }

    /** Broker 地址 */
    public String getBrokerUrl() {
        return brokerUrl;
    }

    /** 客户端 ID */
    public String getClientId() {
        return clientId;
    }

    @Override
    public void publishCommand(String deviceSn, String command) {
        if (deviceSn == null) {
            log.warn("下发指令失败: deviceSn 为 null");
            return;
        }
        String topic = String.format(COMMAND_TOPIC_TPL, deviceSn);
        Map<String, String> payload = new LinkedHashMap<>();
        payload.put("command", command);
        payload.put("timestamp", LocalDateTime.now().format(FORMATTER));
        publish(topic, payload, 1);
    }

    private void publish(String topic, Object payload, int qos) {
        if (mqttClient == null || !mqttClient.isConnected()) {
            log.warn("MQTT 未连接，丢弃消息: topic={}", topic);
            return;
        }
        try {
            String json = OBJECT_MAPPER.writeValueAsString(payload);
            MqttMessage msg = new MqttMessage(json.getBytes(StandardCharsets.UTF_8));
            msg.setQos(qos);
            mqttClient.publish(topic, msg);
        } catch (Exception e) {
            log.error("MQTT publish 失败: topic={}", topic, e);
        }
    }

    // ==================== 消息路由（发布领域事件） ====================

    private void handleMessage(String topic, MqttMessage message) {
        try {
            String payload = new String(message.getPayload(), StandardCharsets.UTF_8);
            log.info("MQTT 收到消息: topic={}, payload={}", topic, payload);

            // topic 格式: smoke-sensor/{deviceSn}/{type}
            String[] parts = topic.split("/");
            if (parts.length != 3) {
                log.warn("MQTT 消息 topic 格式错误: {}", topic);
                return;
            }
            String deviceSn = parts[1];
            String type = parts[2];

            Map<String, Object> data = OBJECT_MAPPER.readValue(payload, Map.class);

            switch (type) {
                case "smoke" -> publishSmokeEvent(deviceSn, data);
                case "alarm" -> publishAlarmEvent(deviceSn, data);
                case "heartbeat" -> publishHeartbeatEvent(deviceSn, data);
                case "self-check" -> publishSelfCheckEvent(deviceSn, data);
                default -> log.warn("未知的 MQTT 消息类型: {}", type);
            }
        } catch (Exception e) {
            log.error("MQTT 消息处理异常: topic={}", topic, e);
        }
    }

    private void publishSmokeEvent(String deviceSn, Map<String, Object> data) {
        BigDecimal smoke = toBigDecimal(data.get("smokeConcentration"));
        BigDecimal temperature = toBigDecimal(data.get("temperature"));
        BigDecimal co = toBigDecimal(data.get("coConcentration"));
        eventPublisher.publishEvent(new SmokeReportedEvent(deviceSn, smoke, temperature, co));
    }

    private void publishAlarmEvent(String deviceSn, Map<String, Object> data) {
        String alarmType = (String) data.get("alarmType");
        String message = (String) data.get("message");
        eventPublisher.publishEvent(new DeviceAlarmReportedEvent(deviceSn, alarmType, message));
    }

    private void publishHeartbeatEvent(String deviceSn, Map<String, Object> data) {
        Integer battery = toInteger(data.get("batteryLevel"));
        eventPublisher.publishEvent(new DeviceHeartbeatEvent(deviceSn, battery));
    }

    private void publishSelfCheckEvent(String deviceSn, Map<String, Object> data) {
        Integer battery = toInteger(data.get("batteryLevel"));
        Boolean fault = data.get("sensorFault") != null
                ? Boolean.valueOf(data.get("sensorFault").toString()) : null;
        eventPublisher.publishEvent(new DeviceSelfCheckEvent(deviceSn, battery, fault));
    }

    private BigDecimal toBigDecimal(Object value) {
        return value != null ? new BigDecimal(value.toString()) : null;
    }

    private Integer toInteger(Object value) {
        return value != null ? Integer.valueOf(value.toString()) : null;
    }
}
