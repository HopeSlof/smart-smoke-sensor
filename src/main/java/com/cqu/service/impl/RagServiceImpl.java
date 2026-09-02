package com.cqu.service.impl;

import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.cqu.common.exception.BusinessException;
import com.cqu.common.exception.ErrorCode;
import com.cqu.config.LlmConfig;
import com.cqu.entity.ChatMessage;
import com.cqu.entity.ChatSession;
import com.cqu.entity.KnowledgeChunks;
import com.cqu.mapper.ChatMessageMapper;
import com.cqu.mapper.ChatSessionMapper;
import com.cqu.mapper.KnowledgeChunksMapper;
import com.cqu.service.IKnowledgeChunksService;
import com.cqu.utils.UserHolder;
import com.cqu.vo.ChatMessageVO;
import com.cqu.vo.ChatRequest;
import com.cqu.vo.ChatResponse;
import com.cqu.vo.ChatSessionVO;
import com.cqu.vo.KnowledgeImportRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * RAG 检索增强生成服务实现（embedding + pgvector 检索 + LLM 生成 + 多轮会话）
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RagServiceImpl extends ServiceImpl<KnowledgeChunksMapper, KnowledgeChunks>
        implements IKnowledgeChunksService {

    private final LlmConfig llmConfig;
    private final RestTemplate restTemplate;
    private final KnowledgeChunksMapper knowledgeChunksMapper;
    private final ChatSessionMapper chatSessionMapper;
    private final ChatMessageMapper chatMessageMapper;

    /**
     * 向量检索余弦距离阈值（0=完全相同，越小越严格）。
     * bge-m3 实测：相关消防问题最近距离约 0.65，日常短句（如"今天天气"）约 0.63，
     * 两者重叠，故取 0.75 保召回——主要过滤完全无关的长句（距离>0.75）；
     * 短无关句的精细过滤需扩充知识库或引入 rerank 才能解决。
     */
    @Value("${llm.rag.similarity-threshold:0.75}")
    private double similarityThreshold;

    private static final String SYSTEM_PROMPT = """
            你是智慧烟感系统的消防应急助手。请根据用户问题提供专业、简洁、准确的回答，
            内容包括火灾应急处理、人员疏散、烟感设备维护等。
            若提供了相关知识库内容，请优先依据其回答，并在回答末尾注明所引用的知识编号。
            """;

    @Override
    public ChatResponse ask(ChatRequest request) {
        String question = request.getMessage();
        if (question == null || question.isBlank()) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, "问题不能为空");
        }

        // 1. 向量检索知识库
        List<KnowledgeChunks> chunks = new ArrayList<>();
        String context = "";
        try {
            float[] embedding = embed(question);
            chunks = knowledgeChunksMapper.searchByEmbedding(
                    Arrays.toString(embedding), llmConfig.getTopK(), similarityThreshold);
            context = chunks.stream()
                    .map(c -> "- " + c.getContent())
                    .collect(Collectors.joining("\n"));
        } catch (Exception e) {
            log.warn("RAG 检索失败，降级为纯 LLM 回答: {}", e.getMessage());
        }

        // 2. 组装多轮对话消息
        List<Map<String, String>> messages = new ArrayList<>();
        messages.add(Map.of("role", "system", "content", SYSTEM_PROMPT));

        ChatSession session = null;
        if (request.getSessionId() != null) {
            session = loadOwnedSession(request.getSessionId());
            List<ChatMessage> history = chatMessageMapper.selectList(
                    new LambdaQueryWrapper<ChatMessage>()
                            .eq(ChatMessage::getSessionId, session.getId())
                            .orderByDesc(ChatMessage::getId)
                            .last("LIMIT " + Math.max(0, llmConfig.getMaxHistory())));
            Collections.reverse(history);
            for (ChatMessage m : history) {
                messages.add(Map.of("role", m.getRole(), "content", m.getContent()));
            }
        }

        String userPrompt = context.isBlank()
                ? question
                : "相关知识库内容：\n" + context + "\n\n用户问题：" + question;
        messages.add(Map.of("role", "user", "content", userPrompt));

        // 3. 调用 LLM
        String answer = chat(messages);

        // 4. 持久化会话与消息
        if (session == null) {
            session = new ChatSession();
            session.setUserId(UserHolder.getUserId());
            session.setTitle(buildTitle(question));
            session.setCreatedAt(LocalDateTime.now());
            session.setUpdatedAt(LocalDateTime.now());
            chatSessionMapper.insert(session);
        } else {
            session.setUpdatedAt(LocalDateTime.now());
            chatSessionMapper.updateById(session);
        }

        ChatMessage userMsg = new ChatMessage();
        userMsg.setSessionId(session.getId());
        userMsg.setRole("user");
        userMsg.setContent(question);
        userMsg.setCreatedAt(LocalDateTime.now());
        chatMessageMapper.insert(userMsg);

        ChatMessage aiMsg = new ChatMessage();
        aiMsg.setSessionId(session.getId());
        aiMsg.setRole("assistant");
        aiMsg.setContent(answer);
        aiMsg.setSources(toSourcesJson(chunks));
        aiMsg.setCreatedAt(LocalDateTime.now());
        chatMessageMapper.insert(aiMsg);

        // 5. 返回
        return ChatResponse.builder()
                .answer(answer)
                .sessionId(session.getId())
                .sources(chunks.stream()
                        .map(c -> ChatResponse.ChatSource.builder()
                                .title(c.getTitle())
                                .content(c.getContent())
                                .build())
                        .collect(Collectors.toList()))
                .build();
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
            List<String> chunks = splitIntoChunks(
                    doc.getContent(), llmConfig.getChunkSize(), llmConfig.getChunkOverlap());
            for (String content : chunks) {
                KnowledgeChunks chunk = new KnowledgeChunks();
                chunk.setTitle(doc.getTitle());
                chunk.setContent(content);
                chunk.setEmbedding(embed(content));
                this.save(chunk);
                count++;
            }
        }
        log.info("知识导入完成，共写入 {} 个文本块", count);
        return count;
    }

    @Override
    public List<ChatSessionVO> listSessions() {
        Long userId = UserHolder.getUserId();
        List<ChatSession> sessions = chatSessionMapper.selectList(
                new LambdaQueryWrapper<ChatSession>()
                        .eq(userId != null, ChatSession::getUserId, userId)
                        .orderByDesc(ChatSession::getUpdatedAt));
        return sessions.stream().map(this::toSessionVO).collect(Collectors.toList());
    }

    @Override
    public List<ChatMessageVO> getMessages(Long sessionId) {
        ChatSession session = loadOwnedSession(sessionId);
        List<ChatMessage> messages = chatMessageMapper.selectList(
                new LambdaQueryWrapper<ChatMessage>()
                        .eq(ChatMessage::getSessionId, session.getId())
                        .orderByAsc(ChatMessage::getId));
        return messages.stream().map(this::toMessageVO).collect(Collectors.toList());
    }

    @Override
    public void deleteSession(Long sessionId) {
        ChatSession session = loadOwnedSession(sessionId);
        chatMessageMapper.delete(new LambdaQueryWrapper<ChatMessage>()
                .eq(ChatMessage::getSessionId, session.getId()));
        chatSessionMapper.deleteById(session.getId());
        log.info("删除会话: id={}", session.getId());
    }

    // ==================== LLM 调用 ====================

    @SuppressWarnings("unchecked")
    private String chat(List<Map<String, String>> messages) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(llmConfig.getApiKey());

        Map<String, Object> body = Map.of("model", llmConfig.getModel(), "messages", messages);

        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(
                    llmConfig.getBaseUrl() + "/chat/completions",
                    new HttpEntity<>(body, headers), Map.class);

            Map<String, Object> respBody = response.getBody();
            if (respBody == null) {
                throw new BusinessException("AI 服务返回空响应");
            }

            List<Map<String, Object>> choices = (List<Map<String, Object>>) respBody.get("choices");
            if (choices == null || choices.isEmpty()) {
                throw new BusinessException("AI 服务未返回有效回答");
            }

            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            if (message == null || message.get("content") == null) {
                throw new BusinessException("AI 服务返回消息格式异常");
            }

            return message.get("content").toString();
        } catch (BusinessException e) {
            throw e;
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

        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(
                    llmConfig.getEmbeddingBaseUrl() + "/embeddings",
                    new HttpEntity<>(body, headers), Map.class);

            Map<String, Object> respBody = response.getBody();
            if (respBody == null) {
                throw new BusinessException("Embedding 服务返回空响应");
            }

            List<Map<String, Object>> data = (List<Map<String, Object>>) respBody.get("data");
            if (data == null || data.isEmpty()) {
                throw new BusinessException("Embedding 服务未返回有效向量");
            }

            List<Double> vector = (List<Double>) data.get(0).get("embedding");
            if (vector == null || vector.isEmpty()) {
                throw new BusinessException("Embedding 服务返回向量格式异常");
            }

            float[] result = new float[vector.size()];
            for (int i = 0; i < vector.size(); i++) {
                Double value = vector.get(i);
                result[i] = value == null ? 0.0f : value.floatValue();
            }
            return result;
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            log.error("调用 Embedding API 失败: {}", e.getMessage());
            throw new BusinessException("Embedding 服务调用失败: " + e.getMessage());
        }
    }

    // ==================== 文档切分 / 引用来源 ====================

    private List<String> splitIntoChunks(String text, int size, int overlap) {
        List<String> chunks = new ArrayList<>();
        if (text == null || text.isBlank()) {
            return chunks;
        }
        String clean = text.trim();
        if (clean.isEmpty()) {
            return chunks;
        }
        int chunkSize = size > 0 ? size : 500;
        int chunkOverlap = Math.max(0, Math.min(overlap, chunkSize - 1));
        int start = 0;
        while (start < clean.length()) {
            int end = Math.min(start + chunkSize, clean.length());
            chunks.add(clean.substring(start, end));
            if (end >= clean.length()) {
                break;
            }
            start = end - chunkOverlap;
        }
        return chunks;
    }

    private String toSourcesJson(List<KnowledgeChunks> chunks) {
        if (chunks == null || chunks.isEmpty()) {
            return "[]";
        }
        List<ChatResponse.ChatSource> sources = chunks.stream()
                .map(c -> ChatResponse.ChatSource.builder()
                        .title(c.getTitle())
                        .content(c.getContent())
                        .build())
                .collect(Collectors.toList());
        return JSONUtil.toJsonStr(sources);
    }

    private List<ChatResponse.ChatSource> parseSources(String json) {
        if (json == null || json.isBlank()) {
            return new ArrayList<>();
        }
        try {
            return JSONUtil.toList(json, ChatResponse.ChatSource.class);
        } catch (Exception e) {
            log.warn("解析引用来源失败: {}", e.getMessage());
            return new ArrayList<>();
        }
    }

    private String buildTitle(String question) {
        String q = question.replaceAll("\\s+", " ").trim();
        return q.length() > 20 ? q.substring(0, 20) + "..." : q;
    }

    private ChatSession loadOwnedSession(Long sessionId) {
        ChatSession session = chatSessionMapper.selectById(sessionId);
        if (session == null) {
            throw new BusinessException("会话不存在");
        }
        Long userId = UserHolder.getUserId();
        if (userId != null && session.getUserId() != null && !session.getUserId().equals(userId)) {
            throw new BusinessException(ErrorCode.FORBIDDEN, "无权访问该会话");
        }
        return session;
    }

    private ChatSessionVO toSessionVO(ChatSession s) {
        return ChatSessionVO.builder()
                .id(String.valueOf(s.getId()))
                .title(s.getTitle())
                .updatedAt(s.getUpdatedAt() != null ? String.valueOf(s.getUpdatedAt()) : null)
                .build();
    }

    private ChatMessageVO toMessageVO(ChatMessage m) {
        return ChatMessageVO.builder()
                .role(m.getRole())
                .content(m.getContent())
                .sources(parseSources(m.getSources()))
                .createdAt(m.getCreatedAt() != null ? String.valueOf(m.getCreatedAt()) : null)
                .build();
    }
}
