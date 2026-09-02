package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.config.MqttGateway;
import com.cqu.vo.Result;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 架构状态接口（前端 ArchitectureApi）
 * 返回系统各层组件运行状态
 */
@RestController
@RequestMapping("/architecture")
public class ArchitectureController {

    @Autowired
    private MqttGateway mqttGateway;

    /**
     * 系统架构各层状态 GET /architecture/status
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN})
    @GetMapping("/status")
    public Result<Map<String, Object>> status() {
        Map<String, Object> result = new HashMap<>();

        // 感知层
        result.put("perceptionLayer", Map.of(
                "status", "ACTIVE",
                "components", List.of("烟感传感器", "温度传感器", "摄像头"),
                "protocol", "MQTT"));

        // 传输层
        result.put("transportLayer", Map.of(
                "status", mqttGateway.isConnected() ? "ACTIVE" : "DEGRADED",
                "mqttConnected", mqttGateway.isConnected(),
                "brokerUrl", mqttGateway.getBrokerUrl()));

        // 平台层
        result.put("platformLayer", Map.of(
                "status", "ACTIVE",
                "components", List.of("Spring Boot 3.5", "MyBatis-Plus", "PostgreSQL", "pgvector")));

        // 应用层
        result.put("applicationLayer", Map.of(
                "status", "ACTIVE",
                "components", List.of("告警管理", "设备管理", "AI视觉复核", "RAG智能问答", "WebSocket实时推送")));

        return Result.success(result);
    }
}
