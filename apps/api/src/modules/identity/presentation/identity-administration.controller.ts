import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../auth/auth.types";
import {
  IdentityAdministrationConflictError,
  IdentityAdministrationForbiddenError,
  IdentityAdministrationNotFoundError,
  IdentityAdministrationValidationError,
} from "../application/identity-administration.errors";
import { IdentityAdministrationService } from "../application/identity-administration.service";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import { ListIdentityUsersQueryDto, UpdateIdentityUserStatusDto } from "./dto/identity-user.dto";

@ApiTags("identity")
@ApiCookieAuth()
@Controller("identity")
export class IdentityAdministrationController {
  constructor(private readonly identityAdministrationService: IdentityAdministrationService) {}

  @Get("users")
  @RequirePermissions(Permissions.IDENTITY_READ)
  @ApiOperation({ summary: "List user identity records, including soft-deleted users" })
  listUsers(@Query() query: ListIdentityUsersQueryDto) {
    return this.run(() => this.identityAdministrationService.listUsers({
      email: query.email,
      status: query.status,
      deleted: query.deleted,
      limit: query.limit,
      offset: query.offset,
    }));
  }

  @Get("users/:id")
  @RequirePermissions(Permissions.IDENTITY_READ)
  @ApiOperation({ summary: "Get a user identity record" })
  getUser(@Param("id") userId: string) {
    return this.run(() => this.identityAdministrationService.getUser(userId));
  }

  @Patch("users/:id")
  @RequirePermissions(Permissions.IDENTITY_MANAGE)
  @ApiOperation({ summary: "Transition a non-system user's lifecycle status" })
  updateUserStatus(
    @Req() request: AuthenticatedRequest,
    @Param("id") userId: string,
    @Body() dto: UpdateIdentityUserStatusDto,
  ) {
    return this.run(() => this.identityAdministrationService.updateUserStatus(userId, {
      actorUserId: this.actorUserId(request),
      status: dto.status,
    }));
  }

  @Delete("users/:id")
  @RequirePermissions(Permissions.IDENTITY_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Soft-delete a non-system user without removing history" })
  softDeleteUser(@Req() request: AuthenticatedRequest, @Param("id") userId: string) {
    return this.run(() => this.identityAdministrationService.softDeleteUser(
      userId,
      this.actorUserId(request),
    ));
  }

  private actorUserId(request: AuthenticatedRequest): string {
    if (request.authUser === undefined) throw new UnauthorizedException("Authentication required.");
    return request.authUser.id;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof IdentityAdministrationNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof IdentityAdministrationConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof IdentityAdministrationForbiddenError) {
        throw new ForbiddenException(error.message);
      }
      if (error instanceof IdentityAdministrationValidationError) {
        throw new UnprocessableEntityException(error.message);
      }
      if (this.isPrismaKnownError(error)) {
        if (error.code === "P2025") throw new NotFoundException("User was not found.");
        if (error.code === "P2002") throw new ConflictException("A unique identity record already exists.");
        if (error.code === "P2003") throw new UnprocessableEntityException("An identity relationship is invalid.");
      }
      throw error;
    }
  }

  private isPrismaKnownError(error: unknown): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error
      && typeof (error as { code?: unknown }).code === "string";
  }
}
