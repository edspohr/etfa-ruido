import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, X } from "lucide-react";

/**
 * SearchableSelect — Reusable searchable combobox for project selection.
 *
 * Props:
 *  - options: [{ value: string, label: string }]
 *  - value: string (selected value)
 *  - onChange: (value: string) => void
 *  - placeholder?: string
 *  - required?: boolean
 *  - className?: string (applied to the outer wrapper)
 *  - disabled?: boolean
 */
export default function SearchableSelect({
  options = [],
  value,
  onChange,
  placeholder = "Seleccionar...",
  required = false,
  className = "",
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const selectedOption = options.find((o) => o.value === value);

  // Filter options by search term
  const filtered = options.filter((o) => {
    if (!search) return true;
    const label = String(o.label || '');
    return label.toLowerCase().includes(search.toLowerCase());
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleOpen = () => {
    if (disabled) return;
    setIsOpen(true);
    setSearch("");
    // Focus the search input after render
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelect = (optionValue) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearch("");
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange("");
    setIsOpen(false);
    setSearch("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      setSearch("");
    }
    if (e.key === "Enter" && filtered.length === 1) {
      e.preventDefault();
      handleSelect(filtered[0].value);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Hidden native input for form required validation */}
      {required && (
        <input
          tabIndex={-1}
          autoComplete="off"
          style={{
            opacity: 0,
            width: 0,
            height: 0,
            position: "absolute",
            pointerEvents: "none",
          }}
          value={value || ""}
          required={required}
          onChange={() => {}}
        />
      )}

      {/* Trigger button */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`
          w-full flex items-center justify-between gap-2
          bg-slate-50/50 border border-slate-200 rounded-xl p-3
          text-sm text-left transition-all
          hover:border-slate-300 focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
          ${isOpen ? "ring-4 ring-indigo-500/20 border-indigo-500 bg-white" : ""}
        `}
      >
        <span
          className={
            selectedOption
              ? "text-slate-800 font-medium truncate"
              : "text-slate-400"
          }
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {value && !disabled && (
            <span
              role="button"
              onClick={handleClear}
              className="text-slate-400 hover:text-rose-500 p-0.5 rounded transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-200/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Search input */}
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all placeholder:text-slate-400"
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400 italic">
                Sin resultados para "{search}"
              </div>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`
                    w-full text-left px-4 py-2.5 text-sm transition-colors
                    ${
                      option.value === value
                        ? "bg-indigo-50 text-indigo-700 font-semibold"
                        : "text-slate-700 hover:bg-slate-50"
                    }
                  `}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
