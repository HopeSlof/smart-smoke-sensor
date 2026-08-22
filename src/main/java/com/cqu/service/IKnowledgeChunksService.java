package com.cqu.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.cqu.entity.KnowledgeChunks;
import com.cqu.vo.KnowledgeImportRequest;

/**
 * RAG 知识库问答服务
 */
public interface IKnowledgeChunksService extends IService<KnowledgeChunks> {

    /** 基于 RAG 的警情/应急预案问答 */
    String ask(String question);

    /** 导入知识文档（向量化并存储） */
    int importDocuments(KnowledgeImportRequest request);
}
