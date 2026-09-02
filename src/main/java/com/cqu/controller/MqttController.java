package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.config.MqttGateway;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * MQTT 状态监控接口（前端 MqttApi）
 */
@RestController
@RequestMapping("/mqtt")
public class MqttController {

    @Autowired
    private MqttGateway mqttGateway;

    /**
     * MQTT 连接状态 GET /mqtt/status
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @GetMapping("/status")
    public Result<Map<String, Object>> status() {
        Map<String, Object> result = new HashMap<>();
        result.put("connected", mqttGateway.isConnected());
        result.put("brokerUrl", mqttGateway.getBrokerUrl());
        result.put("clientId", mqttGateway.getClientId());
        result.put("subscribedTopics", List.of("smoke", "alarm", "heartbeat", "self-check"));
        return Result.success(result);
    }

    /**
     * MQTT 消息流 GET /mqtt/messages?limit=N
     * 暂返回空列表（生产环境可接消息队列历史）
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @GetMapping("/messages")
    public Result<List<Map<String, Object>>> messages(@RequestParam(defaultValue = "20") int limit) {
        return Result.success(List.of());
    }
}
