import fs from 'fs';
import path from 'path';

const LOG_FILE = path.resolve(process.cwd(), 'debug.log');

export enum LogLevel {
  DEBUG,
  INFO,
  WARN,
  ERROR
}

// Default level
let currentLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel) {
  currentLevel = level;
}

function formatMessage(level: string, message: string, data?: any): string {
  const timestamp = new Date().toISOString();
  let logLine = `[${timestamp}] [${level}] ${message}`;
  if (data) {
    try {
      logLine += `\n${JSON.stringify(data, null, 2)}`;
    } catch (e) {
      logLine += `\n[Circular or Non-Serializable Data]`;
    }
  }
  return logLine + '\n';
}

export function log(level: LogLevel, message: string, data?: any) {
  if (level < currentLevel) return;

  const levelName = LogLevel[level];
  const logLine = formatMessage(levelName, message, data);

  // Always write to stdio (stderr) for MCP inspector visibility
  // MCP protocol uses stderr for logs
  console.error(`[${levelName}] ${message}`);

  // Also write to file for persistence
  try {
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (error) {
    // Fail silently if can't write to file
  }
}

export const logger = {
  debug: (msg: string, data?: any) => log(LogLevel.DEBUG, msg, data),
  info: (msg: string, data?: any) => log(LogLevel.INFO, msg, data),
  warn: (msg: string, data?: any) => log(LogLevel.WARN, msg, data),
  error: (msg: string, data?: any) => log(LogLevel.ERROR, msg, data),
};
