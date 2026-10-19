import {
  OpenAI,
  Anthropic,
  DeepSeek,
  Google,
  Ollama,
  Groq,
  Mistral,
  Meta,
  Minimax,
  Moonshot,
  Zhipu,
  Qwen
} from '@lobehub/icons'
import { Bot, Zap } from 'lucide-react'

/** 按服务商名匹配品牌图标；认不出来就退回通用机器人图标。 */
export function getProviderIcon(provider: string, size = 14) {
  const p = provider.toLowerCase()
  if (p.includes('openai')) return <OpenAI size={size} />
  if (p.includes('claude') || p.includes('anthropic')) return <Anthropic size={size} />
  if (p.includes('deepseek')) return <DeepSeek size={size} />
  if (p.includes('google') || p.includes('gemini')) return <Google size={size} />
  if (p.includes('ollama')) return <Ollama size={size} />
  if (p.includes('groq')) return <Groq size={size} />
  if (p.includes('mistral')) return <Mistral size={size} />
  if (p.includes('meta') || p.includes('llama')) return <Meta size={size} />
  if (p.includes('minimax')) return <Minimax size={size} />
  if (p.includes('moonshot') || p.includes('kimi')) return <Moonshot size={size} />
  if (p.includes('zhipu') || p.includes('glm')) return <Zhipu size={size} />
  if (p.includes('qwen') || p.includes('aliyun')) return <Qwen size={size} />
  return <Bot size={size} />
}

/** 引擎图标：ACP 两家用品牌标，thunder 内置引擎用闪电（与对话标题同色）。 */
export function getEngineIcon(engine: string, size = 12) {
  const e = engine.toLowerCase()
  if (e === 'claude') return <Anthropic size={size} />
  if (e === 'codex') return <OpenAI size={size} />
  return <Zap size={size} className="pc-engine-icon" />
}
