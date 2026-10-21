/*
 * Copyright (C) 2023-2026  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Keep the original controls and events for the existing controllers; only their view changes.
const STYLE = `
.study-ui-select,.study-ui-switch{font:inherit;color:inherit;box-sizing:border-box}
.study-ui-select{display:block;min-width:0;position:relative;width:100%}
.study-ui-select>select,.study-ui-switch>input{display:none!important}
.study-ui-select button,.study-ui-switch button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}
.study-ui-select .su-current,.study-ui-select .su-option,.study-ui-select .su-back{width:100%;min-height:40px;padding:8px 12px;text-align:left;display:flex;justify-content:space-between;align-items:center;gap:12px;border-radius:6px;box-sizing:border-box}
.study-ui-select button:hover{background:color-mix(in srgb,currentColor 9%,transparent)}
.study-ui-select .su-options{background:var(--st-paper,#fbfaf7);color:var(--st-ink,#263248);border:1px solid var(--st-line,#dce2eb);border-radius:8px;max-height:260px;overflow:auto}
.study-ui-select [hidden]{display:none!important}
.study-ui-select .su-value{color:var(--st-muted,#758095);font-size:.92em;margin-left:auto;overflow-wrap:anywhere}
.study-ui-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:40px;width:100%}
.study-ui-switch button{position:relative;flex:0 0 32px;width:32px;height:19px;border-radius:12px;background:#939aa5;padding:0}
.study-ui-switch button:after{content:'';position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:white;transition:transform .15s}
.study-ui-switch button[aria-checked=true]{background:var(--st-accent,#505ead)}
.study-ui-switch button[aria-checked=true]:after{transform:translateX(13px)}
#study-yt-panel .study-ui-select .su-options{background:transparent;color:inherit;border:0;border-top:1px solid #555}
#study-yt-panel .study-ui-select .su-current{height:40px}
#study-yt-panel:has(>.study-ui-select>.su-current[hidden])>.study-ui-select:not(:has(>.su-current[hidden])),#study-yt-panel:has(>.study-ui-select>.su-current[hidden])>.p-note{display:none}
.r-menu .r-menu-group{display:block!important}.r-menu .r-menu-group>label,.r-menu .r-menu-group>.study-ui-switch{display:block;width:100%}
.r-menu .r-engine:has(.study-ui-select){display:block!important}

`;

/** Present a native select as a row with a checked submenu; its bindings stay intact. */
export function menuSelect(select) {
    if (select.closest('.study-ui-select')) { return select.parentElement; }
    if (!document.getElementById('study-ui-style')) {
        const style = document.createElement('style'); style.id = 'study-ui-style'; style.textContent = STYLE; document.head.append(style);
    }
    const parent = select.parentElement;
    let name = select.dataset.label || select.getAttribute('aria-label') || '';
    if (parent?.tagName === 'LABEL') {
        const texts = [...parent.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE);
        name ||= texts.map((n) => n.textContent).join('').trim();
        for (const n of texts) { n.remove(); }
    }
    const root = document.createElement('div'); root.className = 'study-ui-select';
    const current = document.createElement('button'); current.type = 'button'; current.className = 'su-current';
    const label = document.createElement('span'); label.textContent = name;
    const value = document.createElement('span'); value.className = 'su-value'; current.append(label, value);
    const options = document.createElement('div'); options.className = 'su-options'; options.hidden = true;
    select.before(root); root.append(select, current, options);
    const paint = () => {
        value.textContent = (select.selectedOptions[0]?.textContent || select.value) + ' ›';
        current.disabled = select.disabled;
        options.replaceChildren();
        const back = document.createElement('button'); back.type = 'button'; back.className = 'su-back'; back.textContent = '‹ 返回';
        back.onclick = () => { options.hidden = true; current.hidden = false; current.setAttribute('aria-expanded', 'false'); }; options.append(back);
        for (const item of select.options) {
            if (item.hidden) { continue; }
            const button = document.createElement('button'); button.type = 'button'; button.className = 'su-option'; button.disabled = item.disabled;
            button.textContent = item.textContent + (item.value === select.value ? ' ✓' : ''); button.dataset.value = item.value;
            button.onclick = () => {
                select.value = item.value; options.hidden = true; current.hidden = false; current.setAttribute('aria-expanded', 'false');
                select.dispatchEvent(new Event('input', {bubbles:true})); select.dispatchEvent(new Event('change', {bubbles:true}));
            }; options.append(button);
        }
    };
    current.onclick = (event) => { event.preventDefault(); paint(); options.hidden = false; current.hidden = true; current.setAttribute('aria-expanded', 'true'); };
    root.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); options.hidden = true; current.hidden = false; current.focus(); } });
    select.addEventListener('study-ui-sync', paint);
    new MutationObserver(paint).observe(select, {childList:true,subtree:true,attributes:true});
    select.addEventListener('change', paint); paint(); return root;
}

/** Draw a switch without changing the original checkbox's data binding. */
export function switchRow(input) {
    if (input.closest('.study-ui-switch')) { return input.parentElement; }
    const row = document.createElement('span'); row.className = 'study-ui-switch';
    const parent = input.closest('label');
    const text = document.createElement('span'); text.textContent = input.dataset.label || input.getAttribute('aria-label') || '';
    if (parent && !parent.classList.contains('toggle')) {
        text.textContent = [...parent.childNodes].filter((n) => n !== input).map((n) => n.textContent).join('').trim();
        for (const n of [...parent.childNodes]) { if (n !== input) { n.remove(); } }
    }
    input.before(row); const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role','switch');
    button.setAttribute('aria-label', text.textContent || '开关'); row.append(input,text,button);
    if (parent?.classList.contains('toggle')) { parent.querySelector('.toggle-body')?.remove(); }
    const paint = () => { button.setAttribute('aria-checked', String(input.checked)); button.disabled = input.disabled; };
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
    Object.defineProperty(input, 'checked', {configurable:true,get() {return descriptor.get.call(this);},set(v) {descriptor.set.call(this,v);paint();}});
    button.onclick = (event) => { event.preventDefault(); input.checked = !input.checked; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); };
    input.addEventListener('change',paint); new MutationObserver(paint).observe(input,{attributes:true}); paint(); return row;
}

// Pages and dynamically mounted cards share these two controls, not another settings controller.
if (typeof document !== 'undefined') {
    const page = document;
    const enhance = () => {
        for (const select of page.querySelectorAll('select:not(.study-ui-select>select)')) { menuSelect(select); }
        for (const input of page.querySelectorAll('input[type=checkbox]:not(.study-ui-switch>input)')) { switchRow(input); }
    };
    new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});
    enhance();
}
