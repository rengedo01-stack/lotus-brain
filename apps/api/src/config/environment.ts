const nodeEnvironments = ["development", "production", "test"] as const;
const logLevels = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

type NodeEnvironment = (typeof nodeEnvironments)[number];
type LogLevel = (typeof logLevels)[number];

export type EnvironmentVariables = {
  CSRF_LEGACY_SCALAR_FALLBACK: boolean;
  CORS_ORIGIN: string;
  DATABASE_URL: string;
  LOG_LEVEL: LogLevel;
  NODE_ENV: NodeEnvironment;
  PORT: number;
  PUBLIC_WEB_BASE_URL: string;
  SMTP_FROM?: string;
  SMTP_HOST?: string;
  SMTP_PASSWORD?: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER?: string;
  WEBAUTHN_ORIGIN: string;
  WEBAUTHN_RP_ID: string;
  WEBAUTHN_RP_NAME: string;
};

export function validateEnvironment(
  environment: Record<string, unknown>,
): EnvironmentVariables {
  const nodeEnvironment = readNodeEnvironment(environment.NODE_ENV);
  const port = readPort(environment.PORT);
  const corsOrigin = readNonEmptyString(
    environment.CORS_ORIGIN,
    "CORS_ORIGIN",
    "http://localhost:3000",
  );
  const databaseUrl = readNonEmptyString(environment.DATABASE_URL, "DATABASE_URL");
  const publicWebBaseUrl = readPublicWebBaseUrl(environment.PUBLIC_WEB_BASE_URL, nodeEnvironment);
  const webAuthn = readWebAuthnConfiguration(environment, nodeEnvironment, publicWebBaseUrl);

  if (corsOrigin.split(",").some((origin) => origin.trim().length === 0)) {
    throw new Error("CORS_ORIGIN must be a comma-separated list of non-empty origins.");
  }

  const logLevel = readLogLevel(environment.LOG_LEVEL, nodeEnvironment);
  const smtp = readSmtpConfiguration(environment, nodeEnvironment);
  const csrfLegacyScalarFallback = readBoolean(
    environment.CSRF_LEGACY_SCALAR_FALLBACK,
    "CSRF_LEGACY_SCALAR_FALLBACK",
    false,
  );

  return {
    CSRF_LEGACY_SCALAR_FALLBACK: csrfLegacyScalarFallback,
    CORS_ORIGIN: corsOrigin,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: logLevel,
    NODE_ENV: nodeEnvironment,
    PORT: port,
    PUBLIC_WEB_BASE_URL: publicWebBaseUrl,
    ...webAuthn,
    ...smtp,
  };
}

function readWebAuthnConfiguration(
  environment: Record<string, unknown>,
  nodeEnvironment: NodeEnvironment,
  publicWebBaseUrl: string,
): Pick<EnvironmentVariables, "WEBAUTHN_ORIGIN" | "WEBAUTHN_RP_ID" | "WEBAUTHN_RP_NAME"> {
  const isProduction = nodeEnvironment === "production";
  const rpName = readNonEmptyString(environment.WEBAUTHN_RP_NAME, "WEBAUTHN_RP_NAME", isProduction ? undefined : "Lotus BRAIN");
  const configuredOrigin = readNonEmptyString(
    environment.WEBAUTHN_ORIGIN,
    "WEBAUTHN_ORIGIN",
    isProduction ? undefined : publicWebBaseUrl,
  );
  let origin: URL;
  try {
    origin = new URL(configuredOrigin);
  } catch {
    throw new Error("WEBAUTHN_ORIGIN must be a valid absolute origin.");
  }
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "http:" && origin.protocol !== "https:")
  ) {
    throw new Error("WEBAUTHN_ORIGIN must be an HTTP(S) origin without a path, credentials, query, or fragment.");
  }
  if (isProduction && origin.protocol !== "https:") {
    throw new Error("WEBAUTHN_ORIGIN must use HTTPS in production.");
  }
  if (!isProduction && origin.protocol === "http:" && !isLocalWebAuthnHost(origin.hostname)) {
    throw new Error("Non-production HTTP WEBAUTHN_ORIGIN is permitted only for localhost.");
  }

  const rpId = readNonEmptyString(
    environment.WEBAUTHN_RP_ID,
    "WEBAUTHN_RP_ID",
    isProduction ? undefined : origin.hostname === "localhost" ? "localhost" : undefined,
  ).toLowerCase();
  if (!isValidRpId(rpId) || !(origin.hostname === rpId || origin.hostname.endsWith(`.${rpId}`))) {
    throw new Error("WEBAUTHN_RP_ID must be a configured registrable suffix of WEBAUTHN_ORIGIN.");
  }
  if (rpId === "localhost" && origin.hostname !== "localhost") {
    throw new Error("WEBAUTHN_RP_ID localhost is valid only with a localhost origin.");
  }

  return {
    WEBAUTHN_RP_NAME: rpName,
    WEBAUTHN_RP_ID: rpId,
    WEBAUTHN_ORIGIN: origin.origin,
  };
}

function isLocalWebAuthnHost(hostname: string): boolean {
  return hostname === "localhost";
}

function isValidRpId(value: string): boolean {
  return value === "localhost" || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value);
}

function readNodeEnvironment(value: unknown): NodeEnvironment {
  const nodeEnvironment = readNonEmptyString(value, "NODE_ENV", "development");

  if (nodeEnvironments.includes(nodeEnvironment as NodeEnvironment)) {
    return nodeEnvironment as NodeEnvironment;
  }

  throw new Error(`NODE_ENV must be one of: ${nodeEnvironments.join(", ")}.`);
}

function readPort(value: unknown): number {
  const port = Number(value ?? 3001);

  if (Number.isInteger(port) && port >= 1 && port <= 65535) {
    return port;
  }

  throw new Error("PORT must be an integer between 1 and 65535.");
}

function readLogLevel(value: unknown, nodeEnvironment: NodeEnvironment): LogLevel {
  const defaultLevel = nodeEnvironment === "production" ? "info" : "debug";
  const logLevel = readNonEmptyString(value, "LOG_LEVEL", defaultLevel);

  if (logLevels.includes(logLevel as LogLevel)) {
    return logLevel as LogLevel;
  }

  throw new Error(`LOG_LEVEL must be one of: ${logLevels.join(", ")}.`);
}

function readNonEmptyString(
  value: unknown,
  variableName: string,
  defaultValue?: string,
): string {
  if (value === undefined && defaultValue !== undefined) {
    return defaultValue;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new Error(`${variableName} must be a non-empty string.`);
}

function readPublicWebBaseUrl(value: unknown, nodeEnvironment: NodeEnvironment): string {
  const candidate = readNonEmptyString(value, "PUBLIC_WEB_BASE_URL", "http://localhost:3000");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("PUBLIC_WEB_BASE_URL must be a valid absolute URL.");
  }
  if (url.username || url.password || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("PUBLIC_WEB_BASE_URL must be an HTTP(S) URL without credentials.");
  }
  if (nodeEnvironment === "production" && url.protocol !== "https:") {
    throw new Error("PUBLIC_WEB_BASE_URL must use HTTPS in production.");
  }
  return url.toString();
}

function readSmtpConfiguration(
  environment: Record<string, unknown>,
  nodeEnvironment: NodeEnvironment,
): Pick<EnvironmentVariables, "SMTP_FROM" | "SMTP_HOST" | "SMTP_PASSWORD" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_USER"> {
  const isProduction = nodeEnvironment === "production";
  const host = readOptionalNonEmptyString(environment.SMTP_HOST, "SMTP_HOST", isProduction);
  const user = readOptionalNonEmptyString(environment.SMTP_USER, "SMTP_USER", isProduction);
  const password = readOptionalNonEmptyString(environment.SMTP_PASSWORD, "SMTP_PASSWORD", isProduction);
  const from = readOptionalNonEmptyString(environment.SMTP_FROM, "SMTP_FROM", isProduction);
  const port = readSmtpPort(environment.SMTP_PORT, isProduction);
  const secure = readBoolean(environment.SMTP_SECURE, "SMTP_SECURE", isProduction ? undefined : false);

  if (isProduction && !secure && port === 465) {
    throw new Error("SMTP_SECURE must be true when SMTP_PORT is 465.");
  }

  return {
    SMTP_FROM: from,
    SMTP_HOST: host,
    SMTP_PASSWORD: password,
    SMTP_PORT: port,
    SMTP_SECURE: secure,
    SMTP_USER: user,
  };
}

function readOptionalNonEmptyString(value: unknown, variableName: string, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  return readNonEmptyString(value, variableName);
}

function readSmtpPort(value: unknown, required: boolean): number {
  if (value === undefined && !required) return 587;
  const port = Number(value);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  throw new Error("SMTP_PORT must be an integer between 1 and 65535.");
}

function readBoolean(value: unknown, variableName: string, defaultValue?: boolean): boolean {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  throw new Error(`${variableName} must be true or false.`);
}
