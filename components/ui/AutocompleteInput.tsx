'use client';
import { useState, useRef, useMemo, useEffect, useId } from 'react';

export interface AutocompleteOption {
  value: string;
  hint?: string;
  badge?: string;
  badgeClass?: string;
  data?: unknown;
}

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  options: AutocompleteOption[];
  onSelect?: (option: AutocompleteOption) => void;
  placeholder?: string;
  filter?: (option: AutocompleteOption, query: string) => boolean;
  maxSuggestions?: number;
  inputMode?: 'text' | 'numeric' | 'decimal';
}

export default function AutocompleteInput({
  value,
  onChange,
  options,
  onSelect,
  placeholder,
  filter,
  maxSuggestions = 8,
  inputMode,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = value.toLowerCase().trim();
    const match = filter || ((opt, query) => opt.value.toLowerCase().includes(query));
    return options.filter(opt => !q || match(opt, q)).slice(0, maxSuggestions);
  }, [value, options, filter, maxSuggestions]);

  const select = (option: AutocompleteOption) => {
    onChange(option.value);
    onSelect?.(option);
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div className="client-autocomplete" ref={wrapperRef}>
      <input
        type="text"
        className="form-input"
        value={value}
        onChange={e => { onChange(e.target.value); setActiveIndex(-1); setOpen(true); }}
        onFocus={() => { if (filtered.length > 0) setOpen(true); }}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && filtered.length > 0}
        aria-controls={open && filtered.length > 0 ? listId : undefined}
        aria-activedescendant={open && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && filtered.length) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => event.key === 'ArrowDown'
              ? (index + 1) % filtered.length
              : (index <= 0 ? filtered.length - 1 : index - 1));
          } else if (event.key === 'Enter' && open && filtered[activeIndex]) {
            event.preventDefault();
            select(filtered[activeIndex]);
            setActiveIndex(-1);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
        onBlur={() => { setOpen(false); setActiveIndex(-1); }}
        autoComplete="off"
        inputMode={inputMode}
      />
      {open && filtered.length > 0 && (
        <div className="client-suggestions" id={listId} role="listbox">
          {filtered.map((opt, i) => (
            <div
              key={`${opt.value}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className="client-suggestion-item"
              onPointerDown={e => { e.preventDefault(); select(opt); }}
            >
              <div>
                <span className="client-suggestion-name">{opt.value}</span>
                {opt.hint && <span className="client-suggestion-tg"> {opt.hint}</span>}
              </div>
              {opt.badge && <span className={`client-suggestion-badge badge ${opt.badgeClass || 'badge--green'}`}>{opt.badge}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
