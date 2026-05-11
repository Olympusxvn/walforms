// fields.js — field type definitions, palette chips, canvas previews, live inputs.

export const FIELD_TYPES = [
  { type: 'shortText',           label: 'Short text',           category: 'text',   icon: 'T',  description: 'One-line answer' },
  { type: 'longText',            label: 'Long text',            category: 'text',   icon: '¶',  description: 'Open paragraph' },
  { type: 'email',               label: 'Email',                category: 'text',   icon: '@',  description: 'Email address' },
  { type: 'phone',               label: 'Phone',                category: 'text',   icon: '☎',  description: 'Phone number' },
  { type: 'url',                 label: 'URL',                  category: 'text',   icon: '🔗', description: 'Website link' },
  { type: 'number',              label: 'Number',               category: 'number', icon: '#',  description: 'Numeric answer' },
  { type: 'date',                label: 'Date',                 category: 'date',   icon: '📅', description: 'Pick a date' },
  { type: 'time',                label: 'Time',                 category: 'date',   icon: '🕒', description: 'Pick a time' },
  { type: 'rating',              label: 'Rating',               category: 'choice', icon: '★',  description: '1–5 star scale' },
  { type: 'singleChoice',        label: 'Single choice',        category: 'choice', icon: '◉',  description: 'Pick one option' },
  { type: 'checkboxes',          label: 'Checkboxes',           category: 'choice', icon: '☑',  description: 'Pick multiple' },
  { type: 'dropdown',            label: 'Dropdown',             category: 'choice', icon: '▾',  description: 'Compact selector' },
  { type: 'screenshot',          label: 'Screenshot',           category: 'media',  icon: '🖼',  description: 'Upload image' },
  { type: 'video',               label: 'Video',                category: 'media',  icon: '▶',  description: 'Upload ≤30s clip' },
  { type: 'confirmationCheckbox',label: 'Confirmation',         category: 'ctrl',   icon: '✓',  description: 'Must agree before submit' },
];

const CATEGORY_CLASS = {
  text:   'chip-text',
  choice: 'chip-choice',
  media:  'chip-media',
  ctrl:   'chip-ctrl',
  date:   'chip-date',
  number: 'chip-number',
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createField(type) {
  const def = FIELD_TYPES.find(f => f.type === type);
  if (!def) return null;
  return {
    id: `f-${Math.random().toString(36).slice(2, 10)}`,
    type,
    label: def.label,
    required: type !== 'confirmationCheckbox',
    helpText: '',
    options: ['Option A', 'Option B', 'Option C'],
    scale: 5,
  };
}

// ---------------------------------------------------------------------------
// Palette chip (left sidebar)
// ---------------------------------------------------------------------------
export function renderPaletteChip(fieldType) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'palette-chip';
  btn.draggable = true;
  btn.dataset.fieldType = fieldType.type;

  const iconEl = document.createElement('span');
  iconEl.className = `palette-chip-icon ${CATEGORY_CLASS[fieldType.category] ?? 'chip-text'}`;
  iconEl.textContent = fieldType.icon;

  const textEl = document.createElement('span');
  textEl.innerHTML = `<strong style="font-size:var(--text-sm)">${fieldType.label}</strong><br><span style="font-size:11px;color:var(--color-muted)">${fieldType.description}</span>`;

  btn.append(iconEl, textEl);
  return btn;
}

// ---------------------------------------------------------------------------
// Canvas field card (center column)
// ---------------------------------------------------------------------------
export function renderCanvasCard(field, { selected = false, onSelect, onDelete, onMoveUp, onMoveDown } = {}) {
  const el = document.createElement('div');
  el.className = `canvas-field${selected ? ' selected' : ''}`;
  el.setAttribute('role', 'listitem');
  el.dataset.fieldId = field.id;
  el.draggable = true;

  const def = FIELD_TYPES.find(f => f.type === field.type);
  const catClass = CATEGORY_CLASS[def?.category ?? 'text'];
  const kind = (def?.label ?? field.type).toUpperCase();

  el.innerHTML = `
    <span class="drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>
    <div class="canvas-field-body">
      <div class="canvas-field-label">
        ${escHtml(field.label)}${field.required ? ' <span style="color:var(--color-red)">*</span>' : ''}
        <span class="canvas-field-kind">${escHtml(kind)}</span>
      </div>
      <div class="canvas-field-meta">
        <span class="palette-chip-icon ${catClass}" style="width:18px;height:18px;font-size:11px;display:inline-flex;vertical-align:middle">${def?.icon ?? '?'}</span>
        ${def?.label ?? field.type}${field.helpText ? ` · ${escHtml(field.helpText)}` : ''}
      </div>
    </div>
    <div class="canvas-field-actions">
      <button class="field-del-btn" type="button" title="Remove field" aria-label="Remove ${escHtml(field.label)}">✕</button>
    </div>
  `;

  el.addEventListener('click', e => {
    if (e.target.closest('.field-del-btn')) return;
    onSelect?.();
  });
  el.querySelector('.field-del-btn').addEventListener('click', e => {
    e.stopPropagation();
    onDelete?.();
  });

  return el;
}

// ---------------------------------------------------------------------------
// Properties panel (right sidebar)
// ---------------------------------------------------------------------------
export function renderFieldSettings(field, onChange) {
  const el = document.createElement('div');
  el.style.display = 'grid';
  el.style.gap = 'var(--sp-5)';

  // Label
  el.append(makeTextInput('Label', field.label, v => { field.label = v; onChange(); }));

  // Help text
  el.append(makeTextInput('Help text', field.helpText, v => { field.helpText = v; onChange(); }));

  // Required toggle
  const reqRow = document.createElement('label');
  reqRow.style.cssText = 'display:flex;align-items:center;gap:var(--sp-3);cursor:pointer;font-size:var(--text-sm)';
  const reqCb = document.createElement('input');
  reqCb.type = 'checkbox';
  reqCb.checked = field.required;
  reqCb.addEventListener('change', () => { field.required = reqCb.checked; onChange(); });
  reqRow.append(reqCb, 'Required');
  el.append(reqRow);

  // Options (choice types)
  if (['singleChoice', 'checkboxes', 'dropdown'].includes(field.type)) {
    const optGroup = document.createElement('div');
    optGroup.className = 'field-group';

    const lbl = document.createElement('label');
    lbl.className = 'field-label';
    lbl.textContent = 'Options (one per line)';

    const ta = document.createElement('textarea');
    ta.className = 'field-textarea';
    ta.style.minHeight = '100px';
    ta.value = field.options.join('\n');
    ta.addEventListener('input', () => {
      field.options = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
      onChange();
    });

    optGroup.append(lbl, ta);
    el.append(optGroup);
  }

  // Scale (rating)
  if (field.type === 'rating') {
    const g = document.createElement('div');
    g.className = 'field-group';
    g.innerHTML = '<label class="field-label">Max stars</label>';
    const inp = document.createElement('input');
    inp.type = 'number'; inp.className = 'field-input';
    inp.min = '2'; inp.max = '10'; inp.value = String(field.scale);
    inp.addEventListener('input', () => { field.scale = Math.max(2, Math.min(10, Number(inp.value) || 5)); onChange(); });
    g.append(inp);
    el.append(g);
  }

  return el;
}

// ---------------------------------------------------------------------------
// Live input renderer (used by form.html)
// ---------------------------------------------------------------------------
export function renderFieldInput(field, value = null) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field-group';

  if (field.type !== 'confirmationCheckbox') {
    const lbl = document.createElement('label');
    lbl.className = 'field-label';
    lbl.setAttribute('for', field.id);
    lbl.innerHTML = `${escHtml(field.label)}${field.required ? ' <span style="color:var(--color-red)" aria-hidden="true">*</span>' : ''}`;
    wrapper.append(lbl);
  }

  let input;

  switch (field.type) {
    case 'shortText':
      input = el('input', { type: 'text', className: 'field-input', id: field.id, value: value ?? '' });
      break;

    case 'longText':
      input = el('textarea', { className: 'field-textarea', id: field.id });
      input.value = value ?? '';
      break;

    case 'email':
      input = el('input', { type: 'email', className: 'field-input', id: field.id,
        placeholder: 'name@example.com', value: value ?? '' });
      break;

    case 'phone':
      input = el('input', { type: 'tel', className: 'field-input', id: field.id,
        placeholder: '+84 9xx xxx xxx', value: value ?? '' });
      break;

    case 'url':
      input = el('input', { type: 'url', className: 'field-input', id: field.id,
        placeholder: 'https://…', value: value ?? '' });
      break;

    case 'number':
      input = el('input', { type: 'number', className: 'field-input', id: field.id, value: value ?? '' });
      break;

    case 'date':
      input = el('input', { type: 'date', className: 'field-input', id: field.id, value: value ?? '' });
      break;

    case 'time':
      input = el('input', { type: 'time', className: 'field-input', id: field.id, value: value ?? '' });
      break;

    case 'rating': {
      input = el('div', { id: field.id, className: 'rating-row' });
      input.setAttribute('role', 'radiogroup');
      input.setAttribute('aria-label', field.label);
      input.style.cssText = 'display:flex;gap:var(--sp-2);flex-wrap:wrap';
      for (let i = 1; i <= field.scale; i++) {
        const star = el('button', { type: 'button', className: 'rating-star', textContent: '★' });
        star.dataset.value = String(i);
        star.style.cssText = `font-size:28px;background:none;border:none;cursor:pointer;
          color:${value >= i ? 'var(--color-primary)' : 'var(--color-border)'};padding:0;line-height:1`;
        star.setAttribute('aria-label', `${i} star${i > 1 ? 's' : ''}`);
        star.addEventListener('click', () => {
          input.dataset.value = String(i);
          input.querySelectorAll('.rating-star').forEach((s, idx) => {
            s.style.color = idx < i ? 'var(--color-primary)' : 'var(--color-border)';
          });
        });
        input.append(star);
      }
      if (value) input.dataset.value = String(value);
      break;
    }

    case 'singleChoice': {
      input = el('div', { id: field.id });
      input.style.cssText = 'display:grid;gap:var(--sp-2)';
      field.options.forEach(opt => {
        const lbl = el('label', { style: 'display:flex;align-items:center;gap:var(--sp-3);cursor:pointer;font-size:var(--text-sm)' });
        const rb = el('input', { type: 'radio', name: field.id, value: opt });
        if (value === opt) rb.checked = true;
        lbl.append(rb, document.createTextNode(opt));
        input.append(lbl);
      });
      break;
    }

    case 'checkboxes': {
      input = el('div', { id: field.id });
      input.style.cssText = 'display:grid;gap:var(--sp-2)';
      field.options.forEach(opt => {
        const lbl = el('label', { style: 'display:flex;align-items:center;gap:var(--sp-3);cursor:pointer;font-size:var(--text-sm)' });
        const cb = el('input', { type: 'checkbox', name: field.id, value: opt });
        if (Array.isArray(value) && value.includes(opt)) cb.checked = true;
        lbl.append(cb, document.createTextNode(opt));
        input.append(lbl);
      });
      break;
    }

    case 'dropdown': {
      input = el('select', { className: 'field-select', id: field.id });
      const placeholder = el('option', { value: '', textContent: '— Select —' });
      placeholder.disabled = true;
      placeholder.selected = !value;
      input.append(placeholder);
      field.options.forEach(opt => {
        const o = el('option', { value: opt, textContent: opt });
        if (value === opt) o.selected = true;
        input.append(o);
      });
      break;
    }

    case 'screenshot':
      input = el('input', { type: 'file', className: 'field-input', id: field.id, accept: 'image/*' });
      break;

    case 'video':
      input = el('input', { type: 'file', className: 'field-input', id: field.id, accept: 'video/*' });
      break;

    case 'confirmationCheckbox': {
      const lbl = el('label', { style: 'display:flex;align-items:flex-start;gap:var(--sp-3);cursor:pointer;font-size:var(--text-sm)' });
      const cb = el('input', { type: 'checkbox', id: field.id });
      cb.checked = Boolean(value);
      cb.style.marginTop = '2px';
      lbl.append(cb, document.createTextNode(field.label));
      wrapper.append(lbl);
      if (field.helpText) wrapper.append(el('p', { className: 'field-hint', textContent: field.helpText }));
      return wrapper;
    }

    default:
      input = el('input', { type: 'text', className: 'field-input', id: field.id, value: value ?? '' });
  }

  wrapper.append(input);
  if (field.helpText) wrapper.append(el('p', { className: 'field-hint', textContent: field.helpText }));
  return wrapper;
}

/** Read the current value from a rendered renderFieldInput wrapper. */
export function readFieldValue(field, wrapper) {
  switch (field.type) {
    case 'shortText': case 'longText': case 'url': case 'email': case 'phone': case 'date': case 'time':
      return wrapper.querySelector('input, textarea')?.value ?? '';
    case 'number': {
      const raw = wrapper.querySelector('input')?.value ?? '';
      return raw === '' ? '' : Number(raw);
    }
    case 'rating':
      return Number(wrapper.querySelector('[data-value]')?.dataset.value ?? 0);
    case 'singleChoice':
      return wrapper.querySelector('input[type=radio]:checked')?.value ?? null;
    case 'checkboxes':
      return [...wrapper.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
    case 'dropdown':
      return wrapper.querySelector('select')?.value ?? null;
    case 'screenshot': case 'video':
      return wrapper.querySelector('input[type=file]')?.files?.[0] ?? null;
    case 'confirmationCheckbox':
      return wrapper.querySelector('input[type=checkbox]')?.checked ?? false;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function el(tag, props = {}) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'textContent') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'className') e.className = v;
    else e[k] = v;
  }
  return e;
}

function makeTextInput(labelText, currentValue, onChange) {
  const g = document.createElement('div');
  g.className = 'field-group';
  const lbl = el('label', { className: 'field-label', textContent: labelText });
  const inp = el('input', { type: 'text', className: 'field-input', value: currentValue });
  inp.addEventListener('input', () => onChange(inp.value));
  g.append(lbl, inp);
  return g;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
