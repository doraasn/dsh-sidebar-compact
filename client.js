/**
 * Client half of dsh-sidebar-compact.
 *
 * 侧栏「全局面板」只显示用户勾选的面板，其余面板（插件 / 跨会话消息 / 自动化任务等）
 * 收进侧栏「更多」菜单；控制入口在 设置 →「侧栏收纳」，勾选结果存 localStorage。
 *
 * 设置页用 skill 内联的 client-ui kit（v3）：Section / SettingsCard / SettingRow / Switch，
 * 字号只用官方档位（10/11/12/13/15）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-compact',
  factory(require) {
    const React = require('react');
    const createPortal = require('react-dom').createPortal;
    const h = React.createElement;

/**
 * DSH 客户端 UI kit v3（2026-11-05，字号按官方 10/11/12/13/15 档）—— 整段粘进 `lib/client.js` 的 factory 里（`const react = require('react')` 之后）。
 *
 * 为什么是"粘贴"而不是 import：插件的浏览器 bundle 由宿主按单文件 `/plugins/<id>/client.js`
 * 提供，没有打包器，`import './ui.js'` 在浏览器里跑不起来。所以公用组件以「可粘贴的片段」分发。
 *
 *   const ui = createUi(react, require('react-dom').createPortal)
 *   const { h, Card, StatusDot, Switch, TextField, Button, Section, SettingsCard, SettingRow,
 *           createStore, useStore, usePoll, placeNear, HoverCard, T, TYPE } = ui
 *
 * 约定：所有颜色/圆角走 DSH token；所有字号走 TYPE 里的档位（小字行高固定 13px，
 * 否则 baseline 行盒会被撑高，同排卡片高度就会差 3px）。
 */
function createUi(react, createPortal) {
  const h = react.createElement
  const { useState, useEffect, useCallback, useRef } = react

  /* ---------- token 与字号 ---------- */
  const T = {
    text1: 'var(--dsw-alias-label-primary)',
    text2: 'var(--dsw-alias-label-secondary)',
    text3: 'var(--dsw-alias-label-tertiary, #8b929c)',
    line: 'var(--dsw-alias-border-l3)',
    cardFill: 'var(--dsw-alias-settings-card-fill, #2c2c2e)',
    cardStroke: 'var(--dsw-alias-settings-card-stroke, #ffffff26)',
    inputFill: 'var(--dsw-alias-bg-layer-1, #1b1b1c)',
    accent: 'var(--dsw-alias-button-primary-fill, #f9fafb)',
    accentText: 'var(--dsw-alias-label-primary-foreground, #0f1115)',
    radiusMd: 'var(--dsw-radius-md, 12px)',
    radiusXl: 'var(--dsw-radius-xl, 20px)',
  }
  const CARD_BG = 'color-mix(in srgb, currentColor 6%, transparent)'
  const TYPE = {
    h1: { fontSize: 15, fontWeight: 600, lineHeight: '20px', color: T.text1 },
    h2: { fontSize: 15, fontWeight: 600, lineHeight: '20px', color: T.text1 },
    body: { fontSize: 13, lineHeight: '20px', color: T.text1 },
    secondary: { fontSize: 13, lineHeight: '20px', color: T.text2 },
    small: { fontSize: 12, lineHeight: '18px', color: T.text2 },
    micro: { fontSize: 11, lineHeight: '14px', color: T.text2 },
    num: { fontSize: 15, fontWeight: 600, lineHeight: '20px', color: T.text1, fontVariantNumeric: 'tabular-nums' },
    ellipsis: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }

  /* ---------- 纯函数 ---------- */
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

  /** 浮层定位：优先右侧，放不下翻左；上下夹在视口内。pure，便于脱离 DOM 测试。 */
  function placeNear(rect, options = {}) {
    const width = options.width ?? 248
    const height = options.height ?? 120
    const gap = options.gap ?? 8
    const vw = options.viewport?.width ?? (typeof window === 'undefined' ? 1280 : window.innerWidth)
    const vh = options.viewport?.height ?? (typeof window === 'undefined' ? 800 : window.innerHeight)
    let side = 'right'
    let left = rect.right + gap
    if (left + width > vw - gap) {
      side = 'left'
      left = rect.left - gap - width
    }
    return {
      side,
      left: clamp(left, gap, Math.max(gap, vw - width - gap)),
      top: clamp(rect.top, gap, Math.max(gap, vh - height - gap)),
    }
  }

  const formatBytes = (bytes) => {
    const n = Number(bytes) || 0
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB'
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  }

  /* ---------- 本地状态：模块级 store + hook ---------- */
  /** 按设备持久化；只存差异值也安全（读取时与默认值合并）。 */
  function createStore(key, defaults = {}) {
    const read = () => {
      try {
        return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }
      } catch {
        return { ...defaults }
      }
    }
    const store = {
      key,
      value: read(),
      listeners: new Set(),
      set(next) {
        store.value = typeof next === 'function' ? next(store.value) : next
        try { localStorage.setItem(key, JSON.stringify(store.value)) } catch {}
        for (const listener of store.listeners) listener(store.value)
      },
      patch(part) { store.set({ ...store.value, ...part }) },
      subscribe(listener) {
        store.listeners.add(listener)
        return () => { store.listeners.delete(listener) }
      },
    }
    return store
  }

  function useStore(store) {
    const [value, setValue] = useState(store.value)
    useEffect(() => store.subscribe(setValue), [store])
    return value
  }

  /** 轮询 + 失败保留上一帧（不要闪成空）。返回 [data, error, refresh]。 */
  function usePoll(task, intervalMs, deps = []) {
    const [state, setState] = useState({ data: null, error: false })
    const run = useCallback(async () => {
      try {
        const data = await task()
        setState({ data, error: false })
      } catch {
        setState((prev) => ({ data: prev.data, error: true }))
      }
    }, deps)
    useEffect(() => {
      run()
      const timer = setInterval(run, intervalMs)
      return () => clearInterval(timer)
    }, [run, intervalMs])
    return [state.data, state.error, run]
  }

  /* ---------- 侧栏卡片 ---------- */
  const StatusDot = ({ color, size = 6, offset = 1.5 }) => h('span', {
    style: {
      width: size,
      height: size,
      borderRadius: '50%',
      backgroundColor: color || T.text3,
      flex: '0 0 auto',
      alignSelf: 'center',
      transform: `translateY(${offset}px)`,
    },
  })

  /** 侧栏卡片：一行，圆点 + 名称 + 右侧数字。左右两组用同一 baseline。 */
  const Card = ({ children, style, ...rest }) => h('div', {
    ...rest,
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
      padding: '2px 12px 5px',
      borderRadius: T.radiusMd,
      background: CARD_BG,
      minWidth: 0,
      overflow: 'hidden',
      ...style,
    },
  }, children)

  /** 侧栏卡片容器：竖排 + 3px 间距 + 左右 2px 内缩（与 newSession 对齐）。 */
  const CardStack = ({ children }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 3, padding: '0 2px 2px', minWidth: 0 },
  }, children)

  const CardName = ({ children }) => h('span', { style: { ...TYPE.h2, fontSize: 12, flex: '1 1 auto', ...TYPE.ellipsis } }, children)
  const CardValue = ({ children }) => h('span', {
    style: { display: 'flex', alignItems: 'baseline', gap: 4, flex: '0 0 auto', ...TYPE.num },
  }, children)

  /* ---------- 设置页 ---------- */
  const Section = ({ title, description, children }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640, minWidth: 0 },
  },
  h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 } },
    h('span', { style: TYPE.h1 }, title),
    description ? h('span', { style: TYPE.secondary }, description) : null),
  children)

  /** 设置卡片：官方那种 20px 圆角、深色填充、细描边。 */
  const SettingsCard = ({ children, style }) => h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      padding: '14px 16px',
      borderRadius: T.radiusXl,
      border: `.5px solid ${T.cardStroke}`,
      background: T.cardFill,
      minWidth: 0,
      ...style,
    },
  }, children)

  /** 左标签 + 右控件的一行。 */
  const SettingRow = ({ label, hint, children }) => h('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: 0 },
  },
  h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
    h('span', { style: { fontSize: 13, lineHeight: '20px', color: T.text1 } }, label),
    hint ? h('span', { style: { fontSize: 11, lineHeight: '16px', color: T.text2 } }, hint) : null),
  children)

  /** 药丸开关：36×20，白色底 + 深色旋钮，与官方设置页一致。 */
  const Switch = ({ checked, onChange, title, disabled = false }) => h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    disabled,
    onClick: onChange,
    title,
    style: {
      boxSizing: 'border-box',
      position: 'relative',
      flex: '0 0 auto',
      width: 36,
      height: 20,
      padding: 2,
      border: 0,
      borderRadius: 999,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: checked ? 'flex-end' : 'flex-start',
      transition: 'background-color .12s ease',
      backgroundColor: checked ? T.accent : 'var(--dsw-alias-border-l3, #4a4a4d)',
    },
  }, h('span', {
    style: {
      display: 'block',
      width: 16,
      height: 16,
      borderRadius: '50%',
      backgroundColor: checked ? T.accentText : 'var(--dsw-alias-label-primary, #f9fafb)',
      transition: 'background-color .12s ease',
    },
  }))

  const Button = ({ children, onClick, variant = 'primary', disabled = false, type = 'button' }) => h('button', {
    type,
    onClick,
    disabled,
    style: {
      boxSizing: 'border-box',
      height: 36,
      padding: '0 16px',
      borderRadius: T.radiusMd,
      whiteSpace: 'nowrap',
      flex: 'none',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      fontSize: 13,
      lineHeight: '20px',
      fontWeight: 500,
      ...(variant === 'primary'
        ? { border: 'none', background: T.accent, color: T.accentText }
        : { border: `.5px solid ${T.cardStroke}`, background: 'transparent', color: T.text1 }),
    },
  }, children)

  /** 文本输入：44px 高、12px 圆角，与官方设置字段一致。 */
  /** 输入框：与 Select / Button 同高（36px），支持单位后缀、禁用、错误态、回车提交。 */
  const Input = ({
    value,
    onChange,
    placeholder = '',
    type = 'text',
    width = 220,
    unit,
    disabled = false,
    invalid = false,
    min,
    max,
    step,
    autoFocus = false,
    onEnter,
  }) => {
    const [focused, setFocused] = useState(false)
    const border = invalid ? '#ff6262' : focused ? T.text3 : T.cardStroke
    return h('div', {
      style: {
        width,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 36,
        boxSizing: 'border-box',
        padding: '0 10px',
        borderRadius: T.radiusMd,
        border: `.5px solid ${border}`,
        background: T.inputFill,
        opacity: disabled ? 0.6 : 1,
        transition: 'border-color .12s ease',
      },
    },
      h('input', {
        type,
        value: value ?? '',
        placeholder,
        disabled,
        min,
        max,
        step,
        autoFocus,
        onChange: (event) => onChange?.(event.target.value),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
        onKeyDown: (event) => { if (event.key === 'Enter') onEnter?.(event.target.value) },
        style: {
          flex: 1,
          minWidth: 0,
          border: 0,
          outline: 'none',
          background: 'transparent',
          color: T.text1,
          fontSize: 13,
          lineHeight: '20px',
          padding: 0,
        },
      }),
      unit ? h('span', { style: { ...TYPE.micro, flex: 'none' } }, unit) : null,
    )
  }

  /** 带标签/说明的输入框（Input 的组合封装，保留旧 API）。 */
  const TextField = ({ label, hint, width = '100%', ...props }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  },
  label ? h('span', { style: { fontSize: 12, lineHeight: '16px', color: T.text2 } }, label) : null,
  h(Input, { width, ...props }),
  hint ? h('span', { style: TYPE.micro }, hint) : null)

  /* ---------- 浮层 ---------- */
  /** 悬停详情卡：portal 到 body，先按估算高度定位，挂载后按实测高度夹取。 */
  function HoverCard({ rect, width = 248, estimated = 120, children }) {
    const ref = useRef(null)
    const [placement, setPlacement] = useState(() => placeNear(rect, { width, height: estimated }))
    useEffect(() => {
      const node = ref.current
      if (!node) return
      const measured = node.getBoundingClientRect().height || estimated
      setPlacement(placeNear(rect, { width, height: measured }))
    }, [rect, width, estimated])
    const node = h('div', {
      ref,
      style: {
        position: 'fixed',
        left: placement.left,
        top: placement.top,
        width,
        zIndex: 2147400000,
        background: T.cardFill,
        border: `.5px solid ${T.cardStroke}`,
        borderRadius: T.radiusXl,
        padding: '12px 14px',
        boxShadow: '0 12px 32px rgba(0, 0, 0, .45)',
        color: T.text1,
      },
    }, children)
    return createPortal && typeof document !== 'undefined' ? createPortal(node, document.body) : node
  }

  /** 详情卡里的一行：左标题、右值。 */
  const InfoRow = ({ label, value }) => h('div', {
    style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, minWidth: 0 },
  },
  h('span', { style: { fontSize: 12, lineHeight: '18px', color: T.text2 } }, label),
  h('span', { style: { fontSize: 12, lineHeight: '18px', color: T.text1, fontVariantNumeric: 'tabular-nums' } }, value))

  /* ---------- 通用控件 ---------- */

  /** 下拉：触发器与设置输入框同高；浮层在触发器内绝对定位（不 portal），宽度与触发器一致。 */
  function Select({ value, options = [], onChange, width = 220, placeholder = '', disabled = false }) {
    const [open, setOpen] = useState(false)
    const [hover, setHover] = useState(-1)
    const ref = useRef(null)
    const current = options.find((option) => option.value === value)

    useEffect(() => {
      if (!open) return undefined
      const onDown = (event) => { if (ref.current && ref.current.contains(event.target)) return; setOpen(false) }
      const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
      return () => {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown', onKey)
      }
    }, [open])

    const trigger = {
      boxSizing: 'border-box',
      width: '100%',
      height: 36,
      padding: '0 8px 0 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      borderRadius: T.radiusMd,
      border: `.5px solid ${T.cardStroke}`,
      background: T.inputFill,
      color: T.text1,
      fontSize: 13,
      lineHeight: '20px',
      cursor: disabled ? 'default' : 'pointer',
      textAlign: 'left',
      opacity: disabled ? 0.55 : 1,
    }

    return h('div', { ref, style: { position: 'relative', width, minWidth: 0 } },
      h('button', {
        type: 'button',
        disabled,
        onClick: () => { if (disabled) return; setHover(-1); setOpen((previous) => !previous) },
        style: trigger,
        'aria-haspopup': 'listbox',
        'aria-expanded': open,
      },
        h('span', { style: { ...TYPE.ellipsis, flex: 1, textAlign: 'left', color: current ? T.text1 : T.text2 } }, current ? current.label : placeholder),
        h('svg', {
          width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: T.text2,
          strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
          style: { flex: 'none', transition: 'transform .12s ease', transform: open ? 'rotate(180deg)' : 'none' },
        }, h('path', { d: 'M6 9l6 6 6-6' })),
      ),
      open && !disabled ? h('div', {
        role: 'listbox',
        style: {
          boxSizing: 'border-box',
          position: 'absolute',
          left: 0,
          top: 'calc(100% + 6px)',
          width,
          maxHeight: 320,
          overflowY: 'auto',
          padding: 4,
          zIndex: 40,
          background: T.cardFill,
          border: `.5px solid ${T.cardStroke}`,
          borderRadius: T.radiusMd,
          boxShadow: '0 12px 32px rgba(0, 0, 0, .45)',
        },
      }, options.map((option, index) => h('div', {
        key: option.value,
        role: 'option',
        'aria-selected': option.value === value,
        onMouseEnter: () => setHover(index),
        onMouseLeave: () => setHover(-1),
        onClick: () => { onChange?.(option.value); setOpen(false) },
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          height: 32,
          padding: '0 10px',
          borderRadius: 8,
          fontSize: 13,
          lineHeight: '20px',
          color: T.text1,
          cursor: 'pointer',
          background: hover === index
            ? 'color-mix(in srgb, currentColor 8%, transparent)'
            : option.value === value ? 'color-mix(in srgb, currentColor 4%, transparent)' : 'transparent',
        },
      },
        h('span', { style: { ...TYPE.ellipsis } }, option.label),
        option.value === value ? h('svg', {
          width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: T.text1,
          strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        }, h('path', { d: 'M5 13l4 4L19 7' })) : null,
      ))) : null,
    )
  }

  /** 分段切换（2~4 项）：选中项白底黑字，未选中透明，整组与输入框同高。 */
  function Segmented({ value, options = [], onChange }) {
    return h('div', {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        height: 36,
        padding: 2,
        boxSizing: 'border-box',
        borderRadius: T.radiusMd,
        border: `.5px solid ${T.cardStroke}`,
        background: T.inputFill,
      },
    }, options.map((option) => {
      const active = option.value === value
      return h('button', {
        key: option.value,
        type: 'button',
        onClick: () => onChange?.(option.value),
        style: {
          height: 30,
          padding: '0 12px',
          border: 'none',
          borderRadius: 9,
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: '20px',
          background: active ? T.accent : 'transparent',
          color: active ? T.accentText : T.text2,
          transition: 'background-color .12s ease, color .12s ease',
        },
      }, option.label)
    }))
  }

  /** 图标按钮：28×28，hover 有底色；用于行内删除、刷新等。 */
  const IconButton = ({ label, onClick, disabled = false, children }) => h('button', {
    type: 'button',
    title: label,
    'aria-label': label,
    onClick,
    disabled,
    style: {
      width: 28,
      height: 28,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: 0,
      borderRadius: 8,
      background: 'transparent',
      color: disabled ? T.text3 : T.text2,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    },
  }, children)

  /** 指标块：上标签、下数值，用于面板顶部摘要。 */
  const StatTile = ({ label, value, hint }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 96 },
  },
  h('span', { style: TYPE.micro }, label),
  h('span', { style: { ...TYPE.num } }, value),
  hint ? h('span', { style: TYPE.micro }, hint) : null)

  /** 空态：居中提示，不占空容器。 */
  const EmptyState = ({ title, hint }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '24px 12px', textAlign: 'center' },
  },
  h('span', { style: TYPE.body }, title),
  hint ? h('span', { style: TYPE.small }, hint) : null)

  return {
    h, T, TYPE, CARD_BG,
    clamp, placeNear, formatBytes,
    createStore, useStore, usePoll,
    Card, CardStack, CardName, CardValue, StatusDot,
    Section, SettingsCard, SettingRow, Switch, Button, Input, TextField,
    Select, Segmented, IconButton, StatTile, EmptyState,
    HoverCard, InfoRow,
  }
}

    const ui = createUi(React, createPortal);
    const { Section, SettingsCard, SettingRow, Switch, createStore, useStore } = ui;

    /** 默认留在侧栏上的面板 id（dsh-web-chat 的「聊天」）。 */
    const DEFAULT_KEPT = ['dsh-web-chat'];
    /** 勾选结果（哪些面板留在侧栏）的存储键；kit store 存 { kept: [...] }。 */
    const PREFS_KEY = 'dsh-sidebar-compact:prefs';
    /** 面板行所在的导航容器选择器（CSS Modules 类名固定带 panelList 片段）。 */
    const NAV_SELECTOR = 'nav[class*="panelList"]';

    /** 只留「更多」菜单行的样式；设置页交给 kit，不再自绘。 */
    const CSS = [
      '.dsh-sidebar-compact-row{display:flex;align-items:center;gap:4px;width:100%;',
      'box-sizing:border-box;min-height:34px;padding:7px 8px;border:0;',
      'border-radius:var(--dsw-radius-md,10px);background:transparent;',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;',
      'text-align:left;cursor:pointer}',
      '.dsh-sidebar-compact-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-sidebar-compact-row:focus-visible{background:var(--dsw-alias-interactive-bg-hover);',
      'outline:none}',
      '.dsh-sidebar-compact-glyph{display:inline-flex;align-items:center;justify-content:flex-start;',
      'flex:none;width:16px;height:16px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-sidebar-compact-glyph svg{display:block;width:14px;height:14px}',
      '.dsh-sidebar-compact-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    ].join('');

    /** 读取一个面板入口的显示名（注册时是可延迟求值的函数）。 */
    function resolveLabel(options) {
      try {
        return typeof options.label === 'function' ? options.label() : options.label;
      } catch {
        return undefined;
      }
    }

    /** 按 order 排序列出侧栏全部面板入口（含该面板自己的图标组件）。 */
    function listPanels(ctx) {
      const entries = ctx.slots.entriesOfSlot('sidebar.panellist') || [];
      return entries
        .map(entry => ({
          id: entry.options.id,
          order: entry.options.order ?? 0,
          label: resolveLabel(entry.options) || entry.options.id,
          Icon: typeof entry.component === 'function' ? entry.component : null,
        }))
        .sort((a, b) => a.order - b.order);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const prefs = createStore(PREFS_KEY, { kept: DEFAULT_KEPT });
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-sidebar-compact';
        style.dataset.pluginCss = 'dsh-sidebar-compact/menu.css';
        document.head.appendChild(style);

        /** 当前应收进「更多」的面板。 */
        const foldedPanels = () => {
          const kept = prefs.value.kept || [];
          return listPanels(ctx).filter(panel => !kept.includes(panel.id));
        };

        /** 按当前面板入口、勾选结果与语言重新生成隐藏规则。 */
        const paint = () => {
          const selectors = foldedPanels()
            .map(panel => `${NAV_SELECTOR} > button[aria-label=${JSON.stringify(panel.label)}]`);
          style.textContent = CSS
            + (selectors.length > 0 ? `${selectors.join(',')}{display:none !important}` : '');
        };

        ctx.effect(() => {
          paint();
          const offSlot = ctx.slots.subscribe('sidebar.panellist', paint);
          const offLocale = ctx.locale.subscribe(paint);
          const offPrefs = prefs.subscribe(paint);
          return () => {
            if (typeof offSlot === 'function') offSlot();
            if (typeof offLocale === 'function') offLocale();
            if (typeof offPrefs === 'function') offPrefs();
            style.remove();
          };
        }, 'dsh-sidebar-compact: folded rows');

        /** 「更多」菜单里的收纳行：复用该面板在侧栏上的原始图标。 */
        function FoldedPanelRows({ onOpen, onDismiss }) {
          /** 勾选变化后重渲染，收起/放回的面板立刻同步。 */
          useStore(prefs);
          const fold = foldedPanels();
          /** 菜单会在 pointerdown 后收起，因此选中动作必须比 click 更早触发一次。 */
          const fired = React.useRef(new Set());
          const activate = (id) => {
            if (fired.current.has(id)) return;
            fired.current.add(id);
            onDismiss();
            onOpen(id);
          };
          return h(
            React.Fragment,
            null,
            fold.map(panel => h(
              'button',
              {
                key: panel.id,
                type: 'button',
                role: 'menuitem',
                className: 'dsh-sidebar-compact-row',
                onPointerDown: () => activate(panel.id),
                onClick: () => activate(panel.id),
              },
              h(
                'span',
                { key: 'glyph', className: 'dsh-sidebar-compact-glyph', 'aria-hidden': 'true' },
                panel.Icon === null ? null : h(panel.Icon, { size: 14, active: false }),
              ),
              h('span', { key: 'label', className: 'dsh-sidebar-compact-label' }, panel.label),
            )),
          );
        }

        /** 设置页：逐个面板切换「显示在侧栏」/「收进更多」。 */
        function SidebarEntriesSettings() {
          const { kept } = useStore(prefs);
          const panels = listPanels(ctx);
          const toggle = (id) => {
            const next = kept.includes(id) ? kept.filter(item => item !== id) : [...kept, id];
            prefs.patch({ kept: next });
          };
          return h(
            Section,
            {
              title: '侧栏收纳',
              description: '勾选的面板显示在侧栏，未勾选的收进侧栏「更多」菜单。',
            },
            h(
              SettingsCard,
              null,
              panels.map(panel => h(
                SettingRow,
                { key: panel.id, label: panel.label, hint: panel.id },
                h(Switch, {
                  checked: kept.includes(panel.id),
                  onChange: () => toggle(panel.id),
                  title: panel.label,
                }),
              )),
            ),
          );
        }

        ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
          name: 'sidebar.panellist.actions',
          id: 'sidebar-compact',
          order: -10,
        }, FoldedPanelRows));

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'sidebar-compact',
          order: 210,
          label: () => '侧栏收纳',
        }, SidebarEntriesSettings));
      },
    };
  },
});
