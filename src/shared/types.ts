export type RequestStatus = "pending" | "answered" | "timed_out" | "cancelled" | "failed";

export type AskMode = "wait" | "async";

export type RelayProviderName = "telegram" | "slack";

export interface BackPingSettings {
  provider: RelayProviderName;
  port: number;
  authToken: string;
  telegramChatId?: string;
  telegramUsername?: string;
  telegramBotUsername?: string;
  telegramLastError?: string;
  slackUserId?: string;
  slackBotUserId?: string;
  slackTeamId?: string;
  slackTeamName?: string;
  slackLastError?: string;
  historyLimit: number;
}

export interface CreateRequestInput {
  question: string;
  cwd?: string;
  agent?: string;
  context?: string;
  choices?: string[];
  timeoutSeconds?: number;
  mode?: AskMode;
}

export interface BackPingRequest {
  id: string;
  question: string;
  cwd?: string;
  displayCwd?: string;
  agent: string;
  context?: string;
  choices: string[];
  status: RequestStatus;
  answer?: string;
  error?: string;
  providerMessageId?: string;
  createdAt: string;
  expiresAt?: string;
  answeredAt?: string;
  timedOutAt?: string;
  cancelledAt?: string;
}

export interface AskUserResult {
  status: RequestStatus;
  request_id: string;
  answer: string | null;
  default_used?: boolean;
  error?: string;
  created_at?: string;
  answered_at?: string;
}

export interface NotifyInput {
  message: string;
  cwd?: string;
  agent?: string;
  context?: string;
}

export interface RelayStatus {
  mcpRunning: boolean;
  provider: RelayProviderName;
  telegramConnected: boolean;
  slackConnected: boolean;
  pendingCount: number;
  port: number;
  hasTelegramToken: boolean;
  hasSlackBotToken: boolean;
  hasSlackAppToken: boolean;
  telegramChatId?: string;
  telegramUsername?: string;
  telegramBotUsername?: string;
  telegramLastError?: string;
  slackUserId?: string;
  slackBotUserId?: string;
  slackTeamId?: string;
  slackTeamName?: string;
  slackLastError?: string;
}

export interface ProviderSendResult {
  providerMessageId?: string;
}

export interface NotifierProvider {
  readonly name: "telegram" | "slack";
  start(): Promise<void>;
  stop(): Promise<void>;
  isConfigured(): Promise<boolean>;
  isConnected(): boolean;
  sendRequest(request: BackPingRequest): Promise<ProviderSendResult>;
  sendNotification(input: NotifyInput): Promise<ProviderSendResult>;
}
