import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderInput, SessionUsage } from 'claude-code'
import type { ContextUsage } from '../types'
import { formatTokens } from './register'

const HINT = {
  plugin: 'context-bar',
  component: 'PromptHint',
  requestId: 'prompt-hint',
  viewport: { columns: 120, rows: 1 },
  props: { hint: '? for shortcuts · esc to interrupt', isDraft: false, isWorking: false },
} as const

function setup(on: On, initial: ContextUsage = { window: 200000 }, options: {
  usageError?: boolean
  loadUsage?: () => Promise<SessionUsage>
} = {}) {
  let reads = 0
  let writes = 0
  let held: unknown
  const drawings: RenderInput<'PromptHint'>[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', async () => {
    reads += 1
    if (options.usageError) return { deny: 'usage unavailable' }
    if (options.loadUsage) return { value: await options.loadUsage() }
    const usage: SessionUsage = { startedAt: 0, context: initial, rateLimits: [] }
    return { value: usage }
  })
  on('state.set', async (_, e, next) => {
    const result = await next(e)
    if (e.plugin === 'context-bar' && result.value.isSet) {
      writes += 1
      held = e.value
    }
    return result
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    drawings.push(e)
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}{e.props.tail ? ` ${e.props.tail}` : ''}</Text>
  })
  return { drawings, reads: () => reads, writes: () => writes, snapshot: () => held }
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

async function measure($: Engine, value: ContextUsage): Promise<void> {
  await $.session.measure({ context: value, rateLimits: [], changed: ['context'] })
}

test('chưa có dữ liệu: hiện cửa sổ và giữ hint trên terminal/desktop', async ($, on) => {
  const fixture = setup(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...HINT, surface })
    expect((await ui.find({ type: 'Text', text: /chưa có dữ liệu/ }))?.text)
      .toContain('Context: chưa có dữ liệu · cửa sổ 200k')
    expect((await ui.find({ type: 'Text', text: /for shortcuts/ }))?.text).toContain(HINT.props.hint)
    await ui.unmount()
  }
  expect(fixture.reads()).toBe(1)
  expect(fixture.writes()).toBe(0)
})

test('khởi tạo từ usage đúng một lần và không đọc lại khi render hoặc measure', async ($, on) => {
  const fixture = setup(on, { tokens: 84000, window: 200000, percent: 42 })
  await start($)
  const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Context 42%/ }))?.text)
    .toBe('Context 42% · 84k/200k · còn 116k')
  await measure($, { tokens: 140000, window: 200000, percent: 70 })
  await ui.unmount()
  expect(fixture.reads()).toBe(1)
})

test('measure: 42/70/90% có màu xanh/vàng/đỏ và đúng 20 ô trong một hàng', async ($, on) => {
  setup(on)
  await start($)
  for (const [percent, color] of [[42, 'success'], [60, 'warning'], [70, 'warning'], [80, 'error'], [90, 'error']] as const) {
    await measure($, { tokens: percent * 2000, window: 200000, percent })
    const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
    const label = await ui.find({ type: 'Text', text: /^Context / })
    expect(label?.text).toContain(`${percent}%`)
    expect(label?.props.color).toBe(color)
    if (percent === 42) expect(label?.text).toBe('Context 42% · 84k/200k · còn 116k')
    const row = await ui.find({ key: 'context-row' })
    expect(row?.props).toMatchObject({ height: 1, flexDirection: 'row', flexWrap: 'nowrap', overflow: 'hidden' })
    const used = await ui.find({ key: 'context-used' })
    const free = await ui.find({ key: 'context-free' })
    expect(used?.props.backgroundColor).toBe(color)
    expect(used?.props.width).toBe(Math.round(percent / 5))
    expect(Number(used?.props.width) + Number(free?.props.width)).toBe(20)
    expect(used?.text + free!.text).toHaveLength(20)
    expect((await ui.find({ type: 'Text', text: HINT.props.hint }))?.props.dimColor).toBe(true)
    expect((await ui.findAll({ type: 'Text' })).every(text => text.props.wrap === 'truncate-end')).toBe(true)
    await ui.unmount()
  }
})

test('terminal chỉ thêm tail, giữ hint, cờ làm việc, viewport và envelope', async ($, on) => {
  const fixture = setup(on)
  await start($)
  await measure($, { tokens: 84000, window: 200000, percent: 42 })
  const input = { ...HINT, surface: 'terminal', props: { ...HINT.props, isDraft: true, isWorking: true } } as const
  const ui = await $.ui.mount(input)
  const { plugin, ...expected } = input
  expect(fixture.drawings[0]).toEqual({
    ...expected,
    props: { ...input.props, tail: 'ctx ▰▰▰▰▱▱▱▱▱▱ 42% · 84k/200k' },
  })
  expect((await ui.find({ type: 'Text' }))?.text).toContain(HINT.props.hint)
  await ui.unmount()
})

test('surface khác trả nguyên vẹn cho engine và không đọc state', async ($, on) => {
  const fixture = setup(on)
  let stateReads = 0
  on('state.get', (_, e, next) => { stateReads += 1; return next(e) })
  for (const surface of ['vscode', 'mobile'] as const) {
    const input = { ...HINT, surface, props: { ...HINT.props, tail: 'engine tail' } }
    const ui = await $.ui.mount(input)
    const { plugin, ...expected } = input
    expect(fixture.drawings[fixture.drawings.length - 1]).toEqual(expected)
    expect((await ui.find({ type: 'Text' }))?.text).toBe(`${HINT.props.hint} engine tail`)
    await ui.unmount()
  }
  expect(stateReads).toBe(0)
  expect(fixture.reads()).toBe(0)
})

test('lỗi đọc state trả nguyên vẹn cho engine trên terminal và desktop', async ($, on) => {
  const fixture = setup(on)
  on('state.get', () => ({ deny: 'state unavailable' }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const input = { ...HINT, surface, props: { ...HINT.props, tail: 'original' } }
    const ui = await $.ui.mount(input)
    const { plugin, ...expected } = input
    expect(fixture.drawings[fixture.drawings.length - 1]).toEqual(expected)
    await ui.unmount()
  }
})

test('usage lỗi vẫn khởi động được; measure tiếp theo phục hồi số liệu', async ($, on) => {
  setup(on, undefined, { usageError: true })
  await start($)
  await measure($, { tokens: 84000, window: 200000, percent: 42 })
  const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Context / }))?.text).toContain('42% · 84k/200k')
  await ui.unmount()
})

test('chỉ ghi state khi tokens/window/percent thay đổi, không giữ breakdown', async ($, on) => {
  const fixture = setup(on)
  await start($)
  const value = { tokens: 84000, window: 200000, percent: 42 }
  const withBreakdown = { ...value, breakdown: { ignored: true } }
  await measure($, withBreakdown)
  expect(fixture.writes()).toBe(1)
  expect(fixture.snapshot()).toEqual(value)
  await measure($, { ...value })
  expect(fixture.writes()).toBe(1)
  await measure($, { ...value, tokens: 84001 })
  await measure($, { ...value, window: 400000 })
  await measure($, { ...value, percent: 43 })
  expect(fixture.writes()).toBe(4)
  expect(fixture.snapshot()).toEqual({ ...value, percent: 43 })
  expect(fixture.reads()).toBe(1)
})

test('measure mới không bị usage khởi tạo trả chậm ghi đè', async ($, on) => {
  let release!: (value: SessionUsage) => void
  let ready!: () => void
  const entered = new Promise<void>(resolve => { ready = resolve })
  setup(on, undefined, { loadUsage: () => new Promise<SessionUsage>(resolve => { release = resolve; ready() }) })
  const starting = start($)
  await entered
  await measure($, { tokens: 180000, window: 200000, percent: 90 })
  release({ startedAt: 0, context: { tokens: 10000, window: 200000, percent: 5 }, rateLimits: [] })
  await starting
  const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Context / }))?.text).toContain('90% · 180k/200k')
  await ui.unmount()
})

test('compaction xóa dữ liệu cũ; thiếu tokens hoặc percent không coi là 0%', async ($, on) => {
  setup(on, { tokens: 84000, window: 200000, percent: 42 })
  await start($)
  for (const value of [{ window: 200000 }, { window: 200000, tokens: 0 }, { window: 200000, percent: 0 }]) {
    await measure($, value)
    const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /chưa có dữ liệu/ }))?.text).toContain('cửa sổ 200k')
    await ui.unmount()
  }
})

test('0% và 100% vẽ thanh hợp lệ, không hiển thị số token còn lại âm', async ($, on) => {
  setup(on)
  await start($)
  for (const percent of [0, 100]) {
    await measure($, { tokens: percent === 0 ? 0 : 210000, window: 200000, percent })
    const ui = await $.ui.mount({ ...HINT, surface: 'desktop' })
    const bar = await ui.find({ key: 'context-bar' })
    expect(bar?.text).toHaveLength(20)
    expect((await ui.find({ type: 'Text', text: /^Context / }))?.text)
      .toContain(percent === 0 ? '0% · 0/200k · còn 200k' : '100% · 210k/200k · còn 0')
    await ui.unmount()
  }
})

test('định dạng token gọn, bỏ .0 và chuyển đơn vị sau làm tròn', () => {
  for (const [value, text] of [
    [0, '0'], [950, '950'], [1000, '1k'], [12300, '12.3k'], [84000, '84k'],
    [200000, '200k'], [999949, '999.9k'], [999950, '1M'], [1200000, '1.2M'], [10000000, '10M'],
  ] as const) expect(formatTokens(value)).toBe(text)
})
