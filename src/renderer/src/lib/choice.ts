// 二选一决策浮层 Promise API
// 用途:维度联动里**真正需要用户拍板**的场合(如「停止后下次登录仍会自动启动」),以询问代替灰按钮/报错。
// 结构与 lib/elevation.ts 的 confirmDangerous 一致:模块级单例请求 + 订阅式模态渲染。
export interface ChoiceOption {
  label: string
  value: string
}

export interface ChoiceRequest {
  header: string
  title: string
  options: ChoiceOption[]
}

let choiceReq: (ChoiceRequest & { resolve: (v: string | null) => void }) | null = null
let choiceListener: ((req: ChoiceRequest | null) => void) | null = null

export const CHOICE = {
  subscribe(cb: (req: ChoiceRequest | null) => void): () => void {
    choiceListener = cb
    return () => {
      choiceListener = null
    }
  },

  /** 返回所选 value;用户取消(X/Esc/遮罩)返回 null */
  request(req: ChoiceRequest): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      choiceReq = { ...req, resolve }
      choiceListener?.(req)
    })
  },

  pick(value: string): void {
    if (!choiceReq) return
    const { resolve } = choiceReq
    choiceReq = null
    choiceListener?.(null)
    resolve(value)
  },

  cancel(): void {
    if (!choiceReq) return
    const { resolve } = choiceReq
    choiceReq = null
    choiceListener?.(null)
    resolve(null)
  }
}
