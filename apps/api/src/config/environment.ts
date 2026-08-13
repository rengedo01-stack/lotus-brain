const nodeEnvironments = ["development", "production", "test"] as const;
const logLevels = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

type NodeEnvironment = (typeof nodeEnvironments)[number];
type LogLevel = (typeof logLevels)[number];

export type EnvironmentVariables = {
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

  if (corsOrigin.split(",").some((origin) => origin.trim().length === 0)) {
    throw new Error("CORS_ORIGIN must be a comma-separated list of non-empty origins.");
  }

  const logLevel = readLogLevel(environment.LOG_LEVEL, nodeEnvironment);
  const smtp = readSmtpConfiguration(environment, nodeEnvironment);

  return {
    CORS_ORIGIN: corsOrigin,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: logLevel,
    NODE_ENV: nodeEnvironment,
    PORT: port,
    PUBLIC_WEB_BASE_URL: publicWebBaseUrl,
    ...smtp,
  };
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
