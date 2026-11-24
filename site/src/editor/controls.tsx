import {useId} from 'react';

export function Slider({label, value, min, max, step, onChange, fmt, hint, disabled}: {label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string; hint?: string; disabled?: boolean}) {
  const id = useId();
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className={`ctl${disabled ? ' off' : ''}`}>
      <label className="ctl-l" htmlFor={id}><span>{label}{hint && <small>{hint}</small>}</span><b>{fmt ? fmt(value) : value}</b></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} style={{'--p': `${p}%`} as React.CSSProperties} />
    </div>
  );
}

export function Toggle({label, on, onChange, hint}: {label: string; on: boolean; onChange: (v: boolean) => void; hint?: string}) {
  return (
    <button type="button" role="switch" aria-checked={on} className="ctl tg" onClick={() => onChange(!on)}>
      <span className="ctl-l"><span>{label}{hint && <small>{hint}</small>}</span></span>
      <span className={`sw${on ? ' on' : ''}`} aria-hidden />
    </button>
  );
}

export function Seg<T extends string>({label, value, options, onChange}: {label?: string; value: T; options: [T, string][]; onChange: (v: T) => void}) {
  return (
    <div className="ctl">
      {label && <span className="ctl-l"><span>{label}</span></span>}
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map(([k, name]) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{name}</button>
        ))}
      </div>
    </div>
  );
}

export function Field({label, value, onChange, placeholder}: {label: string; value: string; onChange: (v: string) => void; placeholder?: string}) {
  const id = useId();
  return (
    <div className="ctl txt">
      <label className="ctl-l" htmlFor={id}><span>{label}</span></label>
      <input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoComplete="off" />
    </div>
  );
}

export function Colors({label, value, swatches, onChange}: {label: string; value: string; swatches: string[]; onChange: (v: string) => void}) {
  const id = useId();
  const custom = !swatches.some((s) => s.toLowerCase() === value.toLowerCase());
  return (
    <div className="ctl">
      <span className="ctl-l" id={id}><span>{label}</span><b>{value.toUpperCase()}</b></span>
      <div className="swatches" role="radiogroup" aria-labelledby={id}>
        {swatches.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c.toLowerCase()} aria-label={c} title={c} className={`swatch${value.toLowerCase() === c.toLowerCase() ? ' on' : ''}`} style={{background: c}} onClick={() => onChange(c)} />
        ))}
        <label className={`swatch pick${custom ? ' on' : ''}`} title="Custom colour" style={custom ? {background: value} : undefined}>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />
          {!custom && <span aria-hidden>+</span>}
        </label>
      </div>
    </div>
  );
}

export function Panel({title, hint, children}: {title?: string; hint?: string; children: React.ReactNode}) {
  return (
    <section className="grp">
      {title && <h3>{title}</h3>}
      {hint && <p className="hint">{hint}</p>}
      <div className="grp-in">{children}</div>
    </section>
  );
}
