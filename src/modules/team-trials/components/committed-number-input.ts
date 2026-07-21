import {
  useCallback,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent
} from 'react';

type CommittedNumberInputOptions = {
  value: number;
  max?: number;
  emptyWhenZero?: boolean;
  onCommit: (value: number) => void;
};

function displayValue(value: number, emptyWhenZero: boolean) {
  return emptyWhenZero && value === 0 ? '' : String(value);
}

function normalizeCommittedNumber(rawValue: string, max?: number) {
  const parsed = Number(rawValue);
  const nonNegativeInteger = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;

  return max === undefined ? nonNegativeInteger : Math.min(max, nonNegativeInteger);
}

/**
 * Keeps a numeric field's in-progress text local until the user finishes editing.
 * This preserves an empty field and caret position while typing, then commits a
 * normalized store value on blur or Enter.
 */
export function useCommittedNumberInput(options: CommittedNumberInputOptions) {
  const { value, max, emptyWhenZero = false, onCommit } = options;
  const [rawValue, setRawValue] = useState(() => displayValue(value, emptyWhenZero));
  const [isEditing, setIsEditing] = useState(false);

  const commit = useCallback(() => {
    onCommit(normalizeCommittedNumber(rawValue, max));
    setIsEditing(false);
  }, [max, onCommit, rawValue]);

  return {
    value: isEditing ? rawValue : displayValue(value, emptyWhenZero),
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setRawValue(event.target.value);
    },
    onFocus: (event: FocusEvent<HTMLInputElement>) => {
      setRawValue(String(value));
      setIsEditing(true);
      event.currentTarget.select();
    },
    onBlur: commit,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.blur();
      }
    }
  };
}
