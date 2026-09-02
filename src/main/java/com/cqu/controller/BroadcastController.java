package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.vo.Result;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 紧急广播接口（前端 BroadcastApi）
 * 广播历史暂用内存存储（重启后清空），生产环境可改用数据库
 */
@Slf4j
@RestController
@RequestMapping("/broadcast")
public class BroadcastController {

    /** 内存广播历史（线程安全） */
    private static final List<Map<String, Object>> HISTORY = new java.util.concurrent.CopyOnWriteArrayList<>();

    /**
     * 发送紧急广播 POST /broadcast
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.FIREFIGHTER})
    @PostMapping
    public Result<Map<String, Object>> send(@RequestBody Map<String, Object> payload) {
        Map<String, Object> record = new HashMap<>();
        record.put("id", String.valueOf(System.currentTimeMillis()));
        record.put("title", payload.getOrDefault("title", "紧急广播"));
        record.put("content", payload.getOrDefault("content", ""));
        record.put("scope", payload.getOrDefault("scope", "all"));
        record.put("priority", payload.getOrDefault("priority", "HIGH"));
        record.put("sender", "系统管理员");
        record.put("time", LocalDateTime.now().toString());
        HISTORY.add(record);
        // 只保留最近 100 条
        while (HISTORY.size() > 100) {
            HISTORY.remove(0);
        }
        log.info("紧急广播已发送: {}", record.get("title"));
        return Result.success(record);
    }

    /**
     * 广播历史 GET /broadcast/history?limit=N
     */
    @RequireRole({Role.SYSTEM_ADMIN, Role.COMMUNITY_ADMIN, Role.FIREFIGHTER})
    @GetMapping("/history")
    public Result<List<Map<String, Object>>> history(@RequestParam(defaultValue = "20") int limit) {
        int size = Math.min(limit, HISTORY.size());
        List<Map<String, Object>> result = new ArrayList<>();
        for (int i = HISTORY.size() - 1; i >= 0 && result.size() < size; i--) {
            result.add(HISTORY.get(i));
        }
        return Result.success(result);
    }
}
