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

  if (corsOrigin.split(",").some((origin) => origin.trim().length === 0)) {
    throw new Error("CORS_ORIGIN must be a comma-separated list of non-empty origins.");
  }

  const logLevel = readLogLevel(environment.LOG_LEVEL, nodeEnvironment);

  return {
    CORS_ORIGIN: corsOrigin,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: logLevel,
    NODE_ENV: nodeEnvironment,
    PORT: port,
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
