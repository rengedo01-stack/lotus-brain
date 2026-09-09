import { BadRequestException, Controller, Get, Header, NotFoundException, Param, Query } from "@nestjs/common";
import { ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { InventoryTransactionType } from "../../../generated/prisma/client";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import { InventoryReadNotFoundError } from "../application/inventory-read.errors";
import { ListCurrentInventoryUseCase, ListInventoryHistoryUseCase, ListInventorySupplyContextUseCase } from "../application/inventory-read.use-cases";
import type { CurrentInventoryCursor, InventoryHistoryCursor } from "../application/inventory-read.repository";
import { ListCurrentInventoryQueryDto } from "./dto/list-current-inventory-query.dto";
import { ListInventoryHistoryQueryDto } from "./dto/list-inventory-history-query.dto";
import { currentInventoryPageResponseSchema, inventoryHistoryPageResponseSchema, inventorySupplyContextPageResponseSchema } from "./inventory-response.schemas";

type CurrentCursorPayload = { v: 1; productCode: string; productId: string; filterProductCode: string | null };
type HistoryCursorPayload = {
  v: 1;
  occurredAt: string;
  id: string;
  type: InventoryTransactionType | null;
  from: string | null;
  to: string | null;
};

@ApiTags("inventory")
@ApiCookieAuth()
@Controller("inventory")
export class InventoryController {
  constructor(
    private readonly listCurrentInventoryUseCase: ListCurrentInventoryUseCase,
    private readonly listInventoryHistoryUseCase: ListInventoryHistoryUseCase,
    private readonly listInventorySupplyContextUseCase: ListInventorySupplyContextUseCase,
  ) {}

  @Get()
  @RequirePermissions(Permissions.INVENTORY_READ)
  @ApiOperation({ summary: "List current recorded inventory by product" })
  @ApiOkResponse({ description: "Current recorded inventory was returned.", schema: currentInventoryPageResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "inventory.read is required." })
  async listCurrentInventory(@Query() query: ListCurrentInventoryQueryDto) {
    const cursor = query.cursor === undefined ? undefined : this.decodeCurrentCursor(query.cursor, query.productCode);
    const page = await this.listCurrentInventoryUseCase.execute({
      productCode: query.productCode,
      limit: query.limit,
      cursor,
    });
    return {
      items: page.items,
      nextCursor: page.nextCursor === null ? null : this.encodeCurrentCursor(page.nextCursor, query.productCode),
    };
  }

  @Get("supply-context")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(Permissions.INVENTORY_READ, Permissions.PURCHASE_READ)
  @ApiOperation({ summary: "List independent current-inventory and unposted-purchase facts" })
  @ApiOkResponse({ description: "Recorded current inventory and independently reported unposted purchase quantities were returned.", schema: inventorySupplyContextPageResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "Both inventory.read and purchase.read are required." })
  async listSupplyContext(@Query() query: ListCurrentInventoryQueryDto) {
    const cursor = query.cursor === undefined ? undefined : this.decodeCurrentCursor(query.cursor, query.productCode);
    const page = await this.listInventorySupplyContextUseCase.execute({
      productCode: query.productCode,
      limit: query.limit,
      cursor,
    });
    return {
      items: page.items,
      nextCursor: page.nextCursor === null ? null : this.encodeCurrentCursor(page.nextCursor, query.productCode),
    };
  }

  @Get(":productId/history")
  @RequirePermissions(Permissions.INVENTORY_READ)
  @ApiOperation({ summary: "List a product's recorded inventory history" })
  @ApiOkResponse({ description: "Recorded inventory history was returned newest first.", schema: inventoryHistoryPageResponseSchema })
  @ApiUnauthorizedResponse({ description: "The session is missing, pending, revoked, expired, or otherwise unauthenticated." })
  @ApiForbiddenResponse({ description: "inventory.read is required." })
  async listInventoryHistory(@Param("productId") productId: string, @Query() query: ListInventoryHistoryQueryDto) {
    const from = query.from === undefined ? undefined : this.parseCanonicalTimestamp(query.from, "from");
    const to = query.to === undefined ? undefined : this.parseCanonicalTimestamp(query.to, "to");
    if (from !== undefined && to !== undefined && from > to) {
      throw new BadRequestException("from must not be later than to.");
    }
    const cursor = query.cursor === undefined
      ? undefined
      : this.decodeHistoryCursor(query.cursor, query.type, from, to);
    try {
      const page = await this.listInventoryHistoryUseCase.execute({ productId, type: query.type, from, to, limit: query.limit, cursor });
      return {
        currentInventory: page.currentInventory,
        items: page.items,
        nextCursor: page.nextCursor === null ? null : this.encodeHistoryCursor(page.nextCursor, query.type, from, to),
      };
    } catch (error: unknown) {
      if (error instanceof InventoryReadNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  private encodeCurrentCursor(cursor: CurrentInventoryCursor, filterProductCode: string | undefined): string {
    return Buffer.from(JSON.stringify({
      v: 1,
      productCode: cursor.productCode,
      productId: cursor.productId,
      filterProductCode: filterProductCode ?? null,
    } satisfies CurrentCursorPayload)).toString("base64url");
  }

  private decodeCurrentCursor(value: string, filterProductCode: string | undefined): CurrentInventoryCursor {
    const parsed = this.decodeOpaqueCursor(value);
    if (
      !hasExactlyKeys(parsed, ["v", "productCode", "productId", "filterProductCode"])
      || parsed.v !== 1
      || !isNonEmptyString(parsed.productCode)
      || !isNonEmptyString(parsed.productId)
      || !isOptionalString(parsed.filterProductCode)
      || parsed.filterProductCode !== (filterProductCode ?? null)
    ) {
      throw new BadRequestException("Invalid current inventory cursor.");
    }
    return { productCode: parsed.productCode, productId: parsed.productId };
  }

  private encodeHistoryCursor(cursor: InventoryHistoryCursor, type: InventoryTransactionType | undefined, from: Date | undefined, to: Date | undefined): string {
    const payload: HistoryCursorPayload = {
      v: 1,
      occurredAt: cursor.occurredAt.toISOString(),
      id: cursor.id,
      type: type ?? null,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
  }

  private decodeHistoryCursor(value: string, type: InventoryTransactionType | undefined, from: Date | undefined, to: Date | undefined): InventoryHistoryCursor {
    const parsed = this.decodeOpaqueCursor(value);
    if (
      !hasExactlyKeys(parsed, ["v", "occurredAt", "id", "type", "from", "to"])
      || parsed.v !== 1
      || !isNonEmptyString(parsed.occurredAt)
      || !isNonEmptyString(parsed.id)
      || !isOptionalInventoryTransactionType(parsed.type)
      || !isOptionalString(parsed.from)
      || !isOptionalString(parsed.to)
      || parsed.type !== (type ?? null)
      || parsed.from !== (from?.toISOString() ?? null)
      || parsed.to !== (to?.toISOString() ?? null)
    ) {
      throw new BadRequestException("Invalid inventory history cursor.");
    }
    return { occurredAt: this.parseCanonicalTimestamp(parsed.occurredAt, "cursor"), id: parsed.id };
  }

  private decodeOpaqueCursor(value: string): Record<string, unknown> {
    try {
      const decoded = Buffer.from(value, "base64url").toString("utf8");
      const parsed: unknown = JSON.parse(decoded);
      if (!isRecord(parsed)) throw new Error("not an object");
      return parsed;
    } catch {
      throw new BadRequestException("Invalid inventory cursor.");
    }
  }

  private parseCanonicalTimestamp(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
      throw new BadRequestException(`${field} must be a canonical UTC timestamp.`);
    }
    return parsed;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isOptionalInventoryTransactionType(value: unknown): value is InventoryTransactionType | null {
  return value === null || value === "RECEIPT" || value === "CONSUMPTION" || value === "PRODUCTION_RECEIPT" || value === "STOCKTAKE_ADJUSTMENT" || value === "MANUAL_ADJUSTMENT";
}
