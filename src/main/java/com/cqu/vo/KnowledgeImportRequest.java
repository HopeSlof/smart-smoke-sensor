package com.cqu.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 知识库导入请求
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class KnowledgeImportRequest {

    private List<Doc> documents;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Doc {
        private String title;
        private String content;
    }
}
