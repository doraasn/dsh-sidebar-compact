/**
 * Client half of dsh-sidebar-compact.
 *
 * 侧栏「全局面板」只显示用户勾选的面板，其余面板（插件 / 跨会话消息 / 自动化任务等）
 * 收进侧栏「更多」菜单；控制入口在 设置 →「侧栏入口」，勾选结果存 localStorage。
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-compact',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** 默认留在侧栏上的面板 id（dsh-web-chat 的「聊天」）。 */
    const DEFAULT_KEPT = ['dsh-web-chat'];
    /** 勾选结果（哪些面板留在侧栏）的存储键。 */
    const PREFS_KEY = 'dsh-sidebar-compact:keptPanels';
    /** 面板行所在的导航容器选择器（CSS Modules 类名固定带 panelList 片段）。 */
    const NAV_SELECTOR = 'nav[class*="panelList"]';

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
      '.dsh-sidebar-compact-entry{display:flex;align-items:center;gap:12px;padding:10px 12px;',
      'border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1)}',
      '.dsh-sidebar-compact-entry-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}',
      '.dsh-sidebar-compact-entry-name{font-size:13px;line-height:20px;',
      'color:var(--dsw-alias-label-primary)}',
      '.dsh-sidebar-compact-entry-id{font-size:12px;line-height:18px;',
      'color:var(--dsw-alias-label-secondary)}',
      '.dsh-sidebar-compact-entry-check{flex:none;width:16px;height:16px;margin:0;cursor:pointer;',
      'accent-color:var(--dsw-alias-brand-primary)}',
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

    /** 读写的偏好：留在侧栏上的面板 id 列表。 */
    function createPrefs() {
      const read = () => {
        try {
          const raw = window.localStorage.getItem(PREFS_KEY);
          if (raw === null) return DEFAULT_KEPT;
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) return DEFAULT_KEPT;
          return parsed.filter(id => typeof id === 'string');
        } catch {
          return DEFAULT_KEPT;
        }
      };
      let kept = read();
      const listeners = new Set();
      return {
        get: () => kept,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        set: (next) => {
          kept = next;
          try {
            window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
          } catch {
            /* 隐私模式下写不进去时只保留内存状态 */
          }
          for (const listener of listeners) listener();
        },
      };
    }

    /** 「更多」菜单里的收纳行：复用该面板在侧栏上的原始图标。 */
    function FoldedPanelRows({ onOpen, onDismiss, getFold, prefs }) {
      /** 勾选变化后重渲染，收起/放回的面板立刻同步。 */
      React.useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
      let fold = [];
      try {
        fold = typeof getFold === 'function' ? getFold() : [];
      } catch {
        fold = [];
      }
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

    /** 设置页：逐个面板选择「显示在侧栏」还是「收进更多」。 */
    function SidebarEntriesSettings({ getPanels, prefs }) {
      const kept = React.useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
      const panels = getPanels();
      const toggle = (id, checked) => {
        const next = checked ? [...kept.filter(item => item !== id), id] : kept.filter(item => item !== id);
        prefs.set(next);
      };
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640, minWidth: 0 } },
        h('span', {
          style: {
            fontSize: 18,
            fontWeight: 600,
            lineHeight: '26px',
            color: 'var(--dsw-alias-label-primary)',
          },
        }, '侧栏收纳'),
        h('span', {
          style: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' },
        }, '勾选的面板显示在侧栏，未勾选的收进侧栏「更多」菜单。'),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 } },
          panels.map(panel => h(
            'label',
            { key: panel.id, className: 'dsh-sidebar-compact-entry' },
            h(
              'span',
              { className: 'dsh-sidebar-compact-entry-text' },
              h('span', { className: 'dsh-sidebar-compact-entry-name' }, panel.label),
              h('span', { className: 'dsh-sidebar-compact-entry-id' }, panel.id),
            ),
            h('input', {
              type: 'checkbox',
              className: 'dsh-sidebar-compact-entry-check',
              checked: kept.includes(panel.id),
              onChange: event => toggle(panel.id, event.target.checked),
            }),
          )),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const prefs = createPrefs();
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-sidebar-compact';
        style.dataset.pluginCss = 'dsh-sidebar-compact/menu.css';
        document.head.appendChild(style);

        /** 按当前面板入口、勾选结果与语言重新生成隐藏规则。 */
        const paint = () => {
          const kept = prefs.get();
          const selectors = listPanels(ctx)
            .filter(panel => !kept.includes(panel.id))
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

        ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
          name: 'sidebar.panellist.actions',
          id: 'sidebar-compact',
          order: -10,
          inject: () => ({
            prefs,
            getFold: () => {
              const kept = prefs.get();
              return listPanels(ctx).filter(panel => !kept.includes(panel.id));
            },
          }),
        }, FoldedPanelRows));

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'sidebar-compact',
          order: 210,
          label: () => '侧栏收纳',
          inject: () => ({ prefs, getPanels: () => listPanels(ctx) }),
        }, SidebarEntriesSettings));
      },
    };
  },
});
