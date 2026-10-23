/**
 * 用户在预览里指的那个元素 —— IPC 契约里的形状（主进程 `api.d.ts` 与探针侧共用）。
 *
 * 圈选直接给元素本身；圈改给的是「框住的那块」—— 判断规则一样，所以只留一条通道，
 * 探针那边多认出来的字段都是可选的。
 *
 * ⚠️ 已知分叉：`src/renderer/src/components/chat/ChatPanel.tsx` 还留着一份自己的
 * `PointedTarget`（多出 `framework` / `codeSnippet` / `outerHTMLSnippet`，且 `text`
 * 可选）。两份同时存在说明「探针到底会产出哪些字段」在两侧没有被同一次改动覆盖过；
 * 合并这两份之前要先确认探针的真实输出，不要照着哪一份猜。
 */
export interface PointedTarget {
  tagName: string
  text: string
  className?: string
  selector?: string
  componentName?: string
  sourceFile?: string
  sourceLine?: number | null
  /** sourceFile/sourceLine 是否编译期/框架级精确位置（true），还是文本推断（false）。 */
  sourceLocated?: boolean
  /** 位置来源通道，见 docs/workstation-definitions.md。 */
  locateMode?: 'compiler' | 'fiber' | 'text' | 'none'
  /** 该点的元素层叠（由内到外），圈改才有。 */
  stack?: string[]
  /** 圈改时该框的批注文字（用户画框时写的）；圈选时为空。 */
  note?: string
}
