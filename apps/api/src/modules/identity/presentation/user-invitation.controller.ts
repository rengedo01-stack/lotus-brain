import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../../auth/auth.types";
import { AuthValidationError } from "../../auth/auth.errors";
import { Public } from "../../auth/decorators/public.decorator";
import { RequirePermissions } from "../../authorization/decorators/require-permissions.decorator";
import { Permissions } from "../../authorization/permission.registry";
import {
  UserInvitationConflictError,
  UserInvitationCredentialInvalidError,
  UserInvitationNotFoundError,
} from "../../notification/application/user-invitation.errors";
import { notificationRequestAcceptedResponseSchema } from "../../notification/notification-response.schemas";
import { UserInvitationService } from "../application/user-invitation.service";
import {
  AcceptUserInvitationDto,
  CreateUserInvitationDto,
  ListUserInvitationsQueryDto,
} from "./dto/user-invitation.dto";

@ApiTags("identity")
@ApiCookieAuth()
@Controller("identity/invitations")
export class UserInvitationAdministrationController {
  constructor(private readonly invitations: UserInvitationService) {}

  @Post()
  @RequirePermissions(Permissions.IDENTITY_MANAGE)
  @ApiOperation({ summary: "Create an invitation without creating a User account" })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateUserInvitationDto) {
    return this.run(() => this.invitations.createInvitation(this.actorUserId(request), dto.email));
  }

  @Get()
  @RequirePermissions(Permissions.IDENTITY_MANAGE)
  @ApiOperation({ summary: "List invitations with deterministic pagination" })
  list(@Query() query: ListUserInvitationsQueryDto) {
    return this.invitations.listInvitations({ status: query.status, limit: query.limit, offset: query.offset });
  }

  @Get(":id")
  @RequirePermissions(Permissions.IDENTITY_MANAGE)
  @ApiOperation({ summary: "Get invitation state" })
  get(@Param("id") invitationId: string) {
    return this.run(() => this.invitations.getInvitation(invitationId));
  }

  @Delete(":id")
  @RequirePermissions(Permissions.IDENTITY_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel a pending invitation and invalidate its credentials" })
  cancel(@Req() request: AuthenticatedRequest, @Param("id") invitationId: string) {
    return this.run(() => this.invitations.cancelInvitation(invitationId, this.actorUserId(request)));
  }

  @Post(":id/resend")
  @RequirePermissions(Permissions.IDENTITY_MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Queue a new invitation email after the resend cooldown" })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: "The invitation resend request was accepted.",
    schema: notificationRequestAcceptedResponseSchema,
  })
  async resend(@Req() request: AuthenticatedRequest, @Param("id") invitationId: string) {
    await this.run(() => this.invitations.resendInvitation(invitationId, this.actorUserId(request)));
    return { status: "accepted" as const };
  }

  private actorUserId(request: AuthenticatedRequest): string {
    if (request.authUser === undefined) throw new UnauthorizedException("Authentication required.");
    return request.authUser.id;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof UserInvitationNotFoundError) throw new NotFoundException("Invitation was not found.");
      if (error instanceof UserInvitationConflictError) throw new ConflictException(error.message);
      throw error;
    }
  }
}

@ApiTags("auth")
@Controller("auth/invitations")
export class UserInvitationAcceptanceController {
  constructor(private readonly invitations: UserInvitationService) {}

  @Post("accept")
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: AcceptUserInvitationDto })
  @ApiOperation({ summary: "Accept an invitation and create an account; sign in separately afterwards" })
  @ApiResponse({ status: HttpStatus.OK, description: "The invitation was accepted." })
  async accept(@Body() dto: AcceptUserInvitationDto) {
    try {
      await this.invitations.acceptInvitation(dto.token, dto.password);
      return { status: "ok" as const };
    } catch (error: unknown) {
      if (error instanceof UserInvitationCredentialInvalidError) {
        throw new BadRequestException("Invitation credential is invalid or expired.");
      }
      if (error instanceof AuthValidationError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }
}
