package com.cqu.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.config.LlmConfig;
import com.cqu.entity.KnowledgeChunks;
import com.cqu.mapper.KnowledgeChunksMapper;
import com.cqu.service.IKnowledgeChunksService;
import com.cqu.vo.KnowledgeImportRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * RAG 检索增强生成服务实现（embedding + pgvector 检索 + LLM 生成）
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RagServiceImpl extends ServiceImpl<KnowledgeChunksMapper, KnowledgeChunks>
        implements IKnowledgeChunksService {

    private final LlmConfig llmConfig;
    private final RestTemplate restTemplate;
    private final KnowledgeChunksMapper knowledgeChunksMapper;

    private static final String SYSTEM_PROMPT = """
            你是智慧烟感系统的消防应急助手。请根据用户问题提供专业、简洁、准确的回答，
            内容包括火灾应急处理、人员疏散、烟感设备维护等。
            """;

    @Override
    public String ask(String question) {
        if (question == null || question.isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "问题不能为空");
        }

        String context = "";
        try {
            float[] embedding = embed(question);
            List<KnowledgeChunks> chunks = knowledgeChunksMapper.searchByEmbedding(
                    Arrays.toString(embedding), llmConfig.getTopK());
            context = chunks.stream()
                    .map(c -> "- " + c.getContent())
                    .collect(Collectors.joining("\n"));
        } catch (Exception e) {
            log.warn("RAG 检索失败，降级为纯 LLM 回答: {}", e.getMessage());
        }

        return chat(context, question);
    }

    @Override
    public int importDocuments(KnowledgeImportRequest request) {
        List<KnowledgeImportRequest.Doc> docs = request.getDocuments();
        if (docs == null || docs.isEmpty()) {
            return 0;
        }

        int count = 0;
        for (KnowledgeImportRequest.Doc doc : docs) {
            if (doc.getContent() == null || doc.getContent().isBlank()) {
                continue;
            }
            KnowledgeChunks chunk = new KnowledgeChunks();
            chunk.setTitle(doc.getTitle());
            chunk.setContent(doc.getContent());
            chunk.setEmbedding(embed(doc.getContent()));
            this.save(chunk);
            count++;
        }
        return count;
    }

    // ==================== LLM 调用 ====================

    @SuppressWarnings("unchecked")
    private String chat(String context, String question) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(llmConfig.getApiKey());

        String userPrompt;
        if (context == null || context.isBlank()) {
            userPrompt = "用户问题：" + question;
        } else {
            userPrompt = "相关知识库内容：\n" + context + "\n\n用户问题：" + question;
        }

        List<Map<String, String>> messages = new ArrayList<>();
        messages.add(Map.of("role", "system", "content", SYSTEM_PROMPT));
        messages.add(Map.of("role", "user", "content", userPrompt));

        Map<String, Object> body = Map.of("model", llmConfig.getModel(), "messages", messages);

        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(
                    llmConfig.getBaseUrl() + "/chat/completions",
                    new HttpEntity<>(body, headers), Map.class);

            List<Map<String, Object>> choices = (List<Map<String, Object>>) response.getBody().get("choices");
            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            return (String) message.get("content");
        } catch (Exception e) {
            log.error("调用 Chat API 失败: {}", e.getMessage());
            throw new BusinessException("AI 服务调用失败: " + e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private float[] embed(String text) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(llmConfig.getEmbeddingApiKey());

        Map<String, Object> body = Map.of("model", llmConfig.getEmbeddingModel(), "input", text);

        ResponseEntity<Map> response = restTemplate.postForEntity(
                llmConfig.getEmbeddingBaseUrl() + "/embeddings",
                new HttpEntity<>(body, headers), Map.class);

        List<Map<String, Object>> data = (List<Map<String, Object>>) response.getBody().get("data");
        List<Double> vector = (List<Double>) data.get(0).get("embedding");

        float[] result = new float[vector.size()];
        for (int i = 0; i < vector.size(); i++) {
            result[i] = vector.get(i).floatValue();
        }
        return result;
    }
}
