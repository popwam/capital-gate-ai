import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ApprovalStatus, DocumentType } from "@prisma/client";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import { extname } from "node:path";
import { PrismaService } from "../database/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AIProvider } from "../providers/ai-provider";

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, @Inject("AI_PROVIDER") private readonly ai: AIProvider) {}
  private json(value: unknown): any { return JSON.parse(JSON.stringify(value)); }
  private async text(file: Express.Multer.File) {
    const ext = extname(file.originalname).toLowerCase();
    if (ext === ".txt") return file.buffer.toString("utf8");
    if (ext === ".pdf") return (await pdf(file.buffer)).text;
    if (ext === ".docx") return (await mammoth.extractRawText({ buffer: file.buffer })).value;
    throw new BadRequestException("Only TXT, PDF and DOCX knowledge documents are accepted");
  }
  async upload(projectId: string, file: Express.Multer.File) { const project = await this.prisma.project.findUnique({ where: { id: projectId } }); if (!project) throw new NotFoundException("Project not found"); const originalText = await this.text(file); if (!originalText.trim()) throw new BadRequestException("No text could be extracted from this document"); const stored = await this.storage.put(file.buffer, file.originalname, file.mimetype, "knowledge"); const structured = await this.ai.extractKnowledge(originalText); return this.prisma.$transaction(async tx => { const document = await tx.document.create({ data: { type: DocumentType.KNOWLEDGE_SOURCE, name: file.originalname, url: stored.url, mimeType: file.mimetype, originalText, projectId } }); const knowledge = await tx.projectKnowledge.create({ data: { projectId, originalText, sourceDocumentId: document.id, structured: this.json(structured), approvalStatus: ApprovalStatus.PENDING } }); for (const [category, value] of Object.entries(structured)) { const values = Array.isArray(value) ? value : [value]; for (const entry of values) if (entry != null && String(entry).trim()) await tx.projectKnowledgeItem.create({ data: { projectId, category, content: typeof entry === "string" ? entry : JSON.stringify(entry), sourceDocumentId: document.id, sourceText: originalText.slice(0, 2_000), approvalStatus: ApprovalStatus.PENDING } }); } return { document, knowledge }; }); }
  async paste(projectId: string, originalText: string) { const structured = await this.ai.extractKnowledge(originalText); const knowledge = await this.prisma.projectKnowledge.create({ data: { projectId, originalText, structured: this.json(structured), approvalStatus: ApprovalStatus.PENDING } }); for (const [category,value] of Object.entries(structured)) { const entries = Array.isArray(value) ? value : [value]; await this.prisma.projectKnowledgeItem.createMany({ data: entries.filter(Boolean).map(entry => ({ projectId, category, content: typeof entry === "string" ? entry : JSON.stringify(entry), sourceText: originalText.slice(0, 2000), approvalStatus: ApprovalStatus.PENDING })) }); } return knowledge; }
  list(projectId: string) { return this.prisma.projectKnowledge.findMany({ where: { projectId }, include: { project: true }, orderBy: { createdAt: "desc" } }); }
  items(projectId: string) { return this.prisma.projectKnowledgeItem.findMany({ where: { projectId }, include: { sourceDocument: true }, orderBy: [{ approvalStatus: "asc" }, { category: "asc" }] }); }
  async updateItem(id: string, content: string, approvalStatus?: ApprovalStatus) { return this.prisma.projectKnowledgeItem.update({ where: { id }, data: { content, approvalStatus } }); }
  async approve(id: string) { const knowledge = await this.prisma.projectKnowledge.update({ where: { id }, data: { approvalStatus: ApprovalStatus.APPROVED, approvedAt: new Date() } }); await this.prisma.projectKnowledgeItem.updateMany({ where: { projectId: knowledge.projectId, approvalStatus: ApprovalStatus.PENDING }, data: { approvalStatus: ApprovalStatus.APPROVED } }); return knowledge; }
}
