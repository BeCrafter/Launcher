// 组件测试的数据工厂。只构造纯数据,不碰 store、不发 IPC。
//
// 默认值刻意保持「正常可用」:已配置引擎、有正文的助手消息、成功的工具结果。
// 单项测试只需覆盖自己关心的字段,其余用默认值。

import type {
  AiAssistantMessage,
  AiEngineState,
  AiImageAttachment,
  AiMention,
  AiSession,
  AiSkillInfo,
  AiTextAttachment,
  AiToolResultMessage,
  AiUsage,
  AiUserMessage
} from '@shared/ai'
import type { UpdateState } from '@shared/ipc'
import type { LauncherSettings } from '@shared/settings'
import { normalizeSettings } from '@shared/settings'

export function makeSettings(raw: Record<string, unknown> = {}): LauncherSettings {
  return normalizeSettings(raw)
}

export function makeEngineState(patch: Partial<AiEngineState> = {}): AiEngineState {
  return {
    providerId: 'anthropic',
    providerName: 'Anthropic',
    modelId: 'claude-opus-5',
    modelLabel: 'Claude Opus 5',
    hasKey: true,
    configured: true,
    contextWindow: 200_000,
    maxTokens: 64_000,
    ...patch
  }
}

export function makeSkill(patch: Partial<AiSkillInfo> = {}): AiSkillInfo {
  return {
    id: 'sk-diag',
    nameKey: 'ai.welcome.healthTitle',
    descKey: 'ai.welcome.healthDesc',
    tag: 'diagnose',
    icon: 'fa-stethoscope',
    ...patch
  }
}

export function makeUserMessage(
  patch: Partial<AiUserMessage> & { id?: string } = {}
): AiUserMessage {
  return {
    role: 'user',
    id: 'u1',
    blocks: [{ type: 'text', text: '你好' }],
    timestamp: 1_700_000_000_000,
    ...patch
  }
}

export function makeAssistantMessage(
  patch: Partial<AiAssistantMessage> & { id?: string } = {}
): AiAssistantMessage {
  return {
    role: 'assistant',
    id: 'a1',
    blocks: [{ type: 'text', text: '你好,有什么可以帮你?' }],
    stopReason: 'stop',
    timestamp: 1_700_000_001_000,
    ...patch
  }
}

export function makeToolResult(
  patch: Partial<AiToolResultMessage> & { id?: string; toolCallId?: string } = {}
): AiToolResultMessage {
  return {
    role: 'toolResult',
    id: 'r1',
    toolCallId: 't1',
    toolName: 'read_plist',
    blocks: [{ type: 'text', text: 'ok' }],
    isError: false,
    status: 'ok',
    durationMs: 12,
    timestamp: 1_700_000_002_000,
    ...patch
  }
}

export function makeImageAttachment(patch: Partial<AiImageAttachment> = {}): AiImageAttachment {
  return {
    type: 'image',
    key: 'img1',
    name: 'pixel.png',
    mimeType: 'image/png',
    data: 'AA==',
    ...patch
  }
}

export function makeTextAttachment(patch: Partial<AiTextAttachment> = {}): AiTextAttachment {
  return {
    type: 'text',
    key: 'txt1',
    name: 'a.txt',
    content: 'hello',
    bytes: 5,
    ...patch
  }
}

export function makeMention(patch: Partial<AiMention> = {}): AiMention {
  return {
    key: 'm1',
    type: 'agent',
    id: 'agent-1',
    label: 'agent-1',
    ...patch
  }
}

export function makeSession(patch: Partial<AiSession> = {}): AiSession {
  return {
    id: 's1',
    title: '会话',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...patch
  }
}

export function makeUsage(patch: Partial<AiUsage> = {}): AiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    ...patch
  }
}

export function makeUpdateState(patch: Partial<UpdateState> = {}): UpdateState {
  return {
    phase: 'idle',
    currentVersion: '0.2.2',
    targetVersion: null,
    channel: 'manual',
    mode: 'none',
    progress: null,
    message: null,
    error: null,
    fallbackCommand: 'curl -fsSL https://repo.iskill.site/launcher/install.sh | bash',
    checkedAt: null,
    downloadSize: null,
    canCheck: true,
    canCancel: false,
    canApply: false,
    ...patch
  }
}
