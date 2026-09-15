/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { PurchaseDraftValidationError } from "../application/purchase-draft.errors";

export type PurchaseDraftInput = { supplierId: string; purchaseDate: string; documentNumber?: string; note?: string; items: { productId: string; unitId: string; quantity: string; unitPrice: string; taxRate: string }[] };
export type PurchaseDraftMetadataInput = { documentNumber?: string | null; note?: string | null };
export type PurchaseDraftView = { id: string; supplier: { id: string; code: string; name: string }; status: string; purchaseDate: Date; documentNumber: string | null; note: string | null; subtotal: string; tax: string; total: string; postedAt: Date | null; createdAt: Date; updatedAt: Date; items: { id: string; lineNumber: number; productId: string; unitId: string; quantity: string; unitPrice: string; taxRate: string; lineAmount: string }[] };
export type PurchaseCancellationView = { id: string; status: "CANCELLED"; cancelledAt: Date; cancellationReason: string };
export interface PurchaseDraftRepository { create(input: PurchaseDraftInput): Promise<PurchaseDraftView>; get(id: string): Promise<PurchaseDraftView | null>; updateDraft(id: string, input: PurchaseDraftInput): Promise<PurchaseDraftView | "NOT_FOUND" | "CONFLICT">; updateMetadata(id: string, input: PurchaseDraftMetadataInput): Promise<PurchaseDraftView | "NOT_FOUND" | "CONFLICT">; confirm(id: string): Promise<PurchaseDraftView | "NOT_FOUND" | "CONFLICT">; cancel(id: string, reason: string, actorUserId: string): Promise<PurchaseCancellationView | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN">; }
export const PURCHASE_DRAFT_REPOSITORY = Symbol("PURCHASE_DRAFT_REPOSITORY");

@Injectable()
export class PrismaPurchaseDraftRepository implements PurchaseDraftRepository {
  constructor(private readonly prisma: PrismaService) {}
  async create(input: PurchaseDraftInput): Promise<PurchaseDraftView> { return this.prisma.$transaction(async tx => this.write(tx, input)); }
  async get(id: string): Promise<PurchaseDraftView | null> { const p = await this.prisma.purchase.findUnique({ where: { id }, include: { supplier: true, items: { orderBy: { lineNumber: "asc" } } } }); return p ? this.view(p) : null; }
  async updateDraft(id: string, input: PurchaseDraftInput): Promise<PurchaseDraftView | "NOT_FOUND" | "CONFLICT"> { return this.prisma.$transaction(async tx => { await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PurchaseItem" WHERE "purchaseId"=${id} ORDER BY "id" FOR NO KEY UPDATE`); const rows = await tx.$queryRaw<{status:string}[]>(Prisma.sql`SELECT "status" FROM "Purchase" WHERE "id"=${id} FOR UPDATE`); if (!rows[0]) return "NOT_FOUND"; if (rows[0].status !== "DRAFT") return "CONFLICT"; const handoff = await tx.recommendationPurchaseHandoff.findFirst({ where: { purchaseItem: { purchaseId: id } }, select: { id: true } }); if (handoff !== null) return "CONFLICT"; await tx.purchaseItem.deleteMany({ where: { purchaseId: id } }); return this.write(tx, input, id); }); }
  async updateMetadata(id: string, input: PurchaseDraftMetadataInput): Promise<PurchaseDraftView | "NOT_FOUND" | "CONFLICT"> { return this.prisma.$transaction(async tx => { const rows = await tx.$queryRaw<{status:string}[]>(Prisma.sql`SELECT "status" FROM "Purchase" WHERE "id"=${id} FOR UPDATE`); if (!rows[0]) return "NOT_FOUND"; if (rows[0].status !== "DRAFT") return "CONFLICT"; await tx.purchase.update({ where: { id }, data: { ...(input.documentNumber !== undefined ? { documentNumber: input.documentNumber } : {}), ...(input.note !== undefined ? { note: input.note } : {}) } }); return this.getFrom(tx,id) as Promise<PurchaseDraftView>; }); }
  async confirm(id: string): Promise<PurchaseDraftView | "NOT_FOUND" | "CONFLICT"> { return this.prisma.$transaction(async tx => { await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PurchaseItem" WHERE "purchaseId"=${id} ORDER BY "id" FOR NO KEY UPDATE`); const rows=await tx.$queryRaw<{status:string}[]>(Prisma.sql`SELECT "status" FROM "Purchase" WHERE "id"=${id} FOR UPDATE`); if(!rows[0]) return "NOT_FOUND"; if(rows[0].status!=="DRAFT") return "CONFLICT"; const p=await this.getFrom(tx,id); if(!p || p.items.length===0) throw new PurchaseDraftValidationError("A purchase must have at least one item."); await tx.purchase.update({where:{id},data:{status:"CONFIRMED"}}); await tx.purchaseLog.create({data:{purchaseId:id,eventType:"STATUS_CHANGED",fromStatus:"DRAFT",toStatus:"CONFIRMED"}}); return this.getFrom(tx,id) as Promise<PurchaseDraftView>; }); }
  async cancel(id: string, reason: string, actorUserId: string): Promise<PurchaseCancellationView | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN"> { return this.prisma.$transaction(async tx => {
    // This matches confirm/post's item -> Purchase lock order, so only one
    // lifecycle transition can observe a given state.
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "PurchaseItem" WHERE "purchaseId"=${id} ORDER BY "id" FOR NO KEY UPDATE`);
    const rows = await tx.$queryRaw<{ status: "DRAFT" | "CONFIRMED" | "POSTED" | "CANCELLED" }[]>(Prisma.sql`SELECT "status" FROM "Purchase" WHERE "id"=${id} FOR UPDATE`);
    const purchase = rows[0];
    if (purchase === undefined) return "NOT_FOUND";
    if (purchase.status !== "DRAFT" && purchase.status !== "CONFIRMED") return "CONFLICT";

    const requiredPermission = purchase.status === "DRAFT" ? "purchase.write" : "purchase.confirm";
    const permissionRows = await tx.$queryRaw<{ permitted: boolean }[]>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM "Permission" AS permission
        INNER JOIN "RolePermission" AS role_permission ON role_permission."permissionId" = permission."id"
        INNER JOIN "Role" AS role ON role."id" = role_permission."roleId" AND role."status" = 'ACTIVE'
        INNER JOIN "UserRole" AS user_role ON user_role."roleId" = role."id"
        WHERE user_role."userId" = ${actorUserId} AND permission."code" = ${requiredPermission}
      ) AS "permitted"
    `);
    if (permissionRows[0]?.permitted !== true) return "FORBIDDEN";

    const cancelledAt = new Date();
    await tx.purchase.update({ where: { id }, data: { status: "CANCELLED", cancelledAt, cancellationReason: reason } });
    await tx.purchaseLog.create({ data: { purchaseId: id, eventType: "STATUS_CHANGED", fromStatus: purchase.status, toStatus: "CANCELLED", note: reason, occurredAt: cancelledAt } });
    return { id, status: "CANCELLED", cancelledAt, cancellationReason: reason };
  }); }
  private async write(tx: any,input:PurchaseDraftInput,id?:string):Promise<PurchaseDraftView>{ if(!input.items.length)throw new PurchaseDraftValidationError("A purchase must have at least one item."); const supplier=await tx.supplier.findFirst({where:{id:input.supplierId,status:"ACTIVE",deletedAt:null}});if(!supplier)throw new PurchaseDraftValidationError("Supplier is not active.");const items=[];let subtotal=new Prisma.Decimal(0),tax=new Prisma.Decimal(0);for(let i=0;i<input.items.length;i++){const x=input.items[i],q=new Prisma.Decimal(x.quantity),price=new Prisma.Decimal(x.unitPrice),rate=new Prisma.Decimal(x.taxRate);if(!q.gt(0)||price.lt(0)||rate.lt(0)||rate.gt(1))throw new PurchaseDraftValidationError("Invalid purchase item amount.");const product=await tx.product.findFirst({where:{id:x.productId,status:"ACTIVE",deletedAt:null}});if(!product||product.inventoryUnitId!==x.unitId)throw new PurchaseDraftValidationError("Purchase item must use an active product inventory unit.");const amount=q.mul(price);subtotal=subtotal.add(amount);tax=tax.add(amount.mul(rate));items.push({productId:x.productId,unitId:x.unitId,lineNumber:i+1,quantity:q,unitPrice:price,lineAmount:amount,taxRate:rate});}const data={supplierId:input.supplierId,purchaseDate:new Date(input.purchaseDate),documentNumber:input.documentNumber??null,note:input.note??null,subtotal,tax,total:subtotal.add(tax)};const p=id?await tx.purchase.update({where:{id},data:{...data,items:{create:items}},include:{supplier:true,items:{orderBy:{lineNumber:"asc"}}}}):await tx.purchase.create({data:{...data,status:"DRAFT",items:{create:items}},include:{supplier:true,items:{orderBy:{lineNumber:"asc"}}}});return this.view(p); }
  private async getFrom(tx:any,id:string):Promise<PurchaseDraftView|null>{const p=await tx.purchase.findUnique({where:{id},include:{supplier:true,items:{orderBy:{lineNumber:"asc"}}}});return p?this.view(p):null;}
  private view(p:any):PurchaseDraftView{return {id:p.id,supplier:{id:p.supplier.id,code:p.supplier.code,name:p.supplier.name},status:p.status,purchaseDate:p.purchaseDate,documentNumber:p.documentNumber,note:p.note,subtotal:p.subtotal.toString(),tax:p.tax.toString(),total:p.total.toString(),postedAt:p.postedAt,createdAt:p.createdAt,updatedAt:p.updatedAt,items:p.items.map((x:any)=>({id:x.id,lineNumber:x.lineNumber,productId:x.productId,unitId:x.unitId,quantity:x.quantity.toString(),unitPrice:x.unitPrice.toString(),taxRate:x.taxRate.toString(),lineAmount:x.lineAmount.toString()}))};}
}
