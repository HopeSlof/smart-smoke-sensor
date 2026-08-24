package com.cqu.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

/**
 * 大模型配置 — 读取 llm.* 属性并注册 RestTemplate
 */
@Data
@Configuration
@ConfigurationProperties(prefix = "llm")
public class LlmConfig {

    /** OpenAI 兼容 API Key */
    private String apiKey;

    /** OpenAI 兼容 API 地址 */
    private String baseUrl;

    /** 模型名称 */
    private String model;

    /** Embedding API Key */
    private String embeddingApiKey;

    /** Embedding API 地址 */
    private String embeddingBaseUrl;

    /** Embedding 模型名称 */
    private String embeddingModel;

    /** RAG 检索返回的相似文档数量 */
    private int topK = 3;

    /** 知识文档切分块大小（字符数） */
    private int chunkSize = 500;

    /** 知识文档切分重叠字符数 */
    private int chunkOverlap = 50;

    /** 多轮对话携带的历史消息条数 */
    private int maxHistory = 6;

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}
