import { atom, read, update } from 'claude-code'
import type { Color, Register, StateDollar } from 'claude-code'
import type { ContextUsage } from '../types'

const context = atom({ plugin: 'context-bar', key: 'context' } as const, { window: 200000 })

/** Định dạng token với tối đa một chữ số thập phân, không phụ thuộc locale. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('Số token không hợp lệ')
  if (value < 1000) return String(Math.round(value))
  const millions = value >= 999950
  return (value / (millions ? 1000000 : 1000)).toFixed(1).replace(/\.0$/, '') + (millions ? 'M' : 'k')
}

function snapshot(value: ContextUsage): ContextUsage {
  if (!value || !Number.isFinite(value.window) || value.window <= 0 ||
      (value.tokens !== undefined && (!Number.isFinite(value.tokens) || value.tokens < 0)) ||
      (value.percent !== undefined && (!Number.isFinite(value.percent) || value.percent < 0 || value.percent > 100))) {
    throw new Error('Số liệu context không hợp lệ')
  }
  return { tokens: value.tokens, window: value.window, percent: value.percent }
}

function same(a: ContextUsage, b: ContextUsage): boolean {
  return a.tokens === b.tokens && a.window === b.window && a.percent === b.percent
}

function usageColor(percent: number): Color {
  return percent < 60 ? 'success' : percent < 80 ? 'warning' : 'error'
}

function bar(percent: number, cells: number): string {
  const used = Math.round(percent * cells / 100)
  return '▰'.repeat(used) + '▱'.repeat(cells - used)
}

type Runtime = { revision: number; pending: Promise<void> }

// Tuần tự hóa ghi state để hai measure trùng nhau cũng không gây redraw thừa.
function save($: StateDollar, runtime: Runtime, value: ContextUsage, seedRevision?: number): Promise<void> {
  const nextValue = snapshot(value)
  const work = runtime.pending.then(async () => {
    if (seedRevision !== undefined && seedRevision !== runtime.revision) return
    const previous = await read($, context)
    if (!same(previous, nextValue)) await update($, context, () => nextValue)
  })
  runtime.pending = work.catch(() => {})
  return work
}

/** Gắn các hook theo phiên; chỉ cập nhật khi engine phát số liệu mới. */
export const register: Register = on => {
  const runtime: Runtime = { revision: 0, pending: Promise.resolve() }

  on('session.start', async ($, e, next) => {
    const seedRevision = runtime.revision
    try {
      const usage = await $.session.usage()
      await save($, runtime, usage.context, seedRevision)
    } catch {
      // Lỗi số liệu không được chặn phiên hoặc các hook của engine.
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    runtime.revision += 1
    try {
      await save($, runtime, e.context)
    } catch {
      // Giữ lần đo hợp lệ gần nhất; không gọi usage lại hay poll.
    }
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)

    let tail: string
    try {
      const usage = snapshot(await read($, context))
      const known = usage.tokens !== undefined && usage.percent !== undefined
      const summary = known
        ? `${Math.round(usage.percent!)}% · ${formatTokens(usage.tokens!)}/${formatTokens(usage.window)}`
        : `chưa có dữ liệu · cửa sổ ${formatTokens(usage.window)}`

      if (e.surface === 'terminal') {
        tail = known ? `ctx ${bar(usage.percent!, 10)} ${summary}` : `Context: ${summary}`
      } else {
        const { Box, Text } = $.ui.resolve(e)
        const color = known ? usageColor(usage.percent!) : 'subtle'
        const used = known ? Math.round(usage.percent! / 5) : 0
        return (
          <Box key="context-row" flexDirection="row" flexWrap="nowrap" height={1} overflow="hidden" width="100%" gap={1}>
            {known && (
              <Box key="context-bar" flexDirection="row" flexWrap="nowrap" width={20} height={1} flexShrink={0}>
                {used > 0 && (
                  <Box key="context-used" width={used} height={1} backgroundColor={color}>
                    <Text color={color} mono wrap="truncate-end">{'▰'.repeat(used)}</Text>
                  </Box>
                )}
                {used < 20 && (
                  <Box key="context-free" width={20 - used} height={1} backgroundColor="subtle">
                    <Text dimColor mono wrap="truncate-end">{'▱'.repeat(20 - used)}</Text>
                  </Box>
                )}
              </Box>
            )}
            <Box minWidth={0} flexShrink={1}>
              <Text color={color} wrap="truncate-end">
                {known ? `Context ${summary} · còn ${formatTokens(Math.max(0, usage.window - usage.tokens!))}` : `Context: ${summary}`}
              </Text>
            </Box>
            <Box minWidth={0} flexGrow={1} flexShrink={1}>
              <Text dimColor wrap="truncate-end">{e.props.hint}</Text>
            </Box>
          </Box>
        )
      }
    } catch {
      return next(e)
    }

    // Đặt next ngoài try: không gọi engine hai lần nếu chính engine ném lỗi.
    return next({ ...e, props: { ...e.props, tail } })
  })
}
