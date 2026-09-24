import {
  arrow,
  autoUpdate,
  flip,
  hide,
  offset,
  shift,
  size,
  useFloating,
} from '@floating-ui/react-dom';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './InfoPopover.module.css';

/** Native light dismissal, with positioning tied to the information button. */
export function InfoPopover({
  title,
  context,
  hint,
  children,
}: {
  title: string;
  context?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<HTMLSpanElement>(null);
  const { refs, elements, floatingStyles, middlewareData, placement, isPositioned, update } =
    useFloating<HTMLButtonElement>({
      open,
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [
        offset(10),
        flip({ padding: 12 }),
        shift({ padding: 12 }),
        size({
          padding: 12,
          apply({ availableHeight, elements }) {
            elements.floating.style.setProperty(
              '--available-height',
              `${Math.max(0, availableHeight)}px`,
            );
          },
        }),
        arrow({ element: arrowRef, padding: 16 }),
        hide(),
      ],
    });

  useEffect(() => {
    if (open && elements.reference && elements.floating) {
      return autoUpdate(elements.reference, elements.floating, update);
    }
  }, [open, elements.reference, elements.floating, update]);

  useEffect(() => {
    if (open && isPositioned && middlewareData.hide?.referenceHidden) {
      elements.floating?.hidePopover();
    }
  }, [open, isPositioned, middlewareData.hide?.referenceHidden, elements.floating]);

  return (
    <div className={styles.root}>
      <button
        ref={refs.setReference}
        type="button"
        className={styles.trigger}
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
      >
        <span>{title}</span>
        {hint && <small>{hint}</small>}
        <span className={styles.icon} aria-hidden="true">
          ⓘ
        </span>
      </button>
      <div
        ref={refs.setFloating}
        id={id}
        popover="auto"
        role="dialog"
        aria-labelledby={context ? `${id}-context ${id}-title` : `${id}-title`}
        className={styles.popover}
        style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }}
        data-side={placement.split('-')[0]}
        onToggle={(event) => setOpen(event.newState === 'open')}
      >
        <span
          ref={arrowRef}
          className={styles.arrow}
          aria-hidden="true"
          style={{ left: middlewareData.arrow?.x }}
        />
        <div className={styles.header}>
          <div>
            {context && <span id={`${id}-context`}>{context}</span>}
            <strong id={`${id}-title`}>{title}</strong>
          </div>
          <button
            type="button"
            className={styles.close}
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label="Close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className={styles.content} role="region" aria-label={`${title} content`} tabIndex={0}>
          {children}
        </div>
      </div>
    </div>
  );
}
