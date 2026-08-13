import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ApprovalStatus, DocumentType } from "@prisma/client";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import { extname } from "node:path";
import { PrismaService } from "../database/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AIProvider } from "../providers/ai-provider";
import { decodeUtf8 } from "../text/unicode";

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject("AI_PROVIDER") private readonly ai: AIProvider,
  ) {}
  private json(value: unknown): any {
    return JSON.parse(JSON.stringify(value));
  }
  private extracted(value: unknown, originalText: string) {
    const item =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : { content: value };
    const content = typeof item.content === "string" ? item.content.trim() : "";
    const excerpt =
      typeof item.sourceExcerpt === "string" &&
      originalText.includes(item.sourceExcerpt)
        ? item.sourceExcerpt
        : content && originalText.includes(content)
          ? content
          : undefined;
    const confidence =
      typeof item.confidence === "number"
        ? Math.max(0, Math.min(1, item.confidence))
        : undefined;
    return content ? { content, sourceText: excerpt, confidence } : null;
  }
  private async text(file: Express.Multer.File) {
    const ext = extname(file.originalname).toLowerCase();
    if (ext === ".txt") {
      try {
        return decodeUtf8(file.buffer);
      } catch (error) {
        if (error instanceof TypeError) {
          throw new BadRequestException(
            "TXT knowledge documents must be valid UTF-8.",
          );
        }
        throw error;
      }
    }
    if (ext === ".pdf") return (await pdf(file.buffer)).text;
    if (ext === ".docx")
      return (await mammoth.extractRawText({ buffer: file.buffer })).value;
    throw new BadRequestException(
      "Only TXT, PDF and DOCX knowledge documents are accepted",
    );
  }
  async upload(projectId: string, file: Express.Multer.File) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException("Project not found");
    const originalText = await this.text(file);
    if (!originalText.trim())
      throw new BadRequestException(
        "No text could be extracted from this document",
      );
    const stored = await this.storage.put(
      file.buffer,
      file.originalname,
      file.mimetype,
      "knowledge",
    );
    const initial = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          type: DocumentType.KNOWLEDGE_SOURCE,
          name: file.originalname,
          url: stored.url,
          mimeType: file.mimetype,
          originalText,
          projectId,
        },
      });
      const knowledge = await tx.projectKnowledge.create({
        data: {
          projectId,
          originalText,
          sourceDocumentId: document.id,
          structured: this.json({ extractionPending: true }),
          approvalStatus: ApprovalStatus.PENDING,
        },
      });
      return { document, knowledge };
    });
    let structured: Record<string, unknown>;
    try { structured = await this.ai.extractKnowledge(originalText); }
    catch { structured = { extractionUnavailable: true }; }
    return this.prisma.$transaction(async (tx) => {
      const knowledge = await tx.projectKnowledge.update({ where: { id: initial.knowledge.id }, data: { structured: this.json(structured) } });
      for (const [category, value] of Object.entries(structured)) {
        if (category === "extractionUnavailable") continue;
        const values = Array.isArray(value) ? value : [value];
        for (const entry of values) {
          const extracted = this.extracted(entry, originalText);
          if (extracted)
            await tx.projectKnowledgeItem.create({
              data: {
                projectId,
                category,
                ...extracted,
                sourceDocumentId: initial.document.id,
                approvalStatus: ApprovalStatus.PENDING,
              },
            });
        }
      }
      return {
        document: initial.document,
        knowledge,
        extractionAvailable: !(structured as Record<string, unknown>)
          .extractionUnavailable,
      };
    });
  }
  async paste(projectId: string, originalText: string) {
    const structured = await this.ai.extractKnowledge(originalText);
    const knowledge = await this.prisma.projectKnowledge.create({
      data: {
        projectId,
        originalText,
        structured: this.json(structured),
        approvalStatus: ApprovalStatus.PENDING,
      },
    });
    for (const [category, value] of Object.entries(structured)) {
      if (category === "extractionUnavailable") continue;
      const entries = (Array.isArray(value) ? value : [value])
        .map((entry) => this.extracted(entry, originalText))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      if (entries.length)
        await this.prisma.projectKnowledgeItem.createMany({
          data: entries.map((entry) => ({
            projectId,
            category,
            ...entry,
            approvalStatus: ApprovalStatus.PENDING,
          })),
        });
    }
    return knowledge;
  }
  list(projectId: string) {
    return this.prisma.projectKnowledge.findMany({
      where: { projectId },
      include: { project: true },
      orderBy: { createdAt: "desc" },
    });
  }
  items(projectId: string) {
    return this.prisma.projectKnowledgeItem.findMany({
      where: { projectId },
      include: { sourceDocument: true },
      orderBy: [{ approvalStatus: "asc" }, { category: "asc" }],
    });
  }
  async updateItem(
    id: string,
    content: string,
    approvalStatus: ApprovalStatus | undefined,
    adminUserId: string,
  ) {
    return this.prisma.projectKnowledgeItem.update({
      where: { id },
      data: {
        content,
        approvalStatus,
        ...(approvalStatus === ApprovalStatus.APPROVED
          ? { approvedByAdminId: adminUserId, approvedAt: new Date() }
          : {}),
      },
    });
  }
  async approve(id: string, adminUserId: string) {
    const knowledge = await this.prisma.projectKnowledge.update({
      where: { id },
      data: { approvalStatus: ApprovalStatus.APPROVED, approvedAt: new Date() },
    });
    await this.prisma.projectKnowledgeItem.updateMany({
      where: {
        projectId: knowledge.projectId,
        approvalStatus: ApprovalStatus.PENDING,
      },
      data: {
        approvalStatus: ApprovalStatus.APPROVED,
        approvedByAdminId: adminUserId,
        approvedAt: new Date(),
      },
    });
    return knowledge;
  }
}
