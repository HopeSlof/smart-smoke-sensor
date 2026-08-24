package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * RAG 问答返回（回答 + 引用来源）
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChatResponse {

    /** 大模型回答 */
    private String answer;

    /** 会话 ID（供前端后续多轮对话续用） */
    private Long sessionId;

    /** 命中的知识来源片段 */
    private List<ChatSource> sources;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ChatSource {
        private String title;
        private String content;
    }
}
