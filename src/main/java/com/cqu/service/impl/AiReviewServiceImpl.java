package com.cqu.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.cqu.common.enums.DeviceType;
import com.cqu.config.LlmConfig;
import com.cqu.entity.AiReviewLog;
import com.cqu.entity.Devices;
import com.cqu.mapper.AiReviewLogMapper;
import com.cqu.mapper.DevicesMapper;
import com.cqu.service.IAiReviewService;
import com.cqu.utils.WebSocketNotifier;
import com.cqu.vo.AiReviewVO;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;

/**
 * AI 视觉复核服务实现
 * <p>告警触发后异步调用视觉大模型分析摄像头画面，判定是否有明火/烟雾。</p>
 */
@Slf4j
@Service
public class AiReviewServiceImpl implements IAiReviewService {

    @Autowired
    private AiReviewLogMapper aiReviewLogMapper;

    @Autowired
    private DevicesMapper devicesMapper;

    @Autowired
    private LlmConfig llmConfig;

    @Autowired
    private WebSocketNotifier webSocketNotifier;

    @Autowired
    private ObjectMapper objectMapper;

    /** 默认摄像头快照 URL（无真实摄像头时使用） */
    @Value("${ai-review.default-snapshot-url:}")
    private String defaultSnapshotUrl;

    /** 视觉大模型名称（默认使用通义千问视觉模型） */
    @Value("${ai-review.vision-model:Qwen/Qwen2-VL-72B-Instruct}")
    private String visionModel;

    @Override
    @Async
    public void triggerReviewAsync(Long alarmLogId, Long smokeDeviceId) {
        try {
            triggerReview(alarmLogId, null);
        } catch (Exception e) {
            log.error("AI 视觉复核异步触发失败: alarmLogId={}", alarmLogId, e);
        }
    }

    @Override
    public void triggerReview(Long alarmLogId, String imageUrl) {
        // 查找告警关联的烟感设备
        AiReviewLog existing = aiReviewLogMapper.selectOne(
                new LambdaQueryWrapper<AiReviewLog>().eq(AiReviewLog::getAlarmLogId, alarmLogId));
        if (existing != null && "SUCCESS".equals(existing.getStatus())) {
            log.info("告警 {} 已有成功的 AI 复核记录，跳过", alarmLogId);
            return;
        }

        // 通过 alarmLogId 查找告警获取烟感设备 ID
        // 如果是手动触发，imageUrl 由调用方提供
        Long smokeDeviceId = existing != null ? existing.getSmokeDeviceId() : null;
        if (smokeDeviceId == null) {
            // 从告警记录中无法直接获取，需要从 alarm_logs 表查
            // 这里通过 alarmLogId 关联查询
            log.warn("无法确定烟感设备 ID，使用 imageUrl 直接分析");
        }

        // 查找同小区的摄像头
        Devices camera = findCamera(smokeDeviceId);
        String effectiveImageUrl = imageUrl;
        if (effectiveImageUrl == null || effectiveImageUrl.isBlank()) {
            if (camera != null) {
                // 实际项目中这里应该调用摄像头 RTSP 快照接口
                // 目前使用配置的默认图片
                effectiveImageUrl = defaultSnapshotUrl;
            } else {
                effectiveImageUrl = defaultSnapshotUrl;
            }
        }

        // 创建复核记录
        AiReviewLog reviewLog = new AiReviewLog();
        reviewLog.setAlarmLogId(alarmLogId);
        reviewLog.setSmokeDeviceId(smokeDeviceId);
        reviewLog.setCameraDeviceId(camera != null ? camera.getId() : null);
        reviewLog.setImageUrl(effectiveImageUrl);
        reviewLog.setStatus("PENDING");
        reviewLog.setCreatedAt(LocalDateTime.now());
        aiReviewLogMapper.insert(reviewLog);
        log.info("创建 AI 复核记录: id={}, alarmLogId={}, camera={}",
                reviewLog.getId(), alarmLogId, camera != null ? camera.getDeviceName() : "无");

        // 调用 AI 视觉模型
        callVisionModel(reviewLog);
    }

    @Override
    public AiReviewVO getReviewByAlarmId(Long alarmLogId) {
        AiReviewLog reviewLog = aiReviewLogMapper.selectOne(
                new LambdaQueryWrapper<AiReviewLog>().eq(AiReviewLog::getAlarmLogId, alarmLogId));
        if (reviewLog == null) {
            return null;
        }
        return toVO(reviewLog);
    }

    /**
     * 查找烟感绑定的摄像头设备
     * 优先使用 bound_camera_id 绑定的摄像头，未绑定时按小区查找
     */
    private Devices findCamera(Long smokeDeviceId) {
        if (smokeDeviceId == null) {
            // 无烟感设备 ID 时，查找任意摄像头（优先在线）
            Devices cam = devicesMapper.selectOne(
                    new LambdaQueryWrapper<Devices>()
                            .eq(Devices::getDeviceType, DeviceType.CAMERA.name())
                            .eq(Devices::getOnlineStatus, "ONLINE")
                            .last("LIMIT 1"));
            if (cam == null) {
                cam = devicesMapper.selectOne(
                        new LambdaQueryWrapper<Devices>()
                                .eq(Devices::getDeviceType, DeviceType.CAMERA.name())
                                .last("LIMIT 1"));
            }
            return cam;
        }
        Devices smokeDevice = devicesMapper.selectById(smokeDeviceId);
        if (smokeDevice == null) {
            return null;
        }
        // 优先使用绑定的摄像头
        if (smokeDevice.getBoundCameraId() != null) {
            Devices boundCamera = devicesMapper.selectById(smokeDevice.getBoundCameraId());
            if (boundCamera != null) {
                log.info("使用绑定摄像头: smokeDevice={}, camera={}",
                        smokeDevice.getDeviceName(), boundCamera.getDeviceName());
                return boundCamera;
            }
        }
        // 未绑定摄像头时，按小区查找
        if (smokeDevice.getCommunityId() == null) {
            return null;
        }
        Devices camera = devicesMapper.selectOne(
                new LambdaQueryWrapper<Devices>()
                        .eq(Devices::getDeviceType, DeviceType.CAMERA.name())
                        .eq(Devices::getCommunityId, smokeDevice.getCommunityId())
                        .eq(Devices::getOnlineStatus, "ONLINE")
                        .last("LIMIT 1"));
        if (camera == null) {
            // 同小区无在线摄像头，放宽条件查找任意摄像头
            camera = devicesMapper.selectOne(
                    new LambdaQueryWrapper<Devices>()
                            .eq(Devices::getDeviceType, DeviceType.CAMERA.name())
                            .eq(Devices::getCommunityId, smokeDevice.getCommunityId())
                            .last("LIMIT 1"));
        }
        if (camera != null) {
            log.warn("烟感 {} 未绑定摄像头，使用同小区摄像头 {}", smokeDevice.getDeviceName(), camera.getDeviceName());
        }
        return camera;
    }

    /**
     * 调用视觉大模型分析图片
     */
    private void callVisionModel(AiReviewLog reviewLog) {
        if (reviewLog.getImageUrl() == null || reviewLog.getImageUrl().isBlank()) {
            log.warn("无可用图片 URL，AI 复核将模拟结果（开发/演示环境）");
            simulateReview(reviewLog);
            return;
        }

        String apiKey = llmConfig.getApiKey();
        String baseUrl = llmConfig.getBaseUrl();
        if (apiKey == null || apiKey.isBlank() || "sk-placeholder".equals(apiKey)) {
            log.warn("LLM API Key 未配置，AI 复核将模拟结果");
            // 无 API Key 时模拟结果（开发/演示环境）
            simulateReview(reviewLog);
            return;
        }

        try {
            RestTemplate restTemplate = llmConfig.restTemplate();

            // 构建请求体（OpenAI 兼容格式）
            ObjectNode requestBody = objectMapper.createObjectNode();
            requestBody.put("model", visionModel);
            requestBody.put("max_tokens", 500);

            ArrayNode messages = objectMapper.createArrayNode();
            ObjectNode message = objectMapper.createObjectNode();
            message.put("role", "user");

            ArrayNode content = objectMapper.createArrayNode();

            // 文本提示词
            ObjectNode textPart = objectMapper.createObjectNode();
            textPart.put("type", "text");
            textPart.put("text",
                    "你是一个消防图像分析专家。请仔细分析这张图片，判断是否存在明火、烟雾或火灾迹象。" +
                    "请严格以JSON格式回复，不要包含其他内容：" +
                    "{\"has_fire\": true或false, \"confidence\": 0.0到1.0之间的小数, \"description\": \"简要描述分析依据\"}。" +
                    "如果图片不清晰或无法判断，has_fire设为false，confidence设为0.3以下。");
            content.add(textPart);

            // 图片 URL
            ObjectNode imagePart = objectMapper.createObjectNode();
            imagePart.put("type", "image_url");
            ObjectNode imageUrlNode = objectMapper.createObjectNode();
            imageUrlNode.put("url", reviewLog.getImageUrl());
            imagePart.set("image_url", imageUrlNode);
            content.add(imagePart);

            message.set("content", content);
            messages.add(message);
            requestBody.set("messages", messages);

            // 发送请求
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(apiKey);

            HttpEntity<String> entity = new HttpEntity<>(objectMapper.writeValueAsString(requestBody), headers);
            String response = restTemplate.postForObject(
                    baseUrl + "/chat/completions", entity, String.class);

            log.info("AI 视觉模型返回响应: alarmLogId={}", reviewLog.getAlarmLogId());

            // 解析响应
            parseAiResponse(reviewLog, response);

        } catch (Exception e) {
            log.error("调用 AI 视觉模型失败: alarmLogId={}", reviewLog.getAlarmLogId(), e);
            updateFailed(reviewLog, "调用 AI 服务异常: " + e.getMessage());
        }
    }

    /**
     * 解析 AI 返回的响应
     */
    private void parseAiResponse(AiReviewLog reviewLog, String response) {
        try {
            JsonNode root = objectMapper.readTree(response);
            JsonNode choices = root.path("choices");
            String aiText = "";
            if (choices.isArray() && !choices.isEmpty()) {
                aiText = choices.get(0).path("message").path("content").asText();
                log.info("AI 分析结果文本: {}", aiText);

                // 尝试从文本中提取 JSON
                String jsonStr = extractJson(aiText);
                if (jsonStr != null) {
                    JsonNode analysis = objectMapper.readTree(jsonStr);
                    boolean hasFire = analysis.path("has_fire").asBoolean(false);
                    double confidence = analysis.path("confidence").asDouble(0.0);
                    String description = analysis.path("description").asText("");

                    reviewLog.setAiResult(hasFire ? "FIRE" : "NO_FIRE");
                    reviewLog.setConfidence(confidence);
                    reviewLog.setAiDescription(description);
                    reviewLog.setStatus("SUCCESS");
                    reviewLog.setReviewTime(LocalDateTime.now());
                    aiReviewLogMapper.updateById(reviewLog);

                    log.info("AI 复核完成: alarmLogId={}, result={}, confidence={}",
                            reviewLog.getAlarmLogId(), reviewLog.getAiResult(), confidence);

                    // WebSocket 推送复核结果
                    pushReviewResult(reviewLog);
                    return;
                }
            }
            // 无法解析 JSON
            reviewLog.setAiResult("UNCERTAIN");
            reviewLog.setConfidence(0.0);
            reviewLog.setAiDescription("AI 返回内容无法解析: " + aiText.substring(0, Math.min(aiText.length(), 200)));
            reviewLog.setStatus("SUCCESS");
            reviewLog.setReviewTime(LocalDateTime.now());
            aiReviewLogMapper.updateById(reviewLog);
            pushReviewResult(reviewLog);

        } catch (Exception e) {
            log.error("解析 AI 响应失败", e);
            updateFailed(reviewLog, "解析 AI 响应失败: " + e.getMessage());
        }
    }

    /**
     * 从 AI 文本回复中提取 JSON
     */
    private String extractJson(String text) {
        int start = text.indexOf('{');
        int end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return text.substring(start, end + 1);
        }
        return null;
    }

    /**
     * 无 API Key 时的模拟结果（开发环境用）
     */
    private void simulateReview(AiReviewLog reviewLog) {
        reviewLog.setAiResult("UNCERTAIN");
        reviewLog.setConfidence(0.0);
        reviewLog.setAiDescription("AI 服务未配置 API Key，返回模拟结果。请配置 llm.api-key 后使用真实分析。");
        reviewLog.setStatus("SUCCESS");
        reviewLog.setReviewTime(LocalDateTime.now());
        aiReviewLogMapper.updateById(reviewLog);
        log.info("AI 复核（模拟）: alarmLogId={}", reviewLog.getAlarmLogId());
        pushReviewResult(reviewLog);
    }

    private void updateFailed(AiReviewLog reviewLog, String error) {
        reviewLog.setStatus("FAILED");
        reviewLog.setErrorMessage(error);
        reviewLog.setReviewTime(LocalDateTime.now());
        aiReviewLogMapper.updateById(reviewLog);
        pushReviewResult(reviewLog);
    }

    /**
     * WebSocket 推送 AI 复核结果
     */
    private void pushReviewResult(AiReviewLog reviewLog) {
        try {
            AiReviewVO vo = toVO(reviewLog);
            webSocketNotifier.pushAiReview(vo);
        } catch (Exception e) {
            log.error("WebSocket 推送 AI 复核结果失败", e);
        }
    }

    private AiReviewVO toVO(AiReviewLog reviewLog) {
        String cameraName = null;
        if (reviewLog.getCameraDeviceId() != null) {
            Devices camera = devicesMapper.selectById(reviewLog.getCameraDeviceId());
            if (camera != null) cameraName = camera.getDeviceName();
        }
        return AiReviewVO.builder()
                .id(String.valueOf(reviewLog.getId()))
                .alarmLogId(String.valueOf(reviewLog.getAlarmLogId()))
                .smokeDeviceId(reviewLog.getSmokeDeviceId() != null ? String.valueOf(reviewLog.getSmokeDeviceId()) : null)
                .cameraDeviceId(reviewLog.getCameraDeviceId() != null ? String.valueOf(reviewLog.getCameraDeviceId()) : null)
                .cameraDeviceName(cameraName)
                .imageUrl(reviewLog.getImageUrl())
                .aiResult(reviewLog.getAiResult())
                .confidence(reviewLog.getConfidence() != null ? String.valueOf(reviewLog.getConfidence()) : null)
                .aiDescription(reviewLog.getAiDescription())
                .status(reviewLog.getStatus())
                .errorMessage(reviewLog.getErrorMessage())
                .reviewTime(reviewLog.getReviewTime() != null ? String.valueOf(reviewLog.getReviewTime()) : null)
                .createdAt(reviewLog.getCreatedAt() != null ? String.valueOf(reviewLog.getCreatedAt()) : null)
                .build();
    }
}
