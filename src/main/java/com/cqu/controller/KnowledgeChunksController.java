package com.cqu.controller;

import com.cqu.common.annotation.RequireRole;
import com.cqu.common.enums.Role;
import com.cqu.config.LlmConfig;
import com.cqu.service.IKnowledgeChunksService;
import com.cqu.vo.ChatMessageVO;
import com.cqu.vo.ChatRequest;
import com.cqu.vo.ChatResponse;
import com.cqu.vo.ChatSessionVO;
import com.cqu.vo.KnowledgeImportRequest;
import com.cqu.vo.Result;
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
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * RAG 智能问答与知识库导入、多轮会话、AI 图像识别
 */
@Slf4j
@RestController
@RequestMapping("/knowledge-chunks")
public class KnowledgeChunksController {

    @Autowired
    private IKnowledgeChunksService knowledgeChunksService;

    @Autowired
    private LlmConfig llmConfig;

    @Autowired
    private ObjectMapper objectMapper;

    @Value("${ai-review.vision-model:Qwen/Qwen2-VL-72B-Instruct}")
    private String visionModel;

    /** 智能问答（支持多轮：传 sessionId 续接会话） */
    @PostMapping("/chat")
    public Result<ChatResponse> chat(@RequestBody ChatRequest request) {
        return Result.success(knowledgeChunksService.ask(request));
    }

    @RequireRole({Role.SYSTEM_ADMIN})
    @PostMapping("/import")
    public Result<String> importDocuments(@RequestBody KnowledgeImportRequest request) {
        int count = knowledgeChunksService.importDocuments(request);
        return Result.success("成功导入 " + count + " 条知识");
    }

    /** 当前用户会话列表 */
    @GetMapping("/sessions")
    public Result<List<ChatSessionVO>> listSessions() {
        return Result.success(knowledgeChunksService.listSessions());
    }

    /** 会话历史消息 */
    @GetMapping("/sessions/{sessionId}/messages")
    public Result<List<ChatMessageVO>> getMessages(@PathVariable Long sessionId) {
        return Result.success(knowledgeChunksService.getMessages(sessionId));
    }

    /** 删除会话 */
    @DeleteMapping("/sessions/{sessionId}")
    public Result<Void> deleteSession(@PathVariable Long sessionId) {
        knowledgeChunksService.deleteSession(sessionId);
        return Result.success();
    }

    /**
     * AI 图像识别（前端 AiRecognizeApi.recognize）
     * POST /knowledge-chunks/recognize  body: { image: base64, prompt? }
     * 返回：{ aiResult: "FIRE"/"NO_FIRE"/"UNCERTAIN", confidence: 0.0-1.0, description: "..." }
     */
    @PostMapping("/recognize")
    public Result<Map<String, Object>> recognize(@RequestBody Map<String, Object> body) {
        String base64Image = body != null ? (String) body.get("image") : null;
        String prompt = body != null && body.get("prompt") != null ? body.get("prompt").toString() : null;
        if (base64Image == null || base64Image.isBlank()) {
            return Result.success(Map.of("aiResult", "UNCERTAIN", "confidence", 0.0, "description", "图片数据为空"));
        }

        String apiKey = llmConfig.getApiKey();
        if (apiKey == null || apiKey.isBlank() || "sk-placeholder".equals(apiKey)) {
            log.warn("LLM API Key 未配置，图像识别返回模拟结果");
            return Result.success(Map.of("aiResult", "UNCERTAIN", "confidence", 0.0, "description", "AI 服务未配置"));
        }

        try {
            // 确保 base64 是 data URI 格式
            String imageUrl = base64Image;
            if (!imageUrl.startsWith("data:")) {
                imageUrl = "data:image/jpeg;base64," + imageUrl;
            }

            RestTemplate restTemplate = llmConfig.restTemplate();
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
            textPart.put("text", prompt != null && !prompt.isBlank() ? prompt :
                    "你是一个消防图像分析专家。请仔细分析这张图片，判断是否存在明火、烟雾或火灾迹象。" +
                    "请严格以JSON格式回复，不要包含其他内容：" +
                    "{\"has_fire\": true或false, \"confidence\": 0.0到1.0之间的小数, \"description\": \"简要描述分析依据\"}。" +
                    "如果图片不清晰或无法判断，has_fire设为false，confidence设为0.3以下。");
            content.add(textPart);

            // 图片
            ObjectNode imagePart = objectMapper.createObjectNode();
            imagePart.put("type", "image_url");
            ObjectNode imageUrlNode = objectMapper.createObjectNode();
            imageUrlNode.put("url", imageUrl);
            imagePart.set("image_url", imageUrlNode);
            content.add(imagePart);

            message.set("content", content);
            messages.add(message);
            requestBody.set("messages", messages);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(apiKey);

            HttpEntity<String> entity = new HttpEntity<>(objectMapper.writeValueAsString(requestBody), headers);
            String response = restTemplate.postForObject(
                    llmConfig.getBaseUrl() + "/chat/completions", entity, String.class);

            // 解析返回
            JsonNode root = objectMapper.readTree(response);
            JsonNode choices = root.path("choices");
            String aiText = "";
            if (choices.isArray() && !choices.isEmpty()) {
                aiText = choices.get(0).path("message").path("content").asText();
            }
            log.info("图像识别返回: {}", aiText);

            // 提取 JSON
            String jsonStr = extractJson(aiText);
            Map<String, Object> result = new HashMap<>();
            if (jsonStr != null) {
                JsonNode analysis = objectMapper.readTree(jsonStr);
                result.put("aiResult", analysis.path("has_fire").asBoolean(false) ? "FIRE" : "NO_FIRE");
                result.put("confidence", analysis.path("confidence").asDouble(0.0));
                result.put("description", analysis.path("description").asText(""));
            } else {
                result.put("aiResult", "UNCERTAIN");
                result.put("confidence", 0.0);
                result.put("description", aiText);
            }
            return Result.success(result);

        } catch (Exception e) {
            log.error("图像识别失败", e);
            Map<String, Object> err = new HashMap<>();
            err.put("aiResult", "UNCERTAIN");
            err.put("confidence", 0.0);
            err.put("description", "识别失败: " + e.getMessage());
            return Result.success(err);
        }
    }

    /** 从 AI 返回文本中提取 JSON */
    private String extractJson(String text) {
        if (text == null) return null;
        int start = text.indexOf('{');
        int end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return text.substring(start, end + 1);
        }
        return null;
    }
}
